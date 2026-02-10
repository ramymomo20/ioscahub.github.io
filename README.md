# IOSCA Hub

This repository now has a split architecture:

- `backend/`: FastAPI API over your existing Supabase/Postgres schema
- `frontend/`: static multi-page UI (Rankings, Players, Matches, Tournaments, Teams, Servers, Discord)

The root `index.html` redirects to `frontend/index.html`.

## Implemented subpages

- `frontend/rankings.html`
- `frontend/players.html`
- `frontend/player.html?steam_id=...`
- `frontend/matches.html`
- `frontend/match.html?id=...`
- `frontend/tournaments.html`
- `frontend/tournament.html?id=...`
- `frontend/teams.html`
- `frontend/team.html?id=...`
- `frontend/servers.html`
- `frontend/discord.html`

## Backend setup

```bash
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Set at least:

- `SUPABASE_DB_URL`

Run:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

API health:

- `GET http://127.0.0.1:8080/api/health`

## Frontend setup

No build step required.

Serve static files from this repo root (or from `frontend/`):

```bash
# Example with Python
python -m http.server 5500
```

Then open:

- `http://127.0.0.1:5500/frontend/index.html`

`frontend/assets/js/config.js` auto-uses local API (`127.0.0.1:8080`) on localhost.

## Configs for websocket/webhook/tokens

Backend env file: `backend/.env.example`

Includes:

- websocket toggles/path
- webhook toggle/token
- discord links and optional bot token
- steam key placeholder
- rcon polling placeholders

Frontend API/WS config:

- `frontend/assets/js/config.js`
- `frontend/assets/js/config.example.js`

## Existing JSON exporter

The static export tooling still exists under `tools/`:

- `tools/export_hub_data.py`

Use this only if you want a no-backend static snapshot in `data/hub.json`.
