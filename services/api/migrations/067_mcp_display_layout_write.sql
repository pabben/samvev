-- Existing OAuth grants retain their scopes. A client needs fresh consent
-- before it can change the layout of an explicitly approved display.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:displays:layout:write',13,'write');

-- Separate a display's assignment history from the reusable setup revision
-- and the device appearance revision. Browser assignments use the same fence.
ALTER TABLE displays ADD COLUMN setup_assignment_revision bigint NOT NULL DEFAULT 1
  CHECK (setup_assignment_revision > 0);

CREATE FUNCTION bump_display_setup_assignment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.setup_assignment_revision := OLD.setup_assignment_revision + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER display_setup_assignment_revision
  BEFORE UPDATE OF setup_id ON displays
  FOR EACH ROW WHEN (OLD.setup_id IS DISTINCT FROM NEW.setup_id)
  EXECUTE FUNCTION bump_display_setup_assignment_revision();
