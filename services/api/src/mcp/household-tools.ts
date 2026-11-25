import { DomainError } from '@samvev/core';
import { dinnerAssignmentSchema, groceryCreateSchema, groceryUpdateSchema } from '@samvev/contracts';
import { z, type ZodType } from 'zod';
import { transaction, type DbClient } from '../db.ts';
import { HouseholdBoardService, type IntegrationBoardActor } from '../household-board/service.ts';

/** OAuth principal copied from the authenticated MCP request. The database is
 * still authoritative: every invocation rechecks the grant and membership. */
export interface HouseholdMcpPrincipal {
  tokenSetId: string;
  grantId: string;
  householdId: string;
  accountId: string;
  membershipId: string;
  installationId: string;
}

export interface HouseholdMcpToolContext { principal: HouseholdMcpPrincipal }
export interface HouseholdMcpToolRegistrar {
  registerTool(name: string, options: {
    description: string;
    inputSchema: ZodType;
    requiredScopes: readonly [HouseholdMcpScope, ...HouseholdMcpScope[]];
    readOnlyHint: boolean;
    destructiveHint: boolean;
  }, handler: (input: unknown) => Promise<unknown>): void;
}
export interface HouseholdMcpToolDependencies {
  transaction<T>(run: (client: DbClient) => Promise<T>): Promise<T>;
  boardService?: Pick<HouseholdBoardService, 'createGrocery' | 'updateGrocery' | 'setDinner'>;
}

const uuid = z.uuid();
const date = z.iso.date();
const emptyInput = z.object({}).strict();
const dinnersInput = z.object({ from: date, to: date }).strict();
const groceryUpdateInput = groceryUpdateSchema.extend({ id: uuid });
const dinnerAssignmentInput = dinnerAssignmentSchema.extend({ localDate: date });
const MAX_DINNER_DAYS = 31;

export type HouseholdMcpScope = 'mcp:people:read' | 'mcp:groceries:read' | 'mcp:groceries:write' | 'mcp:dinners:read' | 'mcp:dinners:write';
type Capability = 'household.view' | 'household.manage';

async function assertLiveAuthority(client: DbClient, principal: HouseholdMcpPrincipal, scopes: readonly HouseholdMcpScope[], capability: Capability): Promise<void> {
  const result = await client.query<{ allowed: boolean }>(`SELECT (
      grant_row.id IS NOT NULL
      AND grant_row.revoked_at IS NULL
      AND grant_row.scopes ?& $5::text[]
      AND token_set.revoked_at IS NULL AND token_set.access_expires_at>clock_timestamp()
      AND token_set.scopes ?& $5::text[]
      AND membership.id IS NOT NULL
      AND membership.capabilities ? $6
      AND person.age_group = 'adult'
      AND account.disabled_at IS NULL
      AND household.installation_id = $4
    ) AS allowed
    FROM mcp_oauth_grants grant_row
    JOIN mcp_oauth_token_sets token_set ON token_set.grant_id=grant_row.id AND token_set.id=$8
    JOIN memberships membership ON membership.id=grant_row.membership_id AND membership.household_id=grant_row.household_id AND membership.account_id=grant_row.account_id
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id
    JOIN accounts account ON account.id=membership.account_id AND account.installation_id=$4
    JOIN households household ON household.id=grant_row.household_id AND household.installation_id=$4
    WHERE grant_row.id=$1 AND grant_row.household_id=$2 AND grant_row.account_id=$3 AND grant_row.membership_id=$7
    FOR SHARE OF grant_row,token_set,membership,person,account,household`,
    [principal.grantId, principal.householdId, principal.accountId, principal.installationId, scopes, capability, principal.membershipId, principal.tokenSetId]);
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
  if (!uuid.safeParse(principal.tokenSetId).success || !uuid.safeParse(principal.grantId).success || !uuid.safeParse(principal.householdId).success ||
      !uuid.safeParse(principal.accountId).success || !uuid.safeParse(principal.membershipId).success ||
      !uuid.safeParse(principal.installationId).success) throw new DomainError('UNAUTHENTICATED', 401);

  const boardActor: IntegrationBoardActor = {
    kind: 'integration', id: principal.grantId, householdId: principal.householdId, installationId: principal.installationId,
    credentialId: principal.grantId, credentialRevision: 0, capabilities: []
  };
  const boardService = dependencies.boardService ?? new HouseholdBoardService(
    async () => { throw new DomainError('FORBIDDEN', 403); },
    async (client, actor, board, write) => {
      if (actor.id !== principal.grantId || actor.householdId !== principal.householdId ||
          actor.installationId !== principal.installationId || actor.credentialId !== principal.grantId) throw new DomainError('FORBIDDEN', 403);
      const scopes: HouseholdMcpScope[] = board === 'groceries'
        ? ['mcp:groceries:read', ...(write ? ['mcp:groceries:write' as const] : [])]
        : ['mcp:dinners:read', ...(write ? ['mcp:dinners:write' as const] : [])];
      await assertLiveAuthority(client, principal, scopes, 'household.manage');
    }
  );

  registrar.registerTool('household.people.list', {
    description: 'List only household people explicitly included in this OAuth grant.', inputSchema: emptyInput,
    requiredScopes: ['mcp:people:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:people:read'], 'household.view');
      const result = await client.query(`SELECT person.id,person.display_name AS "displayName",person.age_group AS "ageGroup"
        FROM mcp_oauth_grant_people grant_person
        JOIN persons person ON person.id=grant_person.person_id AND person.household_id=grant_person.household_id
        WHERE grant_person.grant_id=$1 AND grant_person.household_id=$2
        ORDER BY person.display_name,person.id LIMIT 100 FOR SHARE OF grant_person,person`, [principal.grantId, principal.householdId]);
      return { people: result.rows };
    });
  });

  registrar.registerTool('household.groceries.list', {
    description: 'Read the household grocery list with explicit whole-household consent.', inputSchema: emptyInput,
    requiredScopes: ['mcp:groceries:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:groceries:read'], 'household.manage');
      const result = await client.query(`SELECT id,label,checked,revision,created_at AS "createdAt",updated_at AS "updatedAt"
        FROM household_grocery_items WHERE household_id=$1 AND deleted_at IS NULL
        ORDER BY created_at,id LIMIT 200`, [principal.householdId]);
      return { items: result.rows };
    });
  });

  registrar.registerTool('household.groceries.add', {
    description: 'Add one grocery item. Requires a durable request key for safe retries.', inputSchema: groceryCreateSchema,
    requiredScopes: ['mcp:groceries:read', 'mcp:groceries:write'], readOnlyHint: false, destructiveHint: false
  }, async (raw) => boardService.createGrocery(boardActor, groceryCreateSchema.parse(raw)));

  registrar.registerTool('household.groceries.update', {
    description: 'Update, check, or uncheck one grocery item using its current revision and a durable request key.', inputSchema: groceryUpdateInput,
    requiredScopes: ['mcp:groceries:read', 'mcp:groceries:write'], readOnlyHint: false, destructiveHint: false
  }, async (raw) => {
    const { id, ...input } = groceryUpdateInput.parse(raw);
    return boardService.updateGrocery(boardActor, id, input);
  });

  registrar.registerTool('household.dinners.list', {
    description: 'Read assigned dinners for a date range of at most 31 days, with explicit whole-household consent.', inputSchema: dinnersInput,
    requiredScopes: ['mcp:dinners:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    const input = dinnersInput.parse(raw);
    if (!withinDateWindow(input.from, input.to)) throw new DomainError('VALIDATION_FAILED', 400, { reason: 'dinner_window_max_31_days' });
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:dinners:read'], 'household.manage');
      const result = await client.query(`SELECT id,local_date::text AS "localDate",
        CASE WHEN deleted_at IS NULL THEN title_snapshot ELSE NULL END AS title,
        CASE WHEN deleted_at IS NULL THEN emoji_snapshot ELSE NULL END AS emoji,
        revision,(deleted_at IS NOT NULL) AS cleared
        FROM household_dinner_assignments WHERE household_id=$1 AND local_date BETWEEN $2::date AND $3::date
        ORDER BY local_date,id LIMIT 62`, [principal.householdId, input.from, input.to]);
      return { from: input.from, to: input.to, assignments: result.rows };
    });
  });

  registrar.registerTool('household.dinners.options.list', {
    description: 'List dinner options that may be assigned to a date.', inputSchema: emptyInput,
    requiredScopes: ['mcp:dinners:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:dinners:read'], 'household.manage');
      const result = await client.query(`SELECT id,title,emoji,revision FROM household_dinner_options
        WHERE household_id=$1 AND deleted_at IS NULL ORDER BY title,id LIMIT 100`, [principal.householdId]);
      return { options: result.rows };
    });
  });

  registrar.registerTool('household.dinners.assign', {
    description: 'Assign or clear a dinner option for one date using its current revision and a durable request key.', inputSchema: dinnerAssignmentInput,
    requiredScopes: ['mcp:dinners:read', 'mcp:dinners:write'], readOnlyHint: false, destructiveHint: true
  }, async (raw) => {
    const { localDate, ...input } = dinnerAssignmentInput.parse(raw);
    return boardService.setDinner(boardActor, localDate, input);
  });
}

/** Exported for focused authorization tests without registering an MCP server. */
export const householdToolSchemas = { emptyInput, dinnersInput, groceryUpdateInput, dinnerAssignmentInput } as const;
