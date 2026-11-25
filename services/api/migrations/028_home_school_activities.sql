-- Home school presentation is intentionally independent from an approved
-- monitor task revision. Event expiry is captured when the structured result
-- is first saved so metadata edits and unchanged source checks cannot extend it.
ALTER TABLE monitor_tasks
  ADD COLUMN presentation_kind text CHECK (presentation_kind IS NULL OR presentation_kind='school'),
  ADD COLUMN school_end_local_time time,
  ADD COLUMN presentation_revision integer NOT NULL DEFAULT 1 CHECK (presentation_revision>0),
  ADD COLUMN presentation_updated_at timestamptz;

ALTER TABLE monitor_events
  ADD COLUMN school_expires_at timestamptz;

CREATE INDEX monitor_events_active_school_date_idx
  ON monitor_events(household_id,event_date,event_time,id)
  WHERE active AND jsonb_array_length(actions)>0;
