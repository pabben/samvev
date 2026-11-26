import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@samvev/core';
import type { DbClient } from '../db.ts';

export const nativeEventTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

interface EventDates {
  allDay: boolean;
  startDate: Date;
  endDate: Date;
}

export interface NativeEventRow {
  id: string;
  connection_id: string;
  title: string;
  body: string;
  starts_at: Date;
  ends_at: Date | null;
  metadata: Record<string, unknown>;
  revision: number;
}

interface NativeEventSource { householdId: string; connectionId: string }

export function nativeEventDates(start: string, end: string): EventDates {
  const allDay = start.length === 10;
  const startDate = new Date(allDay ? `${start}T00:00:00.000Z` : start);
  const endDate = new Date(allDay ? `${end}T00:00:00.000Z` : end);
  if (allDay !== (end.length === 10) || !(endDate > startDate)) {
    throw new DomainError('VALIDATION_FAILED', 400, { reason: 'calendar_event_time_invalid' });
  }
  return { allDay, startDate, endDate };
}

const storedColumns = 'id,connection_id,title,body,starts_at,ends_at,metadata,revision';

export async function insertNativeEvent(client: DbClient, owner: NativeEventSource, input: {
  origin: 'ha' | 'samvev'; household: boolean; personIds: string[]; title: string; description?: string;
  dates: EventDates; source: Record<string, unknown>; metadata: Record<string, unknown>; requestHash: string;
}): Promise<NativeEventRow> {
  const row = (await client.query<NativeEventRow>(`INSERT INTO integration_items
    (household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash,ha_native_origin)
    VALUES($1,$2,$3,'event',$4,$5,$6,'normal',$7,$8,$9,$10,$11,$12) RETURNING ${storedColumns}`,
  [owner.householdId, owner.connectionId, `${input.origin}:${randomUUID()}`, input.household, input.title,
    input.description || input.title, input.dates.startDate, input.dates.endDate, JSON.stringify(input.source),
    JSON.stringify(input.metadata), input.requestHash, input.origin === 'ha'])).rows[0]!;
  if (input.personIds.length) await addNativeEventPeople(client, owner.householdId, row.id, input.personIds);
  return row;
}

export async function addNativeEventPeople(client: DbClient, householdId: string, eventId: string, personIds: string[]) {
  await client.query(`INSERT INTO integration_item_person_targets(household_id,item_id,person_id)
    SELECT $1,$2,person_id FROM unnest($3::uuid[]) AS selected(person_id)`, [householdId, eventId, personIds]);
}

export async function updateNativeEvent(client: DbClient, owner: NativeEventSource, eventId: string, input: {
  expectedRevision: number; title?: string; description?: string; dates: EventDates;
  metadata: Record<string, unknown>; requestHash: string;
}): Promise<NativeEventRow> {
  const row = (await client.query<NativeEventRow>(`UPDATE integration_items SET
    title=COALESCE($5,title),body=CASE WHEN $6::text IS NULL THEN body WHEN $6='' THEN COALESCE($5,title) ELSE $6 END,
    starts_at=$7,ends_at=$8,metadata=$9,revision=revision+1,updated_at=clock_timestamp(),request_hash=$10
    WHERE id=$1 AND household_id=$2 AND connection_id=$3 AND revision=$4 AND status='active' RETURNING ${storedColumns}`,
  [eventId, owner.householdId, owner.connectionId, input.expectedRevision, input.title ?? null, input.description ?? null,
    input.dates.startDate, input.dates.endDate, JSON.stringify(input.metadata), input.requestHash])).rows[0];
  if (!row) throw new DomainError('REVISION_CONFLICT', 409);
  return row;
}

export async function deleteNativeEvent(client: DbClient, owner: NativeEventSource, eventId: string, expectedRevision: number) {
  const row = (await client.query<{ id: string; revision: number }>(`UPDATE integration_items SET
    status='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
    WHERE id=$1 AND household_id=$2 AND connection_id=$3 AND revision=$4 AND status='active' RETURNING id,revision`,
  [eventId, owner.householdId, owner.connectionId, expectedRevision])).rows[0];
  if (!row) throw new DomainError('REVISION_CONFLICT', 409);
  return row;
}

// i and connection refer to the integration item and its household connection.
// Producer-provided metadata cannot make an event native.
export const samvevNativeEventPredicate = `connection.native_calendar AND i.kind='event' AND NOT i.ha_native_origin
  AND NOT (i.metadata ? 'calendar' OR i.metadata ? 'haBridge') AND NOT i.target_household
  AND NOT EXISTS (SELECT 1 FROM calendar_occurrences occurrence WHERE occurrence.integration_item_id=i.id)
  AND NOT EXISTS (SELECT 1 FROM integration_item_display_targets target WHERE target.item_id=i.id)`;
