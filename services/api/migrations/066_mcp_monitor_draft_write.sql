-- Delegated monitor creation is deliberately limited to inert, recipient-free
-- drafts and always requires the existing monitor read scope as well.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:draft:write',12,'write');

-- Keep a durable receipt even if a browser administrator later deletes the
-- draft. A replay of the same request key must never recreate deleted work.
CREATE TABLE mcp_monitor_draft_requests (
  household_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  task_id uuid NOT NULL,
  task_revision integer NOT NULL CHECK (task_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (grant_id,request_key),
  FOREIGN KEY (household_id,grant_id) REFERENCES mcp_oauth_grants(household_id,id) ON DELETE CASCADE
);
