from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.jobs.sync import sync_all_sources
from app.models.schemas import (
    JobListResponse,
    JobOut,
    JobSyncResult,
)

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

_auto_sync_done: bool = False


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _row_to_job(row: dict) -> JobOut:
    return JobOut(
        id=str(row.get("id", "")),
        source=row.get("source", ""),
        title=row.get("title", ""),
        company_name=row.get("company_name", ""),
        company_logo=row.get("company_logo"),
        location=row.get("location"),
        description=row.get("description"),
        requirements=row.get("requirements") or [],
        experience_level=row.get("experience_level"),
        employment_type=row.get("employment_type"),
        salary_min=row.get("salary_min"),
        salary_max=row.get("salary_max"),
        currency=row.get("currency"),
        application_url=row.get("application_url"),
        is_remote=row.get("is_remote", False),
        posted_at=row.get("posted_at"),
        created_at=row.get("created_at"),
    )


@router.get("", response_model=JobListResponse)
async def list_jobs(
    request: Request,
    q: str | None = Query(None, description="Search query"),
    source: str | None = Query(None, description="Source filter"),
    remote: bool | None = Query(None, description="Remote only"),
    location: str | None = Query(None, description="Location filter"),
    employment_type: str | None = Query(None, description="Comma-separated: full-time,part-time,contract"),
    experience_level: str | None = Query(None, description="entry,mid,senior,lead"),
    salary_min: float | None = Query(None, ge=0, description="Minimum salary"),
    salary_max: float | None = Query(None, ge=0, description="Maximum salary"),
    posted_within: str | None = Query(None, description="e.g. 7d, 30d"),
    sort: str | None = Query(None, description="date,salary"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    user_client = get_user_client(token)

    query = user_client.table("jobs").select("*", count="exact")

    if q:
        query = query.or_(f"title.ilike.%{q}%,company_name.ilike.%{q}%")
    if source:
        query = query.eq("source", source)
    if remote is not None:
        query = query.eq("is_remote", remote)
    if location:
        query = query.ilike("location", f"%{location}%")
    if employment_type:
        types = [t.strip() for t in employment_type.split(",") if t.strip()]
        if types:
            query = query.in_("employment_type", types)
    if experience_level:
        query = query.eq("experience_level", experience_level)
    if salary_min is not None and salary_max is not None:
        query = query.gte("salary_max", salary_min).lte("salary_min", salary_max)
    elif salary_min is not None:
        query = query.or_(f"salary_max.gte.{salary_min},salary_min.gte.{salary_min}")
    elif salary_max is not None:
        query = query.or_(f"salary_min.lte.{salary_max},salary_max.lte.{salary_max}")
    if posted_within:
        try:
            days = int(posted_within.rstrip("d"))
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            query = query.gte("posted_at", cutoff)
        except (ValueError, TypeError):
            pass

    if sort == "salary":
        query = query.order("salary_max", desc=True)
    else:
        query = query.order("created_at", desc=True)

    offset_val = (page - 1) * per_page
    res = query.range(offset_val, offset_val + per_page - 1).execute()

    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {res.error}")

    total = getattr(res, "count", 0) or len(res.data)

    global _auto_sync_done
    if total == 0 and not _auto_sync_done:
        _auto_sync_done = True
        sync_all_sources()
        res = query.range(offset_val, offset_val + per_page - 1).execute()
        if not getattr(res, "error", None):
            total = getattr(res, "count", 0) or len(res.data)

    jobs = [_row_to_job(r) for r in res.data]

    return JobListResponse(jobs=jobs, total=total, page=page, per_page=per_page)


@router.get("/saved", response_model=list[JobOut])
async def list_saved_jobs(
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("user_saved_jobs")
        .select("job_id, jobs(*)")
        .eq("user_id", user_id)
        .order("saved_at", desc=True)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {res.error}")

    jobs = []
    for r in res.data:
        job_data = r.get("jobs")
        if job_data:
            jobs.append(_row_to_job(job_data))
    return jobs


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("jobs")
        .select("*")
        .eq("id", job_id)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {res.error}")
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _row_to_job(res.data[0])


@router.post("/{job_id}/save", status_code=status.HTTP_204_NO_CONTENT)
async def save_job(
    job_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    user_client = get_user_client(token)

    job = user_client.table("jobs").select("id").eq("id", job_id).execute()
    if getattr(job, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {job.error}")
    if not job.data:
        raise HTTPException(status_code=404, detail="Job not found.")

    res = (
        user_client.table("user_saved_jobs")
        .insert({"user_id": user_id, "job_id": job_id})
        .execute()
    )
    if getattr(res, "error", None):
        if "23505" in str(res.error):
            return
        raise HTTPException(status_code=500, detail=f"Failed to save job: {res.error}")


@router.delete("/{job_id}/save", status_code=status.HTTP_204_NO_CONTENT)
async def unsave_job(
    job_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("user_saved_jobs")
        .delete()
        .eq("user_id", user_id)
        .eq("job_id", job_id)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"Failed to unsave job: {res.error}")


@router.post("/sync", response_model=JobSyncResult)
async def sync_jobs(
    user_id: str = Depends(get_current_user),
):
    try:
        return sync_all_sources()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
