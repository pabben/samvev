CREATE TABLE home_assistant_control_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity_registry_id text NOT NULL CHECK(length(entity_registry_id) BETWEEN 1 AND 512),
  entity_id text NOT NULL CHECK(entity_id ~ '^(light|cover)\.[a-z0-9_]+$'),
  device_registry_id text CHECK(device_registry_id IS NULL OR length(device_registry_id) BETWEEN 1 AND 512),
  domain text NOT NULL CHECK(domain IN ('light','cover')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  display_name text CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  supported_actions text[] NOT NULL CHECK(supported_actions <@ ARRAY['light.turn_on','light.turn_off','cover.open_cover']::text[]),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  selected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(household_id,id),
  UNIQUE(connection_id,entity_registry_id),
  FOREIGN KEY(household_id,connection_id) REFERENCES calendar_connections(household_id,id) ON DELETE CASCADE,
  CHECK((domain='light' AND supported_actions <@ ARRAY['light.turn_on','light.turn_off']::text[]) OR
        (domain='cover' AND supported_actions <@ ARRAY['cover.open_cover']::text[]))
);
CREATE INDEX home_assistant_control_entities_household_idx ON home_assistant_control_entities(household_id,connection_id,selected,id);

CREATE TABLE home_assistant_control_person_grants (
  household_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  person_id uuid NOT NULL,
  can_read boolean NOT NULL DEFAULT false,
  can_turn_on boolean NOT NULL DEFAULT false,
  can_turn_off boolean NOT NULL DEFAULT false,
  can_open boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(entity_id,person_id),
  FOREIGN KEY(household_id,entity_id) REFERENCES home_assistant_control_entities(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE,
  CHECK(can_read OR can_turn_on OR can_turn_off OR can_open)
);

CREATE TABLE home_assistant_control_display_grants (
  household_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  display_id uuid NOT NULL,
  can_read boolean NOT NULL DEFAULT false,
  can_turn_on boolean NOT NULL DEFAULT false,
  can_turn_off boolean NOT NULL DEFAULT false,
  can_open boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(entity_id,display_id),
  FOREIGN KEY(household_id,entity_id) REFERENCES home_assistant_control_entities(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE,
  CHECK(can_read OR can_turn_on OR can_turn_off OR can_open)
);

CREATE TABLE home_assistant_control_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  actor_kind text NOT NULL CHECK(actor_kind IN ('member','display')),
  actor_id uuid NOT NULL,
  session_id uuid,
  credential_hash text,
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK(action='cover.open_cover'),
  entity_revision integer NOT NULL CHECK(entity_revision>0),
  grant_revision integer NOT NULL CHECK(grant_revision>0),
  display_policy_revision integer,
  connection_revision integer NOT NULL CHECK(connection_revision>0),
  sync_generation integer NOT NULL CHECK(sync_generation>0),
  provider_config_revision integer NOT NULL CHECK(provider_config_revision>=0),
  origin_hash text NOT NULL CHECK(origin_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(household_id,entity_id) REFERENCES home_assistant_control_entities(household_id,id) ON DELETE CASCADE,
  CHECK((actor_kind='member' AND session_id IS NOT NULL AND credential_hash IS NULL AND display_policy_revision IS NULL) OR
        (actor_kind='display' AND session_id IS NULL AND credential_hash ~ '^[a-f0-9]{64}$' AND display_policy_revision IS NOT NULL))
);
CREATE INDEX home_assistant_control_confirmations_expiry_idx ON home_assistant_control_confirmations(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE home_assistant_control_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  actor_kind text NOT NULL CHECK(actor_kind IN ('member','display')),
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('light.turn_on','light.turn_off','cover.open_cover')),
  status text NOT NULL DEFAULT 'dispatching' CHECK(status IN ('dispatching','accepted','reported','unknown')),
  observed_state text CHECK(observed_state IS NULL OR length(observed_state) BETWEEN 1 AND 64),
  error_code text CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  connection_revision integer NOT NULL CHECK(connection_revision>0),
  entity_revision integer NOT NULL CHECK(entity_revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(household_id,actor_kind,actor_id,idempotency_key),
  FOREIGN KEY(household_id,entity_id) REFERENCES home_assistant_control_entities(household_id,id) ON DELETE RESTRICT
);
CREATE INDEX home_assistant_control_dispatches_recent_idx ON home_assistant_control_dispatches(household_id,created_at DESC);

CREATE TRIGGER home_assistant_control_entities_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON home_assistant_control_entities FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER home_assistant_control_display_grants_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON home_assistant_control_display_grants FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
