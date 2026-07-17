"""Health / keep-alive endpoints used by external cron pingers."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/ping")
async def ping() -> dict[str, str]:
    """
    Ultra-light endpoint for keep-alive cron jobs (Render sleeps after 15 min
    of inactivity). Intentionally does no DB/Redis work.
    """
    return {"status": "ok"}


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Slightly richer health check used by Render's health check."""
    return {"status": "ok", "service": "resume-matcher-api"}
