"""
Supabase JWT verification — robust across signing setups.

Supabase issues short-lived user access tokens (HS256 with the legacy JWT
secret, or asymmetric ES256/RS256 via "JWT Signing Keys" on newer projects).
We must verify incoming tokens in BOTH cases:

1. HS256: sign/verify with the project's ``SUPABASE_JWT_SECRET`` (the legacy
   signing secret). This is still present on most projects and is what many
   self-hosted / older projects use.
2. ES256/RS256: newer projects publish public keys at
   ``<SUPABASE_URL>/auth/v1/.well-known/jwks.json``. We fetch the matching key
   by ``kid`` and verify with it.

We always validate the standard Supabase claims:
  * ``iss``  = ``<SUPABASE_URL>/auth/v1``            (reject other projects)
  * ``aud``  = ``"authenticated"``                      (reject other audiences)
  * ``exp``  present and not expired                 (require + check)
  * ``sub``  present                                  (require; user id)
  * ``role`` = ``"authenticated"``                    (reject anon/service_role)

Credentials refresh (RS256/ES256 public keys) is fetched lazily and cached by
``kid`` so we don't hit the JWKS endpoint on every request.
"""

from __future__ import annotations

from typing import Any

import jwt
from jwt import PyJWKClient, PyJWTError

from app.core.config import get_settings


# The backend API only ever accepts fully-authenticated user tokens. We do NOT
# accept the "anon" audience — anonymous sessions must not call protected routes.
_EXPECTED_AUDIENCES = {"authenticated"}


def _normalise_issuer(supabase_url: str) -> str:
    """Return the issuer claim Supabase uses for auth tokens."""
    base = supabase_url.rstrip("/")
    if base.endswith("/auth/v1"):
        return base
    return f"{base}/auth/v1"


# Cache the JWKS client per issuer URL so the `kid` key cache is shared across
# requests (a fresh client per call would re-fetch the JWKS document each time).
_jwks_clients: dict[str, PyJWKClient] = {}


def _jwks_client() -> PyJWKClient:
    """Return a (cached) PyJWKClient for the project's JWKS endpoint."""
    settings = get_settings()
    jwks_url = f"{_normalise_issuer(settings.supabase_url)}/.well-known/jwks.json"
    cached = _jwks_clients.get(jwks_url)
    if cached is None:
        # cache_keys=True keeps fetched keys in memory keyed by kid. We attach a
        # requests.Session with an explicit timeout so a slow/hung JWKS endpoint
        # cannot block the request thread indefinitely (availability guard).
        import requests

        session = requests.Session()
        session.headers.update({"User-Agent": "resume-matcher-api"})
        cached = PyJWKClient(
            jwks_url,
            cache_keys=True,
            lifespan=600,
            headers=session.headers,
            timeout=10,
        )
        _jwks_clients[jwks_url] = cached
    return cached


def _verify_asymmetric(token: str, issuer: str) -> dict[str, Any]:
    """Verify an ES256/RS256 token using the project's published JWKS keys."""
    client = _jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256"],
        issuer=issuer,
        audience=list(_EXPECTED_AUDIENCES),
        options={"require": ["exp", "sub"]},
    )


def _verify_symmetric(token: str, issuer: str, secret: str) -> dict[str, Any]:
    """Verify an HS256 token using the legacy JWT secret."""
    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        issuer=issuer,
        audience=list(_EXPECTED_AUDIENCES),
        options={"require": ["exp", "sub"]},
    )


def verify_supabase_jwt(token: str) -> dict[str, Any]:
    """
    Verify a Supabase user JWT and return its claims.

    Picks HS256 (when ``SUPABASE_JWT_SECRET`` is configured) or JWKS-based
    asymmetric verification (ES256/RS256) based on the token's ``alg`` header.

    Raises:
        jwt.PyJWTError: If the token is invalid, expired, or from another
            project — callers should map this to HTTP 401.
    """
    settings = get_settings()
    issuer = _normalise_issuer(settings.supabase_url)

    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")

    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError(
                "Token is HS256 but SUPABASE_JWT_SECRET is not configured."
            )
        claims = _verify_symmetric(token, issuer, settings.supabase_jwt_secret)
    elif alg in ("ES256", "RS256"):
        claims = _verify_asymmetric(token, issuer)
    else:
        raise jwt.InvalidTokenError(f"Unsupported JWT algorithm: {alg!r}")

    # Extra guard: only fully-authenticated sessions may use the API.
    if claims.get("role") != "authenticated":
        raise jwt.InvalidTokenError(
            f"Token role must be 'authenticated', got {claims.get('role')!r}."
        )
    return claims


__all__ = ["verify_supabase_jwt", "PyJWTError"]
