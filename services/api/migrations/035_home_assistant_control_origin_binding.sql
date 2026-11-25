-- Bind each saved control selection to the normalized HA instance that the
-- household administrator inspected. A NULL legacy binding remains inactive
-- until that entity is explicitly selected again.
ALTER TABLE home_assistant_control_entities
  ADD COLUMN selected_origin_hash text
    CHECK (selected_origin_hash IS NULL OR selected_origin_hash ~ '^[0-9a-f]{64}$');
