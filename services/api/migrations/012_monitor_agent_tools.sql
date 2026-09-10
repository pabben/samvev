ALTER TABLE monitor_tasks
  ADD COLUMN source_dependency_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_dependency_manifest) = 'array');

ALTER TABLE monitor_runs
  ADD COLUMN ai_call_count integer NOT NULL DEFAULT 0 CHECK (ai_call_count >= 0),
  ADD COLUMN tool_provenance jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(tool_provenance) = 'array'),
  ADD COLUMN dependency_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(dependency_manifest) = 'array');

CREATE TABLE monitor_tool_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES monitor_tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('interpretation','test','manual','smarter','scheduled')),
  outcome text NOT NULL CHECK (outcome IN ('success','failed')),
  error_code text,
  ai_call_count integer NOT NULL CHECK (ai_call_count >= 0),
  attempted_tool_count integer NOT NULL CHECK (attempted_tool_count >= 0),
  tool_count integer NOT NULL CHECK (tool_count >= 0),
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provenance) = 'array'),
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attempts) = 'array'),
  CHECK ((outcome='success' AND error_code IS NULL) OR (outcome='failed' AND error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')),
  CHECK (outcome='success' OR provenance='[]'::jsonb),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX monitor_tool_audits_task_time_idx ON monitor_tool_audits(task_id,created_at DESC);

ALTER TABLE monitor_runs
  ADD CONSTRAINT monitor_runs_failed_without_tool_data
  CHECK (outcome<>'failed' OR (tool_provenance='[]'::jsonb AND dependency_manifest='[]'::jsonb));
