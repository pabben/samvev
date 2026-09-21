CREATE TABLE monitor_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  instruction text NOT NULL CHECK (length(instruction) BETWEEN 10 AND 2000),
  source_url text NOT NULL CHECK (length(source_url) <= 2048),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused')),
  check_interval_minutes integer NOT NULL CHECK (check_interval_minutes BETWEEN 15 AND 10080),
  notice_days_before integer NOT NULL CHECK (notice_days_before BETWEEN 0 AND 30),
  notice_local_time time NOT NULL,
  provider_policy text NOT NULL CHECK (provider_policy IN ('default','local','openai')),
  model_tier text NOT NULL CHECK (model_tier IN ('routine','strong')),
  interpreted_rule jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  approved_revision integer,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  last_result text,
  last_changed_at timestamptz,
  error_code text,
  source_final_url text,
  source_content_type text,
  source_etag text,
  source_last_modified text,
  last_processed_fingerprint text,
  check_count integer NOT NULL DEFAULT 0,
  ai_call_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id,id),
  FOREIGN KEY (household_id,owner_membership_id) REFERENCES memberships(household_id,id),
  CHECK (approved_revision IS NULL OR approved_revision > 0),
  CHECK (state <> 'active' OR approved_revision = revision)
);
CREATE INDEX monitor_tasks_due_idx ON monitor_tasks(next_check_at) WHERE state='active';

CREATE TABLE monitor_task_person_targets (
  household_id uuid NOT NULL, task_id uuid NOT NULL, person_id uuid NOT NULL,
  PRIMARY KEY(task_id,person_id),
  FOREIGN KEY(household_id,task_id) REFERENCES monitor_tasks(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);
CREATE TABLE monitor_task_display_targets (
  household_id uuid NOT NULL, task_id uuid NOT NULL, display_id uuid NOT NULL,
  PRIMARY KEY(task_id,display_id),
  FOREIGN KEY(household_id,task_id) REFERENCES monitor_tasks(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);

CREATE TABLE monitor_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES monitor_tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('changed','unchanged','failed','superseded')),
  fingerprint text,
  ai_called boolean NOT NULL DEFAULT false,
  provider text,
  model text,
  error_code text,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX monitor_runs_task_time_idx ON monitor_runs(task_id,checked_at DESC);

CREATE TABLE monitor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  task_id uuid NOT NULL,
  event_key text NOT NULL,
  event_date date NOT NULL,
  event_time time,
  event_type text NOT NULL,
  description text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  applies_to jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  uncertainty text,
  active boolean NOT NULL DEFAULT true,
  source_fingerprint text NOT NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(task_id,event_key),
  FOREIGN KEY(household_id,task_id) REFERENCES monitor_tasks(household_id,id) ON DELETE CASCADE
);
