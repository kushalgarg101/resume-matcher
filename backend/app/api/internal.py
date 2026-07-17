"""
Internal / operational endpoints.

These are NOT user-facing. They are protected by a shared `INTERNAL_API_KEY`
header (not a Supabase user JWT) and are intended to be called only by the
keepalive cron (or an operator). They perform housekeeping that the async
worker/API can't easily do on their own — currently, reclaiming analysis rows
that got stuck in `queued`/`processing` (e.g. because the API process crashed
after inserting a row but before enqueueing the RQ job, or a worker died
without finalising the row).
"""

from __future__ import annotations

import traceback
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import get_settings
from app.core.supabase import get_admin_client
from app.services.storage import delete_resume

router = APIRouter(prefix="/internal", tags=["Internal"])

# A row older than this (minutes) that is still not finalised is considered
# stuck. 30 min is well beyond the free-tier worker cold-start window.
STUCK_OLDER_THAN_MINUTES = 30


def _assert_internal_auth(x_internal_key: str | None) -> None:
    """Reject calls that don't present the shared internal API key.

    In local dev (blank INTERNAL_API_KEY) auth is relaxed so tests/manual runs
    work without secrets; in production the key must be set and must match.
    """
    expected = get_settings().internal_api_key
    if not expected:
        # Dev mode: no key configured -> allow. (CI sets nothing for this route.)
        return
    if x_internal_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal API key.",
        )


@router.post("/reap")
async def reap_stuck_analyses(
    x_internal_key: str | None = Header(default=None),
):
    """Mark analysis rows stuck in `queued`/`processing` for too long as `failed`.

    Returns the number of rows reclaimed. Idempotent and safe to call repeatedly.
    A row that is genuinely still being processed will not yet be old enough to
    be reclaimed, so in-flight jobs are never disturbed.
    """
    _assert_internal_auth(x_internal_key)
    admin = get_admin_client()
    # PostgREST treats filter values as literal constants, not SQL expressions,
    # so we cannot pass `now() - interval '30 minutes'` (it would be quoted as a
    # string and match nothing). Compute the absolute threshold here and compare
    # `updated_at` against a real timestamp instead.
    threshold = (
        datetime.now(timezone.utc) - timedelta(minutes=STUCK_OLDER_THAN_MINUTES)
    ).isoformat()
    # `updated_at` is maintained by the DB trigger on every update, so a live job
    # keeps bumping it and is never reaped while it is genuinely in progress.
    # `update()` defaults to return=representation, so res.data holds the rows
    # we just failed (used below to clean up their orphaned Storage PDFs).
    res = (
        admin.table("analyses")
        .update(
            {
                "status": "failed",
                "error_message": "Job stalled (no worker progress); marked failed by reaper.",
            }
        )
        .in_("status", ["queued", "processing"])
        .lt("updated_at", threshold)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(
            status_code=500, detail=f"Reap failed: {res.error}"
        )
    reclaimed_rows = res.data if res.data else []
    # Bound free-tier Storage growth: only when the operator opted in via
    # DELETE_RESUME_AFTER_PROCESSING do we delete the now-unrecoverable resumes
    # for reaped rows. A live job always finishes in seconds (far under the 30
    # minute threshold), so a reaped row's PDF is never an in-flight file.
    if get_settings().delete_resume_after_processing:
        for row in reclaimed_rows:
            storage_path = row.get("storage_path")
            if storage_path:
                try:
                    delete_resume(storage_path=storage_path)
                except Exception:  # noqa: BLE001 - cleanup must never mask the result
                    traceback.print_exc()
    return {"reclaimed": len(reclaimed_rows)}
