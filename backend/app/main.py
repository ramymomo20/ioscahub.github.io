from __future__ import annotations

import asyncio
import json
import math
import re
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from decimal import Decimal
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

try:
    from .config import settings
    from .db import db
except ImportError:
    # Allow running this module directly (python main.py) in environments
    # where package-relative imports are not available.
    from config import settings  # type: ignore
    from db import db  # type: ignore

try:
    from rcon.source import Client as RconClient
    RCON_AVAILABLE = True
except Exception:
    RconClient = None
    RCON_AVAILABLE = False

try:
    import a2s
    A2S_AVAILABLE = True
except Exception:
    a2s = None
    A2S_AVAILABLE = False

JS_MAX_SAFE_INTEGER = 9007199254740991
STEAM_ID64_BASE = 76561197960265728
STEAM_PROFILE_CACHE_TTL_SECONDS = 1800
_steam_profile_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _to_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, Decimal):
        if value.is_nan():
            return None
        return float(value)
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, int) and abs(value) > JS_MAX_SAFE_INTEGER:
        return str(value)
    if isinstance(value, str) and value.strip().lower() == "nan":
        return None
    return value


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _json_safe(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return _to_iso(value)


def _record_to_dict(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    payload = dict(row)
    for key, value in list(payload.items()):
        payload[key] = _json_safe(value)
    return payload


def _safe_minutes(values: Any) -> list[int]:
    if not isinstance(values, list):
        return []
    out: list[int] = []
    for value in values:
        try:
            minute = int(float(value))
        except Exception:
            continue
        if minute > 0:
            out.append(minute)
    return sorted(set(out))


def _player_event_minutes(player_row: dict[str, Any], keys: list[str]) -> list[int]:
    raw = player_row.get("event_timestamps") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        return []
    for key in keys:
        mins = _safe_minutes(raw.get(key))
        if mins:
            return mins
    return []


def _norm_text_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _steam_aliases(steam_id: Any) -> set[str]:
    raw = str(steam_id or "").strip()
    if not raw:
        return set()
    aliases = {raw.lower()}
    steam64 = _steam_to_steam64(raw)
    if steam64:
        aliases.add(str(steam64))
    return aliases


def _extract_lineup_identity_sets(lineup_data: Any) -> dict[str, set[str]]:
    steam_keys: set[str] = set()
    name_keys: set[str] = set()

    if not isinstance(lineup_data, list):
        return {"steam": steam_keys, "name": name_keys}

    for item in lineup_data:
        started = True
        player_name = ""
        steam_id = ""

        if isinstance(item, list) and len(item) >= 3:
            started = bool(item[3]) if len(item) >= 4 else True
            player_name = str(item[1] or item[2] or "").strip()
            steam_id = str(item[2] or "").strip()
        elif isinstance(item, dict):
            started = True if item.get("started") is None else bool(item.get("started"))
            player_name = str(
                item.get("name")
                or item.get("player_name")
                or item.get("discord_name")
                or item.get("player")
                or item.get("steam_id")
                or ""
            ).strip()
            steam_id = str(item.get("steam_id") or item.get("steamId") or "").strip()

        if not started:
            continue

        for alias in _steam_aliases(steam_id):
            steam_keys.add(alias)

        name_key = _norm_text_key(player_name)
        if name_key:
            name_keys.add(name_key)

    return {"steam": steam_keys, "name": name_keys}


def _infer_side_from_lineup(
    player_row: dict[str, Any],
    home_keys: dict[str, set[str]],
    away_keys: dict[str, set[str]],
) -> str:
    aliases = _steam_aliases(player_row.get("steam_id"))
    player_name_key = _norm_text_key(player_row.get("player_name") or player_row.get("steam_id"))

    if (aliases and aliases.intersection(home_keys["steam"])) or (player_name_key and player_name_key in home_keys["name"]):
        return "home"
    if (aliases and aliases.intersection(away_keys["steam"])) or (player_name_key and player_name_key in away_keys["name"]):
        return "away"
    return "neutral"


def _build_team_event_items(team_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for row in team_rows:
        name = str(row.get("player_name") or row.get("steam_id") or "Unknown").strip() or "Unknown"

        # Goals
        goal_minutes = _player_event_minutes(row, ["goal", "goals"])
        if goal_minutes:
            events.append({"kind": "goal", "name": name, "minutes": goal_minutes, "count": len(goal_minutes), "sort_minute": goal_minutes[0]})
        else:
            count = int(row.get("goals") or 0)
            if count > 0:
                events.append({"kind": "goal", "name": name, "minutes": [], "count": count, "sort_minute": 999})

        # Yellow cards
        yellow_minutes = _player_event_minutes(row, ["yellow", "yellow_card", "yellow_cards"])
        if yellow_minutes:
            events.append({"kind": "yellow", "name": name, "minutes": yellow_minutes, "count": len(yellow_minutes), "sort_minute": yellow_minutes[0]})
        else:
            count = int(row.get("yellow_cards") or row.get("yellowCards") or 0)
            if count > 0:
                events.append({"kind": "yellow", "name": name, "minutes": [], "count": count, "sort_minute": 999})

        # Red cards
        red_minutes = _player_event_minutes(row, ["red", "red_card", "red_cards"])
        if red_minutes:
            events.append({"kind": "red", "name": name, "minutes": red_minutes, "count": len(red_minutes), "sort_minute": red_minutes[0]})
        else:
            count = int(row.get("red_cards") or row.get("redCards") or 0)
            if count > 0:
                events.append({"kind": "red", "name": name, "minutes": [], "count": count, "sort_minute": 999})

    events.sort(key=lambda item: (int(item.get("sort_minute") or 999), str(item.get("name") or "").lower()))
    return events[:20]


def _records_to_dicts(rows: list[Any]) -> list[dict[str, Any]]:
    return [_record_to_dict(row) for row in rows]


def _parse_json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return fallback
    return fallback


def _default_discord_avatar(discord_id: Any) -> str:
    try:
        seed = int(str(discord_id)) % 5
    except Exception:
        seed = 0
    return f"https://cdn.discordapp.com/embed/avatars/{seed}.png"


def _discord_avatar_url(discord_id: Any) -> str:
    if discord_id is None:
        return _default_discord_avatar(discord_id)
    raw = str(discord_id).strip()
    if not raw:
        return _default_discord_avatar(discord_id)
    return f"https://unavatar.io/discord/{raw}"


def _steam_profile_url(steam_id: str | None) -> str | None:
    if not steam_id:
        return None
    steam64 = _steam_to_steam64(steam_id)
    if steam64:
        return f"https://steamcommunity.com/profiles/{steam64}"
    sid = str(steam_id).strip()
    return f"https://steamcommunity.com/search/users/#text={sid}"


def _steam_avatar_proxy_url(steam64: Any) -> str | None:
    raw = str(steam64 or "").strip()
    if not raw:
        return None
    return f"https://unavatar.io/steam/{raw}"


def _steam_to_steam64(steam_id: Any) -> str | None:
    raw = str(steam_id or "").strip()
    if not raw:
        return None
    if raw.isdigit() and len(raw) >= 16:
        return raw

    # STEAM_X:Y:Z -> 64-bit ID
    match = re.match(r"^STEAM_[0-5]:([0-1]):(\d+)$", raw, flags=re.IGNORECASE)
    if match:
        y = int(match.group(1))
        z = int(match.group(2))
        return str(STEAM_ID64_BASE + (z * 2) + y)

    # [U:1:Z] -> 64-bit ID
    match = re.match(r"^\[U:1:(\d+)\]$", raw, flags=re.IGNORECASE)
    if match:
        account_id = int(match.group(1))
        return str(STEAM_ID64_BASE + account_id)

    return None


def _fetch_steam_profile_xml_sync(steam64: str) -> dict[str, Any]:
    url = f"https://steamcommunity.com/profiles/{steam64}/?xml=1"
    try:
        resp = requests.get(url, timeout=4)
        if resp.status_code != 200 or not resp.text:
            return {}
        root = ET.fromstring(resp.text)
    except Exception:
        return {}

    def _text(tag: str) -> str | None:
        node = root.find(tag)
        if node is None or node.text is None:
            return None
        value = node.text.strip()
        return value or None

    return {
        "steam_id64": _text("steamID64") or steam64,
        "steam_name": _text("steamID"),
        "steam_avatar_url": _text("avatarFull") or _text("avatarMedium") or _text("avatarIcon"),
    }


async def _get_steam_profile_data(steam_id: Any) -> dict[str, Any]:
    steam64 = _steam_to_steam64(steam_id)
    if not steam64:
        return {}

    now = time.time()
    cached = _steam_profile_cache.get(steam64)
    if cached and cached[0] > now:
        return cached[1]

    fetched = await asyncio.to_thread(_fetch_steam_profile_xml_sync, steam64)
    payload = {
        "steam_id64": steam64,
        "steam_profile_url": f"https://steamcommunity.com/profiles/{steam64}",
        "steam_name": fetched.get("steam_name"),
        "steam_avatar_url": fetched.get("steam_avatar_url"),
    }
    _steam_profile_cache[steam64] = (now + STEAM_PROFILE_CACHE_TTL_SECONDS, payload)
    return payload


async def _enrich_players_with_steam(players: list[dict[str, Any]], *, max_items: int | None = None) -> None:
    if not players:
        return
    count = len(players) if max_items is None else min(len(players), max_items)
    subset = players[:count]
    steam_payloads = await asyncio.gather(
        *[_get_steam_profile_data(item.get("steam_id")) for item in subset],
        return_exceptions=True,
    )
    for item, steam_data in zip(subset, steam_payloads):
        if isinstance(steam_data, Exception) or not isinstance(steam_data, dict):
            continue
        steam64 = steam_data.get("steam_id64")
        if steam64:
            item["steam_id64"] = steam64
        if steam_data.get("steam_profile_url"):
            item["steam_profile_url"] = steam_data.get("steam_profile_url")
        if steam_data.get("steam_name"):
            item["steam_name"] = steam_data.get("steam_name")
        steam_avatar_url = steam_data.get("steam_avatar_url") or _steam_avatar_proxy_url(steam64)
        if steam_avatar_url:
            item["steam_avatar_url"] = steam_avatar_url
            item["display_avatar_url"] = steam_avatar_url
        elif item.get("avatar_url"):
            item["display_avatar_url"] = item.get("avatar_url")


def _parse_address(address: str) -> tuple[str, int] | None:
    raw = str(address or "").strip()
    if ":" not in raw:
        return None
    host, port_str = raw.rsplit(":", 1)
    try:
        return host.strip(), int(port_str.strip())
    except Exception:
        return None


def _get_server_status_rcon_sync(address: str, password: str) -> dict[str, Any]:
    if not RCON_AVAILABLE or not RconClient:
        return {"offline": True}
    parsed = _parse_address(address)
    if not parsed:
        return {"offline": True}

    host, port = parsed
    try:
        with RconClient(host, port, passwd=password, timeout=2) as client:
            response = str(client.run("status") or "")
    except Exception:
        return {"offline": True}

    hostname_match = re.search(r"hostname:\s*(.+)", response)
    map_match = re.search(r"map\s*:\s*([^\r\n]+)", response)
    players_match = re.search(r"players\s*:\s*(\d+)\s+humans", response)
    max_players_match = re.search(r"players\s*:\s*\d+\s+humans,\s*\d+\s+bots,\s*(\d+)\s+max", response)

    raw_map = map_match.group(1).strip() if map_match else None
    if raw_map:
        # Source status may append coordinates: "map_name at: 0 x, 0 y, 0 z"
        raw_map = re.split(r"\s+at:\s+", raw_map, maxsplit=1, flags=re.IGNORECASE)[0].strip()

    return {
        "offline": False,
        "server_name": hostname_match.group(1).strip() if hostname_match else None,
        "map_name": raw_map,
        "current_players": int(players_match.group(1)) if players_match else None,
        "max_players": int(max_players_match.group(1)) if max_players_match else None,
    }


async def _get_server_status_rcon(address: str, password: str) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_server_status_rcon_sync, address, password)


async def _get_server_status_a2s(address: str) -> dict[str, Any]:
    if not A2S_AVAILABLE:
        return {"offline": True}
    parsed = _parse_address(address)
    if not parsed:
        return {"offline": True}

    host, port = parsed
    try:
        info = await a2s.ainfo((host, port))
    except Exception:
        return {"offline": True}

    return {
        "offline": False,
        "server_name": getattr(info, "server_name", None),
        "map_name": getattr(info, "map_name", None),
        "current_players": getattr(info, "player_count", None),
        "max_players": getattr(info, "max_players", None),
        "is_mix": bool(getattr(info, "password_protected", False)),
    }


class WSManager:
    def __init__(self) -> None:
        self._sockets: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._sockets.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._sockets.discard(ws)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        async with self._lock:
            sockets = list(self._sockets)
        for ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._sockets.discard(ws)


ws_manager = WSManager()


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    await db.connect()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await db.disconnect()


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "app": settings.app_name,
        "env": settings.app_env,
        "websocket_enabled": settings.websocket_enabled,
        "webhook_enabled": settings.webhook_enabled,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/summary")
async def summary() -> dict[str, Any]:
    async with db.acquire() as conn:
        counts = await conn.fetchrow(
            """
            SELECT
                (SELECT COUNT(*) FROM IOSCA_PLAYERS) AS players_total,
                (SELECT COUNT(*) FROM IOSCA_TEAMS) AS teams_total,
                (SELECT COUNT(*) FROM MATCH_STATS) AS matches_total,
                (SELECT COUNT(*) FROM TOURNAMENTS) AS tournaments_total,
                (SELECT COUNT(*) FROM TOURNAMENTS WHERE status='active') AS active_tournaments_total,
                (SELECT COUNT(*) FROM IOS_SERVERS WHERE is_active=TRUE) AS active_servers_total
            """
        )
    return _record_to_dict(counts)


@app.get("/api/rankings")
async def rankings(limit: int = Query(default=200, ge=1, le=2000)) -> dict[str, Any]:
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH latest_pos AS (
                SELECT DISTINCT ON (steam_id)
                    steam_id,
                    UPPER(NULLIF(TRIM(position), '')) AS position
                FROM PLAYER_MATCH_DATA
                WHERE position IS NOT NULL AND position <> ''
                ORDER BY steam_id, updated_at DESC NULLS LAST, id DESC
            )
            SELECT
                p.steam_id,
                p.discord_id,
                p.discord_name,
                lp.position,
                p.rating,
                p.rating_updated_at
            FROM IOSCA_PLAYERS p
            JOIN latest_pos lp ON lp.steam_id = p.steam_id
            WHERE p.discord_id IS NOT NULL
              AND p.rating IS NOT NULL
              AND p.rating::text <> 'NaN'
              AND lp.position <> 'UNKNOWN'
            ORDER BY p.rating DESC NULLS LAST, p.discord_name ASC
            LIMIT $1
            """,
            limit,
        )

    players = _records_to_dicts(rows)
    for item in players:
        item["avatar_url"] = _discord_avatar_url(item.get("discord_id"))
        item["avatar_fallback_url"] = _default_discord_avatar(item.get("discord_id"))
        item["steam_profile_url"] = _steam_profile_url(item.get("steam_id"))
        steam64 = _steam_to_steam64(item.get("steam_id"))
        if steam64:
            item["steam_id64"] = steam64
            item["display_avatar_url"] = _steam_avatar_proxy_url(steam64)
        else:
            item["display_avatar_url"] = item["avatar_url"]

    await _enrich_players_with_steam(players, max_items=300)

    def best_for(positions: set[str]) -> dict[str, Any] | None:
        for p in players:
            pos = str(p.get("position") or "").upper()
            if pos in positions:
                return p
        return None

    widgets = {
        "best_goalkeeper": best_for({"GK"}),
        "best_defender": best_for({"LB", "RB", "CB", "DEF"}),
        "best_midfielder": best_for({"CM", "LM", "RM", "MID"}),
        "best_attacker": best_for({"CF", "LW", "RW", "ST", "ATT"}),
    }

    return {"players": players, "widgets": widgets}


@app.get("/api/players")
async def players(limit: int = Query(default=500, ge=1, le=5000)) -> dict[str, Any]:
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH latest_pos AS (
                SELECT DISTINCT ON (steam_id)
                    steam_id,
                    UPPER(NULLIF(TRIM(position), '')) AS position
                FROM PLAYER_MATCH_DATA
                WHERE position IS NOT NULL AND position <> ''
                ORDER BY steam_id, updated_at DESC NULLS LAST, id DESC
            )
            SELECT
                p.steam_id,
                p.discord_id,
                p.discord_name,
                COALESCE(lp.position, 'N/A') AS position,
                p.rating,
                p.registered_at,
                p.last_active
            FROM IOSCA_PLAYERS p
            LEFT JOIN latest_pos lp ON lp.steam_id = p.steam_id
            WHERE p.discord_id IS NOT NULL
              AND p.rating IS NOT NULL
              AND p.rating::text <> 'NaN'
            ORDER BY p.rating DESC NULLS LAST, p.discord_name ASC
            LIMIT $1
            """,
            limit,
        )

    payload = _records_to_dicts(rows)
    for item in payload:
        item["avatar_url"] = _discord_avatar_url(item.get("discord_id"))
        item["avatar_fallback_url"] = _default_discord_avatar(item.get("discord_id"))
        item["steam_profile_url"] = _steam_profile_url(item.get("steam_id"))
        steam64 = _steam_to_steam64(item.get("steam_id"))
        if steam64:
            item["steam_id64"] = steam64
            item["display_avatar_url"] = _steam_avatar_proxy_url(steam64)
        else:
            item["display_avatar_url"] = item["avatar_url"]
    await _enrich_players_with_steam(payload, max_items=300)
    return {"players": payload}


@app.get("/api/players/{steam_id}")
async def player_detail(steam_id: str) -> dict[str, Any]:
    async with db.acquire() as conn:
        player = await conn.fetchrow(
            """
            WITH latest_pos AS (
                SELECT DISTINCT ON (steam_id)
                    steam_id,
                    NULLIF(position, '') AS position
                FROM PLAYER_MATCH_DATA
                WHERE steam_id = $1
                  AND position IS NOT NULL AND position <> ''
                ORDER BY steam_id, updated_at DESC NULLS LAST, id DESC
            )
            SELECT
                p.steam_id,
                p.discord_id,
                p.discord_name,
                COALESCE(lp.position, 'N/A') AS position,
                COALESCE(p.rating, 5.0) AS rating,
                p.rating_updated_at,
                p.registered_at,
                p.last_active
            FROM IOSCA_PLAYERS p
            LEFT JOIN latest_pos lp ON lp.steam_id = p.steam_id
            WHERE p.steam_id = $1
            """,
            steam_id,
        )
        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        totals = await conn.fetchrow(
            """
            SELECT
                COUNT(*) AS matches_played,
                COALESCE(SUM(goals), 0) AS goals,
                COALESCE(SUM(assists), 0) AS assists,
                COALESCE(SUM(second_assists), 0) AS second_assists,
                COALESCE(SUM(keeper_saves), 0) AS keeper_saves,
                COALESCE(SUM(tackles), 0) AS tackles,
                COALESCE(SUM(interceptions), 0) AS interceptions,
                COALESCE(SUM(yellow_cards), 0) AS yellow_cards,
                COALESCE(SUM(red_cards), 0) AS red_cards,
                COALESCE(AVG(pass_accuracy), 0) AS avg_pass_accuracy
            FROM PLAYER_MATCH_DATA
            WHERE steam_id = $1
            """,
            steam_id,
        )

        recent = await conn.fetch(
            """
            SELECT
                COALESCE(ms.match_id::text, ms.id::text) AS match_id,
                ms.datetime,
                COALESCE(ht.guild_name, ms.home_team_name) AS home_team_name,
                COALESCE(at.guild_name, ms.away_team_name) AS away_team_name,
                ms.home_score,
                ms.away_score,
                ms.game_type,
                t.name AS tournament_name,
                CASE WHEN tm.match_stats_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_tournament,
                CASE
                    WHEN ms.home_score = ms.away_score THEN 'D'
                    WHEN pmd.guild_id::text = ms.home_guild_id::text AND ms.home_score > ms.away_score THEN 'W'
                    WHEN pmd.guild_id::text = ms.away_guild_id::text AND ms.away_score > ms.home_score THEN 'W'
                    WHEN pmd.guild_id::text = ms.home_guild_id::text AND ms.home_score < ms.away_score THEN 'L'
                    WHEN pmd.guild_id::text = ms.away_guild_id::text AND ms.away_score < ms.home_score THEN 'L'
                    ELSE NULL
                END AS result,
                pmd.position,
                pmd.goals,
                pmd.assists,
                pmd.keeper_saves,
                pmd.tackles,
                pmd.interceptions,
                pmd.red_cards,
                pmd.yellow_cards,
                pmd.pass_accuracy
            FROM PLAYER_MATCH_DATA pmd
            JOIN MATCH_STATS ms
              ON (
                   pmd.match_id::text = ms.match_id::text
                   OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = ms.id::bigint
              )
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = ms.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = ms.away_guild_id
            LEFT JOIN TOURNAMENT_MATCHES tm ON tm.match_stats_id = ms.id
            LEFT JOIN TOURNAMENTS t ON t.id = tm.tournament_id
            WHERE pmd.steam_id = $1
            ORDER BY ms.datetime DESC
            LIMIT 20
            """,
            steam_id,
        )

        team = await conn.fetchrow(
            """
            SELECT guild_id, guild_name, guild_icon, captain_id, captain_name
            FROM IOSCA_TEAMS
            WHERE EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(players, '[]'::jsonb)) p
                WHERE (p->>'id') = CAST($1 AS text)
                   OR (p->>'steam_id') = $2
            )
            LIMIT 1
            """,
            player.get("discord_id"),
            steam_id,
        )

    player_payload = _record_to_dict(player)
    player_payload["avatar_url"] = _discord_avatar_url(player_payload.get("discord_id"))
    player_payload["avatar_fallback_url"] = _default_discord_avatar(player_payload.get("discord_id"))
    player_payload["steam_profile_url"] = _steam_profile_url(steam_id)
    player_payload["display_avatar_url"] = player_payload.get("avatar_url")
    steam_data = await _get_steam_profile_data(steam_id)
    steam64 = steam_data.get("steam_id64") or _steam_to_steam64(steam_id)
    if steam64:
        player_payload["steam_id64"] = steam64
    if steam_data.get("steam_name"):
        player_payload["steam_name"] = steam_data.get("steam_name")
    steam_avatar_url = steam_data.get("steam_avatar_url") or _steam_avatar_proxy_url(steam64)
    if steam_avatar_url:
        player_payload["steam_avatar_url"] = steam_avatar_url
        player_payload["display_avatar_url"] = steam_avatar_url
    return {
        "player": player_payload,
        "totals": _record_to_dict(totals),
        "recent_matches": _records_to_dicts(recent),
        "team": _record_to_dict(team),
    }


@app.get("/api/player")
async def player_detail_query(steam_id: str = Query(..., min_length=1)) -> dict[str, Any]:
    return await player_detail(steam_id)


@app.get("/api/matches")
async def matches(limit: int = Query(default=250, ge=1, le=3000)) -> dict[str, Any]:
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                m.id,
                m.match_id,
                m.datetime,
                m.game_type,
                m.home_guild_id,
                m.away_guild_id,
                COALESCE(ht.guild_name, m.home_team_name) AS home_team_name,
                COALESCE(at.guild_name, m.away_team_name) AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon,
                m.home_score,
                m.away_score,
                m.extratime,
                m.penalties,
                tm.tournament_id,
                t.name AS tournament_name
            FROM MATCH_STATS m
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
            LEFT JOIN TOURNAMENT_MATCHES tm ON tm.match_stats_id = m.id
            LEFT JOIN TOURNAMENTS t ON t.id = tm.tournament_id
            ORDER BY m.datetime DESC
            LIMIT $1
            """,
            limit,
        )
    return {"matches": _records_to_dicts(rows)}


@app.get("/api/matches/{match_id}")
async def match_detail(match_id: str) -> dict[str, Any]:
    match_token = str(match_id).strip()
    if not match_token:
        raise HTTPException(status_code=400, detail="Invalid match id")

    async with db.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                m.*,
                COALESCE(ht.guild_name, m.home_team_name) AS home_team_name,
                COALESCE(at.guild_name, m.away_team_name) AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon,
                tm.tournament_id,
                t.name AS tournament_name
            FROM MATCH_STATS m
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
            LEFT JOIN TOURNAMENT_MATCHES tm ON tm.match_stats_id = m.id
            LEFT JOIN TOURNAMENTS t ON t.id = tm.tournament_id
            WHERE m.id::text = $1 OR m.match_id::text = $1
            ORDER BY m.datetime DESC
            LIMIT 1
            """,
            match_token,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Match not found")

        row_id = row.get("id")
        row_match_id = str(row.get("match_id") or "")
        stats = await conn.fetch(
            """
            WITH dedup AS (
                SELECT DISTINCT ON (pmd.steam_id, COALESCE(pmd.guild_id::text, ''))
                    pmd.*
                FROM PLAYER_MATCH_DATA pmd
                WHERE (
                        pmd.match_id::text = $2::text
                        OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = $1::bigint
                      )
                ORDER BY
                    pmd.steam_id,
                    COALESCE(pmd.guild_id::text, ''),
                    pmd.updated_at DESC NULLS LAST,
                    pmd.id DESC
            )
            SELECT
                d.*,
                COALESCE(ip.discord_name, d.steam_id) AS player_name
            FROM dedup d
            LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = d.steam_id
            ORDER BY d.goals DESC, d.assists DESC, d.keeper_saves DESC, player_name ASC
            """,
            row_id,
            row_match_id,
        )

    match_payload = _record_to_dict(row)
    match_payload["home_lineup"] = _parse_json(match_payload.get("home_lineup"), [])
    match_payload["away_lineup"] = _parse_json(match_payload.get("away_lineup"), [])
    match_payload["substitutions"] = _parse_json(match_payload.get("substitutions"), [])

    home_lineup_keys = _extract_lineup_identity_sets(match_payload.get("home_lineup"))
    away_lineup_keys = _extract_lineup_identity_sets(match_payload.get("away_lineup"))
    home_guild_key = str(match_payload.get("home_guild_id") or "").strip()
    away_guild_key = str(match_payload.get("away_guild_id") or "").strip()

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in _records_to_dicts(stats):
        side = "neutral"
        item_guild_key = str(item.get("guild_id") or "").strip()
        if item_guild_key and item_guild_key == home_guild_key:
            side = "home"
        elif item_guild_key and item_guild_key == away_guild_key:
            side = "away"
        else:
            side = _infer_side_from_lineup(item, home_lineup_keys, away_lineup_keys)
        grouped[side].append(item)

    return {
        "match": match_payload,
        "player_stats": {
            "home": grouped.get("home", []),
            "away": grouped.get("away", []),
            "neutral": grouped.get("neutral", []),
        },
        "team_events": {
            "home": _build_team_event_items(grouped.get("home", [])),
            "away": _build_team_event_items(grouped.get("away", [])),
        },
    }


@app.get("/api/match")
async def match_detail_query(id: str = Query(..., min_length=1)) -> dict[str, Any]:
    return await match_detail(id)


@app.get("/api/tournaments")
async def tournaments() -> dict[str, Any]:
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                t.id,
                t.name,
                t.format,
                t.status,
                t.num_teams,
                t.created_at,
                t.updated_at,
                COALESCE(COUNT(DISTINCT tf.id), 0) AS fixtures_total,
                COALESCE(COUNT(DISTINCT CASE WHEN tf.is_played THEN tf.id END), 0) AS fixtures_played,
                COALESCE(COUNT(DISTINCT tm.id), 0) AS matches_linked
            FROM TOURNAMENTS t
            LEFT JOIN TOURNAMENT_FIXTURES tf ON tf.tournament_id = t.id
            LEFT JOIN TOURNAMENT_MATCHES tm ON tm.tournament_id = t.id
            GROUP BY t.id
            ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'ended' THEN 1 ELSE 2 END, t.updated_at DESC
            """
        )
    return {"tournaments": _records_to_dicts(rows)}


@app.get("/api/tournaments/{tournament_id}")
async def tournament_detail(tournament_id: int) -> dict[str, Any]:
    async with db.acquire() as conn:
        tournament = await conn.fetchrow("SELECT * FROM TOURNAMENTS WHERE id = $1", tournament_id)
        if not tournament:
            raise HTTPException(status_code=404, detail="Tournament not found")

        standings = await conn.fetch(
            """
            SELECT
                s.guild_id,
                COALESCE(tt.team_name_snapshot, it.guild_name, CONCAT('Team ', s.guild_id::text)) AS team_name,
                COALESCE(tt.team_icon_snapshot, it.guild_icon, '') AS team_icon,
                s.matches_played,
                s.wins,
                s.draws,
                s.losses,
                s.goals_for,
                s.goals_against,
                s.goal_diff,
                s.points
            FROM TOURNAMENT_STANDINGS s
            LEFT JOIN TOURNAMENT_TEAMS tt
                ON tt.tournament_id = s.tournament_id
               AND tt.guild_id = s.guild_id
            LEFT JOIN IOSCA_TEAMS it ON it.guild_id = s.guild_id
            WHERE s.tournament_id = $1
            ORDER BY s.points DESC, s.goal_diff DESC, s.goals_for DESC, team_name ASC
            """,
            tournament_id,
        )

        fixtures = await conn.fetch(
            """
            SELECT
                f.id,
                f.week_number,
                f.week_label,
                f.is_active,
                f.is_played,
                f.played_match_stats_id,
                f.played_at,
                f.home_guild_id,
                f.away_guild_id,
                m.home_score,
                m.away_score,
                m.datetime AS match_datetime,
                COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
                COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon
            FROM TOURNAMENT_FIXTURES f
            LEFT JOIN MATCH_STATS m ON m.id = f.played_match_stats_id
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
            WHERE f.tournament_id = $1
            ORDER BY f.week_number NULLS LAST, f.id ASC
            """,
            tournament_id,
        )

        teams = await conn.fetch(
            """
            SELECT
                tt.guild_id,
                COALESCE(tt.team_name_snapshot, it.guild_name) AS team_name,
                COALESCE(tt.team_icon_snapshot, it.guild_icon, '') AS team_icon,
                it.captain_name
            FROM TOURNAMENT_TEAMS tt
            LEFT JOIN IOSCA_TEAMS it ON it.guild_id = tt.guild_id
            WHERE tt.tournament_id = $1
            ORDER BY team_name ASC
            """,
            tournament_id,
        )

    team_forms: dict[str, list[str]] = defaultdict(list)
    played_fixtures: list[Any] = []
    for fixture in fixtures:
        if not fixture.get("is_played"):
            continue
        if fixture.get("home_score") is None or fixture.get("away_score") is None:
            continue
        played_fixtures.append(fixture)

    def _fixture_sort_key(item: Any) -> datetime:
        dt_value = item.get("played_at") or item.get("match_datetime")
        if isinstance(dt_value, datetime):
            if dt_value.tzinfo is None:
                return dt_value.replace(tzinfo=timezone.utc)
            return dt_value.astimezone(timezone.utc)
        return datetime.min.replace(tzinfo=timezone.utc)

    played_fixtures.sort(key=_fixture_sort_key)

    for fixture in played_fixtures:
        home_id = str(fixture.get("home_guild_id") or "").strip()
        away_id = str(fixture.get("away_guild_id") or "").strip()
        if not home_id or not away_id:
            continue
        try:
            home_score = int(fixture.get("home_score") or 0)
            away_score = int(fixture.get("away_score") or 0)
        except Exception:
            continue
        if home_score > away_score:
            team_forms[home_id].append("W")
            team_forms[away_id].append("L")
        elif home_score < away_score:
            team_forms[home_id].append("L")
            team_forms[away_id].append("W")
        else:
            team_forms[home_id].append("D")
            team_forms[away_id].append("D")

    trimmed_team_forms = {team_id: results[-5:] for team_id, results in team_forms.items()}

    return {
        "tournament": _record_to_dict(tournament),
        "standings": _records_to_dicts(standings),
        "fixtures": _records_to_dicts(fixtures),
        "teams": _records_to_dicts(teams),
        "team_forms": trimmed_team_forms,
    }


@app.get("/api/teams")
async def teams() -> dict[str, Any]:
    async with db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                guild_id,
                guild_name,
                guild_icon,
                captain_id,
                captain_name,
                average_rating,
                created_at,
                updated_at,
                players
            FROM IOSCA_TEAMS
            ORDER BY guild_name ASC
            """
        )

    payload = _records_to_dicts(rows)
    for item in payload:
        roster = _parse_json(item.get("players"), [])
        item["player_count"] = len(roster) if isinstance(roster, list) else 0
    return {"teams": payload}


@app.get("/api/teams/{guild_id}")
async def team_detail(guild_id: str) -> dict[str, Any]:
    guild_id = str(guild_id).strip()
    async with db.acquire() as conn:
        team = await conn.fetchrow("SELECT * FROM IOSCA_TEAMS WHERE guild_id::text = $1", guild_id)
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")

        roster_raw = _parse_json(team.get("players"), [])
        roster: list[dict[str, Any]] = []
        for item in roster_raw if isinstance(roster_raw, list) else []:
            if isinstance(item, dict):
                roster.append(item)

        discord_ids: list[str] = []
        for entry in roster:
            raw_id = entry.get("id")
            if raw_id is None:
                continue
            value = str(raw_id).strip()
            if value:
                discord_ids.append(value)

        roster_players: dict[str, dict[str, Any]] = {}
        if discord_ids:
            rows = await conn.fetch(
                """
                WITH latest_pos AS (
                    SELECT DISTINCT ON (steam_id)
                        steam_id,
                        UPPER(NULLIF(TRIM(position), '')) AS position
                    FROM PLAYER_MATCH_DATA
                    WHERE position IS NOT NULL AND position <> ''
                    ORDER BY steam_id, updated_at DESC NULLS LAST, id DESC
                )
                SELECT
                    p.steam_id,
                    p.discord_id,
                    p.discord_name,
                    p.rating,
                    COALESCE(lp.position, 'N/A') AS position
                FROM IOSCA_PLAYERS p
                LEFT JOIN latest_pos lp ON lp.steam_id = p.steam_id
                WHERE p.discord_id::text = ANY($1::text[])
                """,
                discord_ids,
            )
            for row in rows:
                item = _record_to_dict(row)
                item["avatar_url"] = _discord_avatar_url(item.get("discord_id"))
                item["avatar_fallback_url"] = _default_discord_avatar(item.get("discord_id"))
                roster_players[str(item.get("discord_id"))] = item
            await _enrich_players_with_steam(list(roster_players.values()), max_items=120)

        team_stats = await conn.fetchrow(
            """
            SELECT
                COUNT(*) AS matches_played,
                SUM(CASE
                        WHEN m.home_guild_id::text = $1 AND m.home_score > m.away_score THEN 1
                        WHEN m.away_guild_id::text = $1 AND m.away_score > m.home_score THEN 1
                        ELSE 0 END) AS wins,
                SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) AS draws,
                SUM(CASE
                        WHEN m.home_guild_id::text = $1 AND m.home_score < m.away_score THEN 1
                        WHEN m.away_guild_id::text = $1 AND m.away_score < m.home_score THEN 1
                        ELSE 0 END) AS losses,
                COALESCE(SUM(CASE
                        WHEN m.home_guild_id::text = $1 THEN m.home_score
                        WHEN m.away_guild_id::text = $1 THEN m.away_score
                        ELSE 0 END), 0) AS goals_for,
                COALESCE(SUM(CASE
                        WHEN m.home_guild_id::text = $1 THEN m.away_score
                        WHEN m.away_guild_id::text = $1 THEN m.home_score
                        ELSE 0 END), 0) AS goals_against
            FROM MATCH_STATS m
            WHERE m.home_guild_id::text = $1 OR m.away_guild_id::text = $1
            """,
            guild_id,
        )

        recent_matches = await conn.fetch(
            """
            SELECT
                m.id,
                m.datetime,
                COALESCE(ht.guild_name, m.home_team_name) AS home_team_name,
                COALESCE(at.guild_name, m.away_team_name) AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon,
                m.home_score,
                m.away_score
            FROM MATCH_STATS m
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
            WHERE m.home_guild_id::text = $1 OR m.away_guild_id::text = $1
            ORDER BY m.datetime DESC
            LIMIT 20
            """,
            guild_id,
        )

    team_payload = _record_to_dict(team)
    parsed_players: list[dict[str, Any]] = []
    for member in roster:
        discord_id = str(member.get("id")) if member.get("id") is not None else None
        mapped = roster_players.get(discord_id) if discord_id else None
        member_steam_id = mapped.get("steam_id") if mapped else member.get("steam_id")
        member_steam64 = _steam_to_steam64(member_steam_id)
        member_avatar = (
            mapped.get("display_avatar_url")
            if mapped
            else _steam_avatar_proxy_url(member_steam64) or _discord_avatar_url(discord_id)
        )
        parsed_players.append(
            {
                "discord_id": discord_id,
                "name": member.get("name") or (mapped.get("discord_name") if mapped else "Unknown"),
                "steam_id": member_steam_id,
                "rating": mapped.get("rating") if mapped else None,
                "position": mapped.get("position") if mapped else "N/A",
                "avatar_url": mapped.get("avatar_url") if mapped else _discord_avatar_url(discord_id),
                "display_avatar_url": member_avatar,
                "avatar_fallback_url": mapped.get("avatar_fallback_url") if mapped else _default_discord_avatar(discord_id),
                "steam_profile_url": mapped.get("steam_profile_url") if mapped else _steam_profile_url(member_steam_id),
                "steam_name": mapped.get("steam_name") if mapped else None,
                "steam_avatar_url": mapped.get("steam_avatar_url") if mapped else _steam_avatar_proxy_url(member_steam64),
            }
        )

    stats_payload = _record_to_dict(team_stats)
    stats_payload["goal_diff"] = int(stats_payload.get("goals_for", 0) or 0) - int(stats_payload.get("goals_against", 0) or 0)

    return {
        "team": team_payload,
        "players": parsed_players,
        "stats": stats_payload,
        "recent_matches": _records_to_dicts(recent_matches),
    }


@app.get("/api/team")
async def team_detail_query(guild_id: str = Query(..., min_length=1)) -> dict[str, Any]:
    return await team_detail(guild_id)


@app.get("/api/servers")
async def servers() -> dict[str, Any]:
    async with db.acquire() as conn:
        col_rows = await conn.fetch(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'ios_servers'
            """
        )
        cols = {str(r.get("column_name")) for r in col_rows}
        players_col = "current_players" if "current_players" in cols else None
        map_col = "map_name" if "map_name" in cols else ("current_map" if "current_map" in cols else None)

        select_players = f"{players_col}" if players_col else "NULL::integer AS current_players"
        select_map = f"{map_col}" if map_col else "NULL::text AS map_name"
        query = f"""
            SELECT
                id,
                name,
                address,
                password,
                server_type,
                is_active,
                created_at,
                updated_at,
                {select_players},
                {select_map}
            FROM IOS_SERVERS
            ORDER BY is_active DESC, name ASC
        """
        rows = await conn.fetch(query)

    servers_payload = _records_to_dicts(rows)
    async def _enrich_server(server: dict[str, Any]) -> None:
        if not server.get("is_active") or not server.get("address"):
            return

        # First try the same method used by /server_status (A2S), then fallback to RCON.
        status: dict[str, Any] = {"offline": True}
        if A2S_AVAILABLE:
            status = await _get_server_status_a2s(server["address"])

        if status.get("offline") and RCON_AVAILABLE and server.get("password"):
            status = await _get_server_status_rcon(server["address"], server["password"])

        if status.get("offline"):
            server["live_online"] = False
            return

        server["live_online"] = True
        if status.get("server_name"):
            server["live_name"] = status.get("server_name")
        if status.get("current_players") is not None:
            server["current_players"] = status.get("current_players")
        if status.get("map_name"):
            server["map_name"] = status.get("map_name")
        if status.get("max_players") is not None:
            server["max_players"] = status.get("max_players")
        if status.get("is_mix") is not None:
            server["is_mix"] = bool(status.get("is_mix"))

    if servers_payload:
        await asyncio.gather(*[_enrich_server(server) for server in servers_payload], return_exceptions=True)

    for server in servers_payload:
        address = server.get("address")
        server["current_players"] = server.get("current_players")
        server["map_name"] = server.get("map_name")
        server["connect_link"] = f"steam://connect/{address}" if address else None
        server.pop("password", None)
    return {"servers": servers_payload}


@app.get("/api/discord")
async def discord_info() -> dict[str, Any]:
    return {
        "discord_invite_url": settings.discord_invite_url,
        "discord_rules_url": settings.discord_rules_url,
        "discord_tutorial_url": settings.discord_tutorial_url,
    }


@app.post("/api/webhooks/events")
async def webhook_events(request: Request) -> dict[str, Any]:
    if not settings.webhook_enabled:
        raise HTTPException(status_code=404, detail="Webhook endpoint disabled")

    if settings.webhook_token:
        token = request.headers.get("x-webhook-token")
        if token != settings.webhook_token:
            raise HTTPException(status_code=401, detail="Unauthorized webhook")

    payload = await request.json()
    event = {
        "event": payload.get("event", "unknown"),
        "payload": payload,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await ws_manager.broadcast(event)
    return {"ok": True, "broadcasted": True}


@app.websocket(settings.websocket_path)
async def ws_live(websocket: WebSocket) -> None:
    if not settings.websocket_enabled:
        await websocket.close(code=1008)
        return

    await ws_manager.connect(websocket)
    try:
        await websocket.send_json({"event": "connected", "ts": datetime.now(timezone.utc).isoformat()})
        while True:
            _ = await websocket.receive_text()
            await websocket.send_json({"event": "pong", "ts": datetime.now(timezone.utc).isoformat()})
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)
        try:
            await websocket.close()
        except Exception:
            pass
