-- Any prior birthday consent remains limited to its original people. Even an
-- old selection of every current person is not consent for future people.
ALTER TABLE displays ADD COLUMN birthday_mode text NOT NULL DEFAULT 'off'
  CHECK (birthday_mode IN ('off','all','legacy_selected'));
UPDATE displays device SET birthday_mode='legacy_selected'
  WHERE EXISTS(SELECT 1 FROM display_person_grants permission WHERE permission.display_id=device.id
    AND permission.household_id=device.household_id AND permission.birthday_allowed);
ALTER TABLE displays ADD COLUMN person_ids_override uuid[]
  CHECK (person_ids_override IS NULL OR cardinality(person_ids_override)<=100);
CREATE TRIGGER displays_presentation_projection_notify
  AFTER UPDATE OF birthday_mode,person_ids_override ON displays
  FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
