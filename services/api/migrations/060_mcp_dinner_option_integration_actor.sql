-- Permit delegated MCP board writes to be recorded as integration actors.
ALTER TABLE household_dinner_options DROP CONSTRAINT household_dinner_options_created_by_actor_type_check;
ALTER TABLE household_dinner_options ADD CONSTRAINT household_dinner_options_created_by_actor_type_check
  CHECK(created_by_actor_type IN ('member','display','integration'));
