"""
FastAPI application entrypoint.

Wires together routers, CORS, and a lifespan hook. The actual business routers
(analyses) are included here; health is always available (no auth) so keep-alive
cron jobs keep the service warm.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import cors_origins_list, get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast on missing required configuration. Without these the service is
    # non-functional (every request 401s, or the frontend is blocked by CORS),
    # so it is better to crash at boot where Render surfaces the error clearly
    # than to silently serve a broken API.
    settings = get_settings()
    # NOTE: SUPABASE_JWT_SECRET is intentionally NOT required here. Newer
    # Supabase projects use asymmetric "JWT Signing Keys" (ES256/RS256) and
    # verify tokens via the published JWKS endpoint instead — in that case the
    # legacy JWT secret is empty and the service must still boot. The runtime
    # verifier (`app.core.jwt_verify`) rejects an HS256 token only when the
    # secret is missing, so there is nothing to fail-fast on at boot.
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
    # Surface which JWT verification path is active (informational only).
    if settings.supabase_jwt_secret:
        print("JWT verification: HS256 (SUPABASE_JWT_SECRET) + JWKS fallback")
    else:
        print("JWT verification: JWKS (asymmetric ES256/RS256) only")
    yield


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
    # Analyses router is mounted in Phase 4 (after services exist).

    from app.api.internal import router as internal_router

    app.include_router(internal_router)

    return app


app = create_app()
