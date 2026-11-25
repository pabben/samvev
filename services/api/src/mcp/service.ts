import { createHash, timingSafeEqual } from 'node:crypto';
import { McpServer, createMcpHandler, requireScopes, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import { DomainError, opaqueToken, tokenHash } from '@samvev/core';
import { z } from 'zod';
import { pool, transaction, type DbClient } from '../db.ts';
import { registerHouseholdTools } from './household-tools.ts';
import {
  getSchoolPlan, listSchoolPlans, listSchoolPlanSources, recordSchoolPlanSourceFailure,
  upsertSchoolPlan, verifySchoolPlanPdf, type SchoolPlanActor,
} from '../school-plans/service.ts';
import {
  schoolPlanKeySchema, schoolPlanListSchema, schoolPlanSourceFailureSchema,
  schoolPlanUpsertSchema, schoolPlanVerifyPdfSchema,
} from '../school-plans/contracts.ts';
import { schoolPdfFetcher, type SchoolPdfFetcher } from '../school-plans/pdf-fetcher.ts';

export const MCP_SCOPES = ['mcp:context', 'mcp:monitors:read', 'mcp:people:read', 'mcp:groceries:read', 'mcp:dinners:read', 'mcp:school-plans:read', 'mcp:school-plans:write', 'offline_access'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
const MCP_SCOPE_SET = new Set<string>(MCP_SCOPES);
const ACCESS_SECONDS = 15 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;

export interface McpPrincipal {
  token: string;
  tokenSetId: string;
  grantId: string;
  clientDatabaseId: string;
  clientId: string;
  accountId: string;
  membershipId: string;
  householdId: string;
  installationId: string;
  scopes: McpScope[];
  expiresAt: Date;
}

export interface McpBrowserActor {
  accountId: string;
  installationId: string;
}

export interface McpResourcePolicyInput {
  expectedRevision:number;
  scopes?:string[];
  personIds:string[];
  displayIds:string[];
  resources:Array<{kind:'school_source';id:string}>;
}

export interface McpSchoolAuthorityRequest {
  write:boolean;
  personIds:string[];
  displayIds:string[];
  sourceIds:string[];
}

export interface AuthorizeRequest {
  responseType: 'code';
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  resource: string;
  scopes: McpScope[];
  state: string;
}

export class OAuthProtocolError extends Error {
  constructor(
    public readonly oauthError: 'invalid_request'|'invalid_client'|'invalid_grant'|'unauthorized_client'|'unsupported_grant_type'|'invalid_scope'|'access_denied',
    public readonly status: number,
    public readonly description: string
  ) { super(oauthError); }
}

function protocolError(error: OAuthProtocolError['oauthError'], description: string, status = 400): never {
  throw new OAuthProtocolError(error, status, description);
}

function stringValue(value: unknown, name: string, max = 2048): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) protocolError('invalid_request', `${name} is invalid`);
  return value;
}

function parseScopes(value: unknown, fallback: readonly McpScope[] = ['mcp:context']): McpScope[] {
  const requested = value === undefined || value === '' ? [...fallback] : String(value).split(/\s+/).filter(Boolean);
  const unique = [...new Set(requested)];
  if (!unique.length || unique.some((scope) => !MCP_SCOPE_SET.has(scope))) protocolError('invalid_scope', 'The requested scope is not supported');
  return unique as McpScope[];
}

function exactResource(origin: string): string { return `${origin}/mcp`; }
export function protectedResourceMetadataUrl(origin: string): string { return `${origin}/.well-known/oauth-protected-resource/mcp`; }

function html(value:unknown):string{return String(value).replace(/[&<>'"]/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]!));}

const oauthPageStyle=`body{font:16px system-ui;max-width:42rem;margin:3rem auto;padding:0 1.25rem;color:#172033;background:#f6f3ed}main{background:#fff;border:1px solid #d8d2c8;border-radius:1rem;padding:1.5rem}label,select,input,button{font:inherit}select,input{box-sizing:border-box;display:block;width:100%;padding:.7rem;margin:.4rem 0 1rem;border:1px solid #68758a;border-radius:.45rem;background:#fff;color:#172033}li{margin:.5rem 0}.summary{padding:.75rem;background:#f0ede6;border-radius:.6rem;overflow-wrap:anywhere}.actions{display:flex;gap:.75rem;margin-top:1.25rem}button{padding:.7rem 1rem;border-radius:.6rem;border:1px solid #4d5d73;background:#fff;color:#172033}button[value=approve],button[type=submit]{background:#173a5e;color:#fff}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #e2813a;outline-offset:3px}@media(prefers-color-scheme:dark){body{color:#eef3f8;background:#091728}main{background:#10243a;border-color:#38516b}.summary{background:#172f48}select,input,button{background:#0c1d30;color:#eef3f8;border-color:#7188a0}button[value=approve],button[type=submit]{background:#d8e8f5;color:#09213a}}`;

export function authorizationConsentHtml(input:{request:AuthorizeRequest;clientName:string;households:Array<{id:string;name:string;locale:'en'|'nb'}>;csrf:string;requestHandle?:string}):string{
  const locale=input.households[0]?.locale==='en'?'en':'nb';
  const copy=locale==='nb'?{
    title:'Koble til Samvev',intro:`${input.clientName} ber om tilgang til Samvev.`,client:'Klient',destination:'Tilbakeadresse',unverified:'Klientnavnet er oppgitt av klienten og er ikke bekreftet av Samvev. Kontroller domenet før du godkjenner.',resource:'Ressurs',household:'Husholdning',approve:'Godkjenn',deny:'Avslå',context:'Se autorisasjonskontekst',monitors:'Se overvåkingsoppdrag',people:'Se eksplisitt tillatte personer',groceries:'Se handlelisten',dinners:'Se middagsplanen',schoolRead:'Se skoleplaner (bare eksplisitt tillatte personer og kilder)',schoolWrite:'Opprette og endre skoleplaner (bare eksplisitt tillatte personer, skjermer og kilder)',offline:'Beholde tilgangen med roterende oppfriskningstoken'
  }:{title:'Connect to Samvev',intro:`${input.clientName} requests access to Samvev.`,client:'Client',destination:'Return destination',unverified:'The client name is supplied by the client and is not verified by Samvev. Check the domain before approving.',resource:'Resource',household:'Household',approve:'Approve',deny:'Deny',context:'View authorization context',monitors:'View monitoring tasks',people:'View explicitly allowed people',groceries:'View the grocery list',dinners:'View the dinner plan',schoolRead:'View school plans (only explicitly allowed people and sources)',schoolWrite:'Create and update school plans (only explicitly allowed people, displays, and sources)',offline:'Keep access with a rotating refresh token'};
  const labels:Record<McpScope,string>={'mcp:context':copy.context,'mcp:monitors:read':copy.monitors,'mcp:people:read':copy.people,'mcp:groceries:read':copy.groceries,'mcp:dinners:read':copy.dinners,'mcp:school-plans:read':copy.schoolRead,'mcp:school-plans:write':copy.schoolWrite,offline_access:copy.offline};
  const hidden:Record<string,string>=input.requestHandle?{request:input.requestHandle,_csrf:input.csrf}:{response_type:'code',client_id:input.request.clientId,redirect_uri:input.request.redirectUri,code_challenge:input.request.codeChallenge,code_challenge_method:'S256',resource:input.request.resource,scope:input.request.scopes.join(' '),state:input.request.state,_csrf:input.csrf};
  const destination=new URL(input.request.redirectUri).origin;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(copy.title)}</title><style>${oauthPageStyle}</style></head><body><main><h1>${html(copy.title)}</h1><p>${html(copy.intro)}</p><div class="summary"><strong>${html(copy.client)}:</strong> ${html(input.clientName)}<br><strong>${html(copy.destination)}:</strong> ${html(destination)}<br><strong>${html(copy.resource)}:</strong> ${html(input.request.resource)}</div><p>${html(copy.unverified)}</p><ul>${input.request.scopes.map(scope=>`<li>${html(labels[scope])}</li>`).join('')}</ul><form method="post" action="/oauth/authorize">${Object.entries(hidden).map(([name,value])=>`<input type="hidden" name="${html(name)}" value="${html(value)}">`).join('')}<label for="household_id">${html(copy.household)}</label><select id="household_id" name="household_id">${input.households.map(household=>`<option value="${html(household.id)}">${html(household.name)}</option>`).join('')}</select><div class="actions"><button type="submit" name="decision" value="approve">${html(copy.approve)}</button><button type="submit" name="decision" value="deny">${html(copy.deny)}</button></div></form></main></body></html>`;
}

export function authorizationLoginHtml(input:{handle:string;loginCsrf:string;locale:'en'|'nb'}):string{
  const copy=input.locale==='nb'?{title:'Logg inn for å fortsette',email:'E-post',password:'Passord',submit:'Logg inn',notice:'Innlogging gir ikke nye rettigheter. Du må godkjenne tilgangen i neste steg.'}:{title:'Sign in to continue',email:'Email',password:'Password',submit:'Sign in',notice:'Signing in does not grant new rights. You must approve access in the next step.'};
  return `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(copy.title)}</title><style>${oauthPageStyle}</style></head><body><main><h1>${html(copy.title)}</h1><p>${html(copy.notice)}</p><form method="post" action="/oauth/login"><input type="hidden" name="request" value="${html(input.handle)}"><input type="hidden" name="login_csrf" value="${html(input.loginCsrf)}"><label for="email">${html(copy.email)}</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254"><label for="password">${html(copy.password)}</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><button type="submit">${html(copy.submit)}</button></form></main></body></html>`;
}

function validRedirectUri(value: unknown): string {
  const text = stringValue(value, 'redirect_uri');
  let url: URL;
  try { url = new URL(text); } catch { return protocolError('invalid_request', 'redirect_uri must be an absolute URL'); }
  if (url.username || url.password || url.hash) protocolError('invalid_request', 'redirect_uri must not contain credentials or a fragment');
  const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !loopback) protocolError('invalid_request', 'redirect_uri must use HTTPS or an HTTP loopback address');
  return url.toString();
}

function appendRedirect(uri: string, values: Record<string,string>): string {
  const target = new URL(uri);
  for (const [key,value] of Object.entries(values)) target.searchParams.set(key,value);
  return target.toString();
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a,b);
}

function prefixedToken(prefix: 'smcp_cl_'|'smcp_ac_'|'smcp_at_'|'smcp_rt_'): string { return `${prefix}${opaqueToken()}`; }

function asScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !MCP_SCOPE_SET.has(entry))) return [];
  return value as McpScope[];
}

function uniqueUuids(value:unknown,max:number):string[]{
  if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)))throw new DomainError('VALIDATION_FAILED',400);
  const result=[...new Set(value as string[])];if(result.length!==value.length)throw new DomainError('VALIDATION_FAILED',400);return result;
}

function policyScopes(value:unknown):string[]|undefined{
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length<1||value.length>16||value.some(scope=>typeof scope!=='string'||scope.length<1||scope.length>96))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_scope_selection'});
  const result=[...new Set(value as string[])];
  if(result.length!==value.length||!result.some(scope=>scope!=='offline_access'))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_scope_selection'});
  return result;
}

function audit(client: DbClient, principal: Pick<McpPrincipal,'installationId'|'householdId'|'grantId'|'clientDatabaseId'>, action:string, subjectType:string, subjectId:string, metadata:Record<string,unknown>={}):Promise<unknown>{
  return client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
    VALUES($1,$2,'mcp',$3,$4,$5,$6,$7)`,[principal.installationId,principal.householdId,principal.grantId,action,subjectType,subjectId,JSON.stringify({...metadata,clientId:principal.clientDatabaseId})]);
}

/** Recheck both delegated membership authority and the exact school resource
 * fence inside the domain operation transaction. A scope never implies broad
 * household person, display or source access. */
export async function assertMcpSchoolAuthority(client:DbClient,principal:McpPrincipal,input:McpSchoolAuthorityRequest):Promise<void>{
  const required=input.write?'mcp:school-plans:write':'mcp:school-plans:read';
  if(!principal.scopes.includes(required))throw new DomainError('FORBIDDEN',403,{reason:'mcp_scope_required',scope:required});
  const personIds=uniqueUuids(input.personIds,100),displayIds=uniqueUuids(input.displayIds,100),sourceIds=uniqueUuids(input.sourceIds,100);
  if(!personIds.length||!sourceIds.length)throw new DomainError('FORBIDDEN',403,{reason:'mcp_resource_grant_required'});
  const row=(await client.query<{person_count:number;display_count:number;source_count:number}>(`SELECT
      (SELECT count(*)::int FROM mcp_oauth_grant_people allowed WHERE allowed.grant_id=oauth_grant.id AND allowed.person_id=ANY($4::uuid[])) person_count,
      (SELECT count(*)::int FROM mcp_oauth_grant_displays allowed WHERE allowed.grant_id=oauth_grant.id AND allowed.display_id=ANY($5::uuid[])) display_count,
      (SELECT count(*)::int FROM mcp_oauth_grant_resources allowed WHERE allowed.grant_id=oauth_grant.id AND allowed.resource_kind='school_source' AND allowed.resource_id=ANY($6::uuid[])) source_count
    FROM mcp_oauth_grants oauth_grant
    JOIN memberships membership ON membership.id=oauth_grant.membership_id AND membership.household_id=oauth_grant.household_id AND membership.account_id=oauth_grant.account_id
    JOIN accounts account ON account.id=oauth_grant.account_id AND account.disabled_at IS NULL
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
    WHERE oauth_grant.id=$1 AND oauth_grant.household_id=$2 AND oauth_grant.account_id=$3 AND oauth_grant.revoked_at IS NULL
      AND membership.capabilities ? 'household.manage' FOR SHARE OF oauth_grant,membership,account`,[principal.grantId,principal.householdId,principal.accountId,personIds,displayIds,sourceIds])).rows[0];
  if(!row||row.person_count!==personIds.length||row.display_count!==displayIds.length||row.source_count!==sourceIds.length)throw new DomainError('FORBIDDEN',403,{reason:'mcp_resource_not_granted'});
}

const schoolSourceListSchema=z.strictObject({limit:z.number().int().min(1).max(50).default(50)});
function toolResult(value:Record<string,unknown>){return{content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value};}
async function mapSequential<T,R>(items:readonly T[],run:(item:T)=>Promise<R>):Promise<R[]>{const results:R[]=[];for(const item of items)results.push(await run(item));return results;}

function principalFromAuthInfo(authInfo:AuthInfo|undefined):McpPrincipal|undefined{
  const extra=authInfo?.extra;
  if(!authInfo||!extra)return;
  const fields=['tokenSetId','grantId','clientDatabaseId','accountId','membershipId','householdId','installationId'] as const;
  if(fields.some(field=>typeof extra[field]!=='string'))return;
  return{token:authInfo.token,tokenSetId:String(extra.tokenSetId),grantId:String(extra.grantId),clientDatabaseId:String(extra.clientDatabaseId),clientId:authInfo.clientId,
    accountId:String(extra.accountId),membershipId:String(extra.membershipId),householdId:String(extra.householdId),installationId:String(extra.installationId),
    scopes:(authInfo.scopes??[]).filter((scope):scope is McpScope=>MCP_SCOPE_SET.has(scope)),expiresAt:new Date((authInfo.expiresAt??0)*1000)};
}

export class McpOAuthService {
  readonly resource: string;
  readonly resourceMetadataUrl: string;
  readonly handler: McpHttpHandler;

  constructor(readonly origin: string,private readonly schoolPdf:Pick<SchoolPdfFetcher,'fetch'>=schoolPdfFetcher,
    private readonly schoolPdfRateLimit:(grantId:string,sourceId:string)=>Promise<void>=async()=>{}) {
    this.resource = exactResource(origin);
    this.resourceMetadataUrl = protectedResourceMetadataUrl(origin);
    this.handler = createMcpHandler(({authInfo}) => this.createServer(authInfo), { responseMode: 'json' });
  }

  protectedResourceMetadata(): Record<string,unknown> {
    return {
      resource: this.resource,
      authorization_servers: [this.origin],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Samvev MCP'
    };
  }

  authorizationServerMetadata(): Record<string,unknown> {
    return {
      issuer: this.origin,
      authorization_endpoint: `${this.origin}/oauth/authorize`,
      token_endpoint: `${this.origin}/oauth/token`,
      registration_endpoint: `${this.origin}/oauth/register`,
      revocation_endpoint: `${this.origin}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code','refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      scopes_supported: MCP_SCOPES
    };
  }

  async registerClient(input: unknown): Promise<Record<string,unknown>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) protocolError('invalid_request','Client metadata must be an object');
    const body=input as Record<string,unknown>;
    const name=stringValue(body.client_name,'client_name',80).trim();
    if (!name) protocolError('invalid_request','client_name is invalid');
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length<1 || body.redirect_uris.length>5) protocolError('invalid_request','redirect_uris is invalid');
    const redirectUris=[...new Set(body.redirect_uris.map(validRedirectUri))];
    if (redirectUris.length!==body.redirect_uris.length) protocolError('invalid_request','redirect_uris must be unique');
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') protocolError('invalid_client','Only public clients are supported');
    const grantTypes=body.grant_types??['authorization_code','refresh_token'];
    const responseTypes=body.response_types??['code'];
    if (!Array.isArray(grantTypes) || grantTypes.some((item)=>item!=='authorization_code'&&item!=='refresh_token') || !grantTypes.includes('authorization_code')) protocolError('invalid_request','grant_types is invalid');
    if (!Array.isArray(responseTypes) || responseTypes.length!==1 || responseTypes[0]!=='code') protocolError('invalid_request','response_types is invalid');
    const installation=(await pool.query<{id:string}>(`SELECT id FROM installations WHERE singleton=true AND claimed_at IS NOT NULL AND demo_mode=false`)).rows[0];
    if(!installation) protocolError('access_denied','The installation is not ready for MCP authorization',403);
    const clientId=prefixedToken('smcp_cl_');
    await pool.query(`INSERT INTO mcp_oauth_clients(installation_id,client_id,client_name,redirect_uris)
      VALUES($1,$2,$3,$4)`,[installation.id,clientId,name,JSON.stringify(redirectUris)]);
    return {client_id:clientId,client_name:name,redirect_uris:redirectUris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_id_issued_at:Math.floor(Date.now()/1000)};
  }

  parseAuthorizeRequest(input: Record<string,unknown>): AuthorizeRequest {
    if(input.response_type!=='code') protocolError('invalid_request','response_type must be code');
    const request:AuthorizeRequest={
      responseType:'code',
      clientId:stringValue(input.client_id,'client_id',180),
      redirectUri:validRedirectUri(input.redirect_uri),
      codeChallenge:stringValue(input.code_challenge,'code_challenge',128),
      codeChallengeMethod:input.code_challenge_method==='S256'?'S256':protocolError('invalid_request','code_challenge_method must be S256'),
      resource:stringValue(input.resource,'resource'),
      scopes:parseScopes(input.scope),
      state:stringValue(input.state,'state',512)
    };
    if(!/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge)) protocolError('invalid_request','code_challenge must be an S256 challenge');
    if(request.resource!==this.resource) protocolError('invalid_request','resource must identify this MCP server');
    return request;
  }

  async authorizationContext(actor:McpBrowserActor, request:AuthorizeRequest):Promise<{clientDatabaseId:string;clientName:string;households:Array<{id:string;name:string;locale:'en'|'nb'}>}> {
    const client=(await pool.query<{id:string;client_name:string;redirect_uris:string[]}>(`SELECT id,client_name,redirect_uris FROM mcp_oauth_clients
      WHERE installation_id=$1 AND client_id=$2 AND revoked_at IS NULL`,[actor.installationId,request.clientId])).rows[0];
    if(!client||!client.redirect_uris.includes(request.redirectUri)) protocolError('invalid_client','The client or redirect URI is not registered',401);
    const households=(await pool.query<{id:string;name:string;locale:'en'|'nb'}>(`SELECT household.id,household.name,account.locale
      FROM memberships membership
      JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
      JOIN households household ON household.id=membership.household_id AND household.installation_id=$2
      JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
      WHERE membership.account_id=$1 AND membership.capabilities ? 'household.manage'
      ORDER BY household.name,household.id`,[actor.accountId,actor.installationId])).rows;
    if(!households.length) protocolError('access_denied','An adult household administrator must authorize this client',403);
    return{clientDatabaseId:client.id,clientName:client.client_name,households};
  }

  async stageLoginRequest(request:AuthorizeRequest):Promise<{handle:string;loginCsrf:string;locale:'en'|'nb'}>{
    const installation=(await pool.query<{id:string;default_locale:'en'|'nb'}>(`SELECT id,default_locale FROM installations WHERE singleton=true AND claimed_at IS NOT NULL AND demo_mode=false`)).rows[0];
    if(!installation)protocolError('access_denied','The installation is not ready for MCP authorization',403);
    const client=(await pool.query<{redirect_uris:string[]}>(`SELECT redirect_uris FROM mcp_oauth_clients WHERE installation_id=$1 AND client_id=$2 AND revoked_at IS NULL`,[installation.id,request.clientId])).rows[0];
    if(!client||!client.redirect_uris.includes(request.redirectUri))protocolError('invalid_client','The client or redirect URI is not registered',401);
    const handle=opaqueToken(),loginCsrf=opaqueToken();
    await pool.query(`INSERT INTO mcp_oauth_login_requests(request_hash,login_csrf_hash,request_data,expires_at)
      VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')`,[tokenHash(handle),tokenHash(loginCsrf),JSON.stringify(request)]);
    return{handle,loginCsrf,locale:installation.default_locale};
  }

  async bindLoginRequest(handle:string,loginCsrf:string,accountId:string):Promise<{resumeToken:string;consentCsrf:string}>{
    if(!/^[A-Za-z0-9_-]{43}$/.test(handle)||!/^[A-Za-z0-9_-]{43}$/.test(loginCsrf))protocolError('invalid_request','The login request is invalid');
    const resumeToken=opaqueToken(),consentCsrf=opaqueToken();
    const updated=await pool.query(`UPDATE mcp_oauth_login_requests SET account_id=$3,resume_token_hash=$4,consent_csrf_hash=$5
      WHERE request_hash=$1 AND login_csrf_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND account_id IS NULL`,[tokenHash(handle),tokenHash(loginCsrf),accountId,tokenHash(resumeToken),tokenHash(consentCsrf)]);
    if(!updated.rowCount)protocolError('invalid_request','The login request is invalid or expired');
    return{resumeToken,consentCsrf};
  }

  async resumeAuthorization(handle:string,resumeToken:string,consentCsrf:string):Promise<{actor:McpBrowserActor;request:AuthorizeRequest;context:{clientDatabaseId:string;clientName:string;households:Array<{id:string;name:string;locale:'en'|'nb'}>}}>{
    if(![handle,resumeToken,consentCsrf].every(value=>/^[A-Za-z0-9_-]{43}$/.test(value)))protocolError('invalid_request','The authorization request is invalid');
    const row=(await pool.query<{request_data:AuthorizeRequest;account_id:string;installation_id:string}>(`SELECT login_request.request_data,login_request.account_id,installation.id installation_id
      FROM mcp_oauth_login_requests login_request CROSS JOIN installations installation
      WHERE installation.singleton=true AND installation.claimed_at IS NOT NULL AND installation.demo_mode=false
        AND login_request.request_hash=$1 AND login_request.resume_token_hash=$2 AND login_request.consent_csrf_hash=$3
        AND login_request.account_id IS NOT NULL AND login_request.consumed_at IS NULL AND login_request.expires_at>clock_timestamp()`,[tokenHash(handle),tokenHash(resumeToken),tokenHash(consentCsrf)])).rows[0];
    if(!row)protocolError('invalid_request','The authorization request is invalid or expired');
    const request=row.request_data;
    if(!request||request.responseType!=='code'||!Array.isArray(request.scopes))protocolError('invalid_request','The authorization request is invalid');
    const actor={accountId:row.account_id,installationId:row.installation_id};
    return{actor,request,context:await this.authorizationContext(actor,request)};
  }

  async authorize(actor:McpBrowserActor,request:AuthorizeRequest,householdId:string,approved:boolean,requestHandle?:string):Promise<string>{
    if(requestHandle)await this.consumeLoginRequest(requestHandle,actor.accountId);
    const context=await this.authorizationContext(actor,request);
    if(!approved)return appendRedirect(request.redirectUri,{error:'access_denied',state:request.state,iss:this.origin});
    if(!context.households.some((household)=>household.id===householdId))protocolError('access_denied','The selected household is not available',403);
    const result=await transaction(async(client)=>{
      const authority=(await client.query<{membership_id:string;installation_id:string}>(`SELECT membership.id AS membership_id,household.installation_id
        FROM memberships membership JOIN households household ON household.id=membership.household_id
        JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
        JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
        WHERE membership.household_id=$1 AND membership.account_id=$2 AND household.installation_id=$3
          AND membership.capabilities ? 'household.manage' FOR UPDATE OF membership,account`,[householdId,actor.accountId,actor.installationId])).rows[0];
      if(!authority)protocolError('access_denied','Household authorization changed',403);
      const grant=(await client.query<{id:string;revision:number}>(`INSERT INTO mcp_oauth_grants(installation_id,client_id,household_id,membership_id,account_id,scopes)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(client_id,membership_id) DO UPDATE SET scopes=EXCLUDED.scopes,revoked_at=NULL,revision=mcp_oauth_grants.revision+1,updated_at=clock_timestamp()
        RETURNING id,revision`,[actor.installationId,context.clientDatabaseId,householdId,authority.membership_id,actor.accountId,JSON.stringify(request.scopes)])).rows[0]!;
      await client.query(`UPDATE mcp_oauth_token_sets SET revoked_at=clock_timestamp() WHERE grant_id=$1 AND revoked_at IS NULL`,[grant.id]);
      const code=prefixedToken('smcp_ac_');
      await client.query(`INSERT INTO mcp_oauth_authorization_codes(grant_id,code_hash,redirect_uri,code_challenge,resource,expires_at)
        VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6||' seconds')::interval)`,[grant.id,tokenHash(code),request.redirectUri,request.codeChallenge,this.resource,CODE_SECONDS]);
      await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
        VALUES($1,$2,'account',$3,'mcp.authorization_granted','mcp_oauth_grant',$4,$5)`,[actor.installationId,householdId,actor.accountId,grant.id,JSON.stringify({clientId:context.clientDatabaseId,scopes:request.scopes,revision:grant.revision})]);
      return code;
    });
    return appendRedirect(request.redirectUri,{code:result,state:request.state,iss:this.origin});
  }

  private async consumeLoginRequest(handle:string,accountId:string):Promise<void>{
    const consumed=await pool.query(`UPDATE mcp_oauth_login_requests SET consumed_at=clock_timestamp()
      WHERE request_hash=$1 AND account_id=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()`,[tokenHash(handle),accountId]);
    if(!consumed.rowCount)protocolError('invalid_request','The authorization request is invalid or expired');
  }

  async exchangeToken(input:Record<string,unknown>):Promise<Record<string,unknown>>{
    const grantType=stringValue(input.grant_type,'grant_type',64);
    if(grantType==='authorization_code')return this.exchangeCode(input);
    if(grantType==='refresh_token')return this.refresh(input);
    protocolError('unsupported_grant_type','Only authorization_code and refresh_token are supported');
  }

  private async exchangeCode(input:Record<string,unknown>):Promise<Record<string,unknown>>{
    const clientId=stringValue(input.client_id,'client_id',180),code=stringValue(input.code,'code',256),redirectUri=validRedirectUri(input.redirect_uri);
    const verifier=stringValue(input.code_verifier,'code_verifier',128),resource=stringValue(input.resource,'resource');
    if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||resource!==this.resource)protocolError('invalid_grant','The authorization code binding is invalid');
    return transaction(async(client)=>{
      const row=(await client.query<{code_id:string;grant_id:string;redirect_uri:string;code_challenge:string;resource:string;expires_at:Date;consumed_at:Date|null;client_id:string;client_revoked_at:Date|null;grant_revoked_at:Date|null;scopes:unknown;household_id:string;membership_id:string;account_id:string;installation_id:string}>(`SELECT code.id code_id,code.grant_id,code.redirect_uri,code.code_challenge,code.resource,code.expires_at,code.consumed_at,
        oauth_client.client_id,oauth_client.revoked_at client_revoked_at,oauth_grant.revoked_at grant_revoked_at,oauth_grant.scopes,oauth_grant.household_id,oauth_grant.membership_id,oauth_grant.account_id,oauth_grant.installation_id
        FROM mcp_oauth_authorization_codes code JOIN mcp_oauth_grants oauth_grant ON oauth_grant.id=code.grant_id
        JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
        WHERE code.code_hash=$1 FOR UPDATE OF code,oauth_grant,oauth_client`,[tokenHash(code)])).rows[0];
      const challenge=createHash('sha256').update(verifier).digest('base64url');
      if(!row||row.client_id!==clientId||row.redirect_uri!==redirectUri||row.resource!==resource||row.client_revoked_at||row.grant_revoked_at||row.consumed_at||row.expires_at<=new Date()||!secureEqual(challenge,row.code_challenge))protocolError('invalid_grant','The authorization code is invalid or expired');
      await this.lockCurrentAuthority(client,row);
      await client.query('UPDATE mcp_oauth_authorization_codes SET consumed_at=clock_timestamp() WHERE id=$1',[row.code_id]);
      return this.issueTokenSet(client,row,asScopes(row.scopes));
    });
  }

  private async refresh(input:Record<string,unknown>):Promise<Record<string,unknown>>{
    const clientId=stringValue(input.client_id,'client_id',180),refreshToken=stringValue(input.refresh_token,'refresh_token',256),resource=stringValue(input.resource,'resource');
    if(resource!==this.resource)protocolError('invalid_grant','The refresh token resource is invalid');
    const result=await transaction(async(client)=>{
      const row=(await client.query<{token_set_id:string;grant_id:string;refresh_expires_at:Date|null;rotated_at:Date|null;token_revoked_at:Date|null;client_id:string;client_revoked_at:Date|null;grant_revoked_at:Date|null;scopes:unknown;grant_scopes:unknown;household_id:string;membership_id:string;account_id:string;installation_id:string}>(`SELECT token_set.id token_set_id,token_set.grant_id,token_set.refresh_expires_at,token_set.rotated_at,token_set.revoked_at token_revoked_at,
        oauth_client.client_id,oauth_client.revoked_at client_revoked_at,oauth_grant.revoked_at grant_revoked_at,token_set.scopes,oauth_grant.scopes grant_scopes,
        oauth_grant.household_id,oauth_grant.membership_id,oauth_grant.account_id,oauth_grant.installation_id
        FROM mcp_oauth_token_sets token_set JOIN mcp_oauth_grants oauth_grant ON oauth_grant.id=token_set.grant_id
        JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
        WHERE token_set.refresh_token_hash=$1 FOR UPDATE OF token_set,oauth_grant,oauth_client`,[tokenHash(refreshToken)])).rows[0];
      if(!row||row.client_id!==clientId||row.client_revoked_at||row.grant_revoked_at||row.token_revoked_at||!row.refresh_expires_at||row.refresh_expires_at<=new Date())protocolError('invalid_grant','The refresh token is invalid or expired');
      if(row.rotated_at){
        await client.query(`UPDATE mcp_oauth_token_sets SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE grant_id=$1`,[row.grant_id]);
        return null;
      }
      await this.lockCurrentAuthority(client,row);
      const currentScopes=asScopes(row.scopes),grantScopes=asScopes(row.grant_scopes);
      const scopes=input.scope===undefined?currentScopes:parseScopes(input.scope,currentScopes);
      if(scopes.some(scope=>!grantScopes.includes(scope)))protocolError('invalid_scope','Refresh cannot widen the authorization');
      await client.query('UPDATE mcp_oauth_token_sets SET rotated_at=clock_timestamp() WHERE id=$1',[row.token_set_id]);
      return this.issueTokenSet(client,row,scopes,row.token_set_id);
    });
    if(!result)protocolError('invalid_grant','The refresh token is invalid or expired');
    return result;
  }

  private async lockCurrentAuthority(client:DbClient,row:{household_id:string;membership_id:string;account_id:string;installation_id:string}):Promise<void>{
    const authority=await client.query(`SELECT 1 FROM memberships membership
      JOIN households household ON household.id=membership.household_id AND household.installation_id=$4
      JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
      JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
      WHERE membership.household_id=$1 AND membership.id=$2 AND membership.account_id=$3
        AND membership.capabilities ? 'household.manage' FOR SHARE OF membership,account`,[row.household_id,row.membership_id,row.account_id,row.installation_id]);
    if(!authority.rowCount)protocolError('invalid_grant','The household authorization is no longer valid');
  }

  private async issueTokenSet(client:DbClient,row:{grant_id:string},scopes:McpScope[],parentId?:string):Promise<Record<string,unknown>>{
    const accessToken=prefixedToken('smcp_at_');
    const refreshToken=scopes.includes('offline_access')?prefixedToken('smcp_rt_'):null;
    await client.query(`INSERT INTO mcp_oauth_token_sets(grant_id,parent_id,access_token_hash,refresh_token_hash,scopes,resource,access_expires_at,refresh_expires_at)
      VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+($7||' seconds')::interval,CASE WHEN $4::text IS NULL THEN NULL ELSE clock_timestamp()+($8||' seconds')::interval END)`,
      [row.grant_id,parentId??null,tokenHash(accessToken),refreshToken?tokenHash(refreshToken):null,JSON.stringify(scopes),this.resource,ACCESS_SECONDS,REFRESH_SECONDS]);
    return{access_token:accessToken,token_type:'Bearer',expires_in:ACCESS_SECONDS,scope:scopes.join(' '),...(refreshToken?{refresh_token:refreshToken}:{})};
  }

  async revokeToken(input:Record<string,unknown>):Promise<void>{
    const clientId=stringValue(input.client_id,'client_id',180),token=stringValue(input.token,'token',256),hash=tokenHash(token);
    await transaction(async(client)=>{
      const row=(await client.query<{grant_id:string}>(`SELECT token_set.grant_id FROM mcp_oauth_token_sets token_set
        JOIN mcp_oauth_grants oauth_grant ON oauth_grant.id=token_set.grant_id JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
        WHERE oauth_client.client_id=$1 AND (token_set.access_token_hash=$2 OR token_set.refresh_token_hash=$2)
        LIMIT 1 FOR UPDATE OF token_set`,[clientId,hash])).rows[0];
      if(row)await client.query(`UPDATE mcp_oauth_token_sets SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE grant_id=$1 AND revoked_at IS NULL`,[row.grant_id]);
    });
  }

  async verifyAccessToken(authorization:unknown):Promise<McpPrincipal>{
    const match=typeof authorization==='string'?/^Bearer (smcp_at_[A-Za-z0-9_-]{43})$/.exec(authorization):null;
    if(!match)protocolError('invalid_grant','A valid MCP access token is required',401);
    const row=(await pool.query<{token_set_id:string;grant_id:string;client_database_id:string;client_id:string;account_id:string;membership_id:string;household_id:string;installation_id:string;scopes:unknown;access_expires_at:Date;resource:string}>(`SELECT token_set.id token_set_id,oauth_grant.id grant_id,oauth_client.id client_database_id,oauth_client.client_id,oauth_grant.account_id,oauth_grant.membership_id,oauth_grant.household_id,oauth_grant.installation_id,token_set.scopes,token_set.access_expires_at,token_set.resource
      FROM mcp_oauth_token_sets token_set JOIN mcp_oauth_grants oauth_grant ON oauth_grant.id=token_set.grant_id
      JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
      JOIN memberships membership ON membership.id=oauth_grant.membership_id AND membership.household_id=oauth_grant.household_id AND membership.account_id=oauth_grant.account_id
      JOIN accounts account ON account.id=oauth_grant.account_id AND account.disabled_at IS NULL
      JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
      WHERE token_set.access_token_hash=$1 AND token_set.revoked_at IS NULL AND token_set.access_expires_at>clock_timestamp()
        AND token_set.resource=$2 AND oauth_grant.revoked_at IS NULL AND oauth_client.revoked_at IS NULL
        AND membership.capabilities ? 'household.manage'`,[tokenHash(match[1]!),this.resource])).rows[0];
    if(!row)protocolError('invalid_grant','The MCP access token is invalid or expired',401);
    await pool.query('UPDATE mcp_oauth_token_sets SET last_used_at=clock_timestamp() WHERE id=$1',[row.token_set_id]);
    return{token:match[1]!,tokenSetId:row.token_set_id,grantId:row.grant_id,clientDatabaseId:row.client_database_id,clientId:row.client_id,accountId:row.account_id,membershipId:row.membership_id,householdId:row.household_id,installationId:row.installation_id,scopes:asScopes(row.scopes),expiresAt:row.access_expires_at};
  }

  authInfo(principal:McpPrincipal):AuthInfo{
    return{token:principal.token,clientId:principal.clientId,scopes:principal.scopes,expiresAt:Math.floor(principal.expiresAt.getTime()/1000),resource:new URL(this.resource),resourceMetadataUrl:this.resourceMetadataUrl,
      extra:{tokenSetId:principal.tokenSetId,grantId:principal.grantId,clientDatabaseId:principal.clientDatabaseId,accountId:principal.accountId,membershipId:principal.membershipId,householdId:principal.householdId,installationId:principal.installationId}};
  }

  async listAuthorizations(householdId:string):Promise<Array<Record<string,unknown>>>{
    const rows=await pool.query(`SELECT oauth_grant.id,oauth_client.client_name,oauth_grant.scopes,oauth_grant.revision,oauth_grant.created_at,oauth_grant.updated_at,
      oauth_grant.revoked_at,(SELECT max(last_used_at) FROM mcp_oauth_token_sets token_set WHERE token_set.grant_id=oauth_grant.id) last_used_at,
      COALESCE((SELECT jsonb_agg(person_id ORDER BY person_id) FROM mcp_oauth_grant_people allowed WHERE allowed.grant_id=oauth_grant.id),'[]') person_ids,
      COALESCE((SELECT jsonb_agg(display_id ORDER BY display_id) FROM mcp_oauth_grant_displays allowed WHERE allowed.grant_id=oauth_grant.id),'[]') display_ids,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',resource_kind,'id',resource_id) ORDER BY resource_kind,resource_id) FROM mcp_oauth_grant_resources allowed WHERE allowed.grant_id=oauth_grant.id),'[]') resources
      FROM mcp_oauth_grants oauth_grant JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
      WHERE oauth_grant.household_id=$1 ORDER BY oauth_grant.created_at DESC`,[householdId]);
    return rows.rows;
  }

  async listAuthorizationActivity(householdId:string,grantId:string,limit=50):Promise<Array<Record<string,unknown>>>{
    const [id]=uniqueUuids([grantId],1);if(!Number.isInteger(limit)||limit<1||limit>100)throw new DomainError('VALIDATION_FAILED',400);
    const grant=await pool.query('SELECT 1 FROM mcp_oauth_grants WHERE id=$1 AND household_id=$2',[id,householdId]);
    if(!grant.rowCount)throw new DomainError('NOT_FOUND',404);
    const rows=await pool.query(`SELECT occurred_at AS "occurredAt",action,subject_type AS "subjectType",subject_id AS "subjectId"
      FROM audit_events WHERE household_id=$1 AND actor_type='mcp' AND actor_id=$2
      ORDER BY occurred_at DESC,id DESC LIMIT $3`,[householdId,id,limit]);
    return rows.rows;
  }

  async updateAuthorizationPolicy(actor:{installationId:string;householdId:string;accountId:string;membershipId:string},grantId:string,input:McpResourcePolicyInput):Promise<Record<string,unknown>>{
    const personIds=uniqueUuids(input.personIds,100),displayIds=uniqueUuids(input.displayIds,100),requestedScopes=policyScopes(input.scopes);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!Array.isArray(input.resources)||input.resources.length>100)throw new DomainError('VALIDATION_FAILED',400);
    const resources=input.resources.map(resource=>{if(!resource||resource.kind!=='school_source')throw new DomainError('VALIDATION_FAILED',400);return{kind:resource.kind,id:uniqueUuids([resource.id],1)[0]!};});
    if(new Set(resources.map(resource=>`${resource.kind}:${resource.id}`)).size!==resources.length)throw new DomainError('VALIDATION_FAILED',400);
    return transaction(async(client)=>{
      const currentActor=await client.query(`SELECT 1 FROM memberships membership JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
        WHERE membership.id=$1 AND membership.household_id=$2 AND membership.account_id=$3 AND membership.capabilities ? 'household.manage' FOR SHARE OF membership,account`,[actor.membershipId,actor.householdId,actor.accountId]);
      if(!currentActor.rowCount)throw new DomainError('FORBIDDEN',403);
      const grant=(await client.query<{id:string;scopes:unknown;revision:number;client_id:string}>(`SELECT id,scopes,revision,client_id FROM mcp_oauth_grants WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR UPDATE`,[grantId,actor.householdId])).rows[0];
      if(!grant)throw new DomainError('NOT_FOUND',404);
      if(grant.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409);
      const currentScopes=asScopes(grant.scopes),scopeSelection=requestedScopes??currentScopes;
      const catalog=await client.query<{scope:string}>('SELECT scope FROM mcp_oauth_scope_catalog WHERE scope=ANY($1::text[])',[scopeSelection]);
      if(catalog.rowCount!==scopeSelection.length||!scopeSelection.some(scope=>scope!=='offline_access'))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_scope_selection'});
      if(scopeSelection.some(scope=>!currentScopes.includes(scope as McpScope)))throw new DomainError('VALIDATION_FAILED',400,{reason:'scope_broadening_requires_consent'});
      const scopes=scopeSelection as McpScope[],hasSchoolScope=scopes.includes('mcp:school-plans:read')||scopes.includes('mcp:school-plans:write');
      const hasPeopleScope=hasSchoolScope||scopes.includes('mcp:people:read');
      if((personIds.length&&!hasPeopleScope)||((displayIds.length||resources.length)&&!hasSchoolScope))throw new DomainError('VALIDATION_FAILED',400,{reason:'resource_scope_required'});
      const [people,displays,schoolSourceTable]=await Promise.all([
        personIds.length?client.query(`SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])`,[actor.householdId,personIds]):Promise.resolve({rowCount:0}),
        displayIds.length?client.query(`SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL`,[actor.householdId,displayIds]):Promise.resolve({rowCount:0}),
        resources.length?client.query<{name:string|null}>(`SELECT to_regclass('school_plan_sources')::text name`):Promise.resolve({rows:[{name:'unused'}]})
      ]);
      if((people.rowCount??0)!==personIds.length||(displays.rowCount??0)!==displayIds.length)throw new DomainError('VALIDATION_FAILED',400,{reason:'resource_outside_household'});
      if(resources.length){
        if(!schoolSourceTable.rows[0]?.name)throw new DomainError('CONFLICT',409,{reason:'school_source_registry_unavailable'});
        const sourceIds=resources.map(resource=>resource.id);
        const sources=await client.query<{id:string;revoked_at:Date|null}>(`SELECT id,revoked_at FROM school_plan_sources
          WHERE household_id=$1 AND id=ANY($2::uuid[]) AND person_id=ANY($3::uuid[])`,[actor.householdId,sourceIds,personIds]);
        if((sources.rowCount??0)!==sourceIds.length)throw new DomainError('VALIDATION_FAILED',400,{reason:'resource_outside_household'});
        if(sources.rows.some(source=>source.revoked_at))throw new DomainError('VALIDATION_FAILED',400,{reason:'revoked_source_remove_first'});
      }
      await client.query('DELETE FROM mcp_oauth_grant_people WHERE grant_id=$1',[grant.id]);
      await client.query('DELETE FROM mcp_oauth_grant_displays WHERE grant_id=$1',[grant.id]);
      await client.query('DELETE FROM mcp_oauth_grant_resources WHERE grant_id=$1',[grant.id]);
      if(personIds.length)await client.query(`INSERT INTO mcp_oauth_grant_people(household_id,grant_id,person_id) SELECT $1,$2,unnest($3::uuid[])`,[actor.householdId,grant.id,personIds]);
      if(displayIds.length)await client.query(`INSERT INTO mcp_oauth_grant_displays(household_id,grant_id,display_id) SELECT $1,$2,unnest($3::uuid[])`,[actor.householdId,grant.id,displayIds]);
      for(const resource of resources)await client.query(`INSERT INTO mcp_oauth_grant_resources(household_id,grant_id,resource_kind,resource_id) VALUES($1,$2,$3,$4)`,[actor.householdId,grant.id,resource.kind,resource.id]);
      const updated=(await client.query<{revision:number}>(`UPDATE mcp_oauth_grants SET scopes=$2::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision`,[grant.id,JSON.stringify(scopes)])).rows[0]!;
      await client.query(`UPDATE mcp_oauth_token_sets SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE grant_id=$1 AND revoked_at IS NULL`,[grant.id]);
      await client.query(`UPDATE mcp_oauth_authorization_codes SET consumed_at=COALESCE(consumed_at,clock_timestamp()) WHERE grant_id=$1 AND consumed_at IS NULL`,[grant.id]);
      await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
        VALUES($1,$2,'account',$3,'mcp.authorization_policy_changed','mcp_oauth_grant',$4,$5)`,[actor.installationId,actor.householdId,actor.accountId,grant.id,JSON.stringify({clientId:grant.client_id,scopes,personCount:personIds.length,displayCount:displayIds.length,resourceCount:resources.length,revision:updated.revision})]);
      return{id:grant.id,revision:updated.revision,scopes,personIds,displayIds,resources,tokensRevoked:true};
    });
  }

  async revokeAuthorization(actor:{installationId:string;householdId:string;accountId:string;membershipId:string},grantId:string):Promise<void>{
    await transaction(async(client)=>{
      const currentActor=await client.query(`SELECT 1 FROM memberships membership JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
        WHERE membership.id=$1 AND membership.household_id=$2 AND membership.account_id=$3 AND membership.capabilities ? 'household.manage' FOR SHARE OF membership,account`,[actor.membershipId,actor.householdId,actor.accountId]);
      if(!currentActor.rowCount)throw new DomainError('FORBIDDEN',403);
      const grant=(await client.query<{id:string;client_id:string}>(`SELECT id,client_id FROM mcp_oauth_grants WHERE id=$1 AND household_id=$2 FOR UPDATE`,[grantId,actor.householdId])).rows[0];
      if(!grant)throw new DomainError('NOT_FOUND',404);
      await client.query(`UPDATE mcp_oauth_grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,[grant.id]);
      await client.query(`UPDATE mcp_oauth_token_sets SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE grant_id=$1 AND revoked_at IS NULL`,[grant.id]);
      await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
        VALUES($1,$2,'account',$3,'mcp.authorization_revoked','mcp_oauth_grant',$4,$5)`,[actor.installationId,actor.householdId,actor.accountId,grant.id,JSON.stringify({clientId:grant.client_id})]);
    });
  }

  async close():Promise<void>{await this.handler.close();}

  private async schoolActors(principal:McpPrincipal,requestedSourceId?:string):Promise<SchoolPlanActor[]>{
    const rows=(await pool.query<{person_ids:string[];display_ids:string[];source_id:string;connection_id:string}>(`SELECT
      ARRAY(SELECT person_id FROM mcp_oauth_grant_people allowed WHERE allowed.grant_id=oauth_grant.id ORDER BY person_id) person_ids,
      ARRAY(SELECT display_id FROM mcp_oauth_grant_displays allowed WHERE allowed.grant_id=oauth_grant.id ORDER BY display_id) display_ids,
      source.id source_id,source.connection_id
      FROM mcp_oauth_grants oauth_grant
      JOIN memberships membership ON membership.id=oauth_grant.membership_id AND membership.household_id=oauth_grant.household_id AND membership.account_id=oauth_grant.account_id
      JOIN accounts account ON account.id=oauth_grant.account_id AND account.disabled_at IS NULL
      JOIN mcp_oauth_grant_resources resource ON resource.grant_id=oauth_grant.id AND resource.household_id=oauth_grant.household_id AND resource.resource_kind='school_source'
      JOIN school_plan_sources source ON source.id=resource.resource_id AND source.household_id=resource.household_id AND source.revoked_at IS NULL
      JOIN integration_connections connection ON connection.id=source.connection_id AND connection.household_id=source.household_id AND connection.revoked_at IS NULL
      WHERE oauth_grant.id=$1 AND oauth_grant.household_id=$2 AND oauth_grant.account_id=$3 AND oauth_grant.membership_id=$4
        AND oauth_grant.revoked_at IS NULL AND membership.capabilities ? 'household.manage'
        AND ($5::uuid IS NULL OR source.id=$5) ORDER BY source.connection_id,source.id`,
    [principal.grantId,principal.householdId,principal.accountId,principal.membershipId,requestedSourceId??null])).rows;
    if(!rows.length){
      if(requestedSourceId)throw new DomainError('NOT_FOUND',404);
      throw new DomainError('FORBIDDEN',403,{reason:'mcp_school_policy_required'});
    }
    if(!rows[0]!.person_ids.length)throw new DomainError('FORBIDDEN',403,{reason:'mcp_school_policy_required'});
    const byConnection=new Map<string,string[]>();for(const row of rows)byConnection.set(row.connection_id,[...(byConnection.get(row.connection_id)??[]),row.source_id]);
    return[...byConnection].map(([connectionId,sourceIds])=>({householdId:principal.householdId,accountId:principal.accountId,membershipId:principal.membershipId,connectionId,
      scopes:principal.scopes,personIds:rows[0]!.person_ids,sourceIds,displayIds:rows[0]!.display_ids,
      authorizeInTransaction:(client,request)=>assertMcpSchoolAuthority(client,principal,{write:request.write,personIds:[...request.personIds],displayIds:[...request.displayIds],sourceIds:[...request.sourceIds]})}));
  }

  private createServer(authInfo:AuthInfo|undefined):McpServer{
    const server=new McpServer({name:'samvev',version:'0.1.0'});
    const principal=principalFromAuthInfo(authInfo);
    const householdId=String(authInfo?.extra?.householdId??'');
    const grantId=String(authInfo?.extra?.grantId??'');
    const installationId=String(authInfo?.extra?.installationId??'');
    const clientDatabaseId=String(authInfo?.extra?.clientDatabaseId??'');
    server.registerTool('samvev_context',{
      title:'Samvev authorization context',description:'Show the household and scopes authorized for this MCP connection.',inputSchema:{householdId:z.string().uuid().optional()},scopeChallenge:requireScopes('mcp:context'),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async(input)=>{
      if(input.householdId&&input.householdId!==householdId)return{isError:true,content:[{type:'text',text:'Household is not available to this authorization.'}]};
      const household=(await pool.query<{id:string;name:string;timezone:string;default_locale:string}>(`SELECT id,name,timezone,default_locale FROM households WHERE id=$1`,[householdId])).rows[0];
      if(!household)return{isError:true,content:[{type:'text',text:'Authorization is no longer available.'}]};
      return{content:[{type:'text',text:JSON.stringify({household,scopes:authInfo?.scopes??[]})}],structuredContent:{household,scopes:authInfo?.scopes??[]}};
    });
    server.registerTool('samvev_monitors_list',{
      title:'List Samvev monitors',description:'List durable monitoring tasks in the authorized household without returning instructions, source URLs, people, or display audiences.',inputSchema:{householdId:z.string().uuid()},scopeChallenge:requireScopes('mcp:monitors:read'),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
    },async({householdId:requestedHousehold})=>{
      if(requestedHousehold!==householdId)return{isError:true,content:[{type:'text',text:'Household is not available to this authorization.'}]};
      const tasks=(await pool.query(`SELECT id,name,state,check_interval_minutes,notice_days_before,notice_local_time::text,revision,approved_revision,last_checked_at,next_check_at,error_code,created_at,updated_at
        FROM monitor_tasks WHERE household_id=$1 ORDER BY created_at DESC`,[householdId])).rows;
      if(grantId&&installationId&&clientDatabaseId)await audit(pool,{grantId,installationId,householdId,clientDatabaseId},'mcp.monitors_listed','mcp_oauth_grant',grantId,{count:tasks.length});
      return{content:[{type:'text',text:JSON.stringify({tasks})}],structuredContent:{tasks}};
    });
    if(principal){
      const householdScopes:Record<string,McpScope>={'household.people.list':'mcp:people:read','household.groceries.list':'mcp:groceries:read','household.dinners.list':'mcp:dinners:read'};
      const householdAuditActions:Record<string,string>={'household.people.list':'mcp.people_listed','household.groceries.list':'mcp.groceries_listed','household.dinners.list':'mcp.dinners_listed'};
      registerHouseholdTools({registerTool:(name,options,handler)=>server.registerTool(name,{description:options.description,inputSchema:options.inputSchema,scopeChallenge:requireScopes(householdScopes[name]!),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(input)=>{
        const result=await handler(input) as Record<string,unknown>;
        await audit(pool,principal,householdAuditActions[name]!,'mcp_oauth_grant',principal.grantId);
        return toolResult(result);
      })},{principal});
      server.registerTool('school.sources.list',{description:'List the school sources explicitly granted to this client.',inputSchema:schoolSourceListSchema,scopeChallenge:requireScopes('mcp:school-plans:read'),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(input)=>{
        const actors=await this.schoolActors(principal),sources=(await mapSequential(actors,actor=>listSchoolPlanSources(actor,input.limit))).flat().sort((left,right)=>left.id.localeCompare(right.id)).slice(0,input.limit);await audit(pool,principal,'mcp.school_sources_listed','mcp_oauth_grant',principal.grantId,{count:sources.length});return toolResult({sources});
      });
      server.registerTool('school.plans.list',{description:'List school plans only for granted people and sources.',inputSchema:schoolPlanListSchema,scopeChallenge:requireScopes('mcp:school-plans:read'),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(input)=>{
        const actors=await this.schoolActors(principal,input.sourceId),plans=(await mapSequential(actors,actor=>listSchoolPlans(actor,input))).flat().sort((left,right)=>right.startsOn.localeCompare(left.startsOn)||left.id.localeCompare(right.id)).slice(0,input.limit);await audit(pool,principal,'mcp.school_plans_listed','mcp_oauth_grant',principal.grantId,{count:plans.length});return toolResult({plans});
      });
      server.registerTool('school.plans.get',{description:'Read one school plan by granted source and ISO week.',inputSchema:schoolPlanKeySchema,scopeChallenge:requireScopes('mcp:school-plans:read'),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(input)=>{
        const actor=(await this.schoolActors(principal,input.sourceId))[0]!,plan=await getSchoolPlan(actor,input);await audit(pool,principal,'mcp.school_plan_read','school_plan',plan.id);return toolResult({plan});
      });
      server.registerTool('school.plans.upsert',{description:'Create or update a school plan from one exact approved source.',inputSchema:schoolPlanUpsertSchema,scopeChallenge:requireScopes('mcp:school-plans:write'),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(input)=>{
        const actor=(await this.schoolActors(principal,input.sourceId))[0]!,result=await upsertSchoolPlan(actor,input);await audit(pool,principal,'mcp.school_plan_upserted','school_plan',result.id);return toolResult({result});
      });
      server.registerTool('school.plans.source_failure',{description:'Record a failed source check without deleting the last valid school plan.',inputSchema:schoolPlanSourceFailureSchema,scopeChallenge:requireScopes('mcp:school-plans:write'),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(input)=>{
        const actor=(await this.schoolActors(principal,input.sourceId))[0]!,result=await recordSchoolPlanSourceFailure(actor,input);await audit(pool,principal,'mcp.school_source_failure_recorded','school_plan',result.id);return toolResult({result});
      });
      server.registerTool('school.plans.verify_pdf',{description:'Fetch and store a bounded PDF only after verifying its exact link on the approved class page.',inputSchema:schoolPlanVerifyPdfSchema,scopeChallenge:requireScopes('mcp:school-plans:write'),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},async(input)=>{
        await this.schoolPdfRateLimit(principal.grantId,input.sourceId);const actor=(await this.schoolActors(principal,input.sourceId))[0]!,result=await verifySchoolPlanPdf(actor,input,this.schoolPdf);await audit(pool,principal,'mcp.school_pdf_verified','school_plan_source',input.sourceId);return toolResult({result});
      });
    }
    return server;
  }
}

export function oauthErrorBody(error:OAuthProtocolError):Record<string,string>{return{error:error.oauthError,error_description:error.description};}
