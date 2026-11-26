ALTER TABLE mcp_oauth_grant_resources
  DROP CONSTRAINT mcp_oauth_grant_resources_resource_kind_check;

ALTER TABLE mcp_oauth_grant_resources
  ADD CONSTRAINT mcp_oauth_grant_resources_resource_kind_check
  CHECK (resource_kind IN ('school_source','calendar_source'));

INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:calendar:read',5,'read');
