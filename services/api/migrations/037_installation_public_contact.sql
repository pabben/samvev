CREATE TABLE installation_public_contact_configs (
  installation_id uuid PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  operator_name text NOT NULL CHECK (length(btrim(operator_name)) BETWEEN 2 AND 160),
  postal_address text NOT NULL CHECK (length(btrim(postal_address)) BETWEEN 5 AND 500),
  contact_email text NOT NULL CHECK (length(btrim(contact_email)) BETWEEN 3 AND 254),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (contact_email = btrim(contact_email))
);
