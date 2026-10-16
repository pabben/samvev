ALTER TABLE home_assistant_control_dispatches
  ADD COLUMN deadline_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 seconds';
