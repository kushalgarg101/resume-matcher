"""
Supabase client factories.

We use TWO clients with very different privilege levels:

1. `get_admin_client()` — built with the **service_role** key. This client
   BYPASSES Row Level Security. It must ONLY be used inside the trusted worker
   process to update analysis results. Never return its data to unauthenticated
   callers.

2. `get_user_client(access_token)` — built with the anon key plus the calling
   user's JWT in the Authorization header. This client RESPECTS RLS, so it can
   only read/insert rows belonging to that user. Used by request handlers that
   act on behalf of an authenticated user.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_admin_client() -> Client:
    """
    Return a cached Supabase client with service_role privileges.

    Bypasses RLS. Use exclusively in the worker / trusted server context.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key)


def get_user_client(access_token: str) -> Client:
    """
    Return a Supabase client scoped to a specific user via their JWT.

    Row Level Security is enforced because we pass the user's bearer token in
    the `Authorization` header of every request (the official supabase-py
    pattern, see supabase-py issue #869). Queries are therefore limited to rows
    owned by `access_token`'s subject. A fresh client per request is required
    because the auth header is request-specific.
    """
    settings = get_settings()
    client = create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options={"headers": {"Authorization": f"Bearer {access_token}"}},
    )
    return client
