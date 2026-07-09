ALTER TABLE __HUB_SCHEMA__.hub_tournament_fixtures
    ADD COLUMN IF NOT EXISTS stage_type VARCHAR(32) NOT NULL DEFAULT 'league',
    ADD COLUMN IF NOT EXISTS round_number INTEGER NULL,
    ADD COLUMN IF NOT EXISTS bracket_slot INTEGER NULL,
    ADD COLUMN IF NOT EXISTS home_source TEXT NULL,
    ADD COLUMN IF NOT EXISTS away_source TEXT NULL,
    ADD COLUMN IF NOT EXISTS winner_guild_id VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS winner_to_fixture_id INTEGER NULL,
    ADD COLUMN IF NOT EXISTS loser_to_fixture_id INTEGER NULL;

UPDATE __HUB_SCHEMA__.hub_tournament_fixtures
SET stage_type = 'league'
WHERE stage_type IS NULL OR btrim(stage_type) = '';

CREATE INDEX IF NOT EXISTS idx_hub_fixtures_stage_round
ON __HUB_SCHEMA__.hub_tournament_fixtures (tournament_id, stage_type, round_number, bracket_slot, fixture_id);
