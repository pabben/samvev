ALTER TABLE messages ALTER COLUMN author_membership_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN author_display_id uuid;
ALTER TABLE messages ADD COLUMN author_display_name text;
ALTER TABLE messages ADD CONSTRAINT messages_one_author_check CHECK (
  (author_membership_id IS NOT NULL AND author_display_id IS NULL AND author_display_name IS NULL) OR
  (author_membership_id IS NULL AND author_display_id IS NOT NULL AND author_display_name IS NOT NULL AND length(author_display_name) BETWEEN 1 AND 80)
);
ALTER TABLE messages ADD CONSTRAINT messages_display_author_household_fk
  FOREIGN KEY (household_id,author_display_id) REFERENCES displays(household_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX messages_display_idempotency_idx ON messages(author_display_id,idempotency_key) WHERE author_display_id IS NOT NULL;

ALTER TABLE message_lifecycle_events DROP CONSTRAINT message_lifecycle_events_actor_type_check;
ALTER TABLE message_lifecycle_events ADD CONSTRAINT message_lifecycle_events_actor_type_check
  CHECK (actor_type IN ('account','worker','system','display'));
ALTER TABLE message_lifecycle_events ADD COLUMN actor_display_name text;
ALTER TABLE message_lifecycle_events ADD CONSTRAINT message_lifecycle_display_actor_check
  CHECK ((actor_type='display' AND actor_id IS NOT NULL AND actor_display_name IS NOT NULL AND length(actor_display_name) BETWEEN 1 AND 80) OR
         (actor_type<>'display' AND actor_display_name IS NULL));

CREATE TABLE display_action_policies (
  household_id uuid NOT NULL,
  display_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  message_create boolean NOT NULL DEFAULT false,
  message_schedule boolean NOT NULL DEFAULT false,
  grocery_write boolean NOT NULL DEFAULT false,
  dinner_write boolean NOT NULL DEFAULT false,
  photo_upload boolean NOT NULL DEFAULT false,
  home_assistant_control boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(display_id),
  UNIQUE(household_id,display_id),
  FOREIGN KEY(household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);

CREATE TABLE display_action_people (
  household_id uuid NOT NULL,
  display_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY(display_id,person_id),
  FOREIGN KEY(household_id,display_id) REFERENCES display_action_policies(household_id,display_id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);

CREATE TABLE display_action_displays (
  household_id uuid NOT NULL,
  display_id uuid NOT NULL,
  recipient_display_id uuid NOT NULL,
  PRIMARY KEY(display_id,recipient_display_id),
  CHECK(display_id<>recipient_display_id),
  FOREIGN KEY(household_id,display_id) REFERENCES display_action_policies(household_id,display_id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,recipient_display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);

INSERT INTO display_action_policies(household_id,display_id)
SELECT household_id,id FROM displays ON CONFLICT(display_id) DO NOTHING;

CREATE FUNCTION create_display_action_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO display_action_policies(household_id,display_id) VALUES(NEW.household_id,NEW.id)
    ON CONFLICT(display_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER displays_default_action_policy_after_insert
AFTER INSERT ON displays FOR EACH ROW EXECUTE FUNCTION create_display_action_policy();

CREATE TRIGGER display_action_policies_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_action_policies FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_action_people_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_action_people FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_action_displays_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_action_displays FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
