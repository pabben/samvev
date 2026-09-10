import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ZodError, type ZodType } from 'zod';
import {
  accountStatusUpdateSchema, claimSchema, displayUpdateSchema, householdSettingsUpdateSchema,
  invitationAcceptSchema, invitationReissueSchema, loginSchema, membershipUpdateSchema, messageCreateSchema,
  messageUpdateSchema, pairingApproveSchema, pairingRedeemSchema, pairingStartSchema,
  passwordChangeSchema, personAccountCreateSchema, personCreateSchema, personUpdateSchema, preferencesSchema, renderAckSchema, roleCapabilityPresets,
  aiConnectionTestSchema, aiSettingsUpdateSchema,
  monitorTaskCreateSchema, monitorTaskQualitySchema, monitorTaskRevisionSchema, monitorTaskUpdateSchema,
  type Capability, type ErrorCode
} from '@samvev/contracts';
import {
  DomainError, hashPassword, initialMessageState, numericCode, opaqueToken, requireCapability,
  tokenHash, validateIanaTimezone, verifyLoginPassword
} from '@samvev/core';
import { pool, transaction, type DbClient } from './db.ts';
import { ProjectionEventFanout } from './projection-events.ts';
import { AiAdminService } from './ai/admin-service.ts';
import type { AiHttpTransport } from './ai/openai-provider.ts';
import { loadRuntimeConfig, type RuntimeConfig } from './runtime-config.ts';
import { MonitorService } from './monitor/service.ts';
import { MonitorEngine } from './monitor/engine.ts';
import type { MonitorSourceFetcher } from './monitor/source-fetcher.ts';
import { ageOnDate, deriveAgeGroup, localDateInTimezone, nextBirthday } from './people/domain.ts';

const SESSION_COOKIE = 'samvev_session';
const DISPLAY_COOKIE = 'samvev_display';
const CSRF_COOKIE = 'samvev_csrf';
const SESSION_SECONDS = 12 * 60 * 60;
const DISPLAY_SECONDS = 90 * 24 * 60 * 60;
const elevatedCapabilities = new Set<Capability>(['installation.manage','household.manage','people.manage','account.manage','capability.manage','message.manage.household','display.manage']);

interface AuthContext {
  accountId: string;
  installationId: string;
  membershipId: string;
  householdId: string;
  personId: string;
  rolePreset: string;
  capabilities: Capability[];
}

interface DisplayContext { id: string; householdId: string; locale: 'en' | 'nb'; theme: 'light' | 'dark' | 'system'; privacyMode: boolean }

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new DomainError('VALIDATION_FAILED', 400, { fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) });
  return result.data;
}

function isUnsafe(method: string): boolean { return !['GET', 'HEAD', 'OPTIONS'].includes(method); }

async function durableRateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<void> {
  await pool.query(`DELETE FROM rate_limits WHERE window_started_at < clock_timestamp()-interval '1 hour'`);
  const keyHash = tokenHash(key);
  const result = await pool.query<{ attempts: number }>(`
    INSERT INTO rate_limits(bucket,key_hash,window_started_at,attempts) VALUES ($1,$2,clock_timestamp(),1)
    ON CONFLICT(bucket,key_hash) DO UPDATE SET
      attempts=CASE WHEN rate_limits.window_started_at < clock_timestamp()-($3 || ' seconds')::interval THEN 1 ELSE rate_limits.attempts+1 END,
      window_started_at=CASE WHEN rate_limits.window_started_at < clock_timestamp()-($3 || ' seconds')::interval THEN clock_timestamp() ELSE rate_limits.window_started_at END
    RETURNING attempts`, [bucket, keyHash, windowSeconds]);
  if ((result.rows[0]?.attempts ?? 0) > limit) throw new DomainError('RATE_LIMITED', 429);
}

function cookieOptions(maxAge: number, secure: boolean, path = '/'): Record<string, unknown> {
  return { httpOnly: true, sameSite: 'strict', secure, path, maxAge };
}

function setSessionCookies(reply: FastifyReply, session: {token:string;csrf:string}, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE,session.token,cookieOptions(SESSION_SECONDS,secure));
  reply.setCookie(CSRF_COOKIE,session.csrf,{sameSite:'strict',secure,path:'/',maxAge:SESSION_SECONDS});
}

async function createSession(client: pg.PoolClient, accountId: string): Promise<{ token: string; csrf: string }> {
  const token = opaqueToken();
  const csrf = opaqueToken();
  await client.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at)
    VALUES ($1,$2,$3,clock_timestamp()+interval '12 hours')`, [accountId, tokenHash(token), tokenHash(csrf)]);
  return { token, csrf };
}

async function sessionAccount(request: FastifyRequest): Promise<{ accountId: string; installationId: string; csrfHash: string; tokenHash: string }> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw new DomainError('UNAUTHENTICATED', 401);
  const hash = tokenHash(token);
  const result = await pool.query<{ account_id: string; installation_id: string; csrf_hash: string }>(`
    SELECT s.account_id,a.installation_id,s.csrf_hash FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.disabled_at IS NULL`, [hash]);
  const row = result.rows[0];
  if (!row) throw new DomainError('UNAUTHENTICATED', 401);
  if (isUnsafe(request.method)) {
    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || tokenHash(csrf) !== row.csrf_hash) throw new DomainError('CSRF_REQUIRED', 403);
  }
  await pool.query('UPDATE sessions SET last_seen_at=clock_timestamp() WHERE token_hash=$1', [hash]);
  return { accountId: row.account_id, installationId: row.installation_id, csrfHash: row.csrf_hash, tokenHash: hash };
}

async function authForHousehold(request: FastifyRequest, householdId: string): Promise<AuthContext> {
  const account = await sessionAccount(request);
  const result = await pool.query<{
    id: string; household_id: string; person_id: string; role_preset: string; capabilities: Capability[];
  }>(`SELECT id,household_id,person_id,role_preset,capabilities FROM memberships WHERE household_id=$1 AND account_id=$2`, [householdId, account.accountId]);
  const row = result.rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 404);
  return { accountId: account.accountId, installationId: account.installationId, membershipId: row.id, householdId: row.household_id, personId: row.person_id, rolePreset: row.role_preset, capabilities: row.capabilities };
}

async function displayAuth(request: FastifyRequest): Promise<DisplayContext> {
  const token = request.cookies[DISPLAY_COOKIE];
  if (!token) throw new DomainError('UNAUTHENTICATED', 401);
  const result = await pool.query<{ id: string; household_id: string; locale: 'en'|'nb'; theme: 'light'|'dark'|'system'; privacy_mode: boolean }>(`
    SELECT id,household_id,locale,theme,privacy_mode FROM displays
    WHERE credential_hash=$1 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp()`, [tokenHash(token)]);
  const row = result.rows[0];
  if (!row) throw new DomainError('UNAUTHENTICATED', 401);
  await pool.query('UPDATE displays SET last_seen_at=clock_timestamp() WHERE id=$1', [row.id]);
  return { id: row.id, householdId: row.household_id, locale: row.locale, theme: row.theme, privacyMode: row.privacy_mode };
}

function params(request: FastifyRequest): Record<string, string> { return request.params as Record<string, string>; }

async function validateAudience(client: DbClient, auth: AuthContext, personIds: string[], displayIds: string[], needsDisplayPublish = true): Promise<void> {
  if (personIds.length) {
    const found = await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])', [auth.householdId, personIds]);
    if (found.rowCount !== new Set(personIds).size) throw new DomainError('NOT_FOUND', 404);
  }
  if (displayIds.length) {
    if (needsDisplayPublish) requireCapability(auth.capabilities, 'message.publish.display');
    const found = await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL', [auth.householdId, displayIds]);
    if (found.rowCount !== new Set(displayIds).size) throw new DomainError('NOT_FOUND', 404);
    if (!auth.capabilities.includes('display.manage')) {
      const permitted = await client.query('SELECT display_id FROM membership_display_grants WHERE household_id=$1 AND membership_id=$2 AND display_id=ANY($3::uuid[])', [auth.householdId, auth.membershipId, displayIds]);
      if (permitted.rowCount !== new Set(displayIds).size) throw new DomainError('FORBIDDEN', 403);
    }
  }
}

async function audit(client: DbClient, auth: Pick<AuthContext,'installationId'|'householdId'|'accountId'>, action: string, subjectType: string, subjectId?: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
    VALUES ($1,$2,'account',$3,$4,$5,$6,$7)`, [auth.installationId, auth.householdId, auth.accountId, action, subjectType, subjectId ?? null, JSON.stringify(metadata)]);
}

async function projectionFor(display: DisplayContext): Promise<Record<string, unknown>> {
  const now = new Date();
  const hardCache = new Date(now.getTime() + 15 * 60_000);
  const label=await pool.query<{display_name:string;household_name:string;timezone:string}>(`SELECT d.name AS display_name,h.name AS household_name,h.timezone FROM displays d JOIN households h ON h.id=d.household_id WHERE d.id=$1 AND h.id=$2`,[display.id,display.householdId]);
  const cards = display.privacyMode ? [] : (await pool.query<{
    id:string; body:string; importance:string; publish_at:Date; expires_at:Date; revision:number; author_name:string
  }>(`SELECT m.id,m.body,m.importance,m.publish_at,m.expires_at,m.revision,p.display_name AS author_name
      FROM messages m JOIN message_display_targets t ON t.message_id=m.id AND t.household_id=m.household_id
      JOIN memberships ms ON ms.id=m.author_membership_id JOIN persons p ON p.id=ms.person_id
      WHERE t.display_id=$1 AND m.household_id=$2 AND m.state='published' AND t.delivery_state IN ('queued','delivered','displayed')
        AND m.publish_at<=clock_timestamp() AND m.expires_at>clock_timestamp()
      ORDER BY CASE m.importance WHEN 'attention' THEN 0 ELSE 1 END,m.publish_at,m.id`, [display.id, display.householdId])).rows.map((row) => ({
        id: row.id, kind: 'household_message', body: row.body, importance: row.importance,
        author: row.author_name, publishAt: row.publish_at.toISOString(), expiresAt: row.expires_at.toISOString(), revision: row.revision
      }));
  if(!display.privacyMode && cards.length){
    const cardIds=cards.map((card)=>(card as {id:string}).id);
    await pool.query(`UPDATE message_display_targets t SET delivery_state='delivered',delivered_revision=m.revision,delivered_at=clock_timestamp(),displayed_at=CASE WHEN t.delivered_revision IS DISTINCT FROM m.revision THEN NULL ELSE t.displayed_at END
      FROM messages m WHERE t.message_id=m.id AND t.display_id=$1 AND m.id=ANY($2::uuid[])
      AND m.state='published' AND m.publish_at<=clock_timestamp() AND m.expires_at>clock_timestamp()
      AND t.delivery_state IN ('queued','delivered','displayed')
      AND EXISTS(SELECT 1 FROM displays d WHERE d.id=t.display_id AND d.revoked_at IS NULL)
      AND (t.delivery_state='queued' OR t.delivered_revision IS DISTINCT FROM m.revision)`,[display.id,cardIds]);
  }
  return {
    display: { id: display.id, name: label.rows[0]?.display_name, householdName: label.rows[0]?.household_name, timezone: label.rows[0]?.timezone, locale: display.locale, theme: display.theme, privacyMode: display.privacyMode },
    cards, serverNow: now.toISOString(), generatedAt: now.toISOString(), cacheUntil: hardCache.toISOString(), maxStaleSeconds: 900
  };
}

export async function buildApp(options: { aiTransport?: AiHttpTransport; aiKeyFile?: string; monitorFetcher?: MonitorSourceFetcher; runtimeConfig?: RuntimeConfig; webRoot?: string } = {}): Promise<FastifyInstance> {
  const runtime = options.runtimeConfig ?? loadRuntimeConfig();
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: runtime.trustProxy, bodyLimit: 32 * 1024, requestTimeout: 15_000 });
  const aiAdmin = new AiAdminService({ transport: options.aiTransport, keyFile: options.aiKeyFile });
  const monitors = new MonitorService(aiAdmin);
  const monitorEngine = new MonitorEngine(options.monitorFetcher,aiAdmin);
  await app.register(cookie);
  const projectionEvents=new ProjectionEventFanout();
  await projectionEvents.start();
  app.decorate('projectionStreamStats',()=>projectionEvents.stats());
  app.addHook('preClose',async()=>projectionEvents.close());

  app.addHook('onRequest', async (request) => {
    if (!isUnsafe(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) {
      if (runtime.secureCookies) throw new DomainError('CSRF_REQUIRED', 403);
      return;
    }
    if (origin !== runtime.publicOrigin) throw new DomainError('CSRF_REQUIRED', 403);
  });

  app.setErrorHandler((error, request, reply) => {
    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let details: Record<string, unknown> | undefined;
    if (error instanceof DomainError) { status = error.status; code = error.code as ErrorCode; details = error.details; }
    else if (error instanceof ZodError) { status = 400; code = 'VALIDATION_FAILED'; }
    else if ((error as { code?: string }).code === '23505') { status = 409; code = 'CONFLICT'; }
    else if (Number((error as {statusCode?:number}).statusCode) >= 400 && Number((error as {statusCode?:number}).statusCode) < 500) { status = Number((error as {statusCode?:number}).statusCode); code = 'BAD_REQUEST'; }
    if (status === 500) request.log.error({ errorType: error instanceof Error ? error.name : 'unknown', requestId: request.id }, 'request_failed');
    void reply.status(status).send({ error: { code, requestId: request.id, ...(details ? { details } : {}) } });
  });

  app.get('/api/v1/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok', version: 1 };
  });

  app.get('/api/v1/setup/status', async () => {
    const result = await pool.query<{ claimed_at: Date|null; setup_step: string; default_locale: string; demo_mode:boolean }>('SELECT claimed_at,setup_step,default_locale,demo_mode FROM installations WHERE singleton=true');
    const row = result.rows[0];
    return { claimed: Boolean(row?.claimed_at), setupStep: row?.setup_step ?? 'welcome', locale: row?.default_locale ?? 'nb', demo: row?.demo_mode ?? false, demoAvailable: process.env.SAMVEV_DEMO_MODE === 'true' };
  });

  app.post('/api/v1/setup/begin', async (request) => {
    await durableRateLimit('setup_begin', request.ip, 10, 900);
    const token = opaqueToken();
    await transaction(async (client) => {
      const locked = await client.query<{ claimed_at: Date|null }>('SELECT claimed_at FROM installations WHERE singleton=true FOR UPDATE');
      if (locked.rows[0]?.claimed_at) throw new DomainError('INSTALLATION_CLAIMED', 409);
      if (!locked.rowCount) await client.query(`INSERT INTO installations(claim_token_hash,claim_expires_at) VALUES ($1,clock_timestamp()+interval '15 minutes')`, [tokenHash(token)]);
      else await client.query(`UPDATE installations SET claim_token_hash=$1,claim_expires_at=clock_timestamp()+interval '15 minutes' WHERE singleton=true`, [tokenHash(token)]);
    });
    return { claimToken: token, expiresInSeconds: 900 };
  });

  const executeClaim = async (body: ReturnType<typeof claimSchema.parse>, reply: FastifyReply, demo: boolean) => transaction(async (client) => {
    if (!validateIanaTimezone(body.household.timezone)) throw new DomainError('VALIDATION_FAILED', 400, { fields: [{ path: 'household.timezone', code: 'invalid_timezone' }] });
    const installation = await client.query<{ id:string;claimed_at:Date|null;claim_token_hash:string|null;claim_expires_at:Date|null }>('SELECT id,claimed_at,claim_token_hash,claim_expires_at FROM installations WHERE singleton=true FOR UPDATE');
    const current = installation.rows[0];
    if (!current || current.claimed_at) throw new DomainError('INSTALLATION_CLAIMED', 409);
    if (!demo && (current.claim_token_hash !== tokenHash(body.claimToken) || !current.claim_expires_at || current.claim_expires_at <= new Date())) throw new DomainError('CLAIM_EXPIRED', 410);
    const passwordHash = await hashPassword(body.owner.password);
    const household = await client.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [current.id,body.household.name,body.household.timezone,body.household.locale,demo?'demo':'live']);
    const householdId = household.rows[0]!.id;
    const person = await client.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES ($1,$2,'adult') RETURNING id`, [householdId,body.owner.displayName]);
    const account = await client.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [current.id,body.owner.email,passwordHash,body.preferences.locale,body.preferences.theme]);
    const membership = await client.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES ($1,$2,$3,'installation_admin',$4) RETURNING id`, [householdId,account.rows[0]!.id,person.rows[0]!.id,JSON.stringify(roleCapabilityPresets.installation_admin)]);
    await client.query(`UPDATE installations SET claimed_at=clock_timestamp(),claim_token_hash=NULL,claim_expires_at=NULL,default_locale=$2,setup_step='people',demo_mode=$3 WHERE id=$1`, [current.id,body.preferences.locale,demo]);
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES ($1,$2,'system',NULL,'installation.claimed','installation',$1,$3)`, [current.id,householdId,JSON.stringify({ demo })]);
    const session = await createSession(client, account.rows[0]!.id);
    setSessionCookies(reply,session,runtime.secureCookies);
    return { csrfToken: session.csrf, householdId, membershipId: membership.rows[0]!.id, setupStep: 'people' };
  });

  app.post('/api/v1/setup/claim', async (request, reply) => {
    await durableRateLimit('setup_claim', request.ip, 10, 900);
    return executeClaim(parse(claimSchema, request.body), reply, false);
  });

  app.post('/api/v1/setup/demo', async (request, reply) => {
    if (process.env.SAMVEV_DEMO_MODE !== 'true') throw new DomainError('NOT_FOUND', 404);
    await durableRateLimit('setup_demo', request.ip, 3, 3600);
    const body = parse(claimSchema, {
      claimToken: opaqueToken(), owner: { displayName: 'Avery', email: 'admin@demo.invalid', password: 'Synthetic-demo-pass-42' },
      household: { name: 'Demo household', timezone: 'Europe/Oslo', locale: 'en' }, preferences: { locale: 'en', theme: 'system' }
    });
    const installation = await pool.query('SELECT 1 FROM installations WHERE singleton=true');
    if (!installation.rowCount) await pool.query(`INSERT INTO installations(claim_token_hash,claim_expires_at) VALUES ($1,clock_timestamp()+interval '15 minutes')`, [tokenHash(body.claimToken)]);
    const result = await executeClaim(body, reply, true);
    await seedDemoHousehold((result as { householdId:string }).householdId);
    return { ...result, demo: true, credentials: { email: 'admin@demo.invalid', password: 'Synthetic-demo-pass-42' } };
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = parse(loginSchema, request.body);
    await durableRateLimit('login_ip',request.ip,30,900);
    await durableRateLimit('login', `${request.ip}:${body.email}`, 8, 900);
    const result = await pool.query<{id:string;password_hash:string;disabled_at:Date|null}>(`SELECT id,password_hash,disabled_at FROM accounts WHERE email_normalized=$1`, [body.email]);
    const account = result.rows[0];
    const verified=await verifyLoginPassword(body.password,account?.password_hash,Boolean(account && !account.disabled_at));
    if (!account || !verified) throw new DomainError('UNAUTHENTICATED', 401);
    const session = await transaction((client) => createSession(client, account.id));
    setSessionCookies(reply,session,runtime.secureCookies);
    return { csrfToken: session.csrf };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const session = await sessionAccount(request);
    await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1', [session.tokenHash]);
    reply.clearCookie(SESSION_COOKIE, { path: '/', sameSite: 'strict', secure: runtime.secureCookies });
    reply.clearCookie(CSRF_COOKIE, { path: '/', sameSite: 'strict', secure: runtime.secureCookies });
    return reply.status(204).send();
  });

  app.get('/api/v1/me', async (request) => {
    const session = await sessionAccount(request);
    const account = await pool.query(`SELECT id,email_normalized AS email,locale,theme FROM accounts WHERE id=$1`, [session.accountId]);
    const memberships = await pool.query(`SELECT m.id,m.household_id,m.person_id,m.role_preset,m.capabilities,m.revision,h.name AS household_name,h.timezone,h.default_locale AS household_locale,p.display_name,
      COALESCE((SELECT json_agg(display_id) FROM membership_display_grants g WHERE g.membership_id=m.id),'[]') AS display_ids
      FROM memberships m JOIN households h ON h.id=m.household_id JOIN persons p ON p.id=m.person_id WHERE m.account_id=$1 ORDER BY h.name`, [session.accountId]);
    return { account: account.rows[0], memberships: memberships.rows, csrfToken: request.cookies[CSRF_COOKIE] };
  });

  app.patch('/api/v1/me/preferences', async (request) => {
    const session = await sessionAccount(request);
    const body = parse(preferencesSchema, request.body);
    const result = await pool.query(`UPDATE accounts SET locale=COALESCE($2,locale),theme=COALESCE($3,theme) WHERE id=$1 RETURNING locale,theme`, [session.accountId,body.locale ?? null,body.theme ?? null]);
    return result.rows[0];
  });

  app.post('/api/v1/me/password', async (request) => {
    const session=await sessionAccount(request);
    const body=parse(passwordChangeSchema,request.body);
    await durableRateLimit('password_change',`${session.accountId}:${request.ip}`,10,900);
    const passwordHash=await hashPassword(body.newPassword);
    return transaction(async(client)=>{
      const account=(await client.query<{password_hash:string|null}>(`SELECT password_hash FROM accounts WHERE id=$1 FOR UPDATE`,[session.accountId])).rows[0];
      const verified=await verifyLoginPassword(body.currentPassword,account?.password_hash??undefined,Boolean(account?.password_hash));
      if(!verified)throw new DomainError('UNAUTHENTICATED',401);
      await client.query(`UPDATE accounts SET password_hash=$2,password_changed_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,[session.accountId,passwordHash]);
      const revoked=await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND token_hash<>$2 AND revoked_at IS NULL RETURNING id`,[session.accountId,session.tokenHash]);
      return {sessionsRevoked:revoked.rowCount??0};
    });
  });

  app.post('/api/v1/auth/invitations/accept',async(request,reply)=>{
    const body=parse(invitationAcceptSchema,request.body);
    await durableRateLimit('invitation_accept',request.ip,20,900);
    const hash=tokenHash(body.token);
    const passwordHash=await hashPassword(body.password);
    const result=await transaction(async(client)=>{
      const invitation=await client.query<{id:string;account_id:string;expires_at:Date;accepted_at:Date|null;revoked_at:Date|null;disabled_at:Date|null}>(`SELECT i.id,i.account_id,i.expires_at,i.accepted_at,i.revoked_at,a.disabled_at FROM account_invitations i JOIN accounts a ON a.id=i.account_id WHERE i.token_hash=$1 FOR UPDATE OF i,a`,[hash]);
      const row=invitation.rows[0];
      if(!row || row.accepted_at || row.revoked_at || row.disabled_at)throw new DomainError('INVITATION_INVALID',410);
      if(row.expires_at<=new Date())throw new DomainError('INVITATION_EXPIRED',410);
      await client.query(`UPDATE accounts SET password_hash=$2,password_changed_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,[row.account_id,passwordHash]);
      await client.query(`UPDATE account_invitations SET accepted_at=clock_timestamp() WHERE id=$1`,[row.id]);
      const session=await createSession(client,row.account_id);
      return {session};
    });
    setSessionCookies(reply,result.session,runtime.secureCookies);
    return {csrfToken:result.session.csrf};
  });

  app.get('/api/v1/setup/progress', async (request) => {
    await sessionAccount(request);
    const result = await pool.query('SELECT setup_step FROM installations WHERE singleton=true');
    return { setupStep: result.rows[0]?.setup_step ?? 'welcome' };
  });

  app.patch('/api/v1/setup/progress', async (request) => {
    const session = await sessionAccount(request);
    const step = (request.body as { setupStep?: unknown })?.setupStep;
    if (!['people','display','complete'].includes(String(step))) throw new DomainError('VALIDATION_FAILED', 400);
    const grants = await pool.query(`SELECT 1 FROM memberships WHERE account_id=$1 AND capabilities ? 'installation.manage'`, [session.accountId]);
    if (!grants.rowCount) throw new DomainError('FORBIDDEN', 403);
    await pool.query('UPDATE installations SET setup_step=$1 WHERE id=$2', [step,session.installationId]);
    return { setupStep: step };
  });

  app.get('/api/v1/households/:householdId/ai/settings', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    return aiAdmin.settings(auth.householdId);
  });

  app.patch('/api/v1/households/:householdId/ai/settings', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    const body = parse(aiSettingsUpdateSchema, request.body);
    const result = await aiAdmin.updateSettings(auth.householdId, body);
    await audit(pool, auth, 'ai.settings_changed', 'ai_settings', auth.householdId, {
      fields: Object.keys(body).filter((key) => !['apiKey','expectedRevision'].includes(key)),
      apiKeyAction: body.apiKey === undefined ? 'unchanged' : body.apiKey === null ? 'removed' : 'replaced'
    });
    return result;
  });

  app.post('/api/v1/households/:householdId/ai/test', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    const body = parse(aiConnectionTestSchema, request.body);
    await durableRateLimit('ai_connection_test', auth.householdId, 10, 3600);
    const result = await aiAdmin.testConnection(auth.householdId, body.modelTier);
    await audit(pool, auth, 'ai.connection_tested', 'ai_settings', auth.householdId, {
      provider: result.provider, modelTier: body.modelTier, available: result.available
    });
    return result;
  });

  app.get('/api/v1/households/:householdId/ai/usage', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    return aiAdmin.usage(auth.householdId);
  });

  app.get('/api/v1/households/:householdId/monitors', async (request) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    return {tasks:await monitors.list(auth)};
  });
  app.post('/api/v1/households/:householdId/monitors', async (request,reply) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const task=await monitors.create(auth,parse(monitorTaskCreateSchema,request.body));return reply.status(201).send(task);
  });
  app.patch('/api/v1/households/:householdId/monitors/:monitorId', async (request) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    return monitors.update(auth,params(request).monitorId!,parse(monitorTaskUpdateSchema,request.body));
  });
  app.post('/api/v1/households/:householdId/monitors/:monitorId/interpret', async (request) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    await durableRateLimit('monitor_interpret',auth.householdId,30,3600);
    const body=parse(monitorTaskRevisionSchema,request.body);return monitors.interpret(auth,params(request).monitorId!,body.expectedRevision);
  });
  for(const action of ['approve','pause','resume'] as const)app.post(`/api/v1/households/:householdId/monitors/:monitorId/${action}`,async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskRevisionSchema,request.body);return monitors.setState(auth,params(request).monitorId!,body.expectedRevision,action);
  });
  for(const action of ['test','run','smarter'] as const)app.post(`/api/v1/households/:householdId/monitors/:monitorId/${action}`,async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskRevisionSchema,request.body);await durableRateLimit('monitor_manual_run',auth.householdId,30,3600);
    return monitorEngine.runManual(auth,params(request).monitorId!,body.expectedRevision,action==='run'?'manual':action);
  });
  app.post('/api/v1/households/:householdId/monitors/:monitorId/quality',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskQualitySchema,request.body);return monitors.setQuality(auth,params(request).monitorId!,body.expectedRevision,body.quality);
  });
  app.delete('/api/v1/households/:householdId/monitors/:monitorId',async (request) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskRevisionSchema,request.body);await monitors.remove(auth,params(request).monitorId!,body.expectedRevision);return undefined;
  });

  app.get('/api/v1/households/:householdId/people', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.view');
    const canManagePeople=auth.capabilities.includes('people.manage');
    const canManageAccounts=auth.capabilities.includes('account.manage');
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;
    const today=localDateInTimezone(new Date(),household.timezone);
    const result = await pool.query(`SELECT p.id,p.display_name,p.age_group,p.revision AS person_revision,
      CASE WHEN $2 THEN p.birth_date::text ELSE NULL END AS birth_date,m.id AS membership_id,m.role_preset,
      CASE WHEN $2 THEN m.capabilities ELSE '[]'::jsonb END AS capabilities,m.revision,
      (m.account_id IS NOT NULL) AS has_login,(m.account_id IS NOT NULL AND a.password_hash IS NOT NULL AND a.disabled_at IS NULL) AS has_active_login,
      CASE WHEN m.account_id IS NULL THEN 'profile' WHEN a.disabled_at IS NOT NULL THEN 'disabled' WHEN a.password_hash IS NULL THEN 'pending' ELSE 'active' END AS account_status,
      CASE WHEN $3 THEN a.email_normalized ELSE NULL END AS email,
      CASE WHEN $3 THEN a.id ELSE NULL END AS account_id,
      CASE WHEN $3 THEN a.revision ELSE NULL END AS account_revision,
      CASE WHEN $2 THEN COALESCE((SELECT json_agg(display_id) FROM membership_display_grants g WHERE g.membership_id=m.id),'[]') ELSE '[]'::json END AS display_ids
      FROM persons p LEFT JOIN memberships m ON m.person_id=p.id AND m.household_id=p.household_id LEFT JOIN accounts a ON a.id=m.account_id
      WHERE p.household_id=$1 ORDER BY p.created_at`, [auth.householdId,canManagePeople,canManageAccounts]);
    return { people: result.rows.map((row)=>{
      const person=row as Record<string,unknown>;
      if(canManagePeople && typeof person.birth_date==='string')person.calculated_age=ageOnDate(person.birth_date,today);
      if(canManagePeople || canManageAccounts)return row;
      const visible={...row};
      delete visible.birth_date;
      delete visible.person_revision;
      delete visible.has_active_login;
      delete visible.account_status;
      return visible;
    }) };
  });

  app.post('/api/v1/households/:householdId/people', async (request, reply) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'people.manage');
    const body = parse(personCreateSchema, request.body);
    if(body.login)requireCapability(auth.capabilities,'account.manage');
    const desired=exactCapabilities(body.rolePreset,body.capabilities);
    if(requiresActiveLogin(body.rolePreset,desired) && !body.login)throw new DomainError('VALIDATION_FAILED',400,{reason:'elevated_login_required'});
    assertGrantAuthority(auth, body.rolePreset, desired);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;
    const ageGroup=body.ageGroup??deriveAgeGroup(body.birthDate,localDateInTimezone(new Date(),household.timezone));
    const invitationToken=body.login?.loginMethod==='invitation'?opaqueToken():null;
    const passwordHash=body.login?.loginMethod==='password'?await hashPassword(body.login.password!):null;
    const result = await transaction(async (client) => {
      await validateAudience(client, auth, [], body.displayIds, false);
      const person = await client.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES ($1,$2,$3,$4) RETURNING id`, [auth.householdId,body.displayName,ageGroup,body.birthDate??null]);
      let accountId: string|null = null;
      if (body.login) {
        accountId = (await client.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [auth.installationId,body.login.email,passwordHash,body.login.locale,body.login.theme])).rows[0]!.id;
      }
      const membership = await client.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [auth.householdId,accountId,person.rows[0]!.id,body.rolePreset,JSON.stringify(desired)]);
      if(accountId && invitationToken)await client.query(`INSERT INTO account_invitations(installation_id,household_id,account_id,token_hash,expires_at,created_by_account_id) VALUES($1,$2,$3,$4,clock_timestamp()+interval '7 days',$5)`,[auth.installationId,auth.householdId,accountId,tokenHash(invitationToken),auth.accountId]);
      for (const displayId of body.displayIds) await client.query('INSERT INTO membership_display_grants(household_id,membership_id,display_id) VALUES ($1,$2,$3)', [auth.householdId,membership.rows[0]!.id,displayId]);
      await audit(client,auth,'person.created','person',person.rows[0]!.id,{ rolePreset: body.rolePreset, hasLogin: Boolean(body.login) });
      return { personId: person.rows[0]!.id, membershipId: membership.rows[0]!.id, hasLogin: Boolean(body.login),invitationToken };
    });
    return reply.status(201).send(result);
  });

  app.patch('/api/v1/households/:householdId/people/:personId',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'people.manage');
    const body=parse(personUpdateSchema,request.body);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;
    return transaction(async(client)=>{
      const current=await client.query<{birth_date:string|null;age_group:'adult'|'teen'|'child'|'unspecified'}>(`SELECT birth_date::text,age_group FROM persons WHERE id=$1 AND household_id=$2 FOR UPDATE`,[params(request).personId,auth.householdId]);
      if(!current.rowCount)throw new DomainError('NOT_FOUND',404);
      const birthDate=body.birthDate===undefined?current.rows[0]!.birth_date:body.birthDate;
      const ageGroup=body.ageGroup??(body.birthDate===undefined?current.rows[0]!.age_group:deriveAgeGroup(birthDate,localDateInTimezone(new Date(),household.timezone)));
      const updated=await client.query(`UPDATE persons SET display_name=COALESCE($3,display_name),birth_date=$4,age_group=$5,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$6 RETURNING id,display_name,birth_date::text,age_group,revision`,[params(request).personId,auth.householdId,body.displayName??null,birthDate,ageGroup,body.expectedRevision]);
      if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      await audit(client,auth,'person.updated','person',params(request).personId,{fields:Object.keys(body).filter((key)=>key!=='expectedRevision')});
      return updated.rows[0];
    });
  });

  app.post('/api/v1/households/:householdId/memberships/:membershipId/account',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);
    requireCapability(auth.capabilities,'people.manage');requireCapability(auth.capabilities,'account.manage');requireCapability(auth.capabilities,'capability.manage');
    const body=parse(personAccountCreateSchema,request.body);
    const desired=exactCapabilities(body.rolePreset,body.capabilities);
    assertGrantAuthority(auth,body.rolePreset,desired);
    const invitationToken=body.login.loginMethod==='invitation'?opaqueToken():null;
    const passwordHash=body.login.loginMethod==='password'?await hashPassword(body.login.password!):null;
    const result=await transaction(async(client)=>{
      await client.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[auth.installationId]);
      await validateAudience(client,auth,[],body.displayIds,false);
      const target=await client.query<{id:string;account_id:string|null}>(`SELECT id,account_id FROM memberships WHERE id=$1 AND household_id=$2 FOR UPDATE`,[params(request).membershipId,auth.householdId]);
      if(!target.rowCount)throw new DomainError('NOT_FOUND',404);
      if(target.rows[0]!.account_id)throw new DomainError('CONFLICT',409,{reason:'account_already_exists'});
      const account=(await client.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,$2,$3,$4,$5) RETURNING id`,[auth.installationId,body.login.email,passwordHash,body.login.locale,body.login.theme])).rows[0]!;
      const updated=await client.query(`UPDATE memberships SET account_id=$3,role_preset=$4,capabilities=$5,revision=revision+1 WHERE id=$1 AND household_id=$2 AND revision=$6 RETURNING id,role_preset,capabilities,revision`,[params(request).membershipId,auth.householdId,account.id,body.rolePreset,JSON.stringify(desired),body.expectedRevision]);
      if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      if(invitationToken)await client.query(`INSERT INTO account_invitations(installation_id,household_id,account_id,token_hash,expires_at,created_by_account_id) VALUES($1,$2,$3,$4,clock_timestamp()+interval '7 days',$5)`,[auth.installationId,auth.householdId,account.id,tokenHash(invitationToken),auth.accountId]);
      await client.query('DELETE FROM membership_display_grants WHERE membership_id=$1',[params(request).membershipId]);
      for(const displayId of body.displayIds)await client.query('INSERT INTO membership_display_grants(household_id,membership_id,display_id) VALUES($1,$2,$3)',[auth.householdId,params(request).membershipId,displayId]);
      await audit(client,auth,'account.created','account',account.id,{membershipId:params(request).membershipId,rolePreset:body.rolePreset,loginMethod:body.login.loginMethod});
      return {accountId:account.id,membership:updated.rows[0],invitationToken};
    });
    return reply.status(201).send(result);
  });

  app.patch('/api/v1/households/:householdId/memberships/:membershipId', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'capability.manage');
    const body = parse(membershipUpdateSchema, request.body);
    const desired=exactCapabilities(body.rolePreset,body.capabilities);
    assertGrantAuthority(auth, body.rolePreset, desired);
    return transaction(async (client) => {
      await client.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[auth.installationId]);
      await validateAudience(client, auth, [], body.displayIds, false);
      const target = await client.query<{role_preset:string;capabilities:Capability[];account_id:string|null;disabled_at:Date|null;password_hash:string|null}>(`SELECT m.role_preset,m.capabilities,m.account_id,a.disabled_at,a.password_hash FROM memberships m LEFT JOIN accounts a ON a.id=m.account_id WHERE m.id=$1 AND m.household_id=$2 FOR UPDATE OF m`, [params(request).membershipId,auth.householdId]);
      if (!target.rowCount) throw new DomainError('NOT_FOUND', 404);
      if(body.rolePreset==='installation_admin' && target.rows[0]!.role_preset!=='installation_admin' && body.confirmInstallationOwner!==true)throw new DomainError('VALIDATION_FAILED',400,{reason:'installation_owner_confirmation_required'});
      if(requiresActiveLogin(body.rolePreset,desired) && (!target.rows[0]!.account_id || target.rows[0]!.disabled_at || !target.rows[0]!.password_hash))throw new DomainError('VALIDATION_FAILED',400,{reason:'elevated_login_required'});
      if (target.rows[0]!.role_preset === 'installation_admin' && !auth.capabilities.includes('installation.manage')) throw new DomainError('FORBIDDEN',403);
      const targetWasUsableOwner=target.rows[0]!.account_id && target.rows[0]!.password_hash && !target.rows[0]!.disabled_at && hasCapabilities(target.rows[0]!.capabilities,['installation.manage','capability.manage']);
      if (targetWasUsableOwner && !hasCapabilities(desired,['installation.manage','capability.manage'])) {
        const owners = await client.query(`SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE a.installation_id=$2 AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL AND m.capabilities ?& ARRAY['installation.manage','capability.manage'] AND m.id<>$1 LIMIT 1`, [params(request).membershipId,auth.installationId]);
        if (!owners.rowCount) throw new DomainError('CONFLICT', 409, { reason: 'last_installation_owner' });
      }
      const targetWasUsableManager=target.rows[0]!.account_id && target.rows[0]!.password_hash && !target.rows[0]!.disabled_at && hasCapabilities(target.rows[0]!.capabilities,['household.manage','capability.manage']);
      if (targetWasUsableManager && !hasCapabilities(desired,['household.manage','capability.manage'])) {
        const managers=await client.query(`SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.household_id=$1 AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL AND m.capabilities ?& ARRAY['household.manage','capability.manage'] AND m.id<>$2 LIMIT 1`,[auth.householdId,params(request).membershipId]);
        if(!managers.rowCount) throw new DomainError('CONFLICT',409,{reason:'last_household_manager'});
      }
      const updated = await client.query(`UPDATE memberships SET role_preset=$3,capabilities=$4,revision=revision+1 WHERE id=$1 AND household_id=$2 AND revision=$5 RETURNING id,role_preset,capabilities,revision`, [params(request).membershipId,auth.householdId,body.rolePreset,JSON.stringify(desired),body.expectedRevision]);
      if (!updated.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
      await client.query('DELETE FROM membership_display_grants WHERE membership_id=$1', [params(request).membershipId]);
      for (const displayId of body.displayIds) await client.query('INSERT INTO membership_display_grants(household_id,membership_id,display_id) VALUES ($1,$2,$3)', [auth.householdId,params(request).membershipId,displayId]);
      await audit(client,auth,'membership.permissions_changed','membership',params(request).membershipId,{ rolePreset: body.rolePreset, capabilities: desired, displayIds: body.displayIds });
      return updated.rows[0];
    });
  });

  app.patch('/api/v1/households/:householdId/accounts/:accountId',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'account.manage');
    const body=parse(accountStatusUpdateSchema,request.body);
    return transaction(async(client)=>{
      await client.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[auth.installationId]);
      const target=await client.query<{id:string;disabled_at:Date|null;password_hash:string|null;revision:number;is_owner:boolean;is_manager_here:boolean;has_other_household:boolean}>(`SELECT a.id,a.disabled_at,a.password_hash,a.revision,EXISTS(SELECT 1 FROM memberships owner_m WHERE owner_m.account_id=a.id AND owner_m.capabilities ?& ARRAY['installation.manage','capability.manage']) AS is_owner,EXISTS(SELECT 1 FROM memberships manager_m WHERE manager_m.account_id=a.id AND manager_m.household_id=$3 AND manager_m.capabilities ?& ARRAY['household.manage','capability.manage']) AS is_manager_here,EXISTS(SELECT 1 FROM memberships other_m WHERE other_m.account_id=a.id AND other_m.household_id<>$3) AS has_other_household FROM accounts a WHERE a.id=$1 AND a.installation_id=$2 AND EXISTS(SELECT 1 FROM memberships visible_m WHERE visible_m.account_id=a.id AND visible_m.household_id=$3) FOR UPDATE OF a`,[params(request).accountId,auth.installationId,auth.householdId]);
      const row=target.rows[0];if(!row)throw new DomainError('NOT_FOUND',404);
      if((row.is_owner || row.has_other_household) && !auth.capabilities.includes('installation.manage'))throw new DomainError('FORBIDDEN',403);
      if(body.disabled && row.is_owner && !row.disabled_at){
        const owner=await client.query(`SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE a.installation_id=$1 AND a.id<>$2 AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL AND m.capabilities ?& ARRAY['installation.manage','capability.manage'] LIMIT 1`,[auth.installationId,row.id]);
        if(!owner.rowCount)throw new DomainError('CONFLICT',409,{reason:'last_installation_owner'});
      }
      if(body.disabled && row.is_manager_here && row.password_hash && !row.disabled_at){
        const manager=await client.query(`SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.household_id=$1 AND a.id<>$2 AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL AND m.capabilities ?& ARRAY['household.manage','capability.manage'] LIMIT 1`,[auth.householdId,row.id]);
        if(!manager.rowCount)throw new DomainError('CONFLICT',409,{reason:'last_household_manager'});
      }
      const updated=await client.query(`UPDATE accounts SET disabled_at=CASE WHEN $3 THEN COALESCE(disabled_at,clock_timestamp()) ELSE NULL END,revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING id,disabled_at,revision`,[row.id,body.expectedRevision,body.disabled]);
      if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      if(body.disabled)await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND revoked_at IS NULL`,[row.id]);
      await audit(client,auth,body.disabled?'account.disabled':'account.enabled','account',row.id);
      return updated.rows[0];
    });
  });

  app.post('/api/v1/households/:householdId/accounts/:accountId/invitation',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'account.manage');
    const body=parse(invitationReissueSchema,request.body);const token=opaqueToken();
    const result=await transaction(async(client)=>{
      await client.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[auth.installationId]);
      const account=await client.query<{id:string;revision:number;password_hash:string|null;disabled_at:Date|null;is_owner:boolean;has_other_household:boolean}>(`SELECT a.id,a.revision,a.password_hash,a.disabled_at,EXISTS(SELECT 1 FROM memberships owner_m WHERE owner_m.account_id=a.id AND owner_m.capabilities ? 'installation.manage') AS is_owner,EXISTS(SELECT 1 FROM memberships other_m WHERE other_m.account_id=a.id AND other_m.household_id<>$3) AS has_other_household FROM accounts a WHERE a.id=$1 AND a.installation_id=$2 AND EXISTS(SELECT 1 FROM memberships visible_m WHERE visible_m.account_id=a.id AND visible_m.household_id=$3) FOR UPDATE OF a`,[params(request).accountId,auth.installationId,auth.householdId]);
      const row=account.rows[0];if(!row)throw new DomainError('NOT_FOUND',404);
      if((row.is_owner||row.has_other_household)&&!auth.capabilities.includes('installation.manage'))throw new DomainError('FORBIDDEN',403);
      if(row.disabled_at||row.password_hash)throw new DomainError('CONFLICT',409,{reason:'account_not_pending'});
      const updated=await client.query(`UPDATE accounts SET revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING revision`,[row.id,body.expectedRevision]);
      if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      await client.query(`UPDATE account_invitations SET revoked_at=clock_timestamp() WHERE account_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL`,[row.id]);
      await client.query(`INSERT INTO account_invitations(installation_id,household_id,account_id,token_hash,expires_at,created_by_account_id) VALUES($1,$2,$3,$4,clock_timestamp()+interval '7 days',$5)`,[auth.installationId,auth.householdId,row.id,tokenHash(token),auth.accountId]);
      await audit(client,auth,'invitation.reissued','account',row.id);
      return {invitationToken:token,accountRevision:updated.rows[0].revision};
    });
    return reply.status(201).send(result);
  });

  app.get('/api/v1/households/:householdId/dashboard',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');
    const household=(await pool.query<{timezone:string;show_upcoming_birthday:boolean}>(`SELECT timezone,show_upcoming_birthday FROM households WHERE id=$1`,[auth.householdId])).rows[0]!;
    if(!household.show_upcoming_birthday)return {upcomingBirthday:null};
    const people=await pool.query<{id:string;display_name:string;birth_date:string}>(`SELECT id,display_name,birth_date::text FROM persons WHERE household_id=$1 AND birth_date IS NOT NULL`,[auth.householdId]);
    return {upcomingBirthday:nextBirthday(people.rows.map((row)=>({id:row.id,displayName:row.display_name,birthDate:row.birth_date})),localDateInTimezone(new Date(),household.timezone))};
  });

  app.get('/api/v1/households/:householdId/settings',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');
    const settings=await pool.query(`SELECT show_upcoming_birthday,revision FROM households WHERE id=$1`,[auth.householdId]);
    return settings.rows[0];
  });

  app.patch('/api/v1/households/:householdId/settings',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(householdSettingsUpdateSchema,request.body);
    const updated=await pool.query(`UPDATE households SET show_upcoming_birthday=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING show_upcoming_birthday,revision`,[auth.householdId,body.showUpcomingBirthday,body.expectedRevision]);
    if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
    await transaction((client)=>audit(client,auth,'household.birthday_setting_changed','household',auth.householdId,{enabled:body.showUpcomingBirthday}));
    return updated.rows[0];
  });

  app.get('/api/v1/households/:householdId/displays', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.view');
    const result = await pool.query(`SELECT id,name,locale,theme,privacy_mode,revoked_at,last_seen_at,created_at FROM displays WHERE household_id=$1 ORDER BY created_at`, [auth.householdId]);
    return { displays: result.rows };
  });

  app.patch('/api/v1/households/:householdId/displays/:displayId', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'display.manage');
    const body = parse(displayUpdateSchema, request.body);
    return transaction(async(client)=>{
      const result = await client.query(`UPDATE displays SET locale=COALESCE($3,locale),theme=COALESCE($4,theme),privacy_mode=COALESCE($5,privacy_mode),revoked_at=CASE WHEN $6::boolean IS TRUE THEN clock_timestamp() ELSE revoked_at END,credential_hash=CASE WHEN $6::boolean IS TRUE THEN NULL ELSE credential_hash END
        WHERE id=$1 AND household_id=$2 RETURNING id,name,locale,theme,privacy_mode,revoked_at`, [params(request).displayId,auth.householdId,body.locale ?? null,body.theme ?? null,body.privacyMode ?? null,body.revoked ?? null]);
      if (!result.rowCount) throw new DomainError('NOT_FOUND', 404);
      if(body.revoked) await client.query(`UPDATE message_display_targets SET delivery_state='failed',failure_code='DISPLAY_REVOKED' WHERE display_id=$1 AND delivery_state='queued'`,[params(request).displayId]);
      await audit(client,auth,body.revoked === true?'display.revoked':'display.updated','display',params(request).displayId,{ privacyMode: body.privacyMode });
      return result.rows[0];
    });
  });

  app.post('/api/v1/display/pairing/start', async (request, reply) => {
    const body = parse(pairingStartSchema, request.body);
    await durableRateLimit('pairing_start', request.ip, 10, 900);
    for (let attempt=0;attempt<5;attempt++) {
      const code = numericCode();
      try {
        const result = await pool.query<{id:string;expires_at:Date}>(`INSERT INTO pairing_requests(code_hash,verifier_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '5 minutes') RETURNING id,expires_at`, [tokenHash(code),body.verifierHash]);
        return reply.status(201).send({ pairingId: result.rows[0]!.id, code, expiresAt: result.rows[0]!.expires_at.toISOString() });
      } catch (error) { if ((error as {code?:string}).code !== '23505') throw error; }
    }
    throw new DomainError('CONFLICT', 409);
  });

  app.get('/api/v1/display/pairing/:pairingId/status', async (request) => {
    const result = await pool.query<{approved_at:Date|null;expires_at:Date;redeemed_at:Date|null}>(`SELECT approved_at,expires_at,redeemed_at FROM pairing_requests WHERE id=$1`, [params(request).pairingId]);
    const row = result.rows[0];
    if (!row) throw new DomainError('NOT_FOUND', 404);
    return { approved: Boolean(row.approved_at), redeemed: Boolean(row.redeemed_at), expired: row.expires_at <= new Date(), expiresAt: row.expires_at.toISOString() };
  });

  app.post('/api/v1/households/:householdId/displays/pairing/approve', async (request, reply) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'display.manage');
    const body = parse(pairingApproveSchema, request.body);
    await durableRateLimit('pairing_approve_ip',request.ip,20,900);
    await durableRateLimit('pairing_approve',`${request.ip}:${body.code}`,10,900);
    const result = await transaction(async (client) => {
      const pairing = await client.query<{id:string}>(`SELECT id FROM pairing_requests WHERE code_hash=$1 AND expires_at>clock_timestamp() AND approved_at IS NULL AND redeemed_at IS NULL FOR UPDATE`, [tokenHash(body.code)]);
      if (!pairing.rowCount) throw new DomainError('PAIRING_INVALID', 404);
      const display = await client.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,privacy_mode,allowed_content) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [auth.householdId,body.name,body.locale,body.theme,body.privacyMode,body.allowedContent]);
      const approved = await client.query(`UPDATE pairing_requests SET approved_at=clock_timestamp(),display_id=$2 WHERE id=$1 AND approved_at IS NULL RETURNING id`, [pairing.rows[0]!.id,display.rows[0]!.id]);
      if (!approved.rowCount) throw new DomainError('CONFLICT', 409);
      await audit(client,auth,'display.pairing_approved','display',display.rows[0]!.id);
      return { displayId: display.rows[0]!.id };
    });
    return reply.status(201).send(result);
  });

  app.post('/api/v1/display/pairing/redeem', async (request, reply) => {
    const body = parse(pairingRedeemSchema, request.body);
    await durableRateLimit('pairing_redeem', request.ip, 20, 900);
    const credential = opaqueToken();
    const result = await transaction(async (client) => {
      const pairing = await client.query<{id:string;display_id:string|null;verifier_hash:string}>(`SELECT id,display_id,verifier_hash FROM pairing_requests WHERE id=$1 AND expires_at>clock_timestamp() AND approved_at IS NOT NULL AND redeemed_at IS NULL FOR UPDATE`, [body.pairingId]);
      const row = pairing.rows[0];
      if (!row || tokenHash(body.verifier) !== row.verifier_hash || !row.display_id) throw new DomainError('PAIRING_EXPIRED', 410);
      const claimed = await client.query(`UPDATE pairing_requests SET redeemed_at=clock_timestamp() WHERE id=$1 AND redeemed_at IS NULL RETURNING id`, [row.id]);
      if (!claimed.rowCount) throw new DomainError('PAIRING_EXPIRED', 410);
      const display = await client.query(`UPDATE displays SET credential_hash=$2,credential_expires_at=clock_timestamp()+interval '90 days' WHERE id=$1 AND revoked_at IS NULL RETURNING id,name,locale,theme,privacy_mode`, [row.display_id,tokenHash(credential)]);
      if (!display.rowCount) throw new DomainError('PAIRING_EXPIRED', 410);
      return display.rows[0];
    });
    reply.setCookie(DISPLAY_COOKIE,credential,cookieOptions(DISPLAY_SECONDS,runtime.secureCookies,'/api/v1/display'));
    return result;
  });

  app.get('/api/v1/households/:householdId/messages', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.view');
    const all = auth.capabilities.includes('message.manage.household');
    const result = await pool.query(`SELECT m.id,m.body,m.importance,m.audience_household,m.publish_at,m.expires_at,m.state,m.revision,m.created_at,m.updated_at,
      p.display_name AS author_name,p.id AS author_person_id,(m.author_membership_id=$3 OR $2) AS can_edit,
      COALESCE((SELECT json_agg(person_id) FROM message_person_audiences WHERE message_id=m.id),'[]') AS person_ids,
      COALESCE((SELECT json_agg(display_id) FROM message_display_targets WHERE message_id=m.id AND delivery_state<>'cancelled'),'[]') AS display_ids,
      COALESCE((SELECT json_agg(json_build_object('displayId',display_id,'state',delivery_state,'deliveredAt',delivered_at,'displayedAt',displayed_at,'revision',delivered_revision)) FROM message_display_targets WHERE message_id=m.id),'[]') AS deliveries,
      COALESCE((SELECT json_agg(json_build_object('action',CASE WHEN e.from_state=e.to_state THEN 'edited' ELSE 'withdrawn' END,'actorName',ep.display_name,'occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id)
        FROM message_lifecycle_events e JOIN memberships em ON em.account_id=e.actor_id AND em.household_id=m.household_id JOIN persons ep ON ep.id=em.person_id AND ep.household_id=em.household_id
        WHERE e.message_id=m.id AND e.actor_type='account' AND (e.from_state=e.to_state OR e.to_state IN ('cancelled','withdrawn'))),'[]') AS activity
      FROM messages m JOIN memberships am ON am.id=m.author_membership_id JOIN persons p ON p.id=am.person_id
      WHERE m.household_id=$1 AND ($2 OR m.author_membership_id=$3 OR m.audience_household OR EXISTS(SELECT 1 FROM message_person_audiences pa WHERE pa.message_id=m.id AND pa.person_id=$4))
      ORDER BY m.created_at DESC LIMIT 200`, [auth.householdId,all,auth.membershipId,auth.personId]);
    return { messages: result.rows };
  });

  app.post('/api/v1/households/:householdId/messages', async (request, reply) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'message.create.household');
    const body = parse(messageCreateSchema, request.body);
    const now = new Date();
    const publishAt = body.publishAt ? new Date(body.publishAt) : now;
    const expiresAt = new Date(body.expiresAt);
    const state = initialMessageState(publishAt,expiresAt,now);
    if (publishAt > now) requireCapability(auth.capabilities,'message.schedule');
    const message = await transaction(async (client) => {
      await validateAudience(client,auth,body.audience.personIds,body.audience.displayIds);
      const requestHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const existing = await client.query<{request_hash:string|null} & Record<string,unknown>>(`SELECT id,body,importance,audience_household,publish_at,expires_at,state,revision,request_hash FROM messages WHERE author_membership_id=$1 AND idempotency_key=$2`, [auth.membershipId,body.idempotencyKey]);
      if (existing.rowCount) {
        if(existing.rows[0]!.request_hash!==requestHash) throw new DomainError('CONFLICT',409,{reason:'idempotency_payload_mismatch'});
        const {request_hash: _requestHash,...response}=existing.rows[0]!;
        return response;
      }
      const inserted = await client.query<{id:string;revision:number}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8='published' THEN clock_timestamp() END) RETURNING id,revision`, [auth.householdId,auth.membershipId,body.body,body.importance,body.audience.household,publishAt,expiresAt,state,body.idempotencyKey]);
      const id = inserted.rows[0]!.id;
      await client.query('UPDATE messages SET request_hash=$2 WHERE id=$1',[id,requestHash]);
      for (const personId of body.audience.personIds) await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES ($1,$2,$3)', [auth.householdId,id,personId]);
      for (const displayId of body.audience.displayIds) await client.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES ($1,$2,$3,'queued')`, [auth.householdId,id,displayId]);
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key) VALUES ($1,NULL,$2,1,'account',$3,$4)`, [id,state,auth.accountId,`create:${id}`]);
      return (await client.query(`SELECT id,body,importance,audience_household,publish_at,expires_at,state,revision FROM messages WHERE id=$1`, [id])).rows[0];
    });
    return reply.status(201).send(message);
  });

  app.patch('/api/v1/households/:householdId/messages/:messageId', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    const body = parse(messageUpdateSchema, request.body);
    return transaction(async (client) => {
      const existing = await client.query<{author_membership_id:string;state:string;publish_at:Date;expires_at:Date}>(`SELECT author_membership_id,state,publish_at,expires_at FROM messages WHERE id=$1 AND household_id=$2 FOR UPDATE`, [params(request).messageId,auth.householdId]);
      const current = existing.rows[0];
      if (!current) throw new DomainError('NOT_FOUND',404);
      if (current.author_membership_id !== auth.membershipId) requireCapability(auth.capabilities,'message.manage.household');
      if (!['scheduled','published'].includes(current.state)) throw new DomainError('CONFLICT',409,{reason:'message_not_editable'});
      const audience = body.audience;
      if (audience) {
        if (!(audience.household || audience.personIds.length || audience.displayIds.length)) throw new DomainError('VALIDATION_FAILED',400,{fields:[{path:'audience',code:'audience_required'}]});
        await validateAudience(client,auth,audience.personIds,audience.displayIds);
      } else {
        const currentDisplays=(await client.query<{display_id:string}>(`SELECT t.display_id FROM message_display_targets t JOIN displays d ON d.id=t.display_id AND d.household_id=t.household_id WHERE t.message_id=$1 AND t.delivery_state IN ('queued','delivered','displayed') AND d.revoked_at IS NULL`,[params(request).messageId])).rows.map((row)=>row.display_id);
        await validateAudience(client,auth,[],currentDisplays);
      }
      const publishAt = body.publishAt ? new Date(body.publishAt) : current.publish_at;
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : current.expires_at;
      if (expiresAt <= publishAt || expiresAt <= new Date()) throw new DomainError('SCHEDULE_INVALID',422);
      if (publishAt > new Date()) requireCapability(auth.capabilities,'message.schedule');
      if (current.state === 'published' && publishAt > new Date()) throw new DomainError('CONFLICT',409,{reason:'published_cannot_reschedule'});
      const updated = await client.query(`UPDATE messages SET body=COALESCE($3,body),importance=COALESCE($4,importance),audience_household=COALESCE($5,audience_household),publish_at=$6,expires_at=$7,revision=revision+1,updated_at=clock_timestamp()
        WHERE id=$1 AND household_id=$2 AND revision=$8 RETURNING id,body,importance,audience_household,publish_at,expires_at,state,revision`, [params(request).messageId,auth.householdId,body.body ?? null,body.importance ?? null,audience?.household ?? null,publishAt,expiresAt,body.expectedRevision]);
      if (!updated.rowCount) throw new DomainError('REVISION_CONFLICT',409);
      if (audience) {
        await client.query('DELETE FROM message_person_audiences WHERE message_id=$1',[params(request).messageId]);
        for (const personId of audience.personIds) await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES ($1,$2,$3)',[auth.householdId,params(request).messageId,personId]);
        await client.query(`UPDATE message_display_targets SET delivery_state='cancelled' WHERE message_id=$1 AND NOT (display_id=ANY($2::uuid[]))`,[params(request).messageId,audience.displayIds]);
        for (const displayId of audience.displayIds) await client.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES ($1,$2,$3,'queued') ON CONFLICT(message_id,display_id) DO UPDATE SET delivery_state='queued',delivered_revision=NULL,delivered_at=NULL,displayed_at=NULL,failure_code=NULL`,[auth.householdId,params(request).messageId,displayId]);
      } else if (current.state === 'published') await client.query(`UPDATE message_display_targets t SET delivery_state='queued',delivered_revision=NULL,delivered_at=NULL,displayed_at=NULL,failure_code=NULL FROM displays d WHERE t.message_id=$1 AND d.id=t.display_id AND d.household_id=t.household_id AND d.revoked_at IS NULL AND t.delivery_state IN ('queued','delivered','displayed')`,[params(request).messageId]);
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key) VALUES ($1,$2,$2,$3,'account',$4,$5)`,[params(request).messageId,current.state,(updated.rows[0] as {revision:number}).revision,auth.accountId,`edit:${params(request).messageId}:${body.expectedRevision}`]);
      if (current.author_membership_id !== auth.membershipId) await audit(client,auth,'message.edited_by_admin','message',params(request).messageId);
      return updated.rows[0];
    });
  });

  app.post('/api/v1/households/:householdId/messages/:messageId/withdraw', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    const expectedRevision = Number((request.body as {expectedRevision?:unknown})?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new DomainError('VALIDATION_FAILED',400);
    return transaction(async (client) => {
      const existing = await client.query<{author_membership_id:string;state:string}>(`SELECT author_membership_id,state FROM messages WHERE id=$1 AND household_id=$2 FOR UPDATE`,[params(request).messageId,auth.householdId]);
      const current=existing.rows[0];
      if(!current) throw new DomainError('NOT_FOUND',404);
      if(current.author_membership_id!==auth.membershipId) requireCapability(auth.capabilities,'message.manage.household');
      if(!['scheduled','published'].includes(current.state)) throw new DomainError('CONFLICT',409);
      const next=current.state==='scheduled'?'cancelled':'withdrawn';
      const updated=await client.query(`UPDATE messages SET state=$3,revision=revision+1,ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$4 RETURNING id,state,revision`,[params(request).messageId,auth.householdId,next,expectedRevision]);
      if(!updated.rowCount) throw new DomainError('REVISION_CONFLICT',409);
      await client.query(`UPDATE message_display_targets SET delivery_state='cancelled' WHERE message_id=$1`,[params(request).messageId]);
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key) VALUES ($1,$2,$3,$4,'account',$5,$6)`,[params(request).messageId,current.state,next,(updated.rows[0] as {revision:number}).revision,auth.accountId,`withdraw:${params(request).messageId}:${expectedRevision}`]);
      if(current.author_membership_id!==auth.membershipId)await audit(client,auth,'message.withdrawn_by_admin','message',params(request).messageId,{state:next});
      return updated.rows[0];
    });
  });

  app.get('/api/v1/display/projection', async (request, reply) => {
    const display = await displayAuth(request);
    reply.header('Cache-Control','private, max-age=0, must-revalidate');
    return projectionFor(display);
  });

  app.post('/api/v1/display/render-ack', async (request, reply) => {
    const display=await displayAuth(request);
    if(display.privacyMode) throw new DomainError('FORBIDDEN',403);
    await durableRateLimit('display_render_ack',display.id,180,60);
    const body=parse(renderAckSchema,request.body);
    const renderedAt=new Date(body.renderedAt);
    if(renderedAt>new Date(Date.now()+5*60_000)) throw new DomainError('VALIDATION_FAILED',400);
    await transaction(async(client)=>{
      const valid=await client.query(`SELECT m.id FROM message_display_targets t
        JOIN displays d ON d.id=t.display_id AND d.household_id=t.household_id
        JOIN messages m ON m.id=t.message_id AND m.household_id=t.household_id
        WHERE t.message_id=$1 AND t.display_id=$2 AND t.household_id=$3
          AND d.revoked_at IS NULL AND d.privacy_mode=false
          AND m.revision=$4 AND m.state='published' AND m.publish_at<=clock_timestamp() AND m.expires_at>clock_timestamp()
          AND t.delivery_state IN ('delivered','displayed') AND t.delivered_revision=$4
        FOR UPDATE OF t,d,m`,[body.cardId,display.id,display.householdId,body.revision]);
      if(!valid.rowCount) throw new DomainError('NOT_FOUND',404);
      const inserted=await client.query(`INSERT INTO display_render_acks(display_id,message_id,revision,rendered_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,[display.id,body.cardId,body.revision,renderedAt]);
      if(inserted.rowCount) await client.query(`UPDATE message_display_targets SET delivery_state='displayed',displayed_at=clock_timestamp() WHERE display_id=$1 AND message_id=$2 AND delivered_revision=$3 AND delivery_state='delivered'`,[display.id,body.cardId,body.revision]);
    });
    return reply.status(204).send();
  });

  app.get('/api/v1/display/events', async (request, reply) => {
    const display=await displayAuth(request);
    let responseClosed=false;
    let authorizationCheckUnavailable=false;
    const send=(event:{type:string;data:Record<string,unknown>})=>{
      if(!responseClosed)reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const unsubscribe=projectionEvents.subscribe(display.id,display.householdId,send,()=>reply.raw.end());
    reply.hijack();
    const response=reply.raw;
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const initiallyConnected=projectionEvents.listenerConnected();
    send({type:'ready',data:{generatedAt:new Date().toISOString(),listenerConnected:initiallyConnected,pollingFallback:!initiallyConnected}});
    if(!initiallyConnected)send({type:'listener-degraded',data:{pollingFallback:true,listenerConnected:false,reason:'notification-listener-unavailable'}});
    const revalidateMs=Math.max(50,Number(process.env.SAMVEV_SSE_REVALIDATE_MS ?? 15_000));
    const timer=setInterval(async()=>{
      try{
        await displayAuth(request);
        if(authorizationCheckUnavailable){
          authorizationCheckUnavailable=false;
          if(projectionEvents.listenerConnected())send({type:'listener-restored',data:{pollingFallback:true,listenerConnected:true,refetchRequired:true}});
        }
        const listenerConnected=projectionEvents.listenerConnected();
        send({type:'heartbeat',data:{serverNow:new Date().toISOString(),listenerConnected,pollingFallback:!listenerConnected}});
      }catch(error){
        if(error instanceof DomainError && (error.status===401 || error.status===403)){
          send({type:'authorization-revoked',data:{}});
          response.end();
          return;
        }
        if(!authorizationCheckUnavailable){
          authorizationCheckUnavailable=true;
          send({type:'listener-degraded',data:{pollingFallback:true,listenerConnected:projectionEvents.listenerConnected(),reason:'authorization-check-unavailable'}});
        }
      }
    },revalidateMs);
    const cleanup=()=>{if(responseClosed)return;responseClosed=true;clearInterval(timer);unsubscribe();};
    response.once('close',cleanup);
  });

  const webRoot=options.webRoot??resolve(process.cwd(),'apps/web/dist');
  if(existsSync(webRoot)) {
    await app.register(fastifyStatic,{root:webRoot});
    app.setNotFoundHandler((request,reply)=>{
      const pathname=request.url.split('?',1)[0]??request.url;
      const reserved=pathname==='/api' || pathname.startsWith('/api/') || pathname==='/assets' || pathname.startsWith('/assets/');
      if(reserved || !['GET','HEAD'].includes(request.method)) return reply.status(404).send({error:{code:'NOT_FOUND',requestId:request.id}});
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request,reply)=>reply.status(404).send({error:{code:'NOT_FOUND',requestId:request.id}}));
  }
  return app;
}

function assertGrantAuthority(auth: AuthContext, rolePreset: string, desired: readonly Capability[]): void {
  if ((rolePreset === 'installation_admin' || desired.includes('installation.manage')) && !auth.capabilities.includes('installation.manage')) throw new DomainError('FORBIDDEN',403);
  if (desired.some((capability)=>!auth.capabilities.includes(capability))) throw new DomainError('FORBIDDEN',403,{reason:'cannot_grant_capability_not_held'});
}

function exactCapabilities(rolePreset:keyof typeof roleCapabilityPresets,requested:readonly Capability[]|undefined):Capability[]{
  const preset=roleCapabilityPresets[rolePreset];
  if(rolePreset==='installation_admin' || rolePreset==='household_admin'){
    if(requested && (requested.length!==preset.length || requested.some((value)=>!preset.includes(value))))throw new DomainError('VALIDATION_FAILED',400,{reason:'admin_preset_must_be_exact'});
    return [...preset];
  }
  const desired=[...(requested??preset)];
  if(desired.some((capability)=>elevatedCapabilities.has(capability)))throw new DomainError('FORBIDDEN',403,{reason:'non_admin_cannot_receive_admin_capability'});
  return desired;
}

function hasCapabilities(actual:readonly Capability[],required:readonly Capability[]):boolean{
  return required.every((capability)=>actual.includes(capability));
}

function requiresActiveLogin(rolePreset:string,desired:readonly Capability[]):boolean{
  return rolePreset==='installation_admin' || rolePreset==='household_admin' || desired.some((capability)=>elevatedCapabilities.has(capability));
}

async function seedDemoHousehold(householdId:string):Promise<void>{
  const installation=(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[householdId])).rows[0]!.installation_id;
  await transaction(async(client)=>{
    const author=(await client.query<{id:string}>(`SELECT id FROM memberships WHERE household_id=$1 AND role_preset='installation_admin'`,[householdId])).rows[0]!.id;
    const rows=[
      {name:'Morgan',age:'adult',role:'member',caps:roleCapabilityPresets.member,email:'member@demo.invalid'},
      {name:'Robin',age:'teen',role:'limited',caps:['household.view','message.create.household','message.publish.display','message.schedule'] as Capability[],email:'limited@demo.invalid'},
      {name:'Sky',age:'child',role:'limited',caps:['household.view'] as Capability[],email:null}
    ];
    for(const row of rows){
      const person=(await client.query<{id:string}>('INSERT INTO persons(household_id,display_name,age_group) VALUES ($1,$2,$3) RETURNING id',[householdId,row.name,row.age])).rows[0]!;
      let accountId:null|string=null;
      if(row.email){const password=await hashPassword('Synthetic-demo-pass-42');accountId=(await client.query<{id:string}>('INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES ($1,$2,$3,\'en\',\'system\') RETURNING id',[installation,row.email,password])).rows[0]!.id;}
      await client.query('INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES ($1,$2,$3,$4,$5)',[householdId,accountId,person.id,row.role,JSON.stringify(row.caps)]);
    }
    await client.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
      VALUES ($1,$2,'Welcome to the synthetic Samvev demo','normal',true,clock_timestamp(),clock_timestamp()+interval '8 hours','published','demo-welcome-v1',clock_timestamp()),
             ($1,$2,'Remember the synthetic gym bag','attention',true,clock_timestamp()+interval '2 minutes',clock_timestamp()+interval '7 minutes','scheduled','demo-schedule-v1',NULL)`,[householdId,author]);
  });
}
