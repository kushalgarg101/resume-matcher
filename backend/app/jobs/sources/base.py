from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class JobSource(ABC):
    """Abstract base for a job source. Each subclass fetches jobs from one
    provider (RSS feed, REST API, etc.) and returns a list of normalized dicts."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    def fetch(self) -> list[dict[str, Any]]:
        ...


def normalized_job(
    *,
    external_id: str,
    source: str,
    title: str,
    company_name: str,
    company_logo: str | None = None,
    location: str | None = None,
    description: str | None = None,
    application_url: str | None = None,
    employment_type: str | None = None,
    experience_level: str | None = None,
    salary_min: float | None = None,
    salary_max: float | None = None,
    currency: str | None = None,
    is_remote: bool = False,
    posted_at: str | None = None,
) -> dict[str, Any]:
    return {
        "external_id": external_id,
        "source": source,
        "title": title,
        "company_name": company_name,
        "company_logo": company_logo,
        "location": location,
        "description": description[:10000] if description else None,
        "application_url": application_url,
        "employment_type": employment_type,
        "experience_level": experience_level,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "currency": currency,
        "is_remote": is_remote,
        "posted_at": posted_at,
    }
