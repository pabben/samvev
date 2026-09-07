CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  default_locale text NOT NULL DEFAULT 'en' CHECK (default_locale IN ('en','nb')),
  claimed_at timestamptz,
  claim_token_hash text,
  claim_expires_at timestamptz,
  setup_step text NOT NULL DEFAULT 'welcome',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((claimed_at IS NULL) = (claim_token_hash IS NOT NULL))
);

CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES installations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  timezone text NOT NULL,
  default_locale text NOT NULL CHECK (default_locale IN ('en','nb')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (installation_id, id)
);

CREATE TABLE persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  age_group text NOT NULL CHECK (age_group IN ('adult','teen','child','unspecified')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id, id)
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES installations(id),
  email_normalized text NOT NULL,
  password_hash text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en','nb')),
  theme text NOT NULL CHECK (theme IN ('light','dark','system')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (installation_id, email_normalized)
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  person_id uuid NOT NULL,
  role_preset text NOT NULL CHECK (role_preset IN ('installation_admin','household_admin','member','limited')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities) = 'array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id, person_id),
  UNIQUE (household_id, account_id),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, person_id) REFERENCES persons(household_id, id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sessions_account_active_idx ON sessions(account_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE displays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  locale text NOT NULL CHECK (locale IN ('en','nb')),
  theme text NOT NULL CHECK (theme IN ('light','dark','system')),
  privacy_mode boolean NOT NULL DEFAULT false,
  allowed_content text NOT NULL DEFAULT 'household_messages' CHECK (allowed_content = 'household_messages'),
  credential_hash text UNIQUE,
  credential_expires_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id, id)
);

CREATE TABLE membership_display_grants (
  household_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  display_id uuid NOT NULL,
  PRIMARY KEY (membership_id, display_id),
  FOREIGN KEY (household_id, membership_id) REFERENCES memberships(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, display_id) REFERENCES displays(household_id, id) ON DELETE CASCADE
);

CREATE TABLE pairing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  verifier_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  redeemed_at timestamptz,
  display_id uuid REFERENCES displays(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX pairing_live_code_idx ON pairing_requests(code_hash) WHERE redeemed_at IS NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  author_membership_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  importance text NOT NULL CHECK (importance IN ('normal','attention')),
  audience_household boolean NOT NULL DEFAULT false,
  publish_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','scheduled','published','cancelled','withdrawn','expired','failed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  idempotency_key text NOT NULL,
  published_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > publish_at),
  UNIQUE (author_membership_id, idempotency_key),
  UNIQUE (household_id, id)
  ,FOREIGN KEY (household_id, author_membership_id) REFERENCES memberships(household_id, id)
);
CREATE INDEX messages_due_idx ON messages (LEAST(publish_at, expires_at)) WHERE state IN ('scheduled','published');

CREATE TABLE message_person_audiences (
  household_id uuid NOT NULL,
  message_id uuid NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY (message_id, person_id),
  FOREIGN KEY (household_id, message_id) REFERENCES messages(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, person_id) REFERENCES persons(household_id, id) ON DELETE CASCADE
);

CREATE TABLE message_display_targets (
  household_id uuid NOT NULL,
  message_id uuid NOT NULL,
  display_id uuid NOT NULL,
  delivery_state text NOT NULL DEFAULT 'queued' CHECK (delivery_state IN ('queued','delivered','displayed','cancelled','expired','failed')),
  delivered_revision integer,
  delivered_at timestamptz,
  displayed_at timestamptz,
  failure_code text,
  PRIMARY KEY (message_id, display_id),
  FOREIGN KEY (household_id, message_id) REFERENCES messages(household_id, id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, display_id) REFERENCES displays(household_id, id) ON DELETE CASCADE
);

CREATE TABLE message_lifecycle_events (
  id bigserial PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  revision integer NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('account','worker','system')),
  actor_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE display_render_acks (
  id bigserial PRIMARY KEY,
  display_id uuid NOT NULL REFERENCES displays(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  rendered_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (display_id, message_id, revision),
  FOREIGN KEY (message_id, display_id) REFERENCES message_display_targets(message_id, display_id) ON DELETE CASCADE
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id),
  household_id uuid REFERENCES households(id),
  actor_type text NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE rate_limits (
  bucket text NOT NULL,
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (bucket, key_hash)
);

CREATE OR REPLACE FUNCTION notify_display_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('display_projection', COALESCE(NEW.household_id, OLD.household_id)::text);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER messages_projection_notify AFTER INSERT OR UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
CREATE TRIGGER targets_projection_notify AFTER INSERT OR UPDATE OR DELETE ON message_display_targets FOR EACH ROW EXECUTE FUNCTION notify_display_projection();
