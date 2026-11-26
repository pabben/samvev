import { DomainError } from '@samvev/core';
import type { DbClient } from '../db.ts';
import { insertPersonRow } from '../people/profile-service.ts';
import type { HouseholdMcpPrincipal } from './household-tools.ts';

const MAX_NEW_PROFILES_24H = 20;

/** Receipt hashes depend on the persistent AI credential-vault key; operators
 * must keep the configured key stable and backed up across restores. */
/** The household row is the first lock: assignPersonColor takes the same
 * FOR UPDATE lock, so this avoids a SHARE-to-UPDATE lock upgrade deadlock.
 * Authority is rechecked after waiting on that lock. */
export async function createMcpPersonProfile(
  client: DbClient,
  principal: HouseholdMcpPrincipal,
  input: { displayName: string; requestKey: string },
  assertAuthority: () => Promise<void>,
  keyedDigest: (purpose: string, context: string, value: string) => Promise<Buffer>
): Promise<{ creation: { personId: string; createdRevision: 1; hadLoginAtCreation: false } }> {
  const household = await client.query('SELECT id FROM households WHERE id=$1 AND installation_id=$2 FOR UPDATE',
    [principal.householdId, principal.installationId]);
  if (!household.rowCount) throw new DomainError('FORBIDDEN', 403);
  await assertAuthority();

  const digestContext = `${principal.householdId}\0${principal.grantId}`;
  const requestKeyHash = await keyedDigest('mcp.people.create.request-key', digestContext, input.requestKey);
  const payloadHash = await keyedDigest('mcp.people.create.payload', digestContext, JSON.stringify({ displayName: input.displayName }));
  const prior = await client.query<{ payload_hash: Buffer; person_id: string }>(`SELECT payload_hash,person_id
    FROM mcp_people_create_receipts WHERE household_id=$1 AND grant_id=$2 AND request_key_hash=$3 FOR UPDATE`,
  [principal.householdId, principal.grantId, requestKeyHash]);
  // The receipt row may have been locked by a slow concurrent request. Check
  // token expiry and every live authority edge again after that wait.
  await assertAuthority();
  if (prior.rows[0]) {
    if (!prior.rows[0].payload_hash.equals(payloadHash)) throw new DomainError('CONFLICT', 409, { reason: 'request_key_payload_mismatch' });
    return { creation: { personId: prior.rows[0].person_id, createdRevision: 1, hadLoginAtCreation: false } };
  }

  const quota = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM mcp_people_create_receipts
    WHERE household_id=$1 AND created_at>clock_timestamp()-interval '24 hours'`, [principal.householdId]);
  if ((quota.rows[0]?.count ?? 0) >= MAX_NEW_PROFILES_24H) throw new DomainError('RATE_LIMITED', 429, { reason: 'household_profile_create_limit', max: MAX_NEW_PROFILES_24H });

  const person = await insertPersonRow(client, principal.householdId, { displayName: input.displayName, ageGroup: 'unspecified' });
  await client.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities)
    VALUES($1,NULL,$2,'limited','["household.view"]'::jsonb)`, [principal.householdId, person.id]);
  await client.query(`INSERT INTO mcp_people_create_receipts(household_id,grant_id,request_key_hash,payload_hash,person_id)
    VALUES($1,$2,$3,$4,$5)`, [principal.householdId, principal.grantId, requestKeyHash, payloadHash, person.id]);
  await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
    VALUES($1,$2,'mcp',$3,'mcp.person_profile_created','person',$4,'{"hasLogin":false,"ageGroup":"unspecified"}'::jsonb)`,
  [principal.installationId, principal.householdId, principal.grantId, person.id]);
  await assertAuthority();
  return { creation: { personId: person.id, createdRevision: 1, hadLoginAtCreation: false } };
}
