-- Additive read capabilities for the safe household MCP tool subset.
-- Each family is separately consented; no wildcard or implied write access.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk) VALUES
  ('mcp:people:read',2,'read'),
  ('mcp:groceries:read',2,'read'),
  ('mcp:dinners:read',2,'read');
