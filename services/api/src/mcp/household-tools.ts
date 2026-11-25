import { DomainError } from '@samvev/core';
import { z, type ZodType } from 'zod';
import { transaction, type DbClient } from '../db.ts';

/** OAuth principal copied from the authenticated MCP request. The database is
 * still authoritative: every invocation rechecks the grant and membership. */
export interface HouseholdMcpPrincipal {
  grantId: string;
  householdId: string;
  accountId: string;
  membershipId: string;
  installationId: string;
}

export interface HouseholdMcpToolContext { principal: HouseholdMcpPrincipal }
export interface HouseholdMcpToolRegistrar {
  registerTool(name: string, options: { description: string; inputSchema: ZodType }, handler: (input: unknown) => Promise<unknown>): void;
}
export interface HouseholdMcpToolDependencies {
  transaction<T>(run: (client: DbClient) => Promise<T>): Promise<T>;
}

const uuid = z.uuid();
const date = z.iso.date();
const emptyInput = z.object({}).strict();
const dinnersInput = z.object({ from: date, to: date }).strict();
const MAX_DINNER_DAYS = 31;

type ReadScope = 'mcp:people:read' | 'mcp:groceries:read' | 'mcp:dinners:read';
type Capability = 'household.view' | 'household.manage';

async function assertLiveAuthority(client: DbClient, principal: HouseholdMcpPrincipal, scope: ReadScope, capability: Capability): Promise<void> {
  const result = await client.query<{ allowed: boolean }>(`SELECT (
      grant_row.id IS NOT NULL
      AND grant_row.revoked_at IS NULL
      AND grant_row.scopes ? $5
      AND membership.id IS NOT NULL
      AND membership.capabilities ? $6
      AND account.disabled_at IS NULL
      AND household.installation_id = $4
    ) AS allowed
    FROM mcp_oauth_grants grant_row
    JOIN memberships membership ON membership.id=grant_row.membership_id AND membership.household_id=grant_row.household_id AND membership.account_id=grant_row.account_id
    JOIN accounts account ON account.id=membership.account_id AND account.installation_id=$4
    JOIN households household ON household.id=grant_row.household_id AND household.installation_id=$4
    WHERE grant_row.id=$1 AND grant_row.household_id=$2 AND grant_row.account_id=$3 AND grant_row.membership_id=$7
    FOR SHARE OF grant_row,membership,account,household`,
    [principal.grantId, principal.householdId, principal.accountId, principal.installationId, scope, capability, principal.membershipId]);
  if (!result.rows[0]?.allowed) throw new DomainError('FORBIDDEN', 403);
}

function withinDateWindow(from: string, to: string): boolean {
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  const days = (end - start) / 86_400_000 + 1;
  return Number.isInteger(days) && days >= 1 && days <= MAX_DINNER_DAYS;
}

/** Register the safe, read-only household subset. Private calendar and message
 * tools intentionally wait for resource grants and the existing audience
 * reader policy to be exposed as reusable domain services. */
export function registerHouseholdTools(
  registrar: HouseholdMcpToolRegistrar,
  context: HouseholdMcpToolContext,
  dependencies: HouseholdMcpToolDependencies = { transaction }
): void {
  const { principal } = context;
  if (!uuid.safeParse(principal.grantId).success || !uuid.safeParse(principal.householdId).success ||
      !uuid.safeParse(principal.accountId).success || !uuid.safeParse(principal.membershipId).success ||
      !uuid.safeParse(principal.installationId).success) throw new DomainError('UNAUTHENTICATED', 401);

  registrar.registerTool('household.people.list', {
    description: 'List only household people explicitly included in this OAuth grant.', inputSchema: emptyInput
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, 'mcp:people:read', 'household.view');
      const result = await client.query(`SELECT person.id,person.display_name AS "displayName",person.age_group AS "ageGroup"
        FROM mcp_oauth_grant_people grant_person
        JOIN persons person ON person.id=grant_person.person_id AND person.household_id=grant_person.household_id
        WHERE grant_person.grant_id=$1 AND grant_person.household_id=$2
        ORDER BY person.display_name,person.id LIMIT 100 FOR SHARE OF grant_person,person`, [principal.grantId, principal.householdId]);
      return { people: result.rows };
    });
  });

  registrar.registerTool('household.groceries.list', {
    description: 'Read the household grocery list with explicit whole-household consent.', inputSchema: emptyInput
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, 'mcp:groceries:read', 'household.manage');
      const result = await client.query(`SELECT id,label,checked,revision,created_at AS "createdAt",updated_at AS "updatedAt"
        FROM household_grocery_items WHERE household_id=$1 AND deleted_at IS NULL
        ORDER BY created_at,id LIMIT 200`, [principal.householdId]);
      return { items: result.rows };
    });
  });

  registrar.registerTool('household.dinners.list', {
    description: 'Read assigned dinners for a date range of at most 31 days, with explicit whole-household consent.', inputSchema: dinnersInput
  }, async (raw) => {
    const input = dinnersInput.parse(raw);
    if (!withinDateWindow(input.from, input.to)) throw new DomainError('VALIDATION_FAILED', 400, { reason: 'dinner_window_max_31_days' });
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, 'mcp:dinners:read', 'household.manage');
      const result = await client.query(`SELECT id,local_date::text AS "localDate",
        CASE WHEN deleted_at IS NULL THEN title_snapshot ELSE NULL END AS title,
        CASE WHEN deleted_at IS NULL THEN emoji_snapshot ELSE NULL END AS emoji,
        revision,(deleted_at IS NOT NULL) AS cleared
        FROM household_dinner_assignments WHERE household_id=$1 AND local_date BETWEEN $2::date AND $3::date
        ORDER BY local_date,id LIMIT 62`, [principal.householdId, input.from, input.to]);
      return { from: input.from, to: input.to, assignments: result.rows };
    });
  });
}

/** Exported for focused authorization tests without registering an MCP server. */
export const householdToolSchemas = { emptyInput, dinnersInput } as const;
