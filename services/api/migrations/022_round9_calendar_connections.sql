-- Round 9: read-only Google, Microsoft and secret-URL ICS calendar connections.

CREATE TABLE calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  integration_connection_id uuid NOT NULL,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('google','microsoft','ics')),
  bridge_kind text NOT NULL DEFAULT 'direct' CHECK (bridge_kind IN ('direct','spond_calendar')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'setup' CHECK (state IN ('setup','awaiting_consent','connected','syncing','error','expired','disconnected')),
  provider_subject_hash text,
  account_label text CHECK (account_label IS NULL OR length(account_label)<=254),
  credential_ciphertext text,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  access_expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  sync_generation integer NOT NULL DEFAULT 0 CHECK (sync_generation >= 0),
  last_sync_started_at timestamptz,
  last_sync_succeeded_at timestamptz,
  next_sync_at timestamptz,
  last_error_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(household_id,id),
  UNIQUE(integration_connection_id),
  FOREIGN KEY(household_id,integration_connection_id) REFERENCES integration_connections(household_id,id)
);
CREATE INDEX calendar_connections_due_idx ON calendar_connections(next_sync_at,id) WHERE state IN ('connected','error','syncing');
CREATE UNIQUE INDEX calendar_connections_provider_account_unique
  ON calendar_connections(household_id,provider,provider_subject_hash)
  WHERE provider_subject_hash IS NOT NULL AND disconnected_at IS NULL;

CREATE TABLE calendar_oauth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  initiating_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE CHECK (length(state_hash)=64),
  verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL CHECK (length(redirect_uri)<=2048),
  completion_hash text UNIQUE CHECK (completion_hash IS NULL OR length(completion_hash)=64),
  authorization_code_ciphertext text,
  callback_received_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE calendar_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  bridge_kind text NOT NULL DEFAULT 'direct' CHECK (bridge_kind IN ('direct','spond_calendar')),
  enabled boolean NOT NULL DEFAULT false,
  subject_household boolean NOT NULL DEFAULT false,
  target_household boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(connection_id,external_id),
  UNIQUE(household_id,id),
  FOREIGN KEY(household_id,connection_id) REFERENCES calendar_connections(household_id,id) ON DELETE CASCADE
);

CREATE TABLE calendar_source_person_subjects (
  household_id uuid NOT NULL,
  source_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY(source_id,person_id),
  FOREIGN KEY(household_id,source_id) REFERENCES calendar_sources(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);
CREATE TABLE calendar_source_person_readers (
  household_id uuid NOT NULL,
  source_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY(source_id,person_id),
  FOREIGN KEY(household_id,source_id) REFERENCES calendar_sources(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);
CREATE TABLE calendar_source_display_targets (
  household_id uuid NOT NULL,
  source_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY(source_id,display_id),
  FOREIGN KEY(household_id,source_id) REFERENCES calendar_sources(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);

CREATE TABLE calendar_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  event_uid text NOT NULL CHECK (length(event_uid) BETWEEN 1 AND 500),
  instance_id text NOT NULL CHECK (length(instance_id) BETWEEN 1 AND 500),
  incarnation integer NOT NULL DEFAULT 1 CHECK (incarnation > 0),
  integration_item_id uuid REFERENCES integration_items(id) ON DELETE SET NULL,
  external_item_id text NOT NULL CHECK (length(external_item_id) BETWEEN 1 AND 160),
  fingerprint text NOT NULL CHECK (length(fingerprint)=64),
  status text NOT NULL CHECK (status IN ('active','withdrawn')),
  last_seen_generation integer NOT NULL CHECK (last_seen_generation > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_id,event_uid,instance_id),
  UNIQUE(source_id,external_item_id),
  FOREIGN KEY(household_id,source_id) REFERENCES calendar_sources(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,integration_item_id) REFERENCES integration_items(household_id,id)
);

CREATE TABLE integration_item_person_subjects (
  household_id uuid NOT NULL,
  item_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY(item_id,person_id),
  FOREIGN KEY(household_id,item_id) REFERENCES integration_items(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);
CREATE INDEX calendar_occurrences_reconcile_idx ON calendar_occurrences(source_id,last_seen_generation,status);

CREATE TABLE calendar_sync_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation > 0),
  outcome text NOT NULL CHECK (outcome IN ('started','succeeded','failed','superseded')),
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((outcome='started' AND completed_at IS NULL AND error_code IS NULL) OR (outcome='succeeded' AND completed_at IS NOT NULL AND error_code IS NULL) OR (outcome IN ('failed','superseded') AND completed_at IS NOT NULL))
);

-- Disconnect withdraws imported projections through application logic while
-- retaining audit/tombstones. A code rollback can leave these additive tables.
