ALTER TABLE account_invitations
  ADD COLUMN revoked_at timestamptz;

DROP INDEX account_invitations_one_pending_idx;
CREATE UNIQUE INDEX account_invitations_one_pending_idx
  ON account_invitations(account_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Rollback is safe only after confirming no rotated invitation history is
-- needed: drop the replacement index/column and recreate the 008 index.
