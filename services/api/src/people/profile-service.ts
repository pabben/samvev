import { DomainError } from '@samvev/core';
import { personUpdateSchema } from '@samvev/contracts';
import type { z } from 'zod';
import type { DbClient } from '../db.ts';
import { deriveAgeGroup, localDateInTimezone } from './domain.ts';

export type PersonProfileUpdateInput = z.infer<typeof personUpdateSchema>;
export type PersonProfileAudit = (client: DbClient, personId: string, fields: string[]) => Promise<void>;

/** Shared member/MCP profile update. Callers enforce their own live actor and
 * resource policy, and provide the actor-specific audit writer. */
export async function updatePersonProfile(
  client: DbClient,
  householdId: string,
  personId: string,
  body: PersonProfileUpdateInput,
  audit: PersonProfileAudit
): Promise<Record<string, unknown>> {
  const household = await client.query<{ timezone: string }>('SELECT timezone FROM households WHERE id=$1 FOR SHARE', [householdId]);
  if (!household.rows[0]) throw new DomainError('NOT_FOUND', 404);
  const current = await client.query<{ birth_date: string | null; age_group: 'adult' | 'teen' | 'child' | 'unspecified' }>(
    'SELECT birth_date::text,age_group FROM persons WHERE id=$1 AND household_id=$2 FOR UPDATE', [personId, householdId]);
  if (!current.rowCount) throw new DomainError('NOT_FOUND', 404);
  const birthDate = body.birthDate === undefined ? current.rows[0]!.birth_date : body.birthDate;
  const ageGroup = body.ageGroup ?? (body.birthDate === undefined
    ? current.rows[0]!.age_group
    : deriveAgeGroup(birthDate, localDateInTimezone(new Date(), household.rows[0].timezone)));
  const updated = await client.query(`UPDATE persons SET display_name=COALESCE($3,display_name),
    avatar_key=CASE WHEN $4 THEN $5 ELSE avatar_key END,color_token=COALESCE($6,color_token),birth_date=$7,
    age_group=$8,revision=revision+1,updated_at=clock_timestamp()
    WHERE id=$1 AND household_id=$2 AND revision=$9
    RETURNING id,display_name,avatar_key AS "avatarKey",color_token AS "colorToken",birth_date::text,age_group,revision`,
  [personId, householdId, body.displayName ?? null, body.avatarKey !== undefined, body.avatarKey ?? null,
    body.colorToken ?? null, birthDate, ageGroup, body.expectedRevision]);
  if (!updated.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
  await audit(client, personId, Object.keys(body).filter((key) => key !== 'expectedRevision'));
  return updated.rows[0] as Record<string, unknown>;
}
