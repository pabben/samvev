-- General Home Assistant calendars, bounded snapshot identities and selected
-- temperature observations. Existing Spond source identifiers and ACL rows are
-- intentionally left unchanged.

ALTER TABLE calendar_connections
  ADD COLUMN replacement_required boolean NOT NULL DEFAULT false,
  ADD COLUMN replaces_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  ADD COLUMN credential_lease_token uuid,
  ADD COLUMN credential_lease_expires_at timestamptz;

ALTER TABLE calendar_sources
  ADD COLUMN purpose text NOT NULL DEFAULT 'calendar'
    CHECK (purpose IN ('calendar','waste')),
  ADD COLUMN display_name text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  ADD COLUMN sync_past_days integer NOT NULL DEFAULT 7 CHECK (sync_past_days BETWEEN 0 AND 31),
  ADD COLUMN sync_future_days integer NOT NULL DEFAULT 180 CHECK (sync_future_days BETWEEN 1 AND 366),
  ADD COLUMN available boolean NOT NULL DEFAULT true,
  ADD COLUMN last_discovered_at timestamptz,
  ADD COLUMN last_complete_window_from timestamptz,
  ADD COLUMN last_complete_window_to timestamptz,
  ADD COLUMN last_sync_succeeded_at timestamptz,
  ADD COLUMN last_error_code text;

ALTER TABLE calendar_occurrences
  ADD COLUMN identity_kind text NOT NULL DEFAULT 'provider'
    CHECK (identity_kind IN ('provider','local_snapshot'));

ALTER TABLE calendar_occurrences
  DROP CONSTRAINT calendar_occurrences_source_id_event_uid_instance_id_key;
ALTER TABLE calendar_occurrences
  ADD CONSTRAINT calendar_occurrences_source_identity_event_unique
    UNIQUE(source_id,identity_kind,event_uid,instance_id);

CREATE TABLE home_assistant_temperature_sensors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 500),
  identity_kind text NOT NULL CHECK (identity_kind IN ('registry','entity')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  display_name text CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  native_unit text CHECK (native_unit IS NULL OR length(native_unit)<=24),
  enabled boolean NOT NULL DEFAULT false,
  target_household boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 1000),
  available boolean NOT NULL DEFAULT true,
  last_validated_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  integration_item_id uuid REFERENCES integration_items(id) ON DELETE SET NULL,
  last_value numeric,
  last_unit text CHECK (last_unit IS NULL OR length(last_unit)<=24),
  status text NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive','current','stale','unavailable','error')),
  last_reported_at timestamptz,
  last_updated_at timestamptz,
  last_fetched_at timestamptz,
  last_successful_poll_at timestamptz,
  next_poll_at timestamptz,
  last_error_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(connection_id,external_id),
  UNIQUE(household_id,id),
  FOREIGN KEY(household_id,connection_id) REFERENCES calendar_connections(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,integration_item_id) REFERENCES integration_items(household_id,id)
);

CREATE TABLE home_assistant_temperature_person_readers (
  household_id uuid NOT NULL,
  sensor_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY(sensor_id,person_id),
  FOREIGN KEY(household_id,sensor_id) REFERENCES home_assistant_temperature_sensors(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);

CREATE TABLE home_assistant_temperature_display_targets (
  household_id uuid NOT NULL,
  sensor_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY(sensor_id,display_id),
  FOREIGN KEY(household_id,sensor_id) REFERENCES home_assistant_temperature_sensors(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);

CREATE INDEX home_assistant_temperature_due_idx
  ON home_assistant_temperature_sensors(next_poll_at,id)
  WHERE enabled;

CREATE INDEX calendar_connections_replacement_idx
  ON calendar_connections(replaces_connection_id)
  WHERE replaces_connection_id IS NOT NULL;

-- A rollback to code before 026 must stop the worker first. The additive
-- columns/tables may remain. Fence enabled sensor rows and withdraw their
-- observation items before starting the old worker.
