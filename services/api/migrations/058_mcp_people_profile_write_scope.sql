-- Profile edits are distinct from read access and require people.manage plus
-- an exact person grant. The tool never mutates accounts or memberships.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:people:write',6,'write');
