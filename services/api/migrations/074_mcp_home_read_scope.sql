-- Home is a composition scope, not an umbrella data grant. Every selected
-- section also requires its existing read scope and resource grants.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:home:read',19,'read');
