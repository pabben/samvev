ALTER TABLE monitor_tasks
  ALTER COLUMN source_url DROP NOT NULL,
  ADD COLUMN tool_plan jsonb NOT NULL DEFAULT '["web.open"]'::jsonb
    CHECK (
      jsonb_typeof(tool_plan) = 'array'
      AND jsonb_array_length(tool_plan) BETWEEN 1 AND 6
      AND tool_plan <@ '["web.open","weather.forecast"]'::jsonb
    );

ALTER TABLE monitor_runs
  ADD COLUMN error_details jsonb
    CHECK (error_details IS NULL OR jsonb_typeof(error_details) = 'object');

CREATE TABLE monitor_quality_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES monitor_tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('interpretation','test','manual','smarter','scheduled')),
  reason text NOT NULL CHECK (reason IN ('saved_preference','multi_tool','person_schedule','schedule_semantics','conditional_notification','validated_low_confidence','invalid_schema','composition_failure')),
  from_tier text NOT NULL CHECK (from_tier IN ('routine','strong')),
  to_tier text NOT NULL CHECK (to_tier IN ('routine','strong')),
  outcome text NOT NULL CHECK (outcome IN ('selected','escalated','succeeded','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX monitor_quality_audits_task_time_idx
  ON monitor_quality_audits(task_id,created_at DESC);
