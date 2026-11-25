ALTER TABLE displays ADD COLUMN credential_generation integer NOT NULL DEFAULT 1 CHECK (credential_generation>0);
ALTER TABLE pairing_requests ADD COLUMN expected_credential_generation integer CHECK (expected_credential_generation>0);
UPDATE pairing_requests request SET expected_credential_generation=device.credential_generation
  FROM displays device WHERE request.display_id=device.id AND request.approved_at IS NOT NULL AND request.redeemed_at IS NULL;
CREATE TRIGGER displays_credentials_projection_notify
  AFTER UPDATE OF credential_hash,credential_generation,credential_expires_at ON displays
  FOR EACH ROW WHEN (OLD.credential_hash IS DISTINCT FROM NEW.credential_hash
    OR OLD.credential_generation IS DISTINCT FROM NEW.credential_generation
    OR OLD.credential_expires_at IS DISTINCT FROM NEW.credential_expires_at)
  EXECUTE FUNCTION notify_display_projection();
