-- Creating an accountless household profile has fresh consent and durable
-- idempotency. Receipts deliberately do not reference persons so they survive
-- later profile deletion and can return the original redacted result.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:people:create',16,'write');

CREATE TABLE mcp_people_create_receipts (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- Keep the grant UUID as a historical namespace without a foreign key:
  -- revoking/removing a client must not erase household quota history.
  grant_id uuid NOT NULL,
  request_key_hash bytea NOT NULL CHECK (octet_length(request_key_hash)=32),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
  person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (grant_id, request_key_hash)
);
CREATE INDEX mcp_people_create_receipts_quota_idx ON mcp_people_create_receipts(household_id,created_at);
