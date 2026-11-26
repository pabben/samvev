import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { opaqueToken, tokenHash } from '@samvev/core';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { assertIsolatedTestDatabase, pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { localDateInTimezone } from '../people/domain.ts';

const origin = 'https://calendar-write.test.invalid';
const callback = 'https://calendar-write-client.test.invalid/callback';
const readScope = 'mcp:calendar:read';
const writeScope = 'mcp:calendar:write';
const protocol = '2026-07-28';
const meta = {
  [PROTOCOL_VERSION_META_KEY]: protocol,
  [CLIENT_INFO_META_KEY]: { name: 'synthetic-calendar-client', version: '1.0.0' },
  [CLIENT_CAPABILITIES_META_KEY]: {}
};
const timezone = 'America/Los_Angeles';
const tomorrow = localDateInTimezone(new Date(Date.now() + 86_400_000), timezone);
const dayAfter = localDateInTimezone(new Date(Date.now() + 2 * 86_400_000), timezone);

let app: FastifyInstance;
let householdId: string;
let accountId: string;
let membershipId: string;
let memberPersonId: string;
let excludedId: string;
let foreignHouseholdId: string;
let cookie: string;
let csrf: string;
let requestId = 0;

function inject(options: InjectOptions) {
  return app.inject({ ...options, headers: { host: new URL(origin).host, ...options.headers } });
}

function browser() {
  return { cookie, 'x-csrf-token': csrf, origin };
}

async function authorize(scopes: string[]) {
  const registration = await inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Synthetic calendar MCP', redirect_uris: [callback], token_endpoint_auth_method: 'none' } });
  assert.equal(registration.statusCode, 201, registration.body);
  const clientId = registration.json().client_id as string;
  async function issueToken() {
    const verifier = 'synthetic-native-calendar-verifier-0123456789abcdef';
    const query = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: callback, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', resource: `${origin}/mcp`, scope: scopes.join(' '), state: 'synthetic-native-calendar-state'
    });
    const page = await inject({ method: 'GET', url: `/oauth/authorize?${query}`, headers: browser() });
    assert.equal(page.statusCode, 200, page.body);
    const approval = await inject({ method: 'POST', url: '/oauth/authorize', headers: { ...browser(), 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...Object.fromEntries(query), _csrf: csrf, household_id: householdId, decision: 'approve' }).toString() });
    assert.equal(approval.statusCode, 303, approval.body);
    const code = new URL(String(approval.headers.location)).searchParams.get('code');
    assert.ok(code);
    const exchange = await inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
        redirect_uri: callback, code_verifier: verifier, resource: `${origin}/mcp` }).toString() });
    assert.equal(exchange.statusCode, 200, exchange.body);
    return exchange.json().access_token as string;
  }
  let token = await issueToken();
  let { id: grantId, revision } = (await pool.query<{ id: string; revision: number }>(`SELECT grant_row.id,grant_row.revision FROM mcp_oauth_grants grant_row
    JOIN mcp_oauth_clients client ON client.id=grant_row.client_id WHERE client.client_id=$1`, [clientId])).rows[0]!;
  return {
    get token() { return token; }, grantId,
    async policy(personIds: string[], resources: Array<{kind: string; id: string}>, expectedStatus = 200, nextScopes?: string[]) {
      const result = await inject({ method: 'PUT', url: `/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,
        headers: browser(), payload: { expectedRevision: revision, personIds, displayIds: [], resources, scopes: nextScopes } });
      assert.equal(result.statusCode, expectedStatus, result.body);
      if (expectedStatus === 200) {
        assert.equal(result.json().tokensRevoked, true);
        revision = result.json().revision;
        if (!nextScopes) {
          token = await issueToken();
          revision += 1;
        }
      }
    }
  };
}

function call(token: string, name: string, args: Record<string, unknown> = {}) {
  return inject({ method: 'POST', url: '/mcp',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json',
      'mcp-protocol-version': protocol, 'mcp-method': 'tools/call', 'mcp-name': name },
    payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args, _meta: meta } } });
}

function result(response: LightMyRequestResponse) {
  assert.equal(response.statusCode, 200, response.body);
  return response.json().result;
}

function succeeded(response: LightMyRequestResponse) {
  const value = result(response);
  assert.equal(value.isError, undefined, response.body);
  return value.structuredContent;
}

function failed(response: LightMyRequestResponse, code: string) {
  const value = result(response);
  assert.equal(value.isError, true, response.body);
  assert.equal(value.structuredContent, undefined);
  assert.equal(value.content[0]?.text, code);
}

const nativeResource = () => ({ kind: 'native_calendar', id: householdId });
const create = () => ({ sourceId: householdId, requestKey: 'synthetic-native-create', title: 'Synthetic appointment',
  description: 'Synthetic private appointment content', startsAt: tomorrow, endsAt: dayAfter, personIds: [memberPersonId] });

before(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app = await buildApp({ runtimeConfig: { publicOrigin: origin, secureCookies: true, trustProxy: false } });
  const begin = await inject({ method: 'POST', url: '/api/v1/setup/begin', headers: { origin } });
  assert.equal(begin.statusCode, 200, begin.body);
  const claim = await inject({ method: 'POST', url: '/api/v1/setup/claim', headers: { origin },
    payload: { claimToken: begin.json().claimToken, owner: { displayName: 'Synthetic calendar owner', email: 'calendar-owner@test.invalid', password: 'Synthetic-calendar-pass-42' },
      household: { name: 'Synthetic calendar household', timezone, locale: 'en' }, preferences: { locale: 'en', theme: 'system' } } });
  assert.equal(claim.statusCode, 200, claim.body);
  const setCookie = claim.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((value) => value?.split(';')[0]).join('; ');
  csrf = claim.json().csrfToken;
  householdId = claim.json().householdId;
  const members = await pool.query<{ installation_id: string; account_id: string; id: string; person_id: string }>(
    'SELECT household.installation_id,member.id,member.account_id,member.person_id FROM households household JOIN memberships member ON member.household_id=household.id WHERE household.id=$1', [householdId]);
  const member = members.rows[0]!;
  accountId = member.account_id;
  membershipId = member.id;
  memberPersonId = member.person_id;
  excludedId = (await pool.query<{ id: string }>("INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic excluded person','child') RETURNING id", [householdId])).rows[0]!.id;
  foreignHouseholdId = (await pool.query<{ id: string }>("INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic other household','UTC','en','synthetic') RETURNING id", [member.installation_id])).rows[0]!.id;
});

after(async () => {
  if (app) await app.close();
  await pool.end();
});

test('new OAuth scopes default deny and an explicitly scoped native appointment can be created, read, edited, retried, and withdrawn', async () => {
  const owner = await authorize([readScope, writeScope]);
  const readOnly = await authorize([readScope]);
  const writeOnly = await authorize([writeScope]);
  const payload = create();
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.sources.list')).sources, []);
  failed(await call(owner.token, 'calendar.events.create', payload), 'NOT_FOUND');
  await owner.policy([memberPersonId], [{ kind: 'native_calendar', id: foreignHouseholdId }], 400);
  await owner.policy([], [nativeResource()], 400);
  await writeOnly.policy([memberPersonId], [nativeResource()], 400);
  await owner.policy([memberPersonId], [nativeResource()]);
  await readOnly.policy([memberPersonId], [nativeResource()]);
  await readOnly.policy([memberPersonId], [nativeResource()], 400, [readScope, writeScope]);
  assert.equal((await call(readOnly.token, 'calendar.events.create', payload)).statusCode, 403);
  assert.equal((await call(writeOnly.token, 'calendar.events.create', payload)).statusCode, 403);
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.sources.list')).sources,
    [{ id: householdId, name: 'Samvev', provider: 'samvev', writable: true }]);
  assert.deepEqual(succeeded(await call(readOnly.token, 'calendar.sources.list')).sources,
    [{ id: householdId, name: 'Samvev', provider: 'samvev', writable: false }]);
  failed(await call(owner.token, 'calendar.events.create', { ...payload, sourceId: foreignHouseholdId }), 'NOT_FOUND');
  failed(await call(owner.token, 'calendar.events.create', { ...payload, personIds: [memberPersonId, excludedId] }), 'NOT_FOUND');

  const attempts = await Promise.all([call(owner.token, 'calendar.events.create', payload), call(owner.token, 'calendar.events.create', payload)]);
  const original = succeeded(attempts[0]!).event as { id: string; revision: number };
  assert.equal(original.revision, 1);
  assert.deepEqual(succeeded(attempts[1]!), { event: original });
  failed(await call(owner.token, 'calendar.events.create', { ...payload, title: 'Conflicting title' }), 'CONFLICT');

  const expected = { id: original.id, revision: 1, title: payload.title, description: payload.description,
    startsAt: `${tomorrow}T00:00:00.000Z`, endsAt: `${dayAfter}T00:00:00.000Z`, allDay: true,
    sourceId: householdId, sourceName: 'Samvev', personIds: [memberPersonId] };
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.events.list')).events, [{ ...expected, writable: true }]);
  assert.deepEqual(succeeded(await call(readOnly.token, 'calendar.events.list')).events, [{ ...expected, writable: false }]);

  const memberCalendar = await inject({ method: 'GET', url: `/api/v1/households/${householdId}/activities?from=${tomorrow}&to=${tomorrow}`, headers: browser() });
  assert.equal(memberCalendar.statusCode, 200, memberCalendar.body);
  const memberEvent = memberCalendar.json().activities.find((activity: { id: string }) => activity.id === original.id);
  assert.deepEqual(memberEvent?.personIds, [memberPersonId]);
  assert.equal(memberEvent?.metadata.nativeCalendar, true);
  assert.equal(memberEvent?.metadata.allDay, true);
  assert.equal(memberEvent?.source.label, 'Samvev');

  const edit = { sourceId: householdId, eventId: original.id, requestKey: 'synthetic-native-edit', expectedRevision: 1, title: 'Synthetic changed appointment' };
  failed(await call(owner.token, 'calendar.events.update', { ...edit, personIds: [excludedId] }), 'NOT_FOUND');
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.events.update', edit)), { event: { id: original.id, revision: 2 } });
  assert.equal(succeeded(await call(owner.token, 'calendar.events.list')).events[0].description, payload.description);
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.events.update', edit)), { event: { id: original.id, revision: 2 } });
  failed(await call(owner.token, 'calendar.events.update', { ...edit, requestKey: 'synthetic-other-edit' }), 'REVISION_CONFLICT');

  await owner.policy([memberPersonId, excludedId], [nativeResource()]);
  const audienceChange = { ...edit, requestKey: 'synthetic-audience-change', expectedRevision: 2, personIds: [memberPersonId, excludedId] };
  assert.equal(succeeded(await call(owner.token, 'calendar.events.update', audienceChange)).event.revision, 3);
  assert.deepEqual(succeeded(await call(readOnly.token, 'calendar.events.list')).events, []);
  await owner.policy([memberPersonId], [nativeResource()]);
  failed(await call(owner.token, 'calendar.events.update', { ...edit, requestKey: 'synthetic-hidden-event', expectedRevision: 3 }), 'NOT_FOUND');
  failed(await call(owner.token, 'calendar.events.create', payload), 'NOT_FOUND');

  await owner.policy([memberPersonId, excludedId], [nativeResource()]);
  const deletion = { sourceId: householdId, eventId: original.id, requestKey: 'synthetic-native-delete', expectedRevision: 3 };
  const removed = { event: { id: original.id, revision: 4 } };
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.events.delete', deletion)), removed);
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.events.delete', deletion)), removed);
  assert.deepEqual(succeeded(await call(owner.token, 'calendar.events.list')).events, []);
  const event = (await pool.query<{ status: string; revision: number; native_calendar: boolean; connection_id: string }>(
    "SELECT item.status,item.revision,item.connection_id,source.native_calendar FROM integration_items item JOIN integration_connections source ON source.id=item.connection_id WHERE item.id=$1", [original.id])).rows[0]!;
  assert.equal(event.status, 'withdrawn');
  assert.equal(event.revision, 4);
  assert.equal(event.native_calendar, true);
  const listIntegrations = await inject({ method: 'GET', url: `/api/v1/households/${householdId}/integrations`, headers: browser() });
  assert.equal(listIntegrations.statusCode, 200, listIntegrations.body);
  assert.doesNotMatch(listIntegrations.body, new RegExp(event.connection_id));
  const grantCredential = await inject({ method: 'POST', url: `/api/v1/households/${householdId}/integrations/${event.connection_id}/credentials`,
    headers: browser(), payload: { name: 'Synthetic forbidden credential', capabilities: ['integration.items.write'], expectedRevision: 1 } });
  assert.equal(grantCredential.statusCode, 404, grantCredential.body);
  await assert.rejects(pool.query(`INSERT INTO integration_credentials(connection_id,name,token_hash,capabilities)
    VALUES($1,'Synthetic forbidden credential',$2,'["integration.items.write"]')`, [event.connection_id, tokenHash(opaqueToken())]), { code: '23514' });

  const audits = (await pool.query<{ action: string; metadata: Record<string, unknown> }>(
    "SELECT action,metadata FROM audit_events WHERE actor_type='mcp' AND actor_id=$1 AND subject_id=$2 ORDER BY occurred_at", [owner.grantId, original.id])).rows;
  assert.deepEqual(audits.map((row) => row.action), ['mcp.calendar_event_created', 'mcp.calendar_event_updated', 'mcp.calendar_event_updated', 'mcp.calendar_event_deleted']);
  assert.deepEqual(audits.map((row) => row.metadata.revision), [1, 2, 3, 4]);
  assert.doesNotMatch(JSON.stringify(audits), /private appointment|requestKey|location|personIds/);

  await owner.policy([memberPersonId, excludedId], []);
  failed(await call(owner.token, 'calendar.events.delete', deletion), 'NOT_FOUND');
  await owner.policy([memberPersonId, excludedId], [nativeResource()]);
  const liveCapabilities = (await pool.query<{ capabilities: unknown }>('SELECT capabilities FROM memberships WHERE id=$1', [membershipId])).rows[0]!.capabilities;
  try {
    await pool.query(`UPDATE memberships SET capabilities='["household.manage"]' WHERE id=$1`, [membershipId]);
    failed(await call(owner.token, 'calendar.events.delete', deletion), 'FORBIDDEN');
  } finally {
    await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1', [membershipId, JSON.stringify(liveCapabilities)]);
  }
  await owner.policy([memberPersonId], [nativeResource()], 200, [readScope]);
  assert.equal((await call(owner.token, 'calendar.events.delete', deletion)).statusCode, 401);
});

test('MCP native writes preserve generic, HA-authored and imported calendar rows', async () => {
  const owner = await authorize([readScope, writeScope]);
  await owner.policy([memberPersonId], [nativeResource()]);
  const connection = (await pool.query<{ id: string }>(
    "INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic outside producer') RETURNING id", [householdId])).rows[0]!.id;
  const fake = (await pool.query<{ id: string }>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
    VALUES($1,$2,'synthetic-generic','event','Synthetic generic','Synthetic details','normal',$3,$4,'{"label":"Synthetic"}','{"nativeCalendar":true,"haBridge":true}',repeat('0',64)) RETURNING id`,
  [householdId, connection, `${tomorrow}T12:00:00Z`, `${tomorrow}T13:00:00Z`])).rows[0]!.id;
  const haToken = opaqueToken();
  await pool.query(`INSERT INTO integration_credentials(connection_id,name,token_hash,capabilities)
    VALUES($1,'Synthetic HA credential',$2,'["ha.calendar.read","ha.calendar.write"]')`, [connection, tokenHash(haToken)]);
  await pool.query('INSERT INTO integration_ha_sharing(household_id,connection_id,person_ids,allow_shared_native_writes) VALUES($1,$2,$3,true)', [householdId, connection, [memberPersonId]]);
  const haPath = '/api/v1/ha/calendars/samvev/events';
  const haHeaders = { authorization: `Bearer ${haToken}` };
  const haCreate = await inject({ method: 'POST', url: haPath, headers: haHeaders, payload: {
    summary: 'Synthetic HA appointment', start: tomorrow, end: dayAfter, requestKey: 'synthetic-ha-native-create'
  } });
  assert.equal(haCreate.statusCode, 201, haCreate.body);
  const haEvent = haCreate.json().event;
  const importedConnection = (await pool.query<{ id: string }>(
    "INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic import authority') RETURNING id", [householdId])).rows[0]!.id;
  const calendar = (await pool.query<{ id: string }>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state,credential_ciphertext)
    VALUES($1,$2,$3,'ics','Synthetic ICS','connected','synthetic-credential-not-returned') RETURNING id`, [householdId, importedConnection, accountId])).rows[0]!.id;
  const source = (await pool.query<{ id: string }>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household)
    VALUES($1,$2,'synthetic-source','Synthetic ICS source',true,true) RETURNING id`, [householdId, calendar])).rows[0]!.id;
  const imported = (await pool.query<{ id: string }>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
    VALUES($1,$2,'synthetic-occurrence','event',true,'Synthetic imported event','Synthetic imported description','normal',$3,$4,
    '{"label":"Synthetic","url":"https://credential.test.invalid/secret"}','{"calendar":{"subjectHousehold":true}}',repeat('1',64)) RETURNING id`,
  [householdId, importedConnection, `${tomorrow}T10:00:00Z`, `${tomorrow}T11:00:00Z`])).rows[0]!.id;
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)', [householdId, imported, memberPersonId]);
  await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,incarnation,integration_item_id,external_item_id,fingerprint,status,last_seen_generation)
    VALUES($1,$2,'synthetic-event-uid','synthetic-instance',1,$3,'synthetic-occurrence',repeat('2',64),'active',1)`, [householdId, source, imported]);
  await owner.policy([memberPersonId], [nativeResource(), { kind: 'calendar_source', id: source }]);
  const importedRead = await call(owner.token, 'calendar.events.list');
  assert.deepEqual(succeeded(importedRead).events.map(({ id }: { id: string }) => id), [imported]);
  assert.doesNotMatch(importedRead.body, /credential\.test\.invalid|synthetic-credential|writable/);
  for (const eventId of [fake, haEvent.id, imported, randomUUID()]) {
    failed(await call(owner.token, 'calendar.events.update', { sourceId: householdId, eventId, expectedRevision: 1,
      title: 'Synthetic forbidden edit', requestKey: `synthetic-denial-${eventId}` }), 'NOT_FOUND');
  }
  failed(await call(owner.token, 'calendar.events.create', { ...create(), sourceId: source }), 'NOT_FOUND');
  assert.equal((await pool.query('SELECT 1 FROM integration_items WHERE id=ANY($1::uuid[]) AND revision=1 AND status=\'active\'', [[fake, haEvent.id, imported]])).rowCount, 3);

  const nativeRequest = { ...create(), description: undefined, requestKey: 'synthetic-ha-isolation-create' };
  const native = succeeded(await call(owner.token, 'calendar.events.create', nativeRequest)).event;
  const nativeEdit = { sourceId: householdId, eventId: native.id, requestKey: 'synthetic-native-retitle',
    expectedRevision: 1, title: 'Synthetic retitled native appointment' };
  assert.equal(succeeded(await call(owner.token, 'calendar.events.update', nativeEdit)).event.revision, 2);
  const nativeContent = (await pool.query<{title: string; body: string}>('SELECT title,body FROM integration_items WHERE id=$1', [native.id])).rows[0]!;
  assert.deepEqual(nativeContent, { title: nativeEdit.title, body: nativeEdit.title });
  const nativeListed = succeeded(await call(owner.token, 'calendar.events.list')).events.find((event: { id: string }) => event.id === native.id);
  assert.equal(nativeListed?.description, null);
  const haUpdate = await inject({ method: 'PATCH', url: `${haPath}/${haEvent.id}`, headers: haHeaders,
    payload: { summary: 'Synthetic HA edit', expectedRevision: 1, requestKey: 'synthetic-ha-edit' } });
  assert.equal(haUpdate.statusCode, 200, haUpdate.body);
  const haDelete = await inject({ method: 'DELETE', url: `${haPath}/${haEvent.id}`, headers: haHeaders,
    payload: { expectedRevision: 2, requestKey: 'synthetic-ha-delete' } });
  assert.equal(haDelete.statusCode, 200, haDelete.body);
  const haList = await inject({ method: 'GET', url: `${haPath}?start=${tomorrow}T00:00:00-08:00&end=${dayAfter}T00:00:00-08:00`, headers: haHeaders });
  assert.equal(haList.statusCode, 200, haList.body);
  assert.doesNotMatch(haList.body, new RegExp(native.id));
  for (const method of ['PATCH', 'DELETE'] as const) {
    const forbidden = await inject({ method, url: `${haPath}/${native.id}`, headers: haHeaders,
      payload: { expectedRevision: 2, requestKey: `synthetic-ha-native-${method.toLowerCase()}`,
        ...(method === 'PATCH' && { summary: 'Synthetic forbidden HA edit' }) } });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
  }
  const revoked = await inject({ method: 'POST', url: `/api/v1/households/${householdId}/mcp/authorizations/${owner.grantId}/revoke`, headers: browser() });
  assert.equal(revoked.statusCode, 204, revoked.body);
  assert.equal((await call(owner.token, 'calendar.events.create', nativeRequest)).statusCode, 401);
  assert.equal((await pool.query('SELECT 1 FROM integration_items WHERE id=$1 AND revision=2 AND status=\'active\'', [native.id])).rowCount, 1);
});

test('rollback hides native appointments and removes native authorization while preserving appointments and unrelated scopes', async () => {
  const mixed = await authorize([readScope, writeScope, 'mcp:context']);
  const nativeOnly = await authorize([writeScope, 'offline_access']);
  const unrelated = await authorize(['mcp:context']);
  const imported = (await pool.query<{ id: string }>('SELECT id FROM calendar_sources WHERE household_id=$1', [householdId])).rows[0]!.id;
  await mixed.policy([memberPersonId], [nativeResource(), { kind: 'calendar_source', id: imported }]);
  const input = { ...create(), requestKey: 'synthetic-rollback-preparation' };
  const event = succeeded(await call(mixed.token, 'calendar.events.create', input)).event;
  const before = (await pool.query(`SELECT item.*,receipt.request_key,receipt.event_revision
    FROM integration_items item JOIN mcp_native_calendar_requests receipt ON receipt.event_id=item.id WHERE item.id=$1`, [event.id])).rows;
  assert.equal(before.length, 1);
  const sql = await readFile(new URL('../../../../scripts/mcp-native-calendar-rollback.sql', import.meta.url), 'utf8');
  try {
    await pool.query(sql);
    await pool.query(sql);
    const scope = await pool.query<{ active: boolean }>('SELECT active FROM mcp_oauth_scope_catalog WHERE scope=$1', [writeScope]);
    assert.equal(scope.rows[0]?.active, false);
    assert.equal((await pool.query('SELECT 1 FROM mcp_oauth_grant_resources WHERE resource_kind=$1', ['native_calendar'])).rowCount, 0);
    const saved = await pool.query<{ scopes: string[]; revoked_at: Date | null }>('SELECT scopes,revoked_at FROM mcp_oauth_grants WHERE id=$1', [mixed.grantId]);
    assert.deepEqual(saved.rows[0], { scopes: [readScope, 'mcp:context'], revoked_at: null });
    assert.equal((await pool.query('SELECT 1 FROM mcp_oauth_grant_resources WHERE grant_id=$1 AND resource_id=$2', [mixed.grantId, imported])).rowCount, 1);
    assert.equal((await call(mixed.token, 'calendar.events.create', input)).statusCode, 401);
    assert.equal((await call(nativeOnly.token, 'samvev_context')).statusCode, 401);
    assert.equal(succeeded(await call(unrelated.token, 'samvev_context')).household.id, householdId);
    const after = (await pool.query(`SELECT item.*,receipt.request_key,receipt.event_revision
      FROM integration_items item JOIN mcp_native_calendar_requests receipt ON receipt.event_id=item.id WHERE item.id=$1`, [event.id])).rows;
    assert.deepEqual(after, before);
    const visibleToLegacyReaders = await pool.query(`SELECT item.id FROM integration_items item JOIN integration_connections source
        ON source.id=item.connection_id AND source.household_id=item.household_id AND source.revoked_at IS NULL
      WHERE item.id=$1`, [event.id]);
    assert.equal(visibleToLegacyReaders.rowCount, 0);
  } finally {
    // Other integration test files share this isolated database's scope catalog.
    await pool.query('UPDATE mcp_oauth_scope_catalog SET active=true WHERE scope=$1', [writeScope]);
  }
});
