ALTER TABLE messages ADD COLUMN request_hash text;

CREATE TRIGGER displays_projection_notify
AFTER UPDATE OF privacy_mode, revoked_at, locale, theme ON displays
FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
