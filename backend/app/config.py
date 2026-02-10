from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class Settings:
    app_name: str = os.getenv("IOSCA_HUB_APP_NAME", "IOSCA Hub API")
    app_env: str = os.getenv("IOSCA_HUB_ENV", "development")
    host: str = os.getenv("IOSCA_HUB_HOST", "0.0.0.0")
    port: int = int(os.getenv("IOSCA_HUB_PORT", "8080"))

    db_url: str | None = os.getenv("SUPABASE_DB_URL")

    cors_origins: list[str] = None  # type: ignore[assignment]

    websocket_enabled: bool = _as_bool(os.getenv("IOSCA_HUB_WS_ENABLED"), True)
    websocket_path: str = os.getenv("IOSCA_HUB_WS_PATH", "/ws/live")

    webhook_enabled: bool = _as_bool(os.getenv("IOSCA_HUB_WEBHOOK_ENABLED"), True)
    webhook_token: str | None = os.getenv("IOSCA_HUB_WEBHOOK_TOKEN")

    discord_bot_token: str | None = os.getenv("DISCORD_BOT_TOKEN")
    discord_invite_url: str | None = os.getenv("IOSCA_DISCORD_INVITE_URL")
    discord_rules_url: str | None = os.getenv("IOSCA_DISCORD_RULES_URL")
    discord_tutorial_url: str | None = os.getenv("IOSCA_DISCORD_TUTORIAL_URL")

    steam_api_key: str | None = os.getenv("STEAM_API_KEY")

    rcon_enabled: bool = _as_bool(os.getenv("IOSCA_HUB_RCON_ENABLED"), False)
    rcon_poll_interval_seconds: int = int(os.getenv("IOSCA_HUB_RCON_POLL_INTERVAL", "30"))

    def __post_init__(self) -> None:
        raw_origins = os.getenv("IOSCA_HUB_CORS_ORIGINS", "*")
        self.cors_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]


settings = Settings()
