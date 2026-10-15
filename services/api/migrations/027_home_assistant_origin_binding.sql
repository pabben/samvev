-- Retain the normalized Home Assistant origin binding across credential
-- revocation so a later OAuth completion can distinguish same-instance
-- recovery from a newly configured instance.
ALTER TABLE calendar_connections
  ADD COLUMN home_assistant_origin_hash text
    CHECK (home_assistant_origin_hash IS NULL OR home_assistant_origin_hash ~ '^[0-9a-f]{64}$');
