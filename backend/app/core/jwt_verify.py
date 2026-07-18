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

import gzip
import json
import urllib.request
from typing import Any

import jwt
from jwt import PyJWTError
from jwt.algorithms import ECAlgorithm, RSAAlgorithm, Algorithm

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


# Cache fetched JWKS keys per issuer URL keyed by `kid`. PyJWT's PyJWKClient
# fetches the JWKS with urllib and calls json.load() on the raw response, which
# fails when the endpoint returns gzip-compressed bytes (UnicodeDecodeError on
# the gzip magic byte). We fetch + decompress the JWKS ourselves instead.
_jwks_cache: dict[str, dict[str, Any]] = {}


def _fetch_jwks(issuer: str) -> dict[str, Any]:
    """Fetch and (if needed) gunzip the project's JWKS document.

    Cached in-memory for the process lifetime (keys rarely rotate; the Supabase
    JWKS only changes on signing-key rotation). A gzip-compressed response is
    transparently decompressed so json parsing always sees plain JSON.
    """
    jwks_url = f"{issuer}/.well-known/jwks.json"
    cached = _jwks_cache.get(jwks_url)
    if cached is not None:
        return cached

    req = urllib.request.Request(
        jwks_url,
        headers={"User-Agent": "resume-matcher-api", "Accept-Encoding": "gzip"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
        # The response may arrive gzip-compressed even with no Accept-Encoding
        # hint, or because the server always gzips. Detect + decompress.
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        jwks = json.loads(raw.decode("utf-8"))

    _jwks_cache[jwks_url] = jwks
    return jwks


def _verify_asymmetric(token: str, issuer: str) -> dict[str, Any]:
    """Verify an ES256/RS256 token using the project's published JWKS keys."""
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise jwt.InvalidTokenError("JWT missing 'kid' header for asymmetric verification.")

    jwks = _fetch_jwks(issuer)
    key_dict = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key_dict is None:
        raise jwt.InvalidTokenError(f"No JWKS key found for kid={kid!r}.")

    kty = key_dict.get("kty")
    algo_cls: type[Algorithm]
    if kty == "RSA":
        algo_cls = RSAAlgorithm
    elif kty == "EC":
        algo_cls = ECAlgorithm
    else:
        raise jwt.InvalidTokenError(f"Unsupported JWKS key type: {kty!r}.")
    public_key = algo_cls.from_jwk(json.dumps(key_dict))
    return jwt.decode(
        token,
        public_key,
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
