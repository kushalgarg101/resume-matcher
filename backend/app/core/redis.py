"""
Redis / RQ connection helpers.

Redis is used purely as a job broker: the API enqueues analysis jobs and the
worker pops them. Only small job metadata (analysis id, storage path, JD text)
lives in Redis, so the 25 MB Render free tier is more than enough.

We keep a single module-level connection so both the enqueue path (in the API)
and the worker reuse one connection. This mirrors how RQ is normally wired.
"""

from __future__ import annotations

import redis
from rq import Queue

from app.core.config import get_settings

# Module-level handles, lazily created on first use.
_redis_connection: redis.Redis | None = None
_queue: Queue | None = None


def get_redis() -> redis.Redis:
    """Return a shared Redis connection (created once)."""
    global _redis_connection
    if _redis_connection is None:
        settings = get_settings()
        _redis_connection = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=False,
            socket_timeout=5,
            socket_connect_timeout=5,
        )
    return _redis_connection


def get_queue(name: str = "default") -> Queue:
    """
    Return the named RQ queue, creating the connection if needed.

    The API calls this to enqueue jobs; the worker calls `Queue(name)` with the
    same name via the RQ CLI so jobs line up on the same queue.

    We pass an explicit synchronous Redis connection and set `is_async=False` so
    the queue performs blocking writes on the API process (rq 2.x flipped the
    default to async and would otherwise `await` this sync connection and crash
    enqueue). The worker process uses the same sync semantics via the `rq worker`
    CLI.
    """
    global _queue
    if _queue is None:
        _queue = Queue(name, connection=get_redis(), is_async=False)
    return _queue
