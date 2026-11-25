CREATE TABLE household_grocery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  checked boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  created_by_actor_type text NOT NULL CHECK (created_by_actor_type IN ('member','display')),
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id,id)
);
CREATE INDEX household_grocery_active_order_idx ON household_grocery_items(household_id,deleted_at,created_at,id);

CREATE TABLE household_dinner_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  emoji text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by_actor_type text NOT NULL CHECK (created_by_actor_type IN ('member','display')),
  created_by_actor_id uuid NOT NULL,
  UNIQUE (household_id,id)
);
CREATE INDEX household_dinner_options_active_order_idx ON household_dinner_options(household_id,deleted_at,title,id);

CREATE TABLE household_dinner_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  title_snapshot text,
  emoji_snapshot text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by_actor_type text NOT NULL CHECK (updated_by_actor_type IN ('member','display')),
  updated_by_actor_id uuid NOT NULL,
  CHECK ((title_snapshot IS NULL) = (emoji_snapshot IS NULL)),
  UNIQUE (household_id,local_date),
  UNIQUE (household_id,id),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);
CREATE INDEX household_dinner_assignments_range_idx ON household_dinner_assignments(household_id,local_date,id) WHERE deleted_at IS NULL;

CREATE TABLE household_board_requests (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('member','display')),
  actor_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (household_id,actor_type,actor_id,request_key)
);

CREATE TABLE display_board_read_grants (
  household_id uuid NOT NULL,
  display_id uuid NOT NULL,
  grocery_read boolean NOT NULL DEFAULT false,
  dinner_read boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (display_id),
  FOREIGN KEY (household_id,display_id) REFERENCES display_action_policies(household_id,display_id) ON DELETE CASCADE
);
INSERT INTO display_board_read_grants(household_id,display_id)
SELECT household_id,display_id FROM display_action_policies;

CREATE FUNCTION create_display_board_read_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO display_board_read_grants(household_id,display_id) VALUES(NEW.household_id,NEW.display_id)
    ON CONFLICT(display_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER display_action_policy_board_read_grant
AFTER INSERT ON display_action_policies FOR EACH ROW EXECUTE FUNCTION create_display_board_read_grant();

CREATE TRIGGER household_grocery_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON household_grocery_items FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER household_dinner_options_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON household_dinner_options FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER household_dinner_assignments_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON household_dinner_assignments FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_board_read_grants_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_board_read_grants FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
