from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from . import cache, config
from .db import create_hub_postgres_pool, public_row, public_rows

OPTIONAL_MATCH_PLAYER_STATS_COLUMNS = (
    "free_kicks",
    "penalties",
    "corners",
    "throw_ins",
    "goal_kicks",
)


async def _fetch_table_columns(pool, table_name: str) -> set[str]:
    rows = await pool.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        """,
        config.HUB_POSTGRES_SCHEMA,
        table_name,
    )
    return {str(row["column_name"]) for row in rows}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.hub_pool = await create_hub_postgres_pool()
    app.state.redis = await cache.create_redis_client()
    app.state.hub_match_player_stats_columns = await _fetch_table_columns(
        app.state.hub_pool,
        "hub_match_player_stats",
    )
    try:
        yield
    finally:
        await cache.close_redis_client(getattr(app.state, "redis", None))
        await app.state.hub_pool.close()


app = FastAPI(title=config.API_TITLE, version=config.API_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


def build_player_stats_subquery(existing_columns: set[str] | None = None) -> str:
    existing_columns = existing_columns or set()
    recent_window_sql = "m.match_datetime >= NOW() - INTERVAL '7 days'"
    optional_stat_sql = "\n".join(
        (
            f"        SUM(pmd.{column}) AS {column},"
            if column in existing_columns
            else f"        0 AS {column},"
        )
        for column in OPTIONAL_MATCH_PLAYER_STATS_COLUMNS
    )

    return f"""
    SELECT
        pmd.steam_id,
        SUM(pmd.goals) AS goals,
        SUM(pmd.assists) AS assists,
        SUM(pmd.second_assists) AS second_assists,
        SUM(pmd.shots) AS shots,
        SUM(pmd.shots_on_goal) AS shots_on_goal,
        SUM(pmd.passes_completed) AS passes_completed,
        SUM(pmd.passes_attempted) AS passes_attempted,
        CASE
            WHEN SUM(pmd.passes_attempted) > 0
                THEN ROUND((SUM(pmd.passes_completed)::numeric / SUM(pmd.passes_attempted)::numeric) * 100, 2)
            ELSE 0
        END AS pass_accuracy,
        SUM(pmd.chances_created) AS chances_created,
        SUM(pmd.key_passes) AS key_passes,
        SUM(pmd.interceptions) AS interceptions,
        SUM(pmd.tackles) AS tackles,
        SUM(pmd.sliding_tackles_completed) AS sliding_tackles_completed,
        SUM(pmd.fouls) AS fouls,
        SUM(pmd.fouls_suffered) AS fouls_suffered,
        SUM(pmd.yellow_cards) AS yellow_cards,
        SUM(pmd.red_cards) AS red_cards,
        SUM(pmd.own_goals) AS own_goals,
        SUM(pmd.keeper_saves) AS keeper_saves,
        SUM(pmd.keeper_saves_caught) AS keeper_saves_caught,
        SUM(pmd.goals_conceded) AS goals_conceded,
{optional_stat_sql}
        SUM(pmd.offsides) AS offsides,
        AVG(pmd.possession) AS possession,
        SUM(pmd.time_played) AS time_played,
        SUM(pmd.distance_covered) AS distance_covered,
        AVG(pmd.match_rating) AS avg_match_rating,
        SUM(CASE WHEN pmd.is_match_mvp THEN 1 ELSE 0 END) AS mvp_awards,
        SUM(CASE WHEN {recent_window_sql} THEN 1 ELSE 0 END) AS recent_appearances,
        SUM(CASE WHEN {recent_window_sql} THEN pmd.goals ELSE 0 END) AS recent_goals,
        SUM(CASE WHEN {recent_window_sql} THEN pmd.assists ELSE 0 END) AS recent_assists,
        SUM(CASE WHEN {recent_window_sql} THEN pmd.yellow_cards ELSE 0 END) AS recent_yellow_cards,
        SUM(CASE WHEN {recent_window_sql} THEN pmd.keeper_saves ELSE 0 END) AS recent_saves,
        SUM(CASE WHEN {recent_window_sql} THEN pmd.distance_covered ELSE 0 END) AS recent_distance_covered,
        SUM(CASE WHEN {recent_window_sql} AND pmd.is_match_mvp THEN 1 ELSE 0 END) AS recent_mvp_awards,
        AVG(CASE WHEN {recent_window_sql} THEN pmd.match_rating END) AS recent_avg_match_rating,
        SUM(
            CASE
                WHEN (pmd.team_side = 'home' AND m.home_score > m.away_score)
                  OR (pmd.team_side = 'away' AND m.away_score > m.home_score)
                    THEN 1
                ELSE 0
            END
        ) AS wins,
        SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) AS draws,
        SUM(
            CASE
                WHEN (pmd.team_side = 'home' AND m.home_score < m.away_score)
                  OR (pmd.team_side = 'away' AND m.away_score < m.home_score)
                    THEN 1
                ELSE 0
            END
        ) AS losses
    FROM hub_match_player_stats pmd
    LEFT JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
    GROUP BY pmd.steam_id
"""

CURRENT_PLAYER_TEAM_SUBQUERY = """
    SELECT
        latest.steam_id,
        latest.resolved_team_guild_id AS team_guild_id,
        latest.resolved_team_name AS guild_team_name
    FROM (
        SELECT
            pmd.steam_id,
            COALESCE(
                NULLIF(pmd.team_guild_id, ''),
                CASE
                    WHEN pmd.team_side = 'home' THEN m.home_guild_id
                    WHEN pmd.team_side = 'away' THEN m.away_guild_id
                    ELSE NULL
                END
            ) AS resolved_team_guild_id,
            COALESCE(
                NULLIF(pmd.guild_team_name, ''),
                CASE
                    WHEN pmd.team_side = 'home' THEN m.home_team_name
                    WHEN pmd.team_side = 'away' THEN m.away_team_name
                    ELSE NULL
                END
            ) AS resolved_team_name,
            ROW_NUMBER() OVER (
                PARTITION BY pmd.steam_id
                ORDER BY COALESCE(pmd.source_updated_at, m.source_updated_at, m.match_datetime) DESC, pmd.match_stats_id DESC
            ) AS row_num
        FROM hub_match_player_stats pmd
        LEFT JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
        WHERE pmd.team_guild_id IS NOT NULL OR pmd.team_side IN ('home', 'away')
    ) latest
    WHERE latest.row_num = 1
"""

PLAYER_DETAILED_POSITION_SUBQUERY = """
    SELECT
        ranked.steam_id,
        ranked.position_code AS primary_position
    FROM (
        SELECT
            aggregated.steam_id,
            aggregated.position_code,
            ROW_NUMBER() OVER (
                PARTITION BY aggregated.steam_id
                ORDER BY aggregated.appearances_at_position DESC, aggregated.last_used_at DESC, aggregated.position_code ASC
            ) AS row_num
        FROM (
            SELECT
                pmd.steam_id,
                UPPER(TRIM(pmd.position_code)) AS position_code,
                COUNT(*) AS appearances_at_position,
                MAX(COALESCE(pmd.source_updated_at, m.source_updated_at, m.match_datetime)) AS last_used_at
            FROM hub_match_player_stats pmd
            LEFT JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
            WHERE pmd.position_code IS NOT NULL
              AND TRIM(pmd.position_code) <> ''
            GROUP BY pmd.steam_id, UPPER(TRIM(pmd.position_code))
        ) aggregated
    ) ranked
    WHERE ranked.row_num = 1
"""

PLAYER_SELECT_FIELDS = """
    p.steam_id,
    p.discord_id,
    p.display_name,
    COALESCE(
        (
            SELECT profile.avatar_url
            FROM hub_profile_overrides profile
            WHERE profile.owner_type = 'player'
              AND profile.owner_key = p.steam_id
            LIMIT 1
        ),
        (
            SELECT profile.avatar_url
            FROM hub_profile_overrides profile
            WHERE profile.owner_type = 'discord_user'
              AND profile.owner_key = p.discord_id::text
            LIMIT 1
        )
    ) AS avatar_url,
    COALESCE(position_history.primary_position, p.primary_position) AS primary_position,
    p.rating,
    p.atk_rating,
    p.mid_rating,
    p.def_rating,
    p.gk_rating,
    p.appearances,
    p.total_minutes,
    p.last_match_at,
    p.registered_at,
    p.source_updated_at,
    p.synced_at,
    current_team.team_guild_id AS current_team_guild_id,
    current_team.guild_team_name AS current_team_name,
    COALESCE(stats.goals, 0) AS goals,
    COALESCE(stats.assists, 0) AS assists,
    COALESCE(stats.second_assists, 0) AS second_assists,
    COALESCE(stats.shots, 0) AS shots,
    COALESCE(stats.shots_on_goal, 0) AS shots_on_goal,
    COALESCE(stats.passes_completed, 0) AS passes_completed,
    COALESCE(stats.passes_attempted, 0) AS passes_attempted,
    COALESCE(stats.pass_accuracy, 0) AS pass_accuracy,
    COALESCE(stats.chances_created, 0) AS chances_created,
    COALESCE(stats.key_passes, 0) AS key_passes,
    COALESCE(stats.interceptions, 0) AS interceptions,
    COALESCE(stats.tackles, 0) AS tackles,
    COALESCE(stats.sliding_tackles_completed, 0) AS sliding_tackles_completed,
    COALESCE(stats.fouls, 0) AS fouls,
    COALESCE(stats.fouls_suffered, 0) AS fouls_suffered,
    COALESCE(stats.yellow_cards, 0) AS yellow_cards,
    COALESCE(stats.red_cards, 0) AS red_cards,
    COALESCE(stats.own_goals, 0) AS own_goals,
    COALESCE(stats.keeper_saves, 0) AS keeper_saves,
    COALESCE(stats.keeper_saves_caught, 0) AS keeper_saves_caught,
    COALESCE(stats.goals_conceded, 0) AS goals_conceded,
    COALESCE(stats.free_kicks, 0) AS free_kicks,
    COALESCE(stats.penalties, 0) AS penalties,
    COALESCE(stats.corners, 0) AS corners,
    COALESCE(stats.throw_ins, 0) AS throw_ins,
    COALESCE(stats.goal_kicks, 0) AS goal_kicks,
    COALESCE(stats.offsides, 0) AS offsides,
    COALESCE(stats.possession, 0) AS possession,
    COALESCE(stats.time_played, 0) AS time_played,
    COALESCE(stats.distance_covered, 0) AS distance_covered,
    COALESCE(stats.avg_match_rating, 0) AS avg_match_rating,
    COALESCE(stats.mvp_awards, 0) AS mvp_awards,
    COALESCE(stats.recent_appearances, 0) AS recent_appearances,
    COALESCE(stats.recent_goals, 0) AS recent_goals,
    COALESCE(stats.recent_assists, 0) AS recent_assists,
    COALESCE(stats.recent_yellow_cards, 0) AS recent_yellow_cards,
    COALESCE(stats.recent_saves, 0) AS recent_saves,
    COALESCE(stats.recent_distance_covered, 0) AS recent_distance_covered,
    COALESCE(stats.recent_mvp_awards, 0) AS recent_mvp_awards,
    COALESCE(stats.recent_avg_match_rating, 0) AS recent_avg_match_rating,
    COALESCE(stats.wins, 0) AS wins,
    COALESCE(stats.draws, 0) AS draws,
    COALESCE(stats.losses, 0) AS losses
"""

def build_player_select_from(existing_columns: set[str] | None = None) -> str:
    return f"""
    FROM hub_players p
    LEFT JOIN ({build_player_stats_subquery(existing_columns)}) stats ON stats.steam_id = p.steam_id
    LEFT JOIN ({CURRENT_PLAYER_TEAM_SUBQUERY}) current_team ON current_team.steam_id = p.steam_id
    LEFT JOIN ({PLAYER_DETAILED_POSITION_SUBQUERY}) position_history ON position_history.steam_id = p.steam_id
"""

MATCH_SELECT_FIELDS = """
    m.match_stats_id,
    m.match_id,
    m.match_datetime,
    m.home_guild_id,
    m.away_guild_id,
    m.home_team_name,
    m.home_short_name,
    m.home_crest_url,
    m.away_team_name,
    m.away_short_name,
    m.away_crest_url,
    m.home_score,
    m.away_score,
    m.game_type,
    m.extratime,
    m.penalties,
    m.comeback_flag,
    m.source_filename,
    m.mvp_steam_id,
    m.mvp_player_name,
    m.mvp_match_rating,
    m.source_updated_at,
    m.synced_at,
    fixture.tournament_id,
    tournament.name AS tournament_name,
    fixture.league_key,
    fixture.week_number
"""

MATCH_SELECT_FROM = """
    FROM v_hub_match_overview m
    LEFT JOIN hub_tournament_fixtures fixture ON fixture.played_match_stats_id = m.match_stats_id
    LEFT JOIN hub_tournaments tournament ON tournament.tournament_id = fixture.tournament_id
"""


PLACEHOLDER_RE = re.compile(r"%s")
HUB_RELATIONS = (
    "v_hub_tournament_standings_enriched",
    "v_hub_team_profile_summary",
    "v_hub_match_overview",
    "v_hub_player_totals",
    "hub_player_rating_history",
    "hub_match_events",
    "hub_match_player_stats",
    "hub_tournament_standings",
    "hub_tournament_fixtures",
    "hub_tournament_teams",
    "hub_match_lineups",
    "hub_media_assets",
    "hub_profile_overrides",
    "hub_sync_state",
    "hub_tournaments",
    "hub_matches",
    "hub_teams",
    "hub_players",
)


def _to_postgres_sql(sql: str) -> str:
    counter = 0

    def replace(_: re.Match[str]) -> str:
        nonlocal counter
        counter += 1
        return f"${counter}"

    return PLACEHOLDER_RE.sub(replace, sql)


def _qualify_hub_sql(sql: str) -> str:
    qualified = sql
    for relation in HUB_RELATIONS:
        qualified = re.sub(
            rf"(?<![\w\.\"])({relation})(?![\w\"])",
            f'"{config.HUB_POSTGRES_SCHEMA}".{relation}',
            qualified,
        )
    return qualified


def _cache_key_from_sql(namespace: str, sql: str, params: tuple[Any, ...]) -> str:
    normalized_sql = " ".join(sql.split())
    payload = json.dumps(
        {
            "sql": normalized_sql,
            "params": public_row(list(params)),
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()
    return f"{config.REDIS_KEY_PREFIX}:{namespace}:{digest}"


async def fetch_all(
    request: Request,
    sql: str,
    params: tuple[Any, ...] = (),
    *,
    cache_ttl: int | None = None,
) -> list[dict[str, Any]]:
    ttl = config.API_CACHE_TTL_SECONDS if cache_ttl is None else cache_ttl
    redis_client = getattr(request.app.state, "redis", None)
    cache_key = _cache_key_from_sql("sql:many", sql, params) if redis_client and ttl > 0 else None
    if cache_key is not None:
        cached = await cache.get_json(redis_client, cache_key)
        if isinstance(cached, list):
            return cached

    try:
        rows = await asyncio.wait_for(
            request.app.state.hub_pool.fetch(_to_postgres_sql(_qualify_hub_sql(sql)), *params),
            timeout=config.HUB_DB_QUERY_TIMEOUT_SECONDS,
        )
        values = public_rows([dict(row) for row in rows])
        if cache_key is not None:
            await cache.set_json(redis_client, cache_key, values, ttl)
        return values
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Hub database query timed out") from exc


async def fetch_one(
    request: Request,
    sql: str,
    params: tuple[Any, ...],
    *,
    cache_ttl: int | None = None,
    cache_namespace: str = "sql:one",
) -> dict[str, Any] | None:
    ttl = config.API_CACHE_TTL_SECONDS if cache_ttl is None else cache_ttl
    redis_client = getattr(request.app.state, "redis", None)
    cache_key = _cache_key_from_sql(cache_namespace, sql, params) if redis_client and ttl > 0 else None
    if cache_key is not None:
        cached = await cache.get_json(redis_client, cache_key)
        if isinstance(cached, dict):
            return cached

    try:
        row = await asyncio.wait_for(
            request.app.state.hub_pool.fetchrow(_to_postgres_sql(_qualify_hub_sql(sql)), *params),
            timeout=config.HUB_DB_QUERY_TIMEOUT_SECONDS,
        )
        value = public_row(dict(row)) if row else None
        if cache_key is not None and value is not None:
            await cache.set_json(redis_client, cache_key, value, ttl)
        return value
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Hub database query timed out") from exc


async def fetch_cached_payload(
    request: Request,
    namespace: str,
    cache_token: str,
    loader,
    *,
    ttl: int,
):
    redis_client = getattr(request.app.state, "redis", None)
    cache_key = f"{config.REDIS_KEY_PREFIX}:{namespace}:{cache_token}"
    if ttl > 0:
        cached = await cache.get_json(redis_client, cache_key)
        if cached is not None:
            return cached

    value = await loader()
    if ttl > 0:
        await cache.set_json(redis_client, cache_key, value, ttl)
    return value


async def _get_latest_hub_sync_token(request: Request) -> str:
    row = await fetch_one(
        request,
        """
        SELECT
            COALESCE(MAX(last_synced_at), MAX(updated_at)) AS sync_token
        FROM hub_sync_state
        WHERE sync_key = 'full_sync'
        """,
        (),
        cache_ttl=0,
        cache_namespace="sync-token",
    )
    token = row.get("sync_token") if isinstance(row, dict) else None
    return str(token) if token is not None else "no-sync"


@app.get("/health")
async def health(request: Request):
    try:
        value = await asyncio.wait_for(
            request.app.state.hub_pool.fetchval("SELECT 1"),
            timeout=config.HUB_DB_QUERY_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Hub database query timed out") from exc
    return {"ok": bool(value == 1)}


@app.get("/api/players")
async def list_players(
    request: Request,
    q: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    player_select_from = build_player_select_from(
        getattr(request.app.state, "hub_match_player_stats_columns", set()),
    )
    where = ""
    params: list[Any] = []
    if q.strip():
        where = "WHERE p.display_name LIKE %s OR p.steam_id LIKE %s"
        like = f"%{q.strip()}%"
        params.extend([like, like])

    params.extend([limit, offset])
    return await fetch_all(
        request,
        f"""
        SELECT {PLAYER_SELECT_FIELDS}
        {player_select_from}
        {where}
        ORDER BY p.rating DESC, p.display_name ASC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )


@app.get("/api/players/{steam_id}")
async def get_player(request: Request, steam_id: str):
    player_select_from = build_player_select_from(
        getattr(request.app.state, "hub_match_player_stats_columns", set()),
    )
    player = await fetch_one(
        request,
        f"""
        SELECT {PLAYER_SELECT_FIELDS}
        {player_select_from}
        WHERE p.steam_id = %s
        """,
        (steam_id,),
    )
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    player["recent_matches"] = await fetch_all(
        request,
        f"""
        SELECT
            pmd.*,
            overview.match_datetime,
            overview.home_guild_id,
            overview.away_guild_id,
            overview.home_team_name,
            overview.away_team_name,
            overview.home_score,
            overview.away_score,
            overview.game_type,
            overview.extratime,
            overview.penalties,
            overview.comeback_flag,
            overview.tournament_id,
            overview.tournament_name,
            overview.league_key,
            overview.week_number
        FROM hub_match_player_stats pmd
        JOIN (
            SELECT {MATCH_SELECT_FIELDS}
            {MATCH_SELECT_FROM}
        ) overview ON overview.match_stats_id = pmd.match_stats_id
        WHERE pmd.steam_id = %s
        ORDER BY overview.match_datetime DESC
        LIMIT 500
        """,
        (steam_id,),
    )
    return player


async def _load_matchmaking_monthly_leaders(
    request: Request,
    *,
    window_days: int = 30,
    limit: int = 5,
) -> dict[str, list[dict[str, Any]]]:
    params = (window_days, limit)
    scorers = await fetch_all(
        request,
        """
        SELECT
            pmd.steam_id,
            COUNT(DISTINCT pmd.match_stats_id) AS appearances,
            COALESCE(SUM(pmd.goals), 0) AS value
        FROM hub_match_player_stats pmd
        JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
        LEFT JOIN hub_tournament_fixtures fixture ON fixture.played_match_stats_id = m.match_stats_id
        WHERE m.match_datetime >= NOW() - (%s::int * INTERVAL '1 day')
          AND fixture.played_match_stats_id IS NULL
        GROUP BY pmd.steam_id
        HAVING COALESCE(SUM(pmd.goals), 0) > 0
        ORDER BY value DESC, appearances DESC, pmd.steam_id ASC
        LIMIT %s
        """,
        params,
        cache_ttl=0,
    )
    assisters = await fetch_all(
        request,
        """
        SELECT
            pmd.steam_id,
            COUNT(DISTINCT pmd.match_stats_id) AS appearances,
            COALESCE(SUM(pmd.assists), 0) AS value
        FROM hub_match_player_stats pmd
        JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
        LEFT JOIN hub_tournament_fixtures fixture ON fixture.played_match_stats_id = m.match_stats_id
        WHERE m.match_datetime >= NOW() - (%s::int * INTERVAL '1 day')
          AND fixture.played_match_stats_id IS NULL
        GROUP BY pmd.steam_id
        HAVING COALESCE(SUM(pmd.assists), 0) > 0
        ORDER BY value DESC, appearances DESC, pmd.steam_id ASC
        LIMIT %s
        """,
        params,
        cache_ttl=0,
    )
    saves = await fetch_all(
        request,
        """
        SELECT
            pmd.steam_id,
            COUNT(DISTINCT pmd.match_stats_id) AS appearances,
            COALESCE(SUM(pmd.keeper_saves), 0) AS value
        FROM hub_match_player_stats pmd
        JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
        LEFT JOIN hub_tournament_fixtures fixture ON fixture.played_match_stats_id = m.match_stats_id
        WHERE m.match_datetime >= NOW() - (%s::int * INTERVAL '1 day')
          AND fixture.played_match_stats_id IS NULL
        GROUP BY pmd.steam_id
        HAVING COALESCE(SUM(pmd.keeper_saves), 0) > 0
        ORDER BY value DESC, appearances DESC, pmd.steam_id ASC
        LIMIT %s
        """,
        params,
        cache_ttl=0,
    )
    return {
        "scorers": scorers,
        "assisters": assisters,
        "saves": saves,
    }


@app.get("/api/matchmaking/leaders")
async def matchmaking_leaders(
    request: Request,
    window_days: int = Query(30, ge=7, le=90),
    limit: int = Query(5, ge=1, le=20),
):
    return await fetch_cached_payload(
        request,
        "matchmaking-leaders",
        f"{window_days}:{limit}",
        lambda: _load_matchmaking_monthly_leaders(request, window_days=window_days, limit=limit),
        ttl=config.SUMMARY_CACHE_TTL_SECONDS,
    )


@app.get("/api/teams")
async def list_teams(request: Request, limit: int = Query(100, ge=1, le=250), offset: int = Query(0, ge=0)):
    return await fetch_all(
        request,
        """
        SELECT *
        FROM v_hub_team_profile_summary
        ORDER BY average_rating DESC, name ASC
        LIMIT %s OFFSET %s
        """,
        (limit, offset),
    )


@app.get("/api/teams/{guild_id}")
async def get_team(request: Request, guild_id: str):
    player_select_from = build_player_select_from(
        getattr(request.app.state, "hub_match_player_stats_columns", set()),
    )
    team = await fetch_one(request, "SELECT * FROM v_hub_team_profile_summary WHERE guild_id = %s", (guild_id,))
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    team["recent_matches"] = await fetch_all(
        request,
        f"""
        SELECT {MATCH_SELECT_FIELDS}
        {MATCH_SELECT_FROM}
        WHERE m.home_guild_id = %s OR m.away_guild_id = %s
        ORDER BY m.match_datetime DESC
        LIMIT 20
        """,
        (guild_id, guild_id),
    )
    team["players"] = await fetch_all(
        request,
        f"""
        SELECT {PLAYER_SELECT_FIELDS}
        {player_select_from}
        WHERE current_team.team_guild_id = %s
        ORDER BY p.rating DESC, p.display_name ASC
        """,
        (guild_id,),
    )
    team["aggregate_player_stats"] = await fetch_one(
        request,
        """
        SELECT
            COUNT(DISTINCT pmd.match_stats_id) AS appearances,
            COALESCE(SUM(pmd.goals), 0) AS goals,
            COALESCE(SUM(pmd.assists), 0) AS assists,
            COALESCE(SUM(pmd.second_assists), 0) AS second_assists,
            COALESCE(SUM(pmd.shots), 0) AS shots,
            COALESCE(SUM(pmd.shots_on_goal), 0) AS shots_on_goal,
            COALESCE(SUM(pmd.passes_completed), 0) AS passes_completed,
            COALESCE(SUM(pmd.passes_attempted), 0) AS passes_attempted,
            CASE
                WHEN COALESCE(SUM(pmd.passes_attempted), 0) > 0
                    THEN ROUND((SUM(pmd.passes_completed)::numeric / SUM(pmd.passes_attempted)::numeric) * 100, 2)
                ELSE 0
            END AS pass_accuracy,
            COALESCE(SUM(pmd.key_passes), 0) AS key_passes,
            COALESCE(SUM(pmd.chances_created), 0) AS chances_created,
            COALESCE(SUM(pmd.fouls), 0) AS fouls,
            COALESCE(SUM(pmd.fouls_suffered), 0) AS fouls_suffered,
            COALESCE(SUM(pmd.yellow_cards), 0) AS yellow_cards,
            COALESCE(SUM(pmd.red_cards), 0) AS red_cards,
            COALESCE(SUM(pmd.offsides), 0) AS offsides,
            COALESCE(SUM(pmd.keeper_saves), 0) AS keeper_saves,
            COALESCE(SUM(pmd.keeper_saves_caught), 0) AS keeper_saves_caught,
            COALESCE(SUM(pmd.goals_conceded), 0) AS goals_conceded,
            COALESCE(SUM(pmd.own_goals), 0) AS own_goals,
            COALESCE(SUM(pmd.interceptions), 0) AS interceptions,
            COALESCE(SUM(pmd.tackles), 0) AS tackles,
            COALESCE(SUM(pmd.sliding_tackles_completed), 0) AS sliding_tackles_completed,
            COALESCE(SUM(pmd.distance_covered), 0) AS distance_covered,
            COALESCE(AVG(pmd.match_rating), 0) AS avg_match_rating
        FROM hub_match_player_stats pmd
        LEFT JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
        WHERE COALESCE(
            NULLIF(pmd.team_guild_id, ''),
            CASE
                WHEN pmd.team_side = 'home' THEN m.home_guild_id
                WHEN pmd.team_side = 'away' THEN m.away_guild_id
                ELSE NULL
            END
        ) = %s
        """,
        (guild_id,),
    )
    return team


@app.get("/api/matches")
async def list_matches(
    request: Request,
    team_id: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    where = ""
    params: list[Any] = []
    if team_id is not None:
        where = "WHERE m.home_guild_id = %s OR m.away_guild_id = %s"
        params.extend([team_id, team_id])
    params.extend([limit, offset])

    return await fetch_all(
        request,
        f"""
        SELECT {MATCH_SELECT_FIELDS}
        {MATCH_SELECT_FROM}
        {where}
        ORDER BY m.match_datetime DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )


@app.get("/api/matches/{match_stats_id}")
async def get_match(request: Request, match_stats_id: int):
    match = await fetch_one(
        request,
        f"""
        SELECT {MATCH_SELECT_FIELDS}
        {MATCH_SELECT_FROM}
        WHERE m.match_stats_id = %s
        """,
        (match_stats_id,),
    )
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    match["lineups"] = await fetch_all(
        request,
        "SELECT * FROM hub_match_lineups WHERE match_stats_id = %s ORDER BY side, slot_order, position_code",
        (match_stats_id,),
    )
    match["player_stats"] = await fetch_all(
        request,
        "SELECT * FROM hub_match_player_stats WHERE match_stats_id = %s ORDER BY team_side, position_code, player_name",
        (match_stats_id,),
    )
    match["events"] = await fetch_all(
        request,
        "SELECT * FROM hub_match_events WHERE match_stats_id = %s ORDER BY match_second, event_index",
        (match_stats_id,),
    )
    return match


@app.get("/api/tournaments")
async def list_tournaments(request: Request, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    return await fetch_all(
        request,
        """
        SELECT *
        FROM hub_tournaments
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        (limit, offset),
    )


@app.get("/api/tournaments/{tournament_id}")
async def get_tournament(request: Request, tournament_id: int):
    tournament = await fetch_one(request, "SELECT * FROM hub_tournaments WHERE tournament_id = %s", (tournament_id,))
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    tournament["teams"] = await fetch_all(
        request,
        "SELECT * FROM hub_tournament_teams WHERE tournament_id = %s ORDER BY league_key, seed, team_name",
        (tournament_id,),
    )
    tournament["standings"] = await fetch_all(
        request,
        "SELECT * FROM v_hub_tournament_standings_enriched WHERE tournament_id = %s ORDER BY points DESC, goal_diff DESC, goals_for DESC, team_name ASC",
        (tournament_id,),
    )
    tournament["fixtures"] = await fetch_all(
        request,
        """
        SELECT
            fixture.*,
            played.match_datetime AS played_match_datetime,
            played.home_score AS played_home_score,
            played.away_score AS played_away_score,
            played.game_type AS played_game_type,
            played.match_id AS played_match_id,
            played.home_team_name AS played_home_team_name,
            played.away_team_name AS played_away_team_name
        FROM hub_tournament_fixtures fixture
        LEFT JOIN (
            SELECT
                m.match_stats_id,
                m.match_id,
                m.match_datetime,
                m.home_team_name,
                m.away_team_name,
                m.home_score,
                m.away_score,
                m.game_type
            FROM v_hub_match_overview m
        ) played ON played.match_stats_id = fixture.played_match_stats_id
        WHERE fixture.tournament_id = %s
        ORDER BY fixture.league_key, fixture.week_number, fixture.fixture_id
        """,
        (tournament_id,),
    )
    return tournament


@app.get("/api/media")
async def list_media(
    request: Request,
    media_type: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    where = "WHERE is_public = TRUE"
    params: list[Any] = []
    if media_type.strip():
        where += " AND media_type = %s"
        params.append(media_type.strip())
    params.extend([limit, offset])

    return await fetch_all(
        request,
        f"""
        SELECT *
        FROM hub_media_assets
        {where}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params),
    )


@app.get("/api/summary")
async def hub_summary(request: Request):
    return await fetch_one(
        request,
        """
        SELECT
            (SELECT COUNT(*) FROM hub_players) AS total_players,
            (
                SELECT COUNT(DISTINCT pmd.steam_id)
                FROM hub_match_player_stats pmd
                JOIN hub_matches m ON m.match_stats_id = pmd.match_stats_id
                WHERE m.match_datetime >= NOW() - INTERVAL '7 days'
            ) AS active_players_last_7_days,
            (SELECT COUNT(*) FROM hub_teams) AS total_teams,
            (SELECT COUNT(*) FROM hub_matches) AS total_matches,
            (
                SELECT COUNT(*)
                FROM hub_matches
                WHERE match_datetime >= NOW() - INTERVAL '7 days'
            ) AS matches_last_7_days,
            (
                SELECT COUNT(*)
                FROM hub_media_assets
                WHERE is_public = TRUE
            ) AS total_media_assets,
            (
                SELECT MAX(last_synced_at)
                FROM hub_sync_state
                WHERE sync_key = 'full_sync'
            ) AS last_full_sync_at
        """,
        (),
        cache_ttl=config.SUMMARY_CACHE_TTL_SECONDS,
        cache_namespace="summary",
    )


@app.get("/api/bootstrap")
async def hub_bootstrap(request: Request):
    player_select_from = build_player_select_from(
        getattr(request.app.state, "hub_match_player_stats_columns", set()),
    )
    cache_token = await _get_latest_hub_sync_token(request)

    async def load_payload():
        teams_task = fetch_all(
            request,
            """
            SELECT *
            FROM v_hub_team_profile_summary
            ORDER BY average_rating DESC, name ASC
            """,
            (),
            cache_ttl=0,
        )
        players_task = fetch_all(
            request,
            f"""
            SELECT {PLAYER_SELECT_FIELDS}
            {player_select_from}
            ORDER BY p.rating DESC, p.display_name ASC
            """,
            (),
            cache_ttl=0,
        )
        matches_task = fetch_all(
            request,
            f"""
            SELECT {MATCH_SELECT_FIELDS}
            {MATCH_SELECT_FROM}
            ORDER BY m.match_datetime DESC
            LIMIT 5000
            """,
            (),
            cache_ttl=0,
        )
        tournaments_task = fetch_all(
            request,
            """
            SELECT *
            FROM hub_tournaments
            ORDER BY created_at DESC
            """,
            (),
            cache_ttl=0,
        )
        media_task = fetch_all(
            request,
            """
            SELECT *
            FROM hub_media_assets
            WHERE is_public = TRUE
            ORDER BY created_at DESC
            LIMIT 1000
            """,
            (),
            cache_ttl=0,
        )
        summary_task = hub_summary(request)
        matchmaking_leaders_task = _load_matchmaking_monthly_leaders(request)

        teams, players, matches, tournaments, media, summary, matchmaking_leaders = await asyncio.gather(
            teams_task,
            players_task,
            matches_task,
            tournaments_task,
            media_task,
            summary_task,
            matchmaking_leaders_task,
        )

        return {
            "teams": teams,
            "players": players,
            "matches": matches,
            "tournaments": tournaments,
            "media": media,
            "summary": summary,
            "matchmaking_leaders": matchmaking_leaders,
        }

    return await fetch_cached_payload(
        request,
        "bootstrap",
        cache_token,
        load_payload,
        ttl=config.BOOTSTRAP_CACHE_TTL_SECONDS,
    )


@app.get("/api/sync-state")
async def sync_state(request: Request):
    return await fetch_all(
        request,
        "SELECT * FROM hub_sync_state ORDER BY updated_at DESC",
    )
