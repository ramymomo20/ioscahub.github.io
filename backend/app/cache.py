from __future__ import annotations

import json
import time
from typing import Any

from . import config

try:
    from redis.asyncio import Redis
except ImportError:  # pragma: no cover - optional dependency
    Redis = None  # type: ignore[assignment]

_LOCAL_CACHE: dict[str, tuple[float, str]] = {}


async def create_redis_client() -> Redis | None:
    if not config.REDIS_URL:
        return None
    if Redis is None:
        raise RuntimeError("HUB_REDIS_URL is set but the redis package is not installed")
    return Redis.from_url(config.REDIS_URL, decode_responses=True)


async def close_redis_client(client: Redis | None) -> None:
    if client is None:
        return
    await client.aclose()


async def get_json(client: Redis | None, key: str) -> Any | None:
    if client is None:
        cached = _LOCAL_CACHE.get(key)
        if cached is None:
            return None
        expires_at, payload = cached
        if expires_at < time.monotonic():
            _LOCAL_CACHE.pop(key, None)
            return None
        return json.loads(payload)
    try:
        payload = await client.get(key)
    except Exception:  # pragma: no cover - cache should fail open
        return None
    if payload is None:
        return None
    return json.loads(payload)


async def set_json(client: Redis | None, key: str, value: Any, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    payload = json.dumps(value)
    if client is None:
        _LOCAL_CACHE[key] = (time.monotonic() + ttl_seconds, payload)
        return
    try:
        await client.set(key, payload, ex=ttl_seconds)
    except Exception:  # pragma: no cover - cache should fail open
        return
