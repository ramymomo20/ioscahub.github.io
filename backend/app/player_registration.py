from __future__ import annotations

import json
from datetime import datetime
import hashlib
from typing import Any

from fastapi import HTTPException

from . import config

ID64_BASE = 76561197960265728


def _token_hash(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def normalize_steam_id(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    raw = raw.replace("STEAM0:", "STEAM_0:")
    if raw.upper().startswith("STEAM_"):
        parts = raw.split(":")
        if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
            return f"STEAM_0:{int(parts[1]) % 2}:{int(parts[2])}"
        return None

    if raw.startswith("[") and raw.endswith("]") and raw.upper().startswith("[U:"):
        try:
            account_id = int(raw.split(":")[-1].rstrip("]"))
        except (TypeError, ValueError):
            return None
        y = account_id % 2
        z = (account_id - y) // 2
        return f"STEAM_0:{y}:{z}"

    if raw.isdigit() and len(raw) >= 16:
        try:
            steam64 = int(raw)
        except (TypeError, ValueError):
            return None
        if steam64 <= ID64_BASE:
            return None
        offset = steam64 - ID64_BASE
        y = offset % 2
        z = (offset - y) // 2
        return f"STEAM_0:{y}:{z}"

    return None


async def ensure_account_linking_schema(pool) -> None:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.player_accounts (
                    account_id BIGSERIAL PRIMARY KEY,
                    hub_user_id BIGINT NULL UNIQUE,
                    display_name VARCHAR(255) NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.player_account_discord_ids (
                    account_discord_id BIGSERIAL PRIMARY KEY,
                    account_id BIGINT NOT NULL REFERENCES public.player_accounts(account_id) ON DELETE CASCADE,
                    discord_id VARCHAR(64) NOT NULL UNIQUE,
                    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                    verified_at TIMESTAMP NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_player_account_discord_ids_account
                ON public.player_account_discord_ids(account_id, is_primary DESC)
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.player_account_steam_ids (
                    account_steam_id BIGSERIAL PRIMARY KEY,
                    account_id BIGINT NOT NULL REFERENCES public.player_accounts(account_id) ON DELETE CASCADE,
                    steam_id VARCHAR(255) NOT NULL UNIQUE,
                    steam_id_64 VARCHAR(32) NULL,
                    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
                    verified_at TIMESTAMP NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_player_account_steam_ids_account
                ON public.player_account_steam_ids(account_id, is_primary DESC)
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS public.player_registration_intents (
                    intent_id BIGSERIAL PRIMARY KEY,
                    discord_id VARCHAR(64) NOT NULL,
                    discord_name VARCHAR(255) NULL,
                    guild_id VARCHAR(64) NULL,
                    token_hash CHAR(64) NOT NULL UNIQUE,
                    expires_at TIMESTAMP NOT NULL,
                    used_at TIMESTAMP NULL,
                    consumed_by_hub_user_id BIGINT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
            await conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_player_registration_intents_lookup
                ON public.player_registration_intents(discord_id, expires_at DESC)
                """
            )
            await conn.execute(
                """
                ALTER TABLE public.iosca_players
                ADD COLUMN IF NOT EXISTS linked_steam_ids JSONB NOT NULL DEFAULT '[]'::jsonb
                """
            )


async def _fetch_intent(conn, token: str) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT
            *,
            (used_at IS NOT NULL) AS completed,
            (expires_at > NOW()) AS is_valid
        FROM public.player_registration_intents
        WHERE token_hash = $1
        """,
        _token_hash(token),
    )
    return dict(row) if row else None


async def _fetch_hub_identities(conn, hub_user_id: int) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        f"""
        SELECT provider, provider_subject, display_name, is_primary
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        WHERE user_id = $1
        ORDER BY provider ASC, is_primary DESC, linked_at ASC
        """,
        int(hub_user_id),
    )
    return [dict(row) for row in rows]


async def _fetch_hub_display_name(conn, hub_user_id: int) -> str | None:
    return await conn.fetchval(
        f"""
        SELECT display_name
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_users
        WHERE user_id = $1
        """,
        int(hub_user_id),
    )


async def get_registration_status(pool, token: str, hub_user_id: int | None = None) -> dict[str, Any]:
    await ensure_account_linking_schema(pool)

    async with pool.acquire() as conn:
        intent = await _fetch_intent(conn, token)
        if not intent:
            raise HTTPException(status_code=404, detail="Registration intent not found.")

        identities = await _fetch_hub_identities(conn, hub_user_id) if hub_user_id else []
        discord_identities = [identity for identity in identities if identity.get("provider") == "discord"]
        steam_identities = [identity for identity in identities if identity.get("provider") == "steam"]
        matching_discord = any(str(identity.get("provider_subject") or "") == str(intent.get("discord_id") or "") for identity in discord_identities)

        return {
            "valid": bool(intent.get("is_valid")),
            "completed": bool(intent.get("completed")),
            "discord_id": str(intent.get("discord_id") or ""),
            "discord_name": intent.get("discord_name"),
            "authenticated": hub_user_id is not None,
            "has_matching_discord": matching_discord,
            "has_steam_identity": bool(steam_identities),
            "ready_to_complete": bool(intent.get("is_valid")) and not bool(intent.get("completed")) and matching_discord and bool(steam_identities),
        }


async def _discord_column_expects_text(conn) -> bool:
    row = await conn.fetchrow(
        """
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'iosca_players'
          AND column_name = 'discord_id'
        """
    )
    return bool(row and str(row["data_type"]) in {"character varying", "text"})


async def _name_column(conn) -> str | None:
    rows = await conn.fetch(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'iosca_players'
          AND column_name IN ('discord_name', 'username')
        """
    )
    columns = {str(row["column_name"]) for row in rows}
    if "discord_name" in columns:
        return "discord_name"
    if "username" in columns:
        return "username"
    return None


async def _resolve_account_id(
    conn,
    *,
    hub_user_id: int,
    discord_ids: list[str],
    steam64_ids: list[str],
    legacy_steam_ids: list[str],
    display_name: str | None,
) -> int:
    account_id = await conn.fetchval(
        "SELECT account_id FROM public.player_accounts WHERE hub_user_id = $1",
        int(hub_user_id),
    )
    if not account_id and discord_ids:
        account_id = await conn.fetchval(
            """
            SELECT account_id
            FROM public.player_account_discord_ids
            WHERE discord_id = ANY($1::text[])
            LIMIT 1
            """,
            discord_ids,
        )
    if not account_id and (steam64_ids or legacy_steam_ids):
        account_id = await conn.fetchval(
            """
            SELECT account_id
            FROM public.player_account_steam_ids
            WHERE steam_id_64 = ANY($1::text[])
               OR steam_id = ANY($2::text[])
            LIMIT 1
            """,
            steam64_ids or [""],
            legacy_steam_ids or [""],
        )

    if account_id:
        await conn.execute(
            """
            UPDATE public.player_accounts
            SET hub_user_id = $2,
                display_name = COALESCE($3, display_name),
                updated_at = NOW()
            WHERE account_id = $1
            """,
            int(account_id),
            int(hub_user_id),
            display_name,
        )
        return int(account_id)

    row = await conn.fetchrow(
        """
        INSERT INTO public.player_accounts (hub_user_id, display_name)
        VALUES ($1, $2)
        RETURNING account_id
        """,
        int(hub_user_id),
        display_name,
    )
    return int(row["account_id"])


async def _reconcile_iosca_player(
    conn,
    *,
    discord_id: str,
    display_name: str | None,
    primary_legacy_steam_id: str,
    legacy_steam_ids: list[str],
) -> dict[str, Any]:
    name_column = await _name_column(conn)
    discord_value: Any = discord_id if await _discord_column_expects_text(conn) else int(discord_id)
    row_by_discord = await conn.fetchrow(
        "SELECT ctid::text AS row_token, * FROM public.iosca_players WHERE discord_id::text = $1 LIMIT 1",
        discord_id,
    )
    row_by_steam = await conn.fetchrow(
        """
        SELECT ctid::text AS row_token, *
        FROM public.iosca_players
        WHERE steam_id = ANY($1::text[])
           OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(COALESCE(linked_steam_ids, '[]'::jsonb)) AS linked(value)
                WHERE linked.value = ANY($1::text[])
           )
        LIMIT 1
        """,
        legacy_steam_ids,
    )
    target_row = row_by_discord or row_by_steam
    if row_by_discord and row_by_steam and row_by_discord.get("row_token") != row_by_steam.get("row_token"):
        target_row = row_by_discord

    linked_ids = []
    if target_row and isinstance(target_row.get("linked_steam_ids"), list):
        linked_ids = [str(value).strip() for value in target_row.get("linked_steam_ids") if str(value or "").strip()]

    current_primary = str((target_row or {}).get("steam_id") or "").strip()
    steam_id_to_write = current_primary or primary_legacy_steam_id
    alias_set = {steam_id for steam_id in legacy_steam_ids if steam_id}
    if current_primary and current_primary != steam_id_to_write:
        alias_set.add(current_primary)
    alias_set.update(linked_ids)
    alias_set.discard(steam_id_to_write)
    aliases = sorted(alias_set)

    if target_row:
        if name_column:
            await conn.execute(
                f"""
                UPDATE public.iosca_players
                SET discord_id = $1,
                    {name_column} = COALESCE($2, {name_column}),
                    steam_id = $3,
                    linked_steam_ids = $4::jsonb,
                    updated_at = CURRENT_TIMESTAMP
                WHERE ctid::text = $5
                """,
                discord_value,
                display_name,
                steam_id_to_write,
                json.dumps(aliases),
                str(target_row["row_token"]),
            )
        else:
            await conn.execute(
                """
                UPDATE public.iosca_players
                SET discord_id = $1,
                    steam_id = $2,
                    linked_steam_ids = $3::jsonb,
                    updated_at = CURRENT_TIMESTAMP
                WHERE ctid::text = $4
                """,
                discord_value,
                steam_id_to_write,
                json.dumps(aliases),
                str(target_row["row_token"]),
            )
    else:
        if name_column:
            await conn.execute(
                f"""
                INSERT INTO public.iosca_players (discord_id, {name_column}, steam_id, linked_steam_ids)
                VALUES ($1, $2, $3, $4::jsonb)
                """,
                discord_value,
                display_name,
                steam_id_to_write,
                json.dumps(aliases),
            )
        else:
            await conn.execute(
                """
                INSERT INTO public.iosca_players (discord_id, steam_id, linked_steam_ids)
                VALUES ($1, $2, $3::jsonb)
                """,
                discord_value,
                steam_id_to_write,
                json.dumps(aliases),
            )

    return {
        "discord_id": discord_id,
        "steam_id": steam_id_to_write,
        "linked_steam_ids": aliases,
    }


async def complete_registration(pool, hub_user_id: int, token: str) -> dict[str, Any]:
    await ensure_account_linking_schema(pool)

    async with pool.acquire() as conn:
        async with conn.transaction():
            intent = await _fetch_intent(conn, token)
            if not intent:
                raise HTTPException(status_code=404, detail="Registration intent not found.")
            if intent.get("completed"):
                return {
                    "completed": True,
                    "discord_id": str(intent.get("discord_id") or ""),
                    "already_completed": True,
                }
            if not intent.get("is_valid"):
                raise HTTPException(status_code=400, detail="Registration intent has expired.")

            identities = await _fetch_hub_identities(conn, hub_user_id)
            discord_identities = [identity for identity in identities if identity.get("provider") == "discord"]
            steam_identities = [identity for identity in identities if identity.get("provider") == "steam"]
            expected_discord_id = str(intent.get("discord_id") or "")
            if not any(str(identity.get("provider_subject") or "") == expected_discord_id for identity in discord_identities):
                raise HTTPException(status_code=400, detail="This hub account is not linked to the Discord account that started registration.")
            if not steam_identities:
                raise HTTPException(status_code=400, detail="Link at least one Steam account before completing registration.")

            display_name = await _fetch_hub_display_name(conn, hub_user_id) or intent.get("discord_name")
            steam_profiles: list[dict[str, str | bool | None]] = []
            seen_steam_ids: set[tuple[str, str]] = set()
            for identity in steam_identities:
                steam64 = str(identity.get("provider_subject") or "").strip()
                legacy = normalize_steam_id(steam64)
                if not legacy:
                    continue
                dedupe_key = (legacy, steam64)
                if dedupe_key in seen_steam_ids:
                    continue
                seen_steam_ids.add(dedupe_key)
                steam_profiles.append(
                    {
                        "steam_id": legacy,
                        "steam_id_64": steam64,
                        "is_primary": bool(identity.get("is_primary")),
                    }
                )
            if not steam_profiles:
                raise HTTPException(status_code=400, detail="Could not normalize the linked Steam account.")

            primary_steam = next((entry for entry in steam_profiles if entry.get("is_primary")), steam_profiles[0])
            discord_ids = [str(identity.get("provider_subject") or "").strip() for identity in discord_identities if str(identity.get("provider_subject") or "").strip()]
            legacy_steam_ids = [str(entry["steam_id"]) for entry in steam_profiles if entry.get("steam_id")]
            steam64_ids = [str(entry["steam_id_64"]) for entry in steam_profiles if entry.get("steam_id_64")]

            account_id = await _resolve_account_id(
                conn,
                hub_user_id=hub_user_id,
                discord_ids=discord_ids,
                steam64_ids=steam64_ids,
                legacy_steam_ids=legacy_steam_ids,
                display_name=display_name,
            )

            await conn.execute(
                "UPDATE public.player_account_discord_ids SET is_primary = FALSE WHERE account_id = $1",
                int(account_id),
            )
            for identity in discord_identities:
                discord_subject = str(identity.get("provider_subject") or "").strip()
                if not discord_subject:
                    continue
                await conn.execute(
                    """
                    INSERT INTO public.player_account_discord_ids (
                        account_id,
                        discord_id,
                        is_primary,
                        verified_at,
                        updated_at
                    )
                    VALUES ($1, $2, $3, NOW(), NOW())
                    ON CONFLICT (discord_id) DO UPDATE
                    SET account_id = EXCLUDED.account_id,
                        is_primary = EXCLUDED.is_primary,
                        verified_at = COALESCE(public.player_account_discord_ids.verified_at, NOW()),
                        updated_at = NOW()
                    """,
                    int(account_id),
                    discord_subject,
                    bool(identity.get("is_primary")) or discord_subject == expected_discord_id,
                )

            await conn.execute(
                "UPDATE public.player_account_steam_ids SET is_primary = FALSE WHERE account_id = $1",
                int(account_id),
            )
            for entry in steam_profiles:
                await conn.execute(
                    """
                    INSERT INTO public.player_account_steam_ids (
                        account_id,
                        steam_id,
                        steam_id_64,
                        is_primary,
                        verified_at,
                        updated_at
                    )
                    VALUES ($1, $2, $3, $4, NOW(), NOW())
                    ON CONFLICT (steam_id) DO UPDATE
                    SET account_id = EXCLUDED.account_id,
                        steam_id_64 = EXCLUDED.steam_id_64,
                        is_primary = EXCLUDED.is_primary,
                        verified_at = COALESCE(public.player_account_steam_ids.verified_at, NOW()),
                        updated_at = NOW()
                    """,
                    int(account_id),
                    str(entry["steam_id"]),
                    str(entry["steam_id_64"]),
                    bool(entry.get("is_primary")) or str(entry["steam_id"]) == str(primary_steam["steam_id"]),
                )

            player_record = await _reconcile_iosca_player(
                conn,
                discord_id=expected_discord_id,
                display_name=display_name,
                primary_legacy_steam_id=str(primary_steam["steam_id"]),
                legacy_steam_ids=legacy_steam_ids,
            )

            await conn.execute(
                """
                UPDATE public.player_registration_intents
                SET used_at = NOW(),
                    consumed_by_hub_user_id = $2
                WHERE intent_id = $1
                """,
                int(intent["intent_id"]),
                int(hub_user_id),
            )

            return {
                "completed": True,
                "account_id": int(account_id),
                "discord_id": expected_discord_id,
                "steam_id": player_record["steam_id"],
                "linked_steam_ids": player_record["linked_steam_ids"],
                "hub_user_id": int(hub_user_id),
            }
