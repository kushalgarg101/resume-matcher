from __future__ import annotations

from typing import Any

from app.core.supabase import get_admin_client
from app.jobs.fetcher import fetch_all_jobs
from app.models.schemas import JobSyncResult


def sync_all_sources() -> JobSyncResult:
    """Fetch jobs from all configured sources and upsert into the DB."""
    admin = get_admin_client()
    result = JobSyncResult()

    try:
        jobs = fetch_all_jobs()
    except Exception as exc:
        result.errors.append(f"fetch_all_jobs failed: {exc}")
        return result

    for job in jobs:
        _upsert_job(admin, job, result)

    return result


def _upsert_job(admin, job: dict[str, Any], result: JobSyncResult) -> None:
    external_id = job.get("external_id")
    source = job.get("source", "rss")
    title = job.get("title", "").strip()
    company = job.get("company_name", "").strip()

    if not external_id or not title or not company:
        result.errors.append(f"Skipping job with missing fields: {title} @ {company}")
        return

    existing = (
        admin.table("jobs")
        .select("id")
        .eq("external_id", external_id)
        .eq("source", source)
        .execute()
    )

    insert_data = {
        "external_id": external_id,
        "source": source,
        "title": title,
        "company_name": company,
        "company_logo": job.get("company_logo"),
        "location": job.get("location"),
        "description": job.get("description"),
        "application_url": job.get("application_url"),
        "employment_type": job.get("employment_type"),
        "experience_level": job.get("experience_level"),
        "salary_min": job.get("salary_min"),
        "salary_max": job.get("salary_max"),
        "currency": job.get("currency"),
        "is_remote": job.get("is_remote", False),
        "posted_at": job.get("posted_at"),
    }

    if existing.data:
        res = admin.table("jobs").update(insert_data).eq("id", existing.data[0].get("id", "")).execute()
        if getattr(res, "error", None):
            result.errors.append(f"Failed to update {title} @ {company}: {res.error}")
        else:
            result.updated += 1
    else:
        res = admin.table("jobs").insert(insert_data).execute()
        if getattr(res, "error", None):
            result.errors.append(f"Failed to insert {title} @ {company}: {res.error}")
        else:
            result.new += 1
