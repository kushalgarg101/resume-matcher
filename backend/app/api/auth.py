"""
Auth dependency: validates the Supabase JWT sent by the frontend.

The Next.js frontend obtains a Supabase session JWT after email/password login
and sends it as `Authorization: Bearer <jwt>`. We verify the token locally in
`app.core.jwt_verify` which supports BOTH signing setups Supabase uses:

  * HS256 with the project's **JWT secret** (Supabase Dashboard -> API ->
    JWT Secret) — the legacy/self-hosted case, and
  * ES256/RS256 via the project's published JWKS keys — newer projects that use
    asymmetric "JWT Signing Keys".

The JWT secret (or JWKS public key) is the real signing material — NOT the anon
key, which is a public API key and must never be used to verify signatures.

We verify signature + expiry and check the `iss`/`aud`/``role`` claims to reject
tokens issued for a different project or non-authenticated sessions. The user id
(`sub`) is exposed for RLS-scoped DB access.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.jwt_verify import PyJWTError, verify_supabase_jwt

# auto_error=False so we can return a clean 401 instead of a 403 scheme popup.
_bearer = HTTPBearer(auto_error=False)


def _verify_jwt(token: str) -> dict:
    """
    Verify a Supabase user JWT and return its claims.

    Supports both HS256 (legacy JWT secret) and ES256/RS256 (JWKS) signing.
    Raises HTTPException(401) on any verification failure.
    """
    try:
        return verify_supabase_jwt(token)
    except PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """
    Dependency that returns the authenticated user's id (UUID string).

    Raises 401 if the header is missing or the token is invalid/expired.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    payload = _verify_jwt(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )
    return user_id
