import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin = 'https://school-workflow.test.invalid';
const callback = 'https://synthetic-school-client.test.invalid/oauth/callback';
const sourcePageUrl = 'https://school.example.invalid/classes/synthetic-1a/';
const pdfUrl = 'https://school.example.invalid/files/week-53.pdf';
const checkTime = (minute: number) => `2026-11-20T10:${String(minute).padStart(2, '0')}:00.000Z`;
const meta = {
  [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
  [CLIENT_INFO_META_KEY]: { name: 'synthetic-school-workflow', version: '1.0.0' },
  [CLIENT_CAPABILITIES_META_KEY]: {},
};
let app: FastifyInstance;
let householdId = '', adminCookie = '', adminCsrf = '', clientId = '', connectionId = '', personId = '', sourceId = '';

function inject(options: any) {
  return app.inject({ ...options, headers: { host: new URL(origin).host, ...(options.headers ?? {}) } });
}
function cookies(response: LightMyRequestResponse) {
  const value = response.headers['set-cookie'];
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item) => item.split(';')[0]).join('; ');
}
function form(value: Record<string, string>) { return new URLSearchParams(value).toString(); }
function challenge(verifier: string) { return createHash('sha256').update(verifier).digest('base64url'); }
function rpc(response: LightMyRequestResponse): any { return response.json(); }
async function call(token: string, name: string, args: Record<string, unknown>, id: number) {
  return inject({ method: 'POST', url: '/mcp', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json',
    'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': name,
  }, payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: meta } } });
}
async function authorize(scopes: string, serial: number) {
  const verifier = `synthetic-school-workflow-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`;
  const state = `school-workflow-state-${serial}-0123456789`;
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: callback,
    code_challenge: challenge(verifier), code_challenge_method: 'S256', resource: `${origin}/mcp`, scope: scopes, state });
  const page = await inject({ method: 'GET', url: `/oauth/authorize?${query}`, headers: { cookie: adminCookie } });
  assert.equal(page.statusCode, 200, page.body);
  const approved = await inject({ method: 'POST', url: '/oauth/authorize', headers: {
    cookie: adminCookie, origin, 'content-type': 'application/x-www-form-urlencoded',
  }, payload: form({ ...Object.fromEntries(query), _csrf: adminCsrf, household_id: householdId, decision: 'approve' }) });
  assert.equal(approved.statusCode, 303, approved.body);
  const code = new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged = await inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: callback,
      code_verifier: verifier, resource: `${origin}/mcp` }) });
  assert.equal(exchanged.statusCode, 200, exchanged.body);
  return exchanged.json().access_token as string;
}
function planInput(expectedRevision: number, minute: number) {
  return { sourceId, personId, sourcePageUrl, classKey: 'synthetic-1a', isoYear: 2020, isoWeek: 53,
    expectedRevision, contentLocale: 'nb', startsOn: '2020-12-28', endsOn: '2021-01-03',
    days: [{ date: '2020-12-28', kind: 'school', activities: [{ title: 'Synthetic lesson', startsAt: '09:00', endsAt: '10:00' }] },
      { date: '2021-01-01', kind: 'school_free' }], pdfUrl, sourceRevision: 'synthetic-document-v1',
    observedAt: checkTime(minute), interpretedAt: checkTime(minute + 1), uncertainty: 'low' };
}

before(async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (databaseUrl.hostname !== 'test-db' || databaseUrl.pathname !== '/samvev_test' ||
      databaseUrl.username !== 'samvev_test' || databaseUrl.password !== 'synthetic-test-data-only') {
    throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  }
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app = await buildApp({ runtimeConfig: { publicOrigin: origin, secureCookies: true, trustProxy: false } });
  const begin = await inject({ method: 'POST', url: '/api/v1/setup/begin', headers: { origin } });
  const claim = await inject({ method: 'POST', url: '/api/v1/setup/claim', headers: { origin }, payload: {
    claimToken: begin.json().claimToken,
    owner: { displayName: 'Synthetic school workflow owner', email: 'school-workflow@test.invalid', password: 'Synthetic-school-workflow-pass-42' },
    household: { name: 'Synthetic school workflow household', timezone: 'Europe/Oslo', locale: 'en' },
    preferences: { locale: 'en', theme: 'system' },
  } });
  assert.equal(claim.statusCode, 200, claim.body);
  householdId = claim.json().householdId;
  adminCookie = cookies(claim);
  adminCsrf = claim.json().csrfToken;
  const actor = (await pool.query<{ person_id: string }>(
    'SELECT person_id FROM memberships WHERE household_id=$1 LIMIT 1', [householdId])).rows[0]!;
  personId = actor.person_id;
  connectionId = (await pool.query<{ id: string }>(
    `INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic school workflow connection') RETURNING id`, [householdId])).rows[0]!.id;
  const registered = await inject({ method: 'POST', url: '/oauth/register', payload: {
    client_name: 'Synthetic school workflow MCP', redirect_uris: [callback], token_endpoint_auth_method: 'none',
  } });
  assert.equal(registered.statusCode, 201, registered.body);
  clientId = registered.json().client_id;
});

after(async () => { if (app) await app.close(); await pool.end(); });

test('authorized school source discovery and plan writes preserve revision and last valid content', async () => {
  const approved = await inject({ method: 'POST', url: `/api/v1/households/${householdId}/school-plan-sources`, headers: {
    cookie: adminCookie, 'x-csrf-token': adminCsrf, origin, 'content-type': 'application/json',
  }, payload: { connectionId, personId, classKey: 'synthetic-1a', sourcePageUrl } });
  assert.equal(approved.statusCode, 201, approved.body);
  sourceId = approved.json().source.id;

  let token = await authorize('mcp:school-plans:read mcp:school-plans:write', 1);
  const unauthorized = await call(token, 'school.sources.list', {}, 1);
  assert.equal(unauthorized.statusCode, 200, unauthorized.body);
  assert.equal(rpc(unauthorized).result.isError, true, 'a source is hidden until its exact resource is authorized');
  assert.match(rpc(unauthorized).result.content[0].text, /FORBIDDEN/);
  assert.doesNotMatch(unauthorized.body, /Synthetic school workflow connection|school\.example/);

  const authorization = (await inject({ method: 'GET', url: `/api/v1/households/${householdId}/mcp/authorizations`, headers: { cookie: adminCookie } })).json().authorizations[0];
  const policy = await inject({ method: 'PUT', url: `/api/v1/households/${householdId}/mcp/authorizations/${authorization.id}/policy`, headers: {
    cookie: adminCookie, 'x-csrf-token': adminCsrf, origin, 'content-type': 'application/json',
  }, payload: { expectedRevision: authorization.revision, scopes: ['mcp:school-plans:read', 'mcp:school-plans:write'],
    personIds: [personId], displayIds: [], resources: [{ kind: 'school_source', id: sourceId }] } });
  assert.equal(policy.statusCode, 200, policy.body);
  token = await authorize('mcp:school-plans:read mcp:school-plans:write', 2);

  const sources = await call(token, 'school.sources.list', {}, 2);
  assert.equal(sources.statusCode, 200, sources.body);
  assert.deepEqual(rpc(sources).result.structuredContent.sources.map((source: { id: string }) => source.id), [sourceId]);
  const created = await call(token, 'school.plans.upsert', planInput(0, 0), 3);
  assert.equal(created.statusCode, 200, created.body);
  const createResult = rpc(created).result.structuredContent.result;
  assert.equal(createResult.result, 'created');
  assert.equal(createResult.revision, 1);
  const planId = createResult.id as string;

  const get = await call(token, 'school.plans.get', { sourceId, isoYear: 2020, isoWeek: 53 }, 4);
  assert.equal(get.statusCode, 200, get.body);
  assert.equal(rpc(get).result.structuredContent.plan.id, planId);
  assert.equal(rpc(get).result.structuredContent.plan.days.length, 2);
  const listed = await call(token, 'school.plans.list', { sourceId, isoYear: 2020, isoWeek: 53, limit: 10 }, 5);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(rpc(listed).result.structuredContent.plans.map((plan: { id: string }) => plan.id), [planId]);

  const unchanged = await call(token, 'school.plans.upsert', planInput(1, 2), 6);
  assert.equal(unchanged.statusCode, 200, unchanged.body);
  assert.equal(rpc(unchanged).result.structuredContent.result.result, 'unchanged');
  assert.equal(rpc(unchanged).result.structuredContent.result.revision, 1);
  const staleWrite = await call(token, 'school.plans.upsert', { ...planInput(0, 4), sourceRevision: 'synthetic-document-v2' }, 7);
  assert.equal(staleWrite.statusCode, 200, staleWrite.body);
  assert.equal(rpc(staleWrite).result.isError, true);
  assert.match(rpc(staleWrite).result.content[0].text, /CONFLICT/);

  const failure = await call(token, 'school.plans.source_failure', { sourceId, personId, sourcePageUrl,
    classKey: 'synthetic-1a', isoYear: 2020, isoWeek: 53, expectedRevision: 1, checkedAt: checkTime(6), reason: 'timeout' }, 8);
  assert.equal(failure.statusCode, 200, failure.body);
  assert.equal(rpc(failure).result.structuredContent.result.sourceStatus, 'stale');
  assert.equal(rpc(failure).result.structuredContent.result.contentRevision, 1);
  const preserved = await call(token, 'school.plans.get', { sourceId, isoYear: 2020, isoWeek: 53 }, 9);
  assert.equal(preserved.statusCode, 200, preserved.body);
  const finalPlan = rpc(preserved).result.structuredContent.plan;
  assert.equal(finalPlan.id, planId);
  assert.equal(finalPlan.sourceStatus, 'stale');
  assert.equal(finalPlan.sourceError, 'timeout');
  assert.equal(finalPlan.revision, 2);
  assert.equal(finalPlan.contentRevision, 1);
  assert.equal(finalPlan.days[0].activities[0].title, 'Synthetic lesson');
  assert.deepEqual(finalPlan.pdf, { status: 'unverified_link', url: pdfUrl });
  assert.doesNotMatch(preserved.body, /password|credential|private|real household/i);
});
