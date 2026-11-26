-- A snapshot belongs to the exact source URL and content revision downloaded.
-- Store one bounded original per plan. Delivery rechecks consent and revision.
CREATE TABLE school_plan_pdf_snapshots (
  household_id uuid NOT NULL,
  plan_id uuid PRIMARY KEY,
  plan_content_revision integer NOT NULL CHECK (plan_content_revision>0),
  pdf_url text NOT NULL CHECK (length(pdf_url) BETWEEN 9 AND 2048 AND pdf_url LIKE 'https://%'),
  bytes bytea NOT NULL,
  byte_size integer GENERATED ALWAYS AS (octet_length(bytes)) STORED,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (byte_size BETWEEN 16 AND 5242880),
  CHECK (substring(bytes FOR 5)=decode('255044462d','hex')),
  CHECK (sha256=encode(digest(bytes,'sha256'),'hex')),
  FOREIGN KEY (household_id,plan_id) REFERENCES school_plans(household_id,id) ON DELETE CASCADE
);

CREATE INDEX school_plan_pdf_snapshots_household_idx ON school_plan_pdf_snapshots(household_id);
CREATE TRIGGER school_plan_pdf_projection_notify AFTER INSERT OR UPDATE OR DELETE ON school_plan_pdf_snapshots
  FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
