"""
FastAPI application entrypoint.

Wires together routers, CORS, and a lifespan hook. The actual business routers
(analyses) are included here; health is always available (no auth) so keep-alive
cron jobs keep the service warm.
"""

from __future__ import annotations

import asyncio
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import cors_origins_list, get_settings


_PERIODIC_SYNC_INTERVAL = 6 * 3600  # 6 hours


async def _periodic_sync():
    """Run job sync every 6 hours in the background."""
    while True:
        await asyncio.sleep(_PERIODIC_SYNC_INTERVAL)
        try:
            from app.jobs.sync import sync_all_sources

            result = await asyncio.to_thread(sync_all_sources)
            print(f"[periodic_sync] new={result.new} updated={result.updated} errors={len(result.errors)}")
        except Exception:
            traceback.print_exc()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    missing = [
        name
        for name, val in (
            ("SUPABASE_URL", settings.supabase_url),
            ("SUPABASE_ANON_KEY", settings.supabase_anon_key),
            ("SUPABASE_SERVICE_KEY", settings.supabase_service_key),
            ("GROQ_API_KEY", settings.groq_api_key),
        )
        if not val
    ]
    origins = cors_origins_list()
    if not origins:
        missing.append("CORS_ALLOW_ORIGINS (must include the frontend origin)")
    if missing:
        raise RuntimeError(
            "Refusing to start: missing required configuration: "
            + ", ".join(missing)
        )

    if settings.supabase_jwt_secret:
        print("JWT verification: HS256 (SUPABASE_JWT_SECRET) + JWKS fallback")
    else:
        print("JWT verification: JWKS (asymmetric ES256/RS256) only")

    sync_task = asyncio.create_task(_periodic_sync())
    print(f"[periodic_sync] scheduled every {_PERIODIC_SYNC_INTERVAL // 3600}h")

    yield

    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass


def create_app() -> FastAPI:
    """Application factory — keeps configuration explicit and testable."""
    app = FastAPI(
        title="Resume Matcher API",
        version="1.0.0",
        description="Scores how well a resume matches a job description using an LLM.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins_list(),
        # The frontend authenticates with a Bearer JWT only (no cookies), so we do
        # NOT send credentials. Keeping this False avoids the insecure
        # "allow any origin with credentials" footgun and is sufficient for the
        # Authorization-header flow used throughout the app.
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    from app.api.analyses import router as analyses_router

    app.include_router(analyses_router)

    from app.api.internal import router as internal_router

    app.include_router(internal_router)

    from app.api.profiles import router as profiles_router

    app.include_router(profiles_router)

    from app.api.chat import router as chat_router

    app.include_router(chat_router)

    from app.api.jobs import router as jobs_router

    app.include_router(jobs_router)

    from app.api.applications import router as applications_router

    app.include_router(applications_router)

    from app.api.planner import router as planner_router

    app.include_router(planner_router)

    from app.api.resume_tailor import router as resume_tailor_router

    app.include_router(resume_tailor_router)

    return app


app = create_app()
