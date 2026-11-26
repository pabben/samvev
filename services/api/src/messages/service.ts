import { createHash } from 'node:crypto';
import { messageCreateSchema, type Capability } from '@samvev/contracts';
import { DomainError, initialMessageState, requireCapability } from '@samvev/core';
import { transaction, type DbClient } from '../db.ts';

export interface MessageCreateActor {
  accountId: string;
  installationId: string;
  householdId: string;
  membershipId: string;
  /** Present only for a delegated OAuth create; narrows person/display recipients to this exact grant. */
  mcpGrantId?: string;
}

export type MessageCreateTransaction = <T>(run: (client: DbClient) => Promise<T>) => Promise<T>;
export type MessageCreateAuthorize = (client: DbClient, actor: MessageCreateActor) => Promise<Capability[]>;
export type MessageWithdrawAudit = (client: DbClient, messageId: string, state: string) => Promise<void>;

function parseCreateInput(input: unknown) {
  const parsed = messageCreateSchema.safeParse(input);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 400, { fields: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) });
  return parsed.data;
}

/** Validate the recipient rules shared by message creation and other household message actions. */
export async function validateMessageAudience(
  client: DbClient,
  actor: Pick<MessageCreateActor, 'householdId' | 'membershipId' | 'mcpGrantId'>,
  capabilities: Capability[],
  personIds: string[],
  displayIds: string[],
  needsDisplayPublish = true
): Promise<void> {
  if (personIds.length) {
    const found = await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) FOR SHARE', [actor.householdId, personIds]);
    if (found.rowCount !== new Set(personIds).size) throw new DomainError('NOT_FOUND', 404);
    if (actor.mcpGrantId) {
      const granted = await client.query(`SELECT person_id FROM mcp_oauth_grant_people
        WHERE grant_id=$1 AND household_id=$2 AND person_id=ANY($3::uuid[]) FOR SHARE`, [actor.mcpGrantId, actor.householdId, personIds]);
      if (granted.rowCount !== new Set(personIds).size) throw new DomainError('FORBIDDEN', 403, { reason: 'mcp_message_person_not_granted' });
    }
  }
  if (!displayIds.length) return;

  if (needsDisplayPublish) requireCapability(capabilities, 'message.publish.display');
  const found = await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL FOR SHARE', [actor.householdId, displayIds]);
  if (found.rowCount !== new Set(displayIds).size) throw new DomainError('NOT_FOUND', 404);
  if (actor.mcpGrantId) {
    const granted = await client.query(`SELECT display_id FROM mcp_oauth_grant_displays
      WHERE grant_id=$1 AND household_id=$2 AND display_id=ANY($3::uuid[]) FOR SHARE`, [actor.mcpGrantId, actor.householdId, displayIds]);
    if (granted.rowCount !== new Set(displayIds).size) throw new DomainError('FORBIDDEN', 403, { reason: 'mcp_message_display_not_granted' });
  }
  if (!capabilities.includes('display.manage')) {
    const permitted = await client.query(`SELECT display_id FROM membership_display_grants
      WHERE household_id=$1 AND membership_id=$2 AND display_id=ANY($3::uuid[]) FOR SHARE`, [actor.householdId, actor.membershipId, displayIds]);
    if (permitted.rowCount !== new Set(displayIds).size) throw new DomainError('FORBIDDEN', 403);
  }
}

/**
 * Create a member-authored message after the caller rechecks its current
 * authority in this transaction. Both the web route and MCP use this lifecycle.
 */
export class MessageService {
  constructor(private readonly transact: MessageCreateTransaction = transaction) {}

  async create(actor: MessageCreateActor, input: unknown, authorize: MessageCreateAuthorize): Promise<Record<string, unknown>> {
    return this.transact(async (client) => {
      const capabilities = await authorize(client, actor);
      requireCapability(capabilities, 'message.create.household');
      const body = parseCreateInput(input);
      if (actor.mcpGrantId && body.audience.household) {
        throw new DomainError('FORBIDDEN', 403, { reason: 'mcp_message_household_audience_not_granted' });
      }
      const now = new Date();
      const publishAt = body.publishAt ? new Date(body.publishAt) : now;
      const expiresAt = new Date(body.expiresAt);
      const state = initialMessageState(publishAt, expiresAt, now);
      if (publishAt > now) requireCapability(capabilities, 'message.schedule');

      await validateMessageAudience(client, actor, capabilities, body.audience.personIds, body.audience.displayIds);
      const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const existing = await client.query<{ request_hash: string | null } & Record<string, unknown>>(`SELECT id,body,importance,audience_household,publish_at,expires_at,state,revision,request_hash
        FROM messages WHERE author_membership_id=$1 AND idempotency_key=$2`, [actor.membershipId, body.idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0]!.request_hash !== requestHash) throw new DomainError('CONFLICT', 409, { reason: 'idempotency_payload_mismatch' });
        const { request_hash: _requestHash, ...response } = existing.rows[0]!;
        return response;
      }

      const inserted = await client.query<{ id: string; revision: number }>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8='published' THEN clock_timestamp() END) RETURNING id,revision`,
      [actor.householdId, actor.membershipId, body.body, body.importance, body.audience.household, publishAt, expiresAt, state, body.idempotencyKey]);
      const id = inserted.rows[0]!.id;
      await client.query('UPDATE messages SET request_hash=$2 WHERE id=$1', [id, requestHash]);
      for (const personId of body.audience.personIds) await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES ($1,$2,$3)', [actor.householdId, id, personId]);
      for (const displayId of body.audience.displayIds) await client.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES ($1,$2,$3,'queued')`, [actor.householdId, id, displayId]);
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key)
        VALUES ($1,NULL,$2,1,'account',$3,$4)`, [id, state, actor.accountId, `create:${id}`]);
      return (await client.query(`SELECT id,body,importance,audience_household,publish_at,expires_at,state,revision FROM messages WHERE id=$1`, [id])).rows[0]!;
    });
  }

  async withdraw(
    actor: MessageCreateActor,
    messageId: string,
    expectedRevision: number,
    authorize: MessageCreateAuthorize,
    auditAdmin?: MessageWithdrawAudit
  ): Promise<Record<string, unknown>> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new DomainError('VALIDATION_FAILED', 400);
    return this.transact(async (client) => {
      const capabilities = await authorize(client, actor);
      const existing = await client.query<{ id: string; author_membership_id: string; state: string; audience_household: boolean }>(`SELECT id,author_membership_id,state,audience_household
        FROM messages WHERE id=$1 AND household_id=$2 FOR UPDATE`, [messageId, actor.householdId]);
      const current = existing.rows[0];
      if (!current) throw new DomainError('NOT_FOUND', 404);
      if (current.author_membership_id !== actor.membershipId) requireCapability(capabilities, 'message.manage.household');
      if (!['scheduled', 'published'].includes(current.state)) throw new DomainError('CONFLICT', 409);

      if (actor.mcpGrantId) {
        if (current.audience_household) throw new DomainError('FORBIDDEN', 403, { reason: 'mcp_message_household_audience_not_granted' });
        const people = await client.query<{ person_id: string }>(`SELECT audience.person_id FROM message_person_audiences audience
          JOIN persons person ON person.id=audience.person_id AND person.household_id=audience.household_id
          WHERE audience.message_id=$1 AND audience.household_id=$2 ORDER BY audience.person_id FOR SHARE OF audience,person`, [messageId, actor.householdId]);
        const displays = await client.query<{ display_id: string }>(`SELECT target.display_id FROM message_display_targets target
          WHERE target.message_id=$1 AND target.household_id=$2 AND target.delivery_state<>'cancelled'
          ORDER BY target.display_id FOR SHARE OF target`, [messageId, actor.householdId]);
        const personIds = people.rows.map((row) => row.person_id);
        const displayIds = displays.rows.map((row) => row.display_id);
        if (!personIds.length && !displayIds.length) throw new DomainError('FORBIDDEN', 403, { reason: 'mcp_message_recipient_grant_required' });
        await validateMessageAudience(client, actor, capabilities, personIds, displayIds, false);
      }

      const next = current.state === 'scheduled' ? 'cancelled' : 'withdrawn';
      const updated = await client.query(`UPDATE messages SET state=$3,revision=revision+1,ended_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND household_id=$2 AND revision=$4 RETURNING id,state,revision`, [messageId, actor.householdId, next, expectedRevision]);
      if (!updated.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
      await client.query(`UPDATE message_display_targets SET delivery_state='cancelled' WHERE message_id=$1 AND household_id=$2`, [messageId, actor.householdId]);
      const revision = (updated.rows[0] as { revision: number }).revision;
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key)
        VALUES ($1,$2,$3,$4,'account',$5,$6)`, [messageId, current.state, next, revision, actor.accountId, `withdraw:${messageId}:${expectedRevision}`]);
      if (current.author_membership_id !== actor.membershipId && auditAdmin) await auditAdmin(client, messageId, next);
      return updated.rows[0]!;
    });
  }
}

export const messageService = new MessageService();
