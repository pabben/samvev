-- M3 External Intelligence: stable connections, scoped credentials and durable family-hub items.
ALTER TABLE displays
  ADD COLUMN external_items_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id, id)
);

CREATE TABLE integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash text NOT NULL UNIQUE,
  capabilities jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(capabilities) = 'array'),
  CHECK (jsonb_array_length(capabilities) BETWEEN 1 AND 3),
  CHECK (capabilities <@ '["integration.items.write","integration.items.delete","integration.items.read"]'::jsonb),
  UNIQUE (connection_id, id)
);
CREATE INDEX integration_credentials_connection_idx ON integration_credentials(connection_id);

CREATE TABLE integration_connection_display_grants (
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY (connection_id, display_id),
  FOREIGN KEY (household_id, connection_id) REFERENCES integration_connections(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, display_id) REFERENCES displays(household_id, id) ON DELETE CASCADE
);

CREATE TABLE integration_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('reminder','alert','event','summary','list','observation')),
  target_household boolean NOT NULL DEFAULT false,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  entries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) <= 40),
  priority text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  publish_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  expires_at timestamptz,
  source jsonb NOT NULL CHECK (jsonb_typeof(source) = 'object' AND octet_length(source::text) <= 4096),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at),
  CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  UNIQUE (connection_id, external_id),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, connection_id) REFERENCES integration_connections(household_id, id)
);
CREATE INDEX integration_items_home_idx
  ON integration_items(household_id, publish_at, expires_at, starts_at)
  WHERE status = 'active';

CREATE TABLE integration_item_person_targets (
  household_id uuid NOT NULL,
  item_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY (item_id, person_id),
  FOREIGN KEY (household_id, item_id) REFERENCES integration_items(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, person_id) REFERENCES persons(household_id, id) ON DELETE CASCADE
);

CREATE TABLE integration_item_display_targets (
  household_id uuid NOT NULL,
  item_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY (item_id, display_id),
  FOREIGN KEY (household_id, item_id) REFERENCES integration_items(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, display_id) REFERENCES displays(household_id, id) ON DELETE CASCADE
);

CREATE TRIGGER integration_items_projection_notify
AFTER INSERT OR UPDATE ON integration_items
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

CREATE TRIGGER integration_item_targets_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON integration_item_person_targets
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

CREATE TRIGGER integration_item_display_targets_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON integration_item_display_targets
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

CREATE TRIGGER integration_display_grants_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON integration_connection_display_grants
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

CREATE TRIGGER integration_connections_projection_notify
AFTER UPDATE OF revoked_at ON integration_connections
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

CREATE TRIGGER persons_home_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON persons
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

CREATE TRIGGER memberships_home_projection_notify
AFTER UPDATE OF capabilities, role_preset, person_id, account_id ON memberships
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();

DROP TRIGGER displays_projection_notify ON displays;
CREATE TRIGGER displays_projection_notify
AFTER UPDATE OF privacy_mode, revoked_at, locale, theme, external_items_enabled ON displays
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
