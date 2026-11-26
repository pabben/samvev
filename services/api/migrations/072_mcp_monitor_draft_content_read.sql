-- Sensitive draft instructions and source URLs require fresh, explicit consent.
-- Existing draft write/manage grants do not gain this permission.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:draft:content',17,'read');
