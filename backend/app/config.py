from __future__ import annotations

import os
import re
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = Path(__file__).resolve().parents[1]

load_dotenv(ROOT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default)).strip()


def _schema_ident(name: str, default: str) -> str:
    value = _env(name, default)
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise RuntimeError(f"{name} must be a valid PostgreSQL schema identifier")
    return value


def postgres_dsn() -> str:
    dsn = _env("SUPABASE_DB_URL") or _env("SUPABASE_POOLER_URL")
    if not dsn:
        raise RuntimeError("SUPABASE_DB_URL or SUPABASE_POOLER_URL is required")
    return dsn


API_TITLE = _env("IOSCA_HUB_API_TITLE", "IOSCA Hub API")
API_VERSION = _env("IOSCA_HUB_API_VERSION", "0.1.0")
POSTGRES_POOL_MIN_SIZE = int(_env("HUB_POSTGRES_POOL_MIN_SIZE", "1"))
POSTGRES_POOL_MAX_SIZE = int(_env("HUB_POSTGRES_POOL_MAX_SIZE", "5"))
HUB_POSTGRES_SCHEMA = _schema_ident("HUB_POSTGRES_SCHEMA", "iosca_hub_production")
HUB_DB_QUERY_TIMEOUT_SECONDS = int(_env("HUB_DB_QUERY_TIMEOUT_SECONDS", "15"))
REDIS_URL = _env("HUB_REDIS_URL") or _env("REDIS_URL") or _env("UPSTASH_REDIS_URL")
REDIS_KEY_PREFIX = _env("HUB_REDIS_KEY_PREFIX", "iosca-hub")
API_CACHE_TTL_SECONDS = int(_env("HUB_API_CACHE_TTL_SECONDS", "60"))
SUMMARY_CACHE_TTL_SECONDS = int(_env("HUB_SUMMARY_CACHE_TTL_SECONDS", "120"))
BOOTSTRAP_CACHE_TTL_SECONDS = int(_env("HUB_BOOTSTRAP_CACHE_TTL_SECONDS", "180"))
HUB_LIVE_DATA_TIMEZONE = _env("HUB_LIVE_DATA_TIMEZONE", _env("MAIN_GUILD_TIMEZONE", "America/New_York"))
