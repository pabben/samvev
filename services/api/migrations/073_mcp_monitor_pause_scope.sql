-- Pausing is a destructive lifecycle action that may withdraw generated
-- notices. Existing monitor-read grants deliberately receive no pause access.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:pause',18,'write');
