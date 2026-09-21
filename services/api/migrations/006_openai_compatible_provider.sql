ALTER TABLE ai_settings
ADD COLUMN base_url text,
ADD CONSTRAINT ai_settings_base_url_length CHECK (base_url IS NULL OR length(base_url) <= 2048);
