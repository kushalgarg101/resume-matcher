from __future__ import annotations

from typing import Any

import httpx

from app.jobs.sources.base import JobSource, normalized_job

_API_URL = "https://www.arbeitnow.com/api/job-board-api"


class ArbeitnowSource(JobSource):
    @property
    def name(self) -> str:
        return "arbeitnow"

    def fetch(self) -> list[dict[str, Any]]:
        try:
            resp = httpx.get(_API_URL, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            return []

        jobs: list[dict[str, Any]] = []
        for item in data.get("data", []):
            job = self._normalize(item)
            if job:
                jobs.append(job)
        return jobs

    def _normalize(self, item: dict[str, Any]) -> dict[str, Any] | None:
        title = (item.get("title") or "").strip()
        company = (item.get("company_name") or "").strip()
        if not title or not company:
            return None

        location = item.get("location")
        if not location or not isinstance(location, str) or len(location.strip()) < 2:
            location = None
        else:
            location = location.strip()

        employment_type = None
        if item.get("job_types"):
            employment_type = item["job_types"][0].lower()

        return normalized_job(
            external_id=str(item.get("slug", "")),
            source=self.name,
            title=title,
            company_name=company,
            company_logo=item.get("company_logo"),
            location=location,
            description=item.get("description"),
            application_url=item.get("url"),
            employment_type=employment_type,
            is_remote=True,
            posted_at=item.get("created_at"),
        )
