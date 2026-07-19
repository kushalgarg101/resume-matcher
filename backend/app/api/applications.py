from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.models.schemas import (
    ApplicationCreate,
    ApplicationOut,
    ApplicationUpdate,
    BatchMatchRequest,
    BatchMatchResponse,
    CoverLetterRequest,
    CoverLetterResponse,
    JobMatchResult,
    profile_from_db,
)
from app.services.cover_letter import generate_cover_letter
from app.services.matcher_v2 import compute_match

router = APIRouter(prefix="/api", tags=["Applications"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _app_to_out(row: dict, job_row: dict | None = None) -> ApplicationOut:
    from app.models.schemas import JobOut

    job = None
    if job_row:
        job = JobOut(
            id=str(job_row.get("id", "")),
            source=job_row.get("source", ""),
            title=job_row.get("title", ""),
            company_name=job_row.get("company_name", ""),
            company_logo=job_row.get("company_logo"),
            location=job_row.get("location"),
            description=job_row.get("description"),
            requirements=job_row.get("requirements") or [],
            experience_level=job_row.get("experience_level"),
            employment_type=job_row.get("employment_type"),
            salary_min=job_row.get("salary_min"),
            salary_max=job_row.get("salary_max"),
            currency=job_row.get("currency"),
            application_url=job_row.get("application_url"),
            is_remote=job_row.get("is_remote", False),
            posted_at=job_row.get("posted_at"),
            created_at=job_row.get("created_at"),
        )
    return ApplicationOut(
        id=str(row.get("id", "")),
        job_id=str(row.get("job_id", "")),
        status=row.get("status", "draft"),
        cover_letter=row.get("cover_letter"),
        notes=row.get("notes"),
        tailored_resume_url=row.get("tailored_resume_url"),
        email_thread_id=row.get("email_thread_id"),
        match_score=row.get("match_score"),
        applied_at=row.get("applied_at"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        job=job,
    )


# ── Match ────────────────────────────────────────────────────────────────────


@router.get("/jobs/{job_id}/match", response_model=JobMatchResult)
async def get_job_match(
    job_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Compute a match score between the user's profile and a job."""
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
    profile = profile_res.data[0]

    # Get job
    job_res = (
        user_client.table("jobs")
        .select("*")
        .eq("id", job_id)
        .execute()
    )
    if getattr(job_res, "error", None) or not job_res.data:
        raise HTTPException(status_code=404, detail="Job not found.")

    result = compute_match(profile, job_res.data[0])
    return JobMatchResult(
        score=result["score"],
        breakdown=result["breakdown"],
        details=result["details"],
    )


# ── Batch Match ──────────────────────────────────────────────────────────────


@router.post("/jobs/match-batch", response_model=BatchMatchResponse)
async def batch_match_jobs(
    body: BatchMatchRequest,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Compute match scores for multiple jobs at once using the user's profile."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    profile_res = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(profile_res, "error", None) or not profile_res.data:
        raise HTTPException(status_code=404, detail="No profile found.")

    profile = profile_res.data[0]
    matches: dict[str, JobMatchResult] = {}

    for job_id in body.job_ids:
        job_res = (
            user_client.table("jobs")
            .select("*")
            .eq("id", job_id)
            .execute()
        )
        if getattr(job_res, "error", None) or not job_res.data:
            continue

        result = compute_match(profile, job_res.data[0])
        matches[job_id] = JobMatchResult(
            score=result["score"],
            breakdown=result["breakdown"],
            details=result["details"],
        )

    return BatchMatchResponse(matches=matches)


# ── Cover Letter ─────────────────────────────────────────────────────────────


@router.post("/cover-letter", response_model=CoverLetterResponse)
async def generate_cover_letter_endpoint(
    body: CoverLetterRequest,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Generate a tailored cover letter for a job."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    profile_res = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(profile_res, "error", None) or not profile_res.data:
        raise HTTPException(status_code=404, detail="No profile found.")
    profile = profile_from_db(profile_res.data[0])

    job_res = (
        user_client.table("jobs")
        .select("*")
        .eq("id", body.job_id)
        .execute()
    )
    if getattr(job_res, "error", None) or not job_res.data:
        raise HTTPException(status_code=404, detail="Job not found.")

    letter = generate_cover_letter(profile, job_res.data[0])
    return CoverLetterResponse(cover_letter=letter)


# ── Applications ─────────────────────────────────────────────────────────────


@router.get("/applications", response_model=list[ApplicationOut])
async def list_applications(
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """List the user's applications with job details."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("applications")
        .select("*, jobs(*)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {res.error}")

    apps = []
    for row in res.data:
        job_row = row.pop("jobs", None)
        apps.append(_app_to_out(row, job_row))
    return apps


@router.get("/applications/{application_id}", response_model=ApplicationOut)
async def get_application(
    application_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Get a single application."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("applications")
        .select("*, jobs(*)")
        .eq("id", application_id)
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        raise HTTPException(status_code=404, detail="Application not found.")
    row = res.data[0]
    job_row = row.pop("jobs", None)
    return _app_to_out(row, job_row)


@router.post("/applications", response_model=ApplicationOut, status_code=201)
async def create_application(
    body: ApplicationCreate,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Create a new application for a job."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    # Verify job exists
    job_res = (
        user_client.table("jobs")
        .select("*")
        .eq("id", body.job_id)
        .execute()
    )
    if getattr(job_res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {job_res.error}")
    if not job_res.data:
        raise HTTPException(status_code=404, detail="Job not found.")

    now = datetime.now(timezone.utc).isoformat()
    insert_data = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "job_id": body.job_id,
        "status": "applied",
        "cover_letter": body.cover_letter,
        "notes": body.notes,
        "applied_at": now,
    }

    res = (
        user_client.table("applications")
        .insert(insert_data)
        .execute()
    )
    if getattr(res, "error", None):
        if "23505" in str(res.error):
            raise HTTPException(status_code=409, detail="Already applied to this job.")
        raise HTTPException(status_code=500, detail=f"Failed to create application: {res.error}")
    if not res.data:
        raise HTTPException(status_code=500, detail="Application creation returned no row.")

    return _app_to_out(res.data[0], job_res.data[0])


@router.patch("/applications/{application_id}", response_model=ApplicationOut)
async def update_application(
    application_id: str,
    body: ApplicationUpdate,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Update application status, cover letter, or notes."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    update = body.model_dump(exclude_none=True, exclude_unset=True)
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update.")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = (
        user_client.table("applications")
        .update(update)
        .eq("id", application_id)
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        raise HTTPException(status_code=404, detail="Application not found.")

    row = res.data[0]
    job_res = (
        user_client.table("jobs")
        .select("*")
        .eq("id", row.get("job_id", ""))
        .execute()
    )
    if getattr(job_res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {job_res.error}")
    return _app_to_out(row, job_res.data[0] if job_res.data else None)
