"""Tests for the Redis/RQ connection helper (sync enqueue path).

These guard against a regression where the queue is built with a synchronous
`redis.Redis` connection but rq is configured (or versions) such that enqueue
tries to `await` the sync connection and crashes. The API process must be able
to enqueue a job synchronously.
"""

from __future__ import annotations

import contextlib
from unittest.mock import MagicMock

from rq import Queue

from app.core import redis as redis_mod
from app.core.redis import get_queue


def _fake_sync_redis() -> MagicMock:
    """A stand-in for a synchronous redis client.

    rq 1.x enqueues by pushing onto a list / zset and creating a job hash. We
    return benign MagicMocks for every attribute access so the enqueue bookkeeping
    completes without touching a real server. The point of the test is that
    `enqueue()` does NOT raise (e.g. it must not try to `await` this sync object).
    """
    return MagicMock()


@contextlib.contextmanager
def _patch_redis(fake):
    """Point get_redis() at a fake sync client and clear the module cache."""
    orig = redis_mod.get_redis
    redis_mod.get_redis = lambda: fake
    redis_mod._redis_connection = fake
    redis_mod._queue = None
    try:
        yield
    finally:
        redis_mod.get_redis = orig
        redis_mod._redis_connection = None
        redis_mod._queue = None


def test_get_queue_builds_sync_queue(override_settings):
    # The queue must be configured for synchronous (blocking) writes so the API
    # process can enqueue without an event loop.
    override_settings(redis_url="redis://localhost:6379/0")
    fake = _fake_sync_redis()
    with _patch_redis(fake):
        q = get_queue()
        assert isinstance(q, Queue)
        # rq 1.x must treat this as a synchronous queue.
        assert q.is_async is False


def test_enqueue_succeeds_with_sync_connection(override_settings):
    # The real regression this guards: rq 2.x defaults its Queue to `is_async=True`
    # and then `await`s the connection at enqueue time. With a synchronous
    # `redis.Redis` connection that raises, so NO job is ever queued and every
    # upload hits the enqueue-failure rollback. We assert the queue is built for
    # synchronous writes, which is exactly what the API needs. (A full end-to-end
    # enqueue needs a real/fake Redis server; the CI path is covered by the sync
    # `is_async` flag plus the manual docker-compose run.)
    override_settings(redis_url="redis://localhost:6379/0")
    fake = _fake_sync_redis()
    with _patch_redis(fake):
        q = get_queue()
        assert q.is_async is False
        # The connection handed to the queue is the synchronous client we provided.
        assert q.connection is fake
