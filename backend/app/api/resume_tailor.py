from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_admin_client, get_user_client
from app.models.schemas import (
    OptimizedResumeOut,
    TailorResumeRequest,
    TailorResumeResponse,
    profile_from_db,
)
from app.services.resume_optimizer import tailor_resume
from app.services.storage import download_resume, upload_tailored_resume
from app.services.pdf_extract import extract_pdf_text

router = APIRouter(prefix="/api/resume", tags=["Resume"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/tailor", response_model=TailorResumeResponse)
async def tailor_resume_endpoint(
    body: TailorResumeRequest,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Tailor the user's resume for a specific job and store the result."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    # Get profile
    profile_res = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(profile_res, "error", None) or not profile_res.data:
        raise HTTPException(status_code=404, detail="No profile found. Upload a resume first.")
    profile = profile_from_db(profile_res.data[0])

    # Get job
    job_res = (
        user_client.table("jobs")
        .select("*")
        .eq("id", body.job_id)
        .execute()
    )
    if getattr(job_res, "error", None) or not job_res.data:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = job_res.data[0]

    # Get latest analysis to fetch original resume text from storage
    analysis_res = (
        user_client.table("analyses")
        .select("storage_path")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    resume_text = None
    if not getattr(analysis_res, "error", None) and analysis_res.data:
        storage_path = analysis_res.data[0].get("storage_path")
        if storage_path:
            try:
                pdf_bytes = download_resume(storage_path=storage_path)
                resume_text = extract_pdf_text(pdf_bytes)
            except Exception:
                pass  # best-effort; optimizer can still work without raw text

    # Generate tailored resume
    try:
        tailored = tailor_resume(profile, job, resume_text=resume_text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Resume tailoring failed: {exc}") from exc

    # Store the tailored text as a PDF in Supabase Storage
    tailored_text = tailored.get("tailored_text", "")
    if tailored_text:
        try:
            storage_path = upload_tailored_resume(
                user_id=user_id,
                job_id=body.job_id,
                text=tailored_text,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Storage upload failed: {exc}") from exc
    else:
        storage_path = ""

    # Upsert optimized_resume row
    admin = get_admin_client()
    resume_id = str(uuid.uuid4())
    insert_data = {
        "id": resume_id,
        "user_id": user_id,
        "job_id": body.job_id,
        "storage_path": storage_path,
        "summary": tailored.get("summary", ""),
        "skills": tailored.get("skills", []),
    }
    res = (
        admin.table("optimized_resumes")
        .upsert(insert_data, on_conflict="user_id,job_id")
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB write failed: {res.error}")

    row = res.data[0] if res.data else insert_data
    optimized_resume = OptimizedResumeOut(
        id=str(row.get("id", resume_id)),
        job_id=str(row.get("job_id", body.job_id)),
        storage_path=str(row.get("storage_path", storage_path)),
        summary=row.get("summary", tailored.get("summary")),
        skills=row.get("skills", tailored.get("skills", [])),
        created_at=row.get("created_at"),
    )

    return TailorResumeResponse(
        optimized_resume=optimized_resume,
        tailored_profile={
            "summary": tailored.get("summary", profile.summary),
            "skills": tailored.get("skills", profile.skills),
            "experience": tailored.get("experience", []),
        },
    )


@router.get("/tailor/{job_id}", response_model=OptimizedResumeOut | None)
async def get_tailored_resume(
    job_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Get the tailored resume for a specific job, if one exists."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("optimized_resumes")
        .select("*")
        .eq("user_id", user_id)
        .eq("job_id", job_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        return None

    row = res.data[0]
    return OptimizedResumeOut(
        id=str(row.get("id", "")),
        job_id=str(row.get("job_id", "")),
        storage_path=str(row.get("storage_path", "")),
        summary=row.get("summary"),
        skills=row.get("skills", []),
        created_at=row.get("created_at"),
    )
