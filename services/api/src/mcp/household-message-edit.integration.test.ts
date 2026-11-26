import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { Capability } from '@samvev/contracts';
import { tokenHash } from '@samvev/core';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { assertIsolatedTestDatabase, pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { messageService, type MessageCreateActor } from '../messages/service.ts';
import { registerHouseholdTools } from './household-tools.ts';

const origin = 'https://samvev.test.invalid';
const callback = 'https://message-editor.test.invalid/oauth/callback';
const scopes = ['mcp:context', 'mcp:messages:read', 'mcp:messages:write'];
const validUntil = '2099-01-01T00:00:00.000Z';
const future = '2098-12-31T08:00:00.000Z';
const editTool = 'household.messages.edit';
const protocolVersion = '2026-07-28';
const meta = {
  [PROTOCOL_VERSION_META_KEY]: protocolVersion,
  [CLIENT_INFO_META_KEY]: { name: 'synthetic-message-editor', version: '1.0.0' },
  [CLIENT_CAPABILITIES_META_KEY]: {}
};

let app: FastifyInstance;
let actor: MessageCreateActor;
let grantId: string;
let personId: string;
let ungrantedPersonId: string;
let displayId: string;
let ungrantedDisplayId: string;
let browserCookie: string;
let csrf: string;
let clientId: string;
let token: string;
let requestId = 0;

function inject(options: InjectOptions) {
  return app.inject({ ...options, headers: { host: new URL(origin).host, ...options.headers } });
}

function browserHeaders() {
  return { cookie: browserCookie, 'x-csrf-token': csrf, origin };
}

function messagePath(messageId?: string) {
  return `/api/v1/households/${actor.householdId}/messages${messageId ? `/${messageId}` : ''}`;
}

async function consent(serial: number) {
  const verifier = `synthetic-edit-verifier-${serial}-0123456789abcdefghijklmnopqrstuvwxyz`;
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: callback, code_challenge: codeChallenge,
    code_challenge_method: 'S256', resource: `${origin}/mcp`, scope: scopes.join(' '), state: `synthetic-edit-state-${serial}`
  });
  const page = await inject({ method: 'GET', url: `/oauth/authorize?${query}`, headers: browserHeaders() });
  assert.equal(page.statusCode, 200, page.body);
  const approval = await inject({
    method: 'POST', url: '/oauth/authorize',
    headers: { ...browserHeaders(), 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ ...Object.fromEntries(query), _csrf: csrf, household_id: actor.householdId, decision: 'approve' }).toString()
  });
  assert.equal(approval.statusCode, 303, approval.body);
  const code = new URL(String(approval.headers.location)).searchParams.get('code');
  assert.ok(code);
  const exchange = await inject({
    method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: callback, code_verifier: verifier, resource: `${origin}/mcp`
    }).toString()
  });
  assert.equal(exchange.statusCode, 200, exchange.body);
  return exchange.json<{ access_token: string }>().access_token;
}

function createInput(idempotencyKey: string, audience: Record<string, unknown>, publishAt?: string) {
  return { body: 'Synthetic original', audience, expiresAt: validUntil, idempotencyKey, ...(publishAt ? { publishAt } : {}) };
}

async function createMessage(key: string, audience: Record<string, unknown>, publishAt?: string) {
  const response = await inject({
    method: 'POST', url: messagePath(), headers: browserHeaders(), payload: createInput(key, audience, publishAt)
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ id: string }>().id;
}

function editViaMcp(messageId: string, expectedRevision: number, changes: Record<string, unknown>) {
  return inject({
    method: 'POST', url: '/mcp',
    headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json',
      'mcp-protocol-version': protocolVersion, 'mcp-method': 'tools/call', 'mcp-name': editTool
    },
    payload: {
      jsonrpc: '2.0', id: ++requestId, method: 'tools/call',
      params: { name: editTool, arguments: { messageId, expectedRevision, ...changes }, _meta: meta }
    }
  });
}

function result(response: LightMyRequestResponse) {
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ result: {
    isError?: boolean;
    content: Array<{ text: string }>;
    structuredContent?: { message: { id: string; state: string; revision: number } };
  } }>().result;
}

function assertToolError(response: LightMyRequestResponse, code: string) {
  const error = result(response);
  assert.equal(error.isError, true, response.body);
  assert.equal(error.content[0]?.text, code);
  assert.equal(error.structuredContent, undefined);
}

async function recipients(messageId: string) {
  const people = await pool.query<{ person_id: string }>(
    'SELECT person_id FROM message_person_audiences WHERE message_id=$1 ORDER BY person_id', [messageId]
  );
  const displays = await pool.query<{ display_id: string; delivery_state: string; delivered_revision: number | null }>(
    'SELECT display_id,delivery_state,delivered_revision FROM message_display_targets WHERE message_id=$1 ORDER BY display_id', [messageId]
  );
  return { people: people.rows.map((person) => person.person_id), displays: displays.rows };
}

async function addPerson(name: string) {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO persons(household_id,display_name,age_group) VALUES($1,$2,'adult') RETURNING id", [actor.householdId, name]
  );
  return result.rows[0]!.id;
}

async function addDisplay(name: string) {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO displays(household_id,name,locale,theme) VALUES($1,$2,'en','light') RETURNING id", [actor.householdId, name]
  );
  return result.rows[0]!.id;
}

before(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app = await buildApp({ runtimeConfig: { publicOrigin: origin, secureCookies: true, trustProxy: false } });
  const begin = await inject({ method: 'POST', url: '/api/v1/setup/begin', headers: { origin } });
  assert.equal(begin.statusCode, 200, begin.body);
  const claim = await inject({
    method: 'POST', url: '/api/v1/setup/claim', headers: { origin },
    payload: {
      claimToken: begin.json().claimToken,
      owner: { displayName: 'Synthetic message editor', email: 'message-editor@test.invalid', password: 'Synthetic-editor-pass-42' },
      household: { name: 'Synthetic message edit household', timezone: 'Europe/Oslo', locale: 'en' },
      preferences: { locale: 'en', theme: 'system' }
    }
  });
  assert.equal(claim.statusCode, 200, claim.body);
  const setCookie = claim.headers['set-cookie'];
  browserCookie = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((value) => value?.split(';')[0]).join('; ');
  csrf = claim.json().csrfToken;
  const householdId = claim.json().householdId as string;
  const members = await pool.query<{ installation_id: string; membership_id: string; account_id: string }>(`SELECT h.installation_id,m.id membership_id,m.account_id
    FROM households h JOIN memberships m ON m.household_id=h.id WHERE h.id=$1`, [householdId]);
  const member = members.rows[0]!;
  actor = { householdId, installationId: member.installation_id, membershipId: member.membership_id, accountId: member.account_id };
  personId = await addPerson('Synthetic granted recipient');
  ungrantedPersonId = await addPerson('Synthetic excluded recipient');
  displayId = await addDisplay('Synthetic granted display');
  ungrantedDisplayId = await addDisplay('Synthetic excluded display');

  const register = await inject({
    method: 'POST', url: '/oauth/register',
    payload: { client_name: 'Synthetic editor MCP', redirect_uris: [callback], token_endpoint_auth_method: 'none' }
  });
  assert.equal(register.statusCode, 201, register.body);
  clientId = register.json().client_id;
  await consent(1);
  const grants = await pool.query<{ id: string; revision: number }>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1', [householdId]);
  const grant = grants.rows[0]!;
  grantId = grant.id;
  const policy = await inject({
    method: 'PUT', url: `/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`, headers: browserHeaders(),
    payload: { scopes, personIds: [personId], displayIds: [displayId], resources: [], expectedRevision: grant.revision }
  });
  assert.equal(policy.statusCode, 200, policy.body);
  token = await consent(2);
});

after(async () => {
  if (app) await app.close();
  await pool.end();
});

test('MCP edit and web PATCH share revisions, recipient replacement and display delivery reset', async () => {
  const messageId = await createMessage('edit-shared-parity', { personIds: [personId], displayIds: [displayId] });
  await pool.query(`UPDATE message_display_targets SET delivery_state='displayed',delivered_revision=1,
    delivered_at=clock_timestamp(),displayed_at=clock_timestamp() WHERE message_id=$1`, [messageId]);

  const mcpEdit = result(await editViaMcp(messageId, 1, { body: 'Synthetic edited by MCP', importance: 'attention' }));
  assert.equal(mcpEdit.isError, undefined, mcpEdit.content[0]?.text);
  assert.deepEqual(mcpEdit.structuredContent, { message: { id: messageId, state: 'published', revision: 2 } });
  assert.deepEqual(JSON.parse(mcpEdit.content[0]!.text), mcpEdit.structuredContent);
  assert.deepEqual(await recipients(messageId), {
    people: [personId], displays: [{ display_id: displayId, delivery_state: 'queued', delivered_revision: null }]
  });

  const expiry = '2098-12-30T10:00:00.000Z';
  const webEdit = await inject({
    method: 'PATCH', url: messagePath(messageId), headers: browserHeaders(),
    payload: { expectedRevision: 2, audience: { displayIds: [displayId] }, expiresAt: expiry }
  });
  assert.equal(webEdit.statusCode, 200, webEdit.body);
  assert.deepEqual(webEdit.json(), {
    id: messageId, state: 'published', revision: 3, body: 'Synthetic edited by MCP', importance: 'attention',
    audience_household: false, publish_at: webEdit.json().publish_at, expires_at: expiry
  });
  assert.deepEqual(await recipients(messageId), {
    people: [], displays: [{ display_id: displayId, delivery_state: 'queued', delivered_revision: null }]
  });

  assertToolError(await editViaMcp(messageId, 2, { body: 'Synthetic stale edit' }), 'REVISION_CONFLICT');
  const lifecycle = await pool.query(`SELECT from_state,to_state,revision,actor_type,actor_id
    FROM message_lifecycle_events WHERE message_id=$1 AND from_state IS NOT NULL ORDER BY revision`, [messageId]);
  assert.deepEqual(lifecycle.rows, [2, 3].map((revision) => ({
    from_state: 'published', to_state: 'published', revision, actor_type: 'account', actor_id: actor.accountId
  })));
  const audit = await pool.query(`SELECT actor_type,actor_id,metadata-'clientId' AS metadata
    FROM audit_events WHERE subject_id=$1 AND action='mcp.message_edited'`, [messageId]);
  assert.deepEqual(audit.rows, [{ actor_type: 'mcp', actor_id: grantId, metadata: { state: 'published', revision: 2 } }]);
});

test('MCP edit requires current exact grants for original and replacement recipients', async () => {
  const messageId = await createMessage('edit-recipient-rights', { personIds: [personId], displayIds: [displayId] });
  assertToolError(await editViaMcp(messageId, 1, { audience: { personIds: [ungrantedPersonId] } }), 'FORBIDDEN');
  assertToolError(await editViaMcp(messageId, 1, { audience: { displayIds: [ungrantedDisplayId] } }), 'FORBIDDEN');
  assertToolError(await editViaMcp(messageId, 1, { audience: {} }), 'VALIDATION_FAILED');

  await pool.query('DELETE FROM mcp_oauth_grant_people WHERE grant_id=$1 AND person_id=$2', [grantId, personId]);
  try {
    assertToolError(await editViaMcp(messageId, 1, { body: 'Synthetic excluded edit' }), 'NOT_FOUND');
    assertToolError(await editViaMcp(messageId, 1, { audience: { displayIds: [displayId] } }), 'NOT_FOUND');
  } finally {
    await pool.query('INSERT INTO mcp_oauth_grant_people(household_id,grant_id,person_id) VALUES($1,$2,$3)', [actor.householdId, grantId, personId]);
  }

  await pool.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE id=$1', [displayId]);
  try {
    assertToolError(await editViaMcp(messageId, 1, { body: 'Synthetic excluded after display revocation' }), 'NOT_FOUND');
    assertToolError(await editViaMcp(messageId, 1, { audience: { personIds: [personId] } }), 'NOT_FOUND');
  } finally {
    await pool.query('UPDATE displays SET revoked_at=NULL WHERE id=$1', [displayId]);
  }

  const broadcastId = await createMessage('edit-household-broadcast', { household: true });
  assertToolError(await editViaMcp(broadcastId, 1, { audience: { personIds: [personId] } }), 'NOT_FOUND');
  const unchanged = await pool.query('SELECT body,revision FROM messages WHERE id=$1', [messageId]);
  assert.deepEqual(unchanged.rows, [{ body: 'Synthetic original', revision: 1 }]);
  const audit = await pool.query("SELECT 1 FROM audit_events WHERE action='mcp.message_edited' AND subject_id=ANY($1::uuid[])", [[messageId, broadcastId]]);
  assert.equal(audit.rowCount, 0);
});

test('MCP edit enforces live management, display and scheduling rights and the web time rules', async () => {
  const publishedId = await createMessage('edit-published-schedule', { personIds: [personId], displayIds: [displayId] });
  const scheduledId = await createMessage('edit-scheduled-rights', { personIds: [personId] }, future);
  assertToolError(await editViaMcp(publishedId, 1, { publishAt: future }), 'CONFLICT');
  assertToolError(await editViaMcp(scheduledId, 1, { expiresAt: '2000-01-01T00:00:00.000Z' }), 'SCHEDULE_INVALID');
  const updatedSchedule = result(await editViaMcp(scheduledId, 1, { publishAt: '2098-12-31T09:00:00.000Z' }));
  assert.deepEqual(updatedSchedule.structuredContent, { message: { id: scheduledId, state: 'scheduled', revision: 2 } });

  const otherPersonId = await addPerson('Synthetic other message author');
  const other = await pool.query<{ id: string }>(`INSERT INTO memberships(household_id,person_id,role_preset,capabilities)
    VALUES($1,$2,'limited',$3) RETURNING id`, [actor.householdId, otherPersonId, JSON.stringify(['message.create.household'])]);
  const otherMessage = await messageService.create({ ...actor, membershipId: other.rows[0]!.id },
    createInput('edit-by-other-author', { personIds: [personId] }), async () => ['message.create.household']);
  const otherId = String(otherMessage.id);
  const { capabilities } = (await pool.query<{ capabilities: Capability[] }>('SELECT capabilities FROM memberships WHERE id=$1', [actor.membershipId])).rows[0]!;
  await pool.query(`UPDATE memberships SET capabilities=capabilities-'message.manage.household'-'message.publish.display'-'message.schedule'
    WHERE id=$1`, [actor.membershipId]);
  try {
    assertToolError(await editViaMcp(publishedId, 1, { body: 'Synthetic display edit denied' }), 'NOT_FOUND');
    assertToolError(await editViaMcp(scheduledId, 2, { body: 'Synthetic schedule edit denied' }), 'FORBIDDEN');
    assertToolError(await editViaMcp(otherId, 1, { body: 'Synthetic admin edit denied' }), 'FORBIDDEN');
  } finally {
    await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1', [actor.membershipId, JSON.stringify(capabilities)]);
  }

  const edited = result(await editViaMcp(otherId, 1, { body: 'Synthetic admin edit allowed' }));
  assert.deepEqual(edited.structuredContent, { message: { id: otherId, state: 'published', revision: 2 } });
  const audit = await pool.query(`SELECT action FROM audit_events WHERE subject_id=$1
    AND action IN ('mcp.message_edited','message.edited_by_admin') ORDER BY action`, [otherId]);
  assert.deepEqual(audit.rows, [{ action: 'mcp.message_edited' }, { action: 'message.edited_by_admin' }]);
});

test('a failed transactional edit audit rolls back body, audiences and lifecycle event', async () => {
  const messageId = await createMessage('edit-audit-rollback', { personIds: [personId], displayIds: [displayId] });
  await assert.rejects(messageService.edit(
    { ...actor, mcpGrantId: grantId }, messageId,
    { expectedRevision: 1, body: 'Synthetic unsuccessful edit', audience: { personIds: [personId] } },
    async () => ['message.publish.display', 'display.manage'],
    async () => { throw new Error('synthetic edit audit failure'); }
  ), /synthetic edit audit failure/);
  const stored = await pool.query('SELECT body,revision FROM messages WHERE id=$1', [messageId]);
  assert.deepEqual(stored.rows, [{ body: 'Synthetic original', revision: 1 }]);
  assert.deepEqual(await recipients(messageId), {
    people: [personId], displays: [{ display_id: displayId, delivery_state: 'queued', delivered_revision: null }]
  });
  const events = await pool.query('SELECT revision FROM message_lifecycle_events WHERE message_id=$1 ORDER BY revision', [messageId]);
  assert.deepEqual(events.rows, [{ revision: 1 }]);
});

test('the message list tool accepts a valid delegated principal with only household.view', async () => {
  const messageId = await createMessage('message-list-view-only', { personIds: [personId] });
  const tokenSet = await pool.query<{ id: string }>(
    'SELECT id FROM mcp_oauth_token_sets WHERE grant_id=$1 AND access_token_hash=$2', [grantId, tokenHash(token)]
  );
  assert.equal(tokenSet.rowCount, 1);

  // Exercise live tool authorization after principal resolution. The HTTP
  // transport's separate administrator requirement is unchanged.
  let list: ((input: unknown) => Promise<unknown>) | undefined;
  registerHouseholdTools({
    registerTool(name, _options, handler) {
      if (name === 'household.messages.list') list = handler;
    }
  }, { principal: { ...actor, grantId, tokenSetId: tokenSet.rows[0]!.id } });
  assert.ok(list);

  const { capabilities } = (await pool.query<{ capabilities: Capability[] }>(
    'SELECT capabilities FROM memberships WHERE id=$1', [actor.membershipId]
  )).rows[0]!;
  await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1', [actor.membershipId, JSON.stringify(['household.view'])]);
  try {
    const listed = await list({}) as { messages: Array<{ id: string }> };
    assert.ok(listed.messages.some((message) => message.id === messageId));
  } finally {
    await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1', [actor.membershipId, JSON.stringify(capabilities)]);
  }
});

async function waitForBlockedQuery(blockingPid: number, queryFragment: string) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const query = await pool.query<{ pid: number }>(`SELECT activity.pid FROM pg_stat_activity activity
      WHERE activity.datname=current_database() AND activity.wait_event_type='Lock'
        AND $1=ANY(pg_blocking_pids(activity.pid)) AND position($2 in activity.query)>0`, [blockingPid, queryFragment]);
    if (query.rows[0]) return query.rows[0].pid;
    await delay(20);
  }
  assert.fail(`No lock wait reached for ${queryFragment}`);
}

test('concurrent MCP edit and display revocation finish in authority order and cannot requeue a revoked display', { timeout: 15_000 }, async () => {
  const raceDisplay = await addDisplay('Synthetic concurrent revocation display');
  const credential = 'synthetic-concurrent-revocation-display-credential';
  await pool.query(`UPDATE displays SET credential_hash=$2,credential_expires_at=clock_timestamp()+interval '1 hour'
    WHERE id=$1`, [raceDisplay, tokenHash(credential)]);
  await pool.query('INSERT INTO mcp_oauth_grant_displays(household_id,grant_id,display_id) VALUES($1,$2,$3)', [actor.householdId, grantId, raceDisplay]);
  const messageId = await createMessage('message-edit-revocation-race', { displayIds: [raceDisplay] });
  const displayProjection = () => inject({ method: 'GET', url: '/api/v1/display/projection', headers: { cookie: `samvev_display=${credential}` } });
  const previousProjection = await displayProjection();
  assert.equal(previousProjection.statusCode, 200, previousProjection.body);

  const blocker = await pool.connect();
  const pending: Promise<LightMyRequestResponse>[] = [];
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM messages WHERE id=$1 FOR UPDATE', [messageId]);
    const { pid: blockerPid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!;
    pending.push(editViaMcp(messageId, 1, { body: 'Synthetic edit preceding revocation' }));
    // The edit now holds its delegated actor authority and is waiting for the
    // message row. A display-first revocation would lock the display while
    // waiting on that actor, forming a cycle when the blocker is released.
    const editPid = await waitForBlockedQuery(blockerPid, 'FROM messages WHERE id=');
    pending.push(inject({
      method: 'PATCH', url: `/api/v1/households/${actor.householdId}/displays/${raceDisplay}`,
      headers: browserHeaders(), payload: { revoked: true }
    }));
    await waitForBlockedQuery(editPid, 'FROM sessions session JOIN accounts account');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.allSettled(pending);
  }

  assert.equal(pending.length, 2);
  const edited = result(await pending[0]!);
  assert.deepEqual(edited.structuredContent, { message: { id: messageId, state: 'published', revision: 2 } });
  const revoked = await pending[1]!;
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.ok(revoked.json().revoked_at);
  assertToolError(await editViaMcp(messageId, 2, { body: 'Synthetic edit after revocation' }), 'NOT_FOUND');

  const delivery = await pool.query(`SELECT delivery_state,delivered_revision,failure_code
    FROM message_display_targets WHERE message_id=$1 AND display_id=$2`, [messageId, raceDisplay]);
  assert.deepEqual(delivery.rows, [{ delivery_state: 'failed', delivered_revision: null, failure_code: 'DISPLAY_REVOKED' }]);
  const stored = await pool.query('SELECT body,revision FROM messages WHERE id=$1', [messageId]);
  assert.deepEqual(stored.rows, [{ body: 'Synthetic edit preceding revocation', revision: 2 }]);
  const deniedProjection = await displayProjection();
  assert.equal(deniedProjection.statusCode, 401, deniedProjection.body);
});

test('display revocation still checks session expiry after waiting for the display lock', { timeout: 12_000 }, async () => {
  const waitingDisplay = await addDisplay('Synthetic display blocked during session expiry');
  const sessionCookie = browserCookie.split('; ').find((cookie) => cookie.startsWith('samvev_session='));
  assert.ok(sessionCookie);
  const session = (await pool.query<{ id: string; expires_at: Date }>(
    'SELECT id,expires_at FROM sessions WHERE token_hash=$1', [tokenHash(sessionCookie.slice('samvev_session='.length))]
  )).rows[0];
  assert.ok(session);

  const blocker = await pool.connect();
  let pending: Promise<LightMyRequestResponse> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM displays WHERE id=$1 FOR UPDATE', [waitingDisplay]);
    const { pid: blockerPid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!;
    await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '3 seconds' WHERE id=$1", [session.id]);
    pending = inject({
      method: 'PATCH', url: `/api/v1/households/${actor.householdId}/displays/${waitingDisplay}`,
      headers: browserHeaders(), payload: { revoked: true }
    });
    await waitForBlockedQuery(blockerPid, 'FROM displays WHERE id=$1 AND household_id=$2 FOR UPDATE');
    await pool.query(`SELECT pg_sleep(greatest(0, extract(epoch FROM (expires_at-clock_timestamp()))+0.05))
      FROM sessions WHERE id=$1`, [session.id]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (pending) await Promise.allSettled([pending]);
    await pool.query('UPDATE sessions SET expires_at=$2 WHERE id=$1', [session.id, session.expires_at]);
  }

  assert.ok(pending);
  const denied = await pending;
  assert.equal(denied.statusCode, 401, denied.body);
  const display = await pool.query('SELECT revoked_at FROM displays WHERE id=$1', [waitingDisplay]);
  assert.deepEqual(display.rows, [{ revoked_at: null }]);
});

test('display writes sharing a browser session serialize on authority without a session lock upgrade deadlock', { timeout: 15_000 }, async () => {
  const firstDisplay = await addDisplay('Synthetic first display in same-session writes');
  const secondDisplay = await addDisplay('Synthetic second display in same-session writes');
  const update = (target: string) => inject({
    method: 'PATCH', url: `/api/v1/households/${actor.householdId}/displays/${target}`,
    headers: browserHeaders(), payload: { privacyMode: true }
  });

  const blocker = await pool.connect();
  const pending: Promise<LightMyRequestResponse>[] = [];
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM displays WHERE id=$1 FOR UPDATE', [firstDisplay]);
    const { pid: blockerPid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!;
    pending.push(update(firstDisplay));
    const firstPid = await waitForBlockedQuery(blockerPid, 'FROM displays WHERE id=$1 AND household_id=$2 FOR UPDATE');
    pending.push(update(secondDisplay));
    await waitForBlockedQuery(firstPid, 'FROM sessions session JOIN accounts account');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.allSettled(pending);
  }

  assert.equal(pending.length, 2);
  for (const response of await Promise.all(pending)) {
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().privacy_mode, true);
  }
});
