-- Round 9: protected profile-photo variants and monitor subject metadata.
-- Photo bytes live in PostgreSQL so the existing database backup/restore is atomic.

CREATE TABLE person_profile_photos (
  person_id uuid PRIMARY KEY REFERENCES persons(id) ON DELETE CASCADE,
  household_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  original_mime text NOT NULL CHECK (original_mime IN ('image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif')),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 12000),
  variant_96 bytea NOT NULL CHECK (octet_length(variant_96) BETWEEN 1 AND 524288),
  variant_512 bytea NOT NULL CHECK (octet_length(variant_512) BETWEEN 1 AND 4194304),
  updated_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);
CREATE INDEX person_profile_photos_household_idx ON person_profile_photos(household_id,person_id);

ALTER TABLE persons
  ADD COLUMN photo_revision integer NOT NULL DEFAULT 0 CHECK (photo_revision >= 0);

ALTER TABLE monitor_tasks
  ADD COLUMN subjects_revision integer NOT NULL DEFAULT 1 CHECK (subjects_revision > 0),
  ADD COLUMN subjects_updated_at timestamptz;

CREATE TABLE monitor_task_subjects (
  household_id uuid NOT NULL,
  task_id uuid NOT NULL,
  person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,person_id),
  FOREIGN KEY(household_id,task_id) REFERENCES monitor_tasks(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);
CREATE INDEX monitor_task_subjects_person_idx ON monitor_task_subjects(household_id,person_id,task_id);

CREATE TABLE monitor_task_subject_audits (
  id bigserial PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES monitor_tasks(id) ON DELETE CASCADE,
  subjects_revision integer NOT NULL CHECK (subjects_revision > 1),
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  previous_person_ids uuid[] NOT NULL DEFAULT '{}',
  person_ids uuid[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(task_id,subjects_revision)
);

CREATE TABLE monitor_result_reviews (
  task_id uuid NOT NULL REFERENCES monitor_tasks(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  disposition text NOT NULL CHECK (disposition IN ('saved','handled','dismissed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,run_id,account_id)
);

-- Rollback keeps the additive columns/tables until new photo/subject data has
-- been exported. Application-code rollback can safely ignore them.
