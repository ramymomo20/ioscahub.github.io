from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg

try:
    from .config import settings
    from ios_bot.db.stats_moderation import ensure_stats_moderation_schema
except ImportError:
    # Allow direct module execution in non-package runtime contexts.
    from config import settings  # type: ignore
    from ios_bot.db.stats_moderation import ensure_stats_moderation_schema  # type: ignore


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        if self.pool is not None:
            return
        if not settings.db_url:
            raise RuntimeError("SUPABASE_DB_URL is not configured")

        async def _init_connection(connection: asyncpg.Connection) -> None:
            await connection.execute("SET search_path TO hub, public")

        self.pool = await asyncpg.create_pool(
            settings.db_url,
            min_size=2,
            max_size=12,
            command_timeout=90,
            statement_cache_size=0,
            init=_init_connection,
        )
        async with self.pool.acquire() as connection:
            await ensure_stats_moderation_schema(connection)

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
