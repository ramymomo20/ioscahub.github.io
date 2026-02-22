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
    from ios_bot.utils.match_performance import get_mvp_data as shared_get_mvp_data
    from ios_bot.utils.match_performance import rate_player as shared_rate_player
except Exception:
    shared_get_mvp_data = None
    shared_rate_player = None

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
DISCORD_MEMBER_ROLE_CACHE_TTL_SECONDS = 300
DISCORD_GUILD_ROLES_CACHE_TTL_SECONDS = 600
_discord_member_role_cache: dict[str, tuple[float, list[str]]] = {}
_discord_guild_roles_cache: dict[str, tuple[float, dict[str, str]]] = {}


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
    if isinstance(values, (int, float, str)):
        values = [values]
    elif isinstance(values, (tuple, set)):
        values = list(values)
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


def _safe_int(value: Any) -> int:
    try:
        return int(float(value))
    except Exception:
        return 0


def _normalize_mvp_stats(value: Any) -> list[str]:
    parsed = value
    if isinstance(parsed, str):
        raw = parsed.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except Exception:
            return [raw]
    if isinstance(parsed, list):
        out: list[str] = []
        for item in parsed:
            text = str(item or "").strip()
            if text:
                out.append(text)
        return out
    text = str(parsed or "").strip()
    return [text] if text else []


def _parse_event_map(raw: Any) -> dict[str, list[int]]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        return {}
    parsed: dict[str, list[int]] = {}
    for key, value in raw.items():
        key_norm = str(key or "").strip()
        if not key_norm:
            continue
        minutes = _safe_minutes(value)
        if minutes:
            parsed[key_norm] = minutes
    return parsed


def _merge_event_maps(left: Any, right: Any) -> dict[str, list[int]]:
    out = _parse_event_map(left)
    incoming = _parse_event_map(right)
    for key, vals in incoming.items():
        out[key] = sorted(set(out.get(key, []) + vals))
    return out


def _merge_match_player_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    numeric_fields = [
        "goals",
        "assists",
        "second_assists",
        "keeper_saves",
        "tackles",
        "interceptions",
        "chances_created",
        "key_passes",
        "yellow_cards",
        "red_cards",
        "own_goals",
        "shots",
        "shots_on_goal",
        "passes_completed",
        "passes_attempted",
        "distance_covered",
        "goals_conceded",
    ]

    for row in rows:
        steam_key = str(row.get("steam_id") or "").strip().lower()
        guild_key = str(row.get("guild_id") or "").strip().lower()
        key = (steam_key, guild_key)

        current = merged.get(key)
        if not current:
            item = dict(row)
            item["event_timestamps"] = _parse_event_map(item.get("event_timestamps"))
            item["mvp_key_stats"] = _normalize_mvp_stats(item.get("mvp_key_stats"))
            merged[key] = item
            continue

        for field in numeric_fields:
            current[field] = _safe_int(current.get(field)) + _safe_int(row.get(field))

        # Keep the best persisted rating and MVP metadata when duplicates collapse.
        cur_rating = current.get("match_rating")
        row_rating = row.get("match_rating")
        if isinstance(row_rating, (int, float)) and (
            not isinstance(cur_rating, (int, float)) or float(row_rating) > float(cur_rating)
        ):
            current["match_rating"] = float(row_rating)
        if bool(row.get("is_match_mvp")):
            current["is_match_mvp"] = True
            if row.get("mvp_score") is not None:
                current["mvp_score"] = row.get("mvp_score")
            if row.get("mvp_key_stats") is not None:
                current["mvp_key_stats"] = _normalize_mvp_stats(row.get("mvp_key_stats"))

        if not current.get("player_name") and row.get("player_name"):
            current["player_name"] = row.get("player_name")
        if not current.get("position") and row.get("position"):
            current["position"] = row.get("position")

        current["event_timestamps"] = _merge_event_maps(
            current.get("event_timestamps"),
            row.get("event_timestamps"),
        )

    return list(merged.values())


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


def _player_event_minutes(player_row: dict[str, Any], keys: list[str]) -> list[int]:
    raw = player_row.get("event_timestamps") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    if not isinstance(raw, dict):
        return []
    normalized_raw: dict[str, Any] = {}
    for raw_key, raw_val in raw.items():
        norm_key = re.sub(r"[^a-z0-9]+", "", str(raw_key or "").lower())
        if norm_key:
            normalized_raw[norm_key] = raw_val

    for key in keys:
        mins = _safe_minutes(raw.get(key))
        if mins:
            return mins
        norm_key = re.sub(r"[^a-z0-9]+", "", str(key or "").lower())
        mins = _safe_minutes(normalized_raw.get(norm_key))
        if mins:
            return mins
    return []


def _norm_text_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _position_search_tokens(position: Any) -> list[str]:
    pos = str(position or "").strip().upper()
    if not pos:
        return []
    tokens: set[str] = {pos.lower()}
    if pos == "GK":
        tokens.update({"gk", "goalkeeper", "keeper", "portero"})
    elif pos in {"LB", "RB", "CB", "SW", "LWB", "RWB", "DEF"}:
        tokens.update({"def", "defender", "defensa", "back"})
    elif pos in {"LM", "RM", "CM", "CDM", "CAM", "MID"}:
        tokens.update({"mid", "midfielder", "medio", "cm", "cam", "cdm"})
    elif pos in {"LW", "RW", "CF", "ST", "ATT"}:
        tokens.update({"att", "forward", "striker", "wing", "attacker", "delantero"})
    return sorted(tokens)


def _pick_position_asset(
    assets: list[dict[str, Any]],
    position: Any,
) -> dict[str, Any] | None:
    tokens = _position_search_tokens(position)
    if not assets or not tokens:
        return None

    best_asset: dict[str, Any] | None = None
    best_score = -1

    for asset in assets:
        key = str(asset.get("asset_key") or "").lower()
        name = str(asset.get("asset_name") or "").lower()
        blob = f"{key} {name}"
        score = 0
        for token in tokens:
            if token == key:
                score += 6
            if f"{token}_" in key or f"_{token}" in key:
                score += 4
            if token in key:
                score += 3
            if token in name:
                score += 2
            if token in blob:
                score += 1

        if score > best_score:
            best_score = score
            best_asset = asset

    return best_asset if best_score > 0 else None


def _asset_emoji_url(asset: dict[str, Any] | None) -> str | None:
    if not asset:
        return None
    raw_discord_id = str(asset.get("discord_id") or "").strip()
    if not raw_discord_id.isdigit():
        return None
    return f"https://cdn.discordapp.com/emojis/{raw_discord_id}.png?size=64&quality=lossless"


def _asset_key_base(asset_key: Any) -> str:
    key = str(asset_key or "").strip().lower()
    if not key:
        return ""
    key = re.sub(r"[^a-z0-9_]+", "", key)
    for suffix in ("_role", "_emoji", "role", "emoji"):
        if key.endswith(suffix):
            key = key[: -len(suffix)]
            break
    return key.strip("_")


def _pick_emoji_for_role_asset(
    role_asset: dict[str, Any] | None,
    emoji_assets: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not role_asset or not emoji_assets:
        return None

    role_key = str(role_asset.get("asset_key") or "").strip().lower()
    role_base = _asset_key_base(role_key)
    role_name = str(role_asset.get("asset_name") or "").strip().lower()

    best: dict[str, Any] | None = None
    best_score = -1
    for emoji in emoji_assets:
        ekey = str(emoji.get("asset_key") or "").strip().lower()
        ebase = _asset_key_base(ekey)
        ename = str(emoji.get("asset_name") or "").strip().lower()
        score = 0

        if role_key and role_key.replace("_role", "_emoji") == ekey:
            score += 10
        if role_base and ebase and role_base == ebase:
            score += 8
        if role_base and ekey.startswith(role_base):
            score += 4
        if role_base and role_base in ekey:
            score += 3
        if role_name and role_name in ename:
            score += 2

        if score > best_score:
            best_score = score
            best = emoji

    return best if best_score > 0 else None


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
        player_name = ""
        steam_id = ""

        if isinstance(item, list) and len(item) >= 3:
            player_name = str(item[1] or item[2] or "").strip()
            steam_id = str(item[2] or "").strip()
        elif isinstance(item, dict):
            player_name = str(
                item.get("name")
                or item.get("player_name")
                or item.get("discord_name")
                or item.get("player")
                or item.get("steam_id")
                or ""
            ).strip()
            steam_id = str(item.get("steam_id") or item.get("steamId") or "").strip()

        for alias in _steam_aliases(steam_id):
            steam_keys.add(alias)

        name_key = _norm_text_key(player_name)
        if name_key:
            name_keys.add(name_key)

    return {"steam": steam_keys, "name": name_keys}


def _extract_summary_identity_sets(summary_rows: Any) -> dict[str, set[str]]:
    steam_keys: set[str] = set()
    name_keys: set[str] = set()
    if not isinstance(summary_rows, list):
        return {"steam": steam_keys, "name": name_keys}

    for row in summary_rows:
        if not isinstance(row, dict):
            continue
        steam_id = str(row.get("steam_id") or "").strip()
        name = str(row.get("name") or row.get("player_name") or "").strip()
        for alias in _steam_aliases(steam_id):
            steam_keys.add(alias)
        name_key = _norm_text_key(name)
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
        red_count = int(row.get("red_cards") or row.get("redCards") or 0)
        red_minutes = _player_event_minutes(
            row,
            [
                "red",
                "red_card",
                "red_cards",
                "redcard",
                "redcards",
                "straight_red",
            ],
        )
        if red_minutes:
            events.append({"kind": "red", "name": name, "minutes": red_minutes, "count": len(red_minutes), "sort_minute": red_minutes[0]})
        elif red_count > 0:
            events.append({"kind": "red", "name": name, "minutes": [], "count": red_count, "sort_minute": 999})

    events.sort(key=lambda item: (int(item.get("sort_minute") or 999), str(item.get("name") or "").lower()))
    return events[:20]


def _build_team_event_items_from_summary(summary_rows: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if not isinstance(summary_rows, list):
        return events

    for row in summary_rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("player_name") or row.get("steam_id") or "Unknown").strip() or "Unknown"
        row_events = [
            ("goal", row.get("goals")),
            ("yellow", row.get("yellow_cards")),
            ("red", row.get("red_cards")),
            ("own_goal", row.get("own_goals")),
        ]
        for kind, raw_minutes in row_events:
            minutes = _safe_minutes(raw_minutes)
            if minutes:
                events.append(
                    {
                        "kind": kind,
                        "name": name,
                        "minutes": minutes,
                        "count": len(minutes),
                        "sort_minute": minutes[0],
                    }
                )
                continue
            count = len(raw_minutes) if isinstance(raw_minutes, list) else _safe_int(raw_minutes)
            if count > 0:
                events.append(
                    {
                        "kind": kind,
                        "name": name,
                        "minutes": [],
                        "count": count,
                        "sort_minute": 999,
                    }
                )

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
                COALESCE(rp.rating, 5.0) AS rating,
                rp.rating_updated_at,
                rp.registered_at,
                rp.last_active
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
                COUNT(*) AS matches_played,
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
                pmd.pass_accuracy,
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
            LEFT JOIN TOURNAMENT_MATCHES tm ON tm.match_stats_id = ms.id
            LEFT JOIN TOURNAMENTS t ON t.id = tm.tournament_id
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

    outcome_payload = _record_to_dict(outcome)
    totals_payload = _record_to_dict(totals)
    matches_played = int(outcome_payload.get("matches_played") or 0)
    wins = int(outcome_payload.get("wins") or 0)
    draws = int(outcome_payload.get("draws") or 0)
    losses = int(outcome_payload.get("losses") or 0)
    recent_payload = _records_to_dicts(recent)
    for item in recent_payload:
        item["clutch_actions"] = _parse_json(item.get("clutch_actions"), [])
        item["sub_impact"] = _parse_json(item.get("sub_impact"), {})
    recent_form = [str(item.get("result") or "").upper() for item in recent_payload if str(item.get("result") or "").upper() in {"W", "D", "L"}][:5]
    win_rate = round((wins / matches_played) * 100, 1) if matches_played > 0 else 0.0
    total_goals = int(totals_payload.get("goals") or 0)
    total_assists = int(totals_payload.get("assists") or 0)
    clutch_action_events = int(totals_payload.get("clutch_action_events") or 0)
    sub_impact_events = int(totals_payload.get("sub_impact_events") or 0)
    started_matches = int(totals_payload.get("started_matches") or 0)
    substitute_matches = int(totals_payload.get("substitute_matches") or 0)
    bench_matches = int(totals_payload.get("bench_matches") or 0)
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

    return {
        "player": player_payload,
        "totals": totals_payload,
        "recent_matches": recent_payload,
        "summary": player_summary,
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

    return {
        "match": match_payload,
        "player_stats": {
            "home": grouped.get("home", []),
            "away": grouped.get("away", []),
            "neutral": grouped.get("neutral", []),
        },
        "mvp": mvp_payload,
        "team_events": {
            "home": summary_home_events or row_home_events,
            "away": summary_away_events or row_away_events,
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
    orphan_form_rows: list[dict[str, Any]] = []
    async with db.acquire() as conn:
        tournament = await conn.fetchrow("SELECT * FROM TOURNAMENTS WHERE id = $1", tournament_id)
        if not tournament:
            raise HTTPException(status_code=404, detail="Tournament not found")

        standings = await conn.fetch(
            """
            WITH teams AS (
                SELECT
                    tt.guild_id,
                    COALESCE(tt.team_name_snapshot, it.guild_name, CONCAT('Team ', tt.guild_id::text)) AS team_name,
                    COALESCE(tt.team_icon_snapshot, it.guild_icon, '') AS team_icon
                FROM TOURNAMENT_TEAMS tt
                LEFT JOIN IOSCA_TEAMS it ON it.guild_id = tt.guild_id
                WHERE tt.tournament_id = $1
            ),
            forfeited_fixtures AS (
                SELECT fixture_id
                FROM TOURNAMENT_FORFEITS
                WHERE tournament_id = $1
                  AND fixture_id IS NOT NULL
            ),
            played_matches AS (
                SELECT
                    f.home_guild_id AS home_id,
                    f.away_guild_id AS away_id,
                    CASE
                        WHEN m.home_guild_id = f.home_guild_id AND m.away_guild_id = f.away_guild_id THEN COALESCE(m.home_score, 0)::int
                        WHEN m.home_guild_id = f.away_guild_id AND m.away_guild_id = f.home_guild_id THEN COALESCE(m.away_score, 0)::int
                        ELSE COALESCE(m.home_score, 0)::int
                    END AS home_score,
                    CASE
                        WHEN m.home_guild_id = f.home_guild_id AND m.away_guild_id = f.away_guild_id THEN COALESCE(m.away_score, 0)::int
                        WHEN m.home_guild_id = f.away_guild_id AND m.away_guild_id = f.home_guild_id THEN COALESCE(m.home_score, 0)::int
                        ELSE COALESCE(m.away_score, 0)::int
                    END AS away_score
                FROM TOURNAMENT_FIXTURES f
                JOIN MATCH_STATS m ON m.id = f.played_match_stats_id
                WHERE f.tournament_id = $1
                  AND COALESCE(f.is_played, FALSE) = TRUE
                  AND f.home_guild_id IS NOT NULL
                  AND f.away_guild_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM forfeited_fixtures ff WHERE ff.fixture_id = f.id
                  )
            ),
            orphan_matches AS (
                SELECT
                    tm.home_guild_id AS home_id,
                    tm.away_guild_id AS away_id,
                    COALESCE(tm.home_score, 0)::int AS home_score,
                    COALESCE(tm.away_score, 0)::int AS away_score
                FROM TOURNAMENT_MATCHES tm
                LEFT JOIN TOURNAMENT_FIXTURES f
                  ON f.tournament_id = tm.tournament_id
                 AND f.played_match_stats_id = tm.match_stats_id
                WHERE tm.tournament_id = $1
                  AND f.id IS NULL
            ),
            forfeits AS (
                SELECT
                    tf.winner_guild_id AS home_id,
                    tf.forfeiting_guild_id AS away_id,
                    COALESCE(tf.score_forfeit, 10)::int AS home_score,
                    0::int AS away_score
                FROM TOURNAMENT_FORFEITS tf
                WHERE tf.tournament_id = $1
            ),
            all_matches AS (
                SELECT * FROM played_matches
                UNION ALL
                SELECT * FROM orphan_matches
                UNION ALL
                SELECT * FROM forfeits
            ),
            team_rows AS (
                SELECT
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
                    guild_id,
                    SUM(matches_played)::int AS matches_played,
                    SUM(wins)::int AS wins,
                    SUM(draws)::int AS draws,
                    SUM(losses)::int AS losses,
                    SUM(goals_for)::int AS goals_for,
                    SUM(goals_against)::int AS goals_against
                FROM team_rows
                GROUP BY guild_id
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
            LEFT JOIN agg a ON a.guild_id = t.guild_id
            ORDER BY points DESC, goal_diff DESC, goals_for DESC, team_name ASC
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
                CASE
                    WHEN tf.id IS NOT NULL THEN
                        CASE
                            WHEN tf.winner_guild_id = f.home_guild_id THEN COALESCE(tf.score_forfeit, 10)::int
                            WHEN tf.forfeiting_guild_id = f.home_guild_id THEN 0::int
                            ELSE COALESCE(m.home_score, 0)::int
                        END
                    ELSE
                        CASE
                            WHEN m.home_guild_id = f.home_guild_id AND m.away_guild_id = f.away_guild_id THEN COALESCE(m.home_score, 0)::int
                            WHEN m.home_guild_id = f.away_guild_id AND m.away_guild_id = f.home_guild_id THEN COALESCE(m.away_score, 0)::int
                            ELSE COALESCE(m.home_score, 0)::int
                        END
                END AS home_score,
                CASE
                    WHEN tf.id IS NOT NULL THEN
                        CASE
                            WHEN tf.winner_guild_id = f.away_guild_id THEN COALESCE(tf.score_forfeit, 10)::int
                            WHEN tf.forfeiting_guild_id = f.away_guild_id THEN 0::int
                            ELSE COALESCE(m.away_score, 0)::int
                        END
                    ELSE
                        CASE
                            WHEN m.home_guild_id = f.home_guild_id AND m.away_guild_id = f.away_guild_id THEN COALESCE(m.away_score, 0)::int
                            WHEN m.home_guild_id = f.away_guild_id AND m.away_guild_id = f.home_guild_id THEN COALESCE(m.home_score, 0)::int
                            ELSE COALESCE(m.away_score, 0)::int
                        END
                END AS away_score,
                m.datetime AS match_datetime,
                (tf.id IS NOT NULL) AS is_forfeit,
                COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
                COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon
            FROM TOURNAMENT_FIXTURES f
            LEFT JOIN MATCH_STATS m ON m.id = f.played_match_stats_id
            LEFT JOIN TOURNAMENT_FORFEITS tf ON tf.tournament_id = f.tournament_id AND tf.fixture_id = f.id
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
        ) -> list[dict[str, Any]]:
            rows = await conn.fetch(
                f"""
                SELECT
                    pmd.steam_id,
                    MAX(ip.discord_id)::text AS discord_id,
                    MAX(NULLIF(ip.discord_name, '')) AS discord_name,
                    MAX(COALESCE(NULLIF(ip.discord_name, ''), pmd.steam_id)) AS player_name,
                    SUM({total_expr}) AS total
                FROM TOURNAMENT_MATCHES tm
                JOIN MATCH_STATS m ON m.id = tm.match_stats_id
                JOIN PLAYER_MATCH_DATA pmd
                  ON (
                       pmd.match_id::text = m.match_id::text
                       OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = m.id::bigint
                  )
                LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = pmd.steam_id
                WHERE tm.tournament_id = $1
                  AND NOT EXISTS (
                      SELECT 1
                      FROM TOURNAMENT_FIXTURES fx
                      JOIN TOURNAMENT_FORFEITS tf
                        ON tf.tournament_id = tm.tournament_id
                       AND tf.fixture_id = fx.id
                      WHERE fx.tournament_id = tm.tournament_id
                        AND fx.played_match_stats_id = tm.match_stats_id
                  )
                {extra_where}
                GROUP BY pmd.steam_id
                ORDER BY total DESC, player_name ASC
                LIMIT 30
                """,
                tournament_id,
            )
            payload = _records_to_dicts(rows)
            payload = [row for row in payload if _safe_int(row.get("total")) > 0]

            if not payload and fallback_expr:
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
        if shared_get_mvp_data:
            match_rows = await conn.fetch(
                """
                SELECT
                    tm.match_stats_id,
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
                FROM TOURNAMENT_MATCHES tm
                JOIN MATCH_STATS m ON m.id = tm.match_stats_id
                JOIN PLAYER_MATCH_DATA pmd
                  ON (
                       pmd.match_id::text = m.match_id::text
                       OR (CASE WHEN pmd.match_id::text ~ '^[0-9]+$' THEN pmd.match_id::bigint END) = m.id::bigint
                  )
                LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = pmd.steam_id
                WHERE tm.tournament_id = $1
                  AND NOT EXISTS (
                      SELECT 1
                      FROM TOURNAMENT_FIXTURES fx
                      JOIN TOURNAMENT_FORFEITS tf
                        ON tf.tournament_id = tm.tournament_id
                       AND tf.fixture_id = fx.id
                      WHERE fx.tournament_id = tm.tournament_id
                        AND fx.played_match_stats_id = tm.match_stats_id
                  )
                ORDER BY tm.match_stats_id ASC, pmd.id DESC
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

        orphan_rows = await conn.fetch(
            """
            SELECT
                tm.home_guild_id,
                tm.away_guild_id,
                COALESCE(tm.home_score, 0)::int AS home_score,
                COALESCE(tm.away_score, 0)::int AS away_score,
                tm.played_at AS played_at,
                NULL::timestamp AS match_datetime,
                COALESCE(ht.guild_name, '') AS home_team_name,
                COALESCE(at.guild_name, '') AS away_team_name
            FROM TOURNAMENT_MATCHES tm
            LEFT JOIN TOURNAMENT_FIXTURES f
              ON f.tournament_id = tm.tournament_id
             AND f.played_match_stats_id = tm.match_stats_id
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = tm.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = tm.away_guild_id
            WHERE tm.tournament_id = $1
              AND f.id IS NULL
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
        if not fixture.get("is_played"):
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

    return {
        "tournament": _record_to_dict(tournament),
        "standings": _records_to_dicts(standings),
        "fixtures": _records_to_dicts(fixtures),
        "teams": _records_to_dicts(teams),
        "team_forms": trimmed_team_forms,
        "leaders": leaders_payload,
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
                    CASE WHEN tf.winner_guild_id::text = $1 THEN 'W' ELSE 'L' END AS result,
                    CASE
                        WHEN tf.winner_guild_id::text = $1 THEN COALESCE(tf.score_forfeit, 10)::int
                        ELSE 0
                    END AS goals_for,
                    CASE
                        WHEN tf.forfeiting_guild_id::text = $1 THEN COALESCE(tf.score_forfeit, 10)::int
                        ELSE 0
                    END AS goals_against
                FROM TOURNAMENT_FORFEITS tf
                WHERE tf.winner_guild_id::text = $1 OR tf.forfeiting_guild_id::text = $1
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
                    tm.tournament_id,
                    t.name AS tournament_name,
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
                LEFT JOIN TOURNAMENT_MATCHES tm ON tm.match_stats_id = m.id
                LEFT JOIN TOURNAMENTS t ON t.id = tm.tournament_id
                WHERE m.home_guild_id::text = $1 OR m.away_guild_id::text = $1
            ),
            forfeit_matches AS (
                SELECT
                    NULL::bigint AS id,
                    COALESCE(f.played_at, tf.created_at, f.created_at) AS datetime,
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
                        WHEN tf.winner_guild_id = f.home_guild_id THEN COALESCE(tf.score_forfeit, 10)::int
                        WHEN tf.forfeiting_guild_id = f.home_guild_id THEN 0::int
                        ELSE 0::int
                    END AS home_score,
                    CASE
                        WHEN tf.winner_guild_id = f.away_guild_id THEN COALESCE(tf.score_forfeit, 10)::int
                        WHEN tf.forfeiting_guild_id = f.away_guild_id THEN 0::int
                        ELSE 0::int
                    END AS away_score,
                    f.tournament_id,
                    t.name AS tournament_name,
                    TRUE AS is_forfeit,
                    CASE WHEN tf.winner_guild_id::text = $1 THEN 'W' ELSE 'L' END AS result
                FROM TOURNAMENT_FORFEITS tf
                JOIN TOURNAMENT_FIXTURES f
                  ON f.id = tf.fixture_id
                 AND f.tournament_id = tf.tournament_id
                LEFT JOIN TOURNAMENTS t ON t.id = f.tournament_id
                LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
                LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
                WHERE tf.winner_guild_id::text = $1 OR tf.forfeiting_guild_id::text = $1
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
        "win_rate": round((wins / matches_played) * 100, 1) if matches_played > 0 else 0.0,
        "avg_goals_for": round((goals_for / matches_played), 2) if matches_played > 0 else 0.0,
        "avg_goals_against": round((goals_against / matches_played), 2) if matches_played > 0 else 0.0,
    }

    return {
        "team": team_payload,
        "players": parsed_players,
        "stats": stats_payload,
        "summary": team_summary,
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
