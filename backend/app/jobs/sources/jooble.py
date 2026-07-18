from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.jobs.sources.base import JobSource, normalized_job


class JoobleSource(JobSource):
    @property
    def name(self) -> str:
        return "jooble"

    def fetch(self) -> list[dict[str, Any]]:
        key = get_settings().jooble_api_key
        if not key:
            return []

        jobs: list[dict[str, Any]] = []
        seen: set[str] = set()
        for keywords in ["software engineer", "developer", "data scientist", "designer", "product manager"]:
            try:
                resp = httpx.post(
                    f"https://jooble.org/api/{key}",
                    json={"keywords": keywords, "location": "", "page": "1", "resultsonpage": "20"},
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("jobs", []):
                    j = self._normalize(item)
                    if j and j["external_id"] not in seen:
                        seen.add(j["external_id"])
                        jobs.append(j)
            except Exception:
                continue
        return jobs

    def _normalize(self, item: dict[str, Any]) -> dict[str, Any] | None:
        title = (item.get("title") or "").strip()
        company = (item.get("company") or "").strip()
        if not title or not company:
            return None

        salary_str = (item.get("salary") or "").strip()
        salary_min: float | None = None
        salary_max: float | None = None
        currency: str | None = None

        def _parse_salary_part(s: str) -> float | None:
            s = s.strip().lstrip("€£₹$").replace(",", "")
            if not s:
                return None
            multiplier = 1
            if s.upper().endswith("K"):
                multiplier = 1000
                s = s[:-1]
            if s.upper().endswith("M"):
                multiplier = 1_000_000
                s = s[:-1]
            try:
                return float(s) * multiplier
            except (ValueError, TypeError):
                return None

        if salary_str and "-" in salary_str:
            parts = salary_str.split("-", 1)
            raw_min = parts[0].strip().split()[0] if parts[0].strip() else ""
            raw_max = parts[1].strip().split()[0] if len(parts) > 1 and parts[1].strip() else ""
            salary_min = _parse_salary_part(raw_min)
            salary_max = _parse_salary_part(raw_max)
            words = salary_str.split()
            for w in reversed(words):
                wc = w.strip(".,!?")
                if wc.isalpha() and len(wc) <= 3:
                    currency = wc.upper()
                    break

        emp_type = (item.get("type") or "").strip().lower() or None

        return normalized_job(
            external_id=str(item.get("id", "")),
            source=self.name,
            title=title,
            company_name=company,
            location=item.get("location"),
            description=item.get("snippet"),
            application_url=item.get("link"),
            employment_type=emp_type,
            salary_min=salary_min,
            salary_max=salary_max,
            currency=currency,
            posted_at=item.get("updated"),
        )
