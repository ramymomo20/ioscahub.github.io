from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg

try:
    from .config import settings
except ImportError:
    # Allow direct module execution in non-package runtime contexts.
    from config import settings  # type: ignore


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self.pool is not None:
            return
        if not settings.db_url:
            raise RuntimeError("SUPABASE_DB_URL is not configured")
        self.pool = await asyncpg.create_pool(
            settings.db_url,
            min_size=2,
            max_size=12,
            command_timeout=90,
            statement_cache_size=0,
        )

    async def disconnect(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[asyncpg.Connection]:
        if self.pool is None:
            raise RuntimeError("Database pool is not initialized")
        async with self.pool.acquire() as connection:
            yield connection


db = Database()
