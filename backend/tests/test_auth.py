"""
Tests for the robust Supabase JWT verifier.

Covers both signing paths the backend must support:
  * HS256 with SUPABASE_JWT_SECRET (legacy projects / self-hosted)
  * ES256/RS256 via the project's JWKS endpoint (newer projects)
Plus the standard claim checks (iss, aud, exp, sub, role).
"""

from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core import jwt_verify
from app.core.jwt_verify import verify_supabase_jwt


def _rsa_keypair():
    """Generate an RS256 key pair + JWKS dict for mocking the JWKS endpoint."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    from jwt.algorithms import RSAAlgorithm
    import json as _json

    jwk = _json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = "test-kid"
    jwk["use"] = "sig"
    jwk["alg"] = "RS256"
    return private_pem, jwk


def _hs256_token(secret, *, sub="uid", exp=None, aud="authenticated", role="authenticated", iss="https://example.supabase.co/auth/v1"):
    return jwt.encode(
        {
            "sub": sub,
            "iss": iss,
            "aud": aud,
            "role": role,
            "exp": int(exp if exp is not None else time.time() + 3600),
        },
        secret,
        algorithm="HS256",
    )


def test_hs256_valid_token_verifies(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = _hs256_token(secret)
    claims = verify_supabase_jwt(token)
    assert claims["sub"] == "uid"


def test_hs256_wrong_audience_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = jwt.encode(
        {
            "sub": "uid",
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "something-else",
            "role": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        secret,
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_hs256_wrong_role_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = jwt.encode(
        {
            "sub": "uid",
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "anon",
            "exp": int(time.time()) + 3600,
        },
        secret,
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_hs256_wrong_issuer_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = jwt.encode(
        {
            "sub": "uid",
            "iss": "https://evil-project.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        secret,
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_es256_jwks_verification(override_settings):
    private_pem, jwk = _rsa_keypair()
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret="",  # force asymmetric path
    )
    token = jwt.encode(
        {
            "sub": "uid",
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )

    class _FakeJWKClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, _t):
            from jwt import PyJWK

            return PyJWK.from_dict(jwk)

    with pytest.MonkeyPatch().context() as mp:
        mp.setattr(jwt_verify, "_jwks_client", lambda: _FakeJWKClient())
        claims = verify_supabase_jwt(token)
    assert claims["sub"] == "uid"


def test_unsupported_algorithm_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = jwt.encode(
        {
            "sub": "uid",
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        secret,
        algorithm="HS384",
    )
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_expired_token_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = _hs256_token(secret, exp=time.time() - 10)
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_missing_sub_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = jwt.encode(
        {
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        secret,
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_missing_exp_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    token = jwt.encode(
        {
            "sub": "uid",
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
        },
        secret,
        algorithm="HS256",
    )
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)


def test_anon_audience_rejected(override_settings):
    secret = "jwt-secret-at-least-32-bytes-long-xxxxxxxxx"
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_secret=secret,
    )
    # Even a token that claims the "anon" audience must not be accepted.
    token = _hs256_token(secret, aud="anon", role="anon")
    with pytest.raises(jwt.PyJWTError):
        verify_supabase_jwt(token)
