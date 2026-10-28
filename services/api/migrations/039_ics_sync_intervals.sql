ALTER TABLE calendar_connections
  ADD COLUMN sync_interval_minutes smallint NOT NULL DEFAULT 15
    CHECK (sync_interval_minutes IN (5, 15, 30));
