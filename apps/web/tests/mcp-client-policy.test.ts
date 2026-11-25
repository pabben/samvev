import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasMcpDisplayPolicyScope, hasMcpSchoolScope, isValidMcpScopeNarrowing, mcpActivityTranslationKey, mcpScopeTranslationKey, saveMcpPolicy, schoolResourcesForPolicy, unlistedSchoolResources, type McpAuthorization, type SchoolPlanSource } from '../src/mcp-client-policy';

const authorization: McpAuthorization = {
  id: 'synthetic-grant-id',
  client_name: 'Synthetic calendar assistant',
  scopes: ['mcp:context', 'mcp:monitors:read', 'mcp:school-plans:read', 'offline_access'],
  revision: 3,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-02T12:00:00Z',
  revoked_at: null,
  last_used_at: null,
  person_ids: [],
  display_ids: [],
  resources: [{ kind: 'school_source', id: 'synthetic-approved-source-id' }],
};

test('backend MCP scope names are translated without exposing namespace prefixes', () => {
  assert.equal(mcpScopeTranslationKey('mcp:context'), 'mcpScopeContext');
  assert.equal(mcpScopeTranslationKey('mcp:monitors:read'), 'mcpScopeMonitorsRead');
  assert.equal(mcpScopeTranslationKey('mcp:school-plans:read'), 'mcpScopeSchoolRead');
  assert.equal(mcpScopeTranslationKey('mcp:school-plans:write'), 'mcpScopeSchoolWrite');
  assert.equal(mcpScopeTranslationKey('offline_access'), 'mcpScopeOffline');
  assert.equal(mcpScopeTranslationKey('mcp:people:read'), 'mcpScopePeopleRead');
  assert.equal(mcpScopeTranslationKey('mcp:groceries:read'), 'mcpScopeGroceriesRead');
  assert.equal(mcpScopeTranslationKey('mcp:dinners:read'), 'mcpScopeDinnersRead');
  assert.equal(mcpScopeTranslationKey('mcp:future:scope'), undefined);
  assert.equal(mcpActivityTranslationKey('mcp.school_plan_read'), 'mcpActivitySchoolPlanRead');
  assert.equal(mcpActivityTranslationKey('mcp.future_action'), undefined);
});

test('school and display policy controls require a matching current consent scope', () => {
  assert.equal(hasMcpSchoolScope(['mcp:school-plans:read']), true);
  assert.equal(hasMcpSchoolScope(['mcp:school-plans:write']), true);
  assert.equal(hasMcpSchoolScope(['mcp:people:read']), false);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:monitors:read']), true);
  assert.equal(hasMcpDisplayPolicyScope(['mcp:groceries:read']), false);
});

test('scope policy permits only subsets and requires a non-offline permission', () => {
  const original = ['mcp:people:read', 'mcp:school-plans:read', 'offline_access'];
  assert.equal(isValidMcpScopeNarrowing(original, original), true);
  assert.equal(isValidMcpScopeNarrowing(original, ['mcp:people:read']), true);
  assert.equal(isValidMcpScopeNarrowing(original, ['offline_access']), false);
  assert.equal(isValidMcpScopeNarrowing(original, []), false);
  assert.equal(isValidMcpScopeNarrowing(original, ['mcp:people:read', 'mcp:people:write']), false);
});

test('explicit school-source selection adds approved resources and keeps existing resources untouched', () => {
  const existing = [{ kind: 'school_source' as const, id: 'synthetic-existing-source' }];
  const existingSource: SchoolPlanSource = { id: 'synthetic-existing-source', personId: 'synthetic-person-id', connectionId: 'synthetic-existing-connection-id', classKey: '1B', sourcePageUrl: 'https://school.test.invalid/existing', displayPdfLinksAllowed: true };
  const source: SchoolPlanSource = { id: 'synthetic-new-source', personId: 'synthetic-person-id', connectionId: 'synthetic-connection-id', classKey: '1A', sourcePageUrl: 'https://school.test.invalid/plan', displayPdfLinksAllowed: false };
  assert.deepEqual(schoolResourcesForPolicy(existing, ['synthetic-existing-source', 'synthetic-new-source'], [existingSource, source], ['synthetic-person-id']), [
    existing[0],
    { kind: 'school_source', id: 'synthetic-new-source' },
  ]);
});

test('unlisted existing source grants are surfaced and can be explicitly removed', () => {
  const legacyGrant = { kind: 'school_source' as const, id: 'synthetic-no-longer-listed-source', retained: 'backend-extension' };
  assert.deepEqual(unlistedSchoolResources([legacyGrant], []), [legacyGrant]);
  const result = schoolResourcesForPolicy([legacyGrant], [], [], ['synthetic-person-id']);
  assert.deepEqual(result, []);
});

test('school-source resource cannot be added unless its linked person is included in the authorization', () => {
  const source: SchoolPlanSource = { id: 'synthetic-source', personId: 'synthetic-person-id', connectionId: 'synthetic-connection-id', classKey: '1A', sourcePageUrl: 'https://school.test.invalid/plan', displayPdfLinksAllowed: false };
  assert.throws(()=>schoolResourcesForPolicy([], ['synthetic-source'], [source], []), /mcp_school_source_person_required/);
});

test('policy update uses backend snake_case authorization fields and preserves approved resources in the mocked API request', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, ['synthetic-person-id'], ['synthetic-display-id']);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request?.url, '/api/v1/households/synthetic-household-id/mcp/authorizations/synthetic-grant-id/policy');
  assert.equal(request?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    expectedRevision: 3,
    personIds: ['synthetic-person-id'],
    displayIds: ['synthetic-display-id'],
    resources: [{ kind: 'school_source', id: 'synthetic-approved-source-id' }],
  });
});

test('scope narrowing is sent as a subset to the CAS policy endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    request = { url: String(input), init };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, ['synthetic-person-id'], [], authorization.resources, ['mcp:school-plans:read']);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    expectedRevision: 3,
    personIds: ['synthetic-person-id'],
    displayIds: [],
    resources: [{ kind: 'school_source', id: 'synthetic-approved-source-id' }],
    scopes: ['mcp:school-plans:read'],
  });
});

test('scope narrowing rejects empty, offline-only, or broadening updates before network request', async () => {
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, [], [], authorization.resources, ['offline_access']), /mcp_scope_selection_invalid/);
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', authorization, [], [], authorization.resources, ['mcp:people:write']), /mcp_scope_selection_invalid/);
});

test('policy cannot be edited before the source resource list is present in the authorization response', async () => {
  const { resources: _resources, ...incomplete } = authorization;
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', incomplete, [], []), /mcp_policy_unavailable/);
});
