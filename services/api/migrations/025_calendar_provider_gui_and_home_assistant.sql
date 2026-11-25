-- GUI-managed calendar provider registrations and the read-only Home Assistant
-- Spond bridge. Existing Google/Microsoft environment registrations remain a
-- legacy fallback only while no database row exists.

CREATE TABLE installation_calendar_provider_configs (
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google','microsoft','home_assistant')),
  status text NOT NULL CHECK (status IN ('active','disabled')),
  config_ciphertext text,
  client_id_hash text CHECK (client_id_hash IS NULL OR length(client_id_hash)=64),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id,provider),
  CHECK ((status='active' AND config_ciphertext IS NOT NULL) OR status='disabled')
);

ALTER TABLE calendar_connections DROP CONSTRAINT calendar_connections_provider_check;
ALTER TABLE calendar_connections ADD CONSTRAINT calendar_connections_provider_check
  CHECK (provider IN ('google','microsoft','ics','home_assistant'));
ALTER TABLE calendar_connections DROP CONSTRAINT calendar_connections_bridge_kind_check;
ALTER TABLE calendar_connections ADD CONSTRAINT calendar_connections_bridge_kind_check
  CHECK (bridge_kind IN ('direct','spond_calendar','spond_home_assistant'));
ALTER TABLE calendar_connections
  ADD COLUMN provider_config_revision integer NOT NULL DEFAULT 0 CHECK (provider_config_revision>=0),
  ADD COLUMN provider_client_id_hash text CHECK (provider_client_id_hash IS NULL OR length(provider_client_id_hash)=64);

ALTER TABLE calendar_sources DROP CONSTRAINT calendar_sources_bridge_kind_check;
ALTER TABLE calendar_sources ADD CONSTRAINT calendar_sources_bridge_kind_check
  CHECK (bridge_kind IN ('direct','spond_calendar','spond_home_assistant'));
ALTER TABLE calendar_sources
  ADD COLUMN source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT calendar_sources_source_provenance_object CHECK (jsonb_typeof(source_provenance)='object');

ALTER TABLE calendar_oauth_sessions
  ADD COLUMN provider_config_revision integer NOT NULL DEFAULT 0 CHECK (provider_config_revision>=0);

CREATE INDEX calendar_connections_provider_config_idx
  ON calendar_connections(provider,provider_config_revision)
  WHERE disconnected_at IS NULL;

-- Old code cannot safely operate home_assistant rows. Before an image-only
-- rollback, stop the worker and fence those rows (state='expired', next_sync_at
-- NULL, leases cleared) or restore the pre-025 database backup. Additive schema
-- retention alone is not a safe old-worker rollback for this provider.
-- With the worker stopped, the image-only rollback fence is:
-- BEGIN;
-- UPDATE calendar_oauth_sessions SET consumed_at=COALESCE(consumed_at,clock_timestamp()),
--   completion_hash=NULL,authorization_code_ciphertext=NULL
--   WHERE connection_id IN (SELECT id FROM calendar_connections WHERE provider='home_assistant');
-- UPDATE calendar_connections SET state='expired',next_sync_at=NULL,lease_token=NULL,
--   lease_expires_at=NULL,sync_generation=sync_generation+1,
--   last_error_code='CALENDAR_REAUTHORIZATION_REQUIRED',updated_at=clock_timestamp()
--   WHERE provider='home_assistant' AND disconnected_at IS NULL;
-- COMMIT;
