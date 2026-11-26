INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:displays:appearance:write',10,'write');

ALTER TABLE displays ADD COLUMN appearance_revision integer NOT NULL DEFAULT 1
  CHECK (appearance_revision > 0);

-- Appearance changes from either administration surface invalidate the same
-- precondition. Display activity and security state use their own lifecycles.
CREATE FUNCTION bump_display_appearance_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.appearance_revision := OLD.appearance_revision + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER display_appearance_revision
  BEFORE UPDATE OF name,locale,theme ON displays
  FOR EACH ROW
  WHEN ((OLD.name,OLD.locale,OLD.theme) IS DISTINCT FROM (NEW.name,NEW.locale,NEW.theme))
  EXECUTE FUNCTION bump_display_appearance_revision();
