-- Monitor status permission deliberately excludes stored result content.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:monitors:content',8,'read');
