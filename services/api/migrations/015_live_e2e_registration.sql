-- Permanently bind the one supported synthetic live-E2E identity to its
-- installation, household, account and membership. Runtime provisioning is
-- opt-in and the application never creates sessions for this identity.
ALTER TABLE accounts
  ADD CONSTRAINT accounts_installation_id_id_unique UNIQUE (installation_id, id);

ALTER TABLE memberships
  ADD CONSTRAINT memberships_household_id_id_account_id_unique
  UNIQUE (household_id, id, account_id);

CREATE TABLE live_e2e_registrations (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  marker_hash text NOT NULL UNIQUE CHECK (marker_hash ~ '^[a-f0-9]{64}$'),
  purpose text NOT NULL DEFAULT 'synthetic_live_e2e_v1'
    CHECK (purpose = 'synthetic_live_e2e_v1'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (installation_id),
  UNIQUE (household_id),
  UNIQUE (account_id),
  UNIQUE (membership_id),
  FOREIGN KEY (installation_id, household_id)
    REFERENCES households(installation_id, id),
  FOREIGN KEY (installation_id, account_id)
    REFERENCES accounts(installation_id, id),
  FOREIGN KEY (household_id, membership_id, account_id)
    REFERENCES memberships(household_id, id, account_id)
);

CREATE FUNCTION deny_live_e2e_registration_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'live E2E registration bindings are immutable';
END $$;

CREATE TRIGGER live_e2e_registration_immutable
  BEFORE UPDATE OR DELETE ON live_e2e_registrations
  FOR EACH ROW EXECUTE FUNCTION deny_live_e2e_registration_mutation();

ALTER TABLE message_lifecycle_events
  ADD COLUMN execution_id uuid REFERENCES monitor_executions(id) ON DELETE SET NULL;
CREATE INDEX message_lifecycle_events_execution_idx
  ON message_lifecycle_events(execution_id) WHERE execution_id IS NOT NULL;

ALTER TABLE monitor_executions
  ADD COLUMN required_tools jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (
    jsonb_typeof(required_tools)='array'
    AND required_tools <@ '["web.open","weather.forecast"]'::jsonb
    AND jsonb_array_length(required_tools) BETWEEN 0 AND 6
  );
UPDATE monitor_executions e SET required_tools=t.tool_plan
FROM monitor_tasks t WHERE t.id=e.task_id AND t.household_id=e.household_id;

-- Rollback requires first disabling live E2E, then explicitly removing the
-- immutable trigger/table, execution audit columns/indexes and the two
-- supporting unique constraints. No down migration runs automatically.
