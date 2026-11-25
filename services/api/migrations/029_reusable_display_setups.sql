CREATE TABLE display_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  cards jsonb NOT NULL DEFAULT '["household_messages","family_layout","external_items"]'::jsonb
    CHECK (jsonb_typeof(cards)='array' AND jsonb_array_length(cards)<=13),
  card_order jsonb NOT NULL DEFAULT '["household_messages","family_layout","external_items"]'::jsonb
    CHECK (jsonb_typeof(card_order)='array' AND jsonb_array_length(card_order)<=13),
  family_layout_enabled boolean NOT NULL DEFAULT true,
  all_sources boolean NOT NULL DEFAULT false,
  all_sensors boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  album_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(album_ids)='array' AND jsonb_array_length(album_ids)<=100),
  background_id uuid,
  locale text NOT NULL CHECK (locale IN ('en','nb')),
  theme text NOT NULL CHECK (theme IN ('light','dark','system')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id,id)
);
CREATE UNIQUE INDEX display_setups_one_default_per_household_idx
  ON display_setups(household_id) WHERE is_default;

CREATE TABLE display_setup_people (
  household_id uuid NOT NULL,
  setup_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY (setup_id,person_id),
  FOREIGN KEY (household_id,setup_id) REFERENCES display_setups(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);

CREATE TABLE display_setup_sources (
  household_id uuid NOT NULL,
  setup_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  PRIMARY KEY (setup_id,connection_id),
  FOREIGN KEY (household_id,setup_id) REFERENCES display_setups(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,connection_id) REFERENCES integration_connections(household_id,id) ON DELETE CASCADE
);

CREATE TABLE display_setup_calendar_sources (
  household_id uuid NOT NULL,
  setup_id uuid NOT NULL,
  source_id uuid NOT NULL,
  PRIMARY KEY (setup_id,source_id),
  FOREIGN KEY (household_id,setup_id) REFERENCES display_setups(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,source_id) REFERENCES calendar_sources(household_id,id) ON DELETE CASCADE
);

CREATE TABLE display_setup_sensors (
  household_id uuid NOT NULL,
  setup_id uuid NOT NULL,
  sensor_id uuid NOT NULL,
  PRIMARY KEY (setup_id,sensor_id),
  FOREIGN KEY (household_id,setup_id) REFERENCES display_setups(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,sensor_id) REFERENCES home_assistant_temperature_sensors(household_id,id) ON DELETE CASCADE
);

ALTER TABLE displays
  ADD COLUMN setup_id uuid,
  ALTER COLUMN locale DROP NOT NULL,
  ALTER COLUMN theme DROP NOT NULL;

CREATE TEMP TABLE _display_setup_backfill ON COMMIT DROP AS
  SELECT d.id AS display_id, gen_random_uuid() AS setup_id, d.household_id, d.locale, d.theme, d.name
  FROM displays d;

INSERT INTO display_setups(id,household_id,name,locale,theme)
SELECT setup_id,household_id,left(name || ' setup',80),locale,theme
FROM _display_setup_backfill;

UPDATE displays d SET setup_id=b.setup_id
FROM _display_setup_backfill b WHERE b.display_id=d.id;

ALTER TABLE displays ALTER COLUMN setup_id SET NOT NULL;
ALTER TABLE displays ADD CONSTRAINT displays_setup_household_fk
  FOREIGN KEY (household_id,setup_id) REFERENCES display_setups(household_id,id);
CREATE INDEX displays_setup_idx ON displays(setup_id);

CREATE FUNCTION assign_legacy_display_setup() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  household_locale text;
BEGIN
  IF NEW.setup_id IS NULL THEN
    SELECT default_locale INTO household_locale FROM households WHERE id=NEW.household_id;
    IF household_locale IS NULL THEN
      RAISE EXCEPTION 'display household does not exist';
    END IF;
    INSERT INTO display_setups(household_id,name,locale,theme,all_sources,all_sensors)
      VALUES(NEW.household_id,left(NEW.name || ' setup',80),COALESCE(NEW.locale,household_locale),COALESCE(NEW.theme,'system'),true,true)
      RETURNING id INTO NEW.setup_id;
    INSERT INTO display_setup_people(household_id,setup_id,person_id)
      SELECT NEW.household_id,NEW.setup_id,person.id FROM persons person WHERE person.household_id=NEW.household_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER displays_legacy_setup_before_insert
  BEFORE INSERT ON displays FOR EACH ROW EXECUTE FUNCTION assign_legacy_display_setup();

CREATE TABLE display_person_grants (
  household_id uuid NOT NULL,
  display_id uuid NOT NULL,
  person_id uuid NOT NULL,
  profile_allowed boolean NOT NULL DEFAULT false,
  birthday_allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (display_id,person_id),
  CHECK (profile_allowed OR birthday_allowed),
  FOREIGN KEY (household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);

-- Existing device layout selection is copied as presentation configuration;
-- the existing device grants remain attached only to the original device.
INSERT INTO display_setup_people(household_id,setup_id,person_id)
SELECT d.household_id,d.setup_id,p.id FROM displays d JOIN persons p ON p.household_id=d.household_id;

INSERT INTO display_setup_sources(household_id,setup_id,connection_id)
SELECT d.household_id,d.setup_id,g.connection_id
FROM displays d JOIN integration_connection_display_grants g
  ON g.household_id=d.household_id AND g.display_id=d.id;

INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id)
SELECT DISTINCT d.household_id,d.setup_id,source.id
FROM displays d
JOIN integration_connection_display_grants grant_row ON grant_row.household_id=d.household_id AND grant_row.display_id=d.id
JOIN calendar_connections calendar ON calendar.integration_connection_id=grant_row.connection_id AND calendar.household_id=d.household_id
JOIN calendar_sources source ON source.household_id=calendar.household_id AND source.connection_id=calendar.id;

INSERT INTO display_setup_sensors(household_id,setup_id,sensor_id)
SELECT d.household_id,d.setup_id,t.sensor_id
FROM displays d JOIN home_assistant_temperature_display_targets t
  ON t.household_id=d.household_id AND t.display_id=d.id;

CREATE TRIGGER display_setups_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_setups FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_setup_people_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_setup_people FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_setup_sources_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_setup_sources FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_setup_calendar_sources_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_setup_calendar_sources FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_setup_sensors_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_setup_sensors FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER display_person_grants_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON display_person_grants FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
