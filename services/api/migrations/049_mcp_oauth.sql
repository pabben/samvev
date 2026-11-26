-- Authenticated MCP resource server and first-party OAuth 2.1 authorization.
-- OAuth credentials are purpose-specific and are never shared with browser,
-- display or legacy integration credentials.

CREATE TABLE mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  client_id text NOT NULL UNIQUE CHECK (client_id ~ '^smcp_cl_[A-Za-z0-9_-]{32,128}$'),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 80),
  redirect_uris jsonb NOT NULL CHECK (
    jsonb_typeof(redirect_uris) = 'array'
    AND jsonb_array_length(redirect_uris) BETWEEN 1 AND 5
  ),
  token_endpoint_auth_method text NOT NULL DEFAULT 'none' CHECK (token_endpoint_auth_method = 'none'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (installation_id, id)
);
CREATE INDEX mcp_oauth_clients_installation_idx ON mcp_oauth_clients(installation_id) WHERE revoked_at IS NULL;

-- The catalog is the versioned extension point for additive domain tools.
-- No wildcard scope is seeded or issued. Adding a future tool family requires
-- an explicit catalog row and application authorization policy.
CREATE TABLE mcp_oauth_scope_catalog (
  scope text PRIMARY KEY CHECK (length(scope) BETWEEN 3 AND 120),
  introduced_version integer NOT NULL CHECK (introduced_version > 0),
  risk text NOT NULL CHECK (risk IN ('read','write','lifecycle')),
  active boolean NOT NULL DEFAULT true
);
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk) VALUES
  ('mcp:context',1,'read'),
  ('mcp:monitors:read',1,'read'),
  ('mcp:school-plans:read',1,'read'),
  ('mcp:school-plans:write',1,'write'),
  ('offline_access',1,'lifecycle');

CREATE FUNCTION validate_mcp_oauth_scopes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(NEW.scopes) <> 'array'
     OR jsonb_array_length(NEW.scopes) < 1
     OR jsonb_array_length(NEW.scopes) > 16
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

CREATE TABLE mcp_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL,
  client_id uuid NOT NULL,
  household_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  account_id uuid NOT NULL,
  scopes jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (client_id, membership_id),
  UNIQUE (household_id, id),
  FOREIGN KEY (installation_id, client_id) REFERENCES mcp_oauth_clients(installation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (installation_id, household_id) REFERENCES households(installation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, membership_id) REFERENCES memberships(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, account_id) REFERENCES memberships(household_id, account_id) ON DELETE CASCADE
);
CREATE INDEX mcp_oauth_grants_household_idx ON mcp_oauth_grants(household_id, created_at DESC);
CREATE TRIGGER mcp_oauth_grants_scopes_validate BEFORE INSERT OR UPDATE OF scopes ON mcp_oauth_grants
FOR EACH ROW EXECUTE FUNCTION validate_mcp_oauth_scopes();

-- OAuth scopes select an operation family. These tables independently narrow
-- which household resources a delegated client may touch. School read/write
-- remains default-deny when the corresponding rows are absent.
CREATE TABLE mcp_oauth_grant_people (
  household_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY (grant_id, person_id),
  FOREIGN KEY (household_id, grant_id) REFERENCES mcp_oauth_grants(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, person_id) REFERENCES persons(household_id, id) ON DELETE CASCADE
);

CREATE TABLE mcp_oauth_grant_displays (
  household_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY (grant_id, display_id),
  FOREIGN KEY (household_id, grant_id) REFERENCES mcp_oauth_grants(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, display_id) REFERENCES displays(household_id, id) ON DELETE CASCADE
);

CREATE TABLE mcp_oauth_grant_resources (
  household_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('school_source')),
  resource_id uuid NOT NULL,
  PRIMARY KEY (grant_id, resource_kind, resource_id),
  FOREIGN KEY (household_id, grant_id) REFERENCES mcp_oauth_grants(household_id, id) ON DELETE CASCADE
);

CREATE TABLE mcp_oauth_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) <= 2048),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text NOT NULL CHECK (length(resource) <= 2048),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_oauth_codes_expiry_idx ON mcp_oauth_authorization_codes(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE mcp_oauth_login_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_hash text NOT NULL UNIQUE CHECK (length(request_hash) = 64),
  login_csrf_hash text NOT NULL CHECK (length(login_csrf_hash) = 64),
  request_data jsonb NOT NULL CHECK (jsonb_typeof(request_data) = 'object' AND octet_length(request_data::text) <= 8192),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  resume_token_hash text UNIQUE CHECK (resume_token_hash IS NULL OR length(resume_token_hash) = 64),
  consent_csrf_hash text CHECK (consent_csrf_hash IS NULL OR length(consent_csrf_hash) = 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_oauth_login_requests_expiry_idx ON mcp_oauth_login_requests(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE mcp_oauth_token_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES mcp_oauth_token_sets(id) ON DELETE SET NULL,
  access_token_hash text NOT NULL UNIQUE CHECK (length(access_token_hash) = 64),
  refresh_token_hash text UNIQUE CHECK (refresh_token_hash IS NULL OR length(refresh_token_hash) = 64),
  scopes jsonb NOT NULL,
  resource text NOT NULL CHECK (length(resource) <= 2048),
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL))
);
CREATE INDEX mcp_oauth_access_active_idx ON mcp_oauth_token_sets(access_expires_at) WHERE revoked_at IS NULL;
CREATE INDEX mcp_oauth_refresh_active_idx ON mcp_oauth_token_sets(refresh_expires_at) WHERE refresh_token_hash IS NOT NULL AND revoked_at IS NULL AND rotated_at IS NULL;
CREATE TRIGGER mcp_oauth_token_sets_scopes_validate BEFORE INSERT OR UPDATE OF scopes ON mcp_oauth_token_sets
FOR EACH ROW EXECUTE FUNCTION validate_mcp_oauth_scopes();
