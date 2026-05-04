from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import asyncpg
except ImportError:
    asyncpg = None


STEAM_ID64_BASE = 76561197960265728


def _dt_to_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value


def _record_to_dict(record: asyncpg.Record | dict | None) -> dict[str, Any]:
    if not record:
        return {}
    return {k: _dt_to_iso(v) for k, v in dict(record).items()}


def _records_to_dicts(records: list[asyncpg.Record]) -> list[dict[str, Any]]:
    return [_record_to_dict(r) for r in records]


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
    return None


def _steam_profile_url(steam_id: Any) -> str | None:
    raw = str(steam_id or "").strip()
    if not raw:
        return None
    steam64 = _steam_to_steam64(raw)
    if steam64:
        return f"https://steamcommunity.com/profiles/{steam64}"
    return f"https://steamcommunity.com/search/users/#text={raw}"


def _steam_avatar_proxy_url(steam64: Any) -> str | None:
    raw = str(steam64 or "").strip()
    if not raw:
        return None
    return f"https://unavatar.io/steam/{raw}"


def _decorate_player_rows(payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for item in payload:
        if not item.get("discord_name") and item.get("player_name"):
            item["discord_name"] = item.get("player_name")
        item["avatar_url"] = _discord_avatar_url(item.get("discord_id"))
        item["avatar_fallback_url"] = _default_discord_avatar(item.get("discord_id"))
        item["steam_profile_url"] = _steam_profile_url(item.get("steam_id"))
        steam64 = _steam_to_steam64(item.get("steam_id"))
        if steam64:
            item["steam_id64"] = steam64
            item["display_avatar_url"] = _steam_avatar_proxy_url(steam64) or item["avatar_url"]
        else:
            item["display_avatar_url"] = item["avatar_url"]
    return payload


async def _fetch_summary(conn: asyncpg.Connection) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM IOSCA_PLAYERS) AS players_total,
            (SELECT COUNT(*) FROM IOSCA_TEAMS) AS teams_total,
            (SELECT COUNT(*) FROM MATCH_STATS) AS matches_total,
            (SELECT COUNT(*) FROM TOURNAMENTS) AS tournaments_total,
            (SELECT COUNT(*) FROM TOURNAMENTS WHERE status = 'active') AS active_tournaments_total,
            (SELECT COUNT(*) FROM IOS_SERVERS WHERE is_active = TRUE) AS active_servers_total
        """
    )
    payload = _record_to_dict(row)

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
        hall_of_fame = _decorate_player_rows(_records_to_dicts(hall_of_fame_rows))
        rising_stars = _decorate_player_rows(_records_to_dicts(rising_star_rows))
        hot_players = _decorate_player_rows(_records_to_dicts(hot_player_rows))
        hot_teams = _records_to_dicts(hot_team_rows)
    except Exception:
        hall_of_fame = []
        rising_stars = []
        hot_players = []
        hot_teams = []

    payload["storyboards"] = {
        "hall_of_fame": hall_of_fame,
        "rising_stars": rising_stars,
        "streak_center": {
            "players": hot_players,
            "teams": hot_teams,
        },
    }
    return payload


async def _fetch_matches(conn: asyncpg.Connection, limit: int) -> dict[str, Any]:
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


async def _fetch_rankings(conn: asyncpg.Connection, limit: int) -> dict[str, Any]:
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

    players = _decorate_player_rows(_records_to_dicts(rows))

    def best_for(positions: set[str]) -> dict[str, Any] | None:
        for player in players:
            pos = str(player.get("position") or "").upper()
            if pos in positions:
                return player
        return None

    widgets = {
        "best_goalkeeper": best_for({"GK"}),
        "best_defender": best_for({"LB", "RB", "CB", "DEF"}),
        "best_midfielder": best_for({"CM", "LM", "RM", "MID"}),
        "best_attacker": best_for({"CF", "LW", "RW", "ST", "ATT"}),
    }
    return {"players": players, "widgets": widgets}


async def _fetch_hall_of_fame(conn: asyncpg.Connection, limit: int) -> dict[str, Any]:
    try:
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
    return {"players": _decorate_player_rows(_records_to_dicts(rows))}


async def _fetch_players(conn: asyncpg.Connection, limit: int) -> dict[str, Any]:
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

    return {"players": _decorate_player_rows(_records_to_dicts(rows))}


async def _fetch_teams(conn: asyncpg.Connection) -> dict[str, Any]:
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
        roster = item.get("players") or []
        roster_ids: set[str] = set()
        if isinstance(roster, str):
            try:
                roster = json.loads(roster)
            except Exception:
                roster = []
        if isinstance(roster, list):
            for entry in roster:
                if isinstance(entry, dict) and entry.get("id") is not None:
                    roster_id = str(entry.get("id")).strip()
                    if roster_id:
                        roster_ids.add(roster_id)
        captain_id = str(item.get("captain_id") or "").strip()
        if captain_id:
            roster_ids.add(captain_id)
        item["player_count"] = len(roster_ids)
    return {"teams": payload}


async def _fetch_tournaments(conn: asyncpg.Connection) -> dict[str, Any]:
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


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


async def _run(
    db_url: str,
    legacy_output_file: Path,
    matches_limit: int,
    players_limit: int,
    rankings_limit: int,
    hall_of_fame_limit: int,
) -> int:
    if asyncpg is None:
        print("Missing dependency: asyncpg")
        print("Install it with: pip install -r tools/requirements.txt")
        return 2

    output_dir = legacy_output_file.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    conn = await asyncpg.connect(db_url)
    try:
        generated_at = datetime.now(timezone.utc).isoformat()
        summary, matches_payload, rankings_payload, hall_of_fame_payload, players_payload, teams_payload, tournaments_payload = await asyncio.gather(
            _fetch_summary(conn),
            _fetch_matches(conn, matches_limit),
            _fetch_rankings(conn, rankings_limit),
            _fetch_hall_of_fame(conn, hall_of_fame_limit),
            _fetch_players(conn, players_limit),
            _fetch_teams(conn),
            _fetch_tournaments(conn),
        )
    finally:
        await conn.close()

    home_payload = {
        "generated_at": generated_at,
        "summary": summary,
        "matches": {"matches": list(matches_payload.get("matches", []))[:12]},
        "rankings": rankings_payload,
        "teams": teams_payload,
        "tournaments": tournaments_payload,
    }

    legacy_payload = {
        "generated_at": generated_at,
        "summary": summary,
        "recent_matches": list(matches_payload.get("matches", []))[:200],
        "teams": teams_payload.get("teams", []),
        "tournaments": tournaments_payload.get("tournaments", []),
        "upcoming_schedules": [],
    }

    files_to_write: dict[Path, dict[str, Any]] = {
        legacy_output_file: legacy_payload,
        output_dir / "home.json": home_payload,
        output_dir / "hall-of-fame.json": {"generated_at": generated_at, **hall_of_fame_payload},
        output_dir / "matches.json": {"generated_at": generated_at, **matches_payload},
        output_dir / "rankings.json": {"generated_at": generated_at, **rankings_payload},
        output_dir / "players.json": {"generated_at": generated_at, **players_payload},
        output_dir / "teams.json": {"generated_at": generated_at, **teams_payload},
        output_dir / "tournaments.json": {"generated_at": generated_at, **tournaments_payload},
    }

    for path, payload in files_to_write.items():
        _write_json(path, payload)
        print(f"Hub data exported -> {path}")

    print(f"Generated at: {generated_at}")
    print(
        "Totals: "
        f"players={summary.get('players_total', 0)}, "
        f"teams={summary.get('teams_total', 0)}, "
        f"matches={summary.get('matches_total', 0)}, "
        f"tournaments={summary.get('tournaments_total', 0)}"
    )
    return 0


def main() -> int:
    default_db_url = (os.getenv("SUPABASE_DB_URL") or os.getenv("SUPABASE_POOLER_URL") or "").strip()
    parser = argparse.ArgumentParser(description="Export IOSCA hub JSON for GitHub Pages.")
    parser.add_argument(
        "--db-url",
        default=default_db_url,
        help="Postgres connection string. Defaults to SUPABASE_DB_URL, then SUPABASE_POOLER_URL.",
    )
    parser.add_argument(
        "--out",
        default="data/hub.json",
        help="Legacy output file path. Page-specific JSON files will be written beside it.",
    )
    parser.add_argument(
        "--matches-limit",
        type=int,
        default=3000,
        help="How many recent matches to export for the static match browser.",
    )
    parser.add_argument(
        "--players-limit",
        type=int,
        default=3000,
        help="How many players to export for the static player browser.",
    )
    parser.add_argument(
        "--rankings-limit",
        type=int,
        default=200,
        help="How many ranked players to export.",
    )
    parser.add_argument(
        "--hall-of-fame-limit",
        type=int,
        default=80,
        help="How many hall of fame players to export.",
    )
    args = parser.parse_args()

    db_url = str(args.db_url or "").strip()
    if not db_url:
        print("Missing DB URL. Set SUPABASE_DB_URL or SUPABASE_POOLER_URL, or pass --db-url.")
        return 2

    return asyncio.run(
        _run(
            db_url=db_url,
            legacy_output_file=Path(args.out),
            matches_limit=int(args.matches_limit),
            players_limit=int(args.players_limit),
            rankings_limit=int(args.rankings_limit),
            hall_of_fame_limit=int(args.hall_of_fame_limit),
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
