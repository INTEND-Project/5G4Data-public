-- Allow re-registering an agent card after soft-delete.
--
-- Previous schema had a table-level UNIQUE constraint on agents.well_known_uri,
-- which blocked inserts even when an older row was hidden=true.
-- We replace it with a partial unique index that only applies to visible rows.

-- Drop legacy unique constraint if present.
ALTER TABLE agents
    DROP CONSTRAINT IF EXISTS agents_well_known_uri_key;

-- Remove a possible legacy unique index with the same name.
DROP INDEX IF EXISTS agents_well_known_uri_key;

-- Enforce uniqueness only for visible rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_well_known_uri_visible_unique
    ON agents (well_known_uri)
    WHERE hidden = false;
