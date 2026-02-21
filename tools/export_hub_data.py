from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import asyncpg
except ImportError:
    asyncpg = None


def _dt_to_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value


def _record_to_dict(record: asyncpg.Record | dict | None) -> dict:
    if not record:
        return {}
    return {k: _dt_to_iso(v) for k, v in dict(record).items()}


def _records_to_dicts(records: list[asyncpg.Record]) -> list[dict]:
    return [_record_to_dict(r) for r in records]


async def _fetch_recent_matches(conn: asyncpg.Connection, limit: int) -> list[dict]:
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
            tmeta.tournament_id,
            tmeta.tournament_name
        FROM MATCH_STATS m
        LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
        LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
        LEFT JOIN LATERAL (
            SELECT tm.tournament_id, t.name AS tournament_name
            FROM TOURNAMENT_MATCHES tm
            JOIN TOURNAMENTS t ON t.id = tm.tournament_id
            WHERE tm.match_stats_id = m.id
            ORDER BY tm.id DESC
            LIMIT 1
        ) AS tmeta ON TRUE
        ORDER BY m.datetime DESC
        LIMIT $1
        """,
        limit,
    )
    return _records_to_dicts(rows)


async def _fetch_teams_summary(conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            t.guild_id,
            t.guild_name,
            COALESCE(t.guild_icon, '') AS guild_icon,
            COALESCE(t.average_rating, 5.0) AS average_rating,
            COALESCE(stats.matches_played, 0) AS matches_played,
            COALESCE(stats.wins, 0) AS wins,
            COALESCE(stats.draws, 0) AS draws,
            COALESCE(stats.losses, 0) AS losses,
            COALESCE(stats.goals_for, 0) AS goals_for,
            COALESCE(stats.goals_against, 0) AS goals_against
        FROM IOSCA_TEAMS t
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) AS matches_played,
                SUM(
                    CASE WHEN m.home_guild_id = t.guild_id THEN m.home_score
                         WHEN m.away_guild_id = t.guild_id THEN m.away_score
                         ELSE 0 END
                ) AS goals_for,
                SUM(
                    CASE WHEN m.home_guild_id = t.guild_id THEN m.away_score
                         WHEN m.away_guild_id = t.guild_id THEN m.home_score
                         ELSE 0 END
                ) AS goals_against,
                SUM(
                    CASE
                        WHEN m.home_guild_id = t.guild_id AND m.home_score > m.away_score THEN 1
                        WHEN m.away_guild_id = t.guild_id AND m.away_score > m.home_score THEN 1
                        ELSE 0
                    END
                ) AS wins,
                SUM(
                    CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END
                ) AS draws,
                SUM(
                    CASE
                        WHEN m.home_guild_id = t.guild_id AND m.home_score < m.away_score THEN 1
                        WHEN m.away_guild_id = t.guild_id AND m.away_score < m.home_score THEN 1
                        ELSE 0
                    END
                ) AS losses
            FROM MATCH_STATS m
            WHERE m.home_guild_id = t.guild_id OR m.away_guild_id = t.guild_id
        ) AS stats ON TRUE
        ORDER BY stats.matches_played DESC NULLS LAST, t.guild_name ASC
        """
    )
    output = []
    for row in rows:
        item = _record_to_dict(row)
        item["goal_diff"] = int(item.get("goals_for", 0)) - int(item.get("goals_against", 0))
        output.append(item)
    return output


async def _fetch_tournaments(conn: asyncpg.Connection) -> list[dict]:
    tournaments = await conn.fetch(
        """
        SELECT
            id,
            name,
            format,
            status,
            num_teams,
            points_win,
            points_draw,
            points_loss,
            created_at,
            updated_at
        FROM TOURNAMENTS
        ORDER BY
            CASE status WHEN 'active' THEN 0 WHEN 'ended' THEN 1 ELSE 2 END,
            updated_at DESC
        """
    )

    result: list[dict] = []
    for tournament_row in tournaments:
        tournament = _record_to_dict(tournament_row)
        tournament_id = tournament_row["id"]

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
                COALESCE(f.week_label, CONCAT('Week ', COALESCE(f.week_number::text, '?'))) AS week_label,
                COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
                COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name,
                COALESCE(ht.guild_icon, '') AS home_team_icon,
                COALESCE(at.guild_icon, '') AS away_team_icon,
                f.is_active,
                f.is_played,
                f.played_at
            FROM TOURNAMENT_FIXTURES f
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
            WHERE f.tournament_id = $1
            ORDER BY f.week_number NULLS LAST, f.id ASC
            """,
            tournament_id,
        )

        top_players = await conn.fetch(
            """
            SELECT
                tps.steam_id,
                COALESCE(ip.discord_name, tps.player_name, 'Unknown') AS player_name,
                tps.discord_id,
                tps.team_guild_id,
                COALESCE(it.guild_name, CONCAT('Team ', tps.team_guild_id::text)) AS team_name,
                tps.matches_played,
                tps.goals,
                tps.assists,
                tps.keeper_saves,
                tps.interceptions,
                tps.tackles
            FROM TOURNAMENT_PLAYER_STATS tps
            LEFT JOIN IOSCA_PLAYERS ip ON ip.steam_id = tps.steam_id
            LEFT JOIN IOSCA_TEAMS it ON it.guild_id = tps.team_guild_id
            WHERE tps.tournament_id = $1
            ORDER BY tps.goals DESC, tps.assists DESC, tps.keeper_saves DESC, player_name ASC
            LIMIT 20
            """,
            tournament_id,
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
            FROM TOURNAMENT_MATCHES tm
            JOIN MATCH_STATS m ON m.id = tm.match_stats_id
            LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = m.home_guild_id
            LEFT JOIN IOSCA_TEAMS at ON at.guild_id = m.away_guild_id
            WHERE tm.tournament_id = $1
            ORDER BY m.datetime DESC
            LIMIT 10
            """,
            tournament_id,
        )

        tournament["standings"] = _records_to_dicts(standings)
        tournament["fixtures"] = _records_to_dicts(fixtures)
        tournament["top_players"] = _records_to_dicts(top_players)
        tournament["recent_matches"] = _records_to_dicts(recent_matches)
        result.append(tournament)

    return result


async def _fetch_upcoming_schedules(conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            s.id,
            s.tournament_id,
            t.name AS tournament_name,
            s.proposed_time,
            s.server_name,
            s.status,
            COALESCE(ht.guild_name, f.home_name_raw, 'Home') AS home_team_name,
            COALESCE(at.guild_name, f.away_name_raw, 'Away') AS away_team_name
        FROM TOURNAMENT_SCHEDULES s
        JOIN TOURNAMENTS t ON t.id = s.tournament_id
        JOIN TOURNAMENT_FIXTURES f ON f.id = s.fixture_id
        LEFT JOIN IOSCA_TEAMS ht ON ht.guild_id = f.home_guild_id
        LEFT JOIN IOSCA_TEAMS at ON at.guild_id = f.away_guild_id
        WHERE s.status IN ('pending', 'countered', 'confirmed')
          AND s.proposed_time >= NOW() - INTERVAL '12 hour'
        ORDER BY s.proposed_time ASC
        LIMIT 100
        """
    )
    return _records_to_dicts(rows)


async def _fetch_hub_payload(conn: asyncpg.Connection, matches_limit: int) -> dict:
    recent_matches, teams, tournaments, schedules = await asyncio.gather(
        _fetch_recent_matches(conn, matches_limit),
        _fetch_teams_summary(conn),
        _fetch_tournaments(conn),
        _fetch_upcoming_schedules(conn),
    )

    active_tournaments = [t for t in tournaments if str(t.get("status", "")).lower() == "active"]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "teams_total": len(teams),
            "matches_total": len(recent_matches),
            "tournaments_total": len(tournaments),
            "active_tournaments_total": len(active_tournaments),
            "upcoming_schedules_total": len(schedules),
        },
        "recent_matches": recent_matches,
        "teams": teams,
        "tournaments": tournaments,
        "upcoming_schedules": schedules,
    }
    return payload


async def _run(db_url: str, output_file: Path, matches_limit: int) -> int:
    if asyncpg is None:
        print("Missing dependency: asyncpg")
        print("Install it with: pip install -r tools/requirements.txt")
        return 2

    output_file.parent.mkdir(parents=True, exist_ok=True)
    conn = await asyncpg.connect(db_url)
    try:
        payload = await _fetch_hub_payload(conn, matches_limit=matches_limit)
    finally:
        await conn.close()

    output_file.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    print(f"Hub data exported -> {output_file}")
    print(f"Generated at: {payload['generated_at']}")
    print(
        "Totals: "
        f"teams={payload['summary']['teams_total']}, "
        f"matches={payload['summary']['matches_total']}, "
        f"tournaments={payload['summary']['tournaments_total']}, "
        f"schedules={payload['summary']['upcoming_schedules_total']}"
    )
    return 0


def main() -> int:
    default_db_url = (
        os.getenv("SUPABASE_DB_URL")
        or os.getenv("SUPABASE_POOLER_URL")
        or ""
    ).strip()
    parser = argparse.ArgumentParser(description="Export IOSCA hub JSON for GitHub Pages.")
    parser.add_argument(
        "--db-url",
        default=default_db_url,
        help="Postgres connection string. Defaults to SUPABASE_DB_URL, then SUPABASE_POOLER_URL.",
    )
    parser.add_argument(
        "--out",
        default="data/hub.json",
        help="Output JSON file path.",
    )
    parser.add_argument(
        "--matches-limit",
        type=int,
        default=200,
        help="How many recent matches to export.",
    )
    args = parser.parse_args()

    db_url = str(args.db_url or "").strip()
    if not db_url:
        print("Missing DB URL. Set SUPABASE_DB_URL or SUPABASE_POOLER_URL, or pass --db-url.")
        return 2

    return asyncio.run(_run(db_url, Path(args.out), args.matches_limit))


if __name__ == "__main__":
    raise SystemExit(main())
