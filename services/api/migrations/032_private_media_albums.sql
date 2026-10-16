CREATE TABLE media_household_usage (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  asset_count integer NOT NULL DEFAULT 0 CHECK(asset_count>=0),
  stored_bytes bigint NOT NULL DEFAULT 0 CHECK(stored_bytes>=0),
  max_assets integer NOT NULL DEFAULT 250 CHECK(max_assets>0),
  max_bytes bigint NOT NULL DEFAULT 524288000 CHECK(max_bytes>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO media_household_usage(household_id) SELECT id FROM households;

CREATE TABLE media_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  album_kind text NOT NULL DEFAULT 'photos' CHECK(album_kind IN ('photos','backgrounds')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(household_id,id),
  FOREIGN KEY(household_id,owner_membership_id) REFERENCES memberships(household_id,id) ON DELETE CASCADE
);
CREATE INDEX media_albums_household_order_idx ON media_albums(household_id,created_at,id);

CREATE TABLE media_album_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  album_id uuid NOT NULL,
  membership_id uuid,
  household_wide boolean NOT NULL DEFAULT false,
  can_read boolean NOT NULL DEFAULT false,
  can_upload boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((household_wide AND membership_id IS NULL) OR (NOT household_wide AND membership_id IS NOT NULL)),
  CHECK(can_read OR can_upload OR can_manage),
  UNIQUE(household_id,id),
  FOREIGN KEY(household_id,album_id) REFERENCES media_albums(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,membership_id) REFERENCES memberships(household_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX media_album_one_household_grant_idx ON media_album_grants(album_id) WHERE household_wide;
CREATE UNIQUE INDEX media_album_member_grant_idx ON media_album_grants(album_id,membership_id) WHERE NOT household_wide;

CREATE TABLE media_album_display_grants (
  household_id uuid NOT NULL,
  album_id uuid NOT NULL,
  display_id uuid NOT NULL,
  can_read boolean NOT NULL DEFAULT false,
  can_upload boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(album_id,display_id),
  CHECK(can_read OR can_upload),
  FOREIGN KEY(household_id,album_id) REFERENCES media_albums(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  album_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
  original_mime text NOT NULL CHECK(original_mime IN ('image/jpeg','image/png','image/webp','image/avif','image/heif')),
  width integer NOT NULL CHECK(width>0 AND width<=12000),
  height integer NOT NULL CHECK(height>0 AND height<=12000),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  master_webp bytea NOT NULL,
  preview_webp bytea NOT NULL,
  stored_bytes bigint GENERATED ALWAYS AS (octet_length(master_webp)+octet_length(preview_webp)) STORED,
  created_by_membership_id uuid,
  created_by_display_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(household_id,id),
  CHECK((created_by_membership_id IS NOT NULL AND created_by_display_id IS NULL) OR (created_by_membership_id IS NULL AND created_by_display_id IS NOT NULL)),
  FOREIGN KEY(household_id,album_id) REFERENCES media_albums(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,created_by_membership_id) REFERENCES memberships(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY(household_id,created_by_display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);
CREATE INDEX media_assets_album_order_idx ON media_assets(household_id,album_id,created_at,id);

CREATE FUNCTION update_media_household_usage_from_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE media_household_usage SET asset_count=asset_count+1,stored_bytes=stored_bytes+NEW.stored_bytes,updated_at=clock_timestamp() WHERE household_id=NEW.household_id;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    UPDATE media_household_usage SET asset_count=asset_count-1,stored_bytes=stored_bytes-OLD.stored_bytes,updated_at=clock_timestamp() WHERE household_id=OLD.household_id;
    RETURN OLD;
  ELSE
    UPDATE media_household_usage SET stored_bytes=stored_bytes+NEW.stored_bytes-OLD.stored_bytes,updated_at=clock_timestamp() WHERE household_id=NEW.household_id;
    RETURN NEW;
  END IF;
END;
$$;
CREATE TRIGGER media_assets_household_usage
AFTER INSERT OR UPDATE OR DELETE ON media_assets
FOR EACH ROW EXECUTE FUNCTION update_media_household_usage_from_asset();

CREATE TABLE media_household_settings (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  background_asset_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO media_household_settings(household_id) SELECT id FROM households;

CREATE TRIGGER media_album_grants_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON media_album_display_grants FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER media_member_grants_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON media_album_grants FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER media_assets_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON media_assets FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER media_household_settings_projection_notify
AFTER INSERT OR UPDATE OR DELETE ON media_household_settings FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
