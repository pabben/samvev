-- Approved sources bind a person and exact class page to one stable integration connection.
CREATE TABLE school_plan_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  person_id uuid NOT NULL,
  class_key text NOT NULL CHECK (class_key ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  source_page_url text NOT NULL CHECK (length(source_page_url) BETWEEN 9 AND 2048 AND source_page_url LIKE 'https://%'),
  display_pdf_links_allowed boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  UNIQUE (household_id, person_id, class_key, source_page_url),
  UNIQUE (household_id, connection_id, person_id, id),
  FOREIGN KEY (household_id, connection_id) REFERENCES integration_connections(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, person_id) REFERENCES persons(household_id,id) ON DELETE CASCADE
);

CREATE TABLE school_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  person_id uuid NOT NULL,
  source_id uuid NOT NULL,
  iso_year integer NOT NULL CHECK (iso_year BETWEEN 1900 AND 9998),
  iso_week integer NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  week_starts_on date NOT NULL,
  week_ends_on date NOT NULL,
  content_locale text NOT NULL CHECK (content_locale IN ('en','nb')),
  days jsonb NOT NULL CHECK (jsonb_typeof(days)='array' AND jsonb_array_length(days) BETWEEN 1 AND 7 AND octet_length(days::text)<=131072),
  pdf_url text CHECK (pdf_url IS NULL OR (length(pdf_url) BETWEEN 9 AND 2048 AND pdf_url LIKE 'https://%')),
  pdf_status text GENERATED ALWAYS AS (CASE WHEN pdf_url IS NULL THEN 'missing' ELSE 'unverified_link' END) STORED,
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 160),
  uncertainty text NOT NULL CHECK (uncertainty IN ('low','medium','high','unknown')),
  observed_at timestamptz NOT NULL,
  interpreted_at timestamptz NOT NULL CHECK (interpreted_at>=observed_at),
  last_source_observed_at timestamptz NOT NULL CHECK (last_source_observed_at>=observed_at),
  last_checked_at timestamptz NOT NULL CHECK (last_checked_at>=last_source_observed_at),
  source_error text CHECK (source_error IN ('unavailable','timeout','access_denied','document_missing','document_unreadable','wrong_class','unverified_content')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  content_revision integer NOT NULL DEFAULT 1 CHECK (content_revision BETWEEN 1 AND revision),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (EXTRACT(ISODOW FROM week_starts_on)=1 AND week_ends_on=week_starts_on+6),
  CHECK (EXTRACT(ISOYEAR FROM week_starts_on)=iso_year AND EXTRACT(WEEK FROM week_starts_on)=iso_week),
  CHECK (source_error IS NOT NULL OR last_checked_at=last_source_observed_at),
  UNIQUE (source_id,iso_year,iso_week),
  UNIQUE (household_id,id),
  FOREIGN KEY (household_id, connection_id, person_id, source_id)
    REFERENCES school_plan_sources(household_id,connection_id,person_id,id) ON DELETE CASCADE
);
CREATE INDEX school_plans_connection_weeks_idx ON school_plans(household_id,connection_id,week_starts_on DESC,id);
CREATE INDEX school_plans_household_weeks_idx ON school_plans(household_id,week_starts_on DESC,id);

CREATE TABLE school_plan_display_targets (
  household_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY (plan_id,display_id),
  FOREIGN KEY (household_id, plan_id) REFERENCES school_plans(household_id,id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, display_id) REFERENCES displays(household_id,id) ON DELETE CASCADE
);
CREATE INDEX school_plan_display_targets_display_idx ON school_plan_display_targets(household_id,display_id,plan_id);

CREATE TRIGGER school_plan_sources_projection_notify AFTER INSERT OR UPDATE OR DELETE ON school_plan_sources
  FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER school_plans_projection_notify AFTER INSERT OR UPDATE OR DELETE ON school_plans
  FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER school_plan_displays_projection_notify AFTER INSERT OR UPDATE OR DELETE ON school_plan_display_targets
  FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
