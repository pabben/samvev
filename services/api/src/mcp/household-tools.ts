import { createHash } from 'node:crypto';
import { DomainError } from '@samvev/core';
import { dinnerAssignmentSchema, dinnerOptionCreateSchema, dinnerOptionUpdateSchema, displaySetupCards, displaySetupLayoutSchema, groceryCreateSchema, groceryUpdateSchema, localeSchema, messageCreateSchema, messageUpdateSchema, nameSchema, personUpdateSchema, themeSchema, type Capability as MemberCapability } from '@samvev/contracts';
import { z, type ZodType } from 'zod';
import { transaction, type DbClient } from '../db.ts';
import { HouseholdBoardService, type IntegrationBoardActor } from '../household-board/service.ts';
import { listMessages } from '../messages/read.ts';
import { readCalendarActivityRows } from '../calendar/activity-reader.ts';
import { localDateInTimezone } from '../people/domain.ts';
import { messageService, type MessageCreateActor, type MessageEditAudit, type MessageService, type MessageWithdrawAudit } from '../messages/service.ts';
import { hasNativeCalendarGrant, NATIVE_CALENDAR_NAME, registerCalendarWriteTools } from './calendar-write.ts';
import { updatePersonProfile, type PersonProfileAudit } from '../people/profile-service.ts';
import { createMcpPersonProfile } from './people-create.ts';

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
    outputSchema: ZodType;
    requiredScopes: readonly [HouseholdMcpScope, ...HouseholdMcpScope[]];
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
  }, handler: (input: unknown) => Promise<unknown>): void;
}
export interface HouseholdMcpToolDependencies {
  transaction<T>(run: (client: DbClient) => Promise<T>): Promise<T>;
  boardService?: Pick<HouseholdBoardService, 'createGrocery' | 'updateGrocery' | 'deleteGrocery' | 'setDinner' | 'createDinnerOption' | 'updateDinnerOption' | 'deleteDinnerOption'>;
  dinnerOptionAudit?: (client: DbClient, action: 'mcp.dinner_option_created' | 'mcp.dinner_option_updated' | 'mcp.dinner_option_deleted', optionId: string) => Promise<void>;
  groceryDeleteAudit?: (client: DbClient, action: 'mcp.grocery_deleted', itemId: string) => Promise<void>;
  messageService?: Pick<MessageService, 'create' | 'edit' | 'withdraw'>;
  messageEditAudit?: MessageEditAudit;
  messageWithdrawAudit?: MessageWithdrawAudit;
  personProfileAudit?: PersonProfileAudit;
  displayAppearanceAudit?: (client: DbClient, displayId: string, revision: number) => Promise<void>;
  displayLayoutAudit?: (client: DbClient, displayId: string, revision: number, setupVersion: string) => Promise<void>;
  displaySetupReadAudit?: (client: DbClient, displayId: string, revision: number) => Promise<void>;
  calendarAudit?: Parameters<typeof registerCalendarWriteTools>[2]['audit'];
  profileDigest?: (purpose: string, context: string, value: string) => Promise<Buffer>;
}

const uuid = z.uuid();
const date = z.iso.date();
const emptyInput = z.object({}).strict();
const dinnersInput = z.object({ from: date, to: date }).strict();
const calendarInput = z.object({ days: z.number().int().min(1).max(31).default(14), limit: z.number().int().min(1).max(50).default(25) }).strict();
// MCP profile writes deliberately omit birthDate and ageGroup: both feed live
// account authorization predicates. Reuse the shared route validators for the
// display-only fields without inheriting its more privileged schema.
const personUpdateInput = z.object({
  personId: uuid,
  displayName: personUpdateSchema.shape.displayName,
  avatarKey: personUpdateSchema.shape.avatarKey,
  colorToken: personUpdateSchema.shape.colorToken,
  expectedRevision: personUpdateSchema.shape.expectedRevision
}).strict().refine((value) => value.displayName !== undefined || value.avatarKey !== undefined || value.colorToken !== undefined);
const messageEditInput = messageUpdateSchema.extend({
  messageId: uuid,
  audience: messageUpdateSchema.shape.audience.unwrap().extend({
    household: z.literal(false).default(false)
  }).optional()
}).refine(
  ({ body, importance, audience, publishAt, expiresAt }) =>
    body !== undefined || importance !== undefined || audience !== undefined || publishAt !== undefined || expiresAt !== undefined,
  'Supply at least one message field to edit.'
);
const messageWithdrawInput = z.object({ messageId: uuid, expectedRevision: z.number().int().positive() }).strict();
const groceryUpdateInput = groceryUpdateSchema.extend({ id: uuid });
const groceryDeleteInput = z.object({ id: uuid, expectedRevision: groceryUpdateSchema.shape.expectedRevision, requestKey: groceryCreateSchema.shape.requestKey }).strict();
const dinnerAssignmentInput = dinnerAssignmentSchema.extend({ localDate: date });
const dinnerOptionUpdateInput = dinnerOptionUpdateSchema.extend({ id: uuid });
const dinnerOptionDeleteInput = z.object({ id: uuid, expectedRevision: z.number().int().positive(), requestKey: dinnerOptionCreateSchema.shape.requestKey }).strict();
const revisionOutput = z.number().int().positive();
const idOutput = z.string().min(1).max(128);
const nullableTextOutput = z.string().max(5000).nullable();
const displayAppearanceScopes = ['mcp:displays:read', 'mcp:displays:appearance:write'] as const;
const displaySetupReadScopes = ['mcp:displays:read', 'mcp:displays:setup:read'] as const;
const displayLayoutWriteScopes = [...displaySetupReadScopes, 'mcp:displays:layout:write'] as const;
const displayAppearanceOutput = z.strictObject({
  id: uuid, name: z.string().min(1).max(200), localeOverride: localeSchema.nullable(), themeOverride: themeSchema.nullable(),
  appearanceRevision: revisionOutput
});
const displayAppearanceColumns = `display.id,display.name,display.locale AS "localeOverride",display.theme AS "themeOverride",
  display.appearance_revision AS "appearanceRevision"`;
const displayAppearanceInput = z.strictObject({
  displayId: uuid, expectedAppearanceRevision: revisionOutput, name: nameSchema.optional(),
  localeOverride: localeSchema.nullable().optional(), themeOverride: themeSchema.nullable().optional()
}).refine(({ name, localeOverride, themeOverride }) => name !== undefined || localeOverride !== undefined || themeOverride !== undefined,
  'Supply at least one display appearance field to update.');
const displayOutput = displayAppearanceOutput.extend({
  locale: localeSchema.nullable(), theme: themeSchema.nullable(), privacyMode: z.boolean(), setupName: z.string().min(1).max(200), createdAt: z.iso.datetime()
});
const setupVersionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const displaySetupOutput = z.strictObject({
  setupVersion: setupVersionSchema, name: z.string().min(1).max(80), revision: revisionOutput,
  cards: z.array(z.enum(displaySetupCards)).max(displaySetupCards.length),
  cardOrder: z.array(z.enum(displaySetupCards)).max(displaySetupCards.length),
  familyLayoutEnabled: z.boolean(), locale: localeSchema, theme: themeSchema
});
const displaySetupInput = z.strictObject({ displayId: uuid });
const displayLayoutWriteInput = displaySetupLayoutSchema.safeExtend({ displayId: uuid, expectedSetupVersion: setupVersionSchema });
const displayLayoutWriteOutput = displaySetupLayoutSchema.safeExtend({ displayId: uuid, setupVersion: setupVersionSchema });

type DisplayAssignment = { setup_id: string; setup_assignment_revision: string };
type DisplaySetup = Omit<z.infer<typeof displaySetupOutput>, 'setupVersion'>;
type DisplayLayout = z.infer<typeof displaySetupLayoutSchema>;
const personOutput = z.object({ id: idOutput, displayName: z.string().min(1).max(100), ageGroup: z.enum(['child', 'teen', 'adult', 'unspecified']), revision: revisionOutput });
const sourceOutput = z.object({ id: idOutput, name: z.string().min(1).max(200), provider: z.string().min(1).max(50), writable: z.boolean().optional() });
const eventOutput = z.object({ id: idOutput, title: z.string().max(500), description: nullableTextOutput, startsAt: z.iso.datetime().nullable(), endsAt: z.iso.datetime().nullable(), allDay: z.boolean(), sourceId: idOutput.nullable(), sourceName: z.string().max(200).nullable(), revision: revisionOutput.optional(), writable: z.boolean().optional(), personIds: z.array(z.uuid()).max(50).optional(), location: z.string().max(160).optional() });
const groceryOutput = z.object({ id: idOutput, label: z.string().min(1).max(200), checked: z.boolean(), revision: revisionOutput, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
const groceryDeletionOutput = z.object({ item: z.object({ id: idOutput, revision: revisionOutput }) });
const dinnerAssignmentOutput = z.object({ id: idOutput, localDate: date, title: z.string().max(500).nullable(), emoji: z.string().max(32).nullable(), revision: z.number().int().positive(), cleared: z.boolean() });
const dinnerOptionOutput = z.object({ id: idOutput, title: z.string().min(1).max(200), emoji: z.string().min(1).max(32), revision: revisionOutput });
const dinnerOptionDeletionOutput = z.object({ option: z.object({ id: idOutput, revision: revisionOutput }) });
const boardAssignmentWriteOutput = z.object({ assignment: z.object({ id: idOutput, localDate: date, title: z.string().max(500).nullable(), emoji: z.string().max(32).nullable(), revision: z.number().int().positive(), cleared: z.boolean() }) });
const messageRecordOutput = z.object({ id: idOutput, body: z.string().max(10000) }).passthrough();
const createdMessageOutput = z.object({ message: z.object({ id: idOutput }).passthrough() });
const editedMessageOutput = z.strictObject({
  message: z.strictObject({ id: uuid, state: z.enum(['scheduled', 'published']), revision: revisionOutput })
});
const withdrawnMessageOutput = z.object({ message: z.object({ id: idOutput, state: z.enum(['withdrawn', 'cancelled']), revision: revisionOutput }).passthrough() });
const MAX_DINNER_DAYS = 31;
function dateOffset(value:string,offset:number):string{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}

export type HouseholdMcpScope = 'mcp:people:read' | 'mcp:people:write' | 'mcp:people:create' | 'mcp:messages:read' | 'mcp:messages:write' | 'mcp:groceries:read' | 'mcp:groceries:write' | 'mcp:dinners:read' | 'mcp:dinners:write' | 'mcp:calendar:read' | 'mcp:calendar:write' | typeof displayAppearanceScopes[number] | typeof displayLayoutWriteScopes[number];
type Capability = MemberCapability;

async function assertLiveAuthority(client: DbClient, principal: HouseholdMcpPrincipal, scopes: readonly HouseholdMcpScope[], capability: Capability): Promise<{personId:string;capabilities:Capability[];calendarWriteAllowed:boolean}> {
  const result = await client.query<{ allowed: boolean; person_id: string; capabilities: Capability[]; calendar_write_allowed: boolean }>(`SELECT (
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
    ) AS allowed,membership.person_id,membership.capabilities,
      (grant_row.scopes ? 'mcp:calendar:write' AND token_set.scopes ? 'mcp:calendar:write'
       AND membership.capabilities ? 'household.manage') AS calendar_write_allowed
    FROM mcp_oauth_grants grant_row
    JOIN mcp_oauth_clients oauth_client ON oauth_client.id=grant_row.client_id
      AND oauth_client.installation_id=grant_row.installation_id AND oauth_client.revoked_at IS NULL
    JOIN mcp_oauth_token_sets token_set ON token_set.grant_id=grant_row.id AND token_set.id=$8
    JOIN memberships membership ON membership.id=grant_row.membership_id AND membership.household_id=grant_row.household_id AND membership.account_id=grant_row.account_id
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id
    JOIN accounts account ON account.id=membership.account_id AND account.installation_id=$4
    JOIN households household ON household.id=grant_row.household_id AND household.installation_id=$4
    WHERE grant_row.id=$1 AND grant_row.household_id=$2 AND grant_row.account_id=$3 AND grant_row.membership_id=$7
    FOR SHARE OF grant_row,token_set,membership,person,account,household,oauth_client`,
    [principal.grantId, principal.householdId, principal.accountId, principal.installationId, scopes, capability, principal.membershipId, principal.tokenSetId]);
  const row = result.rows[0];
  if (!row?.allowed || !uuid.safeParse(row.person_id).success) throw new DomainError('FORBIDDEN', 403);
  return { personId: row.person_id, capabilities: row.capabilities, calendarWriteAllowed: row.calendar_write_allowed };
}

async function lockActiveMcpScopes(client: DbClient, scopes: readonly HouseholdMcpScope[]): Promise<void> {
  const activeScopes = await client.query(`SELECT scope FROM mcp_oauth_scope_catalog
    WHERE scope=ANY($1::text[]) AND active ORDER BY scope FOR SHARE`, [scopes]);
  if (activeScopes.rowCount !== scopes.length) throw new DomainError('FORBIDDEN', 403);
}

async function lockMcpWriteAuthority(client: DbClient, principal: HouseholdMcpPrincipal, scopes: readonly HouseholdMcpScope[], capability: Capability): Promise<void> {
  // Browser administration takes installation and member authority before target
  // rows. OAuth policy changes take member authority before the grant.
  await client.query('SELECT id FROM installations WHERE id=$1 FOR KEY SHARE', [principal.installationId]);
  const actor = await client.query(`SELECT 1 FROM memberships membership JOIN accounts account ON account.id=membership.account_id
    WHERE membership.id=$1 AND membership.household_id=$2 AND account.id=$3 FOR SHARE OF membership,account`,
  [principal.membershipId, principal.householdId, principal.accountId]);
  if (!actor.rowCount) throw new DomainError('FORBIDDEN', 403);
  await assertLiveAuthority(client, principal, scopes, capability);
  await lockActiveMcpScopes(client, scopes);
}

async function lockDisplayWriteAuthority(client: DbClient, principal: HouseholdMcpPrincipal, scopes: readonly HouseholdMcpScope[]): Promise<void> {
  await lockMcpWriteAuthority(client, principal, scopes, 'display.manage');
}

async function lockGrantedDisplayAssignment(
  client: DbClient, principal: HouseholdMcpPrincipal, displayId: string, write: boolean
): Promise<DisplayAssignment> {
  const grant = await client.query(`SELECT 1 FROM mcp_oauth_grant_displays
    WHERE grant_id=$1 AND household_id=$2 AND display_id=$3 FOR SHARE`, [principal.grantId, principal.householdId, displayId]);
  if (!grant.rowCount) throw new DomainError('NOT_FOUND', 404);
  const display = (await client.query<DisplayAssignment>(`SELECT setup_id,setup_assignment_revision::text FROM displays
    WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR ${write ? 'NO KEY UPDATE' : 'SHARE'}`,
  [displayId, principal.householdId])).rows[0];
  if (!display) throw new DomainError('NOT_FOUND', 404);
  return display;
}

async function readLockedDisplaySetup(client: DbClient, householdId: string, setupId: string, write = false): Promise<DisplaySetup> {
  const setup = (await client.query<DisplaySetup>(`SELECT name,revision,cards,card_order AS "cardOrder",
    family_layout_enabled AS "familyLayoutEnabled",locale,theme
    FROM display_setups WHERE household_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`, [householdId, setupId])).rows[0];
  if (!setup) throw new DomainError('NOT_FOUND', 404);
  return setup;
}

function displaySetupVersion(displayId: string, assignment: DisplayAssignment, revision: number): string {
  return createHash('sha256').update(JSON.stringify([
    displayId.toLowerCase(), assignment.setup_id, assignment.setup_assignment_revision, revision
  ])).digest('hex');
}

const setupSelectionTables = [
  ['display_setup_people', 'person_id'],
  ['display_setup_sources', 'connection_id'],
  ['display_setup_calendar_sources', 'source_id'],
  ['display_setup_sensors', 'sensor_id']
] as const;

async function updateOwnedDisplaySetupLayout(
  client: DbClient, householdId: string, displayId: string, setupId: string, revision: number, layout: DisplayLayout
): Promise<number | undefined> {
  // The caller holds the source setup FOR UPDATE. Browser assignment and its
  // foreign key take conflicting setup locks. Check references in a fresh
  // statement after acquiring the lock, without locking other display rows.
  const updated = await client.query<{ revision: number }>(`WITH changed AS (UPDATE display_setups setup SET
      cards=$5::jsonb,card_order=$6::jsonb,family_layout_enabled=$7,revision=setup.revision+1,updated_at=clock_timestamp()
    WHERE setup.household_id=$1 AND setup.id=$2 AND setup.revision=$4 AND NOT setup.is_default
      AND EXISTS (SELECT 1 FROM mcp_display_layout_ownership ownership
        WHERE ownership.household_id=$1 AND ownership.setup_id=$2 AND ownership.display_id=$3
          AND ownership.last_mcp_revision=setup.revision)
      AND NOT EXISTS (SELECT 1 FROM displays other
        WHERE other.household_id=$1 AND other.setup_id=$2 AND other.id<>$3)
    RETURNING setup.revision)
    UPDATE mcp_display_layout_ownership ownership SET last_mcp_revision=changed.revision FROM changed
    WHERE ownership.setup_id=$2 RETURNING ownership.last_mcp_revision AS revision`,
  [householdId, setupId, displayId, revision, JSON.stringify(layout.cards), JSON.stringify(layout.cardOrder), layout.familyLayoutEnabled]);
  return updated.rows[0]?.revision;
}

async function cloneDisplaySetupLayout(
  client: DbClient, householdId: string, setupId: string, revision: number, layout: DisplayLayout
): Promise<{ id: string; revision: number }> {
  const clone = (await client.query<{ id: string; revision: number }>(`INSERT INTO display_setups(
      household_id,name,cards,card_order,family_layout_enabled,all_sources,all_sensors,
      is_default,album_ids,background_id,locale,theme)
    SELECT household_id,name,$4::jsonb,$5::jsonb,$6,all_sources,all_sensors,false,album_ids,background_id,locale,theme
    FROM display_setups WHERE household_id=$1 AND id=$2 AND revision=$3 RETURNING id,revision`,
  [householdId, setupId, revision, JSON.stringify(layout.cards), JSON.stringify(layout.cardOrder), layout.familyLayoutEnabled])).rows[0];
  if (!clone) throw new DomainError('REVISION_CONFLICT', 409);
  for (const [table, column] of setupSelectionTables) {
    await client.query(`INSERT INTO ${table}(household_id,setup_id,${column})
      SELECT household_id,$3,${column} FROM ${table} WHERE household_id=$1 AND setup_id=$2`, [householdId, setupId, clone.id]);
  }
  return clone;
}

function sameDisplayLayout(current: DisplayLayout, requested: DisplayLayout): boolean {
  return current.familyLayoutEnabled === requested.familyLayoutEnabled
    && current.cards.length === requested.cards.length
    && requested.cards.every((card) => current.cards.includes(card))
    && current.cardOrder.length === requested.cardOrder.length
    && current.cardOrder.every((card, index) => card === requested.cardOrder[index]);
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

  registrar.registerTool('household.displays.list', {
    description: 'List non-revoked displays explicitly approved for this client. Includes appearance overrides and their revision for a conditional appearance update.',
    inputSchema: emptyInput, outputSchema: z.object({ displays: z.array(displayOutput).max(100) }), requiredScopes: ['mcp:displays:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:displays:read'], 'display.manage');
      const result = await client.query(`SELECT ${displayAppearanceColumns},
          COALESCE(display.locale,setup.locale) AS locale,COALESCE(display.theme,setup.theme) AS theme,
          display.privacy_mode AS "privacyMode",setup.name AS "setupName",display.created_at AS "createdAt"
        FROM mcp_oauth_grant_displays grant_display
        JOIN displays display ON display.id=grant_display.display_id AND display.household_id=grant_display.household_id
        JOIN display_setups setup ON setup.id=display.setup_id AND setup.household_id=display.household_id
        WHERE grant_display.grant_id=$1 AND grant_display.household_id=$2 AND display.revoked_at IS NULL
        ORDER BY display.id LIMIT 100 FOR SHARE OF grant_display,display,setup`, [principal.grantId, principal.householdId]);
      return { displays: result.rows };
    });
  });

  registrar.registerTool('household.displays.setup.get', {
    description: 'Read the minimal layout and appearance configuration for one explicitly approved, active display, with a setupVersion for conditional layout updates. Does not return people, sources, sensors, albums, backgrounds, device permissions, or credentials.',
    inputSchema: displaySetupInput, outputSchema: z.strictObject({ setup: displaySetupOutput }),
    requiredScopes: displaySetupReadScopes, readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    const { displayId } = displaySetupInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, displaySetupReadScopes, 'display.manage');
      const assignment = await lockGrantedDisplayAssignment(client, principal, displayId, false);
      const setup = await readLockedDisplaySetup(client, principal.householdId, assignment.setup_id);
      // Recheck token/grant/member authority after waiting on the selected rows.
      await assertLiveAuthority(client, principal, displaySetupReadScopes, 'display.manage');
      await dependencies.displaySetupReadAudit?.(client, displayId, setup.revision);
      return { setup: { ...setup, setupVersion: displaySetupVersion(displayId, assignment, setup.revision) } };
    });
  });

  registrar.registerTool('household.displays.layout.update', {
    description: 'Replace the selected cards, card order, and family layout setting of one explicitly approved display. Use the current setupVersion from household.displays.setup.get. The display uses its own setup after the change and retains its existing content selections, access permissions, and appearance.',
    inputSchema: displayLayoutWriteInput, outputSchema: z.strictObject({ layout: displayLayoutWriteOutput }),
    requiredScopes: displayLayoutWriteScopes, readOnlyHint: false, destructiveHint: false, idempotentHint: false
  }, async (raw) => {
    const { displayId, expectedSetupVersion, ...layout } = displayLayoutWriteInput.parse(raw);
    const audit = dependencies.displayLayoutAudit;
    if (!audit) throw new DomainError('FORBIDDEN', 403);
    return dependencies.transaction(async (client) => {
      await lockDisplayWriteAuthority(client, principal, displayLayoutWriteScopes);
      const assignment = await lockGrantedDisplayAssignment(client, principal, displayId, true);
      // Media deletion clears setup references under this lock. Take it before
      // reading the source so the clone cannot revive a removed selection.
      await client.query('INSERT INTO media_household_usage(household_id) VALUES($1) ON CONFLICT DO NOTHING', [principal.householdId]);
      await client.query('SELECT household_id FROM media_household_usage WHERE household_id=$1 FOR UPDATE', [principal.householdId]);
      const current = await readLockedDisplaySetup(client, principal.householdId, assignment.setup_id, true);
      await assertLiveAuthority(client, principal, displayLayoutWriteScopes, 'display.manage');
      if (displaySetupVersion(displayId, assignment, current.revision) !== expectedSetupVersion) {
        throw new DomainError('REVISION_CONFLICT', 409);
      }
      if (sameDisplayLayout(current, layout)) {
        const { cards, cardOrder, familyLayoutEnabled } = current;
        return { layout: { displayId, setupVersion: expectedSetupVersion, cards, cardOrder, familyLayoutEnabled } };
      }

      let updated = assignment;
      let revision = await updateOwnedDisplaySetupLayout(client, principal.householdId, displayId, assignment.setup_id, current.revision, layout);
      if (revision === undefined) {
        const clone = await cloneDisplaySetupLayout(client, principal.householdId, assignment.setup_id, current.revision, layout);
        const reassigned = (await client.query<DisplayAssignment>(`UPDATE displays SET setup_id=$5
          WHERE id=$1 AND household_id=$2 AND setup_id=$3 AND setup_assignment_revision=$4 AND revoked_at IS NULL
          RETURNING setup_id,setup_assignment_revision::text`,
        [displayId, principal.householdId, assignment.setup_id, assignment.setup_assignment_revision, clone.id])).rows[0];
        if (!reassigned) throw new DomainError('REVISION_CONFLICT', 409);
        await client.query('INSERT INTO mcp_display_layout_ownership(household_id,setup_id,display_id,last_mcp_revision) VALUES($1,$2,$3,$4)',
          [principal.householdId, clone.id, displayId, clone.revision]);
        updated = reassigned;
        revision = clone.revision;
      }
      const setupVersion = displaySetupVersion(displayId, updated, revision);
      await audit(client, displayId, revision, setupVersion);
      await assertLiveAuthority(client, principal, displayLayoutWriteScopes, 'display.manage');
      return { layout: { displayId, setupVersion, ...layout } };
    });
  });

  registrar.registerTool('household.displays.appearance.update', {
    description: 'Update the name, language override, or theme override of one explicitly approved display. Pass its current appearance revision from household.displays.list. Set an override to null to inherit the display setup setting.',
    inputSchema: displayAppearanceInput, outputSchema: z.strictObject({ display: displayAppearanceOutput }),
    requiredScopes: displayAppearanceScopes, readOnlyHint: false, destructiveHint: false, idempotentHint: false
  }, async (raw) => {
    const { displayId, expectedAppearanceRevision, name, localeOverride, themeOverride } = displayAppearanceInput.parse(raw);
    const audit = dependencies.displayAppearanceAudit;
    if (!audit) throw new DomainError('FORBIDDEN', 403);
    return dependencies.transaction(async (client) => {
      await lockDisplayWriteAuthority(client, principal, displayAppearanceScopes);
      const current = (await client.query<z.infer<typeof displayAppearanceOutput>>(`SELECT ${displayAppearanceColumns}
        FROM mcp_oauth_grant_displays grant_display
        JOIN displays display ON display.id=grant_display.display_id AND display.household_id=grant_display.household_id
        WHERE grant_display.grant_id=$1 AND grant_display.household_id=$2 AND grant_display.display_id=$3 AND display.revoked_at IS NULL
        FOR SHARE OF grant_display FOR NO KEY UPDATE OF display`, [principal.grantId, principal.householdId, displayId])).rows[0];
      if (!current) throw new DomainError('NOT_FOUND', 404);
      // Locks fence consent and account changes. The token may still expire
      // while we wait for a busy display row.
      await assertLiveAuthority(client, principal, displayAppearanceScopes, 'display.manage');
      if (current.appearanceRevision !== expectedAppearanceRevision) throw new DomainError('REVISION_CONFLICT', 409);
      const nextName = name ?? current.name;
      const nextLocale = localeOverride === undefined ? current.localeOverride : localeOverride;
      const nextTheme = themeOverride === undefined ? current.themeOverride : themeOverride;
      if (nextName === current.name && nextLocale === current.localeOverride && nextTheme === current.themeOverride) return { display: current };

      const display = (await client.query<z.infer<typeof displayAppearanceOutput>>(`UPDATE displays AS display SET
        name=$4,locale=$5,theme=$6
        WHERE id=$1 AND household_id=$2 AND appearance_revision=$3 AND revoked_at IS NULL
        RETURNING ${displayAppearanceColumns}`,
      [displayId, principal.householdId, expectedAppearanceRevision, nextName, nextLocale, nextTheme])).rows[0];
      if (!display) throw new DomainError('REVISION_CONFLICT', 409);
      await audit(client, display.id, display.appearanceRevision);
      return { display };
    });
  });

  registrar.registerTool('household.people.update', {
    description: 'Update the profile of one explicitly approved household person. Does not change their account, roles, or permissions.',
    inputSchema: personUpdateInput, outputSchema: z.object({ id: idOutput, revision: revisionOutput }), requiredScopes: ['mcp:people:write'], readOnlyHint: false, destructiveHint: false, idempotentHint: false
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
      const updated = await updatePersonProfile(client, principal.householdId, personId, body,
        (auditClient, updatedPersonId, fields) => dependencies.personProfileAudit!(auditClient, updatedPersonId, fields));
      return { id: updated.id, revision: updated.revision };
    });
  });

  registrar.registerTool('household.people.create_profile', {
    description: 'Create a basic accountless household person profile. The profile has unspecified age and household viewing only; it receives no login, invitation, display access, or MCP person grant.',
    inputSchema: z.strictObject({ displayName: nameSchema, requestKey: uuid }),
    outputSchema: z.strictObject({ creation: z.strictObject({ personId: uuid, createdRevision: z.literal(1), hadLoginAtCreation: z.literal(false) }) }),
    requiredScopes: ['mcp:people:create'], readOnlyHint: false, destructiveHint: false, idempotentHint: true
  }, async (raw) => {
    const input = z.strictObject({ displayName: nameSchema, requestKey: uuid }).parse(raw);
    const keyedDigest = dependencies.profileDigest;
    if (!keyedDigest) throw new DomainError('CONFLICT', 409, { reason: 'profile_digest_unavailable' });
    return dependencies.transaction((client) => createMcpPersonProfile(client, principal, input, async () => {
      // Keep the creation lock first, then lock live authority and the catalog
      // row. Do not add the display writer's member-before-household prelocks.
      await assertLiveAuthority(client, principal, ['mcp:people:create'], 'people.manage');
      await lockActiveMcpScopes(client, ['mcp:people:create']);
    }, keyedDigest));
  });

  registrar.registerTool('calendar.sources.list', {
    description: 'List only calendar sources currently granted to this client and readable by the delegated household member.',
    inputSchema: emptyInput, outputSchema: z.object({ sources: z.array(sourceOutput).max(100) }), requiredScopes: ['mcp:calendar:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:calendar:read'], 'household.view');
      const sources = await listLiveCalendarSources(client, principal);
      const native = authority.capabilities?.includes('household.manage') && await hasNativeCalendarGrant(client, principal);
      return { sources: native
        ? [{ id: principal.householdId, name: NATIVE_CALENDAR_NAME, provider: 'samvev', writable: authority.calendarWriteAllowed }, ...sources].slice(0, 100)
        : sources };
    });
  });

  registrar.registerTool('calendar.events.list', {
    description: 'List upcoming events only from calendar sources and for people explicitly approved for this OAuth authorization.',
    inputSchema: calendarInput, outputSchema: z.object({ events: z.array(eventOutput).max(50) }), requiredScopes: ['mcp:calendar:read'], readOnlyHint: true, destructiveHint: false
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
      if (!people.rows.length) return { events: [] };
      const native = authority.capabilities?.includes('household.manage') && await hasNativeCalendarGrant(client, principal);
      if (!sources.length && !native) return { events: [] };
      const household = await client.query<{ timezone: string }>('SELECT timezone FROM households WHERE id=$1 AND installation_id=$2 FOR SHARE', [principal.householdId, principal.installationId]);
      if (!household.rows[0]) throw new DomainError('FORBIDDEN', 403);
      const from = localDateInTimezone(new Date(), household.rows[0].timezone);
      const rows = await readCalendarActivityRows({
        householdId: principal.householdId, personIds: people.rows.map((row) => row.id),
        viewer: { personId: authority.personId, membershipId: principal.membershipId }, canViewAll: true,
        from, to: dateOffset(from, input.days - 1), limit: input.limit, sourceIds: sources.map((row) => row.id), upcomingOnly: true, requirePersonAudience: true, nativeSourceApproved: Boolean(native)
      }, client);
      const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
      return { events: rows.slice(0, input.limit).map((row) => {
        const nativeEvent = native && row.activity_source_id === principal.householdId;
        return {
          id: row.id, title: row.title, description: nativeEvent && row.metadata.descriptionEmpty === true ? null : row.body,
          startsAt: row.starts_at?.toISOString() ?? null, endsAt: row.ends_at?.toISOString() ?? null, allDay: row.metadata.allDay === true,
          sourceId: row.activity_source_id,
          sourceName: nativeEvent ? NATIVE_CALENDAR_NAME : row.activity_source_id ? sourceNames.get(row.activity_source_id) ?? null : null,
          ...(nativeEvent && { revision: row.revision, personIds: row.person_ids, writable: authority.calendarWriteAllowed,
            ...(typeof row.metadata.location === 'string' && { location: row.metadata.location }) })
        };
      }) };
    });
  });

  registerCalendarWriteTools(registrar, principal, {
    transaction: dependencies.transaction,
    assertWriteAuthority: async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:calendar:read', 'mcp:calendar:write'], 'household.view');
      if (!authority.capabilities.includes('household.manage')) throw new DomainError('FORBIDDEN', 403);
    },
    audit: async (client, action, eventId, revision) => {
      if (!dependencies.calendarAudit) throw new DomainError('FORBIDDEN', 403);
      await dependencies.calendarAudit(client, action, eventId, revision);
    }
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
    description: 'List only household people explicitly included in this OAuth grant.', inputSchema: emptyInput, outputSchema: z.object({ people: z.array(personOutput).max(100) }),
    requiredScopes: ['mcp:people:read'], readOnlyHint: true, destructiveHint: false
  }, async (raw) => {
    emptyInput.parse(raw);
    return dependencies.transaction(async (client) => {
      await assertLiveAuthority(client, principal, ['mcp:people:read'], 'household.view');
      const result = await client.query(`SELECT person.id,person.display_name AS "displayName",person.age_group AS "ageGroup",person.revision
        FROM mcp_oauth_grant_people grant_person
        JOIN persons person ON person.id=grant_person.person_id AND person.household_id=grant_person.household_id
        WHERE grant_person.grant_id=$1 AND grant_person.household_id=$2
        ORDER BY person.display_name,person.id LIMIT 100 FOR SHARE OF grant_person,person`, [principal.grantId, principal.householdId]);
      return { people: result.rows };
    });
  });

  registrar.registerTool('household.messages.list', {
    description: 'List messages visible to this household member, including household messages and messages for people explicitly granted to this OAuth authorization.',
    inputSchema: emptyInput, outputSchema: z.object({ messages: z.array(messageRecordOutput).max(200) }), requiredScopes: ['mcp:messages:read'], readOnlyHint: true, destructiveHint: false
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

  const messageActor: MessageCreateActor = {
    accountId: principal.accountId, installationId: principal.installationId, householdId: principal.householdId,
    membershipId: principal.membershipId, mcpGrantId: principal.grantId
  };

  registrar.registerTool('household.messages.create', {
    description: 'Create and publish or schedule one message for explicitly granted people or displays. Household-wide broadcasts are not supported; each recipient must also be permitted for the delegated member.',
    inputSchema: messageCreateSchema, outputSchema: createdMessageOutput, requiredScopes: ['mcp:messages:read', 'mcp:messages:write'], readOnlyHint: false, destructiveHint: false, idempotentHint: true
  }, async (raw) => {
    const created = await (dependencies.messageService ?? messageService).create(messageActor, raw, async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:messages:read', 'mcp:messages:write'], 'message.create.household');
      return authority.capabilities;
    });
    return { message: created };
  });

  registrar.registerTool('household.messages.edit', {
    description: 'Edit a scheduled or published message authored by this member or managed with current message management rights. All existing and replacement recipients must be explicitly granted people or displays. Omit the audience to keep the existing recipients, or supply a complete replacement audience.',
    inputSchema: messageEditInput, outputSchema: editedMessageOutput, requiredScopes: ['mcp:messages:read', 'mcp:messages:write'], readOnlyHint: false, destructiveHint: true, idempotentHint: false
  }, async (raw) => {
    const { messageId, ...input } = messageEditInput.parse(raw);
    const edited = await (dependencies.messageService ?? messageService).edit(messageActor, messageId, input, async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:messages:read', 'mcp:messages:write'], 'household.view');
      return authority.capabilities;
    }, dependencies.messageEditAudit);
    return { message: { id: edited.id, state: edited.state, revision: edited.revision } };
  });

  registrar.registerTool('household.messages.withdraw', {
    description: 'Withdraw or cancel one message authored by this member, or managed by a member with current message management rights. Every recipient must be explicitly granted to this OAuth authorization and permitted for the member.',
    inputSchema: messageWithdrawInput, outputSchema: withdrawnMessageOutput, requiredScopes: ['mcp:messages:read', 'mcp:messages:write'], readOnlyHint: false, destructiveHint: true, idempotentHint: false
  }, async (raw) => {
    const input = messageWithdrawInput.parse(raw);
    const withdrawn = await (dependencies.messageService ?? messageService).withdraw(messageActor, input.messageId, input.expectedRevision, async (client) => {
      const authority = await assertLiveAuthority(client, principal, ['mcp:messages:read', 'mcp:messages:write'], 'household.view');
      return authority.capabilities;
    }, dependencies.messageWithdrawAudit);
    return { message: withdrawn };
  });

  registrar.registerTool('household.groceries.list', {
    description: 'Read the household grocery list with explicit whole-household consent.', inputSchema: emptyInput, outputSchema: z.object({ items: z.array(groceryOutput).max(200) }),
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
    description: 'Add one grocery item. Requires a durable request key for safe retries.', inputSchema: groceryCreateSchema, outputSchema: z.object({ item: groceryOutput }),
    requiredScopes: ['mcp:groceries:read', 'mcp:groceries:write'], readOnlyHint: false, destructiveHint: false, idempotentHint: true
  }, async (raw) => boardService.createGrocery(boardActor, groceryCreateSchema.parse(raw)));

  registrar.registerTool('household.groceries.update', {
    description: 'Update, check, or uncheck one grocery item using its current revision and a durable request key.', inputSchema: groceryUpdateInput, outputSchema: z.object({ item: groceryOutput }),
    requiredScopes: ['mcp:groceries:read', 'mcp:groceries:write'], readOnlyHint: false, destructiveHint: false, idempotentHint: true
  }, async (raw) => {
    const { id, ...input } = groceryUpdateInput.parse(raw);
    return boardService.updateGrocery(boardActor, id, input);
  });

  registrar.registerTool('household.groceries.delete', {
    description: 'Remove one grocery item using its current revision and a durable request key.', inputSchema: groceryDeleteInput, outputSchema: groceryDeletionOutput,
    requiredScopes: ['mcp:groceries:read', 'mcp:groceries:write'], readOnlyHint: false, destructiveHint: true, idempotentHint: true
  }, async (raw) => {
    const { id, ...input } = groceryDeleteInput.parse(raw);
    return boardService.deleteGrocery(boardActor, id, input, async (client, result) => {
      if (dependencies.groceryDeleteAudit) return dependencies.groceryDeleteAudit(client, 'mcp.grocery_deleted', result.item.id);
      await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id)
        VALUES($1,$2,'mcp',$3,'mcp.grocery_deleted','grocery_item',$4)`, [principal.installationId, principal.householdId, principal.grantId, result.item.id]);
    });
  });

  registrar.registerTool('household.dinners.list', {
    description: 'Read assigned dinners for a date range of at most 31 days, with explicit whole-household consent.', inputSchema: dinnersInput, outputSchema: z.object({ from: date, to: date, assignments: z.array(dinnerAssignmentOutput).max(62) }),
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
    description: 'List dinner options that may be assigned to a date.', inputSchema: emptyInput, outputSchema: z.object({ options: z.array(dinnerOptionOutput).max(100) }),
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
    description: 'Assign or clear a dinner option for one date using its current revision and a durable request key.', inputSchema: dinnerAssignmentInput, outputSchema: boardAssignmentWriteOutput,
    requiredScopes: ['mcp:dinners:read', 'mcp:dinners:write'], readOnlyHint: false, destructiveHint: true, idempotentHint: true
  }, async (raw) => {
    const { localDate, ...input } = dinnerAssignmentInput.parse(raw);
    return boardService.setDinner(boardActor, localDate, input);
  });

  registrar.registerTool('household.dinners.options.create', {
    description: 'Create a dinner option using a durable request key for safe retries.', inputSchema: dinnerOptionCreateSchema, outputSchema: z.object({ option: dinnerOptionOutput }),
    requiredScopes: ['mcp:dinners:read', 'mcp:dinners:write'], readOnlyHint: false, destructiveHint: false, idempotentHint: true
  }, async (raw) => boardService.createDinnerOption(boardActor, dinnerOptionCreateSchema.parse(raw), dependencies.dinnerOptionAudit ? (client, result) => dependencies.dinnerOptionAudit!(client, 'mcp.dinner_option_created', result.option.id) : undefined));

  registrar.registerTool('household.dinners.options.update', {
    description: 'Update one dinner option using its current revision and a durable request key.', inputSchema: dinnerOptionUpdateInput, outputSchema: z.object({ option: dinnerOptionOutput }),
    requiredScopes: ['mcp:dinners:read', 'mcp:dinners:write'], readOnlyHint: false, destructiveHint: false, idempotentHint: true
  }, async (raw) => {
    const { id, ...input } = dinnerOptionUpdateInput.parse(raw);
    return boardService.updateDinnerOption(boardActor, id, input, dependencies.dinnerOptionAudit ? (client, result) => dependencies.dinnerOptionAudit!(client, 'mcp.dinner_option_updated', result.option.id) : undefined);
  });

  registrar.registerTool('household.dinners.options.delete', {
    description: 'Remove one dinner option using its current revision and a durable request key. Existing dinner assignments keep their saved title and emoji.', inputSchema: dinnerOptionDeleteInput, outputSchema: dinnerOptionDeletionOutput,
    requiredScopes: ['mcp:dinners:read', 'mcp:dinners:write'], readOnlyHint: false, destructiveHint: true, idempotentHint: true
  }, async (raw) => {
    const { id, ...input } = dinnerOptionDeleteInput.parse(raw);
    return boardService.deleteDinnerOption(boardActor, id, input, dependencies.dinnerOptionAudit ? (client, result) => dependencies.dinnerOptionAudit!(client, 'mcp.dinner_option_deleted', result.option.id) : undefined);
  });
}

/** Exported for focused authorization tests without registering an MCP server. */
export const householdToolSchemas = { emptyInput, dinnersInput, groceryUpdateInput, groceryDeleteInput, dinnerAssignmentInput, dinnerOptionUpdateInput, dinnerOptionDeleteInput, personUpdateInput, messageEditInput, messageWithdrawInput } as const;
