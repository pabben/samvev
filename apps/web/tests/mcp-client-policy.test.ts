import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mcpScopeTranslationKey, saveMcpPolicy, type McpAuthorization } from '../src/mcp-client-policy';

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
  assert.equal(mcpScopeTranslationKey('mcp:future:scope'), undefined);
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

test('policy cannot be edited before the source resource list is present in the authorization response', async () => {
  const { resources: _resources, ...incomplete } = authorization;
  await assert.rejects(saveMcpPolicy('/households/synthetic-household-id/mcp/authorizations', incomplete, [], []), /mcp_policy_unavailable/);
});
