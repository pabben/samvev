-- A credentialless, server-owned source for native Samvev appointments.
ALTER TABLE integration_connections ADD COLUMN native_calendar boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX integration_connections_native_calendar_household
  ON integration_connections(household_id) WHERE native_calendar;

ALTER TABLE mcp_oauth_grant_resources
  DROP CONSTRAINT mcp_oauth_grant_resources_resource_kind_check,
  ADD CONSTRAINT mcp_oauth_grant_resources_resource_kind_check
    CHECK (resource_kind IN ('school_source','calendar_source') OR
           (resource_kind='native_calendar' AND resource_id=household_id));

INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:calendar:write',9,'write');

CREATE OR REPLACE FUNCTION validate_mcp_oauth_scopes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(NEW.scopes) <> 'array'
     OR jsonb_array_length(NEW.scopes) < 1
     OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(NEW.scopes))
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(NEW.scopes) requested(value)
       LEFT JOIN mcp_oauth_scope_catalog catalog ON catalog.scope=requested.value AND catalog.active
       WHERE catalog.scope IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid MCP OAuth scope set' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Store only IDs, revisions, and the original authority needed for safe replay.
CREATE TABLE mcp_native_calendar_requests (
  household_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  event_id uuid NOT NULL,
  event_revision integer NOT NULL CHECK (event_revision>0),
  person_ids uuid[] NOT NULL CHECK (cardinality(person_ids) BETWEEN 1 AND 100),
  PRIMARY KEY (grant_id,request_key),
  FOREIGN KEY (household_id,grant_id) REFERENCES mcp_oauth_grants(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,event_id) REFERENCES integration_items(household_id,id) ON DELETE CASCADE
);

CREATE FUNCTION reject_native_calendar_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM integration_connections source WHERE source.id=NEW.connection_id AND source.native_calendar) THEN
    RAISE EXCEPTION 'Samvev native calendar source is server-owned' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER native_calendar_no_integration_credentials
  BEFORE INSERT OR UPDATE OF connection_id ON integration_credentials
  FOR EACH ROW EXECUTE FUNCTION reject_native_calendar_authority();
CREATE TRIGGER native_calendar_no_display_grants
  BEFORE INSERT OR UPDATE OF connection_id ON integration_connection_display_grants
  FOR EACH ROW EXECUTE FUNCTION reject_native_calendar_authority();
CREATE TRIGGER native_calendar_no_ha_sharing
  BEFORE INSERT OR UPDATE OF connection_id ON integration_ha_sharing
  FOR EACH ROW EXECUTE FUNCTION reject_native_calendar_authority();
