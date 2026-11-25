-- Bounded display response witnesses probe occurrence membership by item, rather
-- than scanning retained source history. Existing source-first indexes remain.
CREATE INDEX calendar_occurrences_item_source_idx
  ON calendar_occurrences(integration_item_id,source_id)
  WHERE integration_item_id IS NOT NULL;
