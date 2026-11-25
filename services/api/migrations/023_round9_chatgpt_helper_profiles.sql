-- Round 9: stable, token-free identifiers for the browser-side ChatGPT helper.

CREATE TABLE ai_chatgpt_helper_profiles (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ext_agent_host_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(household_id,account_id),
  UNIQUE(ext_agent_host_id)
);

-- This table contains no credentials and can remain during an application rollback.
