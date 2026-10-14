-- Round 10: fence calendar OAuth attempts and repair safe derived calendar state.

ALTER TABLE calendar_oauth_sessions
  ADD COLUMN IF NOT EXISTS connection_generation integer;

-- Completion credentials created before the generation fence cannot be assigned
-- safely to a particular attempt. Invalidate only those legacy rows before the
-- backfill; a consent flow already in progress during upgrade must be restarted.
UPDATE calendar_oauth_sessions
SET consumed_at=COALESCE(consumed_at,clock_timestamp()),
    completion_hash=NULL,
    authorization_code_ciphertext=NULL
WHERE connection_generation IS NULL;

UPDATE calendar_oauth_sessions session
SET connection_generation=connection.sync_generation
FROM calendar_connections connection
WHERE connection.id=session.connection_id
  AND session.connection_generation IS NULL;

ALTER TABLE calendar_oauth_sessions
  ALTER COLUMN connection_generation SET DEFAULT 0;

ALTER TABLE calendar_oauth_sessions
  ALTER COLUMN connection_generation SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE calendar_oauth_sessions
    ADD CONSTRAINT calendar_oauth_sessions_generation_check CHECK (connection_generation>=0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS calendar_oauth_sessions_connection_generation_idx
  ON calendar_oauth_sessions(connection_id,connection_generation);

-- These fields are projections of the source configuration. Repair only active
-- occurrence-backed items and preserve every unrelated metadata member, ID,
-- target, grant and tombstone.
UPDATE integration_items item
SET metadata=COALESCE(item.metadata,'{}'::jsonb)||jsonb_build_object(
      'calendar',
      COALESCE(item.metadata->'calendar','{}'::jsonb)||jsonb_build_object(
        'bridgeKind',source.bridge_kind,
        'subjectHousehold',source.subject_household
      )
    ),
    revision=item.revision+1,
    updated_at=clock_timestamp()
FROM calendar_occurrences occurrence
JOIN calendar_sources source ON source.id=occurrence.source_id
WHERE occurrence.integration_item_id=item.id
  AND occurrence.status='active'
  AND item.status='active'
  AND (
    item.metadata#>'{calendar,bridgeKind}' IS DISTINCT FROM to_jsonb(source.bridge_kind)
    OR item.metadata#>'{calendar,subjectHousehold}' IS DISTINCT FROM to_jsonb(source.subject_household)
  );

-- Resume only clearly authorized Google/Microsoft connections which were left
-- connected with enabled sources but no schedule. Disabled sources remain off;
-- setup, error, expired, awaiting-consent and disconnected rows are untouched.
UPDATE calendar_connections connection
SET next_sync_at=clock_timestamp(),updated_at=clock_timestamp()
WHERE connection.provider IN ('google','microsoft')
  AND connection.state='connected'
  AND connection.disconnected_at IS NULL
  AND connection.next_sync_at IS NULL
  AND connection.credential_ciphertext IS NOT NULL
  AND connection.provider_subject_hash IS NOT NULL
  AND (connection.lease_token IS NULL OR connection.lease_expires_at<clock_timestamp())
  AND EXISTS(SELECT 1 FROM calendar_sources source WHERE source.connection_id=connection.id AND source.enabled)
  AND EXISTS(
    SELECT 1 FROM memberships membership
    JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
    WHERE membership.account_id=connection.owner_account_id
      AND membership.household_id=connection.household_id
      AND membership.capabilities ? 'household.manage'
  )
  AND EXISTS(
    SELECT 1 FROM integration_connections authority
    WHERE authority.id=connection.integration_connection_id
      AND authority.household_id=connection.household_id
      AND authority.revoked_at IS NULL
  );

-- Rollback is application-compatible: old code omits the additive generation
-- column and receives the fenced sentinel default. The metadata/schedule repair
-- is current derived state and is not destructively reversed.
