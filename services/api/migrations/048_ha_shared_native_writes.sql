-- Existing connections keep their own-content-only write boundary.
ALTER TABLE integration_ha_sharing
  ADD COLUMN allow_shared_native_writes boolean NOT NULL DEFAULT false;

-- JSON metadata is producer-controlled. Native creation authority is not.
ALTER TABLE integration_items
  ADD COLUMN ha_native_origin boolean NOT NULL DEFAULT false;
UPDATE integration_items item SET ha_native_origin=true
WHERE item.kind='event' AND EXISTS (
  SELECT 1 FROM integration_ha_requests receipt
  WHERE receipt.household_id=item.household_id AND receipt.connection_id=item.connection_id
    AND receipt.response#>>'{event,id}'=item.id::text
    AND receipt.response#>>'{event,revision}'='1'
    AND receipt.response#>>'{event,source}'='samvev'
    AND jsonb_typeof(receipt.response#>'{event,summary}')='string'
);
