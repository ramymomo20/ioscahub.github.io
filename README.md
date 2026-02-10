# IOSCA Hub (GitHub Pages)

Static hub for IOSCA results, standings, tournaments, teams, and schedules.

## Structure

- `index.html`: main page
- `assets/css/site.css`: styles
- `assets/js/app.js`: render logic from JSON
- `data/hub.json`: exported dataset consumed by the page

## Export data from Supabase

From the project root:

```bash
python tools/export_hub_data.py --db-url "$SUPABASE_DB_URL"
```

If `SUPABASE_DB_URL` is already in your environment, you can run:

```bash
python tools/export_hub_data.py
```

The script writes:

- `iosca_hub_github/ioscahub.github.io/data/hub.json`

## What the page shows

- Recent match results (`MATCH_STATS`)
- Tournament standings and fixtures (`TOURNAMENT_STANDINGS`, `TOURNAMENT_FIXTURES`)
- Tournament top players (`TOURNAMENT_PLAYER_STATS`)
- Team overview (`IOSCA_TEAMS` + match aggregates)
- Open schedule entries (`TOURNAMENT_SCHEDULES`)

## Publish on GitHub Pages

1. Push this folder to your `ioscahub.github.io` repository root.
2. In repository settings, enable GitHub Pages from `main` branch root.
3. Re-run `tools/export_hub_data.py` whenever you want fresh data, then commit/push `data/hub.json`.
