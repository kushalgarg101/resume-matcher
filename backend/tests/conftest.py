"""Pytest configuration and shared fixtures."""

from __future__ import annotations

import pytest

from app.core.config import Settings


@pytest.fixture
def override_settings():
    """
    Provide a Settings instance for a test and restore the cache afterwards.

    Usage:
        def test_x(override_settings):
            override_settings(Settings(supabase_url="http://test"))
    """
    instances: list[Settings] = []

    def _set(**kwargs: object) -> Settings:
        instance = Settings(**kwargs)  # type: ignore[arg-type]
        from app.core.config import set_settings

        set_settings(instance)
        instances.append(instance)
        return instance

    yield _set
    from app.core.config import clear_settings

    clear_settings()
    # Supabase admin client and Redis queue are also lru_cached; clear them so a
    # mocked config does not leak across tests.
    from app.core import supabase as supabase_mod

    supabase_mod.get_admin_client.cache_clear()
    try:
        from app.core import redis as redis_mod

        redis_mod._redis_connection = None
        if redis_mod._queue is not None:
            redis_mod._queue = None
    except Exception:
        pass
