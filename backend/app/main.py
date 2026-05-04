from __future__ import annotations

import asyncio
import json
import re
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import requests
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

try:
    from ios_bot.utils.match_performance import get_mvp_data as shared_get_mvp_data
    from ios_bot.utils.match_performance import rate_player as shared_rate_player
except Exception:
    shared_get_mvp_data = None
    shared_rate_player = None

try:
    from .config import settings
    from .db import db
    from .hub_shared import (
        _asset_emoji_url,
        _build_team_event_items,
        _build_team_event_items_from_summary,
        _default_discord_avatar,
        _discord_avatar_url,
        _event_items_signature,
        _extract_lineup_identity_sets,
        _extract_summary_identity_sets,
        _infer_side_from_lineup,
        _infer_side_from_player_match_row,
        _json_safe,
        _match_result_for_side,
        _merge_event_maps,
        _merge_match_player_rows,
        _norm_text_key,
        _normalize_mvp_stats,
        _normalize_tournament_league_key,
        _parse_event_map,
        _parse_json,
        _pick_emoji_for_role_asset,
        _pick_position_asset,
        _player_event_minutes,
        _position_search_tokens,
        _record_to_dict,
        _records_to_dicts,
        _safe_int,
        _safe_minutes,
        _steam_aliases,
        _steam_avatar_proxy_url,
        _steam_profile_url,
        _steam_to_steam64,
        _to_iso,
        _tournament_league_label,
    )
except ImportError:
    # Allow running this module directly (python main.py) in environments
    # where package-relative imports are not available.
    from config import settings  # type: ignore
    from db import db  # type: ignore
    from hub_shared import (  # type: ignore
        _asset_emoji_url,
        _build_team_event_items,
        _build_team_event_items_from_summary,
        _default_discord_avatar,
        _discord_avatar_url,
        _event_items_signature,
        _extract_lineup_identity_sets,
        _extract_summary_identity_sets,
        _infer_side_from_lineup,
        _infer_side_from_player_match_row,
        _json_safe,
        _match_result_for_side,
        _merge_event_maps,
        _merge_match_player_rows,
        _norm_text_key,
        _normalize_mvp_stats,
        _normalize_tournament_league_key,
        _parse_event_map,
        _parse_json,
        _pick_emoji_for_role_asset,
        _pick_position_asset,
        _player_event_minutes,
        _position_search_tokens,
        _record_to_dict,
        _records_to_dicts,
        _safe_int,
        _safe_minutes,
        _steam_aliases,
        _steam_avatar_proxy_url,
        _steam_profile_url,
        _steam_to_steam64,
        _to_iso,
        _tournament_league_label,
    )

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

STEAM_PROFILE_CACHE_TTL_SECONDS = 1800
_steam_profile_cache: dict[str, tuple[float, dict[str, Any]]] = {}
DISCORD_MEMBER_ROLE_CACHE_TTL_SECONDS = 300
DISCORD_GUILD_ROLES_CACHE_TTL_SECONDS = 600
_discord_member_role_cache: dict[str, tuple[float, list[str]]] = {}
_discord_guild_roles_cache: dict[str, tuple[float, dict[str, str]]] = {}


# Schema compatibility helpers
async def _ensure_tournament_league_schema(conn: Any) -> None:
    await conn.execute(
        """
        ALTER TABLE TOURNAMENTS
        ADD COLUMN IF NOT EXISTS league_count INTEGER NOT NULL DEFAULT 1
        """
    )
    await conn.execute(
        """
        UPDATE TOURNAMENTS
        SET league_count = 1
        WHERE league_count IS NULL OR league_count NOT IN (1, 2)
        """
    )
    await conn.execute(
        """
        ALTER TABLE TOURNAMENT_TEAMS
        ADD COLUMN IF NOT EXISTS league_key VARCHAR(1) NOT NULL DEFAULT 'A'
        """
    )
    await conn.execute(
        """
        UPDATE TOURNAMENT_TEAMS
        SET league_key = 'A'
        WHERE league_key IS NULL OR league_key NOT IN ('A', 'B')
        """
    )
    await conn.execute(
        """
        ALTER TABLE TOURNAMENT_FIXTURES
        ADD COLUMN IF NOT EXISTS league_key VARCHAR(1) NOT NULL DEFAULT 'A'
        """
    )
    await conn.execute(
        """
        UPDATE TOURNAMENT_FIXTURES
        SET league_key = 'A'
        WHERE league_key IS NULL OR league_key NOT IN ('A', 'B')
        """
    )

def _attach_match_ratings(players: list[dict[str, Any]]) -> None:
    if not shared_rate_player:
        return
    for player in players:
        persisted = player.get("match_rating")
        if isinstance(persisted, (int, float)):
            player["match_rating"] = round(float(persisted), 2)
            continue
        try:
            rating = shared_rate_player(player)
        except Exception:
            rating = None
        player["match_rating"] = round(float(rating), 2) if isinstance(rating, (int, float)) else None


# Discord and Steam enrichment
def _fetch_discord_member_roles_sync(
    bot_token: str,
    guild_id: Any,
    discord_id: Any,
) -> list[str]:
    gid = str(guild_id or "").strip()
    uid = str(discord_id or "").strip()
    token = str(bot_token or "").strip()
    if not gid or not uid or not token:
        return []

    url = f"https://discord.com/api/v10/guilds/{gid}/members/{uid}"
    headers = {"Authorization": f"Bot {token}"}
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code != 200:
            return []
        payload = resp.json() if resp.text else {}
        roles = payload.get("roles") or []
        return [str(r).strip() for r in roles if str(r).strip().isdigit()]
    except Exception:
        return []


async def _get_discord_member_role_ids(guild_id: Any, discord_id: Any) -> list[str]:
    token = str(settings.discord_bot_token or "").strip()
    gid = str(guild_id or "").strip()
    uid = str(discord_id or "").strip()
    if not token or not gid or not uid:
        return []

    cache_key = f"{gid}:{uid}"
    now = time.time()
    cached = _discord_member_role_cache.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    role_ids = await asyncio.to_thread(_fetch_discord_member_roles_sync, token, gid, uid)
    _discord_member_role_cache[cache_key] = (now + DISCORD_MEMBER_ROLE_CACHE_TTL_SECONDS, role_ids)
    return role_ids


def _fetch_discord_guild_roles_sync(bot_token: str, guild_id: Any) -> dict[str, str]:
    gid = str(guild_id or "").strip()
    token = str(bot_token or "").strip()
    if not gid or not token:
        return {}

    url = f"https://discord.com/api/v10/guilds/{gid}/roles"
    headers = {"Authorization": f"Bot {token}"}
    try:
        resp = requests.get(url, headers=headers, timeout=6)
        if resp.status_code != 200:
            return {}
        payload = resp.json() if resp.text else []
        out: dict[str, str] = {}
        if isinstance(payload, list):
            for row in payload:
                rid = str((row or {}).get("id") or "").strip()
                rname = str((row or {}).get("name") or "").strip()
                if rid:
                    out[rid] = rname or rid
        return out
    except Exception:
        return {}


async def _get_discord_guild_role_map(guild_id: Any) -> dict[str, str]:
    token = str(settings.discord_bot_token or "").strip()
    gid = str(guild_id or "").strip()
    if not token or not gid:
        return {}

    now = time.time()
    cached = _discord_guild_roles_cache.get(gid)
    if cached and cached[0] > now:
        return cached[1]

    role_map = await asyncio.to_thread(_fetch_discord_guild_roles_sync, token, gid)
    _discord_guild_roles_cache[gid] = (now + DISCORD_GUILD_ROLES_CACHE_TTL_SECONDS, role_map)
    return role_map


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


async def _decorate_public_players(players: list[dict[str, Any]], *, enrich_limit: int | None = None) -> None:
    if not players:
        return
    for item in players:
        if not item.get("discord_name") and item.get("player_name"):
            item["discord_name"] = item.get("player_name")
        if item.get("rating") is None and item.get("public_rating") is not None:
            item["rating"] = item.get("public_rating")
        if not item.get("position") and item.get("main_role"):
            item["position"] = item.get("main_role")
        item["avatar_url"] = _discord_avatar_url(item.get("discord_id"))
        item["avatar_fallback_url"] = _default_discord_avatar(item.get("discord_id"))
        item["steam_profile_url"] = _steam_profile_url(item.get("steam_id"))
        steam64 = _steam_to_steam64(item.get("steam_id"))
        if steam64:
            item["steam_id64"] = steam64
            item["display_avatar_url"] = _steam_avatar_proxy_url(steam64)
        else:
            item["display_avatar_url"] = item["avatar_url"]
    await _enrich_players_with_steam(players, max_items=enrich_limit)


# Server status helpers
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


# Realtime plumbing
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


# App lifecycle
@app.on_event("startup")
async def on_startup() -> None:
    await db.connect()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await db.disconnect()


# Root and API routes
@app.get("/")
@app.head("/")
async def root() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


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
        hall_of_fame_rows = []
        rising_star_rows = []
        hot_player_rows = []
        hot_team_rows = []
        try:
            hall_of_fame_rows, rising_star_rows, hot_player_rows, hot_team_rows = await asyncio.gather(
                conn.fetch(
                    """
                    SELECT
                        steam_id,
                        discord_id,
                        player_name,
                        COALESCE(main_role, 'N/A') AS position,
                        public_rating AS rating,
                        matches_played,
                        motm_awards,
                        trophy_count,
                        award_count,
                        prestige_score
                    FROM hub.hall_of_fame_players
                    ORDER BY prestige_score DESC, public_rating DESC NULLS LAST, player_name ASC
                    LIMIT 6
                    """
                ),
                conn.fetch(
                    """
                    SELECT
                        steam_id,
                        discord_id,
                        player_name,
                        COALESCE(main_role, 'N/A') AS position,
                        public_rating AS rating,
                        matches_played,
                        recent5_goals,
                        recent5_assists,
                        recent7_motm,
                        current_win_streak,
                        rise_score
                    FROM hub.rising_star_players
                    ORDER BY rise_score DESC, public_rating DESC NULLS LAST, player_name ASC
                    LIMIT 6
                    """
                ),
                conn.fetch(
                    """
                    SELECT
                        pfs.steam_id,
                        ps.discord_id,
                        ps.player_name,
                        COALESCE(ps.main_role, 'N/A') AS position,
                        ps.public_rating AS rating,
                        pfs.current_win_streak,
                        pfs.current_unbeaten_streak,
                        pfs.recent5_goals,
                        pfs.recent5_assists,
                        pfs.recent7_motm,
                        pfs.recent5_avg_rating
                    FROM hub.player_form_summary pfs
                    JOIN hub.player_summary ps
                      ON ps.steam_id = pfs.steam_id
                    WHERE COALESCE(ps.matches_played, 0) >= 3
                      AND (
                        COALESCE(pfs.current_win_streak, 0) > 0
                        OR COALESCE(pfs.recent5_goals, 0) > 0
                        OR COALESCE(pfs.recent7_motm, 0) > 0
                      )
                    ORDER BY
                        COALESCE(pfs.current_win_streak, 0) DESC,
                        COALESCE(pfs.recent7_motm, 0) DESC,
                        COALESCE(pfs.recent5_goals, 0) DESC,
                        COALESCE(ps.public_rating, 0) DESC,
                        ps.player_name ASC
                    LIMIT 6
                    """
                ),
                conn.fetch(
                    """
                    SELECT
                        tfs.guild_id::text AS guild_id,
                        ts.guild_name,
                        ts.guild_icon,
                        ts.average_rating,
                        ts.matches_played,
                        ts.win_rate,
                        tfs.current_win_streak,
                        tfs.current_unbeaten_streak,
                        tfs.recent5_points,
                        tfs.recent5_results
                    FROM hub.team_form_summary tfs
                    JOIN hub.team_summary ts
                      ON ts.guild_id = tfs.guild_id
                    WHERE COALESCE(ts.matches_played, 0) >= 3
                      AND (
                        COALESCE(tfs.current_win_streak, 0) > 0
                        OR COALESCE(tfs.current_unbeaten_streak, 0) > 1
                      )
                    ORDER BY
                        COALESCE(tfs.current_win_streak, 0) DESC,
                        COALESCE(tfs.recent5_points, 0) DESC,
                        COALESCE(ts.win_rate, 0) DESC,
                        ts.guild_name ASC
                    LIMIT 6
                    """
                ),
            )
        except Exception:
            hall_of_fame_rows = []
            rising_star_rows = []
            hot_player_rows = []
            hot_team_rows = []

    payload = _record_to_dict(counts)
    hall_of_fame = _records_to_dicts(hall_of_fame_rows)
    rising_stars = _records_to_dicts(rising_star_rows)
    hot_players = _records_to_dicts(hot_player_rows)
    hot_teams = _records_to_dicts(hot_team_rows)
    await _decorate_public_players(hall_of_fame, enrich_limit=6)
    await _decorate_public_players(rising_stars, enrich_limit=6)
    await _decorate_public_players(hot_players, enrich_limit=6)
    payload["storyboards"] = {
        "hall_of_fame": hall_of_fame,
        "rising_stars": rising_stars,
        "streak_center": {
            "players": hot_players,
            "teams": hot_teams,
        },
    }
    return payload


@app.get("/api/hall-of-fame")
async def hall_of_fame(limit: int = Query(default=50, ge=1, le=500)) -> dict[str, Any]:
    try:
        async with db.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    steam_id,
                    discord_id,
                    player_name,
                    COALESCE(main_role, 'N/A') AS position,
                    public_rating AS rating,
                    matches_played,
                    goals,
                    assists,
                    motm_awards,
                    trophy_count,
                    award_count,
                    prestige_score,
                    last_match_at
                FROM hub.hall_of_fame_players
                ORDER BY prestige_score DESC, public_rating DESC NULLS LAST, player_name ASC
                LIMIT $1
                """,
                limit,
            )
    except Exception:
        rows = []

    players = _records_to_dicts(rows)
    await _decorate_public_players(players, enrich_limit=min(limit, 150))
    return {"players": players}


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
              AND NOT EXISTS (
                  SELECT 1
                  FROM IOSCA_PLAYERS owner
                  JOIN LATERAL jsonb_array_elements_text(COALESCE(owner.linked_steam_ids, '[]'::jsonb)) AS linked(value) ON TRUE
                  WHERE lower(trim(linked.value)) = lower(trim(p.steam_id::text))
                    AND lower(trim(owner.steam_id::text)) <> lower(trim(p.steam_id::text))
              )
            ORDER BY p.rating DESC NULLS LAST, p.discord_name ASC
            LIMIT $1
            """,
            limit,
        )

    players = _records_to_dicts(rows)
    await _decorate_public_players(players, enrich_limit=300)

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
        try:
            rows = await conn.fetch(
                """
                WITH latest_pos AS (
                    SELECT DISTINCT ON (steam_id)
                        steam_id,
                        UPPER(NULLIF(TRIM(position), '')) AS position
                    FROM PLAYER_MATCH_DATA
                    WHERE position IS NOT NULL AND position <> ''
                    ORDER BY steam_id, updated_at DESC NULLS LAST, id DESC
                ),
                team_members AS (
                    SELECT DISTINCT ON (member_id)
                        member_id,
                        t.guild_id,
                        t.guild_name,
                        t.guild_icon
                    FROM IOSCA_TEAMS t
                    JOIN LATERAL jsonb_array_elements(COALESCE(t.players, '[]'::jsonb)) AS roster(entry) ON TRUE
                    CROSS JOIN LATERAL (
                        SELECT NULLIF(TRIM(roster.entry->>'id'), '') AS member_id
                    ) AS member
                    WHERE member.member_id IS NOT NULL
                    ORDER BY member_id, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.guild_name ASC
                )
                SELECT
                    p.steam_id,
                    p.discord_id,
                    p.discord_name,
                    COALESCE(lp.position, 'N/A') AS position,
                    NULLIF(TRIM(p.main_role), '') AS main_role,
                    COALESCE(p.display_main_role_rating, p.rating) AS rating,
                    p.rating AS legacy_rating,
                    p.main_role_rating,
                    p.display_main_role_rating,
                    COALESCE(p.total_appearances, 0) AS total_appearances,
                    COALESCE(p.total_minutes, 0) AS total_minutes,
                    p.registered_at,
                    p.last_active,
                    p.last_match_at,
                    tm.guild_id AS current_team_id,
                    tm.guild_name AS current_team_name,
                    tm.guild_icon AS current_team_icon
                FROM IOSCA_PLAYERS p
                LEFT JOIN latest_pos lp ON lp.steam_id = p.steam_id
                LEFT JOIN team_members tm ON tm.member_id = p.discord_id::text
                WHERE p.discord_id IS NOT NULL
                  AND COALESCE(p.display_main_role_rating, p.rating) IS NOT NULL
                  AND COALESCE(p.display_main_role_rating, p.rating)::text <> 'NaN'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM IOSCA_PLAYERS owner
                      JOIN LATERAL jsonb_array_elements_text(COALESCE(owner.linked_steam_ids, '[]'::jsonb)) AS linked(value) ON TRUE
                      WHERE lower(trim(linked.value)) = lower(trim(p.steam_id::text))
                        AND lower(trim(owner.steam_id::text)) <> lower(trim(p.steam_id::text))
                  )
                ORDER BY COALESCE(p.display_main_role_rating, p.rating) DESC NULLS LAST, p.discord_name ASC
                LIMIT $1
                """,
                limit,
            )
        except Exception:
            rows = await conn.fetch(
                """
                WITH latest_pos AS (
                    SELECT DISTINCT ON (steam_id)
                        steam_id,
                        UPPER(NULLIF(TRIM(position), '')) AS position
                    FROM PLAYER_MATCH_DATA
                    WHERE position IS NOT NULL AND position <> ''
                    ORDER BY steam_id, updated_at DESC NULLS LAST, id DESC
                ),
                player_totals AS (
                    SELECT
                        steam_id,
                        COUNT(DISTINCT match_id::text) AS total_appearances,
                        COALESCE(SUM(time_played), 0) AS total_minutes,
                        MAX(updated_at) AS last_match_at
                    FROM PLAYER_MATCH_DATA
                    GROUP BY steam_id
                ),
                team_members AS (
                    SELECT DISTINCT ON (member_id)
                        member_id,
                        t.guild_id,
                        t.guild_name,
                        t.guild_icon
                    FROM IOSCA_TEAMS t
                    JOIN LATERAL jsonb_array_elements(COALESCE(t.players, '[]'::jsonb)) AS roster(entry) ON TRUE
                    CROSS JOIN LATERAL (
                        SELECT NULLIF(TRIM(roster.entry->>'id'), '') AS member_id
                    ) AS member
                    WHERE member.member_id IS NOT NULL
                    ORDER BY member_id, t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.guild_name ASC
                )
                SELECT
                    p.steam_id,
                    p.discord_id,
                    p.discord_name,
                    COALESCE(lp.position, 'N/A') AS position,
                    NULL::text AS main_role,
                    p.rating,
                    p.rating AS legacy_rating,
                    NULL::numeric AS main_role_rating,
                    NULL::numeric AS display_main_role_rating,
                    COALESCE(pt.total_appearances, 0) AS total_appearances,
                    COALESCE(pt.total_minutes, 0) AS total_minutes,
                    p.registered_at,
                    p.last_active,
                    COALESCE(pt.last_match_at, p.last_active) AS last_match_at,
                    tm.guild_id AS current_team_id,
                    tm.guild_name AS current_team_name,
                    tm.guild_icon AS current_team_icon
                FROM IOSCA_PLAYERS p
                LEFT JOIN latest_pos lp ON lp.steam_id = p.steam_id
                LEFT JOIN player_totals pt ON pt.steam_id = p.steam_id
                LEFT JOIN team_members tm ON tm.member_id = p.discord_id::text
                WHERE p.discord_id IS NOT NULL
                  AND p.rating IS NOT NULL
                  AND p.rating::text <> 'NaN'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM IOSCA_PLAYERS owner
                      JOIN LATERAL jsonb_array_elements_text(COALESCE(owner.linked_steam_ids, '[]'::jsonb)) AS linked(value) ON TRUE
                      WHERE lower(trim(linked.value)) = lower(trim(p.steam_id::text))
                        AND lower(trim(owner.steam_id::text)) <> lower(trim(p.steam_id::text))
                  )
                ORDER BY p.rating DESC NULLS LAST, p.discord_name ASC
                LIMIT $1
                """,
                limit,
            )

    payload = _records_to_dicts(rows)
    await _decorate_public_players(payload, enrich_limit=500)
    return {"players": payload}


@app.get("/api/players/{steam_id}")
async def player_detail(steam_id: str) -> dict[str, Any]:
    async with db.acquire() as conn:
        player = await conn.fetchrow(
            """
            WITH resolved_player AS (
                SELECT p.*
                FROM IOSCA_PLAYERS p
                WHERE p.steam_id = $1
                   OR EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(COALESCE(p.linked_steam_ids, '[]'::jsonb)) AS linked(value)
                        WHERE linked.value = $1
                   )
                ORDER BY CASE WHEN p.steam_id = $1 THEN 0 ELSE 1 END
                LIMIT 1
            ),
            scoped_steam_ids AS (
                SELECT rp.steam_id AS steam_id
                FROM resolved_player rp
                UNION
                SELECT linked.value AS steam_id
                FROM resolved_player rp
                JOIN LATERAL jsonb_array_elements_text(COALESCE(rp.linked_steam_ids, '[]'::jsonb)) AS linked(value) ON TRUE
            ),
            latest_pos AS (
                SELECT
                    NULLIF(position, '') AS position
                FROM PLAYER_MATCH_DATA
                WHERE steam_id = ANY(ARRAY(SELECT steam_id FROM scoped_steam_ids))
                  AND position IS NOT NULL AND position <> ''
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
            )
            SELECT
                rp.steam_id,
                rp.discord_id,
                rp.discord_name,
                rp.linked_steam_ids,
                COALESCE(lp.position, 'N/A') AS position,
                COALESCE(rp.display_main_role_rating, rp.rating, 5.0) AS rating,
                rp.main_role,
                rp.atk_rating,
                rp.mid_rating,
                rp.def_rating,
                rp.gk_rating,
                rp.total_appearances,
                rp.total_minutes,
                rp.rating_updated_at,
                rp.registered_at,
                rp.last_active,
                rp.last_match_at
            FROM resolved_player rp
            LEFT JOIN latest_pos lp ON TRUE
            """,
            steam_id,
        )
        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        canonical_steam_id = str(player.get("steam_id") or steam_id)
        linked_ids = _parse_json(player.get("linked_steam_ids"), [])
        if not isinstance(linked_ids, list):
            linked_ids = []
        steam_scope = [canonical_steam_id]
        steam_scope.extend(str(s).strip() for s in linked_ids if str(s).strip())
        steam_scope = list(dict.fromkeys(steam_scope))

        totals = await conn.fetchrow(
            """
            SELECT
                COUNT(DISTINCT match_id::text) AS matches_played,
                COALESCE(SUM(goals), 0) AS goals,
                COALESCE(SUM(assists), 0) AS assists,
                COALESCE(SUM(second_assists), 0) AS second_assists,
                COALESCE(SUM(shots), 0) AS shots,
                COALESCE(SUM(shots_on_goal), 0) AS shots_on_goal,
                COALESCE(SUM(chances_created), 0) AS chances_created,
                COALESCE(SUM(key_passes), 0) AS key_passes,
                COALESCE(SUM(passes_attempted), 0) AS passes_attempted,
                COALESCE(SUM(passes_completed), 0) AS passes_completed,
                COALESCE(SUM(corners), 0) AS corners,
                COALESCE(SUM(free_kicks), 0) AS free_kicks,
                COALESCE(SUM(keeper_saves), 0) AS keeper_saves,
                COALESCE(SUM(keeper_saves_caught), 0) AS keeper_saves_caught,
                COALESCE(SUM(goals_conceded), 0) AS goals_conceded,
                COALESCE(SUM(sliding_tackles_completed), 0) AS sliding_tackles_completed,
                COALESCE(SUM(tackles), 0) AS tackles,
                COALESCE(SUM(interceptions), 0) AS interceptions,
                COALESCE(SUM(fouls), 0) AS fouls,
                COALESCE(SUM(fouls_suffered), 0) AS fouls_suffered,
                COALESCE(SUM(offsides), 0) AS offsides,
                COALESCE(SUM(own_goals), 0) AS own_goals,
                COALESCE(SUM(yellow_cards), 0) AS yellow_cards,
                COALESCE(SUM(red_cards), 0) AS red_cards,
                COALESCE(SUM(penalties), 0) AS penalties,
                COALESCE(SUM(distance_covered), 0) AS distance_covered,
                COALESCE(SUM(possession), 0) AS possession,
                COALESCE(AVG(pass_accuracy), 0) AS avg_pass_accuracy,
                COALESCE(SUM(CASE WHEN status = 'started' THEN 1 ELSE 0 END), 0) AS started_matches,
                COALESCE(SUM(CASE WHEN status = 'substitute' THEN 1 ELSE 0 END), 0) AS substitute_matches,
                COALESCE(SUM(CASE WHEN status = 'on_bench' THEN 1 ELSE 0 END), 0) AS bench_matches,
                COALESCE(
                    SUM(
                        CASE
                            WHEN jsonb_typeof(clutch_actions) = 'array' THEN jsonb_array_length(clutch_actions)
                            ELSE 0
                        END
                    ),
                    0
                ) AS clutch_action_events,
                COALESCE(
                    SUM(
                        CASE
                            WHEN jsonb_typeof(sub_impact->'events') = 'array' THEN jsonb_array_length(sub_impact->'events')
                            ELSE 0
                        END
                    ),
                    0
                ) AS sub_impact_events,
                COALESCE(
                    SUM(
                        CASE
                            WHEN jsonb_typeof(sub_impact->'summary') = 'object'
                                 AND COALESCE(sub_impact->'summary'->>'goals', '') ~ '^-?\\d+(\\.\\d+)?$'
                            THEN (sub_impact->'summary'->>'goals')::numeric
                            ELSE 0
                        END
                    ),
                    0
                ) AS sub_impact_goals,
                COALESCE(
                    SUM(
                        CASE
                            WHEN jsonb_typeof(sub_impact->'summary') = 'object'
                                 AND COALESCE(sub_impact->'summary'->>'own_goals', '') ~ '^-?\\d+(\\.\\d+)?$'
                            THEN (sub_impact->'summary'->>'own_goals')::numeric
                            ELSE 0
                        END
                    ),
                    0
                ) AS sub_impact_own_goals
            FROM PLAYER_MATCH_DATA
            WHERE steam_id = ANY($1::text[])
            """,
            steam_scope,
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
                tmeta.tournament_name,
                CASE WHEN tmeta.tournament_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_tournament,
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
                pmd.pass_accuracy,
                pmd.match_rating,
                pmd.is_match_mvp,
                pmd.status,
                pmd.clutch_actions,
                pmd.sub_impact
            FROM PLAYER_MATCH_DATA pmd
            JOIN MATCH_STATS ms
              ON (
                   pmd.match_id::text = ms.match_id::text
                   OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = ms.id::bigint
              )
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = ms.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = ms.away_guild_id
            LEFT JOIN LATERAL (
                SELECT f.tournament_id, t.name AS tournament_name
                FROM TOURNAMENT_FIXTURES f
                JOIN TOURNAMENTS t ON t.id = f.tournament_id
                WHERE f.played_match_stats_id = ms.id
                ORDER BY f.id DESC
                LIMIT 1
            ) AS tmeta ON TRUE
            WHERE pmd.steam_id = ANY($1::text[])
            ORDER BY ms.datetime DESC
            LIMIT 20
            """,
            steam_scope,
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
            canonical_steam_id,
        )

        player_match_history_rows = await conn.fetch(
            """
            SELECT
                COALESCE(ms.match_id::text, ms.id::text) AS match_id,
                ms.id AS match_stats_id,
                ms.datetime,
                COALESCE(ht.guild_name, ms.home_team_name) AS home_team_name,
                COALESCE(at.guild_name, ms.away_team_name) AS away_team_name,
                ms.home_guild_id,
                ms.away_guild_id,
                ms.home_score,
                ms.away_score,
                ms.home_lineup,
                ms.away_lineup,
                ms.match_summary_home,
                ms.match_summary_away,
                ms.game_type,
                tmeta.tournament_name,
                CASE WHEN tmeta.tournament_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_tournament,
                pmd.guild_id,
                pmd.guild_team_name,
                pmd.player_name,
                pmd.steam_id,
                pmd.position,
                pmd.goals,
                pmd.assists,
                pmd.keeper_saves,
                pmd.tackles,
                pmd.interceptions,
                pmd.red_cards,
                pmd.yellow_cards,
                pmd.pass_accuracy,
                pmd.passes_completed,
                pmd.passes_attempted,
                pmd.match_rating,
                pmd.is_match_mvp,
                pmd.mvp_score,
                pmd.own_goals,
                pmd.status,
                pmd.clutch_actions,
                pmd.sub_impact
            FROM PLAYER_MATCH_DATA pmd
            JOIN MATCH_STATS ms
              ON (
                   pmd.match_id::text = ms.match_id::text
                   OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = ms.id::bigint
              )
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = ms.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = ms.away_guild_id
            LEFT JOIN LATERAL (
                SELECT f.tournament_id, t.name AS tournament_name
                FROM TOURNAMENT_FIXTURES f
                JOIN TOURNAMENTS t ON t.id = f.tournament_id
                WHERE f.played_match_stats_id = ms.id
                ORDER BY f.id DESC
                LIMIT 1
            ) AS tmeta ON TRUE
            WHERE pmd.steam_id = ANY($1::text[])
            ORDER BY
                ms.datetime DESC,
                CASE WHEN pmd.guild_id IS NULL THEN 1 ELSE 0 END,
                pmd.updated_at DESC NULLS LAST,
                pmd.id DESC
            """,
            steam_scope,
        )

        outcome = await conn.fetchrow(
            """
            SELECT
                COUNT(*) AS matches_played,
                COALESCE(
                    SUM(
                        CASE
                            WHEN pmd.guild_id::text = ms.home_guild_id::text AND ms.home_score > ms.away_score THEN 1
                            WHEN pmd.guild_id::text = ms.away_guild_id::text AND ms.away_score > ms.home_score THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS wins,
                COALESCE(SUM(CASE WHEN ms.home_score = ms.away_score THEN 1 ELSE 0 END), 0) AS draws,
                COALESCE(
                    SUM(
                        CASE
                            WHEN pmd.guild_id::text = ms.home_guild_id::text AND ms.home_score < ms.away_score THEN 1
                            WHEN pmd.guild_id::text = ms.away_guild_id::text AND ms.away_score < ms.home_score THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS losses
            FROM PLAYER_MATCH_DATA pmd
            JOIN MATCH_STATS ms
              ON (
                   pmd.match_id::text = ms.match_id::text
                   OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = ms.id::bigint
              )
            WHERE pmd.steam_id = ANY($1::text[])
            """,
            steam_scope,
        )

        role_assets: list[dict[str, Any]] = []
        emoji_assets: list[dict[str, Any]] = []
        main_guild_id = None
        try:
            main_discord = await conn.fetchrow(
                "SELECT guild_id FROM MAIN_DISCORD ORDER BY id ASC LIMIT 1"
            )
            main_guild_id = main_discord.get("guild_id") if main_discord else None
            team_guild_id = team.get("guild_id") if team else None
            candidate_asset_guild_ids = [gid for gid in [main_guild_id, team_guild_id] if gid is not None]
            if candidate_asset_guild_ids:
                asset_rows = await conn.fetch(
                    """
                    SELECT guild_id, asset_type, asset_key, discord_id, asset_name, raw_value
                    FROM SERVER_ASSETS
                    WHERE guild_id = ANY($1::bigint[])
                    ORDER BY
                        CASE WHEN asset_type = 'emoji' THEN 0 ELSE 1 END,
                        asset_key ASC
                    """,
                    candidate_asset_guild_ids,
                )
                for asset in _records_to_dicts(asset_rows):
                    if str(asset.get("asset_type") or "").lower() == "emoji":
                        emoji_assets.append(asset)
                    elif str(asset.get("asset_type") or "").lower() == "role":
                        role_assets.append(asset)
        except Exception:
            role_assets = []
            emoji_assets = []

    player_payload = _record_to_dict(player)
    player_payload["avatar_url"] = _discord_avatar_url(player_payload.get("discord_id"))
    player_payload["avatar_fallback_url"] = _default_discord_avatar(player_payload.get("discord_id"))
    player_payload["steam_profile_url"] = _steam_profile_url(canonical_steam_id)
    player_payload["display_avatar_url"] = player_payload.get("avatar_url")
    steam_data = await _get_steam_profile_data(canonical_steam_id)
    steam64 = steam_data.get("steam_id64") or _steam_to_steam64(canonical_steam_id)
    if steam64:
        player_payload["steam_id64"] = steam64
    if steam_data.get("steam_name"):
        player_payload["steam_name"] = steam_data.get("steam_name")
    steam_avatar_url = steam_data.get("steam_avatar_url") or _steam_avatar_proxy_url(steam64)
    if steam_avatar_url:
        player_payload["steam_avatar_url"] = steam_avatar_url
        player_payload["display_avatar_url"] = steam_avatar_url

    role_asset = _pick_position_asset(role_assets, player_payload.get("position"))
    emoji_asset = _pick_position_asset(emoji_assets, player_payload.get("position"))
    player_payload["role_badge"] = {
        "position": str(player_payload.get("position") or "").upper() or "N/A",
        "role_name": role_asset.get("asset_name") if role_asset else None,
        "role_key": role_asset.get("asset_key") if role_asset else None,
        "role_raw_value": role_asset.get("raw_value") if role_asset else None,
        "emoji_raw_value": emoji_asset.get("raw_value") if emoji_asset else None,
        "emoji_url": _asset_emoji_url(emoji_asset),
        "asset_guild_id": role_asset.get("guild_id") if role_asset else (emoji_asset.get("guild_id") if emoji_asset else None),
    }

    member_roles: list[dict[str, Any]] = []
    try:
        member_role_ids = await _get_discord_member_role_ids(main_guild_id, player_payload.get("discord_id"))
        if member_role_ids:
            role_assets_by_id = {
                str(asset.get("discord_id")): asset
                for asset in role_assets
                if str(asset.get("discord_id") or "").strip()
            }
            guild_role_map = await _get_discord_guild_role_map(main_guild_id)
            for role_id in member_role_ids:
                mapped_role_asset = role_assets_by_id.get(str(role_id))
                mapped_emoji_asset = _pick_emoji_for_role_asset(mapped_role_asset, emoji_assets)
                role_name = (
                    (mapped_role_asset.get("asset_name") if mapped_role_asset else None)
                    or guild_role_map.get(str(role_id))
                    or str(role_id)
                )
                member_roles.append(
                    {
                        "role_id": str(role_id),
                        "role_name": role_name,
                        "role_key": mapped_role_asset.get("asset_key") if mapped_role_asset else None,
                        "role_raw_value": mapped_role_asset.get("raw_value") if mapped_role_asset else None,
                        "emoji_raw_value": mapped_emoji_asset.get("raw_value") if mapped_emoji_asset else None,
                        "emoji_url": _asset_emoji_url(mapped_emoji_asset),
                    }
                )
    except Exception:
        member_roles = []
    player_payload["member_roles"] = member_roles

    totals_payload = _record_to_dict(totals)
    raw_history_rows = _records_to_dicts(player_match_history_rows)
    match_history_by_id: dict[str, dict[str, Any]] = {}
    for item in raw_history_rows:
        match_id = str(item.get("match_id") or item.get("match_stats_id") or "").strip()
        if not match_id or match_id in match_history_by_id:
            continue
        item["result"] = _match_result_for_side(
            _infer_side_from_player_match_row(item),
            item.get("home_score"),
            item.get("away_score"),
        )
        item["clutch_actions"] = _parse_json(item.get("clutch_actions"), [])
        item["sub_impact"] = _parse_json(item.get("sub_impact"), {})
        match_history_by_id[match_id] = item

    match_history = list(match_history_by_id.values())
    recent_payload = match_history[:20]
    recent_form = [
        str(item.get("result") or "").upper()
        for item in recent_payload
        if str(item.get("result") or "").upper() in {"W", "D", "L"}
    ][:5]

    matches_played = len(match_history)
    wins = sum(1 for item in match_history if item.get("result") == "W")
    draws = sum(1 for item in match_history if item.get("result") == "D")
    losses = sum(1 for item in match_history if item.get("result") == "L")
    win_rate = round((wins / matches_played) * 100, 1) if matches_played > 0 else 0.0
    total_goals = int(totals_payload.get("goals") or 0)
    total_assists = int(totals_payload.get("assists") or 0)
    clutch_action_events = int(totals_payload.get("clutch_action_events") or 0)
    sub_impact_events = int(totals_payload.get("sub_impact_events") or 0)
    started_matches = int(totals_payload.get("started_matches") or 0)
    substitute_matches = int(totals_payload.get("substitute_matches") or 0)
    bench_matches = int(totals_payload.get("bench_matches") or 0)

    activity_daily_counts: dict[str, int] = {}
    for item in match_history:
        date_key = str(item.get("datetime") or "")[:10]
        if date_key:
            activity_daily_counts[date_key] = activity_daily_counts.get(date_key, 0) + 1

    record_definitions = [
        ("highest_goals", "Highest Goals", "goals"),
        ("most_completed_passes", "Most Completed Passes", "passes_completed"),
        ("most_interceptions", "Most Interceptions", "interceptions"),
        ("most_saves", "Most Saves", "keeper_saves"),
        ("most_own_goals", "Most Own Goals", "own_goals"),
    ]
    player_records: list[dict[str, Any]] = []
    for key, label, stat_key in record_definitions:
        best_item = None
        best_value = None
        for item in match_history:
            value = _safe_int(item.get(stat_key))
            if best_value is None or value > best_value:
                best_item = item
                best_value = value
        if best_item is None or best_value is None:
            continue
        player_records.append(
            {
                "key": key,
                "label": label,
                "value": int(best_value),
                "match_id": best_item.get("match_id"),
                "match_stats_id": best_item.get("match_stats_id"),
                "datetime": best_item.get("datetime"),
                "home_team_name": best_item.get("home_team_name"),
                "away_team_name": best_item.get("away_team_name"),
                "home_score": best_item.get("home_score"),
                "away_score": best_item.get("away_score"),
                "game_type": best_item.get("game_type"),
                "tournament_name": best_item.get("tournament_name"),
                "is_tournament": bool(best_item.get("is_tournament")),
                "result": best_item.get("result"),
            }
        )

    player_summary = {
        "matches_played": matches_played,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "win_rate": win_rate,
        "form_last5": recent_form,
        "avg_goals_per_match": round((total_goals / matches_played), 2) if matches_played > 0 else 0.0,
        "avg_assists_per_match": round((total_assists / matches_played), 2) if matches_played > 0 else 0.0,
        "started_matches": started_matches,
        "substitute_matches": substitute_matches,
        "bench_matches": bench_matches,
        "clutch_action_events": clutch_action_events,
        "sub_impact_events": sub_impact_events,
        "sub_impact_goals": int(float(totals_payload.get("sub_impact_goals") or 0)),
        "sub_impact_own_goals": int(float(totals_payload.get("sub_impact_own_goals") or 0)),
    }

    rating_values = [
        float(item.get("match_rating"))
        for item in match_history
        if isinstance(item.get("match_rating"), (int, float))
    ]
    last10 = match_history[:10]
    form_trend = [
        {
            "match_id": item.get("match_id"),
            "date": item.get("datetime"),
            "opponent": (
                item.get("away_team_name")
                if _infer_side_from_player_match_row(item) == "home"
                else item.get("home_team_name")
            ),
            "result": item.get("result"),
            "rating": item.get("match_rating"),
            "goals": item.get("goals") or 0,
            "assists": item.get("assists") or 0,
        }
        for item in reversed(last10)
    ]

    def _attribute_score(value: float, cap: float) -> int:
        if cap <= 0:
            return 50
        return max(45, min(99, int(round(50 + (value / cap) * 49))))

    appearances = max(1, matches_played)
    role = str(player_payload.get("main_role") or "").upper()
    pace_seed = (
        float(player_payload.get("rating") or 5.0)
        + (float(totals_payload.get("distance_covered") or 0) / max(1, appearances) / 1000.0)
    )
    attributes = {
        "pace": _attribute_score(pace_seed, 12),
        "shooting": _attribute_score(total_goals / appearances, 1.6),
        "passing": _attribute_score((total_assists + int(totals_payload.get("key_passes") or 0)) / appearances, 3.5),
        "defense": _attribute_score((int(totals_payload.get("interceptions") or 0) + int(totals_payload.get("tackles") or 0)) / appearances, 8),
        "vision": _attribute_score((int(totals_payload.get("chances_created") or 0) + int(totals_payload.get("key_passes") or 0)) / appearances, 5),
        "clutch": _attribute_score((clutch_action_events + sub_impact_events) / appearances, 1.5),
    }
    if role == "GK":
        attributes["defense"] = max(attributes["defense"], _attribute_score(int(totals_payload.get("keeper_saves") or 0) / appearances, 8))

    streaks: list[dict[str, Any]] = []
    current_wins = 0
    for item in match_history:
        if item.get("result") == "W":
            current_wins += 1
        else:
            break
    if current_wins >= 2:
        streaks.append({"label": "Win streak", "value": current_wins, "unit": "matches"})
    recent5_goals = sum(_safe_int(item.get("goals")) for item in match_history[:5])
    if recent5_goals > 0:
        streaks.append({"label": "Goals in last 5", "value": recent5_goals, "unit": "goals"})
    recent7_motm = sum(1 for item in match_history[:7] if item.get("is_match_mvp"))
    if recent7_motm > 0:
        streaks.append({"label": "MOTM in last 7", "value": recent7_motm, "unit": "awards"})

    victim_map: dict[str, dict[str, Any]] = {}
    for item in match_history:
        side = _infer_side_from_player_match_row(item)
        opponent = item.get("away_team_name") if side == "home" else item.get("home_team_name")
        key = str(opponent or "Unknown")
        bucket = victim_map.setdefault(key, {"team_name": key, "goals": 0, "assists": 0, "matches": 0})
        bucket["goals"] += _safe_int(item.get("goals"))
        bucket["assists"] += _safe_int(item.get("assists"))
        bucket["matches"] += 1
    rival_victim = None
    if victim_map:
        rival_victim = max(victim_map.values(), key=lambda row: (row["goals"], row["assists"], row["matches"]))

    role_profiles = [
        ("Clinical Finisher", attributes["shooting"]),
        ("Creative Winger", max(attributes["pace"], attributes["vision"], attributes["passing"])),
        ("Ball Winning Midfielder", max(attributes["defense"], attributes["passing"])),
        ("Defensive Anchor", attributes["defense"]),
        ("Clutch Specialist", attributes["clutch"]),
    ]
    signature_role = max(role_profiles, key=lambda item: item[1])[0]

    trophies: list[dict[str, Any]] = []
    awards: list[dict[str, Any]] = []
    career_events: list[dict[str, Any]] = []
    try:
        async with db.acquire() as trophy_conn:
            trophy_rows = await trophy_conn.fetch(
                """
                SELECT trophy_type, title, subtitle, awarded_at, metadata
                FROM hub.trophies
                WHERE owner_type = 'player'
                  AND owner_key = ANY($1::text[])
                ORDER BY awarded_at DESC NULLS LAST, id DESC
                LIMIT 12
                """,
                steam_scope,
            )
            trophies = _records_to_dicts(trophy_rows)
            award_rows = await trophy_conn.fetch(
                """
                SELECT award_scope, award_key, title, subtitle, period_start, period_end, metadata
                FROM hub.awards
                WHERE owner_type = 'player'
                  AND owner_key = ANY($1::text[])
                ORDER BY period_end DESC NULLS LAST, created_at DESC, id DESC
                LIMIT 12
                """,
                steam_scope,
            )
            awards = _records_to_dicts(award_rows)
            career_rows = await trophy_conn.fetch(
                """
                SELECT event_type, title, details, event_at, metadata
                FROM hub.career_events
                WHERE steam_id = ANY($1::text[])
                ORDER BY event_at DESC, created_at DESC, id DESC
                LIMIT 20
                """,
                steam_scope,
            )
            career_events = _records_to_dicts(career_rows)
    except Exception:
        trophies = []
        awards = []
        career_events = []

    return {
        "player": player_payload,
        "totals": totals_payload,
        "recent_matches": recent_payload,
        "summary": player_summary,
        "attributes": attributes,
        "form_trend": form_trend,
        "streaks": streaks,
        "rival_victim": rival_victim,
        "signature_role": signature_role,
        "trophies": trophies,
        "awards": awards,
        "career_events": career_events,
        "activity": {
            "daily_counts": activity_daily_counts,
            "active_days": len(activity_daily_counts),
            "matches_played": matches_played,
        },
        "records": player_records,
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
                tmeta.tournament_id,
                tmeta.tournament_name
            FROM MATCH_STATS m
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
            LEFT JOIN LATERAL (
                SELECT f.tournament_id, t.name AS tournament_name
                FROM TOURNAMENT_FIXTURES f
                JOIN TOURNAMENTS t ON t.id = f.tournament_id
                WHERE f.played_match_stats_id = m.id
                ORDER BY f.id DESC
                LIMIT 1
            ) AS tmeta ON TRUE
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
                tmeta.tournament_id,
                tmeta.tournament_name
            FROM MATCH_STATS m
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
            LEFT JOIN LATERAL (
                SELECT f.tournament_id, t.name AS tournament_name
                FROM TOURNAMENT_FIXTURES f
                JOIN TOURNAMENTS t ON t.id = f.tournament_id
                WHERE f.played_match_stats_id = m.id
                ORDER BY f.id DESC
                LIMIT 1
            ) AS tmeta ON TRUE
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
            SELECT
                pmd.*,
                COALESCE(NULLIF(ip.discord_name, ''), NULLIF(pmd.player_name, ''), pmd.steam_id) AS player_name
            FROM PLAYER_MATCH_DATA pmd
            LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = pmd.steam_id
            WHERE (
                    pmd.match_id::text = $2::text
                    OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = $1::bigint
                  )
            ORDER BY
                pmd.updated_at DESC NULLS LAST,
                pmd.id DESC
            """,
            row_id,
            row_match_id,
        )
        try:
            vote_rows = await conn.fetch(
                """
                SELECT vote_type, target_key, COUNT(*)::int AS votes
                FROM hub.community_votes
                WHERE match_stats_id = $1
                GROUP BY vote_type, target_key
                ORDER BY vote_type, votes DESC, target_key
                """,
                row_id,
            )
        except Exception:
            vote_rows = []

    match_payload = _record_to_dict(row)
    match_payload["home_lineup"] = _parse_json(match_payload.get("home_lineup"), [])
    match_payload["away_lineup"] = _parse_json(match_payload.get("away_lineup"), [])
    match_payload["substitutions"] = _parse_json(match_payload.get("substitutions"), [])
    match_payload["match_summary_home"] = _parse_json(match_payload.get("match_summary_home"), [])
    match_payload["match_summary_away"] = _parse_json(match_payload.get("match_summary_away"), [])
    match_payload["comeback_flag"] = bool(match_payload.get("comeback_flag"))

    home_lineup_keys = _extract_lineup_identity_sets(match_payload.get("home_lineup"))
    away_lineup_keys = _extract_lineup_identity_sets(match_payload.get("away_lineup"))
    home_summary_keys = _extract_summary_identity_sets(match_payload.get("match_summary_home"))
    away_summary_keys = _extract_summary_identity_sets(match_payload.get("match_summary_away"))
    home_identity_keys = {
        "steam": set(home_lineup_keys["steam"]).union(home_summary_keys["steam"]),
        "name": set(home_lineup_keys["name"]).union(home_summary_keys["name"]),
    }
    away_identity_keys = {
        "steam": set(away_lineup_keys["steam"]).union(away_summary_keys["steam"]),
        "name": set(away_lineup_keys["name"]).union(away_summary_keys["name"]),
    }
    home_guild_key = str(match_payload.get("home_guild_id") or "").strip()
    away_guild_key = str(match_payload.get("away_guild_id") or "").strip()
    home_name_key = _norm_text_key(match_payload.get("home_team_name") or "")
    away_name_key = _norm_text_key(match_payload.get("away_team_name") or "")
    is_same_side_match = (
        (home_guild_key and away_guild_key and home_guild_key == away_guild_key)
        or (home_name_key and away_name_key and home_name_key == away_name_key)
    )

    consolidated_stats = _merge_match_player_rows(_records_to_dicts(stats))

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in consolidated_stats:
        side = "neutral"
        item_guild_key = str(item.get("guild_id") or "").strip()
        if is_same_side_match:
            side = _infer_side_from_lineup(item, home_identity_keys, away_identity_keys)
        else:
            if item_guild_key and item_guild_key == home_guild_key:
                side = "home"
            elif item_guild_key and item_guild_key == away_guild_key:
                side = "away"
            else:
                side = _infer_side_from_lineup(item, home_identity_keys, away_identity_keys)
        grouped[side].append(item)

    all_player_stats = (
        grouped.get("home", [])
        + grouped.get("away", [])
        + grouped.get("neutral", [])
    )
    _attach_match_ratings(all_player_stats)

    mvp_payload: dict[str, Any] | None = None
    persisted_mvp = [p for p in all_player_stats if p.get("is_match_mvp")]
    if persisted_mvp:
        best = max(
            persisted_mvp,
            key=lambda p: float(p.get("mvp_score") if p.get("mvp_score") is not None else (p.get("match_rating") or 0)),
        )
        mvp_payload = {
            "name": best.get("player_name") or "Unknown",
            "position": str(best.get("position") or "").upper(),
            "score": float(best.get("mvp_score") if best.get("mvp_score") is not None else (best.get("match_rating") or 0)),
            "stats": _normalize_mvp_stats(best.get("mvp_key_stats")),
        }
    elif shared_get_mvp_data:
        try:
            mvp_payload = shared_get_mvp_data(all_player_stats)
        except Exception:
            mvp_payload = None

    if mvp_payload:
        mvp_name = str(mvp_payload.get("name") or "").strip().lower()
        mvp_pos = str(mvp_payload.get("position") or "").strip().upper()
        linked = None
        for player in all_player_stats:
            player_name = str(player.get("player_name") or "").strip().lower()
            player_pos = str(player.get("position") or "").strip().upper()
            if player_name == mvp_name and (not mvp_pos or player_pos == mvp_pos):
                linked = player
                break
        if linked:
            mvp_payload = {
                **mvp_payload,
                **linked,
                "mvp_score": mvp_payload.get("score"),
                "mvp_stats": _normalize_mvp_stats(mvp_payload.get("stats", [])),
            }

    summary_home_events = _build_team_event_items_from_summary(match_payload.get("match_summary_home"))
    summary_away_events = _build_team_event_items_from_summary(match_payload.get("match_summary_away"))
    row_home_events = _build_team_event_items(grouped.get("home", []))
    row_away_events = _build_team_event_items(grouped.get("away", []))
    summary_events_duplicated = (
        bool(summary_home_events)
        and bool(summary_away_events)
        and _event_items_signature(summary_home_events) == _event_items_signature(summary_away_events)
    )
    prefer_row_events = is_same_side_match or summary_events_duplicated
    home_events_payload = row_home_events if prefer_row_events and row_home_events else (summary_home_events or row_home_events)
    away_events_payload = row_away_events if prefer_row_events and row_away_events else (summary_away_events or row_away_events)

    def _performer_score(player: dict[str, Any]) -> float:
        rating = player.get("match_rating")
        if isinstance(rating, (int, float)):
            return float(rating)
        return (
            5.0
            + _safe_int(player.get("goals")) * 1.1
            + _safe_int(player.get("assists")) * 0.8
            + _safe_int(player.get("keeper_saves")) * 0.22
            + _safe_int(player.get("interceptions")) * 0.16
            + _safe_int(player.get("tackles")) * 0.12
        )

    top_performers = []
    for player in sorted(all_player_stats, key=_performer_score, reverse=True)[:3]:
        top_performers.append(
            {
                "steam_id": player.get("steam_id"),
                "player_name": player.get("player_name"),
                "position": player.get("position"),
                "guild_id": player.get("guild_id"),
                "rating": round(_performer_score(player), 1),
                "goals": _safe_int(player.get("goals")),
                "assists": _safe_int(player.get("assists")),
                "saves": _safe_int(player.get("keeper_saves")),
                "tackles": _safe_int(player.get("tackles")),
                "interceptions": _safe_int(player.get("interceptions")),
            }
        )

    def _side_captain_candidate(side_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not side_rows:
            return None
        return sorted(side_rows, key=_performer_score, reverse=True)[0]

    home_duel = _side_captain_candidate(grouped.get("home", []))
    away_duel = _side_captain_candidate(grouped.get("away", []))
    duel = None
    if home_duel and away_duel:
        duel = {
            "home": {
                "player_name": home_duel.get("player_name"),
                "rating": round(_performer_score(home_duel), 1),
                "goals": _safe_int(home_duel.get("goals")),
                "passes": _safe_int(home_duel.get("passes_completed")),
                "tackles": _safe_int(home_duel.get("tackles")) + _safe_int(home_duel.get("interceptions")),
            },
            "away": {
                "player_name": away_duel.get("player_name"),
                "rating": round(_performer_score(away_duel), 1),
                "goals": _safe_int(away_duel.get("goals")),
                "passes": _safe_int(away_duel.get("passes_completed")),
                "tackles": _safe_int(away_duel.get("tackles")) + _safe_int(away_duel.get("interceptions")),
            },
        }

    timeline_items = []
    for side, events in (("home", home_events_payload), ("away", away_events_payload)):
        for event in events or []:
            kind = str(event.get("kind") or event.get("type") or "").lower()
            if kind not in {"goal", "own_goal", "red", "yellow"}:
                continue
            minutes = event.get("minutes") if isinstance(event.get("minutes"), list) else [event.get("minute")]
            for minute in minutes:
                minute_int = _safe_int(minute)
                timeline_items.append(
                    {
                        "side": side,
                        "kind": kind,
                        "minute": minute_int if minute_int > 0 else None,
                        "player_name": event.get("name") or event.get("player_name"),
                    }
                )
    timeline_items.sort(key=lambda item: item.get("minute") or 999)

    turning_point = None
    red_event = next((item for item in timeline_items if item["kind"] == "red"), None)
    late_goal = next((item for item in reversed(timeline_items) if item["kind"] in {"goal", "own_goal"} and (item.get("minute") or 0) >= 70), None)
    if red_event:
        turning_point = f"Red card at {red_event.get('minute') or '?'}' changed the match rhythm."
    elif bool(match_payload.get("comeback_flag")):
        turning_point = "The winner had to recover from behind."
    elif late_goal:
        turning_point = f"Late goal at {late_goal.get('minute')}' decided the closing stretch."
    else:
        turning_point = "Control came from the stronger all-around performer group."

    home_score = _safe_int(match_payload.get("home_score"))
    away_score = _safe_int(match_payload.get("away_score"))
    records_triggered = []
    if home_score + away_score >= 8:
        records_triggered.append("High-scoring match")
    if abs(home_score - away_score) >= 5:
        records_triggered.append("Statement win")
    if bool(match_payload.get("comeback_flag")):
        records_triggered.append("Comeback result")

    momentum = [
        {"label": "Opening", "home": len([e for e in timeline_items if e["side"] == "home" and (e.get("minute") or 0) <= 30]), "away": len([e for e in timeline_items if e["side"] == "away" and (e.get("minute") or 0) <= 30])},
        {"label": "Middle", "home": len([e for e in timeline_items if e["side"] == "home" and 31 <= (e.get("minute") or 0) <= 65]), "away": len([e for e in timeline_items if e["side"] == "away" and 31 <= (e.get("minute") or 0) <= 65])},
        {"label": "Closing", "home": len([e for e in timeline_items if e["side"] == "home" and (e.get("minute") or 0) >= 66]), "away": len([e for e in timeline_items if e["side"] == "away" and (e.get("minute") or 0) >= 66])},
    ]
    community_votes: dict[str, list[dict[str, Any]]] = {}
    for vote in _records_to_dicts(vote_rows):
        vote_type = str(vote.get("vote_type") or "vote")
        community_votes.setdefault(vote_type, []).append(
            {
                "target_key": vote.get("target_key"),
                "votes": _safe_int(vote.get("votes")),
            }
        )

    return {
        "match": match_payload,
        "player_stats": {
            "home": grouped.get("home", []),
            "away": grouped.get("away", []),
            "neutral": grouped.get("neutral", []),
        },
        "mvp": mvp_payload,
        "team_events": {
            "home": home_events_payload,
            "away": away_events_payload,
        },
        "story": {
            "top_performers": top_performers,
            "duel": duel,
            "timeline": timeline_items,
            "turning_point": turning_point,
            "records_triggered": records_triggered,
            "momentum": momentum,
            "community_votes": community_votes,
        },
    }


@app.get("/api/match")
async def match_detail_query(id: str = Query(..., min_length=1)) -> dict[str, Any]:
    return await match_detail(id)


@app.get("/api/tournaments")
async def tournaments() -> dict[str, Any]:
    async with db.acquire() as conn:
        await _ensure_tournament_league_schema(conn)
        rows = await conn.fetch(
            """
            SELECT
                t.id,
                t.name,
                t.format,
                t.status,
                t.num_teams,
                t.league_count,
                t.created_at,
                t.updated_at,
                COALESCE(COUNT(DISTINCT tf.id), 0) AS fixtures_total,
                COALESCE(
                    COUNT(
                        DISTINCT CASE
                            WHEN COALESCE(tf.is_played, FALSE)
                              OR COALESCE(tf.is_draw_home, FALSE)
                              OR COALESCE(tf.is_draw_away, FALSE)
                              OR COALESCE(tf.is_forfeit_home, FALSE)
                              OR COALESCE(tf.is_forfeit_away, FALSE)
                            THEN tf.id
                        END
                    ),
                    0
                ) AS fixtures_played,
                COALESCE(
                    COUNT(
                        DISTINCT CASE
                            WHEN tf.played_match_stats_id IS NOT NULL THEN tf.played_match_stats_id
                        END
                    ),
                    0
                ) AS matches_linked
            FROM TOURNAMENTS t
            LEFT JOIN TOURNAMENT_FIXTURES tf ON tf.tournament_id = t.id
            GROUP BY t.id
            ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'ended' THEN 1 ELSE 2 END, t.updated_at DESC
            """
        )
    return {"tournaments": _records_to_dicts(rows)}


@app.get("/api/tournaments/{tournament_id}")
async def tournament_detail(tournament_id: int) -> dict[str, Any]:
    orphan_form_rows: list[dict[str, Any]] = []
    async with db.acquire() as conn:
        await _ensure_tournament_league_schema(conn)
        tournament = await conn.fetchrow("SELECT * FROM TOURNAMENTS WHERE id = $1", tournament_id)
        if not tournament:
            raise HTTPException(status_code=404, detail="Tournament not found")

        standings = await conn.fetch(
            """
            WITH teams AS (
                SELECT
                    tt.guild_id,
                    COALESCE(tt.league_key, 'A') AS league_key,
                    COALESCE(tt.team_name_snapshot, it.guild_name, CONCAT('Team ', tt.guild_id::text)) AS team_name,
                    COALESCE(tt.team_icon_snapshot, it.guild_icon, '') AS team_icon
                FROM TOURNAMENT_TEAMS tt
                LEFT JOIN IOSCA_TEAMS it ON it.guild_id = tt.guild_id
                WHERE tt.tournament_id = $1
            ),
            fixture_base AS (
                SELECT
                    f.id,
                    COALESCE(f.league_key, 'A') AS league_key,
                    f.home_guild_id,
                    f.away_guild_id,
                    COALESCE(ht.guild_name, f.home_name_raw, '') AS home_name,
                    COALESCE(at.guild_name, f.away_name_raw, '') AS away_name,
                    f.played_match_stats_id,
                    COALESCE(f.is_draw_home, FALSE) AS is_draw_home,
                    COALESCE(f.is_draw_away, FALSE) AS is_draw_away,
                    COALESCE(f.is_forfeit_home, FALSE) AS is_forfeit_home,
                    COALESCE(f.is_forfeit_away, FALSE) AS is_forfeit_away,
                    COALESCE(f.forfeit_score, 10)::int AS forfeit_score
                FROM TOURNAMENT_FIXTURES f
                LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
                LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
                WHERE f.tournament_id = $1
                  AND f.home_guild_id IS NOT NULL
                  AND f.away_guild_id IS NOT NULL
                  AND (
                        COALESCE(f.is_played, FALSE) = TRUE
                     OR f.played_match_stats_id IS NOT NULL
                     OR COALESCE(f.is_draw_home, FALSE) = TRUE
                     OR COALESCE(f.is_draw_away, FALSE) = TRUE
                     OR COALESCE(f.is_forfeit_home, FALSE) = TRUE
                     OR COALESCE(f.is_forfeit_away, FALSE) = TRUE
                  )
            ),
            played_matches AS (
                SELECT
                    fb.league_key,
                    fb.home_guild_id AS home_id,
                    fb.away_guild_id AS away_id,
                    CASE
                        WHEN m.home_guild_id = fb.home_guild_id THEN COALESCE(m.home_score, 0)::int
                        WHEN m.away_guild_id = fb.home_guild_id THEN COALESCE(m.away_score, 0)::int
                        WHEN regexp_replace(lower(COALESCE(m.home_team_name, '')), '[^a-z0-9]+', '', 'g')
                           = regexp_replace(lower(COALESCE(fb.home_name, '')), '[^a-z0-9]+', '', 'g')
                        THEN COALESCE(m.home_score, 0)::int
                        WHEN regexp_replace(lower(COALESCE(m.away_team_name, '')), '[^a-z0-9]+', '', 'g')
                           = regexp_replace(lower(COALESCE(fb.home_name, '')), '[^a-z0-9]+', '', 'g')
                        THEN COALESCE(m.away_score, 0)::int
                        ELSE COALESCE(m.home_score, 0)::int
                    END AS home_score,
                    CASE
                        WHEN m.home_guild_id = fb.away_guild_id THEN COALESCE(m.home_score, 0)::int
                        WHEN m.away_guild_id = fb.away_guild_id THEN COALESCE(m.away_score, 0)::int
                        WHEN regexp_replace(lower(COALESCE(m.home_team_name, '')), '[^a-z0-9]+', '', 'g')
                           = regexp_replace(lower(COALESCE(fb.away_name, '')), '[^a-z0-9]+', '', 'g')
                        THEN COALESCE(m.home_score, 0)::int
                        WHEN regexp_replace(lower(COALESCE(m.away_team_name, '')), '[^a-z0-9]+', '', 'g')
                           = regexp_replace(lower(COALESCE(fb.away_name, '')), '[^a-z0-9]+', '', 'g')
                        THEN COALESCE(m.away_score, 0)::int
                        ELSE COALESCE(m.away_score, 0)::int
                    END AS away_score
                FROM fixture_base fb
                JOIN MATCH_STATS m ON m.id = fb.played_match_stats_id
                WHERE COALESCE(fb.is_draw_home, FALSE) = FALSE
                  AND COALESCE(fb.is_draw_away, FALSE) = FALSE
                  AND COALESCE(fb.is_forfeit_home, FALSE) = FALSE
                  AND COALESCE(fb.is_forfeit_away, FALSE) = FALSE
            ),
            manual_draw_matches AS (
                SELECT
                    fb.league_key,
                    fb.home_guild_id AS home_id,
                    fb.away_guild_id AS away_id,
                    0::int AS home_score,
                    0::int AS away_score
                FROM fixture_base fb
                WHERE COALESCE(fb.is_draw_home, FALSE) = TRUE
                  AND COALESCE(fb.is_draw_away, FALSE) = TRUE
            ),
            manual_forfeit_matches AS (
                SELECT
                    fb.league_key,
                    fb.home_guild_id AS home_id,
                    fb.away_guild_id AS away_id,
                    CASE WHEN COALESCE(fb.is_forfeit_home, FALSE) THEN 0::int ELSE fb.forfeit_score END AS home_score,
                    CASE WHEN COALESCE(fb.is_forfeit_away, FALSE) THEN 0::int ELSE fb.forfeit_score END AS away_score
                FROM fixture_base fb
                WHERE COALESCE(fb.is_forfeit_home, FALSE) = TRUE
                   OR COALESCE(fb.is_forfeit_away, FALSE) = TRUE
            ),
            all_matches AS (
                SELECT * FROM played_matches
                UNION ALL
                SELECT * FROM manual_draw_matches
                UNION ALL
                SELECT * FROM manual_forfeit_matches
            ),
            team_rows AS (
                SELECT
                    league_key,
                    home_id AS guild_id,
                    1 AS matches_played,
                    CASE WHEN home_score > away_score THEN 1 ELSE 0 END AS wins,
                    CASE WHEN home_score = away_score THEN 1 ELSE 0 END AS draws,
                    CASE WHEN home_score < away_score THEN 1 ELSE 0 END AS losses,
                    home_score AS goals_for,
                    away_score AS goals_against
                FROM all_matches
                UNION ALL
                SELECT
                    league_key,
                    away_id AS guild_id,
                    1 AS matches_played,
                    CASE WHEN away_score > home_score THEN 1 ELSE 0 END AS wins,
                    CASE WHEN away_score = home_score THEN 1 ELSE 0 END AS draws,
                    CASE WHEN away_score < home_score THEN 1 ELSE 0 END AS losses,
                    away_score AS goals_for,
                    home_score AS goals_against
                FROM all_matches
            ),
            agg AS (
                SELECT
                    league_key,
                    guild_id,
                    SUM(matches_played)::int AS matches_played,
                    SUM(wins)::int AS wins,
                    SUM(draws)::int AS draws,
                    SUM(losses)::int AS losses,
                    SUM(goals_for)::int AS goals_for,
                    SUM(goals_against)::int AS goals_against
                FROM team_rows
                GROUP BY league_key, guild_id
            ),
            points_cfg AS (
                SELECT
                    COALESCE(t.points_win, 3)::int AS points_win,
                    COALESCE(t.points_draw, 1)::int AS points_draw,
                    COALESCE(t.points_loss, 0)::int AS points_loss
                FROM TOURNAMENTS t
                WHERE t.id = $1
            )
            SELECT
                t.guild_id,
                t.league_key,
                t.team_name,
                t.team_icon,
                COALESCE(a.matches_played, 0) AS matches_played,
                COALESCE(a.wins, 0) AS wins,
                COALESCE(a.draws, 0) AS draws,
                COALESCE(a.losses, 0) AS losses,
                COALESCE(a.goals_for, 0) AS goals_for,
                COALESCE(a.goals_against, 0) AS goals_against,
                (COALESCE(a.goals_for, 0) - COALESCE(a.goals_against, 0)) AS goal_diff,
                (
                    COALESCE(a.wins, 0) * pc.points_win +
                    COALESCE(a.draws, 0) * pc.points_draw +
                    COALESCE(a.losses, 0) * pc.points_loss
                ) AS points
            FROM teams t
            CROSS JOIN points_cfg pc
            LEFT JOIN agg a ON a.guild_id = t.guild_id AND a.league_key = t.league_key
            ORDER BY t.league_key ASC, points DESC, goal_diff DESC, goals_for DESC, team_name ASC
            """,
            tournament_id,
        )

        fixtures = await conn.fetch(
            """
            SELECT
                f.id,
                COALESCE(f.league_key, 'A') AS league_key,
                f.week_number,
                f.week_label,
                f.is_active,
                f.is_played,
                COALESCE(f.is_draw_home, FALSE) AS is_draw_home,
                COALESCE(f.is_draw_away, FALSE) AS is_draw_away,
                COALESCE(f.is_forfeit_home, FALSE) AS is_forfeit_home,
                COALESCE(f.is_forfeit_away, FALSE) AS is_forfeit_away,
                COALESCE(f.forfeit_score, 10)::int AS forfeit_score,
                f.played_match_stats_id,
                f.played_at,
                f.home_guild_id,
                f.away_guild_id,
                CASE
                    WHEN COALESCE(f.is_draw_home, FALSE) OR COALESCE(f.is_draw_away, FALSE) THEN 0::int
                    WHEN COALESCE(f.is_forfeit_home, FALSE) THEN 0::int
                    WHEN COALESCE(f.is_forfeit_away, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                    WHEN m.id IS NOT NULL THEN
                        CASE
                            WHEN m.home_guild_id = f.home_guild_id THEN COALESCE(m.home_score, 0)::int
                            WHEN m.away_guild_id = f.home_guild_id THEN COALESCE(m.away_score, 0)::int
                            WHEN regexp_replace(lower(COALESCE(m.home_team_name, '')), '[^a-z0-9]+', '', 'g')
                               = regexp_replace(lower(COALESCE(ht.guild_name, f.home_name_raw, '')), '[^a-z0-9]+', '', 'g')
                            THEN COALESCE(m.home_score, 0)::int
                            WHEN regexp_replace(lower(COALESCE(m.away_team_name, '')), '[^a-z0-9]+', '', 'g')
                               = regexp_replace(lower(COALESCE(ht.guild_name, f.home_name_raw, '')), '[^a-z0-9]+', '', 'g')
                            THEN COALESCE(m.away_score, 0)::int
                            ELSE COALESCE(m.home_score, 0)::int
                        END
                    ELSE NULL::int
                END AS home_score,
                CASE
                    WHEN COALESCE(f.is_draw_home, FALSE) OR COALESCE(f.is_draw_away, FALSE) THEN 0::int
                    WHEN COALESCE(f.is_forfeit_away, FALSE) THEN 0::int
                    WHEN COALESCE(f.is_forfeit_home, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                    WHEN m.id IS NOT NULL THEN
                        CASE
                            WHEN m.home_guild_id = f.away_guild_id THEN COALESCE(m.home_score, 0)::int
                            WHEN m.away_guild_id = f.away_guild_id THEN COALESCE(m.away_score, 0)::int
                            WHEN regexp_replace(lower(COALESCE(m.home_team_name, '')), '[^a-z0-9]+', '', 'g')
                               = regexp_replace(lower(COALESCE(at.guild_name, f.away_name_raw, '')), '[^a-z0-9]+', '', 'g')
                            THEN COALESCE(m.home_score, 0)::int
                            WHEN regexp_replace(lower(COALESCE(m.away_team_name, '')), '[^a-z0-9]+', '', 'g')
                               = regexp_replace(lower(COALESCE(at.guild_name, f.away_name_raw, '')), '[^a-z0-9]+', '', 'g')
                            THEN COALESCE(m.away_score, 0)::int
                            ELSE COALESCE(m.away_score, 0)::int
                        END
                    ELSE NULL::int
                END AS away_score,
                m.datetime AS match_datetime,
                (COALESCE(f.is_forfeit_home, FALSE) OR COALESCE(f.is_forfeit_away, FALSE)) AS is_forfeit,
                COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
                COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon
            FROM TOURNAMENT_FIXTURES f
            LEFT JOIN MATCH_STATS m ON m.id = f.played_match_stats_id
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
            WHERE f.tournament_id = $1
            ORDER BY f.league_key ASC, f.week_number NULLS LAST, f.id ASC
            """,
            tournament_id,
        )

        teams = await conn.fetch(
            """
            SELECT
                tt.guild_id,
                COALESCE(tt.league_key, 'A') AS league_key,
                COALESCE(tt.team_name_snapshot, it.guild_name) AS team_name,
                COALESCE(tt.team_icon_snapshot, it.guild_icon, '') AS team_icon,
                it.captain_name
            FROM TOURNAMENT_TEAMS tt
            LEFT JOIN IOSCA_TEAMS it ON it.guild_id = tt.guild_id
            WHERE tt.tournament_id = $1
            ORDER BY tt.league_key ASC, team_name ASC
            """,
            tournament_id,
        )

        def _is_steam_like(value: Any) -> bool:
            raw = str(value or "").strip()
            if not raw:
                return False
            upper = raw.upper()
            if upper.startswith("STEAM_"):
                return True
            if raw.startswith("[") and raw.endswith("]") and upper.startswith("[U:"):
                return True
            return raw.isdigit() and len(raw) >= 16

        def _leader_display_name(row: dict[str, Any]) -> str:
            for candidate in [row.get("discord_name"), row.get("player_name")]:
                text = str(candidate or "").strip()
                if text and not _is_steam_like(text):
                    return text
            steam_id = str(row.get("steam_id") or "").strip()
            return steam_id or "Unknown Player"

        async def _fetch_leader_metric(
            total_expr: str,
            *,
            fallback_expr: str | None = None,
            extra_where: str = "",
            league_key: str | None = None,
        ) -> list[dict[str, Any]]:
            query_params: list[Any] = [tournament_id]
            league_filter = ""
            if league_key:
                query_params.append(_normalize_tournament_league_key(league_key))
                league_filter = f"AND COALESCE(fx.league_key, 'A') = ${len(query_params)}"
            rows = await conn.fetch(
                f"""
                SELECT
                    pmd.steam_id,
                    MAX(ip.discord_id)::text AS discord_id,
                    MAX(NULLIF(ip.discord_name, '')) AS discord_name,
                    MAX(COALESCE(NULLIF(ip.discord_name, ''), pmd.steam_id)) AS player_name,
                    SUM({total_expr}) AS total
                FROM TOURNAMENT_FIXTURES fx
                JOIN MATCH_STATS m ON m.id = fx.played_match_stats_id
                JOIN PLAYER_MATCH_DATA pmd
                  ON (
                       pmd.match_id::text = m.match_id::text
                       OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = m.id::bigint
                  )
                LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = pmd.steam_id
                WHERE fx.tournament_id = $1
                  AND fx.played_match_stats_id IS NOT NULL
                  AND COALESCE(fx.is_forfeit_home, FALSE) = FALSE
                  AND COALESCE(fx.is_forfeit_away, FALSE) = FALSE
                {league_filter}
                {extra_where}
                GROUP BY pmd.steam_id
                ORDER BY total DESC, player_name ASC
                LIMIT 30
                """,
                *query_params,
            )
            payload = _records_to_dicts(rows)
            payload = [row for row in payload if _safe_int(row.get("total")) > 0]

            if not payload and fallback_expr and not league_key:
                fallback_rows = await conn.fetch(
                    f"""
                    SELECT
                        steam_id,
                        MAX(discord_id)::text AS discord_id,
                        NULL::text AS discord_name,
                        MAX(COALESCE(NULLIF(player_name, ''), steam_id)) AS player_name,
                        SUM({fallback_expr}) AS total
                    FROM TOURNAMENT_PLAYER_STATS
                    WHERE tournament_id = $1
                    GROUP BY steam_id
                    ORDER BY total DESC, player_name ASC
                    LIMIT 30
                    """,
                    tournament_id,
                )
                payload = _records_to_dicts(fallback_rows)
                payload = [row for row in payload if _safe_int(row.get("total")) > 0]

            for row in payload:
                row["display_name"] = _leader_display_name(row)
            return payload[:10]

        def _leaders_bundle_for_league(league_key: str | None = None) -> dict[str, list[dict[str, Any]]]:
            return {
                "goals": [],
                "assists": [],
                "passes": [],
                "defenders": [],
                "goalkeepers": [],
                "mvps": [],
            }

        leader_goals = await _fetch_leader_metric(
            "COALESCE(pmd.goals, 0)",
            fallback_expr="COALESCE(goals, 0)",
        )
        leader_assists = await _fetch_leader_metric(
            "COALESCE(pmd.assists, 0) + COALESCE(pmd.second_assists, 0)",
            fallback_expr="COALESCE(assists, 0) + COALESCE(second_assists, 0)",
        )
        leader_passes = await _fetch_leader_metric(
            "COALESCE(pmd.passes_completed, 0)",
        )
        leader_defenders = await _fetch_leader_metric(
            "COALESCE(pmd.tackles, 0) + COALESCE(pmd.interceptions, 0)",
            fallback_expr="COALESCE(tackles, 0) + COALESCE(interceptions, 0)",
        )
        leader_goalkeepers = await _fetch_leader_metric(
            "COALESCE(pmd.keeper_saves, 0) + COALESCE(pmd.keeper_saves_caught, 0)",
            extra_where="AND UPPER(COALESCE(pmd.position, '')) = 'GK'",
        )

        mvp_leaders: list[dict[str, Any]] = []
        league_mvp_counts: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
        if shared_get_mvp_data:
            match_rows = await conn.fetch(
                """
                SELECT
                    fx.played_match_stats_id AS match_stats_id,
                    COALESCE(fx.league_key, 'A') AS league_key,
                    pmd.steam_id,
                    pmd.guild_id,
                    COALESCE(NULLIF(ip.discord_name, ''), pmd.steam_id) AS player_name,
                    ip.discord_name,
                    ip.discord_id::text AS discord_id,
                    pmd.position,
                    pmd.goals,
                    pmd.assists,
                    pmd.second_assists,
                    pmd.shots,
                    pmd.shots_on_goal,
                    pmd.passes_completed,
                    pmd.passes_attempted,
                    pmd.chances_created,
                    pmd.key_passes,
                    pmd.interceptions,
                    pmd.tackles,
                    pmd.sliding_tackles_completed,
                    pmd.fouls,
                    pmd.fouls_suffered,
                    pmd.yellow_cards,
                    pmd.red_cards,
                    pmd.keeper_saves,
                    pmd.keeper_saves_caught,
                    pmd.goals_conceded,
                    pmd.offsides,
                    pmd.own_goals,
                    pmd.event_timestamps
                FROM TOURNAMENT_FIXTURES fx
                JOIN MATCH_STATS m ON m.id = fx.played_match_stats_id
                JOIN PLAYER_MATCH_DATA pmd
                  ON (
                       pmd.match_id::text = m.match_id::text
                       OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = m.id::bigint
                  )
                LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = pmd.steam_id
                WHERE fx.tournament_id = $1
                  AND fx.played_match_stats_id IS NOT NULL
                  AND COALESCE(fx.is_forfeit_home, FALSE) = FALSE
                  AND COALESCE(fx.is_forfeit_away, FALSE) = FALSE
                ORDER BY fx.played_match_stats_id ASC, pmd.id DESC
                """,
                tournament_id,
            )
            grouped_match_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for item in _records_to_dicts(match_rows):
                grouped_match_rows[str(item.get("match_stats_id"))].append(item)

            mvp_counts: dict[str, dict[str, Any]] = {}
            for rows_for_match in grouped_match_rows.values():
                merged_rows = _merge_match_player_rows(rows_for_match)
                _attach_match_ratings(merged_rows)
                try:
                    mvp_payload = shared_get_mvp_data(merged_rows)
                except Exception:
                    mvp_payload = None
                if not mvp_payload:
                    continue

                mvp_name_key = _norm_text_key(mvp_payload.get("name"))
                mvp_pos = str(mvp_payload.get("position") or "").strip().upper()
                if not mvp_name_key:
                    continue

                linked = None
                for row in merged_rows:
                    row_name_key = _norm_text_key(row.get("player_name") or row.get("discord_name") or row.get("steam_id"))
                    row_pos = str(row.get("position") or "").strip().upper()
                    if row_name_key != mvp_name_key:
                        continue
                    if mvp_pos and row_pos and row_pos != mvp_pos:
                        continue
                    linked = row
                    break
                if not linked:
                    continue

                steam_id = str(linked.get("steam_id") or "").strip()
                key = steam_id if steam_id else f"name:{mvp_name_key}"
                if key not in mvp_counts:
                    mvp_counts[key] = {
                        "steam_id": steam_id,
                        "discord_id": linked.get("discord_id"),
                        "discord_name": linked.get("discord_name"),
                        "player_name": linked.get("player_name"),
                        "total": 0,
                    }
                mvp_counts[key]["total"] = _safe_int(mvp_counts[key].get("total")) + 1

                league_bucket = league_mvp_counts[_normalize_tournament_league_key(linked.get("league_key"))]
                if key not in league_bucket:
                    league_bucket[key] = {
                        "steam_id": steam_id,
                        "discord_id": linked.get("discord_id"),
                        "discord_name": linked.get("discord_name"),
                        "player_name": linked.get("player_name"),
                        "total": 0,
                    }
                league_bucket[key]["total"] = _safe_int(league_bucket[key].get("total")) + 1

            mvp_leaders = list(mvp_counts.values())
            mvp_leaders.sort(
                key=lambda row: (
                    -_safe_int(row.get("total")),
                    str(_leader_display_name(row)).lower(),
                )
            )
            for row in mvp_leaders:
                row["display_name"] = _leader_display_name(row)
            mvp_leaders = mvp_leaders[:10]

        leaders_payload = {
            "goals": leader_goals,
            "assists": leader_assists,
            "passes": leader_passes,
            "defenders": leader_defenders,
            "goalkeepers": leader_goalkeepers,
            "mvps": mvp_leaders,
        }

        league_leaders_payload: dict[str, dict[str, list[dict[str, Any]]]] = {}
        active_league_keys = sorted({
            _normalize_tournament_league_key(row.get("league_key"))
            for row in list(standings) + list(fixtures) + list(teams)
        } or {"A"})
        for league_key in active_league_keys:
            league_bundle = _leaders_bundle_for_league(league_key)
            league_bundle["goals"] = await _fetch_leader_metric(
                "COALESCE(pmd.goals, 0)",
                league_key=league_key,
            )
            league_bundle["assists"] = await _fetch_leader_metric(
                "COALESCE(pmd.assists, 0) + COALESCE(pmd.second_assists, 0)",
                league_key=league_key,
            )
            league_bundle["passes"] = await _fetch_leader_metric(
                "COALESCE(pmd.passes_completed, 0)",
                league_key=league_key,
            )
            league_bundle["defenders"] = await _fetch_leader_metric(
                "COALESCE(pmd.tackles, 0) + COALESCE(pmd.interceptions, 0)",
                league_key=league_key,
            )
            league_bundle["goalkeepers"] = await _fetch_leader_metric(
                "COALESCE(pmd.keeper_saves, 0) + COALESCE(pmd.keeper_saves_caught, 0)",
                extra_where="AND UPPER(COALESCE(pmd.position, '')) = 'GK'",
                league_key=league_key,
            )
            league_mvps = list(league_mvp_counts.get(league_key, {}).values())
            league_mvps.sort(
                key=lambda row: (
                    -_safe_int(row.get("total")),
                    str(_leader_display_name(row)).lower(),
                )
            )
            for row in league_mvps:
                row["display_name"] = _leader_display_name(row)
            league_bundle["mvps"] = league_mvps[:10]
            league_leaders_payload[league_key] = league_bundle

        orphan_rows = await conn.fetch(
            """
            SELECT
                f.home_guild_id,
                f.away_guild_id,
                COALESCE(m.home_score, 0)::int AS home_score,
                COALESCE(m.away_score, 0)::int AS away_score,
                f.played_at AS played_at,
                NULL::timestamp AS match_datetime,
                COALESCE(ht.guild_name, f.home_name_raw, '') AS home_team_name,
                COALESCE(at.guild_name, f.away_name_raw, '') AS away_team_name
            FROM TOURNAMENT_FIXTURES f
            LEFT JOIN MATCH_STATS m ON m.id = f.played_match_stats_id
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
            WHERE f.tournament_id = $1
              AND FALSE
            """,
            tournament_id,
        )
        orphan_form_rows = _records_to_dicts(orphan_rows)

    team_forms: dict[str, list[str]] = defaultdict(list)
    team_id_by_name: dict[str, str] = {}
    for row in standings:
        team_id = str(row.get("guild_id") or "").strip()
        if not team_id:
            continue
        for raw_name in [row.get("team_name")]:
            name_key = _norm_text_key(raw_name)
            if name_key and name_key not in team_id_by_name:
                team_id_by_name[name_key] = team_id
    for row in teams:
        team_id = str(row.get("guild_id") or "").strip()
        if not team_id:
            continue
        for raw_name in [row.get("team_name")]:
            name_key = _norm_text_key(raw_name)
            if name_key and name_key not in team_id_by_name:
                team_id_by_name[name_key] = team_id

    def _resolve_form_team_id(guild_id_value: Any, team_name_value: Any) -> str:
        gid = str(guild_id_value or "").strip()
        if gid:
            return gid
        return team_id_by_name.get(_norm_text_key(team_name_value), "")

    played_fixtures: list[Any] = []
    for fixture in fixtures:
        is_draw_fixture = bool(fixture.get("is_draw_home") or fixture.get("is_draw_away"))
        is_forfeit_fixture = bool(fixture.get("is_forfeit"))
        if not fixture.get("is_played") and not is_draw_fixture and not is_forfeit_fixture:
            continue
        if fixture.get("home_score") is None or fixture.get("away_score") is None:
            continue
        played_fixtures.append(fixture)
    for row in orphan_form_rows:
        if row.get("home_score") is None or row.get("away_score") is None:
            continue
        played_fixtures.append(row)

    def _fixture_sort_key(item: Any) -> datetime:
        dt_value = item.get("played_at") or item.get("match_datetime")
        if isinstance(dt_value, datetime):
            if dt_value.tzinfo is None:
                return dt_value.replace(tzinfo=timezone.utc)
            return dt_value.astimezone(timezone.utc)
        return datetime.min.replace(tzinfo=timezone.utc)

    played_fixtures.sort(key=_fixture_sort_key)

    for fixture in played_fixtures:
        home_id = _resolve_form_team_id(fixture.get("home_guild_id"), fixture.get("home_team_name"))
        away_id = _resolve_form_team_id(fixture.get("away_guild_id"), fixture.get("away_team_name"))
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

    tournament_payload = _record_to_dict(tournament)
    standings_payload = _records_to_dicts(standings)
    fixtures_payload = _records_to_dicts(fixtures)
    teams_payload = _records_to_dicts(teams)
    tournament_payload["league_count"] = int(tournament_payload.get("league_count") or 1)

    leagues_map: dict[str, dict[str, Any]] = {}
    for league_key in active_league_keys:
        leagues_map[league_key] = {
            "league_key": league_key,
            "league_name": _tournament_league_label(league_key),
                "standings": [],
                "fixtures": [],
                "teams": [],
                "leaders": league_leaders_payload.get(league_key, {
                    "goals": [],
                    "assists": [],
                    "passes": [],
                    "defenders": [],
                    "goalkeepers": [],
                    "mvps": [],
                }),
            }
    for row in standings_payload:
        leagues_map[_normalize_tournament_league_key(row.get("league_key"))]["standings"].append(row)
    for row in fixtures_payload:
        leagues_map[_normalize_tournament_league_key(row.get("league_key"))]["fixtures"].append(row)
    for row in teams_payload:
        leagues_map[_normalize_tournament_league_key(row.get("league_key"))]["teams"].append(row)
    leagues_payload = [
        leagues_map[key]
        for key in active_league_keys
        if leagues_map[key]["standings"] or leagues_map[key]["fixtures"] or leagues_map[key]["teams"] or key == "A"
    ]

    return {
        "tournament": tournament_payload,
        "standings": standings_payload,
        "fixtures": fixtures_payload,
        "teams": teams_payload,
        "leagues": leagues_payload,
        "team_forms": trimmed_team_forms,
        "leaders": leaders_payload,
        "league_leaders": league_leaders_payload,
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
        roster_ids: set[str] = set()
        if isinstance(roster, list):
            for entry in roster:
                if isinstance(entry, dict) and entry.get("id") is not None:
                    rid = str(entry.get("id")).strip()
                    if rid:
                        roster_ids.add(rid)
        captain_id = str(item.get("captain_id") or "").strip()
        if captain_id:
            roster_ids.add(captain_id)
        item["player_count"] = len(roster_ids)
    return {"teams": payload}


@app.get("/api/team-h2h")
async def team_h2h(
    team1: str = Query(..., min_length=1),
    team2: str = Query(..., min_length=1),
    limit: int = Query(default=100, ge=1, le=300),
) -> dict[str, Any]:
    team1 = str(team1).strip()
    team2 = str(team2).strip()
    if team1 == team2:
        raise HTTPException(status_code=400, detail="Choose two different teams")

    async with db.acquire() as conn:
        team_rows = await conn.fetch(
            """
            SELECT guild_id, guild_name, guild_icon, average_rating, captain_name, created_at, updated_at
            FROM IOSCA_TEAMS
            WHERE guild_id::text = ANY($1::text[])
            """,
            [team1, team2],
        )

        team_map = {
            str(row.get("guild_id")): _record_to_dict(row)
            for row in team_rows
        }
        if team1 not in team_map or team2 not in team_map:
            raise HTTPException(status_code=404, detail="One or both teams were not found")

        rows = await conn.fetch(
            """
            WITH regular_matches AS (
                SELECT
                    m.id,
                    m.match_id::text AS match_id,
                    m.datetime,
                    m.game_type,
                    m.extratime,
                    m.penalties,
                    FALSE AS is_forfeit,
                    m.home_guild_id,
                    m.away_guild_id,
                    COALESCE(ht.guild_name, m.home_team_name) AS home_team_name,
                    COALESCE(at.guild_name, m.away_team_name) AS away_team_name,
                    COALESCE(ht.guild_icon, '') AS home_team_icon,
                    COALESCE(at.guild_icon, '') AS away_team_icon,
                    COALESCE(m.home_score, 0)::int AS home_score,
                    COALESCE(m.away_score, 0)::int AS away_score,
                    tmeta.tournament_id,
                    tmeta.tournament_name
                FROM MATCH_STATS m
                LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
                LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
                LEFT JOIN LATERAL (
                    SELECT f.tournament_id, t.name AS tournament_name
                    FROM TOURNAMENT_FIXTURES f
                    JOIN TOURNAMENTS t ON t.id = f.tournament_id
                    WHERE f.played_match_stats_id = m.id
                    ORDER BY f.id DESC
                    LIMIT 1
                ) AS tmeta ON TRUE
                WHERE (m.home_guild_id::text = $1 AND m.away_guild_id::text = $2)
                   OR (m.home_guild_id::text = $2 AND m.away_guild_id::text = $1)
            ),
            forfeit_matches AS (
                SELECT
                    NULL::bigint AS id,
                    CONCAT('fixture_', f.id)::text AS match_id,
                    COALESCE(f.played_at, f.created_at) AS datetime,
                    COALESCE(t.format, 'forfeit') AS game_type,
                    FALSE AS extratime,
                    FALSE AS penalties,
                    TRUE AS is_forfeit,
                    f.home_guild_id,
                    f.away_guild_id,
                    COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
                    COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name,
                    COALESCE(ht.guild_icon, '') AS home_team_icon,
                    COALESCE(at.guild_icon, '') AS away_team_icon,
                    CASE
                        WHEN COALESCE(f.is_forfeit_home, FALSE) THEN 0::int
                        WHEN COALESCE(f.is_forfeit_away, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                        ELSE 0::int
                    END AS home_score,
                    CASE
                        WHEN COALESCE(f.is_forfeit_away, FALSE) THEN 0::int
                        WHEN COALESCE(f.is_forfeit_home, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                        ELSE 0::int
                    END AS away_score,
                    f.tournament_id,
                    t.name AS tournament_name
                FROM TOURNAMENT_FIXTURES f
                LEFT JOIN TOURNAMENTS t ON t.id = f.tournament_id
                LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
                LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
                WHERE (
                        (f.home_guild_id::text = $1 AND f.away_guild_id::text = $2)
                     OR (f.home_guild_id::text = $2 AND f.away_guild_id::text = $1)
                )
                  AND (COALESCE(f.is_forfeit_home, FALSE) OR COALESCE(f.is_forfeit_away, FALSE))
                  AND f.played_match_stats_id IS NULL
            )
            SELECT *
            FROM (
                SELECT * FROM regular_matches
                UNION ALL
                SELECT * FROM forfeit_matches
            ) merged
            ORDER BY datetime DESC NULLS LAST
            LIMIT $3
            """,
            team1,
            team2,
            limit,
        )

    matches_payload = _records_to_dicts(rows)
    summary = {
        "matches_played": 0,
        "team1_wins": 0,
        "team2_wins": 0,
        "draws": 0,
        "team1_goals": 0,
        "team2_goals": 0,
        "tournaments_played": 0,
        "recent_results": [],
        "avg_total_goals": 0.0,
    }
    format_breakdown: dict[str, dict[str, Any]] = {}
    tournaments_seen: set[str] = set()

    for item in matches_payload:
        home_id = str(item.get("home_guild_id") or "").strip()
        away_id = str(item.get("away_guild_id") or "").strip()
        home_score = _safe_int(item.get("home_score"))
        away_score = _safe_int(item.get("away_score"))

        if home_id == team1:
            team1_goals = home_score
            team2_goals = away_score
        else:
            team1_goals = away_score
            team2_goals = home_score

        if team1_goals > team2_goals:
            result = "W"
            summary["team1_wins"] += 1
        elif team1_goals < team2_goals:
            result = "L"
            summary["team2_wins"] += 1
        else:
            result = "D"
            summary["draws"] += 1

        item["team1_result"] = result
        item["team1_goals"] = team1_goals
        item["team2_goals"] = team2_goals
        item["comparison_scoreline"] = f"{team1_goals} - {team2_goals}"

        summary["matches_played"] += 1
        summary["team1_goals"] += team1_goals
        summary["team2_goals"] += team2_goals
        if len(summary["recent_results"]) < 5:
            summary["recent_results"].append(result)

        tournament_name = str(item.get("tournament_name") or "").strip()
        if tournament_name:
            tournaments_seen.add(tournament_name)

        format_key = str(item.get("game_type") or "Unknown").strip() or "Unknown"
        bucket = format_breakdown.setdefault(
            format_key,
            {
                "game_type": format_key,
                "matches_played": 0,
                "team1_wins": 0,
                "team2_wins": 0,
                "draws": 0,
                "team1_goals": 0,
                "team2_goals": 0,
            },
        )
        bucket["matches_played"] += 1
        bucket["team1_goals"] += team1_goals
        bucket["team2_goals"] += team2_goals
        if result == "W":
            bucket["team1_wins"] += 1
        elif result == "L":
            bucket["team2_wins"] += 1
        else:
            bucket["draws"] += 1

    if summary["matches_played"] > 0:
        summary["avg_total_goals"] = round(
            (summary["team1_goals"] + summary["team2_goals"]) / summary["matches_played"],
            2,
        )
    summary["tournaments_played"] = len(tournaments_seen)
    summary["team1_win_rate"] = round(
        (summary["team1_wins"] / summary["matches_played"]) * 100,
        1,
    ) if summary["matches_played"] > 0 else 0.0

    return {
        "team1": team_map[team1],
        "team2": team_map[team2],
        "summary": summary,
        "formats": sorted(format_breakdown.values(), key=lambda item: str(item.get("game_type") or "")),
        "matches": matches_payload,
    }


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

        # Ensure captain is always present in roster payload, even if omitted in players JSON.
        captain_id = str(team.get("captain_id") or "").strip()
        captain_name = str(team.get("captain_name") or "").strip()
        if captain_id:
            captain_already_listed = any(str(entry.get("id") or "").strip() == captain_id for entry in roster)
            if not captain_already_listed:
                roster.append({"id": captain_id, "name": captain_name or "Captain"})

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
            WITH regular_matches AS (
                SELECT
                    CASE
                        WHEN m.home_score = m.away_score THEN 'D'
                        WHEN m.home_guild_id::text = $1 AND m.home_score > m.away_score THEN 'W'
                        WHEN m.away_guild_id::text = $1 AND m.away_score > m.home_score THEN 'W'
                        ELSE 'L'
                    END AS result,
                    CASE
                        WHEN m.home_guild_id::text = $1 THEN COALESCE(m.home_score, 0)::int
                        WHEN m.away_guild_id::text = $1 THEN COALESCE(m.away_score, 0)::int
                        ELSE 0
                    END AS goals_for,
                    CASE
                        WHEN m.home_guild_id::text = $1 THEN COALESCE(m.away_score, 0)::int
                        WHEN m.away_guild_id::text = $1 THEN COALESCE(m.home_score, 0)::int
                        ELSE 0
                    END AS goals_against
                FROM MATCH_STATS m
                WHERE m.home_guild_id::text = $1 OR m.away_guild_id::text = $1
            ),
            forfeit_matches AS (
                SELECT
                    CASE
                        WHEN f.home_guild_id::text = $1 AND COALESCE(f.is_forfeit_home, FALSE) THEN 'L'
                        WHEN f.away_guild_id::text = $1 AND COALESCE(f.is_forfeit_away, FALSE) THEN 'L'
                        ELSE 'W'
                    END AS result,
                    CASE
                        WHEN f.home_guild_id::text = $1 AND COALESCE(f.is_forfeit_home, FALSE) THEN 0::int
                        WHEN f.away_guild_id::text = $1 AND COALESCE(f.is_forfeit_away, FALSE) THEN 0::int
                        ELSE COALESCE(f.forfeit_score, 10)::int
                    END AS goals_for,
                    CASE
                        WHEN f.home_guild_id::text = $1 AND COALESCE(f.is_forfeit_home, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                        WHEN f.away_guild_id::text = $1 AND COALESCE(f.is_forfeit_away, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                        ELSE 0::int
                    END AS goals_against
                FROM TOURNAMENT_FIXTURES f
                WHERE (f.home_guild_id::text = $1 OR f.away_guild_id::text = $1)
                  AND (COALESCE(f.is_forfeit_home, FALSE) OR COALESCE(f.is_forfeit_away, FALSE))
            ),
            all_matches AS (
                SELECT * FROM regular_matches
                UNION ALL
                SELECT * FROM forfeit_matches
            )
            SELECT
                COUNT(*) AS matches_played,
                COALESCE(SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END), 0) AS wins,
                COALESCE(SUM(CASE WHEN result = 'D' THEN 1 ELSE 0 END), 0) AS draws,
                COALESCE(SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END), 0) AS losses,
                COALESCE(SUM(goals_for), 0) AS goals_for,
                COALESCE(SUM(goals_against), 0) AS goals_against
            FROM all_matches
            """,
            guild_id,
        )

        recent_matches = await conn.fetch(
            """
            WITH regular_matches AS (
                SELECT
                    m.id,
                    m.datetime,
                    m.game_type,
                    m.extratime,
                    m.penalties,
                    m.home_guild_id,
                    m.away_guild_id,
                    COALESCE(ht.guild_name, m.home_team_name) AS home_team_name,
                    COALESCE(at.guild_name, m.away_team_name) AS away_team_name,
                    COALESCE(ht.guild_icon, '') AS home_team_icon,
                    COALESCE(at.guild_icon, '') AS away_team_icon,
                    COALESCE(m.home_score, 0)::int AS home_score,
                    COALESCE(m.away_score, 0)::int AS away_score,
                    tmeta.tournament_id,
                    tmeta.tournament_name,
                    FALSE AS is_forfeit,
                    CASE
                        WHEN COALESCE(m.home_score, 0) = COALESCE(m.away_score, 0) THEN 'D'
                        WHEN m.home_guild_id::text = $1 THEN CASE WHEN COALESCE(m.home_score, 0) > COALESCE(m.away_score, 0) THEN 'W' ELSE 'L' END
                        WHEN m.away_guild_id::text = $1 THEN CASE WHEN COALESCE(m.away_score, 0) > COALESCE(m.home_score, 0) THEN 'W' ELSE 'L' END
                        ELSE '-'
                    END AS result
                FROM MATCH_STATS m
                LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
                LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
                LEFT JOIN LATERAL (
                    SELECT f.tournament_id, t.name AS tournament_name
                    FROM TOURNAMENT_FIXTURES f
                    JOIN TOURNAMENTS t ON t.id = f.tournament_id
                    WHERE f.played_match_stats_id = m.id
                    ORDER BY f.id DESC
                    LIMIT 1
                ) AS tmeta ON TRUE
                WHERE m.home_guild_id::text = $1 OR m.away_guild_id::text = $1
            ),
            forfeit_matches AS (
                SELECT
                    NULL::bigint AS id,
                    COALESCE(f.played_at, f.created_at) AS datetime,
                    COALESCE(t.format, 'forfeit') AS game_type,
                    FALSE AS extratime,
                    FALSE AS penalties,
                    f.home_guild_id,
                    f.away_guild_id,
                    COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
                    COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name,
                    COALESCE(ht.guild_icon, '') AS home_team_icon,
                    COALESCE(at.guild_icon, '') AS away_team_icon,
                    CASE
                        WHEN COALESCE(f.is_forfeit_home, FALSE) THEN 0::int
                        WHEN COALESCE(f.is_forfeit_away, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                        ELSE 0::int
                    END AS home_score,
                    CASE
                        WHEN COALESCE(f.is_forfeit_away, FALSE) THEN 0::int
                        WHEN COALESCE(f.is_forfeit_home, FALSE) THEN COALESCE(f.forfeit_score, 10)::int
                        ELSE 0::int
                    END AS away_score,
                    f.tournament_id,
                    t.name AS tournament_name,
                    TRUE AS is_forfeit,
                    CASE
                        WHEN f.home_guild_id::text = $1 AND COALESCE(f.is_forfeit_home, FALSE) THEN 'L'
                        WHEN f.away_guild_id::text = $1 AND COALESCE(f.is_forfeit_away, FALSE) THEN 'L'
                        ELSE 'W'
                    END AS result
                FROM TOURNAMENT_FIXTURES f
                LEFT JOIN TOURNAMENTS t ON t.id = f.tournament_id
                LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
                LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
                WHERE (f.home_guild_id::text = $1 OR f.away_guild_id::text = $1)
                  AND (COALESCE(f.is_forfeit_home, FALSE) OR COALESCE(f.is_forfeit_away, FALSE))
            )
            SELECT *
            FROM (
                SELECT * FROM regular_matches
                UNION ALL
                SELECT * FROM forfeit_matches
            ) merged
            ORDER BY datetime DESC NULLS LAST
            LIMIT 20
            """,
            guild_id,
        )

        clean_sheet_row = await conn.fetchrow(
            """
            SELECT
                COALESCE(
                    SUM(
                        CASE
                            WHEN m.home_guild_id::text = $1 AND COALESCE(m.away_score, 0) = 0 THEN 1
                            WHEN m.away_guild_id::text = $1 AND COALESCE(m.home_score, 0) = 0 THEN 1
                            ELSE 0
                        END
                    ),
                    0
                ) AS clean_sheets
            FROM MATCH_STATS m
            WHERE m.home_guild_id::text = $1 OR m.away_guild_id::text = $1
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
    stats_payload["clean_sheets"] = int(_record_to_dict(clean_sheet_row).get("clean_sheets") or 0)

    recent_payload = _records_to_dicts(recent_matches)
    form_last5: list[str] = []
    for match in recent_payload:
        result = str(match.get("result") or "").strip().upper()
        if result not in {"W", "D", "L"}:
            home_score = int(match.get("home_score") or 0)
            away_score = int(match.get("away_score") or 0)
            home_id = str(match.get("home_guild_id") or "").strip()
            away_id = str(match.get("away_guild_id") or "").strip()
            result = "-"
            if home_score == away_score:
                result = "D"
            elif home_id == guild_id:
                result = "W" if home_score > away_score else "L"
            elif away_id == guild_id:
                result = "W" if away_score > home_score else "L"
        match["result"] = result
        if result in {"W", "D", "L"} and len(form_last5) < 5:
            form_last5.append(result)

    matches_played = int(stats_payload.get("matches_played") or 0)
    wins = int(stats_payload.get("wins") or 0)
    goals_for = int(stats_payload.get("goals_for") or 0)
    goals_against = int(stats_payload.get("goals_against") or 0)
    team_summary = {
        "form_last5": form_last5,
        "form_last20": [
            str(match.get("result") or "").strip().upper()
            for match in recent_payload
            if str(match.get("result") or "").strip().upper() in {"W", "D", "L"}
        ][:20],
        "win_rate": round((wins / matches_played) * 100, 1) if matches_played > 0 else 0.0,
        "avg_goals_for": round((goals_for / matches_played), 2) if matches_played > 0 else 0.0,
        "avg_goals_against": round((goals_against / matches_played), 2) if matches_played > 0 else 0.0,
    }

    top_players = sorted(
        parsed_players,
        key=lambda item: float(item.get("rating") or 0),
        reverse=True,
    )[:5]

    buckets = {
        "defense": [],
        "midfield": [],
        "attack": [],
        "goalkeeping": [],
    }
    for player_item in parsed_players:
        pos = str(player_item.get("position") or "").upper()
        rating = float(player_item.get("rating") or 0)
        if pos == "GK":
            buckets["goalkeeping"].append(rating)
        elif pos in {"LB", "RB", "CB", "SW", "LWB", "RWB", "DEF"}:
            buckets["defense"].append(rating)
        elif pos in {"LM", "RM", "CM", "CDM", "CAM", "MID"}:
            buckets["midfield"].append(rating)
        elif pos in {"LW", "RW", "CF", "ST", "ATT"}:
            buckets["attack"].append(rating)
    strength_by_position = {
        key: round(sum(values) / len(values), 2) if values else None
        for key, values in buckets.items()
    }

    chemistry_inputs = [
        len([p for p in parsed_players if p.get("steam_id")]),
        min(10, len(recent_payload)),
        len(team_summary["form_last20"]),
    ]
    chemistry_score = min(100, int(round(sum(chemistry_inputs) / 3 * 10)))

    identity_candidates = [
        ("Possession Masters", strength_by_position.get("midfield") or 0),
        ("Counter Attackers", strength_by_position.get("attack") or 0),
        ("Defensive Wall", strength_by_position.get("defense") or 0),
        ("Chaos Pressers", chemistry_score / 10),
    ]
    team_identity = max(identity_candidates, key=lambda item: item[1])[0]

    rivalries: list[dict[str, Any]] = []

    trophies: list[dict[str, Any]] = []
    awards: list[dict[str, Any]] = []
    try:
        async with db.acquire() as trophy_conn:
            rivalry_rows = await trophy_conn.fetch(
                """
                SELECT
                    trs.opponent_id::text AS guild_id,
                    COALESCE(it.guild_name, CONCAT('Team ', trs.opponent_id::text)) AS team_name,
                    COALESCE(it.guild_icon, '') AS team_icon,
                    trs.matches_played AS matches,
                    trs.wins,
                    trs.draws,
                    trs.losses,
                    trs.goals_for,
                    trs.goals_against,
                    trs.rivalry_score,
                    trs.last_played_at
                FROM hub.team_rivalry_summary trs
                LEFT JOIN public.iosca_teams it
                  ON it.guild_id = trs.opponent_id
                WHERE trs.team_id::text = $1
                ORDER BY trs.rivalry_score DESC, trs.matches_played DESC, team_name ASC
                LIMIT 4
                """,
                guild_id,
            )
            rivalries = _records_to_dicts(rivalry_rows)
            trophy_rows = await trophy_conn.fetch(
                """
                SELECT trophy_type, title, subtitle, awarded_at, metadata
                FROM hub.trophies
                WHERE owner_type = 'team'
                  AND owner_key = $1
                ORDER BY awarded_at DESC NULLS LAST, id DESC
                LIMIT 12
                """,
                guild_id,
            )
            trophies = _records_to_dicts(trophy_rows)
            award_rows = await trophy_conn.fetch(
                """
                SELECT award_scope, award_key, title, subtitle, period_start, period_end, metadata
                FROM hub.awards
                WHERE owner_type = 'team'
                  AND owner_key = $1
                ORDER BY period_end DESC NULLS LAST, created_at DESC, id DESC
                LIMIT 12
                """,
                guild_id,
            )
            awards = _records_to_dicts(award_rows)
    except Exception:
        rivalry_map: dict[str, dict[str, Any]] = {}
        for match in recent_payload:
            home_id = str(match.get("home_guild_id") or "")
            away_id = str(match.get("away_guild_id") or "")
            opponent = None
            if home_id == guild_id:
                opponent = match.get("away_team_name")
            elif away_id == guild_id:
                opponent = match.get("home_team_name")
            if not opponent:
                continue
            key = str(opponent)
            bucket = rivalry_map.setdefault(key, {"team_name": key, "matches": 0, "wins": 0, "draws": 0, "losses": 0})
            bucket["matches"] += 1
            result = str(match.get("result") or "").upper()
            if result == "W":
                bucket["wins"] += 1
            elif result == "D":
                bucket["draws"] += 1
            elif result == "L":
                bucket["losses"] += 1
        rivalries = sorted(rivalry_map.values(), key=lambda row: row["matches"], reverse=True)[:4]
        trophies = []
        awards = []

    return {
        "team": team_payload,
        "players": parsed_players,
        "stats": stats_payload,
        "summary": team_summary,
        "top_players": top_players,
        "strength_by_position": strength_by_position,
        "chemistry_score": chemistry_score,
        "team_identity": team_identity,
        "rivalries": rivalries,
        "trophies": trophies,
        "awards": awards,
        "recent_matches": recent_payload,
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
