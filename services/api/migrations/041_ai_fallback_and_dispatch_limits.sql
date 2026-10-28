-- Explicit household opt-in; existing tasks, schedules and instructions are unchanged.
ALTER TABLE ai_settings
  ADD COLUMN fallback_provider text CHECK(fallback_provider IS NULL OR fallback_provider IN ('openai','anthropic','openai_compatible')),
  ADD COLUMN fallback_configuration_revision integer CHECK(fallback_configuration_revision IS NULL OR fallback_configuration_revision>0),
  ADD COLUMN daily_dispatch_limit integer CHECK(daily_dispatch_limit IS NULL OR daily_dispatch_limit BETWEEN 1 AND 1000000);
-- Distinctness is enforced atomically by settings service after a primary switch.
ALTER TABLE monitor_executions
  ADD COLUMN ai_provider_configuration_revision integer,
  ADD COLUMN fallback_provider_snapshot text,
  ADD COLUMN fallback_configuration_revision integer;
ALTER TABLE ai_usage_events
  ADD COLUMN configuration_revision integer,
  ADD COLUMN fallback_from_provider text,
  ADD COLUMN fallback_reason text CHECK(fallback_reason IS NULL OR fallback_reason IN ('transient','network_error','provider_rate_limited'));
