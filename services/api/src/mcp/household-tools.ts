import { DomainError } from '@samvev/core';
import { dinnerAssignmentSchema, groceryCreateSchema, groceryUpdateSchema, messageCreateSchema, personUpdateSchema, type Capability as MemberCapability } from '@samvev/contracts';
import { z, type ZodType } from 'zod';
import { transaction, type DbClient } from '../db.ts';
import { HouseholdBoardService, type IntegrationBoardActor } from '../household-board/service.ts';
import { listMessages } from '../messages/read.ts';
import { readCalendarActivityRows } from '../calendar/activity-reader.ts';
import { localDateInTimezone } from '../people/domain.ts';
import { messageService, type MessageCreateActor, type MessageService } from '../messages/service.ts';
import { updatePersonProfile, type PersonProfileAudit } from '../people/profile-service.ts';

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
  messageService?: Pick<MessageService, 'create'>;
  personProfileAudit?: PersonProfileAudit;
}

const uuid = z.uuid();
const date = z.iso.date();
const emptyInput = z.object({}).strict();
const dinnersInput = z.object({ from: date, to: date }).strict();
const calendarInput = z.object({ days: z.number().int().min(1).max(31).default(14), limit: z.number().int().min(1).max(50).default(25) }).strict();
const personUpdateInput = personUpdateSchema.extend({ personId: uuid });
const groceryUpdateInput = groceryUpdateSchema.extend({ id: uuid });
const dinnerAssignmentInput = dinnerAssignmentSchema.extend({ localDate: date });
const MAX_DINNER_DAYS = 31;
function dateOffset(value:string,offset:number):string{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}

export type HouseholdMcpScope = 'mcp:people:read' | 'mcp:people:write' | 'mcp:messages:read' | 'mcp:messages:write' | 'mcp:groceries:read' | 'mcp:groceries:write' | 'mcp:dinners:read' | 'mcp:dinners:write' | 'mcp:calendar:read';
type Capability = MemberCapability;

async function assertLiveAuthority(client: DbClient, principal: HouseholdMcpPrincipal, scopes: readonly HouseholdMcpScope[], capability: Capability): Promise<{personId:string;capabilities:Capability[]}> {
  const result = await client.query<{ allowed: boolean; person_id: string; capabilities: Capability[] }>(`SELECT (
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
    ) AS allowed,membership.person_id,membership.capabilities
    FROM mcp_oauth_grants grant_row
    JOIN mcp_oauth_token_sets token_set ON token_set.grant_id=grant_row.id AND token_set.id=$8
    JOIN memberships membership ON membership.id=grant_row.membership_id AND membership.household_id=grant_row.household_id AND membership.account_id=grant_row.account_id
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id
    JOIN accounts account ON account.id=membership.account_id AND account.installation_id=$4
    JOIN households household ON household.id=grant_row.household_id AND household.installation_id=$4
    WHERE grant_row.id=$1 AND grant_row.household_id=$2 AND grant_row.account_id=$3 AND grant_row.membership_id=$7
    FOR SHARE OF grant_row,token_set,membership,person,account,household`,
    [principal.grantId, principal.householdId, principal.accountId, principal.installationId, scopes, capability, principal.membershipId, principal.tokenSetId]);
  const row = result.rows[0];
  if (!row?.allowed || !uuid.safeParse(row.person_id).success) throw new DomainError('FORBIDDEN', 403);
  return { personId: row.person_id, capabilities: row.capabilities };
}

/** Live grant and member-visible source projection shared by both calendar tools. */
async function listLiveCalendarSources(client: DbClient, principal: HouseholdMcpPrincipal): Promise<Array<{ id: string; name: string; provider: string }>> {
  const result = await client.query<{ id: string; name: string; provider: string }>(`SELECT source.id,COALESCE(source.display_name,source.name) AS name,connection.provider
    FROM mcp_oauth_grant_resources grant_resource
    JOIN calendar_sources source ON source.id=grant_resource.resource_id AND source.household_id=grant_resource.household_id
    JOIN calendar_connections connection ON connection.id=source.connection_id AND connection.household_id=source.household_id
    JOIN integration_connections integration ON integration.id=connection.integration_connection_id AND integration.household_id=source.household_id AND integration.revoked_at IS NULL
    JOIN memberships viewer ON viewer.id=$3 AND viewer.account_id=$4 AND viewer.household_id=source.household_id
    WHERE grant_resource.grant_id=$1 AND grant_resource.household_id=$2 AND grant_resource.resource_kind='calendar_source'
      AND source.enabled AND connection.disconnected_at IS NULL AND (viewer.capabilities ? 'household.manage' OR source.target_household OR EXISTS(
        SELECT 1 FROM calendar_source_person_readers reader WHERE reader.household_id=source.household_id
          AND reader.source_id=source.id AND reader.person_id=viewer.person_id))
    ORDER BY source.id LIMIT 100 FOR SHARE OF grant_resource,source,connection,integration,viewer`,
    [principal.grantId, principal.householdId, principal.membershipId, principal.accountId]);
  return result.rows;
}

function withinDateWindow(from: string, to: string): boolean {
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  const days = (end - start) / 86_400_000 + 1;
  return Number.isInteger(days) && days >= 1 && days <= MAX_DINNER_DAYS;
}

/** Register the safe household subset. Calendar access remains separately
 * scoped to explicit source resources; message reads share the member audience
 * policy and narrow person recipients to explicit OAuth grants. */
export function registerHouseholdTools(
  registrar: HouseholdMcpToolRegistrar,
  context: HouseholdMcpToolContext,
  dependencies: HouseholdMcpToolDependencies = { transaction }
): void {
  const { principal } = context;
  if (!uuid.safeParse(principal.tokenSetId).success || !uuid.safeParse(principal.grantId).success || !uuid.safeParse(principal.householdId).success ||
      !uuid.safeParse(principal.accountId).success || !uuid.safeParse(principal.membershipId).success ||
      !uuid.safeParse(principal.installationId).success) throw new DomainError('UNAUTHENTICATED', 401);

  registrar.registerTool('household.people.update', {
    description: 'Update the profile of one explicitly approved household person. Does not change their account, roles, or permissions.',
    inputSchema: personUpdateInput, requiredScopes: ['mcp:people:write'], readOnlyHint: false, destructiveHint: false
  }, async (raw) => {
    const { personId, ...body } = personUpdateInput.parse(raw);
    if (!dependencies.personProfileAudit) throw new DomainError('FORBIDDEN', 403);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:people:write'], 'people.manage');
      const personGrant = await client.query(`SELECT grant_person.person_id FROM mcp_oauth_grant_people grant_person
        JOIN persons person ON person.id=grant_person.person_id AND person.household_id=grant_person.household_id
        WHERE grant_person.grant_id=$1 AND grant_person.household_id=$2 AND grant_person.person_id=$3
        FOR SHARE OF grant_person,person`, [principal.grantId, principal.householdId, personId]);
      if (!personGrant.rowCount) throw new DomainError('NOT_FOUND', 404);
      return updatePersonProfile(client, principal.householdId, personId, body,
        (auditClient, updatedPersonId, fields) => dependencies.personProfileAudit!(auditClient, updatedPersonId, fields));
    });
  });

  registrar.registerTool('calendar.sources.list', {
    description: 'List only calendar sources currently granted to this client and readable by the delegated household member.',
    inputSchema: emptyInput, requiredScopes: ['mcp:calendar:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:calendar:read'], 'household.view');
      const sources = await listLiveCalendarSources(client, principal);
      return { sources };
    });
  });

  registrar.registerTool('calendar.events.list', {
    description: 'List upcoming events only from calendar sources and for people explicitly approved for this OAuth authorization.',
    inputSchema: calendarInput, requiredScopes: ['mcp:calendar:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    const input = calendarInput.parse(raw);
    return dependencies.transaction(async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:calendar:read'], 'household.view');
      const [people, sources] = await Promise.all([
        client.query<{ id: string }>(`SELECT person.id FROM mcp_oauth_grant_people grant_person
          JOIN persons person ON person.id=grant_person.person_id AND person.household_id=grant_person.household_id
          WHERE grant_person.grant_id=$1 AND grant_person.household_id=$2
          ORDER BY person.id LIMIT 100 FOR SHARE OF grant_person,person`, [principal.grantId, principal.householdId]),
        listLiveCalendarSources(client, principal)
      ]);
      if (!people.rows.length || !sources.length) return { events: [] };
      const household = await client.query<{ timezone: string }>('SELECT timezone FROM households WHERE id=$1 AND installation_id=$2 FOR SHARE', [principal.householdId, principal.installationId]);
      if (!household.rows[0]) throw new DomainError('FORBIDDEN', 403);
      const from = localDateInTimezone(new Date(), household.rows[0].timezone);
      const rows = await readCalendarActivityRows({
        householdId: principal.householdId, personIds: people.rows.map((row) => row.id),
        viewer: { personId: authority.personId, membershipId: principal.membershipId }, canViewAll: true,
        from, to: dateOffset(from, input.days - 1), limit: input.limit, sourceIds: sources.map((row) => row.id), upcomingOnly: true, requirePersonAudience: true
      }, client);
      const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
      return { events: rows.slice(0, input.limit).map((row) => ({
        id: row.id, title: row.title, description: row.body, startsAt: row.starts_at?.toISOString() ?? null,
        endsAt: row.ends_at?.toISOString() ?? null, allDay: row.metadata.allDay === true,
        sourceId: row.activity_source_id, sourceName: row.activity_source_id ? sourceNames.get(row.activity_source_id) ?? null : null
      })) };
    });
  });

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

  registrar.registerTool('household.messages.list', {
    description: 'List messages visible to this household member, including household messages and messages for people explicitly granted to this OAuth authorization.',
    inputSchema: emptyInput, requiredScopes: ['mcp:messages:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:messages:read'], 'household.view');
      const messages = await listMessages(client, {
        householdId: principal.householdId, membershipId: principal.membershipId, personId: authority.personId,
        manageHousehold: false, mcpGrantId: principal.grantId
      });
      return { messages };
    });
  });

  registrar.registerTool('household.messages.create', {
    description: 'Create and publish or schedule one message for explicitly granted people or displays. Household-wide broadcasts are not supported; each recipient must also be permitted for the delegated member.',
    inputSchema: messageCreateSchema, requiredScopes: ['mcp:messages:read', 'mcp:messages:write'], readOnlyHint: false, destructiveHint: false
  }, async (raw) => {
    const actor: MessageCreateActor = {
      accountId: principal.accountId, installationId: principal.installationId, householdId: principal.householdId,
      membershipId: principal.membershipId, mcpGrantId: principal.grantId
    };
    const created = await (dependencies.messageService ?? messageService).create(actor, raw, async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:messages:read', 'mcp:messages:write'], 'message.create.household');
      return authority.capabilities;
    });
    return { message: created };
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
export const householdToolSchemas = { emptyInput, dinnersInput, groceryUpdateInput, dinnerAssignmentInput, personUpdateInput } as const;
