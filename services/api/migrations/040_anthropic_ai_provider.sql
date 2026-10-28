-- Anthropic Messages provider support. Pricing is deliberately not inferred;
-- Anthropic usage remains visible as token counts with no fabricated cost.

ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_provider_check;
ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_provider_check
  CHECK (provider IN ('openai','chatgpt_subscription','openai_compatible','gemini','anthropic'));

ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_provider_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_provider_check
  CHECK (provider IN ('openai','chatgpt_subscription','openai_compatible','gemini','anthropic'));

ALTER TABLE ai_provider_configurations DROP CONSTRAINT IF EXISTS ai_provider_configurations_provider_check;
ALTER TABLE ai_provider_configurations ADD CONSTRAINT ai_provider_configurations_provider_check
  CHECK (provider IN ('openai','chatgpt_subscription','openai_compatible','anthropic'));

ALTER TABLE monitor_tasks DROP CONSTRAINT IF EXISTS monitor_tasks_approved_ai_provider_check;
ALTER TABLE monitor_tasks ADD CONSTRAINT monitor_tasks_approved_ai_provider_check
  CHECK (approved_ai_provider IS NULL OR approved_ai_provider IN ('openai','chatgpt_subscription','openai_compatible','anthropic'));

ALTER TABLE monitor_executions DROP CONSTRAINT IF EXISTS monitor_executions_provider_snapshot_check;
ALTER TABLE monitor_executions ADD CONSTRAINT monitor_executions_provider_snapshot_check
  CHECK (provider_snapshot IN ('openai','openai_compatible','chatgpt_subscription','gemini','anthropic'));

ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_route_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_route_check
  CHECK (route IS NULL OR route IN ('openai_api','chatgpt_plan','local','anthropic_api'));
