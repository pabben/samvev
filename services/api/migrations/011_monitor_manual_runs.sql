ALTER TABLE monitor_runs
  ADD COLUMN run_kind text NOT NULL DEFAULT 'scheduled'
    CHECK (run_kind IN ('scheduled','test','manual','smarter')),
  ADD COLUMN result_kind text CHECK (result_kind IN ('events','answer')),
  ADD COLUMN result jsonb,
  ADD COLUMN source_url text;

CREATE INDEX monitor_runs_task_kind_time_idx
  ON monitor_runs(task_id,run_kind,checked_at DESC);
