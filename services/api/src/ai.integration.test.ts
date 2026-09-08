import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { roleCapabilityPresets } from '@samvev/contracts';
import { tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import { AiAdminService } from './ai/admin-service.ts';

const guard = new URL(process.env.DATABASE_URL ?? '');
assert.equal(guard.hostname, 'test-db');
assert.equal(guard.pathname, '/samvev_test');

const keyDir = resolve(process.cwd(), '.local/m21-api-test');
const keyFile = resolve(keyDir, 'master-key');
let app: FastifyInstance;
let aiAdmin: AiAdminService;
let transportMode: 'success' | 'incomplete' = 'success';
let transportHook: (() => Promise<void>) | undefined;
const seenModels: string[] = [];

const transport = async (_url: string, init: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init.body)) as { model: string };
  seenModels.push(body.model);
  if (transportHook) { const hook = transportHook; transportHook = undefined; await hook(); }
  if (transportMode === 'incomplete') return new Response(JSON.stringify({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 7, output_tokens: 64 }
  }), { status: 200 });
  return new Response(JSON.stringify({
    status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    usage: { input_tokens: 6, output_tokens: 1 }
  }), { status: 200 });
};

function cookie(token: string): string { return `samvev_session=${token}`; }
function auth(token: string, csrf: string): Record<string, string> { return { cookie: cookie(token), 'x-csrf-token': csrf }; }

async function fixture(): Promise<{ householdId: string; otherHouseholdId: string; adminToken: string; adminCsrf: string; memberToken: string; memberCsrf: string }> {
  await pool.query('TRUNCATE installations, pairing_requests, rate_limits RESTART IDENTITY CASCADE');
  const installationId = (await pool.query<{ id: string }>(`INSERT INTO installations(claimed_at,claim_token_hash,setup_step)
    VALUES (clock_timestamp(),NULL,'complete') RETURNING id`)).rows[0]!.id;
  const householdId = (await pool.query<{ id: string }>(`INSERT INTO households(installation_id,name,timezone,default_locale)
    VALUES ($1,'Synthetic AI household','Europe/Oslo','en') RETURNING id`, [installationId])).rows[0]!.id;
  const otherHouseholdId = (await pool.query<{ id: string }>(`INSERT INTO households(installation_id,name,timezone,default_locale)
    VALUES ($1,'Other synthetic household','Europe/Oslo','en') RETURNING id`, [installationId])).rows[0]!.id;

  const createAccount = async (name: string, email: string, capabilities: readonly string[]) => {
    const personId = (await pool.query<{ id: string }>('INSERT INTO persons(household_id,display_name,age_group) VALUES ($1,$2,\'adult\') RETURNING id', [householdId, name])).rows[0]!.id;
    const accountId = (await pool.query<{ id: string }>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme)
      VALUES ($1,$2,'synthetic-unused-password-hash','en','system') RETURNING id`, [installationId, email])).rows[0]!.id;
    await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities)
      VALUES ($1,$2,$3,'limited',$4)`, [householdId, accountId, personId, JSON.stringify(capabilities)]);
    const token = `${name.toLowerCase()}-session-token-with-synthetic-entropy`;
    const csrf = `${name.toLowerCase()}-csrf-token-with-synthetic-entropy`;
    await pool.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at)
      VALUES ($1,$2,$3,clock_timestamp()+interval '1 hour')`, [accountId, tokenHash(token), tokenHash(csrf)]);
    return { token, csrf };
  };
  const admin = await createAccount('Admin', 'ai-admin@test.invalid', roleCapabilityPresets.household_admin);
  const member = await createAccount('Member', 'ai-member@test.invalid', ['household.view']);
  return { householdId, otherHouseholdId, adminToken: admin.token, adminCsrf: admin.csrf, memberToken: member.token, memberCsrf: member.csrf };
}

before(async () => {
  await migrate();
  await fs.rm(keyDir, { recursive: true, force: true });
  aiAdmin = new AiAdminService({ keyFile, transport });
  app = await buildApp({ aiKeyFile: keyFile, aiTransport: transport });
});

after(async () => {
  await app.close();
  await pool.end();
  await fs.rm(keyDir, { recursive: true, force: true });
});

test('AI admin settings enforce auth, keep secrets server-side, test selected models and log isolated usage', async () => {
  const f = await fixture();
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/households/${f.householdId}/ai/settings` })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { cookie: cookie(f.memberToken) } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/households/${f.otherHouseholdId}/ai/settings`, headers: { cookie: cookie(f.adminToken) } })).statusCode, 404);

  const initial = await app.inject({ method: 'GET', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { cookie: cookie(f.adminToken) } });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().revision, 0);
  assert.equal(initial.json().enabled, false);
  assert.equal(initial.json().chatGptSubscription.status, 'unavailable');

  const callsBeforeDisabledExecution = seenModels.length;
  await assert.rejects(
    aiAdmin.executeTask(f.householdId, { operation: 'classify', purpose: 'synthetic_classification', input: 'Synthetic input', modelTier: 'routine', sources: [] }),
    (error: unknown) => (error as { code?: string }).code === 'AI_CONFIGURATION_INVALID'
  );
  assert.equal(seenModels.length, callsBeforeDisabledExecution);

  const missingCsrf = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { cookie: cookie(f.adminToken) }, payload: { enabled: true, expectedRevision: 0 } });
  assert.equal(missingCsrf.statusCode, 403);
  const wrongOrigin = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { ...auth(f.adminToken, f.adminCsrf), origin: 'https://attacker.invalid' }, payload: { enabled: true, expectedRevision: 0 } });
  assert.equal(wrongOrigin.statusCode, 403);

  const saved = await app.inject({
    method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { enabled: true, provider: 'openai', apiKey: 'syntheticApiKeyOnlyForM21Tests', defaultModel: 'configured-routine', strongModel: 'configured-strong', expectedRevision: 0 }
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().hasApiKey, true);
  assert.equal(saved.body.includes('syntheticApiKeyOnlyForM21Tests'), false);
  assert.equal('apiKey' in saved.json(), false);
  const stored = await pool.query<{ api_key_ciphertext: string }>('SELECT api_key_ciphertext FROM ai_settings WHERE household_id=$1', [f.householdId]);
  assert.equal(stored.rows[0]!.api_key_ciphertext.includes('syntheticApiKeyOnlyForM21Tests'), false);

  const stale = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf), payload: { enabled: false, expectedRevision: 0 } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'REVISION_CONFLICT');

  const generated = await aiAdmin.executeTask(f.householdId, {
    operation: 'plan', purpose: 'synthetic_plan', input: 'Synthetic planning input', modelTier: 'strong',
    sources: [{ url: 'https://example.invalid/plan', observedAt: '2026-09-08T10:00:00.000Z', uncertainty: 'low' }]
  });
  assert.equal(generated.output, 'OK');
  assert.equal(seenModels.at(-1), 'configured-strong');
  assert.equal(generated.sources[0]?.url, 'https://example.invalid/plan');

  const routine = await app.inject({ method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf), payload: { modelTier: 'routine' } });
  assert.equal(routine.statusCode, 200, routine.body);
  assert.equal(routine.json().available, true);
  assert.equal(seenModels.at(-1), 'configured-routine');

  transportMode = 'incomplete';
  const strong = await app.inject({ method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf), payload: { modelTier: 'strong' } });
  assert.equal(strong.statusCode, 200, strong.body);
  assert.equal(strong.json().available, false);
  assert.equal(strong.json().errorCode, 'AI_RESPONSE_INVALID');
  assert.equal(seenModels.at(-1), 'configured-strong');

  const retained = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf), payload: { enabled: false, expectedRevision: 1 } });
  assert.equal(retained.json().hasApiKey, true);
  transportMode = 'success';
  const whileDisabled = await app.inject({ method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf), payload: { modelTier: 'routine' } });
  assert.equal(whileDisabled.json().available, true);

  const usage = await app.inject({ method: 'GET', url: `/api/v1/households/${f.householdId}/ai/usage`, headers: { cookie: cookie(f.adminToken) } });
  assert.deepEqual(usage.json().summary, { requests: 5, successes: 3, failures: 2, inputTokens: 25, outputTokens: 67 });
  assert.equal(usage.json().recent.some((row: { purpose: string; success: boolean }) => row.purpose === 'synthetic_plan' && row.success), true);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM ai_usage_events WHERE household_id=$1', [f.otherHouseholdId])).rows[0].count, 0);

  transportHook = async () => {
    await pool.query(`UPDATE ai_settings SET strong_model='newer-configured-strong',revision=revision+1,
      availability_status='not_tested',availability_checked_at=NULL,availability_checked_revision=NULL
      WHERE household_id=$1`, [f.householdId]);
  };
  const staleHealth = await app.inject({ method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf), payload: { modelTier: 'strong' } });
  assert.equal(staleHealth.json().available, true);
  const changedDuringTest = await app.inject({ method: 'GET', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { cookie: cookie(f.adminToken) } });
  assert.equal(changedDuringTest.json().revision, 3);
  assert.equal(changedDuringTest.json().availability.status, 'not_tested');
  assert.equal(changedDuringTest.json().availability.checkedAt, null);

  const removed = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf), payload: { apiKey: null, expectedRevision: 3 } });
  assert.equal(removed.json().hasApiKey, false);
  assert.equal((await pool.query('SELECT api_key_ciphertext FROM ai_settings WHERE household_id=$1', [f.householdId])).rows[0].api_key_ciphertext, null);

  const migrations = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM schema_migrations WHERE version='005_ai_provider_foundation.sql'");
  assert.equal(migrations.rows[0]!.count, 1);
  await migrate();
  assert.equal((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM schema_migrations WHERE version='005_ai_provider_foundation.sql'")).rows[0]!.count, 1);
});
