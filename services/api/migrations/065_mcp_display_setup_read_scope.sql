-- Display setup reads are a distinct, freshly consented capability. The tool
-- returns only layout and appearance fields for an exact approved display.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk)
VALUES ('mcp:displays:setup:read',12,'read');
