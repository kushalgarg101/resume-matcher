"""
RQ worker task.

This function runs in the SEPARATE worker process (Render "worker" service). It
receives only job metadata, re-downloads the PDF from Supabase Storage using the
service_role key (which bypasses RLS), runs the matcher pipeline, and writes the
result back to Postgres.

Lifecycle states written to the `analyses.status` column:
  queued -> processing -> completed | failed

Retry handling
-------------
The job is enqueued with `Retry(max=2, interval=10)`. We must NOT finalise the
row as `failed` on a *transient* error, otherwise RQ's retries would hit the
"already failed" guard and never re-process. Instead:
  * On a non-final attempt (RQ will retry), we re-raise WITHOUT writing `failed`
    and WITHOUT deleting the PDF — the row stays `processing` and the next
    delivery re-runs it.
  * Only on the FINAL attempt do we write `failed`.
The resume PDF is deleted from Storage ONLY after a successful completion (and
only when `DELETE_RESUME_AFTER_PROCESSING` is enabled), so transient failures
keep the file available for retry.
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime, timezone

from rq import get_current_job

from app.core.config import get_settings
from app.core.supabase import get_admin_client
from app.services.matcher import run_match
from app.services.storage import delete_resume, download_resume


def _utcnow() -> str:
    """Return the current UTC timestamp as an ISO string for PostgREST."""
    return datetime.now(timezone.utc).isoformat()


def _is_last_attempt() -> bool:
    """Return True if RQ has no retries left for the current job.

    When running outside an RQ context (e.g. tests), treat every attempt as the
    last one so failures are recorded rather than silently swallowed.

    NOTE: in rq >= 2.0 the attribute is `retries_left` (not `attempts_left`).
    At enqueue `retries_left == retry.max`; rq decrements it *after* each failed
    attempt (in `Job.retry`) and only re-enqueues while `retries_left > 0`. So
    during execution the value is the PRE-decrement count:
      attempt 1 runs with retries_left = max (e.g. 2)
      attempt 2 runs with retries_left = 1   -> one more retry still remains
      attempt 3 runs with retries_left = 0   -> genuinely final, no re-enqueue
    The final execution is therefore the one with `retries_left == 0`; writing
    `failed` on any earlier attempt would wrongly drop the remaining retry.
    """
    job = get_current_job()
    if job is None:
        return True
    retries_left = getattr(job, "retries_left", None)
    if retries_left is None:
        # Defensive: unknown state -> behave as final attempt.
        return True
    return retries_left <= 0


def _update_status(admin, analysis_id: str, status: str, **extra) -> None:
    """Update the analysis row, guarded so a stale writer can't clobber a result.

    The final writes only apply if the row is still `processing` (i.e. owned by
    this attempt). A row already `completed`/`failed` by another worker is left
    untouched. A DB error here is logged (not raised) so the caller's own error
    handling / RQ retry path is preserved.
    """
    update = {"status": status, **extra}
    res = (
        admin.table("analyses")
        .update(update)
        .eq("id", analysis_id)
        .eq("status", "processing")
        .execute()
    )
    if getattr(res, "error", None):
        # The guarded write failed (e.g. row already finalised, or a transient
        # Postgres error). Don't raise — the job outcome is best-effort and the
        # reaper will catch genuinely stuck rows.
        traceback.print_exc()


def _maybe_delete_resume(storage_path: str) -> None:
    """Delete the resume from Storage if the setting is enabled (best-effort)."""
    if not get_settings().delete_resume_after_processing:
        return
    try:
        delete_resume(storage_path=storage_path)
    except Exception:  # noqa: BLE001 - cleanup must never mask the real result
        traceback.print_exc()


def process_analysis(*, analysis_id: str, storage_path: str, jd_text: str) -> dict:
    """
    Process one analysis job.

    Args:
        analysis_id: UUID of the analysis row to update.
        storage_path: Path of the resume PDF in Supabase Storage.
        jd_text: The job description text.

    Returns:
        The resulting MatchResult as a dict (also persisted to the DB).

    Raises:
        Re-raised exceptions so RQ can record the failure and retry if configured.
        On the final attempt the row is marked `failed` before re-raising.
    """
    admin = get_admin_client()

    # Guard against double-processing. RQ may redeliver a job after a worker
    # crash; if a previous attempt already finalised the row, skip it.
    current = (
        admin.table("analyses").select("status").eq("id", analysis_id).execute()
    )
    if getattr(current, "error", None):
        # Could not read current status; proceed and let the claim/update below
        # surface/guard the real outcome.
        traceback.print_exc()
    if not current.data:
        # The row vanished between enqueue and processing (e.g. deleted, or the
        # insert was rolled back). Don't crash the worker — just skip. There is
        # nothing to update and no PDF to process.
        return {"status": "missing", "skipped": True}
    existing_status = current.data[0]["status"]
    if existing_status in ("completed", "failed"):
        # Already finalised by a prior attempt; nothing to do.
        return {"status": existing_status, "skipped": True}

    try:
        # Atomically claim the row. Accept both `queued` and a `processing` row
        # that a crashed worker left behind (so it can be recovered), but never
        # re-claim an already-completed/failed row. If 0 rows are updated,
        # another worker owns it.
        claim = (
            admin.table("analyses")
            .update({"status": "processing"})
            .eq("id", analysis_id)
            .in_("status", ["queued", "processing"])
            .execute()
        )
        if getattr(claim, "error", None):
            # Could not claim the row (transient DB error). Don't proceed to
            # download/process; raise so RQ retries (or the reaper reclaims it).
            traceback.print_exc()
            raise RuntimeError(f"Failed to claim analysis row: {claim.error}")
        if not getattr(claim, "data", None):
            # Another worker already claimed/completed it; skip silently.
            return {"status": "processing", "skipped": True}
        pdf_bytes = download_resume(storage_path=storage_path)
        result = run_match(pdf_bytes=pdf_bytes, jd_text=jd_text)
        # Cap stored JSON size as a defence against unexpectedly large payloads.
        result_json = result.model_dump()
        encoded = json.dumps(result_json)
        if len(encoded) > 50_000:
            result_json = {
                "score": result.score,
                "matched_skills": result.matched_skills[:50],
                "missing_skills": result.missing_skills[:50],
                "rationale": result.rationale[:2000],
            }
        _update_status(
            admin,
            analysis_id,
            "completed",
            result_json=result_json,
            error_message=None,
            completed_at=_utcnow(),
        )
        # Only delete the PDF after a successful completion (and only when the
        # opt-in setting is enabled). Transient failures keep the file for retry.
        _maybe_delete_resume(storage_path)
        return result_json
    except Exception as exc:  # noqa: BLE001 - record failure on final attempt
        traceback.print_exc()
        if _is_last_attempt():
            # No more RQ retries: finalise the row as failed (guarded write so a
            # concurrent worker's good result isn't clobbered).
            _update_status(
                admin,
                analysis_id,
                "failed",
                error_message=str(exc)[:500],
                completed_at=_utcnow(),
            )
        # Re-raise so RQ records the failure and (if attempts remain) redelivers.
        # The PDF is intentionally NOT deleted here, so a retry can reprocess it.
        raise
