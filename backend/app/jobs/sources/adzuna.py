from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.jobs.sources.base import JobSource, normalized_job

_COUNTRIES = ["gb", "us", "ca", "au", "de", "fr", "nl", "in"]


class AdzunaSource(JobSource):
    @property
    def name(self) -> str:
        return "adzuna"

    def fetch(self) -> list[dict[str, Any]]:
        settings = get_settings()
        app_id = settings.adzuna_app_id
        app_key = settings.adzuna_api_key
        if not app_id or not app_key:
            return []

        jobs: list[dict[str, Any]] = []
        seen: set[str] = set()
        for country in _COUNTRIES:
            try:
                resp = httpx.get(
                    f"https://api.adzuna.com/v1/api/jobs/{country}/search/1",
                    params={
                        "app_id": app_id,
                        "app_key": app_key,
                        "results_per_page": 50,
                        "content-type": "application/json",
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("results", []):
                    j = self._normalize(item, country)
                    if j and j["external_id"] not in seen:
                        seen.add(j["external_id"])
                        jobs.append(j)
            except Exception:
                continue
        return jobs

    def _normalize(self, item: dict[str, Any], country: str) -> dict[str, Any] | None:
        title = (item.get("title") or "").strip()
        company = (item.get("company", {}) or {}).get("display_name", "").strip()
        if not title or not company:
            return None

        salary_min: float | None = None
        salary_max: float | None = None
        currency: str | None = None
        if item.get("salary_min") is not None:
            salary_min = float(item["salary_min"])
        if item.get("salary_max") is not None:
            salary_max = float(item["salary_max"])
        if item.get("salary_currency"):
            currency = item["salary_currency"]

        emp_type = None
        if item.get("contract_type"):
            emp_type = item["contract_type"].lower()

        experience = None
        if item.get("category", {}).get("tag"):
            exp_map = {
                "entry": "entry", "graduate": "entry",
                "mid": "mid", "intermediate": "mid",
                "senior": "senior",
                "lead": "lead", "director": "lead",
            }
            tag = item["category"]["tag"].lower()
            for k, v in exp_map.items():
                if k in tag:
                    experience = v
                    break

        return normalized_job(
            external_id=f"{country}_{item.get('id', '')}",
            source=self.name,
            title=title,
            company_name=company,
            location=item.get("location", {}).get("display_name") if item.get("location") else None,
            description=item.get("description"),
            application_url=item.get("redirect_url"),
            employment_type=emp_type,
            experience_level=experience,
            salary_min=salary_min,
            salary_max=salary_max,
            currency=currency,
            posted_at=item.get("created"),
        )
