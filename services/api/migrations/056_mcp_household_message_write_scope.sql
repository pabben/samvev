-- Creating a message is a separate write consent from listing messages.
-- Person and display recipients remain independently selected OAuth resources.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:messages:write',5,'write');
