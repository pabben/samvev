import { createHash } from 'node:crypto';
import { DomainError } from '@samvev/core';
import { z } from 'zod';
import { addNativeEventPeople, deleteNativeEvent, insertNativeEvent, nativeEventDates, nativeEventTime,
  samvevNativeEventPredicate, updateNativeEvent, type NativeEventRow } from '../calendar/native-events.ts';
import type { DbClient } from '../db.ts';
import type { HouseholdMcpPrincipal, HouseholdMcpToolRegistrar } from './household-tools.ts';

export const NATIVE_CALENDAR_NAME = 'Samvev';
const writeScopes = ['mcp:calendar:read', 'mcp:calendar:write'] as const;
const uuid = z.uuid().transform((id) => id.toLowerCase());
const personIds = z.array(uuid).min(1).max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate_person_ids')
  .transform((ids) => ids.sort());
const request = { sourceId: uuid, requestKey: z.string().min(8).max(128) };
const cas = { eventId: uuid, expectedRevision: z.number().int().positive().max(2_147_483_647) };
const fields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  startsAt: nativeEventTime,
  endsAt: nativeEventTime,
  location: z.string().max(160),
  personIds
};
export const calendarCreateInput = z.strictObject({
  ...request, ...fields, description: fields.description.optional(), location: fields.location.optional()
});
export const calendarUpdateInput = z.strictObject({
  ...request, ...cas, title: fields.title.optional(), description: fields.description.optional(),
  startsAt: fields.startsAt.optional(), endsAt: fields.endsAt.optional(), location: fields.location.optional(), personIds: fields.personIds.optional()
}).refine((input) => Object.keys(fields).some((key) => input[key as keyof typeof fields] !== undefined), 'event_changes_required');
export const calendarDeleteInput = z.strictObject({ ...request, ...cas });
const writeOutput = z.strictObject({ event: z.strictObject({ id: z.uuid(), revision: z.number().int().positive() }) });

type Create = z.output<typeof calendarCreateInput>;
type Update = z.output<typeof calendarUpdateInput>;
type Delete = z.output<typeof calendarDeleteInput>;
type Mutation =
  | { action: 'create'; input: Create }
  | { action: 'update'; input: Update }
  | { action: 'delete'; input: Delete };
type CalendarAuditAction = 'mcp.calendar_event_created' | 'mcp.calendar_event_updated' | 'mcp.calendar_event_deleted';
const auditActions: Record<Mutation['action'], CalendarAuditAction> = {
  create: 'mcp.calendar_event_created',
  update: 'mcp.calendar_event_updated',
  delete: 'mcp.calendar_event_deleted'
};

interface Dependencies {
  transaction<T>(run: (client: DbClient) => Promise<T>): Promise<T>;
  assertWriteAuthority(client: DbClient): Promise<void>;
  audit(client: DbClient, action: CalendarAuditAction, subjectId: string, revision: number): Promise<void>;
}

export async function hasNativeCalendarGrant(client: DbClient, principal: HouseholdMcpPrincipal): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM mcp_oauth_grant_resources
    WHERE grant_id=$1 AND household_id=$2 AND resource_kind='native_calendar' AND resource_id=$2
      AND EXISTS(SELECT 1 FROM mcp_oauth_grant_people WHERE grant_id=$1 AND household_id=$2)
    FOR SHARE`,
  [principal.grantId, principal.householdId]);
  return Boolean(result.rowCount);
}

async function assertPeople(client: DbClient, principal: HouseholdMcpPrincipal, ids: string[]) {
  const result = await client.query(`SELECT allowed.person_id
    FROM mcp_oauth_grant_people allowed JOIN persons person ON person.id=allowed.person_id AND person.household_id=allowed.household_id
    WHERE allowed.grant_id=$1 AND allowed.household_id=$2 AND allowed.person_id=ANY($3::uuid[])
    ORDER BY person.id FOR SHARE OF allowed,person`, [principal.grantId, principal.householdId, ids]);
  if (!ids.length || result.rowCount !== ids.length) throw new DomainError('NOT_FOUND', 404);
}

interface CurrentEvent extends NativeEventRow { status: string; person_ids: string[] }
async function lockEvent(client: DbClient, householdId: string, eventId: string): Promise<CurrentEvent> {
  const row = (await client.query<Omit<CurrentEvent, 'person_ids'>>(`SELECT i.id,i.connection_id,i.title,i.body,i.starts_at,i.ends_at,i.metadata,i.revision,i.status
    FROM integration_items i JOIN integration_connections connection ON connection.id=i.connection_id
      AND connection.household_id=i.household_id AND connection.revoked_at IS NULL
    WHERE i.household_id=$1 AND i.id=$2 AND ${samvevNativeEventPredicate}
    FOR UPDATE OF i FOR SHARE OF connection`, [householdId, eventId])).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 404);
  // The first statement may wait for a concurrent update. Fetch audiences
  // after taking the item lock so the ACL uses the resulting row version.
  const people = await client.query<{person_id: string}>(`SELECT person_id FROM integration_item_person_targets
    WHERE household_id=$1 AND item_id=$2 ORDER BY person_id`, [householdId, eventId]);
  return { ...row, person_ids: people.rows.map(person => person.person_id) };
}

async function nativeConnection(client: DbClient, householdId: string): Promise<string> {
  await client.query(`INSERT INTO integration_connections(household_id,name,native_calendar) VALUES($1,$2,true)
    ON CONFLICT (household_id) WHERE native_calendar DO NOTHING`, [householdId, NATIVE_CALENDAR_NAME]);
  const row = (await client.query<{ id: string }>(`SELECT id FROM integration_connections
    WHERE household_id=$1 AND native_calendar AND revoked_at IS NULL FOR SHARE`, [householdId])).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 404);
  return row.id;
}

function writtenEvent(row: { id: string; revision: number }) {
  return { event: { id: row.id, revision: row.revision } };
}

function storedTime(value: Date, allDay: boolean) {
  const iso = value.toISOString();
  return allDay ? iso.slice(0, 10) : iso;
}

async function mutate(principal: HouseholdMcpPrincipal, deps: Dependencies, mutation: Mutation) {
  const { sourceId, requestKey, ...payload } = mutation.input;
  if (sourceId !== principal.householdId) throw new DomainError('NOT_FOUND', 404);
  const hash = createHash('sha256').update(JSON.stringify({ action: mutation.action, payload })).digest('hex');
  return deps.transaction(async (client) => {
    // Serialize retries across replicas without taking an exclusive lock on
    // the grant or unrelated events. Access is checked after any lock wait.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`calendar:${principal.grantId}:${requestKey}`]);
    await deps.assertWriteAuthority(client);
    if (!await hasNativeCalendarGrant(client, principal)) throw new DomainError('NOT_FOUND', 404);

    const receipt = (await client.query<{ request_hash: string; event_id: string; event_revision: number; person_ids: string[] }>(
      `SELECT request_hash,event_id,event_revision,person_ids FROM mcp_native_calendar_requests
       WHERE grant_id=$1 AND household_id=$2 AND request_key=$3`, [principal.grantId, principal.householdId, requestKey])).rows[0];
    if (receipt) {
      const event = await lockEvent(client, principal.householdId, receipt.event_id);
      if (!event.person_ids.length) throw new DomainError('NOT_FOUND', 404);
      await assertPeople(client, principal, [...new Set([...receipt.person_ids, ...event.person_ids])]);
      if (receipt.request_hash !== hash) throw new DomainError('CONFLICT', 409, { reason: 'idempotency_payload_mismatch' });
      await deps.assertWriteAuthority(client);
      return writtenEvent({ id: receipt.event_id, revision: receipt.event_revision });
    }

    let row: { id: string; revision: number };
    let affectedPeople: string[];
    if (mutation.action === 'create') {
      const input = mutation.input;
      const dates = nativeEventDates(input.startsAt, input.endsAt);
      affectedPeople = input.personIds;
      await assertPeople(client, principal, affectedPeople);
      const connectionId = await nativeConnection(client, principal.householdId);
      row = await insertNativeEvent(client, { householdId: principal.householdId, connectionId }, {
        origin: 'samvev', household: false, personIds: affectedPeople, title: input.title, description: input.description,
        dates, metadata: { allDay: dates.allDay, descriptionEmpty: !input.description, ...(input.location && { location: input.location }) },
        source: { label: NATIVE_CALENDAR_NAME, observedAt: new Date().toISOString(), uncertainty: 'low' }, requestHash: hash
      });
    } else {
      const current = await lockEvent(client, principal.householdId, mutation.input.eventId);
      const owner = { householdId: principal.householdId, connectionId: current.connection_id };
      await assertPeople(client, principal, current.person_ids);
      if (current.status !== 'active') throw new DomainError('NOT_FOUND', 404);
      if (current.revision !== mutation.input.expectedRevision) throw new DomainError('REVISION_CONFLICT', 409);

      if (mutation.action === 'delete') {
        affectedPeople = current.person_ids;
        row = await deleteNativeEvent(client, owner, current.id, mutation.input.expectedRevision);
      } else {
        const input = mutation.input;
        affectedPeople = [...new Set([...current.person_ids, ...(input.personIds ?? [])])].sort();
        await assertPeople(client, principal, affectedPeople);
        const allDay = current.metadata.allDay === true;
        const dates = nativeEventDates(input.startsAt ?? storedTime(current.starts_at, allDay),
          input.endsAt ?? storedTime(current.ends_at!, allDay));
        const metadata = { ...current.metadata, allDay: dates.allDay,
          ...(input.description !== undefined && { descriptionEmpty: !input.description }),
          ...(input.location !== undefined && { location: input.location }) };
        const description = input.description ?? (current.metadata.descriptionEmpty === true && input.title !== undefined ? '' : undefined);
        row = await updateNativeEvent(client, owner, current.id, { ...input, description, dates, metadata, requestHash: hash });
        if (input.personIds) {
          await client.query('DELETE FROM integration_item_person_targets WHERE item_id=$1 AND household_id=$2', [current.id, principal.householdId]);
          await addNativeEventPeople(client, principal.householdId, current.id, input.personIds);
        }
      }
    }

    await deps.audit(client, auditActions[mutation.action], row.id, row.revision);
    await client.query(`INSERT INTO mcp_native_calendar_requests(household_id,grant_id,request_key,request_hash,event_id,event_revision,person_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [principal.householdId, principal.grantId, requestKey, hash, row.id, row.revision, affectedPeople]);
    await deps.assertWriteAuthority(client);
    return writtenEvent(row);
  }).catch((error: unknown) => {
    if ((error as { code?: string })?.code === '40P01') {
      throw new DomainError('CONFLICT', 409, { reason: 'calendar_authority_concurrency_retry' });
    }
    throw error;
  });
}

export function registerCalendarWriteTools(registrar: HouseholdMcpToolRegistrar, principal: HouseholdMcpPrincipal, deps: Dependencies) {
  const options = { outputSchema: writeOutput, requiredScopes: writeScopes, readOnlyHint: false, idempotentHint: true };
  registrar.registerTool('calendar.events.create', {
    ...options, inputSchema: calendarCreateInput, destructiveHint: false,
    description: 'Create one appointment in the explicitly approved native Samvev calendar for selected people. Use the Samvev source ID from calendar.sources.list. Supply two offset timestamps or two civil dates with an exclusive end.'
  }, (raw) => mutate(principal, deps, { action: 'create', input: calendarCreateInput.parse(raw) }));
  registrar.registerTool('calendar.events.update', {
    ...options, inputSchema: calendarUpdateInput, destructiveHint: true,
    description: 'Edit one native Samvev appointment by ID and current revision. Omitted fields stay the same. The existing and replacement audiences must both be fully authorized.'
  }, (raw) => mutate(principal, deps, { action: 'update', input: calendarUpdateInput.parse(raw) }));
  registrar.registerTool('calendar.events.delete', {
    ...options, inputSchema: calendarDeleteInput, destructiveHint: true,
    description: 'Withdraw one native Samvev appointment by ID and current revision. Every person in its audience must be authorized.'
  }, (raw) => mutate(principal, deps, { action: 'delete', input: calendarDeleteInput.parse(raw) }));
}
