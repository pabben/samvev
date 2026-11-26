import { createHash } from 'node:crypto';
import { messageCreateSchema, messageUpdateSchema, type Capability } from '@samvev/contracts';
import { DomainError, initialMessageState, requireCapability } from '@samvev/core';
import type { ZodType } from 'zod';
import { transaction, type DbClient } from '../db.ts';

export interface MessageCreateActor {
  accountId: string;
  installationId: string;
  householdId: string;
  membershipId: string;
  /** Present for delegated OAuth writes and limits recipients to this exact grant. */
  mcpGrantId?: string;
}

export type MessageCreateTransaction = <T>(run: (client: DbClient) => Promise<T>) => Promise<T>;
export type MessageCreateAuthorize = (client: DbClient, actor: MessageCreateActor) => Promise<Capability[]>;
export type MessageWithdrawAudit = (client: DbClient, messageId: string, state: string, admin: boolean) => Promise<void>;

export type MessageEditAudit = (
  client: DbClient,
  message: Pick<MessageEditResult, 'id' | 'state' | 'revision'>,
  admin: boolean
) => Promise<void>;

interface MessageEditResult {
  id: string;
  body: string;
  importance: 'normal' | 'attention';
  audience_household: boolean;
  publish_at: Date;
  expires_at: Date;
  state: 'scheduled' | 'published';
  revision: number;
}

function parseMessageInput<T>(schema: ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
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
  const found = await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL ORDER BY id FOR SHARE', [actor.householdId, displayIds]);
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

export async function requireGrantedMessageAudience(
  client: DbClient,
  actor: MessageCreateActor,
  capabilities: Capability[],
  messageId: string,
  audienceHousehold: boolean,
  needsDisplayPublish: boolean
): Promise<void> {
  if (audienceHousehold) throw new DomainError('NOT_FOUND', 404);

  const people = await client.query<{ person_id: string }>(`SELECT audience.person_id FROM message_person_audiences audience
    JOIN persons person ON person.id=audience.person_id AND person.household_id=audience.household_id
    WHERE audience.message_id=$1 AND audience.household_id=$2 ORDER BY audience.person_id FOR SHARE OF audience,person`, [messageId, actor.householdId]);
  // The locked message serializes changes to its audience. Validate the display
  // rows before changing deliveries, in the same order as display revocation.
  const displays = await client.query<{ display_id: string }>(`SELECT target.display_id FROM message_display_targets target
    WHERE target.message_id=$1 AND target.household_id=$2 AND target.delivery_state<>'cancelled'
    ORDER BY target.display_id`, [messageId, actor.householdId]);
  const personIds = people.rows.map((row) => row.person_id);
  const displayIds = displays.rows.map((row) => row.display_id);
  if (!personIds.length && !displayIds.length) throw new DomainError('NOT_FOUND', 404);
  try {
    await validateMessageAudience(client, actor, capabilities, personIds, displayIds, needsDisplayPublish);
  } catch (error) {
    if (error instanceof DomainError && [403, 404].includes(error.status)) throw new DomainError('NOT_FOUND', 404);
    throw error;
  }
}

/** Shared message lifecycle. Callers recheck current authority in the write transaction. */
export class MessageService {
  constructor(private readonly transact: MessageCreateTransaction = transaction) {}

  async create(actor: MessageCreateActor, input: unknown, authorize: MessageCreateAuthorize): Promise<Record<string, unknown>> {
    return this.transact(async (client) => {
      const capabilities = await authorize(client, actor);
      requireCapability(capabilities, 'message.create.household');
      const body = parseMessageInput(messageCreateSchema, input);
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

  async edit(
    actor: MessageCreateActor,
    messageId: string,
    input: unknown,
    authorize: MessageCreateAuthorize,
    auditEdit?: MessageEditAudit
  ): Promise<MessageEditResult> {
    const body = parseMessageInput(messageUpdateSchema, input);
    return this.transact(async (client) => {
      // Account administration locks the installation before membership rows.
      await client.query('SELECT id FROM installations WHERE id=$1 FOR KEY SHARE', [actor.installationId]);
      const capabilities = await authorize(client, actor);
      const existing = await client.query<{
        author_membership_id: string | null;
        state: string;
        audience_household: boolean;
        publish_at: Date;
        expires_at: Date;
      }>(`SELECT author_membership_id,state,audience_household,publish_at,expires_at
        FROM messages WHERE id=$1 AND household_id=$2 FOR UPDATE`, [messageId, actor.householdId]);
      const current = existing.rows[0];
      if (!current) throw new DomainError('NOT_FOUND', 404);

      // Lock both audiences together in display-id order, as display policy
      // updates can lock multiple devices exclusively in the same transaction.
      await client.query(`SELECT id FROM displays WHERE household_id=$1 AND (id=ANY($3::uuid[]) OR id IN (
          SELECT display_id FROM message_display_targets WHERE household_id=$1 AND message_id=$2 AND delivery_state<>'cancelled'
        )) ORDER BY id FOR SHARE`, [actor.householdId, messageId, body.audience?.displayIds ?? []]);

      if (actor.mcpGrantId) {
        await requireGrantedMessageAudience(client, actor, capabilities, messageId, current.audience_household, true);
      }
      const admin = current.author_membership_id !== actor.membershipId;
      if (admin) requireCapability(capabilities, 'message.manage.household');
      if (current.state !== 'scheduled' && current.state !== 'published') {
        throw new DomainError('CONFLICT', 409, { reason: 'message_not_editable' });
      }

      const audience = body.audience;
      if (audience) {
        if (actor.mcpGrantId && audience.household) {
          throw new DomainError('FORBIDDEN', 403, { reason: 'mcp_message_household_audience_not_granted' });
        }
        if (!(audience.household || audience.personIds.length || audience.displayIds.length)) {
          throw new DomainError('VALIDATION_FAILED', 400, { fields: [{ path: 'audience', code: 'audience_required' }] });
        }
        await validateMessageAudience(client, actor, capabilities, audience.personIds, audience.displayIds);
      } else if (!actor.mcpGrantId) {
        const currentDisplays = await client.query<{ display_id: string }>(`SELECT t.display_id FROM message_display_targets t
          JOIN displays d ON d.id=t.display_id AND d.household_id=t.household_id
          WHERE t.message_id=$1 AND t.delivery_state IN ('queued','delivered','displayed') AND d.revoked_at IS NULL`, [messageId]);
        await validateMessageAudience(client, actor, capabilities, [], currentDisplays.rows.map((row) => row.display_id));
      }

      const now = new Date();
      const publishAt = body.publishAt ? new Date(body.publishAt) : current.publish_at;
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : current.expires_at;
      if (expiresAt <= publishAt || expiresAt <= now) throw new DomainError('SCHEDULE_INVALID', 422);
      if (publishAt > now) {
        requireCapability(capabilities, 'message.schedule');
        if (current.state === 'published') throw new DomainError('CONFLICT', 409, { reason: 'published_cannot_reschedule' });
      }

      // The held row locks fence concurrent revocation; recheck time-based
      // authority after waiting for the message and display locks.
      await authorize(client, actor);
      const updated = await client.query<MessageEditResult>(`UPDATE messages SET body=COALESCE($3,body),importance=COALESCE($4,importance),
        audience_household=COALESCE($5,audience_household),publish_at=$6,expires_at=$7,revision=revision+1,updated_at=clock_timestamp()
        WHERE id=$1 AND household_id=$2 AND revision=$8 RETURNING id,body,importance,audience_household,publish_at,expires_at,state,revision`,
      [messageId, actor.householdId, body.body ?? null, body.importance ?? null, audience?.household ?? null, publishAt, expiresAt, body.expectedRevision]);
      const result = updated.rows[0];
      if (!result) throw new DomainError('REVISION_CONFLICT', 409);
      if (audience) {
        await client.query('DELETE FROM message_person_audiences WHERE message_id=$1', [messageId]);
        for (const personId of audience.personIds) {
          await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES ($1,$2,$3)', [actor.householdId, messageId, personId]);
        }
        await client.query(`UPDATE message_display_targets SET delivery_state='cancelled'
          WHERE message_id=$1 AND NOT (display_id=ANY($2::uuid[]))`, [messageId, audience.displayIds]);
        for (const displayId of audience.displayIds) {
          await client.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES ($1,$2,$3,'queued')
            ON CONFLICT(message_id,display_id) DO UPDATE SET delivery_state='queued',delivered_revision=NULL,delivered_at=NULL,displayed_at=NULL,failure_code=NULL`,
          [actor.householdId, messageId, displayId]);
        }
      } else if (current.state === 'published') {
        await client.query(`UPDATE message_display_targets t SET delivery_state='queued',delivered_revision=NULL,delivered_at=NULL,displayed_at=NULL,failure_code=NULL
          FROM displays d WHERE t.message_id=$1 AND d.id=t.display_id AND d.household_id=t.household_id AND d.revoked_at IS NULL
            AND t.delivery_state IN ('queued','delivered','displayed')`, [messageId]);
      }
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key)
        VALUES ($1,$2,$2,$3,'account',$4,$5)`, [messageId, current.state, result.revision, actor.accountId, `edit:${messageId}:${body.expectedRevision}`]);
      if (auditEdit) await auditEdit(client, result, admin);
      return result;
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

      if (actor.mcpGrantId) {
        await requireGrantedMessageAudience(client, actor, capabilities, messageId, current.audience_household, false);
      }

      if (current.author_membership_id !== actor.membershipId) requireCapability(capabilities, 'message.manage.household');
      if (!['scheduled', 'published'].includes(current.state)) throw new DomainError('CONFLICT', 409);

      const next = current.state === 'scheduled' ? 'cancelled' : 'withdrawn';
      const updated = await client.query(`UPDATE messages SET state=$3,revision=revision+1,ended_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=$1 AND household_id=$2 AND revision=$4 RETURNING id,state,revision`, [messageId, actor.householdId, next, expectedRevision]);
      if (!updated.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
      await client.query(`UPDATE message_display_targets SET delivery_state='cancelled' WHERE message_id=$1 AND household_id=$2`, [messageId, actor.householdId]);
      const revision = (updated.rows[0] as { revision: number }).revision;
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key)
        VALUES ($1,$2,$3,$4,'account',$5,$6)`, [messageId, current.state, next, revision, actor.accountId, `withdraw:${messageId}:${expectedRevision}`]);
      if (auditAdmin) await auditAdmin(client, messageId, next, current.author_membership_id !== actor.membershipId);
      return updated.rows[0]!;
    });
  }
}

export const messageService = new MessageService();
