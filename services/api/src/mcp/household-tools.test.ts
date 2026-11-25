import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '@samvev/core';
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
  readonly options = new Map<string, { description: string; inputSchema: ZodType; requiredScopes: readonly [HouseholdMcpScope, ...HouseholdMcpScope[]]; readOnlyHint: boolean; destructiveHint: boolean }>();
  registerTool(name: string, options: { description: string; inputSchema: ZodType; requiredScopes: readonly [HouseholdMcpScope, ...HouseholdMcpScope[]]; readOnlyHint: boolean; destructiveHint: boolean }, handler: (input: unknown) => Promise<unknown>) { this.options.set(name, options); this.handlers.set(name, handler); }
  get(name: string) { const handler = this.handlers.get(name); assert.ok(handler, `tool ${name} registered`); return handler; }
}

function dependencies(options: { allowed?: boolean; people?: unknown[] } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { async query(sql: string, values?: unknown[]) {
    calls.push({ sql, values });
    if (sql.includes('FROM mcp_oauth_grants')) return { rows: [{ allowed: options.allowed ?? true }] };
    if (sql.includes('FROM mcp_oauth_grant_people')) return { rows: options.people ?? [{ id: 'person-granted', displayName: 'Granted member', ageGroup: 'adult' }] };
    if (sql.includes('household_grocery_items')) return { rows: [{ id: 'grocery-1', label: 'Synthetic apples', checked: false }] };
    if (sql.includes('household_dinner_assignments')) return { rows: [{ localDate: '2027-03-20', title: 'Synthetic soup' }] };
    throw new Error('Unexpected SQL in focused MCP test');
  } } as unknown as DbClient;
  return { calls, deps: { transaction: async <T>(run: (client: DbClient) => Promise<T>) => run(client) } };
}

test('people tool returns only grant-selected fields and rechecks current delegated authority', async () => {
  const tools = new Tools(), fake = dependencies({ people: [{ id: 'person-granted', displayName: 'Granted member', ageGroup: 'adult' }] });
  registerHouseholdTools(tools, context, fake.deps);
  const result = await tools.get('household.people.list')({}) as { people: Array<Record<string, unknown>> };
  assert.deepEqual(result.people, [{ id: 'person-granted', displayName: 'Granted member', ageGroup: 'adult' }]);
  assert.equal(fake.calls[0]!.values?.[0], principal.grantId);
  assert.match(fake.calls[0]!.sql, /grant_row\.revoked_at IS NULL/);
  assert.match(fake.calls[0]!.sql, /membership\.capabilities \? \$6/);
  assert.match(fake.calls[1]!.sql, /grant_person\.grant_id=\$1 AND grant_person\.household_id=\$2/);
  assert.doesNotMatch(JSON.stringify(result), /email|password|photo|private|calendar/i);
});

test('a revoked, cross-household, or insufficient-scope grant returns no private household rows', async () => {
  const tools = new Tools(), fake = dependencies({ allowed: false });
  registerHouseholdTools(tools, context, fake.deps);
  await assert.rejects(tools.get('household.groceries.list')({}), (error: unknown) => error instanceof DomainError && error.status === 403);
  assert.equal(fake.calls.length, 1, 'no household data query follows failed live authorization');
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
  const boardService = {
    async createGrocery(actor: any, input: any) { calls.push({ operation: 'add', actor, input }); return { item: { id: 'grocery-created', revision: 1 } }; },
    async updateGrocery(actor: any, id: string, input: any) { calls.push({ operation: 'update', actor, id, input }); return { item: { id, checked: input.checked, revision: 2 } }; },
    async setDinner(actor: any, date: string, input: any) { calls.push({ operation: 'assign', actor, date, input }); return { assignment: { localDate: date, revision: 1 } }; }
  };
  registerHouseholdTools(tools, context, { ...fake.deps, boardService });

  await tools.get('household.groceries.add')({ label: '  Synthetic apples  ', checked: false, requestKey: 'grocery-add-0001' });
  await tools.get('household.groceries.update')({ id: principal.accountId, checked: true, expectedRevision: 1, requestKey: 'grocery-check-0001' });
  await tools.get('household.dinners.assign')({ localDate: '2027-03-20', optionId: principal.membershipId, expectedRevision: 0, requestKey: 'dinner-assign-0001' });

  assert.deepEqual(tools.options.get('household.groceries.add')?.requiredScopes, ['mcp:groceries:read', 'mcp:groceries:write']);
  assert.deepEqual(tools.options.get('household.dinners.assign')?.requiredScopes, ['mcp:dinners:read', 'mcp:dinners:write']);
  assert.equal(tools.options.get('household.dinners.assign')?.destructiveHint, true);
  assert.equal(calls[0]!.actor.kind, 'integration');
  assert.equal(calls[0]!.actor.id, principal.grantId, 'the durable board actor is the MCP grant, never a fabricated browser session');
  assert.equal((calls[0]!.input as { label: string }).label, 'Synthetic apples');
  assert.equal(calls[1]!.id, principal.accountId);
  assert.equal(calls[2]!.date, '2027-03-20');
  assert.equal((calls[2]!.input as { optionId: string }).optionId, principal.membershipId);
  assert.equal(fake.calls.length, 0, 'the board service owns write transaction semantics');
});

test('write schemas reject unknown fields and empty grocery changes before board access', async () => {
  assert.equal(householdToolSchemas.groceryUpdateInput.safeParse({ id: principal.accountId, expectedRevision: 1, requestKey: 'grocery-empty-0001' }).success, false);
  assert.equal(householdToolSchemas.dinnerAssignmentInput.safeParse({ localDate: '2027-03-20', optionId: null, expectedRevision: 0, requestKey: 'dinner-clear-0001', householdId: principal.householdId }).success, false);
});
