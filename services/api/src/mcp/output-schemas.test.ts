import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import type { PoolClient } from 'pg';
import { pool } from '../db.ts';
import { MCP_SCOPES, McpOAuthService } from './service.ts';

const householdId = 'a0000000-0000-4000-8000-000000000001';
const taskId = 'a0000000-0000-4000-8000-000000000002';
const executionId = 'a0000000-0000-4000-8000-000000000003';
const protocolVersion = '2026-07-28';
const meta = {
  [PROTOCOL_VERSION_META_KEY]: protocolVersion,
  [CLIENT_INFO_META_KEY]: { name: 'synthetic-schema-client', version: '1.0.0' },
  [CLIENT_CAPABILITIES_META_KEY]: {},
};

function client(service: McpOAuthService) {
  const authInfo = service.authInfo({
    token: 'synthetic-token', clientId: 'synthetic-client', scopes: [...MCP_SCOPES],
    expiresAt: new Date(Date.now() + 60_000), householdId, tokenSetId: householdId,
    grantId: householdId, clientDatabaseId: householdId, accountId: householdId,
    membershipId: householdId, installationId: householdId,
  });

  return async (method: 'tools/list' | 'tools/call', name?: string, args?: Record<string, unknown>) => {
    const headers = new Headers({
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': protocolVersion,
      'mcp-method': method,
    });
    if (name) headers.set('mcp-name', name);
    const request = new Request(service.resource, {
      method: 'POST', headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method,
        params: { _meta: meta, ...(name ? { name, arguments: args } : {}) },
      }),
    });
    const response = await service.handler.fetch(request, { authInfo });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.id, 1);
    assert.ok(body.result, JSON.stringify(body.error));
    return body.result;
  };
}

test('MCP discovery advertises object output schemas for all 45 tools', async (t) => {
  const service = new McpOAuthService('https://samvev.test.invalid');
  t.after(() => service.close());

  type OutputSchema = { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties?: boolean };
  const { tools } = await client(service)('tools/list') as {
    tools: Array<{ name: string; outputSchema?: OutputSchema }>;
  };
  assert.equal(tools.length, 45);
  for (const { name, outputSchema } of tools) {
    assert.equal(outputSchema?.type, 'object', name);
    assert.ok(Object.keys(outputSchema.properties).length > 0, name);
    assert.ok(outputSchema.required.length > 0, name);
  }
  const outputByName = new Map(tools.map(({ name, outputSchema }) => [name, outputSchema]));
  assert.deepEqual(outputByName.get('samvev_context')?.required?.sort(), ['household', 'scopes']);
  assert.deepEqual(outputByName.get('samvev_monitor_get')?.required, ['task']);
  assert.deepEqual(outputByName.get('samvev_monitor_runs_list')?.required, ['runs']);
  const pause=outputByName.get('samvev_monitor_pause');
  assert.deepEqual(pause?.required.sort(),['revision','state','taskId']);
  assert.equal(pause?.additionalProperties,false);
  assert.deepEqual(Object.keys(pause?.properties??{}).sort(),['revision','state','taskId']);
  const monitorDiscovery=outputByName.get('samvev_monitors_discover');
  assert.deepEqual(monitorDiscovery?.required.sort(),['nextAfterId','tasks']);
  assert.equal(monitorDiscovery?.type,'object');
  assert.equal(monitorDiscovery?.additionalProperties,false);
  const draftCreation = outputByName.get('samvev_monitor_draft_create');
  assert.deepEqual(draftCreation?.required, ['creation']);
  assert.equal(draftCreation?.additionalProperties, false);
  const creation = draftCreation?.properties.creation as {
    type: string; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties?: boolean;
  };
  assert.equal(creation.type, 'object');
  assert.deepEqual(Object.keys(creation.properties).sort(), ['createdAs', 'createdRevision', 'recipientCountAtCreation', 'requiresBrowserCompletion', 'taskId']);
  assert.deepEqual(creation.required, ['taskId', 'createdRevision', 'createdAs', 'recipientCountAtCreation', 'requiresBrowserCompletion']);
  assert.equal(creation.additionalProperties, false);
  assert.equal(creation.properties.taskId?.type, 'string');
  assert.equal(creation.properties.taskId?.format, 'uuid');
  assert.equal(creation.properties.createdRevision?.type, 'integer');
  assert.equal(creation.properties.createdRevision?.exclusiveMinimum, 0);
  assert.equal(creation.properties.createdAs?.const, 'draft');
  assert.equal(creation.properties.recipientCountAtCreation?.const, 0);
  assert.equal(creation.properties.requiresBrowserCompletion?.const, true);
  const draftGet=outputByName.get('samvev_monitor_draft_get');
  assert.deepEqual(draftGet?.required,['taskId','revision','name','instruction','sourceUrl','checkIntervalMinutes','noticeDaysBefore','noticeLocalTime','providerPolicy','modelTier']);
  assert.equal(draftGet?.additionalProperties,false);
  assert.deepEqual(Object.keys(draftGet?.properties??{}).sort(),['checkIntervalMinutes','instruction','modelTier','name','noticeDaysBefore','noticeLocalTime','providerPolicy','revision','sourceUrl','taskId']);
  const draftGetProperties=draftGet?.properties as Record<string,Record<string,unknown>>|undefined;
  assert.equal(draftGetProperties?.instruction?.maxLength,2000);
  const nullableSource=draftGetProperties?.sourceUrl?.anyOf as Array<Record<string,unknown>>|undefined;
  assert.equal(nullableSource?.[0]?.maxLength,2048);
  const draftUpdate=outputByName.get('samvev_monitor_draft_update');
  assert.deepEqual(draftUpdate?.required.sort(),['revision','taskId']);
  assert.equal(draftUpdate?.additionalProperties,false);
  assert.deepEqual(Object.keys(draftUpdate?.properties??{}).sort(),['revision','taskId']);
  const draftDelete=outputByName.get('samvev_monitor_draft_delete');
  assert.deepEqual(draftDelete?.required.sort(),['deleted','revision','taskId']);
  assert.equal(draftDelete?.additionalProperties,false);
  const draftDeleteProperties=draftDelete?.properties as Record<string,Record<string,unknown>>|undefined;
  assert.deepEqual(draftDeleteProperties?.deleted?.const,true);
  const reviewStatus = outputByName.get('samvev_monitor_result_review_get');
  assert.deepEqual(reviewStatus?.required.sort(), ['disposition', 'reviewRevision']);
  assert.equal(reviewStatus?.additionalProperties, false);
  const review = outputByName.get('samvev_monitor_result_review');
  assert.deepEqual(review?.required.sort(), ['disposition', 'revision', 'runId', 'taskId']);
  assert.equal(review?.additionalProperties, false);
  for (const action of ['create', 'update', 'delete']) {
    assert.deepEqual(outputByName.get(`calendar.events.${action}`)?.required, ['event']);
  }
  assert.deepEqual(outputByName.get('household.messages.edit')?.required, ['message']);
  assert.deepEqual(outputByName.get('household.displays.appearance.update')?.required, ['display']);
  assert.deepEqual(outputByName.get('household.displays.layout.update')?.required, ['layout']);
  assert.equal(outputByName.get('household.displays.layout.update')?.additionalProperties, false);
  assert.deepEqual(outputByName.get('household.displays.setup.get')?.required, ['setup']);
  assert.equal(outputByName.get('household.displays.setup.get')?.additionalProperties, false);
  const createProfile = outputByName.get('household.people.create_profile');
  assert.deepEqual(createProfile?.required, ['creation']);
  assert.equal(createProfile?.additionalProperties, false);
  const profileCreation = createProfile?.properties.creation as { properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties?: boolean };
  assert.deepEqual(profileCreation.required, ['personId', 'createdRevision', 'hadLoginAtCreation']);
  assert.equal(profileCreation.additionalProperties, false);
  assert.equal(profileCreation.properties.hadLoginAtCreation?.const, false);
  assert.deepEqual(outputByName.get('school.plans.get')?.required, ['plan']);
  assert.deepEqual(outputByName.get('school.plans.verify_pdf')?.required, ['result']);
});

test('MCP output validation accepts serialized monitor and authorization results', async (t) => {
  const service = new McpOAuthService('https://samvev.test.invalid');
  t.after(() => service.close());
  const mcp = client(service);

  const household = { id: householdId, name: 'Synthetic household', timezone: 'Etc/UTC', default_locale: 'en' };
  const checkedAt = new Date('2026-01-02T09:10:11.123Z');
  const task = {
    id: taskId, state: 'active', checkIntervalMinutes: 90, noticeDaysBefore: 1, noticeLocalTime: '18:00:00',
    revision: 1, approvedRevision: 1, lastCheckedAt: checkedAt, nextCheckAt: null, errorCode: null,
    checkCount: 1, aiCallCount: 1, unchangedCount: 0, createdAt: checkedAt, updatedAt: checkedAt,
    latestExecution: {
      id: executionId, kind: 'scheduled', status: 'running', progressStage: 'analyzing',
      queuedAt: '2026-01-02T09:10:11.123456+00:00', startedAt: '2026-01-02T09:10:11.123457+00:00',
      completedAt: null, errorCode: null,
    },
  };
  let monitorRow: Record<string, unknown> = task;
  const db = {
    query: async (sql: string) => {
      if (sql.includes('SELECT household.id,household.name')) {
        return { rows: [{ ...household, grant_scopes: ['mcp:context'], token_scopes: ['mcp:context'] }] };
      }
      if (sql.includes('SELECT membership.capabilities FROM mcp_oauth_grants')) return { rowCount: 1, rows: [{ capabilities: ['household.manage'] }] };
      if (sql.includes('SELECT task.id,task.state')) return { rows: [monitorRow] };
      if (/^(?:BEGIN|COMMIT|ROLLBACK|SELECT 1 FROM|INSERT INTO audit_events)/.test(sql)) return { rowCount: 1, rows: [] };
      assert.fail('Unexpected query in schema test');
    },
    release: () => {},
  } as unknown as PoolClient;
  t.mock.method(pool, 'connect', async () => db);

  const context = await mcp('tools/call', 'samvev_context', {});
  assert.equal(context.isError, undefined, JSON.stringify(context.content));
  assert.deepEqual(context.structuredContent, { household, scopes: ['mcp:context'] });
  assert.deepEqual(JSON.parse(context.content[0].text), context.structuredContent);

  const detail = await mcp('tools/call', 'samvev_monitor_get', { taskId });
  assert.equal(detail.isError, undefined, JSON.stringify(detail.content));
  assert.deepEqual(detail.structuredContent.task, {
    ...task, lastCheckedAt: checkedAt.toISOString(), createdAt: checkedAt.toISOString(), updatedAt: checkedAt.toISOString(),
  });
  assert.deepEqual(JSON.parse(detail.content[0].text), detail.structuredContent);

  monitorRow = { ...task, checkCount: '1' };
  const invalid = await mcp('tools/call', 'samvev_monitor_get', { taskId });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /Output validation error/);
  assert.equal(invalid.structuredContent, undefined);

  const unauthorized = await mcp('tools/call', 'samvev_context', { householdId: taskId });
  assert.equal(unauthorized.isError, true);
  assert.match(unauthorized.content[0].text, /Household is not available/);
  assert.equal(unauthorized.structuredContent, undefined);
});

test('MCP school plan output validates the school day and each PDF state', async (t) => {
  const service = new McpOAuthService('https://samvev.test.invalid');
  t.after(() => service.close());
  const mcp = client(service);
  const sourceId = 'a0000000-0000-4000-8000-000000000004';
  const personId = 'a0000000-0000-4000-8000-000000000005';
  const connectionId = 'a0000000-0000-4000-8000-000000000006';
  const observed = new Date('2026-01-06T12:00:00.000Z');
  const sourcePageUrl = 'https://school.test.invalid/example';
  const pdfUrl = 'https://school.test.invalid/example.pdf';
  const sha256 = '1'.repeat(64);
  const days = [{
    date: '2026-01-06', kind: 'school', activities: [{ title: 'Reading', practicalRequirements: [] }],
    practicalRequirements: [], homework: [], deadlines: [], reminders: [],
  }];
  const row = {
    id: taskId, source_id: sourceId, person_id: personId, iso_year: 2026, iso_week: 2,
    starts_on: '2026-01-05', ends_on: '2026-01-11', content_locale: 'en', days,
    revision: 1, content_revision: 1, source_page_url: sourcePageUrl, class_key: 'Synthetic',
    source_revision: 'version-one', observed_at: observed, interpreted_at: observed,
    last_source_observed_at: observed, last_checked_at: observed, source_error: null,
    uncertainty: 'low', active_display_ids: [],
  };
  let pdfColumns: Record<string, unknown> = {};
  const db = {
    query: async (sql: string) => {
      if (sql.includes('SELECT m.person_id,m.capabilities')) {
        return { rows: [{ person_id: personId, capabilities: ['household.manage'], installation_id: householdId }] };
      }
      if (sql.includes('person_count')) return { rows: [{ person_count: 1, display_count: 0, source_count: 1 }] };
      if (sql.includes('FROM school_plans p JOIN school_plan_sources')) return { rows: [{ ...row, ...pdfColumns }] };
      if (/^(?:BEGIN|COMMIT|ROLLBACK|INSERT INTO audit_events)/.test(sql) ||
          sql.includes('SELECT id FROM integration_connections')) return { rowCount: 1, rows: [] };
      assert.fail('Unexpected query in school output schema test');
    },
    release: () => {},
  } as unknown as PoolClient;
  t.mock.method(pool, 'connect', async () => db);
  t.mock.method(pool, 'query', async (sql: string) => {
    if (sql.startsWith('INSERT INTO audit_events')) return { rowCount: 1, rows: [] };
    assert.match(sql, /source.id source_id,source.connection_id/);
    return { rows: [{ person_ids: [personId], display_ids: [], source_id: sourceId, connection_id: connectionId }] };
  });

  for (const [columns, expected] of [
    [{ pdf_status: 'missing', pdf_url: null, pdf_verified_at: null }, { status: 'missing', url: null }],
    [{ pdf_status: 'unverified_link', pdf_url: pdfUrl, pdf_verified_at: null }, { status: 'unverified_link', url: pdfUrl }],
    [{ pdf_status: 'unverified_link', pdf_url: pdfUrl, pdf_verified_at: observed, pdf_sha256: sha256 },
      { status: 'server_verified', url: pdfUrl, sha256, verifiedAt: observed.toISOString() }],
  ] as const) {
    pdfColumns = columns;
    const read = await mcp('tools/call', 'school.plans.get', { sourceId, isoYear: 2026, isoWeek: 2 });
    assert.equal(read.isError, undefined, JSON.stringify(read.content));
    assert.deepEqual(read.structuredContent.plan.days, days);
    assert.deepEqual(read.structuredContent.plan.pdf, expected);
    assert.equal(read.structuredContent.plan.observedAt, observed.toISOString());
    assert.deepEqual(JSON.parse(read.content[0].text), read.structuredContent);
  }
});
