CREATE TABLE monitor_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  task_revision integer NOT NULL CHECK (task_revision > 0),
  kind text NOT NULL CHECK (kind IN ('interpretation','test','manual','smarter','scheduled')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','superseded')),
  requested_by_membership_id uuid,
  provider_snapshot text NOT NULL CHECK (provider_snapshot IN ('openai','openai_compatible','chatgpt_subscription','gemini')),
  ai_settings_revision integer NOT NULL CHECK (ai_settings_revision >= 0),
  latency_class text NOT NULL CHECK (latency_class IN ('cloud_standard','local_simple','local_complex')),
  max_runtime_ms integer NOT NULL CHECK (max_runtime_ms BETWEEN 60000 AND 900000),
  expected_duration_seconds integer NOT NULL CHECK (expected_duration_seconds BETWEEN 1 AND 900),
  progress_stage text NOT NULL DEFAULT 'queued' CHECK (progress_stage IN ('queued','preparing','fetching_source','fetching_weather','analyzing','validating','finalizing')),
  progress_updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  worker_lease_token uuid,
  worker_lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  result_summary jsonb CHECK (result_summary IS NULL OR jsonb_typeof(result_summary)='object'),
  error_code text,
  error_details jsonb CHECK (error_details IS NULL OR jsonb_typeof(error_details)='object'),
  timeout_reason text CHECK (timeout_reason IS NULL OR timeout_reason IN ('server_deadline','provider_timeout','worker_interrupted')),
  timing jsonb NOT NULL DEFAULT '{"queueWaitMs":0,"providerTurns":0,"toolCalls":0,"webOpenMs":0,"locationMs":0,"weatherMs":0,"providerMs":0,"totalMs":0,"qualityEscalated":false}'::jsonb
    CHECK (jsonb_typeof(timing)='object'),
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (household_id,task_id) REFERENCES monitor_tasks(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,requested_by_membership_id) REFERENCES memberships(household_id,id),
  CHECK ((status IN ('queued','running') AND completed_at IS NULL AND error_code IS NULL) OR status IN ('succeeded','superseded') OR (status='failed' AND error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')),
  CHECK (status <> 'running' OR (started_at IS NOT NULL AND worker_lease_token IS NOT NULL AND worker_lease_expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX monitor_executions_task_active_idx
  ON monitor_executions(task_id) WHERE status IN ('queued','running');
CREATE INDEX monitor_executions_queue_idx
  ON monitor_executions(queued_at,id) WHERE status='queued';
CREATE INDEX monitor_executions_task_time_idx
  ON monitor_executions(task_id,created_at DESC);
CREATE INDEX monitor_executions_household_started_idx
  ON monitor_executions(household_id,started_at DESC) WHERE started_at IS NOT NULL;

ALTER TABLE monitor_runs
  ADD COLUMN execution_id uuid REFERENCES monitor_executions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX monitor_runs_execution_idx
  ON monitor_runs(execution_id) WHERE execution_id IS NOT NULL;

ALTER TABLE monitor_tool_audits
  ADD COLUMN execution_id uuid REFERENCES monitor_executions(id) ON DELETE SET NULL;
CREATE INDEX monitor_tool_audits_execution_idx
  ON monitor_tool_audits(execution_id) WHERE execution_id IS NOT NULL;

ALTER TABLE monitor_quality_audits
  ADD COLUMN execution_id uuid REFERENCES monitor_executions(id) ON DELETE SET NULL;
CREATE INDEX monitor_quality_audits_execution_idx
  ON monitor_quality_audits(execution_id) WHERE execution_id IS NOT NULL;
