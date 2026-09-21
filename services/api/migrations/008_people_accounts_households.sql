-- Additive person/account/household improvements. Existing explicit locale values are retained.
ALTER TABLE installations ALTER COLUMN default_locale SET DEFAULT 'nb';
ALTER TABLE households ALTER COLUMN default_locale SET DEFAULT 'nb';
UPDATE installations SET default_locale='nb' WHERE claimed_at IS NULL;

ALTER TABLE households
  ADD COLUMN show_upcoming_birthday boolean NOT NULL DEFAULT false,
  ADD COLUMN data_kind text NOT NULL DEFAULT 'live'
    CHECK (data_kind IN ('live','synthetic','demo')),
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

UPDATE households h SET data_kind='demo'
FROM installations i
WHERE i.id=h.installation_id AND i.demo_mode=true;

UPDATE households h SET data_kind='synthetic'
WHERE h.data_kind='live' AND EXISTS (
  SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id
  WHERE m.household_id=h.id AND a.email_normalized LIKE '%@pilot.invalid'
);

ALTER TABLE persons
  ADD COLUMN birth_date date,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT persons_birth_date_reasonable CHECK (
    birth_date IS NULL OR (birth_date >= DATE '1900-01-01' AND birth_date <= CURRENT_DATE)
  );

ALTER TABLE accounts
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN password_changed_at timestamptz;

CREATE TABLE account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid NOT NULL REFERENCES installations(id),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  UNIQUE (household_id, account_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES memberships(household_id, account_id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX account_invitations_one_pending_idx
  ON account_invitations(account_id) WHERE accepted_at IS NULL;

CREATE TABLE local_bootstrap_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE CHECK (length(operation_key) BETWEEN 8 AND 128),
  installation_id uuid NOT NULL REFERENCES installations(id),
  source_household_id uuid NOT NULL REFERENCES households(id),
  live_household_id uuid NOT NULL REFERENCES households(id),
  owner_account_id uuid NOT NULL REFERENCES accounts(id),
  owner_invitation_id uuid NOT NULL REFERENCES account_invitations(id),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','finalized')),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  CHECK ((state='prepared' AND finalized_at IS NULL) OR (state='finalized' AND finalized_at IS NOT NULL)),
  UNIQUE (live_household_id)
);

CREATE TABLE local_bootstrap_members (
  transition_id uuid NOT NULL REFERENCES local_bootstrap_transitions(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES memberships(id),
  account_id uuid REFERENCES accounts(id),
  invitation_id uuid REFERENCES account_invitations(id),
  PRIMARY KEY (transition_id, membership_id)
);

-- Rollback (only if no application data depends on these columns/tables): drop the two
-- new tables, constraints/columns, then restore the old default. No down migration runs automatically.
