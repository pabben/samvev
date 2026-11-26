-- Existing grants do not gain permission to review stored monitor results.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:review',11,'write');
