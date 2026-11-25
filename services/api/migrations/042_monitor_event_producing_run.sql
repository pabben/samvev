-- Document fingerprints and dependency-aggregate run fingerprints are different
-- identities. Capture the producing run explicitly; legacy provenance stays
-- unknown rather than guessing a link from dates or fingerprints.
ALTER TABLE monitor_runs ADD CONSTRAINT monitor_runs_task_id_id_key UNIQUE(task_id,id);
ALTER TABLE monitor_events ADD COLUMN producing_run_id uuid;
ALTER TABLE monitor_events ADD CONSTRAINT monitor_events_producing_run_same_task_fk
  FOREIGN KEY(task_id,producing_run_id) REFERENCES monitor_runs(task_id,id);
CREATE INDEX monitor_events_producing_run_idx ON monitor_events(task_id,producing_run_id)
  WHERE producing_run_id IS NOT NULL;
