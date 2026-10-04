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
const seenUrls: string[] = [];
const seenAuthorization: Array<string | null> = [];
const seenReasoningEfforts: Array<string | undefined> = [];

const transport = async (url: string, init: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init.body)) as { model: string; reasoning_effort?: string };
  seenModels.push(body.model);
  seenUrls.push(url);
  seenAuthorization.push(new Headers(init.headers).get('authorization'));
  seenReasoningEfforts.push(body.reasoning_effort);
  if (transportHook) { const hook = transportHook; transportHook = undefined; await hook(); }
  if (url.endsWith('/chat/completions')) {
    if (transportMode === 'incomplete') return new Response(JSON.stringify({
      choices: [], usage: { prompt_tokens: 7, completion_tokens: 64 }
    }), { status: 200 });
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 6, completion_tokens: 1 }
    }), { status: 200 });
  }
  if (transportMode === 'incomplete') return new Response(JSON.stringify({
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 7, output_tokens: 64 }
  }), { status: 200 });
  return new Response(JSON.stringify({
    status: 'completed', model:body.model,service_tier:'standard', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
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
  assert.equal(initial.headers['cache-control'],'private, no-store');
  assert.equal(initial.json().revision, 0);
  assert.equal(initial.json().enabled, false);
  assert.equal(initial.json().defaultReasoningEffort, 'none');
  assert.equal(initial.json().strongReasoningEffort, 'medium');
  assert.equal(initial.json().chatGptSubscription.status, 'not_configured');
  assert.equal(initial.json().chatGptSubscription.feasibility, 'documented_preview');

  const callsBeforeDisabledExecution = seenModels.length;
  await assert.rejects(
    aiAdmin.executeTask(f.householdId, { operation: 'classify', purpose: 'synthetic_classification', input: 'Synthetic input', modelTier: 'routine', sources: [] }),
    (error: unknown) => (error as { code?: string }).code === 'AI_DISABLED'
  );
  assert.equal(seenModels.length, callsBeforeDisabledExecution);

  const missingCsrf = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { cookie: cookie(f.adminToken) }, payload: { enabled: true, expectedRevision: 0 } });
  assert.equal(missingCsrf.statusCode, 403);
  const wrongOrigin = await app.inject({ method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: { ...auth(f.adminToken, f.adminCsrf), origin: 'https://attacker.invalid' }, payload: { enabled: true, expectedRevision: 0 } });
  assert.equal(wrongOrigin.statusCode, 403);

  const saved = await app.inject({
    method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { enabled: true, provider: 'openai', apiKey: 'syntheticApiKeyOnlyForM21Tests', defaultModel: 'configured-routine', strongModel: 'configured-strong', defaultReasoningEffort: 'low', strongReasoningEffort: 'high', expectedRevision: 0 }
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().hasApiKey, true);
  assert.equal(saved.json().defaultReasoningEffort, 'low');
  assert.equal(saved.json().strongReasoningEffort, 'high');
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
  assert.equal(retained.json().defaultReasoningEffort, 'low');
  assert.equal(retained.json().strongReasoningEffort, 'high');
  transportMode = 'success';
  const whileDisabled = await app.inject({ method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf), payload: { modelTier: 'routine' } });
  assert.equal(whileDisabled.json().available, true);

  const usage = await app.inject({ method: 'GET', url: `/api/v1/households/${f.householdId}/ai/usage`, headers: { cookie: cookie(f.adminToken) } });
  assert.equal(usage.statusCode,200,usage.body);
  assert.equal(usage.headers['cache-control'],'private, no-store');
  assert.deepEqual(usage.json().summary, { requests: 3, successes: 2, failures: 1, inputTokens: 19, outputTokens: 66,unknownUsageCount:0,preflightRejections:0,pendingAttempts:0,legacyUnknownAttempts:0 });
  assert.equal(usage.json().recent.some((row: { purpose: string; success: boolean }) => row.purpose === 'connection_test' && row.success), true);
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

  const localSaved = await app.inject({
    method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf),
    payload: {
      enabled: true, provider: 'openai_compatible', baseUrl: 'http://127.0.0.1:11434/v1/',
      defaultModel: 'local-routine', strongModel: 'local-strong',
      defaultReasoningEffort: 'none', strongReasoningEffort: 'high', expectedRevision: 3
    }
  });
  assert.equal(localSaved.statusCode, 200, localSaved.body);
  assert.equal(localSaved.json().baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(localSaved.json().hasApiKey, false, 'provider changes must not retain the OpenAI key');
  assert.equal(localSaved.json().defaultReasoningEffort, 'none');
  assert.equal(localSaved.json().strongReasoningEffort, 'high');
  assert.equal(localSaved.json().providers.find((item: { id: string }) => item.id === 'openai_compatible').runtimeAvailable, true);

  const localRoutineTest = await app.inject({
    method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { modelTier: 'routine' }
  });
  assert.equal(localRoutineTest.json().available, true);
  assert.equal(seenModels.at(-1), 'local-routine');
  assert.equal(seenReasoningEfforts.at(-1), 'none');

  const localTest = await app.inject({
    method: 'POST', url: `/api/v1/households/${f.householdId}/ai/test`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { modelTier: 'strong' }
  });
  assert.equal(localTest.json().available, true);
  assert.equal(seenModels.at(-1), 'local-strong');
  assert.equal(seenReasoningEfforts.at(-1), 'none');
  assert.equal(seenUrls.at(-1), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(seenAuthorization.at(-1), null);

  const localResult = await aiAdmin.executeTask(f.householdId, {
    operation: 'classify', purpose: 'synthetic_local_classification', input: 'Synthetic local input',
    modelTier: 'routine', sources: []
  });
  assert.equal(localResult.output, 'OK');
  assert.equal(seenModels.at(-1), 'local-routine');
  assert.equal(seenReasoningEfforts.at(-1), 'none');

  const localStrongResult = await aiAdmin.executeTask(f.householdId, {
    operation: 'plan', purpose: 'synthetic_local_strong', input: 'Synthetic local strong input',
    modelTier: 'strong', sources: []
  });
  assert.equal(localStrongResult.output, 'OK');
  assert.equal(seenModels.at(-1), 'local-strong');
  assert.equal(seenReasoningEfforts.at(-1), 'high');

  const repairSession=await aiAdmin.createTaskSession(f.householdId,{
    operation:'plan',purpose:'synthetic_format_repair',input:'Return the already verified facts as strict JSON.',
    modelTier:'strong',sources:[]
  },'default',[],undefined,'format_repair');
  try{assert.equal((await repairSession.next()).output,'OK');}
  finally{repairSession.close();}
  assert.equal(seenModels.at(-1),'local-strong','format repair must keep the selected strong model');
  assert.equal(seenReasoningEfforts.at(-1),'none','format repair must reserve output budget instead of producing a reasoning trace');

  const preflightTransportCalls=seenModels.length;
  const malformed=await aiAdmin.createTaskSession(f.householdId,{operation:'plan',purpose:'synthetic_preflight',input:'Synthetic',modelTier:'routine',sources:[]},'default',[{name:'synthetic.lookup',description:'Synthetic only',inputSchema:{type:'object',properties:{},additionalProperties:false}}]);
  await assert.rejects(malformed.next([{callId:'not-pending',name:'synthetic.lookup',output:'{}'}]),(error:unknown)=>(error as {code?:string}).code==='AI_RESPONSE_INVALID');
  malformed.close();
  assert.equal(seenModels.length,preflightTransportCalls,'provider-local rejection must not be recorded as an HTTP dispatch');
  assert.deepEqual((await pool.query(`SELECT actual_dispatch,outcome FROM ai_usage_events WHERE household_id=$1 AND purpose='synthetic_preflight'`,[f.householdId])).rows,[{actual_dispatch:false,outcome:'preflight_rejected'}]);

  const localKey = await app.inject({
    method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { apiKey: 'short-local-key', expectedRevision: 4 }
  });
  assert.equal(localKey.statusCode, 200, localKey.body);
  assert.equal(localKey.json().hasApiKey, true);
  assert.equal(localKey.body.includes('short-local-key'), false);

  const movedEndpoint = await app.inject({
    method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { baseUrl: 'http://192.168.1.50:8080/openai/v1', expectedRevision: 5 }
  });
  assert.equal(movedEndpoint.statusCode, 200, movedEndpoint.body);
  assert.equal(movedEndpoint.json().hasApiKey, false, 'endpoint changes must clear the prior endpoint credential');
  assert.equal((await pool.query('SELECT api_key_ciphertext FROM ai_settings WHERE household_id=$1', [f.householdId])).rows[0].api_key_ciphertext, null);

  const blockedEndpoint = await app.inject({
    method: 'PATCH', url: `/api/v1/households/${f.householdId}/ai/settings`, headers: auth(f.adminToken, f.adminCsrf),
    payload: { baseUrl: 'http://169.254.169.254/latest', expectedRevision: 6 }
  });
  assert.equal(blockedEndpoint.statusCode, 422, blockedEndpoint.body);
  assert.equal(blockedEndpoint.json().error.code, 'AI_ENDPOINT_BLOCKED');

  const routeRevision=(await pool.query<{revision:number}>('SELECT revision FROM ai_settings WHERE household_id=$1',[f.householdId])).rows[0]!.revision;
  const staleSession=await aiAdmin.createTaskSession(f.householdId,{operation:'plan',purpose:'synthetic_execution_binding',input:'Synthetic',modelTier:'routine',sources:[]},'default',[],undefined,'analysis',{expectedProvider:'openai_compatible',expectedSettingsRevision:routeRevision});
  await pool.query('UPDATE ai_settings SET revision=revision+1 WHERE household_id=$1',[f.householdId]);const callsBeforeStaleDispatch=seenModels.length;await assert.rejects(staleSession.next(),(error:unknown)=>(error as {code?:string}).code==='AI_CONFIGURATION_INVALID');staleSession.close();assert.equal(seenModels.length,callsBeforeStaleDispatch,'a queued stale route binding must be rejected before transport');assert.deepEqual((await pool.query(`SELECT actual_dispatch,outcome FROM ai_usage_events WHERE household_id=$1 AND purpose='synthetic_execution_binding'`,[f.householdId])).rows,[{actual_dispatch:false,outcome:'preflight_rejected'}]);
  const owner=(await pool.query<{account_id:string;membership_id:string}>(`SELECT m.account_id,m.id membership_id FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.household_id=$1 AND a.email_normalized='ai-admin@test.invalid'`,[f.householdId])).rows[0]!;const draftTask=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier) VALUES($1,$2,'Synthetic first preview','Interpret a synthetic source','https://example.invalid/source','["web.open"]',60,1,'18:00','default','routine') RETURNING id`,[f.householdId,owner.membership_id])).rows[0]!;const currentRevision=routeRevision+1;const preview=await aiAdmin.createTaskSession(f.householdId,{operation:'plan',purpose:'monitor_interpretation',input:'Synthetic',modelTier:'routine',sources:[]},'default',[],undefined,'analysis',{ownerAccountId:owner.account_id,ownerMembershipId:owner.membership_id,taskId:draftTask.id,taskRevision:1,category:'setup',expectedProvider:'openai_compatible',expectedSettingsRevision:currentRevision});assert.equal((await preview.next()).output,'OK','a first draft interpretation preview does not require recurring-task approval');preview.close();
  const controller=new AbortController();const abortSession=await aiAdmin.createTaskSession(f.householdId,{operation:'plan',purpose:'synthetic_abort_during_authorization',input:'Synthetic',modelTier:'routine',sources:[]},'default',[],controller.signal,'analysis',{expectedProvider:'openai_compatible',expectedSettingsRevision:currentRevision});const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT household_id FROM ai_settings WHERE household_id=$1 FOR UPDATE',[f.householdId]);const callsBeforeAbort=seenModels.length;const aborted=abortSession.next();await new Promise((resolve)=>setTimeout(resolve,30));controller.abort();await lock.query('ROLLBACK');lock.release();await assert.rejects(aborted,(error:unknown)=>(error as {code?:string}).code==='AI_TIMEOUT');abortSession.close();assert.equal(seenModels.length,callsBeforeAbort,'an abort while final authorization waits must never reach transport');assert.deepEqual((await pool.query(`SELECT actual_dispatch,outcome FROM ai_usage_events WHERE household_id=$1 AND purpose='synthetic_abort_during_authorization'`,[f.householdId])).rows,[{actual_dispatch:false,outcome:'preflight_rejected'}]);

  const usageBeforeLargeTotals = await app.inject({
    method: 'GET', url: `/api/v1/households/${f.householdId}/ai/usage`, headers: { cookie: cookie(f.adminToken) }
  });
  const ownerAccountId=(await pool.query<{id:string}>(`SELECT id FROM accounts WHERE email_normalized='ai-admin@test.invalid'`)).rows[0]!.id;
  await pool.query(`INSERT INTO ai_usage_events(
    household_id,provider,model,operation,purpose,success,input_tokens,output_tokens,owner_account_id,actual_dispatch,outcome,route,category
  ) VALUES ($1,'openai_compatible','synthetic-large-counter','generate','synthetic_counter',true,2000000000,0,$2,true,'completed','local','normal'),
           ($1,'openai_compatible','synthetic-large-counter','generate','synthetic_counter',true,2000000000,0,$2,true,'completed','local','normal')`, [f.householdId,ownerAccountId]);
  const usageAfterLargeTotals = await app.inject({
    method: 'GET', url: `/api/v1/households/${f.householdId}/ai/usage`, headers: { cookie: cookie(f.adminToken) }
  });
  assert.equal(
    usageAfterLargeTotals.json().summary.inputTokens - usageBeforeLargeTotals.json().summary.inputTokens,
    4_000_000_000
  );

  const migrations = await pool.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version IN ('005_ai_provider_foundation.sql','006_openai_compatible_provider.sql','010_ai_reasoning_effort.sql') ORDER BY version");
  assert.deepEqual(migrations.rows.map((row) => row.version), ['005_ai_provider_foundation.sql', '006_openai_compatible_provider.sql', '010_ai_reasoning_effort.sql']);
  await migrate();
  assert.equal((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM schema_migrations WHERE version='010_ai_reasoning_effort.sql'")).rows[0]!.count, 1);
});

test('reasoning migration preserves existing provider configuration and adds only its defaults',async()=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE ai_settings(
      household_id uuid PRIMARY KEY,enabled boolean NOT NULL,provider text NOT NULL,
      api_key_ciphertext text,base_url text,default_model text NOT NULL,strong_model text NOT NULL
    )`);
    await client.query(`SET LOCAL search_path TO pg_temp`);
    await client.query(`INSERT INTO ai_settings VALUES(
      '11111111-1111-4111-8111-111111111111',true,'openai_compatible',
      'synthetic-encrypted-credential','http://127.0.0.1:11434/v1','synthetic-routine','synthetic-strong'
    )`);
    const before=(await client.query(`SELECT household_id,enabled,provider,api_key_ciphertext,base_url,default_model,strong_model FROM ai_settings`)).rows[0];
    const migration=await fs.readFile(new URL('../migrations/010_ai_reasoning_effort.sql',import.meta.url),'utf8');
    await client.query(migration);
    const after=(await client.query(`SELECT household_id,enabled,provider,api_key_ciphertext,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort FROM ai_settings`)).rows[0];
    assert.deepEqual({
      household_id:after.household_id,enabled:after.enabled,provider:after.provider,
      api_key_ciphertext:after.api_key_ciphertext,base_url:after.base_url,
      default_model:after.default_model,strong_model:after.strong_model
    },before);
    assert.equal(after.default_reasoning_effort,'none');
    assert.equal(after.strong_reasoning_effort,'medium');
  }finally{
    await client.query('ROLLBACK');
    client.release();
  }
});

test('usage accounting keeps exact token categories, historical rates, owner isolation and zero calendar days',async()=>{
  const f=await fixture();const owner=(await pool.query<{id:string}>(`SELECT id FROM accounts WHERE email_normalized='ai-admin@test.invalid'`)).rows[0]!.id;const other=(await pool.query<{id:string}>(`SELECT id FROM accounts WHERE email_normalized='ai-member@test.invalid'`)).rows[0]!.id;const snapshot=(await pool.query<{id:string}>(`SELECT id FROM ai_rate_snapshots WHERE route='chatgpt_plan' AND model='gpt-6.1-sol' AND context_variant='standard'`)).rows[0]!.id;const apiSnapshot=(await pool.query<{id:string}>(`SELECT id FROM ai_rate_snapshots WHERE route='openai_api' AND model='gpt-6.1-sol' AND context_variant='standard' AND service_tier='standard'`)).rows[0]!.id;
  await pool.query(`INSERT INTO ai_usage_events(household_id,provider,model,requested_model,actual_model,operation,purpose,success,failure_code,owner_account_id,actual_dispatch,outcome,route,category,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,reasoning_tokens,rate_snapshot_id,api_equivalent_rate_snapshot_id,api_equivalent_assumption) VALUES
    ($1,'chatgpt_subscription','gpt-6.1-sol','configured-alias','gpt-6.1-sol','plan','normal_usage',true,NULL,$2,true,'completed','chatgpt_plan','normal',1000,100,50,200,150,$4,$5,'standard_tier_no_region_exact_model'),
    ($1,'chatgpt_subscription','configured-alias','configured-alias',NULL,'plan','unknown_usage',false,'AI_STREAM_INTERRUPTED',$2,true,'interrupted','chatgpt_plan','normal',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
    ($1,'chatgpt_subscription','gpt-6.1-sol','gpt-6.1-sol','gpt-6.1-sol','plan','foreign_usage',true,NULL,$3,true,'completed','chatgpt_plan','normal',999999,0,0,0,0,$4,NULL,NULL)`,[f.householdId,owner,other,snapshot,apiSnapshot]);
  const usage=await aiAdmin.usage(f.householdId,7,owner) as any;assert.equal(usage.byDay.length,7);assert.equal(usage.byDay.filter((day:any)=>day.calls===0).length,6);assert.equal(usage.summary.requests,2);assert.equal(usage.summary.unknownUsageCount,1);assert.equal(usage.summary.inputTokens,1000);assert.equal(usage.summary.outputTokens,200);assert.equal(usage.chatGptCredits.estimatedCredits,'0.09525000','reasoning tokens are already a subset of output and must not be charged twice');assert.equal(usage.apiEquivalent.amount,'0.00383500');assert.equal(usage.apiEquivalent.scenarioOnly,true);assert.equal(usage.chatGptCredits.pricePerCredit,null);assert.equal(usage.forecast.chatGptCredits.status,'preliminary');assert.equal(usage.recent.find((row:any)=>row.purpose==='normal_usage').actualModel,'gpt-6.1-sol');
  await pool.query(`INSERT INTO ai_rate_snapshots(route,model,context_variant,context_threshold_tokens,service_tier,unit,input_rate,cached_input_rate,cache_write_rate,output_rate,effective_from,observed_at,source_url) VALUES('openai_api','gpt-6.1-sol','standard',272000,'standard','USD_PER_MILLION_TOKENS',999,999,999,999,NULL,'2031-01-01T00:00:00Z','https://developers.openai.com/api/docs/pricing') ON CONFLICT DO NOTHING`);const unchanged=await aiAdmin.usage(f.householdId,7,owner) as any;assert.equal(unchanged.apiEquivalent.amount,'0.00383500','a later rate observation must not reprice historical attempts');await assert.rejects(()=>pool.query(`UPDATE ai_rate_snapshots SET input_rate=1 WHERE id=$1`,[apiSnapshot]),/append-only/);await aiAdmin.updateSettings(f.householdId,{enabled:true,provider:'openai',apiKey:'syntheticApiKeyOnlyForHistoricalRateTest',defaultModel:'gpt-6.1-sol',strongModel:'gpt-6.1-sol',expectedRevision:0});await aiAdmin.executeTask(f.householdId,{operation:'generate',purpose:'historical_snapshot_binding',input:'Synthetic',modelTier:'routine',sources:[]});const pinned=(await pool.query<{rate_snapshot_id:string|null}>(`SELECT rate_snapshot_id FROM ai_usage_events WHERE household_id=$1 AND purpose='historical_snapshot_binding'`,[f.householdId])).rows[0];assert.equal(pinned?.rate_snapshot_id,apiSnapshot,'an unknown-effective-date rate observed after the attempt cannot bind retroactively');
});

test('API-only forecast is independent and nullable cache categories never become invented zeroes',async()=>{const f=await fixture();const owner=(await pool.query<{id:string}>(`SELECT id FROM accounts WHERE email_normalized='ai-admin@test.invalid'`)).rows[0]!.id;const apiSnapshot=(await pool.query<{id:string}>(`SELECT id FROM ai_rate_snapshots WHERE route='openai_api' AND model='gpt-6.1-sol' AND context_variant='standard' AND service_tier='standard' ORDER BY observed_at LIMIT 1`)).rows[0]!.id;await pool.query(`INSERT INTO ai_settings(household_id,usage_tracking_started_at) VALUES($1,CURRENT_DATE-interval '10 days')`,[f.householdId]);await pool.query(`INSERT INTO ai_usage_events(household_id,provider,model,requested_model,actual_model,actual_service_tier,operation,purpose,success,owner_account_id,actual_dispatch,outcome,route,category,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,rate_snapshot_id,occurred_at) VALUES($1,'openai','alias','alias','gpt-6.1-sol','standard','generate','api_normal',true,$2,true,'completed','openai_api','normal',1000,100,50,200,$3,CURRENT_DATE-interval '2 days'),($1,'openai','alias','alias','gpt-6.1-sol','standard','generate','api_unknown_cache',true,$2,true,'completed','openai_api','normal',1000,NULL,50,200,$3,CURRENT_DATE-interval '2 days'),($1,'openai_compatible','local','local','local','local','generate','local_normal',true,$2,true,'completed','local','normal',1000,0,0,200,NULL,CURRENT_DATE-interval '2 days')`,[f.householdId,owner,apiSnapshot]);const usage=await aiAdmin.usage(f.householdId,30,owner) as any;assert.equal(usage.forecast.chatGptCredits.reason,'insufficient_history');assert.equal(usage.forecast.apiUsd.status,'preliminary');assert.equal(usage.forecast.apiUsd.reason,'unknown_pricing');assert.equal(usage.forecast.apiUsd.totalCalls,2,'local model calls must not enter the API scenario');assert.equal(usage.forecast.apiUsd.knownCalls,1);assert.equal(usage.apiEquivalent.unknownPricedAttempts,1);await pool.query(`UPDATE ai_usage_events SET cached_input_tokens=0 WHERE household_id=$1 AND purpose='api_unknown_cache'`,[f.householdId]);const complete=await aiAdmin.usage(f.householdId,30,owner) as any;assert.equal(complete.forecast.chatGptCredits.reason,'insufficient_history');assert.equal(complete.forecast.apiUsd.status,'available','an API-only household gets an independent forecast after every API event is priceable');assert.equal(complete.forecast.apiUsd.monthlyAmount,'0.03368571');await pool.query(`INSERT INTO ai_usage_events(household_id,provider,model,operation,purpose,success,owner_account_id,actual_dispatch,outcome,route,category,occurred_at) VALUES($1,'openai_compatible','local','generate','older_than_seven_days',true,$2,true,'completed','local','normal',CURRENT_DATE-interval '20 days')`,[f.householdId,owner]);assert.equal((await aiAdmin.usage(f.householdId,7,owner) as any).recent.some((event:any)=>event.purpose==='older_than_seven_days'),false);assert.equal((await aiAdmin.usage(f.householdId,30,owner) as any).recent.some((event:any)=>event.purpose==='older_than_seven_days'),true);});
