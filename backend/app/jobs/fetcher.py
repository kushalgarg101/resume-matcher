from __future__ import annotations

from app.jobs.sources import get_all_sources


def fetch_all_jobs() -> list[dict]:
    """Run every registered job source and return deduplicated results."""
    seen: set[str] = set()
    all_jobs: list[dict] = []

    for source in get_all_sources():
        try:
            jobs = source.fetch()
            for job in jobs:
                eid = job.get("external_id")
                src = job.get("source", "")
                if not eid or not src:
                    continue
                key = f"{src}:{eid}"
                if key not in seen:
                    seen.add(key)
                    all_jobs.append(job)
        except Exception:
            continue

    return all_jobs
