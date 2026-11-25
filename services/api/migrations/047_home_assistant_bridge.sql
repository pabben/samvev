-- Additive native HA adapter: the existing connection remains the machine actor.
DO $$ DECLARE constraint_row record; BEGIN
  FOR constraint_row IN SELECT conname FROM pg_constraint WHERE conrelid='integration_credentials'::regclass
    AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%jsonb_array_length%' OR pg_get_constraintdef(oid) LIKE '%<@%') LOOP
    EXECUTE format('ALTER TABLE integration_credentials DROP CONSTRAINT %I',constraint_row.conname);
  END LOOP;
END $$;
ALTER TABLE integration_credentials ADD CONSTRAINT integration_credentials_capabilities_size_check
  CHECK(jsonb_array_length(capabilities) BETWEEN 1 AND 9);
ALTER TABLE integration_credentials ADD CONSTRAINT integration_credentials_capabilities_allowlist_check
  CHECK(capabilities <@ '["integration.items.read","integration.items.write","integration.items.delete","ha.groceries.read","ha.groceries.write","ha.messages.read","ha.messages.write","ha.calendar.read","ha.calendar.write"]'::jsonb);

CREATE TABLE integration_ha_sharing (
  household_id uuid NOT NULL,
  connection_id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  list_ids jsonb NOT NULL DEFAULT '[]' CHECK(list_ids <@ '["groceries"]'::jsonb AND jsonb_typeof(list_ids)='array'),
  household boolean NOT NULL DEFAULT false,
  person_ids uuid[] NOT NULL DEFAULT '{}',
  calendar_source_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(household_id,connection_id) REFERENCES integration_connections(household_id,id) ON DELETE CASCADE
);
CREATE TABLE integration_ha_requests (
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(connection_id,request_key),
  FOREIGN KEY(household_id,connection_id) REFERENCES integration_connections(household_id,id) ON DELETE CASCADE
);
ALTER TABLE household_grocery_items DROP CONSTRAINT household_grocery_items_created_by_actor_type_check;
ALTER TABLE household_grocery_items ADD CONSTRAINT household_grocery_items_created_by_actor_type_check CHECK(created_by_actor_type IN ('member','display','integration'));
ALTER TABLE household_board_requests DROP CONSTRAINT household_board_requests_actor_type_check;
ALTER TABLE household_board_requests ADD CONSTRAINT household_board_requests_actor_type_check CHECK(actor_type IN ('member','display','integration'));

ALTER TABLE messages ADD COLUMN author_integration_id uuid;
ALTER TABLE messages ADD COLUMN author_integration_name text;
ALTER TABLE messages ADD CONSTRAINT messages_integration_author_household_fk
  FOREIGN KEY(household_id,author_integration_id) REFERENCES integration_connections(household_id,id) ON DELETE RESTRICT;
ALTER TABLE messages DROP CONSTRAINT messages_one_author_check;
ALTER TABLE messages ADD CONSTRAINT messages_one_author_check CHECK(
  (author_membership_id IS NOT NULL AND author_display_id IS NULL AND author_display_name IS NULL AND author_integration_id IS NULL AND author_integration_name IS NULL) OR
  (author_membership_id IS NULL AND author_display_id IS NOT NULL AND author_display_name IS NOT NULL AND author_integration_id IS NULL AND author_integration_name IS NULL) OR
  (author_membership_id IS NULL AND author_display_id IS NULL AND author_display_name IS NULL AND author_integration_id IS NOT NULL AND author_integration_name IS NOT NULL AND length(author_integration_name) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX messages_integration_idempotency_idx ON messages(author_integration_id,idempotency_key) WHERE author_integration_id IS NOT NULL;
ALTER TABLE message_lifecycle_events DROP CONSTRAINT message_lifecycle_events_actor_type_check;
ALTER TABLE message_lifecycle_events ADD CONSTRAINT message_lifecycle_events_actor_type_check CHECK(actor_type IN ('account','worker','system','display','integration'));
CREATE TRIGGER integration_ha_sharing_projection_notify AFTER INSERT OR UPDATE OR DELETE ON integration_ha_sharing
  FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
