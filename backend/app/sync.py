from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

import asyncpg

from . import config


PLAYER_MATCH_JOIN_SQL = """
(
    pmd.match_id::text = ms.match_id::text
    OR pmd.match_id::text = ms.id::text
)
"""


@dataclass(frozen=True)
class SyncResult:
    table: str
    rows: int
    max_source_updated_at: datetime | None = None

def _short_name(name: str | None) -> str | None:
    cleaned = " ".join(str(name or "").replace("-", " ").split())
    if not cleaned:
        return None
    parts = [part[0] for part in cleaned.split() if part]
    return "".join(parts[:3]).upper() or cleaned[:3].upper()


def _rows_as_dicts(rows: Iterable[Any]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def _stringify_identifier(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


DISCORD_MENTION_RE = re.compile(r"^<@!?(\d+)>$")

UPSERT_CONFLICT_TARGETS: dict[str, list[str]] = {
    "hub_players": ["steam_id"],
    "hub_teams": ["guild_id"],
    "hub_matches": ["match_stats_id"],
    "hub_match_lineups": ["match_stats_id", "side", "steam_id"],
    "hub_match_player_stats": ["source_player_match_data_id"],
    "hub_match_events": ["source_event_id"],
    "hub_player_rating_history": ["source_rating_history_id"],
    "hub_tournaments": ["tournament_id"],
    "hub_tournament_teams": ["source_id"],
    "hub_tournament_standings": ["tournament_id", "guild_id"],
    "hub_tournament_fixtures": ["fixture_id"],
}


def _hub_relation(name: str) -> str:
    return f'"{config.HUB_POSTGRES_SCHEMA}".{name}'


def _normalize_discord_identifier(value: Any) -> str | None:
    text = _stringify_identifier(value)
    if text is None:
        return None

    lowered = text.lower()
    if lowered in {"none", "null", "nan", "n/a", "unknown"}:
        return None
    if lowered.startswith("unregistered:"):
        return None

    mention_match = DISCORD_MENTION_RE.fullmatch(text)
    if mention_match:
        return mention_match.group(1)

    return text if text.isdigit() else None


def _normalize_identifier_fields(rows: list[dict[str, Any]], *field_names: str) -> list[dict[str, Any]]:
    for row in rows:
        for field_name in field_names:
            if field_name in row:
                row[field_name] = _stringify_identifier(row.get(field_name))
    return rows


def _normalize_discord_identifier_fields(rows: list[dict[str, Any]], *field_names: str) -> list[dict[str, Any]]:
    for row in rows:
        for field_name in field_names:
            if field_name in row:
                row[field_name] = _normalize_discord_identifier(row.get(field_name))
    return rows


def _max_source_updated_at(rows: list[dict[str, Any]], field_name: str = "source_updated_at") -> datetime | None:
    values = [
        row.get(field_name)
        for row in rows
        if isinstance(row.get(field_name), datetime)
    ]
    return max(values) if values else None


async def _get_sync_watermark(hub_pool: asyncpg.Pool, key: str) -> datetime | None:
    row = await hub_pool.fetchrow(
        f"SELECT last_source_updated_at FROM {_hub_relation('hub_sync_state')} WHERE sync_key = $1",
        key,
    )
    if not row:
        return None
    value = dict(row).get("last_source_updated_at")
    return value if isinstance(value, datetime) else None


async def _resolve_watermark(
    hub_pool: asyncpg.Pool,
    key: str,
    *,
    force_full: bool = False,
) -> datetime | None:
    if force_full:
        return None
    return await _get_sync_watermark(hub_pool, key)


async def _upsert_rows(
    hub_pool: asyncpg.Pool,
    table: str,
    rows: list[dict[str, Any]],
    columns: list[str],
    update_columns: list[str] | None = None,
) -> int:
    if not rows:
        return 0

    update_columns = update_columns or columns[1:]
    conflict_columns = UPSERT_CONFLICT_TARGETS.get(table)
    if not conflict_columns:
        raise RuntimeError(f"No upsert conflict target configured for {table}")

    col_sql = ", ".join(f'"{col}"' for col in columns)
    placeholders = ", ".join(f"${index}" for index in range(1, len(columns) + 1))
    conflict_sql = ", ".join(f'"{col}"' for col in conflict_columns)
    update_sql = ", ".join(f'"{col}" = EXCLUDED."{col}"' for col in update_columns)
    update_sql = f"{update_sql}, \"synced_at\" = NOW()"
    sql = f"""
        INSERT INTO {_hub_relation(table)} ({col_sql})
        VALUES ({placeholders})
        ON CONFLICT ({conflict_sql})
        DO UPDATE SET {update_sql}
    """
    values = [tuple(row.get(col) for col in columns) for row in rows]

    async with hub_pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(sql, values)

    return len(rows)


async def _replace_scoped_rows(
    hub_pool: asyncpg.Pool,
    table: str,
    scope_column: str,
    scope_values: list[Any],
    rows: list[dict[str, Any]],
    columns: list[str],
) -> int:
    async with hub_pool.acquire() as conn:
        async with conn.transaction():
            if scope_values:
                placeholders = ", ".join(f"${index}" for index in range(1, len(scope_values) + 1))
                await conn.execute(
                    f'DELETE FROM {_hub_relation(table)} WHERE "{scope_column}" IN ({placeholders})',
                    *scope_values,
                )
            if rows:
                col_sql = ", ".join(f'"{col}"' for col in columns)
                placeholders = ", ".join(f"${index}" for index in range(1, len(columns) + 1))
                await conn.executemany(
                    f"INSERT INTO {_hub_relation(table)} ({col_sql}) VALUES ({placeholders})",
                    [tuple(row.get(col) for col in columns) for row in rows],
                )
    return len(rows)


async def _mark_sync_state(
    hub_pool: asyncpg.Pool,
    key: str,
    status: str,
    rows: int,
    error: str | None = None,
    source_updated_at: datetime | None = None,
) -> None:
    await hub_pool.execute(
        f"""
        INSERT INTO {_hub_relation('hub_sync_state')} (
            sync_key,
            last_synced_at,
            last_source_updated_at,
            rows_synced,
            status,
            error_message,
            updated_at
        )
        VALUES ($1, NOW(), $2, $3, $4, $5, NOW())
        ON CONFLICT (sync_key)
        DO UPDATE SET
            last_synced_at = EXCLUDED.last_synced_at,
            last_source_updated_at = COALESCE(EXCLUDED.last_source_updated_at, {_hub_relation('hub_sync_state')}.last_source_updated_at),
            rows_synced = EXCLUDED.rows_synced,
            status = EXCLUDED.status,
            error_message = EXCLUDED.error_message,
            updated_at = NOW()
        """,
        key,
        source_updated_at,
        rows,
        status,
        error,
    )


async def _get_hub_table_columns(hub_pool: asyncpg.Pool, table: str) -> set[str]:
    rows = await hub_pool.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        """,
        config.HUB_POSTGRES_SCHEMA,
        table,
    )
    return {str(row["column_name"]) for row in rows}


async def _fetch_changed_match_scope_from_match_stats(
    pg_pool: asyncpg.Pool,
    watermark: datetime | None,
) -> tuple[list[int], datetime | None]:
    if watermark is None:
        return [], None

    rows = _rows_as_dicts(await pg_pool.fetch(
        """
        SELECT
            ms.id AS match_stats_id,
            COALESCE(ms.updated_at, ms.datetime) AS changed_at
        FROM match_stats ms
        WHERE COALESCE(ms.updated_at, ms.datetime) > $1
        """,
        watermark,
    ))
    scope_ids = sorted({int(row["match_stats_id"]) for row in rows if row.get("match_stats_id") is not None})
    return scope_ids, _max_source_updated_at(rows, "changed_at")


async def _fetch_changed_match_scope_for_player_stats(
    pg_pool: asyncpg.Pool,
    watermark: datetime | None,
) -> tuple[list[int], datetime | None]:
    if watermark is None:
        return [], None

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        SELECT
            changed.match_stats_id,
            MAX(changed.changed_at) AS changed_at
        FROM (
            SELECT
                ms.id AS match_stats_id,
                COALESCE(ms.updated_at, ms.datetime) AS changed_at
            FROM match_stats ms
            WHERE COALESCE(ms.updated_at, ms.datetime) > $1

            UNION ALL

            SELECT
                ms.id AS match_stats_id,
                COALESCE(pmd.updated_at, ms.updated_at, ms.datetime) AS changed_at
            FROM player_match_data pmd
            JOIN match_stats ms
              ON {PLAYER_MATCH_JOIN_SQL}
            WHERE COALESCE(pmd.updated_at, ms.updated_at, ms.datetime) > $1
        ) changed
        GROUP BY changed.match_stats_id
        """,
        watermark,
    ))
    scope_ids = sorted({int(row["match_stats_id"]) for row in rows if row.get("match_stats_id") is not None})
    return scope_ids, _max_source_updated_at(rows, "changed_at")


async def _fetch_changed_match_scope_for_events(
    pg_pool: asyncpg.Pool,
    watermark: datetime | None,
) -> tuple[list[int], datetime | None]:
    if watermark is None:
        return [], None

    rows = _rows_as_dicts(await pg_pool.fetch(
        """
        SELECT
            changed.match_stats_id,
            MAX(changed.changed_at) AS changed_at
        FROM (
            SELECT
                ms.id AS match_stats_id,
                COALESCE(ms.updated_at, ms.datetime) AS changed_at
            FROM match_stats ms
            WHERE COALESCE(ms.updated_at, ms.datetime) > $1

            UNION ALL

            SELECT
                me.match_stats_id,
                COALESCE(me.created_at, ms.updated_at, ms.datetime) AS changed_at
            FROM match_events me
            JOIN match_stats ms ON ms.id = me.match_stats_id
            WHERE COALESCE(me.created_at, ms.updated_at, ms.datetime) > $1
        ) changed
        GROUP BY changed.match_stats_id
        """,
        watermark,
    ))
    scope_ids = sorted({int(row["match_stats_id"]) for row in rows if row.get("match_stats_id") is not None})
    return scope_ids, _max_source_updated_at(rows, "changed_at")


async def sync_players(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_players", force_full=force_full)
    params: list[Any] = []
    where_sql = ""
    if watermark is not None:
        where_sql = "WHERE COALESCE(updated_at, registered_at) > $1"
        params.append(watermark)

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        SELECT
            steam_id,
            discord_id,
            COALESCE(NULLIF(discord_name, ''), steam_id) AS display_name,
            main_role AS primary_position,
            COALESCE(display_main_role_rating, rating) AS rating,
            atk_rating,
            mid_rating,
            def_rating,
            gk_rating,
            total_appearances AS appearances,
            total_minutes,
            last_match_at,
            registered_at,
            COALESCE(updated_at, registered_at) AS source_updated_at
        FROM iosca_players
        {where_sql}
        """,
        *params,
    ))
    _normalize_identifier_fields(rows, "steam_id")
    _normalize_discord_identifier_fields(rows, "discord_id")
    max_source_updated_at = _max_source_updated_at(rows)

    return SyncResult(
        "hub_players",
        await _upsert_rows(
            hub_pool,
            "hub_players",
            rows,
            [
                "steam_id", "discord_id", "display_name", "primary_position", "rating",
                "atk_rating", "mid_rating", "def_rating", "gk_rating", "appearances",
                "total_minutes", "last_match_at", "registered_at", "source_updated_at",
            ],
        ),
        max_source_updated_at,
    )


async def sync_teams(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_teams", force_full=force_full)
    params: list[Any] = []
    where_sql = ""
    if watermark is not None:
        where_sql = "WHERE COALESCE(updated_at, created_at) > $1"
        params.append(watermark)

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        SELECT
            guild_id,
            guild_name AS name,
            guild_icon AS crest_url,
            captain_id AS captain_discord_id,
            captain_name,
            average_rating,
            COALESCE(is_national_team, false) AS is_national_team,
            COALESCE(is_mix_team, false) AS is_mix_team,
            created_at,
            COALESCE(updated_at, created_at) AS source_updated_at
        FROM iosca_teams
        {where_sql}
        """,
        *params,
    ))
    _normalize_identifier_fields(rows, "guild_id")
    _normalize_discord_identifier_fields(rows, "captain_discord_id")
    for row in rows:
        row["short_name"] = _short_name(row.get("name"))
    max_source_updated_at = _max_source_updated_at(rows)

    return SyncResult(
        "hub_teams",
        await _upsert_rows(
            hub_pool,
            "hub_teams",
            rows,
            [
                "guild_id", "name", "short_name", "crest_url", "captain_discord_id",
                "captain_name", "average_rating", "is_national_team", "is_mix_team",
                "created_at", "source_updated_at",
            ],
        ),
        max_source_updated_at,
    )


async def sync_matches(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_matches", force_full=force_full)
    params: list[Any] = []
    if watermark is not None:
        params.append(watermark)
        sql = f"""
        WITH changed_matches AS (
            SELECT DISTINCT changed.match_stats_id
            FROM (
                SELECT
                    ms.id AS match_stats_id
                FROM match_stats ms
                WHERE COALESCE(ms.updated_at, ms.datetime) > $1

                UNION

                SELECT
                    ms.id AS match_stats_id
                FROM player_match_data pmd
                JOIN match_stats ms
                  ON {PLAYER_MATCH_JOIN_SQL}
                WHERE pmd.is_match_mvp = true
                  AND COALESCE(pmd.updated_at, ms.updated_at, ms.datetime) > $1
            ) changed
        ),
        mvp AS (
            SELECT DISTINCT ON (pmd.match_id::text)
                pmd.match_id::text AS match_id_key,
                pmd.steam_id AS mvp_steam_id,
                pmd.player_name AS mvp_player_name,
                pmd.match_rating AS mvp_match_rating,
                COALESCE(pmd.updated_at, ms.updated_at, ms.datetime) AS mvp_source_updated_at
            FROM player_match_data pmd
            JOIN match_stats ms
              ON {PLAYER_MATCH_JOIN_SQL}
            WHERE pmd.is_match_mvp = true
            ORDER BY pmd.match_id::text, pmd.match_rating DESC NULLS LAST, pmd.id
        )
        SELECT
            ms.id AS match_stats_id,
            ms.match_id,
            ms.datetime AS match_datetime,
            ms.home_guild_id,
            ms.away_guild_id,
            ms.home_team_name,
            ms.away_team_name,
            ms.home_score,
            ms.away_score,
            ms.game_type,
            COALESCE(ms.extratime, false) AS extratime,
            COALESCE(ms.penalties, false) AS penalties,
            COALESCE(ms.comeback_flag, false) AS comeback_flag,
            ms.source_filename,
            mvp.mvp_steam_id,
            mvp.mvp_player_name,
            mvp.mvp_match_rating,
            GREATEST(
                COALESCE(ms.updated_at, ms.datetime),
                COALESCE(mvp.mvp_source_updated_at, COALESCE(ms.updated_at, ms.datetime))
            ) AS source_updated_at
        FROM match_stats ms
        JOIN changed_matches cm ON cm.match_stats_id = ms.id
        LEFT JOIN mvp ON mvp.match_id_key IN (ms.match_id::text, ms.id::text)
        """
    else:
        sql = f"""
        WITH mvp AS (
            SELECT DISTINCT ON (pmd.match_id::text)
                pmd.match_id::text AS match_id_key,
                pmd.steam_id AS mvp_steam_id,
                pmd.player_name AS mvp_player_name,
                pmd.match_rating AS mvp_match_rating,
                COALESCE(pmd.updated_at, ms.updated_at, ms.datetime) AS mvp_source_updated_at
            FROM player_match_data pmd
            JOIN match_stats ms
              ON {PLAYER_MATCH_JOIN_SQL}
            WHERE pmd.is_match_mvp = true
            ORDER BY pmd.match_id::text, pmd.match_rating DESC NULLS LAST, pmd.id
        )
        SELECT
            ms.id AS match_stats_id,
            ms.match_id,
            ms.datetime AS match_datetime,
            ms.home_guild_id,
            ms.away_guild_id,
            ms.home_team_name,
            ms.away_team_name,
            ms.home_score,
            ms.away_score,
            ms.game_type,
            COALESCE(ms.extratime, false) AS extratime,
            COALESCE(ms.penalties, false) AS penalties,
            COALESCE(ms.comeback_flag, false) AS comeback_flag,
            ms.source_filename,
            mvp.mvp_steam_id,
            mvp.mvp_player_name,
            mvp.mvp_match_rating,
            GREATEST(
                COALESCE(ms.updated_at, ms.datetime),
                COALESCE(mvp.mvp_source_updated_at, COALESCE(ms.updated_at, ms.datetime))
            ) AS source_updated_at
        FROM match_stats ms
        LEFT JOIN mvp ON mvp.match_id_key IN (ms.match_id::text, ms.id::text)
        """

    rows = _rows_as_dicts(await pg_pool.fetch(sql, *params))
    _normalize_identifier_fields(rows, "match_id", "home_guild_id", "away_guild_id", "mvp_steam_id")
    max_source_updated_at = _max_source_updated_at(rows)

    return SyncResult(
        "hub_matches",
        await _upsert_rows(
            hub_pool,
            "hub_matches",
            rows,
            [
                "match_stats_id", "match_id", "match_datetime", "home_guild_id",
                "away_guild_id", "home_team_name", "away_team_name", "home_score",
                "away_score", "game_type", "extratime", "penalties", "comeback_flag",
                "source_filename", "mvp_steam_id", "mvp_player_name", "mvp_match_rating",
                "source_updated_at",
            ],
        ),
        max_source_updated_at,
    )


async def sync_match_lineups(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_match_lineups", force_full=force_full)
    scope_ids, max_scope_updated_at = await _fetch_changed_match_scope_from_match_stats(pg_pool, watermark)

    if watermark is not None and not scope_ids:
        return SyncResult("hub_match_lineups", 0, None)

    params: list[Any] = []
    where_sql = ""
    lineup_filter_sql = "WHERE COALESCE(lineup.player->>'steam_id', '') <> ''"
    if scope_ids:
        where_sql = "WHERE ms.id = ANY($1::int[])"
        lineup_filter_sql = "AND COALESCE(lineup.player->>'steam_id', '') <> ''"
        params.append(scope_ids)

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        SELECT
            ms.id AS match_stats_id,
            side,
            lineup.player->>'steam_id' AS steam_id,
            CASE WHEN side = 'home' THEN ms.home_guild_id ELSE ms.away_guild_id END AS team_guild_id,
            COALESCE(lineup.player->>'name', 'Unknown') AS player_name,
            lineup.player->>'position' AS position_code,
            COALESCE((lineup.player->>'started')::boolean, false) AS started,
            lineup.slot_order::int AS slot_order,
            COALESCE(ms.updated_at, ms.datetime) AS source_updated_at
        FROM match_stats ms
        CROSS JOIN LATERAL (
            SELECT 'home' AS side, player, slot_order
            FROM jsonb_array_elements(COALESCE(ms.home_lineup, '[]'::jsonb)) WITH ORDINALITY AS home(player, slot_order)
            UNION ALL
            SELECT 'away' AS side, player, slot_order
            FROM jsonb_array_elements(COALESCE(ms.away_lineup, '[]'::jsonb)) WITH ORDINALITY AS away(player, slot_order)
        ) lineup
        {where_sql}
        {lineup_filter_sql}
        """,
        *params,
    ))
    _normalize_identifier_fields(rows, "steam_id", "team_guild_id")

    if watermark is None:
        scope_ids = sorted({int(row["match_stats_id"]) for row in rows if row.get("match_stats_id") is not None})
        max_scope_updated_at = _max_source_updated_at(rows)

    return SyncResult(
        "hub_match_lineups",
        await _replace_scoped_rows(
            hub_pool,
            "hub_match_lineups",
            "match_stats_id",
            scope_ids,
            rows,
            [
                "match_stats_id", "side", "steam_id", "team_guild_id", "player_name",
                "position_code", "started", "slot_order",
            ],
        ),
        max_scope_updated_at,
    )


async def sync_match_player_stats(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_match_player_stats", force_full=force_full)
    scope_ids, max_scope_updated_at = await _fetch_changed_match_scope_for_player_stats(pg_pool, watermark)

    if watermark is not None and not scope_ids:
        return SyncResult("hub_match_player_stats", 0, None)

    params: list[Any] = []
    where_sql = ""
    if scope_ids:
        where_sql = "WHERE ms.id = ANY($1::int[])"
        params.append(scope_ids)

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        WITH lineup_side AS (
            SELECT DISTINCT ON (expanded.match_stats_id, expanded.steam_id)
                expanded.match_stats_id,
                expanded.side,
                expanded.steam_id
            FROM (
                SELECT
                    ms.id AS match_stats_id,
                    lineup.side,
                    NULLIF(TRIM(lineup.player ->> 'steam_id'), '') AS steam_id
                FROM match_stats ms
                CROSS JOIN LATERAL (
                    SELECT 'home'::text AS side, home.player
                    FROM jsonb_array_elements(COALESCE(ms.home_lineup, '[]'::jsonb)) AS home(player)
                    UNION ALL
                    SELECT 'away'::text AS side, away.player
                    FROM jsonb_array_elements(COALESCE(ms.away_lineup, '[]'::jsonb)) AS away(player)
                ) lineup
            ) expanded
            WHERE expanded.steam_id IS NOT NULL
            ORDER BY expanded.match_stats_id, expanded.steam_id, expanded.side
        )
        SELECT
            pmd.id AS source_player_match_data_id,
            ms.id AS match_stats_id,
            ms.match_id,
            pmd.steam_id,
            COALESCE(
                pmd.guild_id::text,
                CASE
                    WHEN pmd.guild_id::text = ms.home_guild_id::text THEN ms.home_guild_id::text
                    WHEN pmd.guild_id::text = ms.away_guild_id::text THEN ms.away_guild_id::text
                    WHEN pmd.guild_team_name = ms.home_team_name THEN ms.home_guild_id::text
                    WHEN pmd.guild_team_name = ms.away_team_name THEN ms.away_guild_id::text
                    WHEN lineup_side.side = 'home' THEN ms.home_guild_id::text
                    WHEN lineup_side.side = 'away' THEN ms.away_guild_id::text
                    ELSE NULL
                END
            ) AS team_guild_id,
            CASE
                WHEN pmd.guild_id::text = ms.home_guild_id::text THEN 'home'
                WHEN pmd.guild_id::text = ms.away_guild_id::text THEN 'away'
                WHEN pmd.guild_team_name = ms.home_team_name THEN 'home'
                WHEN pmd.guild_team_name = ms.away_team_name THEN 'away'
                ELSE lineup_side.side
            END AS team_side,
            pmd.guild_team_name,
            pmd.player_name,
            pmd.position AS position_code,
            pmd.status,
            pmd.match_rating,
            COALESCE(pmd.is_match_mvp, false) AS is_match_mvp,
            COALESCE(pmd.goals, 0) AS goals,
            COALESCE(pmd.assists, 0) AS assists,
            COALESCE(pmd.second_assists, 0) AS second_assists,
            COALESCE(pmd.shots, 0) AS shots,
            COALESCE(pmd.shots_on_goal, 0) AS shots_on_goal,
            COALESCE(pmd.passes_completed, 0) AS passes_completed,
            COALESCE(pmd.passes_attempted, 0) AS passes_attempted,
            COALESCE(pmd.pass_accuracy, 0) AS pass_accuracy,
            COALESCE(pmd.chances_created, 0) AS chances_created,
            COALESCE(pmd.key_passes, 0) AS key_passes,
            COALESCE(pmd.interceptions, 0) AS interceptions,
            COALESCE(pmd.tackles, 0) AS tackles,
            COALESCE(pmd.sliding_tackles_completed, 0) AS sliding_tackles_completed,
            COALESCE(pmd.fouls, 0) AS fouls,
            COALESCE(pmd.fouls_suffered, 0) AS fouls_suffered,
            COALESCE(pmd.yellow_cards, 0) AS yellow_cards,
            COALESCE(pmd.red_cards, 0) AS red_cards,
            COALESCE(pmd.own_goals, 0) AS own_goals,
            COALESCE(pmd.keeper_saves, 0) AS keeper_saves,
            COALESCE(pmd.keeper_saves_caught, 0) AS keeper_saves_caught,
            COALESCE(pmd.goals_conceded, 0) AS goals_conceded,
            COALESCE(pmd.free_kicks, 0) AS free_kicks,
            COALESCE(pmd.penalties, 0) AS penalties,
            COALESCE(pmd.corners, 0) AS corners,
            COALESCE(pmd.throw_ins, 0) AS throw_ins,
            COALESCE(pmd.goal_kicks, 0) AS goal_kicks,
            COALESCE(pmd.offsides, 0) AS offsides,
            COALESCE(pmd.possession, 0) AS possession,
            COALESCE(pmd.time_played, 0) AS time_played,
            COALESCE(pmd.distance_covered, 0) AS distance_covered,
            COALESCE(pmd.updated_at, ms.updated_at, ms.datetime) AS source_updated_at
        FROM player_match_data pmd
        JOIN match_stats ms
          ON {PLAYER_MATCH_JOIN_SQL}
        LEFT JOIN lineup_side
          ON lineup_side.match_stats_id = ms.id
         AND lineup_side.steam_id = pmd.steam_id::text
        {where_sql}
        """,
        *params,
    ))
    _normalize_identifier_fields(rows, "match_id", "steam_id", "team_guild_id")

    if watermark is None:
        scope_ids = sorted({int(row["match_stats_id"]) for row in rows if row.get("match_stats_id") is not None})
        max_scope_updated_at = _max_source_updated_at(rows)

    available_columns = await _get_hub_table_columns(hub_pool, "hub_match_player_stats")
    desired_columns = [
        "source_player_match_data_id", "match_stats_id", "match_id", "steam_id",
        "team_guild_id", "team_side", "guild_team_name", "player_name",
        "position_code", "status", "match_rating", "is_match_mvp", "goals",
        "assists", "second_assists", "shots", "shots_on_goal", "passes_completed",
        "passes_attempted", "pass_accuracy", "chances_created", "key_passes",
        "interceptions", "tackles", "sliding_tackles_completed", "fouls",
        "fouls_suffered", "yellow_cards", "red_cards", "own_goals",
        "keeper_saves", "keeper_saves_caught", "goals_conceded", "free_kicks",
        "penalties", "corners", "throw_ins", "goal_kicks", "offsides",
        "possession", "time_played", "distance_covered", "source_updated_at",
    ]
    insert_columns = [column for column in desired_columns if column in available_columns]

    return SyncResult(
        "hub_match_player_stats",
        await _replace_scoped_rows(
            hub_pool,
            "hub_match_player_stats",
            "match_stats_id",
            scope_ids,
            rows,
            insert_columns,
        ),
        max_scope_updated_at,
    )


async def sync_match_events(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_match_events", force_full=force_full)
    scope_ids, max_scope_updated_at = await _fetch_changed_match_scope_for_events(pg_pool, watermark)

    if watermark is not None and not scope_ids:
        return SyncResult("hub_match_events", 0, None)

    params: list[Any] = []
    where_sql = ""
    if scope_ids:
        where_sql = "WHERE me.match_stats_id = ANY($1::int[])"
        params.append(scope_ids)

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        SELECT
            me.id AS source_event_id,
            me.match_stats_id,
            me.match_id,
            me.event_index,
            me.event_type,
            me.raw_event,
            me.team AS team_side,
            CASE
                WHEN me.team = 'home' THEN ms.home_guild_id
                WHEN me.team = 'away' THEN ms.away_guild_id
                ELSE NULL
            END AS team_guild_id,
            me.period,
            me.raw_second,
            me.match_second,
            me.minute,
            me.clock,
            me.player1_steam_id,
            me.player2_steam_id,
            me.player3_steam_id,
            me.body_part,
            me.x,
            me.y,
            me.norm_x,
            me.norm_y,
            me.raw_event_payload AS raw_event_payload,
            COALESCE(me.created_at, ms.updated_at, ms.datetime) AS source_updated_at
        FROM match_events me
        JOIN match_stats ms ON ms.id = me.match_stats_id
        {where_sql}
        """,
        *params,
    ))
    _normalize_identifier_fields(
        rows,
        "source_event_id",
        "match_id",
        "team_guild_id",
        "player1_steam_id",
        "player2_steam_id",
        "player3_steam_id",
    )

    if watermark is None:
        scope_ids = sorted({int(row["match_stats_id"]) for row in rows if row.get("match_stats_id") is not None})
        max_scope_updated_at = _max_source_updated_at(rows)

    return SyncResult(
        "hub_match_events",
        await _replace_scoped_rows(
            hub_pool,
            "hub_match_events",
            "match_stats_id",
            scope_ids,
            rows,
            [
                "source_event_id", "match_stats_id", "match_id", "event_index",
                "event_type", "raw_event", "team_side", "team_guild_id", "period",
                "raw_second", "match_second", "minute", "clock", "player1_steam_id",
                "player2_steam_id", "player3_steam_id", "body_part", "x", "y",
                "norm_x", "norm_y", "raw_event_payload",
            ],
        ),
        max_scope_updated_at,
    )


async def sync_rating_history(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> SyncResult:
    watermark = await _resolve_watermark(hub_pool, "hub_player_rating_history", force_full=force_full)
    params: list[Any] = []
    where_sql = ""
    if watermark is not None:
        where_sql = "WHERE rating_run_at > $1"
        params.append(watermark)

    rows = _rows_as_dicts(await pg_pool.fetch(
        f"""
        SELECT
            id AS source_rating_history_id,
            steam_id,
            player_name,
            rating,
            atk_rating,
            mid_rating,
            def_rating,
            gk_rating,
            main_role,
            main_role_rating,
            display_main_role_rating,
            total_appearances,
            total_minutes,
            last_match_at,
            formula_version,
            source,
            rating_run_at,
            rating_run_at AS source_updated_at
        FROM player_rating_history
        {where_sql}
        """,
        *params,
    ))
    _normalize_identifier_fields(rows, "steam_id")
    max_source_updated_at = _max_source_updated_at(rows)

    return SyncResult(
        "hub_player_rating_history",
        await _upsert_rows(
            hub_pool,
            "hub_player_rating_history",
            rows,
            [
                "source_rating_history_id", "steam_id", "player_name", "rating",
                "atk_rating", "mid_rating", "def_rating", "gk_rating", "main_role",
                "main_role_rating", "display_main_role_rating", "total_appearances",
                "total_minutes", "last_match_at", "formula_version", "source",
                "rating_run_at",
            ],
        ),
        max_source_updated_at,
    )


async def sync_tournaments(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> list[SyncResult]:
    tournaments = _rows_as_dicts(await pg_pool.fetch(
        """
        SELECT
            id AS tournament_id,
            name,
            format,
            status,
            num_teams,
            league_count,
            points_win,
            points_draw,
            points_loss,
            created_at,
            COALESCE(updated_at, created_at) AS source_updated_at
        FROM tournaments
        """
    ))
    teams = _rows_as_dicts(await pg_pool.fetch(
        """
        SELECT
            id AS source_id,
            tournament_id,
            guild_id,
            team_name_snapshot AS team_name,
            team_icon_snapshot AS team_icon,
            league_key,
            seed
        FROM tournament_teams
        """
    ))
    standings = _rows_as_dicts(await pg_pool.fetch(
        """
        SELECT
            tournament_id,
            guild_id,
            wins,
            draws,
            losses,
            goals_for,
            goals_against,
            goal_diff,
            points,
            matches_played,
            updated_at AS source_updated_at
        FROM tournament_standings
        """
    ))
    fixtures = _rows_as_dicts(await pg_pool.fetch(
        """
        SELECT
            id AS fixture_id,
            tournament_id,
            league_key,
            week_number,
            week_label,
            home_guild_id,
            away_guild_id,
            home_name_raw AS home_name,
            away_name_raw AS away_name,
            is_active,
            is_played,
            is_draw_home,
            is_draw_away,
            is_forfeit_home,
            is_forfeit_away,
            forfeit_score,
            played_match_stats_id,
            played_at,
            created_at
        FROM tournament_fixtures
        """
    ))
    _normalize_identifier_fields(teams, "guild_id")
    _normalize_identifier_fields(standings, "guild_id")
    _normalize_identifier_fields(fixtures, "home_guild_id", "away_guild_id")

    tournament_max = _max_source_updated_at(tournaments)
    standings_max = _max_source_updated_at(standings)

    return [
        SyncResult(
            "hub_tournaments",
            await _upsert_rows(
                hub_pool,
                "hub_tournaments",
                tournaments,
                [
                    "tournament_id", "name", "format", "status", "num_teams",
                    "league_count", "points_win", "points_draw", "points_loss",
                    "created_at", "source_updated_at",
                ],
            ),
            tournament_max,
        ),
        SyncResult(
            "hub_tournament_teams",
            await _upsert_rows(
                hub_pool,
                "hub_tournament_teams",
                teams,
                ["source_id", "tournament_id", "guild_id", "team_name", "team_icon", "league_key", "seed"],
            ),
            None,
        ),
        SyncResult(
            "hub_tournament_standings",
            await _upsert_rows(
                hub_pool,
                "hub_tournament_standings",
                standings,
                [
                    "tournament_id", "guild_id", "wins", "draws", "losses", "goals_for",
                    "goals_against", "goal_diff", "points", "matches_played", "source_updated_at",
                ],
            ),
            standings_max,
        ),
        SyncResult(
            "hub_tournament_fixtures",
            await _upsert_rows(
                hub_pool,
                "hub_tournament_fixtures",
                fixtures,
                [
                    "fixture_id", "tournament_id", "league_key", "week_number", "week_label",
                    "home_guild_id", "away_guild_id", "home_name", "away_name", "is_active",
                    "is_played", "is_draw_home", "is_draw_away", "is_forfeit_home",
                    "is_forfeit_away", "forfeit_score", "played_match_stats_id", "played_at", "created_at",
                ],
            ),
            None,
        ),
    ]


async def sync_all(pg_pool: asyncpg.Pool, hub_pool: asyncpg.Pool, *, force_full: bool = False) -> list[SyncResult]:
    results: list[SyncResult] = []
    try:
        for syncer in (
            sync_players,
            sync_teams,
            sync_matches,
            sync_match_lineups,
            sync_match_player_stats,
            sync_match_events,
            sync_rating_history,
        ):
            result = await syncer(pg_pool, hub_pool, force_full=force_full)
            results.append(result)
            await _mark_sync_state(
                hub_pool,
                result.table,
                "ok",
                result.rows,
                source_updated_at=result.max_source_updated_at,
            )

        for result in await sync_tournaments(pg_pool, hub_pool, force_full=force_full):
            results.append(result)
            await _mark_sync_state(
                hub_pool,
                result.table,
                "ok",
                result.rows,
                source_updated_at=result.max_source_updated_at,
            )

        await _mark_sync_state(
            hub_pool,
            "full_sync",
            "ok",
            sum(r.rows for r in results),
            source_updated_at=max(
                (r.max_source_updated_at for r in results if r.max_source_updated_at is not None),
                default=None,
            ),
        )
        return results
    except Exception as exc:
        await _mark_sync_state(hub_pool, "full_sync", "error", sum(r.rows for r in results), str(exc))
        raise
