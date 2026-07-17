from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import requests
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from . import config
from .db import public_row, public_rows


DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_ME_URL = "https://discord.com/api/users/@me"


def _now_utc() -> datetime:
    return datetime.utcnow()


def _as_utc_cookie_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def normalize_legacy_steam_id(value: str | None) -> str | None:
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
        id64_base = 76561197960265728
        try:
            steam64 = int(raw)
        except (TypeError, ValueError):
            return None
        if steam64 <= id64_base:
            return None
        offset = steam64 - id64_base
        y = offset % 2
        z = (offset - y) // 2
        return f"STEAM_0:{y}:{z}"

    return None


def _token_digest(token: str) -> str:
    return hmac.new(
        config.HUB_SESSION_SECRET.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _make_token() -> str:
    return secrets.token_urlsafe(32)


def _frontend_base() -> str:
    return config.HUB_FRONTEND_URL.rstrip("/")


def build_frontend_url(path: str = "/account", **query: str | None) -> str:
    base = _frontend_base()
    normalized_path = "/" + str(path or "/account").lstrip("/")
    query_text = urlencode({key: value for key, value in query.items() if value is not None})
    if "#" in base:
        prefix, fragment = base.split("#", 1)
        fragment = fragment.rstrip("/")
        url = f"{prefix}#{fragment}{normalized_path}"
    else:
        url = f"{base}{normalized_path}"
    return f"{url}?{query_text}" if query_text else url


def provider_callback_url(request: Request, path: str) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}{path}"


def append_query(url: str, **query: str | None) -> str:
    parsed = urlparse(url)
    existing = dict()
    if parsed.query:
        for part in parsed.query.split("&"):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            existing[key] = value
    for key, value in query.items():
        if value is None:
            continue
        existing[key] = value
    return urlunparse(parsed._replace(query=urlencode(existing)))


def set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
    response.set_cookie(
        key=config.HUB_SESSION_COOKIE_NAME,
        value=token,
        expires=_as_utc_cookie_datetime(expires_at),
        httponly=True,
        secure=config.HUB_SESSION_COOKIE_SECURE,
        samesite=config.HUB_SESSION_COOKIE_SAMESITE,
        domain=config.HUB_SESSION_COOKIE_DOMAIN or None,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=config.HUB_SESSION_COOKIE_NAME,
        domain=config.HUB_SESSION_COOKIE_DOMAIN or None,
        path="/",
        secure=config.HUB_SESSION_COOKIE_SECURE,
        samesite=config.HUB_SESSION_COOKIE_SAMESITE,
    )


async def fetch_session(pool, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    row = await pool.fetchrow(
        f"""
        SELECT s.session_id, s.user_id, s.expires_at
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_sessions s
        WHERE s.token_hash = $1
          AND s.expires_at > NOW()
        """,
        _token_digest(token),
    )
    if not row:
        return None
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_sessions
        SET last_seen_at = NOW()
        WHERE session_id = $1
        """,
        row["session_id"],
    )
    return dict(row)


async def fetch_user(pool, user_id: int) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        f"""
        SELECT *
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_users
        WHERE user_id = $1
        """,
        int(user_id),
    )
    return dict(row) if row else None


async def list_identities(pool, user_id: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        f"""
        SELECT identity_id, provider, provider_subject, display_name, avatar_url, is_primary, linked_at, last_login_at
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        WHERE user_id = $1
        ORDER BY provider ASC, is_primary DESC, linked_at ASC
        """,
        int(user_id),
    )
    return public_rows([dict(row) for row in rows])


async def build_session_payload(pool, user_id: int) -> dict[str, Any]:
    user = await fetch_user(pool, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Auth user not found")
    identities = await list_identities(pool, user_id)
    primary_steam_id = user.get("primary_steam_id")
    return {
        "authenticated": True,
        "user": public_row({
            "user_id": user["user_id"],
            "display_name": user.get("display_name"),
            "primary_discord_id": user.get("primary_discord_id"),
            "primary_steam_id": primary_steam_id,
            "primary_steam_legacy_id": normalize_legacy_steam_id(primary_steam_id),
            "created_at": user.get("created_at"),
            "updated_at": user.get("updated_at"),
            "last_login_at": user.get("last_login_at"),
            "identities": identities,
        }),
    }


async def create_session(pool, user_id: int, request: Request) -> tuple[str, datetime]:
    token = _make_token()
    expires_at = _now_utc() + timedelta(seconds=config.HUB_SESSION_TTL_SECONDS)
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    await pool.execute(
        f"""
        INSERT INTO "{config.HUB_POSTGRES_SCHEMA}".hub_auth_sessions (
            user_id,
            token_hash,
            ip_address,
            user_agent,
            expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        """,
        int(user_id),
        _token_digest(token),
        client_ip,
        user_agent,
        expires_at,
    )
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_users
        SET last_login_at = NOW(),
            updated_at = NOW()
        WHERE user_id = $1
        """,
        int(user_id),
    )
    return token, expires_at


async def revoke_session(pool, token: str | None) -> None:
    if not token:
        return
    await pool.execute(
        f'DELETE FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_sessions WHERE token_hash = $1',
        _token_digest(token),
    )


async def current_user_from_request(request: Request) -> dict[str, Any] | None:
    token = request.cookies.get(config.HUB_SESSION_COOKIE_NAME)
    session = await fetch_session(request.app.state.hub_pool, token)
    if not session:
        return None
    return await fetch_user(request.app.state.hub_pool, int(session["user_id"]))


async def require_authenticated_user(request: Request) -> dict[str, Any]:
    user = await current_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


async def create_user(pool, *, display_name: str | None = None) -> int:
    row = await pool.fetchrow(
        f"""
        INSERT INTO "{config.HUB_POSTGRES_SCHEMA}".hub_auth_users (display_name)
        VALUES ($1)
        RETURNING user_id
        """,
        display_name,
    )
    return int(row["user_id"])


async def find_identity(pool, provider: str, provider_subject: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        f"""
        SELECT *
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        WHERE provider = $1
          AND provider_subject = $2
        """,
        provider,
        provider_subject,
    )
    return dict(row) if row else None


async def find_user_identity(pool, user_id: int, provider: str, provider_subject: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        f"""
        SELECT *
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        WHERE user_id = $1
          AND provider = $2
          AND provider_subject = $3
        """,
        int(user_id),
        provider,
        provider_subject,
    )
    return dict(row) if row else None


async def _set_user_primary_fields(pool, user_id: int) -> None:
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_users
        SET primary_discord_id = (
                SELECT provider_subject
                FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
                WHERE user_id = $1
                  AND provider = 'discord'
                ORDER BY is_primary DESC, linked_at ASC
                LIMIT 1
            ),
            primary_steam_id = (
                SELECT provider_subject
                FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
                WHERE user_id = $1
                  AND provider = 'steam'
                ORDER BY is_primary DESC, linked_at ASC
                LIMIT 1
            ),
            updated_at = NOW()
        WHERE user_id = $1
        """,
        int(user_id),
    )


async def upsert_identity(
    pool,
    *,
    user_id: int,
    provider: str,
    provider_subject: str,
    display_name: str | None,
    avatar_url: str | None,
    profile_json: dict[str, Any],
    make_primary: bool = False,
) -> dict[str, Any]:
    if make_primary:
        await pool.execute(
            f"""
            UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
            SET is_primary = FALSE
            WHERE user_id = $1
              AND provider = $2
            """,
            int(user_id),
            provider,
        )
    row = await pool.fetchrow(
        f"""
        INSERT INTO "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities (
            user_id,
            provider,
            provider_subject,
            display_name,
            avatar_url,
            profile_json,
            is_primary,
            linked_at,
            last_login_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())
        ON CONFLICT (provider, provider_subject) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            display_name = EXCLUDED.display_name,
            avatar_url = EXCLUDED.avatar_url,
            profile_json = EXCLUDED.profile_json,
            is_primary = CASE WHEN EXCLUDED.is_primary THEN TRUE ELSE hub_auth_identities.is_primary END,
            last_login_at = NOW()
        RETURNING *
        """,
        int(user_id),
        provider,
        provider_subject,
        display_name,
        avatar_url,
        json.dumps(profile_json or {}),
        bool(make_primary),
    )
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_users
        SET display_name = COALESCE($2, display_name),
            updated_at = NOW()
        WHERE user_id = $1
        """,
        int(user_id),
        display_name,
    )
    await _set_user_primary_fields(pool, user_id)
    return dict(row)


async def login_or_link_identity(
    request: Request,
    *,
    provider: str,
    provider_subject: str,
    display_name: str | None,
    avatar_url: str | None,
    profile_json: dict[str, Any],
    intent: str = "login",
) -> tuple[int, str]:
    pool = request.app.state.hub_pool
    session_user = await current_user_from_request(request)
    identity = await find_identity(pool, provider, provider_subject)

    if intent == "link" and session_user:
        if identity and int(identity["user_id"]) != int(session_user["user_id"]):
            raise HTTPException(status_code=409, detail=f"This {provider} account is already linked elsewhere.")
        await upsert_identity(
            pool,
            user_id=int(session_user["user_id"]),
            provider=provider,
            provider_subject=provider_subject,
            display_name=display_name,
            avatar_url=avatar_url,
            profile_json=profile_json,
            make_primary=(provider == "discord" and not session_user.get("primary_discord_id")) or (provider == "steam" and not session_user.get("primary_steam_id")),
        )
        return int(session_user["user_id"]), "linked"

    if identity:
        await upsert_identity(
            pool,
            user_id=int(identity["user_id"]),
            provider=provider,
            provider_subject=provider_subject,
            display_name=display_name,
            avatar_url=avatar_url,
            profile_json=profile_json,
        )
        return int(identity["user_id"]), "logged_in"

    user_id = await create_user(pool, display_name=display_name)
    await upsert_identity(
        pool,
        user_id=user_id,
        provider=provider,
        provider_subject=provider_subject,
        display_name=display_name,
        avatar_url=avatar_url,
        profile_json=profile_json,
        make_primary=True,
    )
    return user_id, "created"


async def set_identity_primary(pool, *, user_id: int, provider: str, provider_subject: str) -> None:
    identity = await find_user_identity(pool, user_id, provider, provider_subject)
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found.")
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        SET is_primary = FALSE
        WHERE user_id = $1
          AND provider = $2
        """,
        int(user_id),
        provider,
    )
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        SET is_primary = TRUE,
            last_login_at = NOW()
        WHERE user_id = $1
          AND provider = $2
          AND provider_subject = $3
        """,
        int(user_id),
        provider,
        provider_subject,
    )
    await _set_user_primary_fields(pool, user_id)


async def unlink_identity(pool, *, user_id: int, provider: str, provider_subject: str) -> None:
    identity = await find_user_identity(pool, user_id, provider, provider_subject)
    if not identity:
        raise HTTPException(status_code=404, detail="Identity not found.")

    identity_count = await pool.fetchval(
        f"""
        SELECT COUNT(*)
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        WHERE user_id = $1
        """,
        int(user_id),
    )
    if int(identity_count or 0) <= 1:
        raise HTTPException(status_code=400, detail="You cannot remove your last linked identity.")

    await pool.execute(
        f"""
        DELETE FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        WHERE user_id = $1
          AND provider = $2
          AND provider_subject = $3
        """,
        int(user_id),
        provider,
        provider_subject,
    )
    await pool.execute(
        f"""
        WITH candidate AS (
            SELECT identity_id
            FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
            WHERE user_id = $1
              AND provider = $2
            ORDER BY linked_at ASC, identity_id ASC
            LIMIT 1
        )
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_identities
        SET is_primary = CASE WHEN identity_id = (SELECT identity_id FROM candidate) THEN TRUE ELSE FALSE END
        WHERE user_id = $1
          AND provider = $2
        """,
        int(user_id),
        provider,
    )
    await _set_user_primary_fields(pool, user_id)


def _http_post_json(url: str, *, data: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.post(url, data=data, headers=headers or {}, timeout=20)
    response.raise_for_status()
    return response.json()


def _http_get_json(url: str, *, headers: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.get(url, headers=headers or {}, timeout=20)
    response.raise_for_status()
    return response.json()


async def exchange_discord_code(code: str, redirect_uri: str) -> dict[str, Any]:
    if not config.HUB_DISCORD_CLIENT_ID or not config.HUB_DISCORD_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Discord OAuth is not configured.")
    payload = await asyncio.to_thread(
        _http_post_json,
        DISCORD_TOKEN_URL,
        data={
            "client_id": config.HUB_DISCORD_CLIENT_ID,
            "client_secret": config.HUB_DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise HTTPException(status_code=400, detail="Discord token exchange failed.")
    profile = await asyncio.to_thread(
        _http_get_json,
        DISCORD_ME_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    subject = str(profile.get("id") or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Discord profile response was invalid.")
    avatar_hash = profile.get("avatar")
    avatar_url = f"https://cdn.discordapp.com/avatars/{subject}/{avatar_hash}.png" if avatar_hash else None
    display_name = profile.get("global_name") or profile.get("username") or f"Discord {subject}"
    return {
        "provider": "discord",
        "provider_subject": subject,
        "display_name": str(display_name),
        "avatar_url": avatar_url,
        "profile_json": profile,
    }


def build_discord_authorize_url(request: Request, *, intent: str) -> str:
    if not config.HUB_DISCORD_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Discord OAuth is not configured.")
    redirect_uri = provider_callback_url(request, "/api/auth/discord/callback")
    return DISCORD_AUTHORIZE_URL + "?" + urlencode(
        {
            "client_id": config.HUB_DISCORD_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": config.HUB_DISCORD_SCOPE,
            "state": intent,
            "prompt": "consent",
        }
    )


def build_steam_authorize_url(request: Request, *, intent: str) -> str:
    callback_url = provider_callback_url(request, "/api/auth/steam/callback")
    base_url = str(request.base_url).rstrip("/")
    return config.HUB_STEAM_OPENID_URL + "?" + urlencode(
        {
            "openid.ns": "http://specs.openid.net/auth/2.0",
            "openid.mode": "checkid_setup",
            "openid.return_to": append_query(callback_url, state=intent),
            "openid.realm": base_url,
            "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
            "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
        }
    )


def _verify_steam_openid(url: str, data: dict[str, Any]) -> str:
    verify_payload = {key: value for key, value in data.items() if key.startswith("openid.")}
    verify_payload["openid.mode"] = "check_authentication"
    response = requests.post(url, data=verify_payload, timeout=20)
    response.raise_for_status()
    if "is_valid:true" not in response.text:
        raise HTTPException(status_code=400, detail="Steam OpenID verification failed.")
    claimed_id = str(data.get("openid.claimed_id") or "").strip()
    steam_id = claimed_id.rsplit("/", 1)[-1]
    if not steam_id.isdigit():
        raise HTTPException(status_code=400, detail="Steam identity was invalid.")
    return steam_id


async def resolve_steam_identity(request: Request, params: dict[str, Any]) -> dict[str, Any]:
    steam_id = await asyncio.to_thread(_verify_steam_openid, config.HUB_STEAM_OPENID_URL, params)
    return {
        "provider": "steam",
        "provider_subject": steam_id,
        "display_name": f"Steam {steam_id}",
        "avatar_url": None,
        "profile_json": {"steam_id": steam_id},
    }


async def create_link_challenge(
    pool,
    *,
    user_id: int,
    provider: str,
    provider_subject: str,
    display_name: str | None,
    avatar_url: str | None,
    profile_json: dict[str, Any],
    target_discord_id: str,
    action: str = "approve_identity_link",
) -> str:
    token = _make_token()
    expires_at = _now_utc() + timedelta(seconds=config.HUB_AUTH_CHALLENGE_TTL_SECONDS)
    await pool.execute(
        f"""
        INSERT INTO "{config.HUB_POSTGRES_SCHEMA}".hub_auth_link_challenges (
            user_id,
            action,
            provider,
            provider_subject,
            display_name,
            avatar_url,
            profile_json,
            target_discord_id,
            challenge_token_hash,
            challenge_token_plain,
            expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
        """,
        int(user_id),
        action,
        provider,
        provider_subject,
        display_name,
        avatar_url,
        json.dumps(profile_json or {}),
        target_discord_id,
        _token_digest(token),
        token,
        expires_at,
    )
    return token


async def consume_link_challenge(pool, token: str) -> dict[str, Any]:
    row = await pool.fetchrow(
        f"""
        SELECT *
        FROM "{config.HUB_POSTGRES_SCHEMA}".hub_auth_link_challenges
        WHERE challenge_token_hash = $1
          AND status = 'pending'
          AND expires_at > NOW()
        """,
        _token_digest(token),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Challenge not found or expired.")
    challenge = dict(row)
    identity = await find_identity(pool, challenge["provider"], challenge["provider_subject"])
    if identity and int(identity["user_id"]) != int(challenge["user_id"]):
        raise HTTPException(status_code=409, detail="This identity is already linked to another account.")
    await upsert_identity(
        pool,
        user_id=int(challenge["user_id"]),
        provider=str(challenge["provider"]),
        provider_subject=str(challenge["provider_subject"]),
        display_name=challenge.get("display_name"),
        avatar_url=challenge.get("avatar_url"),
        profile_json=challenge.get("profile_json") or {},
        make_primary=False,
    )
    await pool.execute(
        f"""
        UPDATE "{config.HUB_POSTGRES_SCHEMA}".hub_auth_link_challenges
        SET status = 'approved',
            approved_at = NOW(),
            challenge_token_plain = NULL
        WHERE challenge_id = $1
        """,
        challenge["challenge_id"],
    )
    await _set_user_primary_fields(pool, int(challenge["user_id"]))
    return challenge
