-- Round 5: explicit person avatars, per-route AI configuration, ChatGPT OSS
-- registrations, durable usage attempts and auditable pricing snapshots.

ALTER TABLE persons
  ADD COLUMN avatar_key text,
  ADD CONSTRAINT persons_avatar_key CHECK (
    avatar_key IS NULL OR avatar_key IN ('avatar-01','avatar-02','avatar-03','avatar-04','avatar-05','avatar-06')
  );

CREATE TABLE ai_provider_configurations (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','chatgpt_subscription','openai_compatible')),
  api_key_ciphertext text,
  base_url text CHECK (base_url IS NULL OR length(base_url)<=2048),
  default_model text NOT NULL DEFAULT '' CHECK (length(default_model)<=100),
  strong_model text NOT NULL DEFAULT '' CHECK (length(strong_model)<=100),
  default_reasoning_effort text NOT NULL DEFAULT 'none' CHECK (default_reasoning_effort IN ('none','low','medium','high')),
  strong_reasoning_effort text NOT NULL DEFAULT 'medium' CHECK (strong_reasoning_effort IN ('none','low','medium','high')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (household_id,provider)
);

INSERT INTO ai_provider_configurations(
  household_id,provider,api_key_ciphertext,base_url,default_model,strong_model,
  default_reasoning_effort,strong_reasoning_effort,revision,updated_at
)
SELECT household_id,provider,api_key_ciphertext,base_url,default_model,strong_model,
       default_reasoning_effort,strong_reasoning_effort,revision,updated_at
FROM ai_settings
WHERE provider IN ('openai','openai_compatible')
ON CONFLICT DO NOTHING;

CREATE TABLE ai_runtime_hosts (
  installation_id uuid PRIMARY KEY REFERENCES installations(id) ON DELETE CASCADE,
  ext_agent_host_id text NOT NULL UNIQUE CHECK (ext_agent_host_id ~ '^urn:uuid:[0-9a-f-]{36}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE ai_chatgpt_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  issuer text NOT NULL CHECK (issuer='https://auth.openai.com'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 500),
  email text CHECK (email IS NULL OR length(email)<=254),
  issued_client_id text NOT NULL CHECK (length(issued_client_id) BETWEEN 8 AND 300 AND issued_client_id<>'dynamic_agent_client'),
  granted_scopes text[] NOT NULL DEFAULT '{}',
  credential_ciphertext text,
  access_expires_at timestamptz,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','reauthorization_required','usage_limited','not_eligible','disconnected','revocation_unconfirmed')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation>0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (household_id,id),
  UNIQUE (household_id,owner_account_id,issuer,subject,issued_client_id),
  FOREIGN KEY (household_id,owner_membership_id) REFERENCES memberships(household_id,id)
);
CREATE INDEX ai_chatgpt_registrations_owner_idx ON ai_chatgpt_registrations(household_id,owner_account_id);

ALTER TABLE ai_settings
  ADD COLUMN active_chatgpt_registration_id uuid,
  ADD COLUMN usage_tracking_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD CONSTRAINT ai_settings_active_chatgpt_registration_fk
    FOREIGN KEY (household_id,active_chatgpt_registration_id)
    REFERENCES ai_chatgpt_registrations(household_id,id);

ALTER TABLE monitor_executions
  ADD COLUMN ai_registration_id uuid REFERENCES ai_chatgpt_registrations(id) ON DELETE SET NULL,
  ADD COLUMN ai_registration_generation integer CHECK (ai_registration_generation IS NULL OR ai_registration_generation>0);

ALTER TABLE monitor_tasks
  ADD COLUMN approved_ai_provider text CHECK (approved_ai_provider IS NULL OR approved_ai_provider IN ('openai','chatgpt_subscription','openai_compatible')),
  ADD COLUMN approved_ai_registration_id uuid REFERENCES ai_chatgpt_registrations(id) ON DELETE SET NULL,
  ADD COLUMN approved_ai_registration_generation integer CHECK (approved_ai_registration_generation IS NULL OR approved_ai_registration_generation>0);

CREATE TABLE ai_chatgpt_models (
  registration_id uuid NOT NULL REFERENCES ai_chatgpt_registrations(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 100),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  position integer NOT NULL CHECK (position>=0),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (registration_id,slug)
);

ALTER TABLE ai_usage_events
  ADD COLUMN attempt_id uuid,
  ADD COLUMN requested_model text CHECK (requested_model IS NULL OR length(requested_model)<=100),
  ADD COLUMN actual_model text CHECK (actual_model IS NULL OR length(actual_model)<=100),
  ADD COLUMN route text CHECK (route IS NULL OR route IN ('openai_api','chatgpt_plan','local')),
  ADD COLUMN category text CHECK (category IS NULL OR category IN ('normal','setup','test')),
  ADD COLUMN task_id uuid,
  ADD COLUMN task_revision integer CHECK (task_revision IS NULL OR task_revision>0),
  ADD COLUMN execution_id uuid,
  ADD COLUMN turn integer CHECK (turn IS NULL OR turn>0),
  ADD COLUMN phase text,
  ADD COLUMN actual_dispatch boolean,
  ADD COLUMN outcome text CHECK (outcome IS NULL OR outcome IN ('started','completed','failed','interrupted','preflight_rejected')),
  ADD COLUMN cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens>=0),
  ADD COLUMN cache_write_tokens integer CHECK (cache_write_tokens IS NULL OR cache_write_tokens>=0),
  ADD COLUMN reasoning_tokens integer CHECK (reasoning_tokens IS NULL OR reasoning_tokens>=0),
  ADD COLUMN actual_service_tier text CHECK (actual_service_tier IS NULL OR length(actual_service_tier)<=80),
  ADD COLUMN api_equivalent_assumption text CHECK (api_equivalent_assumption IS NULL OR length(api_equivalent_assumption)<=160),
  ADD COLUMN completed_at timestamptz;
ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_completion_check CHECK (
  (outcome='started' AND NOT success AND failure_code IS NULL AND completed_at IS NULL)
  OR (success AND failure_code IS NULL)
  OR (NOT success AND failure_code IS NOT NULL)
);
ALTER TABLE ai_usage_events
  ADD COLUMN owner_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN registration_id uuid REFERENCES ai_chatgpt_registrations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ai_usage_attempt_unique_idx ON ai_usage_events(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX ai_usage_household_route_time_idx ON ai_usage_events(household_id,route,occurred_at DESC);

CREATE TABLE ai_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL CHECK (route IN ('openai_api','chatgpt_plan')),
  model text NOT NULL,
  context_variant text NOT NULL CHECK (context_variant IN ('standard','long_context')),
  context_threshold_tokens integer,
  service_tier text CHECK (service_tier IS NULL OR length(service_tier)<=80),
  unit text NOT NULL CHECK (unit IN ('USD_PER_MILLION_TOKENS','CREDITS_PER_MILLION_TOKENS')),
  input_rate numeric(20,8) NOT NULL,
  cached_input_rate numeric(20,8) NOT NULL,
  cache_write_rate numeric(20,8) NOT NULL,
  output_rate numeric(20,8) NOT NULL,
  effective_from date,
  observed_at timestamptz NOT NULL,
  source_url text NOT NULL,
  UNIQUE NULLS NOT DISTINCT(route,model,context_variant,service_tier,effective_from,observed_at)
);
INSERT INTO ai_rate_snapshots(route,model,context_variant,context_threshold_tokens,service_tier,unit,input_rate,cached_input_rate,cache_write_rate,output_rate,effective_from,observed_at,source_url) VALUES
 ('openai_api','gpt-6.1-sol','standard',272000,'standard','USD_PER_MILLION_TOKENS',2,0.1,2.5,10,NULL,TIMESTAMPTZ '2026-10-04T09:00:00Z','https://developers.openai.com/api/docs/pricing'),
 ('openai_api','gpt-6.1-sol','long_context',272000,'standard','USD_PER_MILLION_TOKENS',4,0.2,5,15,NULL,TIMESTAMPTZ '2026-10-04T09:00:00Z','https://developers.openai.com/api/docs/pricing'),
 ('chatgpt_plan','gpt-6.1-sol','standard',NULL,NULL,'CREDITS_PER_MILLION_TOKENS',50,2.5,50,250,NULL,TIMESTAMPTZ '2026-10-04T09:00:00Z','https://learn.chatgpt.com/docs/pricing'),
 ('chatgpt_plan','gpt-6-sol','standard',NULL,NULL,'CREDITS_PER_MILLION_TOKENS',50,5,50,250,NULL,TIMESTAMPTZ '2026-10-04T09:00:00Z','https://learn.chatgpt.com/docs/pricing'),
 ('chatgpt_plan','gpt-6-luna','standard',NULL,NULL,'CREDITS_PER_MILLION_TOKENS',2.5,0.25,2.5,12.5,NULL,TIMESTAMPTZ '2026-10-04T09:00:00Z','https://learn.chatgpt.com/docs/pricing');

ALTER TABLE ai_usage_events ADD COLUMN rate_snapshot_id uuid REFERENCES ai_rate_snapshots(id);
ALTER TABLE ai_usage_events ADD COLUMN api_equivalent_rate_snapshot_id uuid REFERENCES ai_rate_snapshots(id);

CREATE OR REPLACE FUNCTION reject_ai_rate_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_rate_snapshots are append-only';
END $$;
CREATE TRIGGER ai_rate_snapshots_append_only
  BEFORE UPDATE OR DELETE ON ai_rate_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_ai_rate_snapshot_mutation();

-- Operational rollback preserves audit history and encrypted registrations:
-- disable the ChatGPT route, drain in-flight monitor executions, and revert the
-- application code. Keep this additive schema and its append-only rate history.
