from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

JS_MAX_SAFE_INTEGER = 9007199254740991
STEAM_ID64_BASE = 76561197960265728


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


def _records_to_dicts(rows: list[Any]) -> list[dict[str, Any]]:
    return [_record_to_dict(row) for row in rows]


def _normalize_tournament_league_key(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if raw in ("B", "2"):
        return "B"
    return "A"


def _tournament_league_label(value: Any) -> str:
    return f"League {_normalize_tournament_league_key(value)}"


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


def _steam_to_steam64(steam_id: Any) -> str | None:
    raw = str(steam_id or "").strip()
    if not raw:
        return None
    if raw.isdigit() and len(raw) >= 16:
        return raw

    match = re.match(r"^STEAM_[0-5]:([0-1]):(\d+)$", raw, flags=re.IGNORECASE)
    if match:
        y = int(match.group(1))
        z = int(match.group(2))
        return str(STEAM_ID64_BASE + (z * 2) + y)

    match = re.match(r"^\[U:1:(\d+)\]$", raw, flags=re.IGNORECASE)
    if match:
        account_id = int(match.group(1))
        return str(STEAM_ID64_BASE + account_id)

    return None


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

    if (aliases and aliases.intersection(home_keys["steam"])) or (
        player_name_key and player_name_key in home_keys["name"]
    ):
        return "home"
    if (aliases and aliases.intersection(away_keys["steam"])) or (
        player_name_key and player_name_key in away_keys["name"]
    ):
        return "away"
    return "neutral"


def _match_result_for_side(side: str, home_score: Any, away_score: Any) -> str | None:
    home = _safe_int(home_score)
    away = _safe_int(away_score)
    if home == away:
        return "D"
    if side == "home":
        return "W" if home > away else "L"
    if side == "away":
        return "W" if away > home else "L"
    return None


def _infer_side_from_player_match_row(match_row: dict[str, Any]) -> str:
    home_lineup_keys = _extract_lineup_identity_sets(_parse_json(match_row.get("home_lineup"), []))
    away_lineup_keys = _extract_lineup_identity_sets(_parse_json(match_row.get("away_lineup"), []))
    home_summary_keys = _extract_summary_identity_sets(_parse_json(match_row.get("match_summary_home"), []))
    away_summary_keys = _extract_summary_identity_sets(_parse_json(match_row.get("match_summary_away"), []))

    home_identity_keys = {
        "steam": set(home_lineup_keys["steam"]).union(home_summary_keys["steam"]),
        "name": set(home_lineup_keys["name"]).union(home_summary_keys["name"]),
    }
    away_identity_keys = {
        "steam": set(away_lineup_keys["steam"]).union(away_summary_keys["steam"]),
        "name": set(away_lineup_keys["name"]).union(away_summary_keys["name"]),
    }

    home_guild_key = str(match_row.get("home_guild_id") or "").strip()
    away_guild_key = str(match_row.get("away_guild_id") or "").strip()
    home_name_key = _norm_text_key(match_row.get("home_team_name") or "")
    away_name_key = _norm_text_key(match_row.get("away_team_name") or "")
    item_guild_key = str(match_row.get("guild_id") or "").strip()
    item_team_name_key = _norm_text_key(match_row.get("guild_team_name") or "")

    is_same_side_match = (
        (home_guild_key and away_guild_key and home_guild_key == away_guild_key)
        or (home_name_key and away_name_key and home_name_key == away_name_key)
    )

    if not is_same_side_match:
        if item_guild_key and item_guild_key == home_guild_key:
            return "home"
        if item_guild_key and item_guild_key == away_guild_key:
            return "away"

    if item_team_name_key:
        if item_team_name_key == home_name_key:
            return "home"
        if item_team_name_key == away_name_key:
            return "away"

    return _infer_side_from_lineup(match_row, home_identity_keys, away_identity_keys)


def _build_team_event_items(team_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for row in team_rows:
        name = str(row.get("player_name") or row.get("steam_id") or "Unknown").strip() or "Unknown"

        goal_minutes = _player_event_minutes(row, ["goal", "goals"])
        if goal_minutes:
            events.append(
                {"kind": "goal", "name": name, "minutes": goal_minutes, "count": len(goal_minutes), "sort_minute": goal_minutes[0]}
            )
        else:
            count = int(row.get("goals") or 0)
            if count > 0:
                events.append({"kind": "goal", "name": name, "minutes": [], "count": count, "sort_minute": 999})

        yellow_minutes = _player_event_minutes(row, ["yellow", "yellow_card", "yellow_cards"])
        if yellow_minutes:
            events.append(
                {
                    "kind": "yellow",
                    "name": name,
                    "minutes": yellow_minutes,
                    "count": len(yellow_minutes),
                    "sort_minute": yellow_minutes[0],
                }
            )
        else:
            count = int(row.get("yellow_cards") or row.get("yellowCards") or 0)
            if count > 0:
                events.append({"kind": "yellow", "name": name, "minutes": [], "count": count, "sort_minute": 999})

        red_count = int(row.get("red_cards") or row.get("redCards") or 0)
        red_minutes = _player_event_minutes(
            row,
            ["red", "red_card", "red_cards", "redcard", "redcards", "straight_red"],
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


def _event_items_signature(events: list[dict[str, Any]]) -> tuple[tuple[Any, ...], ...]:
    normalized: list[tuple[Any, ...]] = []
    for item in events or []:
        if not isinstance(item, dict):
            continue
        normalized.append(
            (
                str(item.get("kind") or ""),
                _norm_text_key(item.get("name") or ""),
                tuple(_safe_minutes(item.get("minutes"))),
                _safe_int(item.get("count")),
            )
        )
    return tuple(normalized)
