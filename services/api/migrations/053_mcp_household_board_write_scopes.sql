-- Additive write capabilities for the bounded MCP household board tools.
-- Read consent remains separately required because mutations return the
-- authoritative item or assignment.
INSERT INTO mcp_oauth_scope_catalog(scope,introduced_version,risk) VALUES
  ('mcp:groceries:write',3,'write'),
  ('mcp:dinners:write',3,'write');

-- Dinner assignment was created before delegated integration actors existed.
-- The MCP adapter uses the same transaction-scoped delegated actor path as the
-- existing board service; its live authority is still the MCP grant, not an
-- integration credential.
ALTER TABLE household_dinner_assignments DROP CONSTRAINT household_dinner_assignments_updated_by_actor_type_check;
ALTER TABLE household_dinner_assignments ADD CONSTRAINT household_dinner_assignments_updated_by_actor_type_check
  CHECK(updated_by_actor_type IN ('member','display','integration'));
