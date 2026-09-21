CREATE TABLE ai_settings (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai','chatgpt_subscription','openai_compatible','gemini')),
  api_key_ciphertext text,
  default_model text NOT NULL DEFAULT '' CHECK (length(default_model) <= 100),
  strong_model text NOT NULL DEFAULT '' CHECK (length(strong_model) <= 100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  availability_status text NOT NULL DEFAULT 'not_tested' CHECK (availability_status IN ('not_tested','available','unavailable','error')),
  availability_error_code text,
  availability_checked_at timestamptz,
  availability_checked_revision integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (availability_checked_revision IS NULL OR availability_checked_revision > 0)
);

INSERT INTO ai_settings(household_id)
SELECT id FROM households
ON CONFLICT DO NOTHING;

CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','chatgpt_subscription','openai_compatible','gemini')),
  model text,
  operation text NOT NULL CHECK (operation IN ('generate','extract','classify','plan')),
  purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 128),
  success boolean NOT NULL,
  failure_code text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((success AND failure_code IS NULL) OR (NOT success AND failure_code IS NOT NULL))
);

CREATE INDEX ai_usage_household_time_idx ON ai_usage_events(household_id, occurred_at DESC);
