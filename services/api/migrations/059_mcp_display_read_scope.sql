-- Display discovery exposes only exact nonrevoked display grants and a
-- minimal configuration projection; it is not a display credential scope.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:displays:read',7,'read');
