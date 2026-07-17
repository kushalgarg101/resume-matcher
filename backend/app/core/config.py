"""
Centralised application settings loaded from environment variables.

All secrets and environment-specific values are read here so the rest of the
codebase never touches os.environ directly. Values are provided via a `.env`
file (see `.env.example`) in local development and via Render's environment
variables in production.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application configuration.

    Attributes:
        model_config: Tells pydantic to load a local `.env` file.
        env: "development" or "production". Used to toggle debug behaviour.
        api_host / api_port: Bind address for the FastAPI/Uvicorn server.
        supabase_url: Project URL from Supabase (Settings -> API).
        supabase_anon_key: Public anon key. Safe to expose to the browser, but
            kept server-side here since the backend validates JWTs with it.
        supabase_service_key: service_role key. BYPASSES RLS — only ever used by
            the worker process to write results. Never expose publicly.
        supabase_storage_bucket: Name of the private storage bucket for resumes.
        redis_url: Redis connection URL (Render provides this as REDIS_URL).
        groq_api_key: API key from console.groq.com (free tier, no card).
        groq_model: Model id to use for scoring. Not hardcoded — pick based on
            your rate-limit / quality tradeoff (see ARCHITECTURE.md).
            e.g. "llama-3.1-8b-instant" (14.4K req/day) or
                 "llama-3.3-70b-versatile" (1K req/day, stronger reasoning).
        groq_request_timeout: Per-request timeout (seconds) for Groq calls.
        groq_max_retries: Max attempts on 429/5xx before giving up.
        max_pdf_bytes: Reject uploads larger than this (Render free RAM is 512MB).
        cors_allow_origins: Comma-separated list of allowed frontend origins.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 10000

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    # JWT signing secret for Supabase user tokens (Dashboard -> API settings ->
    # JWT Secret). This is NOT the anon key. Used to verify incoming tokens.
    supabase_jwt_secret: str = ""
    supabase_storage_bucket: str = "resumes"

    redis_url: str = "redis://localhost:6379/0"

    groq_api_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"
    groq_request_timeout: float = 30.0
    groq_max_retries: int = 4

    max_pdf_bytes: int = 5 * 1024 * 1024  # 5 MB

    # If true, the worker deletes the resume PDF from Storage after processing
    # (success or final failure) to bound free-tier storage growth. Off by
    # default so you can keep resumes for debugging/re-processing.
    delete_resume_after_processing: bool = False

    cors_allow_origins: str = "http://localhost:3000"

    # Shared secret for internal/admin endpoints (e.g. the stuck-row reaper).
    # Not a user credential — only the keepalive cron (or an operator) should
    # know it. Left blank in local dev disables auth on /internal/* (dev only).
    internal_api_key: str = ""


# Module-level override slot. When set (by tests via `set_settings`), every
# call to `get_settings()` returns this instance instead of building a new one.
_custom_settings: Settings | None = None


@lru_cache
def get_settings() -> Settings:
    """
    Return a cached Settings instance.

    Using a cached getter avoids re-reading and re-parsing environment
    variables on every request and keeps a single source of truth. If a test
    has injected an override via `set_settings`, that instance is returned.
    """
    if _custom_settings is not None:
        return _custom_settings
    return Settings()


def set_settings(instance: Settings) -> Settings:
    """
    Override the Settings instance returned by `get_settings` (test helper).

    Args:
        instance: A `Settings` object to return from `get_settings`.

    Returns:
        The same instance. Restore real config by calling `clear_settings()`.
    """
    global _custom_settings
    get_settings.cache_clear()
    _custom_settings = instance
    return instance


def clear_settings() -> None:
    """Remove any injected override and clear the lru_cache."""
    global _custom_settings
    _custom_settings = None
    get_settings.cache_clear()


def cors_origins_list() -> list[str]:
    """Parse the comma-separated CORS origin string into a list."""
    return [o.strip() for o in get_settings().cors_allow_origins.split(",") if o.strip()]
