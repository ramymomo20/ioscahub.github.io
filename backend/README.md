Python API and sync layer for the IOSCA Hub.

Postgres/Supabase stays the bot source database. The public hub read model now lives in a dedicated Postgres schema, so the API only reads from mirrored `hub` tables instead of operational bot tables.

## Setup

Install dependencies:

```bash
pip install -r requirements.txt
```

Apply the hub Postgres schema:

```bash
python scripts/apply_hub_schema.py
```

Run a full sync from source tables into the hub schema:

```bash
python scripts/sync_from_postgres.py
```

Run the API locally:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Environment

The backend reads the repo root `.env` by default. Required variables:

```env
SUPABASE_DB_URL=postgresql://...
HUB_POSTGRES_SCHEMA=iosca_hub_production
HUB_FRONTEND_URL=https://ramymomo20.github.io/ioscahub.github.io/#
HUB_CORS_ORIGINS=https://ramymomo20.github.io,http://localhost:5173
HUB_SESSION_SECRET=replace-this
HUB_DISCORD_CLIENT_ID=...
HUB_DISCORD_CLIENT_SECRET=...
```

Optional auth/live settings:

```env
HUB_SESSION_COOKIE_NAME=iosca_hub_session
HUB_SESSION_COOKIE_SECURE=true
HUB_SESSION_TTL_SECONDS=2592000
HUB_AUTH_CHALLENGE_TTL_SECONDS=900
HUB_LIVE_SYNC_POLL_SECONDS=15
IOSCA_HUB_API_PUBLIC_BASE_URL=https://your-api-host
HUB_AUTH_DM_POLL_SECONDS=60
```

## Data Boundary

Keep these in the source schema only:

- Discord channel config and lineup state
- active match contexts
- server/RCON config
- import skip bookkeeping
- moderation/admin-only workflows

Mirror these into the hub schema:

- public players and ratings
- public teams
- matches
- match lineups
- player match stats
- match events with coordinates
- rating history
- tournaments, fixtures, standings

Convention:

- Discord-facing IDs (`guild_id`, `discord_id`, captain/user/channel/role style IDs when mirrored) are stored as strings in the hub model.
- Internal record keys (`match_stats_id`, `tournament_id`, `fixture_id`) stay numeric.

Hub-only features like media metadata, profile overrides, public badges, and editorial content can live in the hub schema because the bot does not need them.

## Read Model Strategy

Public hub pages should only call this API and only read `HUB_POSTGRES_SCHEMA`. The sync script is the only part that reads the source tables for hub data.

Recommended production flow:

```bash
python scripts/apply_hub_schema.py
python scripts/sync_from_postgres.py
```

Run the sync every 2-5 minutes from cron, a panel scheduler, or a small worker process. Do not query operational source tables from frontend pages or public API request handlers.

## Frontend API Base URL

The hub frontend now reads from this API instead of local mock data.

- If the frontend and API are served on the same host behind the same origin, no extra frontend API setting is required.
- If the frontend is served separately, set:

```env
VITE_HUB_API_BASE_URL=https://your-api-host
```

The frontend will call endpoints like `/api/players`, `/api/teams`, `/api/matches`, `/api/tournaments`, and `/api/media` against that base URL.

## Auth and Realtime

The hub now supports:

- Discord OAuth login
- Steam OpenID login
- linking multiple Steam identities to one hub account
- DM approval for Steam linking when a Discord identity is already attached
- a live websocket feed at `/ws/live` so dashboard clients can refresh when hub sync state changes

Apply the auth migration after pulling:

```bash
psql "$SUPABASE_DB_URL" -f postgres_migrations/002_hub_auth_schema.sql
```

## CI/CD

Two GitHub Actions workflows are included:

- `hub-pages.yml` builds and deploys the Vite frontend to GitHub Pages
- `bot-deploy.yml` uploads the bot/backend runtime to the Sparked host over SFTP

Configure these GitHub secrets for bot deploy:

```text
SPARKED_SERVER_HOST
SPARKED_SERVER_PORT
SPARKED_SERVER_USERNAME
SPARKED_SERVER_PASSWORD
SPARKED_SERVER_REMOTE_PATH
```
