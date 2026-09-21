ALTER TABLE monitor_tool_audits
  RENAME CONSTRAINT monitor_tool_audits_check TO monitor_tool_audits_outcome_error_check;

ALTER TABLE monitor_tool_audits
  DROP CONSTRAINT monitor_tool_audits_outcome_error_check,
  DROP CONSTRAINT monitor_tool_audits_check1,
  ADD COLUMN error_details jsonb
    CHECK (error_details IS NULL OR jsonb_typeof(error_details) = 'object'),
  ADD COLUMN dependency_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(dependency_manifest) = 'array'),
  ADD CONSTRAINT monitor_tool_audits_outcome_error_check CHECK (
    (outcome = 'success' AND error_code IS NULL AND error_details IS NULL)
    OR (outcome = 'failed' AND error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
  ),
  ADD CONSTRAINT monitor_tool_audits_diagnostic_bounds CHECK (
    jsonb_array_length(provenance) <= 64
    AND jsonb_array_length(attempts) <= 64
    AND jsonb_array_length(dependency_manifest) <= 64
  );

ALTER TABLE monitor_runs
  DROP CONSTRAINT monitor_runs_failed_without_tool_data,
  ADD CONSTRAINT monitor_runs_diagnostic_bounds CHECK (
    jsonb_array_length(tool_provenance) <= 64
    AND jsonb_array_length(dependency_manifest) <= 64
  );

-- Failed runs retain only the same bounded provenance and dependency metadata
-- already stored for successful runs. Raw tool payloads and model output are
-- never written to these columns.
