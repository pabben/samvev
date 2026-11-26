-- Editing/deleting delegated monitor drafts is a new, separately consented
-- lifecycle permission. Existing draft-write grants do not gain this scope.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:draft:manage',14,'write');
