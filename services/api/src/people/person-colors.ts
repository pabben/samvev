import type { DbClient } from '../db.ts';
import { personColorTokens } from '@samvev/contracts';

/** Stable semantic person-color tokens understood by every client theme. */
export { personColorTokens };
export type PersonColorToken = typeof personColorTokens[number];

/** Choose the least-used token, breaking ties by the stable palette order. */
export function leastUsedPersonColor(counts: Partial<Record<PersonColorToken, number>>): PersonColorToken {
  return personColorTokens.reduce((best, token) =>
    (counts[token] ?? 0) < (counts[best] ?? 0) ? token : best
  , personColorTokens[0]!);
}

/**
 * Serialize automatic color assignment with other household member creation.
 * Call inside the same transaction as the person insert.
 */
export async function assignPersonColor(client: DbClient, householdId: string): Promise<PersonColorToken> {
  const household = await client.query('SELECT id FROM households WHERE id=$1 FOR UPDATE', [householdId]);
  if (!household.rowCount) throw new Error('person_color_household_missing');
  const rows = await client.query<{color_token: PersonColorToken; count: number}>(
    'SELECT color_token,count(*)::int AS count FROM persons WHERE household_id=$1 GROUP BY color_token',
    [householdId]
  );
  const counts: Partial<Record<PersonColorToken, number>> = {};
  for (const row of rows.rows) counts[row.color_token] = row.count;
  return leastUsedPersonColor(counts);
}
