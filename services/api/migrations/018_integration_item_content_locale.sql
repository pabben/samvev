-- Existing M3 development items have unknown content language; do not infer it.
ALTER TABLE integration_items
  ADD COLUMN content_locale text CHECK (content_locale IN ('en','nb'));
