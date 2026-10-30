-- Retain disconnected calendar authority rows as tombstones so an R16 rollback
-- still excludes their backing integrations from the generic integration list.
-- Rollback is additive: keep this nullable column when rolling application
-- code back; no physical schema rollback is required.
ALTER TABLE calendar_connections
  ADD COLUMN removed_at timestamptz;

CREATE INDEX calendar_connections_removed_idx
  ON calendar_connections(household_id,removed_at,id)
  WHERE removed_at IS NOT NULL;
