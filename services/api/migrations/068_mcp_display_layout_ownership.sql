-- Remember which layouts were created by delegated writes. Browser-created
-- setups and pre-existing clones remain reusable templates.
CREATE TABLE mcp_display_layout_ownership (
  setup_id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  display_id uuid NOT NULL,
  last_mcp_revision integer NOT NULL CHECK (last_mcp_revision > 0),
  FOREIGN KEY (household_id,setup_id) REFERENCES display_setups(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id,display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);
CREATE INDEX mcp_display_layout_ownership_display_idx ON mcp_display_layout_ownership(household_id,display_id);
