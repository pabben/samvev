-- Run only after stopping clients and draining the current API and workers.
-- This transaction removes native calendar authority. It retains appointments,
-- their readers, receipts, audit history, and all unrelated OAuth permissions.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE native_calendar_rollback_grants ON COMMIT DROP AS
SELECT grant_row.id,
       CASE WHEN jsonb_array_length((grant_row.scopes - 'mcp:calendar:write') - 'offline_access') > 0
            THEN grant_row.scopes - 'mcp:calendar:write' END AS remaining_scopes
FROM mcp_oauth_grants grant_row
WHERE grant_row.scopes ? 'mcp:calendar:write'
   OR EXISTS (SELECT 1 FROM mcp_oauth_grant_resources resource
              WHERE resource.grant_id=grant_row.id AND resource.resource_kind='native_calendar');

UPDATE mcp_oauth_grants grant_row
SET scopes=affected.remaining_scopes,
    revision=grant_row.revision+1,updated_at=clock_timestamp()
FROM native_calendar_rollback_grants affected
WHERE grant_row.id=affected.id AND affected.remaining_scopes IS NOT NULL;

UPDATE mcp_oauth_grants grant_row
SET revoked_at=clock_timestamp(),revision=grant_row.revision+1,updated_at=clock_timestamp()
FROM native_calendar_rollback_grants affected
WHERE grant_row.id=affected.id AND affected.remaining_scopes IS NULL AND grant_row.revoked_at IS NULL;

UPDATE mcp_oauth_token_sets token_set
SET revoked_at=clock_timestamp()
FROM native_calendar_rollback_grants affected
WHERE token_set.grant_id=affected.id AND token_set.revoked_at IS NULL;

UPDATE mcp_oauth_authorization_codes authorization_code
SET consumed_at=clock_timestamp()
FROM native_calendar_rollback_grants affected
WHERE authorization_code.grant_id=affected.id AND authorization_code.consumed_at IS NULL;

DELETE FROM mcp_oauth_grant_resources WHERE resource_kind='native_calendar';

UPDATE integration_connections SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
WHERE native_calendar AND revoked_at IS NULL;

UPDATE mcp_oauth_scope_catalog SET active=false WHERE scope='mcp:calendar:write';
COMMIT;
