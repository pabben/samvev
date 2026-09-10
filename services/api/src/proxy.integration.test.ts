import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { roleCapabilityPresets } from '@samvev/contracts';
import { hashPassword, tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import { loadRuntimeConfig } from './runtime-config.ts';

const publicOrigin = 'https://samvev.pabben.org';
const proxyHeaders = {
  host: 'app:4173',
  'x-forwarded-for': '203.0.113.24',
  'x-forwarded-host': 'samvev.pabben.org',
  'x-forwarded-proto': 'https'
};

let app: FastifyInstance;
let householdId: string;

function cookies(response: LightMyRequestResponse): string {
  const values = response.headers['set-cookie'];
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return list.map((value) => value.split(';')[0]).join('; ');
}

before(async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (databaseUrl.hostname !== 'test-db' || databaseUrl.pathname !== '/samvev_test') {
    throw new Error('Proxy integration tests refuse non-isolated DATABASE_URL');
  }
  await migrate();
  await pool.query('TRUNCATE installations, pairing_requests, rate_limits RESTART IDENTITY CASCADE');
  const installation = await pool.query<{ id: string }>(`
    INSERT INTO installations(claimed_at,setup_step,default_locale)
    VALUES (clock_timestamp(),'complete','nb') RETURNING id`);
  const household = await pool.query<{ id: string }>(`
    INSERT INTO households(installation_id,name,timezone,default_locale)
    VALUES ($1,'Proxy test household','Europe/Oslo','nb') RETURNING id`, [installation.rows[0]!.id]);
  householdId = household.rows[0]!.id;
  const person = await pool.query<{ id: string }>(`
    INSERT INTO persons(household_id,display_name,age_group)
    VALUES ($1,'Proxy test owner','adult') RETURNING id`, [householdId]);
  const account = await pool.query<{ id: string }>(`
    INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme)
    VALUES ($1,'proxy-owner@test.invalid',$2,'nb','dark') RETURNING id`, [
      installation.rows[0]!.id,
      await hashPassword('Synthetic-proxy-owner-pass-42')
    ]);
  await pool.query(`
    INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities)
    VALUES ($1,$2,$3,'installation_admin',$4)`, [
      householdId,
      account.rows[0]!.id,
      person.rows[0]!.id,
      JSON.stringify(roleCapabilityPresets.installation_admin)
    ]);

  app = await buildApp({
    runtimeConfig: loadRuntimeConfig({
      SAMVEV_PUBLIC_ORIGIN: publicOrigin,
      SAMVEV_TRUST_PROXY: '192.168.0.188/32'
    })
  });
  app.get('/__proxy-test', async (request) => ({
    protocol: request.protocol,
    hostname: request.hostname,
    ip: request.ip
  }));
});

after(async () => {
  await app.close();
  await pool.end();
});

test('public origin, trusted proxy, cookies, authorization and SSE remain safe', async () => {
  const forwarded = await app.inject({
    method: 'GET',
    url: '/__proxy-test',
    remoteAddress: '192.168.0.188',
    headers: proxyHeaders
  });
  assert.deepEqual(forwarded.json(), {
    protocol: 'https',
    hostname: 'samvev.pabben.org',
    ip: '203.0.113.24'
  });
  const directLan = await app.inject({
    method: 'GET',
    url: '/__proxy-test',
    remoteAddress: '192.168.0.50',
    headers: proxyHeaders
  });
  assert.deepEqual(directLan.json(), {
    protocol: 'http',
    hostname: 'app',
    ip: '192.168.0.50'
  });

  const health = await app.inject({ method: 'GET', url: '/api/v1/health', headers: proxyHeaders });
  assert.deepEqual(health.json(), { status: 'ok', version: 1 });
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/setup/status', headers: proxyHeaders })).json().claimed, true);
  assert.equal((await app.inject({
    method: 'POST',
    url: '/api/v1/setup/begin',
    remoteAddress: '192.168.0.188',
    headers: { ...proxyHeaders, origin: publicOrigin }
  })).statusCode, 409);

  for (const url of [
    '/api/v1/me',
    `/api/v1/households/${householdId}/ai/settings`,
    `/api/v1/households/${householdId}/messages`,
    '/api/v1/display/events'
  ]) {
    assert.equal((await app.inject({ method: 'GET', url, headers: proxyHeaders })).statusCode, 401, url);
  }

  const rejectedLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...proxyHeaders, origin: 'https://attacker.invalid' },
    payload: { email: 'proxy-owner@test.invalid', password: 'Synthetic-proxy-owner-pass-42' }
  });
  assert.equal(rejectedLogin.statusCode, 403);
  const rejectedLanOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...proxyHeaders, origin: 'http://192.168.0.144:4173' },
    payload: { email: 'proxy-owner@test.invalid', password: 'Synthetic-proxy-owner-pass-42' }
  });
  assert.equal(rejectedLanOrigin.statusCode, 403);
  const missingOriginLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: proxyHeaders,
    payload: { email: 'proxy-owner@test.invalid', password: 'Synthetic-proxy-owner-pass-42' }
  });
  assert.equal(missingOriginLogin.statusCode, 403);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...proxyHeaders, origin: publicOrigin },
    payload: { email: 'proxy-owner@test.invalid', password: 'Synthetic-proxy-owner-pass-42' }
  });
  assert.equal(login.statusCode, 200, login.body);
  const loginSetCookie = String(login.headers['set-cookie']);
  assert.match(loginSetCookie, /samvev_session=.*HttpOnly.*Secure.*SameSite=Strict/i);
  assert.match(loginSetCookie, /samvev_csrf=.*Secure.*SameSite=Strict/i);
  const memberCookie = cookies(login);
  const csrf = login.json().csrfToken as string;

  const missingCsrf = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    headers: { ...proxyHeaders, origin: publicOrigin, cookie: memberCookie },
    payload: { theme: 'light' }
  });
  assert.equal(missingCsrf.statusCode, 403);
  const allowedMutation = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    headers: { ...proxyHeaders, origin: publicOrigin, cookie: memberCookie, 'x-csrf-token': csrf },
    payload: { theme: 'light' }
  });
  assert.equal(allowedMutation.statusCode, 200, allowedMutation.body);
  assert.equal((await app.inject({
    method: 'GET',
    url: `/api/v1/households/${householdId}/ai/settings`,
    headers: { ...proxyHeaders, cookie: memberCookie }
  })).statusCode, 200);

  const verifier = 'proxy-display-verifier-with-enough-entropy-0123456789';
  const pairing = await app.inject({
    method: 'POST',
    url: '/api/v1/display/pairing/start',
    headers: { ...proxyHeaders, origin: publicOrigin },
    payload: { verifierHash: createHash('sha256').update(verifier).digest('hex') }
  });
  assert.equal(pairing.statusCode, 201, pairing.body);
  const approve = await app.inject({
    method: 'POST',
    url: `/api/v1/households/${householdId}/displays/pairing/approve`,
    headers: { ...proxyHeaders, origin: publicOrigin, cookie: memberCookie, 'x-csrf-token': csrf },
    payload: {
      code: pairing.json().code,
      name: 'Proxy display',
      locale: 'nb',
      theme: 'dark',
      privacyMode: false,
      allowedContent: 'household_messages'
    }
  });
  assert.equal(approve.statusCode, 201, approve.body);
  const redeem = await app.inject({
    method: 'POST',
    url: '/api/v1/display/pairing/redeem',
    headers: { ...proxyHeaders, origin: publicOrigin },
    payload: { pairingId: pairing.json().pairingId, verifier }
  });
  assert.equal(redeem.statusCode, 200, redeem.body);
  assert.match(String(redeem.headers['set-cookie']), /samvev_display=.*HttpOnly.*Secure.*SameSite=Strict/i);

  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const stream = await fetch(`${address}/api/v1/display/events`, {
    headers: { ...proxyHeaders, cookie: cookies(redeem) },
    signal: controller.signal
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.equal(stream.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');
  const reader = stream.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  controller.abort();
  await reader.cancel().catch(() => undefined);

  const trustedRateLimit = await pool.query<{ count: number }>(`
    SELECT count(*)::int AS count FROM rate_limits
    WHERE bucket='setup_begin' AND key_hash=$1`, [tokenHash('203.0.113.24')]);
  assert.equal(trustedRateLimit.rows[0]!.count, 1);
});
