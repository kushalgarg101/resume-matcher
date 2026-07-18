"""Tests for Supabase client factories (RLS scoping + admin privilege)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.core.supabase import get_user_client


def test_get_user_client_attaches_bearer_header(override_settings):
    """The user-scoped client must send the JWT so RLS applies."""
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
    )
    fake = MagicMock()
    with patch("app.core.supabase.create_client", return_value=fake) as factory:
        get_user_client("my.jwt.token")
    # create_client called with the token in the options headers.
    _, kwargs = factory.call_args
    opts = kwargs.get("options")
    assert opts is not None
    assert opts.headers["Authorization"] == "Bearer my.jwt.token"


def test_get_admin_client_uses_service_key(override_settings):
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_service_key="svc-secret",
    )
    from app.core.supabase import get_admin_client

    fake = MagicMock()
    with patch("app.core.supabase.create_client", return_value=fake) as factory:
        get_admin_client()
    args, _ = factory.call_args
    assert args[1] == "svc-secret"
