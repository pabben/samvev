ALTER TABLE ai_settings
  ADD COLUMN default_reasoning_effort text NOT NULL DEFAULT 'none'
    CHECK (default_reasoning_effort IN ('none','low','medium','high')),
  ADD COLUMN strong_reasoning_effort text NOT NULL DEFAULT 'medium'
    CHECK (strong_reasoning_effort IN ('none','low','medium','high'));

-- Additive rollback, if no deployed code depends on these settings:
-- ALTER TABLE ai_settings DROP COLUMN strong_reasoning_effort, DROP COLUMN default_reasoning_effort;
