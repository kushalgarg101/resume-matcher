"""
Analyses API routes.

Endpoints (all require a valid Supabase JWT):
  POST /api/analyses      -> upload resume (multipart) + JD, enqueue a job
  GET  /api/analyses      -> list the caller's analyses (newest first)
  GET  /api/analyses/{id} -> fetch one analysis (status + result)

Flow:
  1. Validate size/type, upload PDF to Supabase Storage (admin client).
  2. Insert a `queued` row using the *user-scoped* client (RLS enforces owner).
  3. Enqueue an RQ job carrying only metadata (NOT the file bytes).
  4. Return the new analysis id immediately; the worker updates the row later.

We pass only metadata to the queue: the worker re-downloads the PDF from storage
using the service_role key. This keeps Redis tiny (free tier is 25 MB) and
decouples job payload from file storage.
"""

from __future__ import annotations

import os
import traceback
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, status, UploadFile
from fastapi.security import HTTPBearer
from rq import Retry

from app.api.auth import get_current_user
from app.core.config import get_settings
from app.core.redis import get_queue
from app.core.supabase import get_admin_client, get_user_client
from app.models.schemas import AnalysisOut, MatchResult
from app.services.storage import StorageError, delete_resume, upload_resume
from app.worker import process_analysis  # the RQ task

router = APIRouter(prefix="/api/analyses", tags=["Analyses"])

_bearer = HTTPBearer(auto_error=False)


def _token_from_request(request: Request) -> str:
    """Pull the raw bearer token off a Request for a user-scoped client."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


async def _read_bounded(upload: UploadFile, max_bytes: int) -> bytes:
    """
    Read an uploaded file while strictly bounding memory usage.

    A malicious or misconfigured client may omit / spoof the multipart
    Content-Length, so we cannot trust `upload.size` alone. We read in fixed
    chunks and stop the moment we exceed `max_bytes + 1`; on the free tier
    (512 MB RAM) this guarantees we never buffer more than `max_bytes + 1`
    regardless of what the client claims or sends.

    Raises:
        HTTPException(413): If the stream is larger than `max_bytes`.
    """
    limit = max_bytes + 1
    chunks: list[bytes] = []
    total = 0
    chunk_size = 64 * 1024
    while total < limit:
        chunk = await upload.read(chunk_size)
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
    if total > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Resume too large (max {max_bytes} bytes).",
        )
    if total == 0:
        # An empty stream (0-byte upload or no body) also satisfies the
        # `%PDF` magic-byte prefix check, so reject it here before any storage.
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    return b"".join(chunks)


def _row_to_out(row: dict) -> AnalysisOut:
    """Map a DB row to the API response model.

    A malformed `result_json` (shouldn't happen, but defends against corrupted
    storage) is ignored rather than crashing the endpoint with a 500.
    """
    result_json = row.get("result_json")
    result = None
    if result_json:
        try:
            result = MatchResult(**result_json)
        except Exception:  # noqa: BLE001 - corrupt stored payload
            result = None
    return AnalysisOut(
        id=row["id"],
        filename=row["filename"],
        status=row["status"],
        result=result,
        error_message=row.get("error_message"),
        created_at=row.get("created_at"),
        completed_at=row.get("completed_at"),
    )


@router.post("", response_model=AnalysisOut, status_code=status.HTTP_201_CREATED)
async def create_analysis(
    request: Request,
    jd_text: str = Form(..., min_length=10, max_length=20_000, description="Job description text"),
    resume: UploadFile = File(..., description="Resume PDF file"),
    user_id: str = Depends(get_current_user),
):
    """
    Upload a resume + JD, persist a queued analysis, and enqueue processing.

    Ordering / failure handling:
      1. Validate + upload PDF to Storage (fails fast with 400/502).
      2. Insert a `queued` row (RLS-scoped to the user).
      3. Enqueue the RQ job. If enqueue fails AFTER the row exists, we mark the
         row `failed` so it is never orphaned in `queued` with no worker.
    """
    settings = get_settings()

    # NOTE: we do NOT hard-reject on `content_type`. Many real clients (curl,
    # some browsers, programmatic uploads) send `application/octet-stream` even
    # for valid PDFs. The authoritative check is the `%PDF` magic-byte test
    # below, which runs after the (bounded) read.

    # Reject oversized uploads BEFORE reading the body into memory (important on
    # the 512 MB free tier). `size` is populated from the multipart
    # Content-Length when available; fall back to a post-read check otherwise.
    if resume.size is not None and resume.size > settings.max_pdf_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Resume too large (max {settings.max_pdf_bytes} bytes).",
        )

    pdf_bytes = await _read_bounded(resume, settings.max_pdf_bytes)
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="File does not look like a PDF.")

    analysis_id = str(uuid.uuid4())
    # Store only the basename to avoid any path traversal / display issues from
    # a hostile filename sent by the client.
    safe_filename = os.path.basename(resume.filename or "resume.pdf") or "resume.pdf"
    try:
        storage_path = upload_resume(
            user_id=user_id, analysis_id=analysis_id, pdf_bytes=pdf_bytes
        )
    except StorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    token = _token_from_request(request)
    user_client = get_user_client(token)
    insert_row = {
        "id": analysis_id,
        "user_id": user_id,
        "filename": safe_filename,
        "jd_text": jd_text,
        "storage_path": storage_path,
        "status": "queued",
    }
    result = user_client.table("analyses").insert(insert_row).execute()
    if getattr(result, "error", None):
        # The row was never created, but the PDF may already be in Storage.
        # Best-effort cleanup so Storage doesn't grow with orphaned uploads.
        try:
            delete_resume(storage_path=storage_path)
        except Exception:  # noqa: BLE001 - cleanup must never mask the real error
            traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"DB insert failed: {result.error}")
    if not result.data:
        try:
            delete_resume(storage_path=storage_path)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        raise HTTPException(status_code=500, detail="DB insert returned no row.")

    try:
        get_queue().enqueue(
            process_analysis,
            analysis_id=analysis_id,
            storage_path=storage_path,
            jd_text=jd_text,
            retry=Retry(max=2, interval=10),
            # Give the worker generous headroom beyond RQ's 180s default. The
            # LLM call (groq_request_timeout) plus exponential backoff across
            # retries plus PDF extraction can approach the default on a slow run;
            # without this, RQ would SIGKILL the job before our except block runs
            # and leave the row stuck in `processing` until the 30-min reaper.
            job_timeout=600,
        )
    except Exception as exc:  # noqa: BLE001 - don't orphan a queued row
        # Mark the row failed so it is not stuck in `queued` with no worker.
        # Use the ADMIN (service_role) client: authenticated users have NO
        # update policy by design (only the worker writes results), so a
        # user-scoped update would be silently blocked by RLS and leave the row
        # orphaned.
        admin = get_admin_client()
        admin.table("analyses").update(
            {"status": "failed", "error_message": "Job enqueue failed"}
        ).eq("id", analysis_id).eq("status", "queued").execute()
        # Best-effort cleanup of the already-uploaded PDF so Storage doesn't
        # grow with orphaned objects (mirrors the insert-failure path above).
        try:
            delete_resume(storage_path=storage_path)
        except Exception:  # noqa: BLE001 - cleanup must never mask the real error
            traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Could not enqueue job: {exc}") from exc

    row = result.data[0]
    return _row_to_out(row)


@router.get("", response_model=list[AnalysisOut])
async def list_analyses(
    request: Request, user_id: str = Depends(get_current_user)
):
    """List the caller's analyses, newest first."""
    token = _token_from_request(request)
    user_client = get_user_client(token)
    res = (
        user_client.table("analyses")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {res.error}")
    return [_row_to_out(r) for r in res.data]


@router.get("/{analysis_id}", response_model=AnalysisOut)
async def get_analysis(
    analysis_id: str, request: Request, user_id: str = Depends(get_current_user)
):
    """Fetch a single analysis owned by the caller."""
    token = _token_from_request(request)
    user_client = get_user_client(token)
    res = (
        user_client.table("analyses")
        .select("*")
        .eq("id", analysis_id)
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {res.error}")
    if not res.data:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return _row_to_out(res.data[0])
