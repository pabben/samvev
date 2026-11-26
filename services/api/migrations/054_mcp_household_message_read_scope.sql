-- Household messages have the same member recipient visibility as the web
-- route, with person recipients narrowed by the OAuth grant's exact resources.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:messages:read',4,'read');
