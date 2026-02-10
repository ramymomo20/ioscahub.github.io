# IOSCA Hub Backend

FastAPI backend for hub subpages:

- Rankings
- Players / player profile
- Matches / match detail
- Tournaments / tournament detail
- Teams / team detail
- Servers
- Discord

## Setup

```bash
cd backend
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Set `SUPABASE_DB_URL` in `.env`.

## Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Health:

- `GET http://localhost:8080/api/health`

## Notes

- This is read-oriented and matches `migrations/FINAL_MERGED_SCHEMA.sql`.
- WebSocket endpoint is configurable with `IOSCA_HUB_WS_PATH`.
- Webhook endpoint is `POST /api/webhooks/events` and can require `x-webhook-token`.
