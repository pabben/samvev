-- Round 6: preserve rotated ChatGPT credentials while their signed identity is
-- temporarily unverifiable, and reject invalid negative price snapshots.

ALTER TABLE ai_chatgpt_registrations
  DROP CONSTRAINT ai_chatgpt_registrations_status_check,
  ADD CONSTRAINT ai_chatgpt_registrations_status_check CHECK (
    status IN (
      'connected', 'pending_validation', 'reauthorization_required',
      'usage_limited', 'not_eligible', 'disconnected',
      'revocation_unconfirmed'
    )
  );

ALTER TABLE ai_rate_snapshots
  ADD CONSTRAINT ai_rate_snapshots_nonnegative_rates CHECK (
    input_rate >= 0 AND input_rate <> 'NaN'::numeric AND
    cached_input_rate >= 0 AND cached_input_rate <> 'NaN'::numeric AND
    cache_write_rate >= 0 AND cache_write_rate <> 'NaN'::numeric AND
    output_rate >= 0 AND output_rate <> 'NaN'::numeric
  ) NOT VALID;

-- Both changes are additive to retained records. A code rollback may leave
-- pending_validation rows blocked from dispatch until this version returns;
-- do not discard their encrypted rotated credential candidate. Keep the
-- nonnegative-rate constraint during rollback.
