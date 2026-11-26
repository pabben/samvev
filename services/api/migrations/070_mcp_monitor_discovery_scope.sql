-- Discovery names can contain household or child data and require separate,
-- fresh consent. Existing grants and tokens are deliberately not widened.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:discover',15,'read');
