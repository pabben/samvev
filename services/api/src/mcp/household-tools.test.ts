import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '@samvev/core';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { DbClient } from '../db.ts';
import { householdToolSchemas, registerHouseholdTools, type HouseholdMcpScope, type HouseholdMcpToolContext, type HouseholdMcpToolRegistrar } from './household-tools.ts';

const principal = {
  tokenSetId: '66666666-6666-4666-8666-666666666666',
  grantId: '11111111-1111-4111-8111-111111111111', householdId: '22222222-2222-4222-8222-222222222222',
  accountId: '33333333-3333-4333-8333-333333333333', membershipId: '44444444-4444-4444-8444-444444444444',
  installationId: '55555555-5555-4555-8555-555555555555'
};
const context: HouseholdMcpToolContext = { principal };

class Tools implements HouseholdMcpToolRegistrar {
  readonly handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  readonly options = new Map<string, { description: string; inputSchema: ZodType; outputSchema: ZodType; requiredScopes: readonly [HouseholdMcpScope, ...HouseholdMcpScope[]]; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean }>();
  registerTool(name: string, options: { description: string; inputSchema: ZodType; outputSchema: ZodType; requiredScopes: readonly [HouseholdMcpScope, ...HouseholdMcpScope[]]; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint?: boolean }, handler: (input: unknown) => Promise<unknown>) { this.options.set(name, options); this.handlers.set(name, handler); }
  get(name: string) { const handler = this.handlers.get(name); assert.ok(handler, `tool ${name} registered`); return handler; }
}

test('all household tools publish meaningful output schemas that validate returned projections', () => {
  const tools = new Tools();
  registerHouseholdTools(tools, context, { transaction: async <T>(run: (client: DbClient) => Promise<T>) => run({ query: async () => ({ rows: [] }) } as unknown as DbClient) });
  assert.equal(tools.options.size, 26);
  for (const [name, options] of tools.options) {
    assert.ok(options.outputSchema instanceof Object, `${name} has an output schema`);
    assert.equal(options.outputSchema.safeParse(null).success, false, `${name} schema rejects unrelated values`);
    assert.doesNotThrow(() => z.toJSONSchema(options.outputSchema), `${name} output schema converts to JSON Schema`);
  }
  const samples: Record<string, unknown> = {
    'household.displays.list': { displays: [] },
    'household.displays.setup.get': { setup: { setupVersion: 'a'.repeat(64), name: 'Synthetic setup', revision: 2, cards: ['family_layout'], cardOrder: ['family_layout'], familyLayoutEnabled: true, locale: 'nb', theme: 'dark' } },
    'household.displays.layout.update': { layout: { displayId: principal.membershipId, setupVersion: 'a'.repeat(64), cards: ['family_layout'], cardOrder: ['family_layout'], familyLayoutEnabled: true } },
    'household.displays.appearance.update': { display: { id: principal.membershipId, name: 'Synthetic display', localeOverride: null, themeOverride: 'dark', appearanceRevision: 2 } },
    'household.people.update': { id: principal.membershipId, revision: 2 },
    'household.people.create_profile': { creation: { personId: principal.membershipId, createdRevision: 1, hadLoginAtCreation: false } },
    'calendar.sources.list': { sources: [{ id: 'source-1', name: 'Synthetic calendar', provider: 'ics' }] },
    'calendar.events.create': { event: { id: principal.accountId, revision: 1 } },
    'calendar.events.update': { event: { id: principal.accountId, revision: 2 } },
    'calendar.events.delete': { event: { id: principal.accountId, revision: 3 } },
    'calendar.events.list': { events: [{ id: 'event-1', title: 'Synthetic event', description: null, startsAt: '2027-03-20T09:00:00.000Z', endsAt: null, allDay: false, sourceId: 'source-1', sourceName: 'Synthetic calendar' }] },
    'household.people.list': { people: [{ id: 'person-1', displayName: 'Synthetic member', ageGroup: 'adult', revision: 1 }, { id: 'person-2', displayName: 'Synthetic profile', ageGroup: 'unspecified', revision: 1 }] },
    'household.messages.list': { messages: [{ id: 'message-1', body: 'Synthetic message' }] },
    'household.messages.create': { message: { id: 'message-1' } },
    'household.messages.edit': { message: { id: principal.accountId, state: 'published', revision: 2 } },
    'household.messages.withdraw': { message: { id: 'message-1', state: 'withdrawn', revision: 2 } },
    'household.groceries.list': { items: [{ id: 'grocery-1', label: 'Synthetic apples', checked: false, revision: 1, createdAt: '2027-03-20T09:00:00.000Z', updatedAt: '2027-03-20T09:00:00.000Z' }] },
    'household.groceries.add': { item: { id: 'grocery-1', label: 'Synthetic apples', checked: false, revision: 1, createdAt: '2027-03-20T09:00:00.000Z', updatedAt: '2027-03-20T09:00:00.000Z' } },
    'household.groceries.update': { item: { id: 'grocery-1', label: 'Synthetic apples', checked: true, revision: 2, createdAt: '2027-03-20T09:00:00.000Z', updatedAt: '2027-03-20T09:01:00.000Z' } },
    'household.groceries.delete': { item: { id: 'grocery-1', revision: 2 } },
    'household.dinners.list': { from: '2027-03-20', to: '2027-03-20', assignments: [{ id: 'assignment-1', localDate: '2027-03-20', title: null, emoji: null, revision: 1, cleared: true }] },
    'household.dinners.options.list': { options: [{ id: 'option-1', title: 'Synthetic soup', emoji: '🍲', revision: 1 }] },
    'household.dinners.assign': { assignment: { id: 'assignment-1', localDate: '2027-03-20', title: 'Synthetic soup', emoji: '🍲', revision: 1, cleared: false } },
    'household.dinners.options.create': { option: { id: 'option-1', title: 'Synthetic soup', emoji: '🍲', revision: 1 } },
    'household.dinners.options.update': { option: { id: 'option-1', title: 'Synthetic soup', emoji: '🍲', revision: 2 } },
    'household.dinners.options.delete': { option: { id: 'option-1', revision: 2 } }
  };
  for (const [name, result] of Object.entries(samples)) assert.equal(tools.options.get(name)?.outputSchema.safeParse(result).success, true, `${name} accepts its returned output shape`);
});

test('MCP accountless profile tool has strict request, minimal output, and fresh create scope',()=>{
  const tools=new Tools();
  registerHouseholdTools(tools,context,{transaction:async <T>(run:(client:DbClient)=>Promise<T>)=>run({query:async()=>({rows:[]})} as unknown as DbClient)});
  const options=tools.options.get('household.people.create_profile')!;
  assert.deepEqual(options.requiredScopes,['mcp:people:create']);
  assert.equal(options.idempotentHint,true);
  assert.equal(options.inputSchema.safeParse({displayName:'Synthetic profile',requestKey:'11111111-1111-4111-8111-111111111111',ageGroup:'adult'}).success,false);
  assert.equal(options.inputSchema.safeParse({displayName:'Synthetic profile',requestKey:'11111111-1111-4111-8111-111111111111'}).success,true);
  assert.equal(options.outputSchema.safeParse({creation:{personId:principal.membershipId,createdRevision:1,hadLoginAtCreation:false,accountId:principal.accountId}}).success,false);
});

function dependencies(options: { allowed?: boolean; people?: unknown[] } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes('FROM mcp_oauth_grants')) return { rows: [{ allowed: options.allowed ?? true, person_id: '77777777-7777-4777-8777-777777777777', capabilities: ['household.view', 'message.create.household', 'message.schedule', 'message.publish.display'] }] };
    if (sql.includes('FROM messages m')) return { rows: [{ id: 'synthetic-message', body: 'Synthetic household message' }] };
    if (sql.includes('FROM mcp_oauth_grant_people')) return { rows: options.people ?? [{ id: 'person-granted', displayName: 'Granted member', ageGroup: 'adult' }] };
    if (sql.includes('household_grocery_items')) return { rows: [{ id: 'grocery-1', label: 'Synthetic apples', checked: false }] };
    if (sql.includes('household_dinner_assignments')) return { rows: [{ localDate: '2027-03-20', title: 'Synthetic soup' }] };
    throw new Error('Unexpected SQL in focused MCP test');
  } } as unknown as DbClient;
  return { calls, client, deps: { transaction: async <T>(run: (client: DbClient) => Promise<T>) => run(client) } };
}

test('calendar tool is source and person bounded and returns a curated event projection', async () => {
  const tools = new Tools(), calls: Array<{ sql: string; values?: unknown[] }> = [];
  const event = { id: 'event-1', title: 'Synthetic appointment', body: 'Synthetic details', starts_at: new Date('2027-03-30T08:00:00Z'), ends_at: null,
    metadata: { allDay: true, calendar: { url: 'https://private.invalid' } }, activity_source_id: 'source-1' };
  const extraEvent = { ...event, id: 'event-2', title: 'Synthetic beyond limit' };
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes('FROM mcp_oauth_grants')) return { rows: [{ allowed: true, person_id: '77777777-7777-4777-8777-777777777777' }] };
    if (sql.includes('FROM mcp_oauth_grant_people')) return { rows: [{ id: 'person-granted' }] };
    if (sql.includes('FROM mcp_oauth_grant_resources')) return { rows: [{ id: 'source-1', name: 'Synthetic calendar' }] };
    if (sql.includes('SELECT timezone FROM households')) return { rows: [{ timezone: 'Europe/Oslo' }] };
    if (sql.includes('explicit_person')) return { rows: [event, extraEvent] };
    throw new Error('Unexpected calendar query');
  } } as unknown as DbClient;
  registerHouseholdTools(tools, context, { transaction: async <T>(run: (client: DbClient) => Promise<T>) => run(client) });
  const result = await tools.get('calendar.events.list')({ days: 2, limit: 1 }) as { events: Array<Record<string, unknown>> };
  assert.deepEqual(result.events, [{ id: 'event-1', title: 'Synthetic appointment', description: 'Synthetic details', startsAt: '2027-03-30T08:00:00.000Z', endsAt: null, allDay: true, sourceId: 'source-1', sourceName: 'Synthetic calendar' }]);
  assert.deepEqual(tools.options.get('calendar.events.list')?.requiredScopes, ['mcp:calendar:read']);
  assert.equal(tools.options.get('calendar.events.list')?.readOnlyHint, true);
  assert.match(calls[1]!.sql, /grant_person\.grant_id=\$1 AND grant_person\.household_id=\$2/);
  assert.match(calls[2]!.sql, /grant_resource\.resource_kind='calendar_source'/);
  assert.match(calls[2]!.sql, /viewer\.capabilities \? 'household\.manage' OR source\.target_household OR EXISTS/);
  assert.match(calls[2]!.sql, /connection\.disconnected_at IS NULL/);
  assert.match(calls[4]!.sql, /i\.household_id=\$1/);
  assert.match(calls[4]!.sql, /explicit_person\.person_id=ANY\(\$2::uuid\[\]\)/);
  assert.match(calls[4]!.sql, /explicit_target\.person_id=ANY\(\$2::uuid\[\]\)/);
  assert.equal(calls[4]!.values?.[6], 2, 'query fetches one extra row for pagination, while the MCP response stays at the requested limit');
  assert.equal(calls[4]!.values?.[7] instanceof Array, true, 'the event query receives only source ids from the grant');
  assert.equal(calls[4]!.values?.[19], true, 'household-wide source events still require an explicitly granted person audience');
  assert.doesNotMatch(JSON.stringify(result), /private\.invalid|url|credentials|metadata/i);
});

test('calendar source discovery returns only live granted readable sources without connection secrets', async () => {
  const tools = new Tools(), calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes('FROM mcp_oauth_grants')) return { rows: [{ allowed: true, person_id: '77777777-7777-4777-8777-777777777777' }] };
    if (sql.includes('FROM mcp_oauth_grant_resources')) return { rows: [{ id: 'source-1', name: 'Synthetic calendar', provider: 'ics' }] };
    throw new Error('Unexpected calendar source query');
  } } as unknown as DbClient;
  registerHouseholdTools(tools, context, { transaction: async <T>(run: (client: DbClient) => Promise<T>) => run(client) });
  const result = await tools.get('calendar.sources.list')({}) as { sources: Array<Record<string, unknown>> };
  assert.deepEqual(result.sources, [{ id: 'source-1', name: 'Synthetic calendar', provider: 'ics' }]);
  assert.deepEqual(tools.options.get('calendar.sources.list')?.requiredScopes, ['mcp:calendar:read']);
  assert.equal(tools.options.get('calendar.sources.list')?.readOnlyHint, true);
  assert.match(calls[1]!.sql, /grant_resource\.grant_id=\$1 AND grant_resource\.household_id=\$2 AND grant_resource\.resource_kind='calendar_source'/);
  assert.match(calls[1]!.sql, /source\.enabled AND connection\.disconnected_at IS NULL/);
  assert.match(calls[1]!.sql, /calendar_source_person_readers/);
  assert.match(calls[1]!.sql, /integration\.revoked_at IS NULL/);
  assert.doesNotMatch(calls[1]!.sql, /credential_ciphertext|subscription_url|raw_url/i);
  assert.doesNotMatch(JSON.stringify(result), /private\.invalid|credential|url/i);
});

test('calendar tool returns no events when the grant has no live visible source', async () => {
  const tools = new Tools(), calls: string[] = [];
  const client = { async query(sql: string) {
    calls.push(sql);
    if (sql.includes('FROM mcp_oauth_grants')) return { rows: [{ allowed: true, person_id: '77777777-7777-4777-8777-777777777777' }] };
    if (sql.includes('FROM mcp_oauth_grant_people')) return { rows: [{ id: 'person-granted' }] };
    if (sql.includes('FROM mcp_oauth_grant_resources')) return { rows: [] };
    throw new Error('No calendar event query should follow an empty source grant');
  } } as unknown as DbClient;
  registerHouseholdTools(tools, context, { transaction: async <T>(run: (client: DbClient) => Promise<T>) => run(client) });
  assert.deepEqual(await tools.get('calendar.events.list')({}), { events: [] });
  assert.equal(calls.length, 3);
});

test('display discovery returns only the current nonrevoked exact grant with a minimal projection', async () => {
  const tools=new Tools(),calls:Array<{sql:string;values?:unknown[]}>=[];
  const client={async query(sql:string,values?:unknown[]){
    calls.push({sql,values});
    if(sql.includes('FROM mcp_oauth_grants'))return{rows:[{allowed:true,person_id:'77777777-7777-4777-8777-777777777777',capabilities:['display.manage']}]};
    if(sql.includes('FROM mcp_oauth_grant_displays'))return{rows:[{id:'display-granted',name:'Synthetic kitchen display',locale:'en',theme:'dark',privacyMode:true,setupName:'Synthetic setup',createdAt:new Date('2027-01-01T00:00:00Z')}]};
    throw new Error('Unexpected display discovery query');
  }} as unknown as DbClient;
  registerHouseholdTools(tools,context,{transaction:async<T>(run:(client:DbClient)=>Promise<T>)=>run(client)});
  const result=await tools.get('household.displays.list')({}) as {displays:Array<Record<string,unknown>>};
  assert.deepEqual(result.displays,[{id:'display-granted',name:'Synthetic kitchen display',locale:'en',theme:'dark',privacyMode:true,setupName:'Synthetic setup',createdAt:new Date('2027-01-01T00:00:00Z')}]);
  assert.deepEqual(tools.options.get('household.displays.list')?.requiredScopes,['mcp:displays:read']);
  assert.equal(tools.options.get('household.displays.list')?.readOnlyHint,true);
  assert.match(calls[0]!.sql,/membership\.capabilities \? \$6/);
  assert.deepEqual(calls[0]!.values?.slice(4,6),[['mcp:displays:read'],'display.manage']);
  assert.match(calls[1]!.sql,/grant_display\.grant_id=\$1 AND grant_display\.household_id=\$2/);
  assert.match(calls[1]!.sql,/display\.revoked_at IS NULL/);
  assert.match(calls[1]!.sql,/JOIN display_setups setup ON setup\.id=display\.setup_id AND setup\.household_id=display\.household_id/);
  assert.match(calls[1]!.sql,/ORDER BY display\.id LIMIT 100/);
  assert.doesNotMatch(calls[1]!.sql,/credential_hash|credential_generation|pairing|background|asset|url|profile_person_ids|birthday_person_ids/i);
  assert.doesNotMatch(JSON.stringify(result),/credential|pairing|background|asset|url|photo|token/i);
});

test('display discovery returns empty for revoked or missing grants and checks live authority first', async () => {
  const tools=new Tools(),calls:string[]=[];
  const client={async query(sql:string){
    calls.push(sql);
    if(sql.includes('FROM mcp_oauth_grants'))return{rows:[{allowed:true,person_id:'77777777-7777-4777-8777-777777777777',capabilities:['display.manage']}]};
    if(sql.includes('FROM mcp_oauth_grant_displays'))return{rows:[]};
    throw new Error('Unexpected discovery query');
  }} as unknown as DbClient;
  registerHouseholdTools(tools,context,{transaction:async<T>(run:(client:DbClient)=>Promise<T>)=>run(client)});
  assert.deepEqual(await tools.get('household.displays.list')({}),{displays:[]});assert.equal(calls.length,2);
  const deniedTools=new Tools(),deniedCalls:string[]=[];
  const denied={async query(sql:string){deniedCalls.push(sql);if(sql.includes('FROM mcp_oauth_grants'))return{rows:[{allowed:false,person_id:'77777777-7777-4777-8777-777777777777',capabilities:[]}]};throw new Error('Display grants must not be checked after failed live authority');}} as unknown as DbClient;
  registerHouseholdTools(deniedTools,context,{transaction:async<T>(run:(client:DbClient)=>Promise<T>)=>run(denied)});
  await assert.rejects(deniedTools.get('household.displays.list')({}),(error:unknown)=>error instanceof DomainError&&error.status===403);assert.equal(deniedCalls.length,1);
});

test('display setup read requires both scopes and returns only the setup projection for an exact active display grant', async () => {
  const tools = new Tools(), calls: Array<{ sql: string; values?: unknown[] }> = [];
  const auditCalls: Array<[string, number]> = [];
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes('FROM mcp_oauth_grants')) return { rows: [{ allowed: true, person_id: principal.membershipId, capabilities: ['display.manage'] }] };
    if (sql.includes('FROM mcp_oauth_grant_displays')) return { rowCount: 1 };
    if (sql.includes('FROM displays')) return { rows: [{ setup_id: principal.membershipId, setup_assignment_revision: '1' }] };
    if (sql.includes('FROM display_setups')) return { rows: [{ name: 'Synthetic setup', revision: 2, cards: ['family_layout'], cardOrder: ['family_layout'], familyLayoutEnabled: true, locale: 'nb', theme: 'dark' }] };
    throw new Error('Unexpected setup read query');
  } } as unknown as DbClient;
  registerHouseholdTools(tools, context, {
    transaction: async <T>(run: (client: DbClient) => Promise<T>) => run(client),
    displaySetupReadAudit: async (_client, displayId, revision) => { auditCalls.push([displayId, revision]); }
  });
  const result = await tools.get('household.displays.setup.get')({ displayId: '77777777-7777-4777-8777-777777777777' }) as Record<string, unknown>;
  const { setupVersion } = result.setup as { setupVersion: string };
  assert.match(setupVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, { setup: { setupVersion, name: 'Synthetic setup', revision: 2, cards: ['family_layout'], cardOrder: ['family_layout'], familyLayoutEnabled: true, locale: 'nb', theme: 'dark' } });
  assert.deepEqual(tools.options.get('household.displays.setup.get')?.requiredScopes, ['mcp:displays:read', 'mcp:displays:setup:read']);
  assert.equal(tools.options.get('household.displays.setup.get')?.readOnlyHint, true);
  assert.deepEqual(calls[0]?.values?.slice(4, 6), [['mcp:displays:read', 'mcp:displays:setup:read'], 'display.manage']);
  assert.match(calls[1]!.sql, /grant_id=\$1 AND household_id=\$2 AND display_id=\$3 FOR SHARE/);
  assert.match(calls[2]!.sql, /revoked_at IS NULL FOR SHARE/);
  assert.doesNotMatch(calls[3]!.sql, /person|source|sensor|album|background|permission|credential|url/i);
  assert.deepEqual(auditCalls, [['77777777-7777-4777-8777-777777777777', 2]]);
  assert.equal(tools.options.get('household.displays.setup.get')?.outputSchema.safeParse({ setup: { ...result.setup, personIds: [] } }).success, false);
});

test('people tool returns only grant-selected fields and rechecks current delegated authority', async () => {
  const tools = new Tools(), fake = dependencies({ people: [{ id: 'person-granted', displayName: 'Granted member', ageGroup: 'adult', revision: 3 }] });
  registerHouseholdTools(tools, context, fake.deps);
  const result = await tools.get('household.people.list')({}) as { people: Array<Record<string, unknown>> };
  assert.deepEqual(result.people, [{ id: 'person-granted', displayName: 'Granted member', ageGroup: 'adult', revision: 3 }]);
  assert.equal(fake.calls[0]!.values?.[0], principal.grantId);
  assert.match(fake.calls[0]!.sql, /grant_row\.revoked_at IS NULL/);
  assert.match(fake.calls[0]!.sql, /membership\.capabilities \? \$6/);
  assert.match(fake.calls[1]!.sql, /grant_person\.grant_id=\$1 AND grant_person\.household_id=\$2/);
  assert.match(fake.calls[1]!.sql, /person\.revision/);
  assert.equal(tools.options.get('household.people.list')?.outputSchema.safeParse({people:[{id:'p',displayName:'Synthetic member',ageGroup:'adult',revision:0}]}).success,false);
  assert.doesNotMatch(JSON.stringify(result), /email|password|photo|private|calendar/i);
});

test('people update requires read and write consent, people.manage, and the exact granted person before using the shared profile service', async () => {
  const tools = new Tools(), calls:Array<{sql:string;values?:unknown[]}>=[],audits:Array<{personId:string;fields:string[]}>=[];
  const client={async query(sql:string,values?:unknown[]){
    calls.push({sql,values});
    if(sql.includes('FROM mcp_oauth_grants'))return{rows:[{allowed:true,person_id:'77777777-7777-4777-8777-777777777777',capabilities:['people.manage']}]};
    if(sql.includes('FROM mcp_oauth_grant_people grant_person'))return{rows:[{person_id:principal.membershipId}],rowCount:1};
    if(sql.includes('SELECT timezone FROM households'))return{rows:[{timezone:'Europe/Oslo'}],rowCount:1};
    if(sql.includes('SELECT birth_date::text,age_group FROM persons'))return{rows:[{birth_date:'2015-01-01',age_group:'child'}],rowCount:1};
    if(sql.includes('UPDATE persons SET display_name='))return{rows:[{id:principal.membershipId,displayName:'Synthetic profile update',avatarKey:null,colorToken:'blue',birth_date:'2008-11-24',age_group:'adult',revision:2}],rowCount:1};
    throw new Error(`Unexpected MCP profile SQL: ${sql}`);
  }} as unknown as DbClient;
  registerHouseholdTools(tools,context,{transaction:async<T>(run:(client:DbClient)=>Promise<T>)=>run(client),personProfileAudit:async(_client,personId,fields)=>{audits.push({personId,fields});}});
  const result=await tools.get('household.people.update')({personId:principal.membershipId,displayName:'Synthetic profile update',colorToken:'blue',expectedRevision:1}) as Record<string,unknown>;
  assert.deepEqual(result,{id:principal.membershipId,revision:2});
  assert.equal(tools.options.get('household.people.update')?.inputSchema.safeParse({personId:principal.membershipId,displayName:'Safe profile update',birthDate:'2008-11-24',expectedRevision:1}).success,false);
  assert.equal(tools.options.get('household.people.update')?.inputSchema.safeParse({personId:principal.membershipId,displayName:'Safe profile update',ageGroup:'adult',expectedRevision:1}).success,false);
  assert.deepEqual(tools.options.get('household.people.update')?.requiredScopes,['mcp:people:read','mcp:people:write']);
  assert.equal(tools.options.get('household.people.update')?.readOnlyHint,false);
  assert.equal(tools.options.get('household.people.update')?.destructiveHint,false);
  assert.equal(tools.options.get('household.people.update')?.idempotentHint,false);
  assert.deepEqual(calls[0]!.values?.slice(4,6),[['mcp:people:read','mcp:people:write'],'people.manage']);
  assert.match(calls[1]!.sql,/grant_person\.grant_id=\$1 AND grant_person\.household_id=\$2 AND grant_person\.person_id=\$3/);
  assert.deepEqual(calls[1]!.values,[principal.grantId,principal.householdId,principal.membershipId]);
  assert.equal(calls.filter(call=>call.sql.includes('UPDATE persons')).length,1);
  assert.ok(calls.every(call=>!/(UPDATE|INSERT INTO) (accounts|memberships|account_invitations)/i.test(call.sql)));
  assert.deepEqual(audits,[{personId:principal.membershipId,fields:['displayName','colorToken']}]);
});

test('people update returns no resource information and performs no mutation for an ungranted person', async () => {
  const tools=new Tools(),calls:string[]=[];
  const client={async query(sql:string){
    calls.push(sql);
    if(sql.includes('FROM mcp_oauth_grants'))return{rows:[{allowed:true,person_id:'77777777-7777-4777-8777-777777777777',capabilities:['people.manage']}]};
    if(sql.includes('FROM mcp_oauth_grant_people grant_person'))return{rows:[],rowCount:0};
    throw new Error('No profile query should follow a missing person grant');
  }} as unknown as DbClient;
  registerHouseholdTools(tools,context,{transaction:async<T>(run:(client:DbClient)=>Promise<T>)=>run(client),personProfileAudit:async()=>{throw new Error('audit must not run');}});
  await assert.rejects(tools.get('household.people.update')({personId:principal.membershipId,displayName:'Blocked',expectedRevision:1}),(error:unknown)=>error instanceof DomainError&&error.status===404);
  assert.equal(calls.length,2);
});

test('people update stops before target lookup when write scope, token, membership or people.manage is stale', async () => {
  const tools=new Tools(),calls:string[]=[];
  const client={async query(sql:string){calls.push(sql);if(sql.includes('FROM mcp_oauth_grants'))return{rows:[{allowed:false,person_id:'77777777-7777-4777-8777-777777777777',capabilities:[]}]};throw new Error('Denied authority must stop before person lookup');}} as unknown as DbClient;
  registerHouseholdTools(tools,context,{transaction:async<T>(run:(client:DbClient)=>Promise<T>)=>run(client),personProfileAudit:async()=>{throw new Error('audit must not run');}});
  await assert.rejects(tools.get('household.people.update')({personId:principal.membershipId,displayName:'Blocked',expectedRevision:1}),(error:unknown)=>error instanceof DomainError&&error.status===403);
  assert.equal(calls.length,1);
  assert.match(calls[0]!,/membership\.capabilities \? \$6/);
  assert.equal(tools.options.get('household.people.update')?.inputSchema.safeParse({personId:principal.membershipId,displayName:'Blocked',expectedRevision:1,rolePreset:'admin'}).success,false);
});

test('a revoked, cross-household, or insufficient-scope grant returns no private household rows', async () => {
  const tools = new Tools(), fake = dependencies({ allowed: false });
  registerHouseholdTools(tools, context, fake.deps);
  await assert.rejects(tools.get('household.groceries.list')({}), (error: unknown) => error instanceof DomainError && error.status === 403);
  assert.equal(fake.calls.length, 1, 'no household data query follows failed live authorization');
});

test('message list uses the current member identity and exact granted-person resource boundary', async () => {
  const tools = new Tools(), fake = dependencies();
  registerHouseholdTools(tools, context, fake.deps);
  const result = await tools.get('household.messages.list')({}) as { messages: Array<Record<string, unknown>> };
  assert.deepEqual(result.messages, [{ id: 'synthetic-message', body: 'Synthetic household message' }]);
  assert.deepEqual(tools.options.get('household.messages.list')?.requiredScopes, ['mcp:messages:read']);
  assert.equal(tools.options.get('household.messages.list')?.readOnlyHint, true);
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[0]!.sql, /token_set\.revoked_at IS NULL/);
  assert.match(fake.calls[0]!.sql, /grant_row\.scopes \?& \$5::text\[\]/);
  assert.match(fake.calls[1]!.sql, /mcp_oauth_grant_people allowed/);
  assert.match(fake.calls[1]!.sql, /allowed\.grant_id=\$5 AND allowed\.household_id=m\.household_id/);
  assert.deepEqual(fake.calls[1]!.values, [principal.householdId, false, principal.membershipId, '77777777-7777-4777-8777-777777777777', principal.grantId, principal.grantId]);
});

test('message list stops before reading when scope, token, account, membership, or household authority is stale', async () => {
  const tools = new Tools(), fake = dependencies({ allowed: false });
  registerHouseholdTools(tools, context, fake.deps);
  await assert.rejects(tools.get('household.messages.list')({}), (error: unknown) => error instanceof DomainError && error.status === 403);
  assert.equal(fake.calls.length, 1, 'no message query follows failed live authorization');
});

test('message writes require both scopes and delegate the real OAuth member to the shared writer', async () => {
  const tools = new Tools(), fake = dependencies(), calls: Array<{ operation: string; actor: Record<string, unknown>; input: unknown; capabilities: unknown }> = [];
  const messageService = {
    async create(actor: any, input: unknown, authorize: (client: DbClient, actor: any) => Promise<unknown>) {
      const capabilities = await authorize(fake.client as DbClient, actor);
      calls.push({ operation: 'create', actor, input, capabilities });
      return { id: 'synthetic-message-created' };
    },
    async edit(actor: any, messageId: string, input: unknown, authorize: (client: DbClient, actor: any) => Promise<unknown>) {
      const capabilities = await authorize(fake.client, actor);
      calls.push({ operation: 'edit', actor, input: { messageId, ...input as object }, capabilities });
      return {
        id: messageId, state: 'published' as const, revision: 2,
        body: 'Synthetic stored message', importance: 'normal' as const, audience_household: false,
        publish_at: new Date('2027-03-20T09:00:00.000Z'), expires_at: new Date('2027-03-21T09:00:00.000Z')
      };
    },
    async withdraw(actor: any, messageId: string, expectedRevision: number, authorize: (client: DbClient, actor: any) => Promise<unknown>) {
      const capabilities = await authorize(fake.client as DbClient, actor);
      calls.push({ operation: 'withdraw', actor, input: { messageId, expectedRevision }, capabilities });
      return { id: messageId, state: 'withdrawn', revision: expectedRevision + 1 };
    }
  };
  registerHouseholdTools(tools, context, { ...fake.deps, messageService });
  const input = { body: 'Synthetic MCP message', audience: { household: false, personIds: [principal.accountId], displayIds: [] }, expiresAt: '2027-03-21T12:00:00.000Z', idempotencyKey: 'mcp-message-0001' };
  const result = await tools.get('household.messages.create')(input) as { message: { id: string } };
  assert.deepEqual(result, { message: { id: 'synthetic-message-created' } });
  assert.deepEqual(tools.options.get('household.messages.create')?.requiredScopes, ['mcp:messages:read', 'mcp:messages:write']);
  assert.match(tools.options.get('household.messages.create')?.description ?? '', /Household-wide broadcasts are not supported/);
  assert.equal(tools.options.get('household.messages.create')?.readOnlyHint, false);
  assert.equal(calls[0]!.actor.accountId, principal.accountId);
  assert.equal(calls[0]!.actor.membershipId, principal.membershipId);
  assert.equal(calls[0]!.actor.householdId, principal.householdId);
  assert.equal(calls[0]!.actor.mcpGrantId, principal.grantId);
  assert.deepEqual((calls[0]!.input as Record<string, unknown>).body, input.body);
  assert.ok((calls[0]!.capabilities as string[]).includes('message.create.household'));
  assert.deepEqual(fake.calls[0]!.values?.slice(4, 6), [['mcp:messages:read', 'mcp:messages:write'], 'message.create.household']);

  const withdrawn = await tools.get('household.messages.withdraw')({ messageId: principal.accountId, expectedRevision: 1 }) as { message: { id: string; state: string; revision: number } };
  assert.deepEqual(withdrawn, { message: { id: principal.accountId, state: 'withdrawn', revision: 2 } });
  assert.deepEqual(tools.options.get('household.messages.withdraw')?.requiredScopes, ['mcp:messages:read', 'mcp:messages:write']);
  assert.equal(tools.options.get('household.messages.withdraw')?.destructiveHint, true);
  assert.equal(tools.options.get('household.messages.withdraw')?.idempotentHint, false);
  assert.equal(calls[1]!.operation, 'withdraw');
  assert.equal(calls[1]!.actor.mcpGrantId, principal.grantId);
  assert.deepEqual(calls[1]!.input, { messageId: principal.accountId, expectedRevision: 1 });
  assert.ok((calls[1]!.capabilities as string[]).includes('household.view'));
  assert.deepEqual(fake.calls[1]!.values?.slice(4, 6), [['mcp:messages:read', 'mcp:messages:write'], 'household.view']);

  const edit = { messageId: principal.accountId, body: 'Synthetic replacement', expectedRevision: 1 };
  const edited = await tools.get('household.messages.edit')(edit);
  assert.deepEqual(edited, { message: { id: principal.accountId, state: 'published', revision: 2 } });
  const editOptions = tools.options.get('household.messages.edit')!;
  assert.deepEqual(editOptions.requiredScopes, ['mcp:messages:read', 'mcp:messages:write']);
  assert.equal(editOptions.idempotentHint, false);
  assert.equal(editOptions.inputSchema.safeParse({ ...edit, audience: { household: true } }).success, false);
  assert.equal(editOptions.outputSchema.safeParse({ message: { id: principal.accountId, state: 'published', revision: 2, body: 'Stored content' } }).success, false);
  assert.equal(calls[2]!.operation, 'edit');
  assert.equal(calls[2]!.actor.mcpGrantId, principal.grantId);
  assert.deepEqual(calls[2]!.input, edit);
  assert.deepEqual(fake.calls[2]!.values?.slice(4, 6), [['mcp:messages:read', 'mcp:messages:write'], 'household.view']);
  assert.match(fake.calls[2]!.sql, /membership\.capabilities \? \$6/);

  const emptyEdit = { messageId: principal.accountId, expectedRevision: 2 };
  assert.equal(editOptions.inputSchema.safeParse(emptyEdit).success, false);
  await assert.rejects(tools.get('household.messages.edit')(emptyEdit), /Supply at least one message field to edit/);
  assert.equal(calls.length, 3, 'an empty edit never invokes the writer');
  assert.equal(fake.calls.length, 3, 'an empty edit never checks database authority or changes delivery');
});

test('board reads require live household.manage plus their distinct MCP consent scopes', async () => {
  const tools = new Tools(), fake = dependencies();
  registerHouseholdTools(tools, context, fake.deps);
  await tools.get('household.groceries.list')({});
  await tools.get('household.dinners.list')({ from: '2027-03-01', to: '2027-03-31' });
  assert.deepEqual(fake.calls.filter(call => call.sql.includes('FROM mcp_oauth_grants')).map(call => call.values?.slice(4, 6)), [
    [['mcp:groceries:read'], 'household.manage'], [['mcp:dinners:read'], 'household.manage']
  ]);
  assert.equal(fake.calls.filter(call => call.sql.includes('household_grocery_items')).length, 1);
  assert.equal(fake.calls.filter(call => call.sql.includes('household_dinner_assignments')).length, 1);
});

test('dinner input is strict and bounded to 31 civil dates before database access', async () => {
  assert.equal(householdToolSchemas.dinnersInput.safeParse({ from: '2027-03-01', to: '2027-03-31', householdId: principal.householdId }).success, false);
  const tools = new Tools(), fake = dependencies();
  registerHouseholdTools(tools, context, fake.deps);
  await assert.rejects(tools.get('household.dinners.list')({ from: '2027-03-01', to: '2027-04-01' }), (error: unknown) => error instanceof DomainError && error.status === 400);
  assert.equal(fake.calls.length, 0);
});

test('board write tools use the existing board service with strict idempotent inputs', async () => {
  const tools = new Tools(), fake = dependencies(), calls: Array<{ operation: string; actor: Record<string, unknown>; input: unknown; id?: string; date?: string }> = [];
  let deleteAudit: ((client: any, result: any) => Promise<void>) | undefined;
  const boardService = {
    async createGrocery(actor: any, input: any) { calls.push({ operation: 'add', actor, input }); return { item: { id: 'grocery-created', revision: 1 } }; },
    async updateGrocery(actor: any, id: string, input: any) { calls.push({ operation: 'update', actor, id, input }); return { item: { id, checked: input.checked, revision: 2 } }; },
    async deleteGrocery(actor: any, id: string, input: any, audit: any) { calls.push({ operation: 'delete', actor, id, input }); deleteAudit = audit; return { item: { id, revision: 2 } }; },
    async setDinner(actor: any, date: string, input: any) { calls.push({ operation: 'assign', actor, date, input }); return { assignment: { localDate: date, revision: 1 } }; },
    async createDinnerOption(actor: any, input: any) { calls.push({ operation: 'option-create', actor, input }); return { option: { id: 'option-created', revision: 1 } }; },
    async updateDinnerOption(actor: any, id: string, input: any) { calls.push({ operation: 'option-update', actor, id, input }); return { option: { id, revision: 2 } }; },
    async deleteDinnerOption(actor: any, id: string, input: any) { calls.push({ operation: 'option-delete', actor, id, input }); return { option: { id, revision: 2 } }; }
  };
  registerHouseholdTools(tools, context, { ...fake.deps, boardService });

  await tools.get('household.groceries.add')({ label: '  Synthetic apples  ', checked: false, requestKey: 'grocery-add-0001' });
  await tools.get('household.groceries.update')({ id: principal.accountId, checked: true, expectedRevision: 1, requestKey: 'grocery-check-0001' });
  await tools.get('household.groceries.delete')({ id: principal.accountId, expectedRevision: 2, requestKey: 'grocery-delete-0001' });
  await tools.get('household.dinners.assign')({ localDate: '2027-03-20', optionId: principal.membershipId, expectedRevision: 0, requestKey: 'dinner-assign-0001' });
  await tools.get('household.dinners.options.create')({ title: '  Synthetic stew  ', emoji: '🍲', requestKey: 'dinner-option-create-001' });
  await tools.get('household.dinners.options.update')({ id: principal.accountId, title: 'Synthetic soup', expectedRevision: 1, requestKey: 'dinner-option-update-001' });
  await tools.get('household.dinners.options.delete')({ id: principal.accountId, expectedRevision: 2, requestKey: 'dinner-option-delete-001' });
  await deleteAudit!({ query: async (sql: string, values: unknown[]) => { calls.push({ operation: sql.includes('INSERT INTO audit_events') ? 'audit' : 'unexpected-audit', actor: {}, id: values[3] as string, input: values }); } }, { item: { id: principal.accountId, revision: 2 } });

  assert.deepEqual(tools.options.get('household.groceries.add')?.requiredScopes, ['mcp:groceries:read', 'mcp:groceries:write']);
  assert.deepEqual(tools.options.get('household.dinners.assign')?.requiredScopes, ['mcp:dinners:read', 'mcp:dinners:write']);
  assert.equal(tools.options.get('household.dinners.assign')?.destructiveHint, true);
  assert.equal(tools.options.get('household.dinners.assign')?.idempotentHint, true);
  assert.deepEqual(tools.options.get('household.groceries.delete')?.requiredScopes, ['mcp:groceries:read', 'mcp:groceries:write']);
  assert.equal(tools.options.get('household.groceries.delete')?.destructiveHint, true);
  assert.equal(tools.options.get('household.groceries.delete')?.idempotentHint, true);
  assert.equal(calls[0]!.actor.kind, 'integration');
  assert.equal(calls[0]!.actor.id, principal.grantId, 'the durable board actor is the MCP grant, never a fabricated browser session');
  assert.equal((calls[0]!.input as { label: string }).label, 'Synthetic apples');
  assert.equal(calls[1]!.id, principal.accountId);
  assert.equal(calls[2]!.id, principal.accountId);
  assert.equal((calls[2]!.input as { expectedRevision: number }).expectedRevision, 2);
  assert.equal(calls[3]!.date, '2027-03-20');
  assert.equal((calls[3]!.input as { optionId: string }).optionId, principal.membershipId);
  assert.deepEqual(calls.slice(4).map(call => call.operation), ['option-create', 'option-update', 'option-delete', 'audit']);
  for (const name of ['household.dinners.options.create', 'household.dinners.options.update', 'household.dinners.options.delete']) {
    assert.deepEqual(tools.options.get(name)?.requiredScopes, ['mcp:dinners:read', 'mcp:dinners:write']);
    assert.equal(tools.options.get(name)?.idempotentHint, true);
  }
  assert.equal(tools.options.get('household.dinners.options.delete')?.destructiveHint, true);
  assert.equal(calls[4]!.actor.id, principal.grantId);
  assert.equal((calls[4]!.input as { title: string }).title, 'Synthetic stew');
  assert.equal(calls[5]!.id, principal.accountId);
  assert.equal(calls[6]!.id, principal.accountId);
  assert.equal(fake.calls.length, 0, 'the board service owns write transaction semantics');
});

test('write schemas reject unknown fields and empty grocery changes before board access', async () => {
  assert.equal(householdToolSchemas.groceryUpdateInput.safeParse({ id: principal.accountId, expectedRevision: 1, requestKey: 'grocery-empty-0001' }).success, false);
  assert.equal(householdToolSchemas.groceryDeleteInput.safeParse({ id: principal.accountId, expectedRevision: 0, requestKey: 'grocery-delete-0001' }).success, false);
  assert.equal(householdToolSchemas.groceryDeleteInput.safeParse({ id: principal.accountId, expectedRevision: 1, requestKey: 'grocery-delete-0001', householdId: principal.householdId }).success, false);
  assert.equal(householdToolSchemas.dinnerAssignmentInput.safeParse({ localDate: '2027-03-20', optionId: null, expectedRevision: 0, requestKey: 'dinner-clear-0001', householdId: principal.householdId }).success, false);
  assert.equal(householdToolSchemas.dinnerOptionUpdateInput.safeParse({ id: principal.accountId, expectedRevision: 1, requestKey: 'dinner-option-update-001' }).success, false);
  assert.equal(householdToolSchemas.dinnerOptionDeleteInput.safeParse({ id: principal.accountId, expectedRevision: 0, requestKey: 'dinner-option-delete-001' }).success, false);
  assert.equal(householdToolSchemas.messageWithdrawInput.safeParse({ messageId: principal.accountId, expectedRevision: 1, householdId: principal.householdId }).success, false);
  assert.equal(householdToolSchemas.messageWithdrawInput.safeParse({ messageId: principal.accountId, expectedRevision: 0 }).success, false);
});
