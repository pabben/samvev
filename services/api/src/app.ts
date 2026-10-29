import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Writable } from 'node:stream';
import type pg from 'pg';
import { ZodError, type ZodType } from 'zod';
import {
  accountStatusUpdateSchema, claimSchema, displayActionPolicyUpdateSchema, displayMessageCreateSchema, displayPreviewSelectionSchema, displaySetupCreateSchema, displaySetupPreviewSchema, displaySetupUpdateSchema, displayUpdateSchema, householdSettingsUpdateSchema,
  invitationAcceptSchema, invitationReissueSchema, loginSchema, membershipUpdateSchema, messageCreateSchema,
  messageUpdateSchema, pairingApproveSchema, pairingRedeemSchema, pairingStartSchema, displayReconnectApproveSchema, displayDisconnectSchema,
  passwordChangeSchema, personAccountCreateSchema, personCreateSchema, personUpdateSchema, personPhotoUploadSchema, personPhotoRevisionSchema, preferencesSchema, renderAckSchema, roleCapabilityPresets,
  aiConnectionTestSchema, aiSettingsUpdateSchema,aiChatGptImportSchema,aiChatGptDisconnectSchema,aiChatGptSelectSchema,aiUsageQuerySchema,
  monitorResultReviewSchema, monitorTaskCreateSchema, monitorTaskQualitySchema, monitorTaskRevisionSchema, monitorTaskSubjectsSchema, monitorTaskUpdateSchema,
  integrationConnectionCreateSchema, integrationConnectionRevisionSchema, integrationConnectionUpdateSchema,
  integrationCredentialCreateSchema, integrationCredentialRevokeSchema, integrationItemUpsertSchema, integrationItemWithdrawSchema,
  calendarConnectionCreateSchema,calendarConnectionRevisionSchema,calendarSyncScheduleSchema,calendarOAuthCompleteSchema,calendarPreviewSchema,calendarSourceUpdateSchema,calendarProviderConfigurationSchema,calendarSourceRefreshSchema,calendarIcsUrlUpdateSchema,
  temperatureSensorDiscoverySchema,temperatureSensorSelectSchema,temperatureSensorUpdateSchema,temperatureSensorRevisionSchema,
  homeAssistantControlDiscoverySchema,homeAssistantControlSelectSchema,homeAssistantControlGrantSchema,homeAssistantControlRevisionSchema,homeAssistantControlDispatchSchema,
  groceryCreateSchema,groceryUpdateSchema,groceryDeleteSchema,dinnerOptionCreateSchema,dinnerOptionUpdateSchema,dinnerAssignmentSchema,displayBoardReadGrantSchema,
  installationPublicContactUpdateSchema,
  mediaAlbumCreateSchema,mediaAlbumUpdateSchema,mediaAlbumGrantSchema,mediaDisplayGrantSchema,mediaAssetUploadSchema,mediaAssetUpdateSchema,mediaAssetReplaceSchema,mediaAssetDeleteSchema,mediaBackgroundUpdateSchema,
  integrationCapabilities,
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
import { MonitorExecutionQueue } from './monitor/execution.ts';
import type { MonitorSourceFetcher } from './monitor/source-fetcher.ts';
import type { MetWeatherClient } from './monitor/weather.ts';
import { ageOnDate, birthdaysDueSoon, deriveAgeGroup, localDateInTimezone, nextBirthday } from './people/domain.ts';
import { assignPersonColor } from './people/person-colors.ts';
import { normalizeProfilePhoto } from './people/photo.ts';
import { schoolProvenanceJoins, schoolProvenanceColumns, schoolProjectionMetadata, type SchoolProvenanceRow } from './monitor/school-projection.ts';
import { schoolHasPracticalActionsSql } from './monitor/practical-actions.ts';
import { personMonitorSummaries, replaceMonitorSubjects, reviewMonitorResult } from './monitor/subjects.ts';
import { monitorPresentationUpdateSchema, updateMonitorPresentation } from './monitor/presentation.ts';
import { liveE2eAttestation, liveE2eExecutionEvidence } from './e2e/live-e2e.ts';
import { applyBrowserSecurityHeaders, browserSecurityHeaders } from './browser-security.ts';
import { CalendarService,type CalendarTransport } from './calendar/service.ts';
import { AiCredentialVault } from './ai/credential-vault.ts';
import { HouseholdBoardService, type BoardActor, type BoardKind } from './household-board/service.ts';
import {MediaService,mediaService,validateDisplaySetupMediaSelection,type MediaMemberActor} from './media/service.ts';
import {normalizeMediaImage} from './media/image.ts';
import {HomeAssistantControlService,type HomeAssistantControlActor} from './home-assistant/control-service.ts';
import {HomeAssistantControlClient,type HomeAssistantControlTransport} from './home-assistant/control-client.ts';
import {readAnonymousPublicContact,readPublicContact,updatePublicContact} from './public-contact.ts';

const SESSION_COOKIE = 'samvev_session';
const DISPLAY_COOKIE = 'samvev_display';
const CSRF_COOKIE = 'samvev_csrf';
const SESSION_SECONDS = 12 * 60 * 60;
const DISPLAY_SECONDS = 90 * 24 * 60 * 60;
const elevatedCapabilities = new Set<Capability>(['installation.manage','household.manage','people.manage','account.manage','capability.manage','message.manage.household','display.manage']);

interface AuthContext {
  accountId: string;
  sessionId: string;
  installationId: string;
  membershipId: string;
  householdId: string;
  personId: string;
  rolePreset: string;
  capabilities: Capability[];
}

interface DisplayContext {
  id: string;
  credentialHash:string;
  credentialGeneration:number;
  policyFingerprint?:string;
  itemWitnesses?:Map<string,DisplayItemWitness>;
  messageWitnesses?:Map<string,{id:string;hash:string}>;
  schoolWitnesses?:Map<string,DisplaySchoolWitness>;
  birthdayMode:'off'|'all'|'legacy_selected';
  personIdsOverride:string[]|null;
  setupPersonIds:string[];
  setupLocale:'en'|'nb';
  setupTheme:'light'|'dark'|'system';
  setupName:string;
  name: string;
  householdId: string;
  locale: 'en' | 'nb';
  theme: 'light' | 'dark' | 'system';
  localeOverride: 'en' | 'nb' | null;
  themeOverride: 'light' | 'dark' | 'system' | null;
  privacyMode: boolean;
  externalItemsEnabled: boolean;
  setupId: string;
  cards: string[];
  cardOrder: string[];
  familyLayoutEnabled: boolean;
  allSources: boolean;
  allSensors: boolean;
  selectedPersonIds: string[];
  grantedPersonIds: string[];
  profilePersonIds: string[];
  birthdayPersonIds: string[];
  sourceIds: string[];
  calendarSourceIds: string[];
  sensorIds: string[];
  albumIds: string[];
  backgroundId: string | null;
}
type IntegrationCapability = (typeof integrationCapabilities)[number];
interface IntegrationContext {
  credentialId: string;
  credentialRevision: number;
  connectionId: string;
  householdId: string;
  installationId: string;
  capabilities: IntegrationCapability[];
}

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new DomainError('VALIDATION_FAILED', 400, { fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) });
  return result.data;
}

function isUnsafe(method: string): boolean { return !['GET', 'HEAD', 'OPTIONS'].includes(method); }

function safeRequestLog(request:{method?:string;routeOptions?:{url?:string};id?:string}):Record<string,unknown>{
  return {method:request.method,route:request.routeOptions?.url??'unmatched',requestId:request.id};
}

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

async function operationRateLimit(request:FastifyRequest,auth:AuthContext,bucket:string,limits:{account:number;household:number;ip:number;windowSeconds:number}):Promise<void>{
  await durableRateLimit(`${bucket}_account`,auth.accountId,limits.account,limits.windowSeconds);
  await durableRateLimit(`${bucket}_household`,auth.householdId,limits.household,limits.windowSeconds);
  await durableRateLimit(`${bucket}_ip`,request.ip,limits.ip,limits.windowSeconds);
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

async function sessionAccount(request: FastifyRequest): Promise<{ accountId: string; sessionId:string; installationId: string; csrfHash: string; tokenHash: string }> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw new DomainError('UNAUTHENTICATED', 401);
  const hash = tokenHash(token);
  const result = await pool.query<{ id:string;account_id: string; installation_id: string; csrf_hash: string }>(`
    SELECT s.id,s.account_id,a.installation_id,s.csrf_hash FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.disabled_at IS NULL`, [hash]);
  const row = result.rows[0];
  if (!row) throw new DomainError('UNAUTHENTICATED', 401);
  if (isUnsafe(request.method)) {
    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || tokenHash(csrf) !== row.csrf_hash) throw new DomainError('CSRF_REQUIRED', 403);
  }
  await pool.query('UPDATE sessions SET last_seen_at=clock_timestamp() WHERE token_hash=$1', [hash]);
  return { accountId: row.account_id,sessionId:row.id, installationId: row.installation_id, csrfHash: row.csrf_hash, tokenHash: hash };
}

async function authForHousehold(request: FastifyRequest, householdId: string): Promise<AuthContext> {
  const account = await sessionAccount(request);
  const result = await pool.query<{
    id: string; household_id: string; person_id: string; role_preset: string; capabilities: Capability[];
  }>(`SELECT id,household_id,person_id,role_preset,capabilities FROM memberships WHERE household_id=$1 AND account_id=$2`, [householdId, account.accountId]);
  const row = result.rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 404);
  return { accountId: account.accountId,sessionId:account.sessionId, installationId: account.installationId, membershipId: row.id, householdId: row.household_id, personId: row.person_id, rolePreset: row.role_preset, capabilities: row.capabilities };
}

async function recheckHouseholdAuth(client:DbClient,request:FastifyRequest,auth:AuthContext,capability:Capability):Promise<void>{
  const row=(await client.query<{capabilities:Capability[];csrf_hash:string}>(`SELECT membership.capabilities,session.csrf_hash
    FROM sessions session JOIN accounts account ON account.id=session.account_id
    JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$2
    WHERE session.id=$1 AND session.account_id=$3 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp() AND account.disabled_at IS NULL
      AND membership.id=$4
    FOR UPDATE OF session,account,membership`,[auth.sessionId,auth.householdId,auth.accountId,auth.membershipId])).rows[0];
  if(!row)throw new DomainError('UNAUTHENTICATED',401);
  if(isUnsafe(request.method)){const csrf=request.headers['x-csrf-token'];if(typeof csrf!=='string'||tokenHash(csrf)!==row.csrf_hash)throw new DomainError('CSRF_REQUIRED',403);}
  requireCapability(row.capabilities,capability);
}

async function recheckPersonPhotoAuth(client:DbClient,request:FastifyRequest,auth:AuthContext,personId:string,lock=true):Promise<void>{
  // Account/membership management takes installation before actor rows. Pin
  // that parent first so the photo audit FK cannot invert those locks.
  if(lock)await client.query('SELECT id FROM installations WHERE id=$1 FOR KEY SHARE',[auth.installationId]);
  const row=(await client.query<{person_id:string;capabilities:Capability[];csrf_hash:string}>(`SELECT membership.person_id,membership.capabilities,session.csrf_hash
    FROM sessions session JOIN accounts account ON account.id=session.account_id
    JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$2
    WHERE session.id=$1 AND session.account_id=$3 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
      AND account.disabled_at IS NULL AND membership.id=$4
    ${lock?'FOR KEY SHARE OF session FOR SHARE OF account,membership':''}`,[auth.sessionId,auth.householdId,auth.accountId,auth.membershipId])).rows[0];
  if(!row)throw new DomainError('UNAUTHENTICATED',401);
  const csrf=request.headers['x-csrf-token'];if(typeof csrf!=='string'||tokenHash(csrf)!==row.csrf_hash)throw new DomainError('CSRF_REQUIRED',403);
  if(row.person_id!==personId)requireCapability(row.capabilities,'people.manage');
}

async function authForInstallation(request:FastifyRequest,installationId:string):Promise<AuthContext>{
  const account=await sessionAccount(request);if(account.installationId!==installationId)throw new DomainError('NOT_FOUND',404);
  const row=(await pool.query<{id:string;household_id:string;person_id:string;role_preset:string;capabilities:Capability[]}>(`SELECT membership.id,membership.household_id,membership.person_id,membership.role_preset,membership.capabilities FROM memberships membership JOIN households household ON household.id=membership.household_id AND household.installation_id=$1 JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult' WHERE membership.account_id=$2 AND membership.capabilities ? 'installation.manage' ORDER BY membership.id LIMIT 1`,[installationId,account.accountId])).rows[0];
  if(!row)throw new DomainError('FORBIDDEN',403);return{accountId:account.accountId,sessionId:account.sessionId,installationId,membershipId:row.id,householdId:row.household_id,personId:row.person_id,rolePreset:row.role_preset,capabilities:row.capabilities};
}

interface DisplaySelections {
  people:string[];grants:{person_id:string;profile_allowed:boolean;birthday_allowed:boolean}[];
  sources:string[];calendarSources:string[];sensors:string[];selectedPeople:string[];
}

interface DisplayContextRow {
  selections?:DisplaySelections;policy_fingerprint?:string;
  id:string;name:string;household_id:string;locale:'en'|'nb';theme:'light'|'dark'|'system';locale_override:'en'|'nb'|null;theme_override:'light'|'dark'|'system'|null;
  credential_generation:number;birthday_mode:'off'|'all'|'legacy_selected';person_ids_override:string[]|null;setup_locale:'en'|'nb';setup_theme:'light'|'dark'|'system';setup_name:string;
  privacy_mode:boolean;external_items_enabled:boolean;setup_id:string;cards:string[];card_order:string[];family_layout_enabled:boolean;all_sources:boolean;all_sensors:boolean;album_ids:string[];background_id:string|null;
}

async function displayContextFromRow(row:DisplayContextRow,credentialHash:string,touchLastSeen:boolean,db:DbClient=pool,lockGrants=false):Promise<DisplayContext>{
  if(touchLastSeen)await db.query('UPDATE displays SET last_seen_at=clock_timestamp() WHERE id=$1',[row.id]);
  const [people,grants,sources,calendarSources,sensors]=row.selections?[
    {rows:row.selections.people.map(person_id=>({person_id}))},{rows:row.selections.grants},
    {rows:row.selections.sources.map(connection_id=>({connection_id}))},{rows:row.selections.calendarSources.map(source_id=>({source_id}))},
    {rows:row.selections.sensors.map(sensor_id=>({sensor_id}))}
  ]:await Promise.all([
    db.query<{person_id:string}>(`SELECT person_id FROM display_setup_people WHERE household_id=$1 AND setup_id=$2 ORDER BY person_id${lockGrants?' FOR SHARE':''}`,[row.household_id,row.setup_id]),
    db.query<{person_id:string;profile_allowed:boolean;birthday_allowed:boolean}>(`SELECT person_id,profile_allowed,birthday_allowed FROM display_person_grants WHERE household_id=$1 AND display_id=$2 ORDER BY person_id${lockGrants?' FOR SHARE':''}`,[row.household_id,row.id]),
    db.query<{connection_id:string}>(`SELECT connection_id FROM display_setup_sources WHERE household_id=$1 AND setup_id=$2 ORDER BY connection_id${lockGrants?' FOR SHARE':''}`,[row.household_id,row.setup_id]),
    db.query<{source_id:string}>(`SELECT source_id FROM display_setup_calendar_sources WHERE household_id=$1 AND setup_id=$2 ORDER BY source_id${lockGrants?' FOR SHARE':''}`,[row.household_id,row.setup_id]),
    db.query<{sensor_id:string}>(`SELECT sensor_id FROM display_setup_sensors WHERE household_id=$1 AND setup_id=$2 ORDER BY sensor_id${lockGrants?' FOR SHARE':''}`,[row.household_id,row.setup_id])
  ]);
  const setupPersonIds=people.rows.map((item)=>item.person_id);
  const selectedPersonIds=row.selections?row.selections.selectedPeople:row.person_ids_override===null?setupPersonIds:(await db.query<{id:string}>('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[row.household_id,row.person_ids_override])).rows.map((person)=>person.id);
  return {
    id: row.id,credentialHash,credentialGeneration:row.credential_generation,policyFingerprint:row.policy_fingerprint,birthdayMode:row.birthday_mode,personIdsOverride:row.person_ids_override,setupPersonIds,setupLocale:row.setup_locale,setupTheme:row.setup_theme,setupName:row.setup_name,name:row.name, householdId: row.household_id, locale: row.locale, theme: row.theme,
    localeOverride:row.locale_override,themeOverride:row.theme_override,
    privacyMode: row.privacy_mode, externalItemsEnabled: row.external_items_enabled,
    setupId:row.setup_id,cards:row.cards,cardOrder:row.card_order,familyLayoutEnabled:row.family_layout_enabled,
    allSources:row.all_sources,allSensors:row.all_sensors,selectedPersonIds,grantedPersonIds:grants.rows.map((item)=>item.person_id),
    profilePersonIds:grants.rows.filter((item)=>item.profile_allowed).map((item)=>item.person_id),birthdayPersonIds:grants.rows.filter((item)=>item.birthday_allowed).map((item)=>item.person_id),
    sourceIds:sources.rows.map((item)=>item.connection_id),calendarSourceIds:calendarSources.rows.map((item)=>item.source_id),sensorIds:sensors.rows.map((item)=>item.sensor_id),
    albumIds:row.album_ids,backgroundId:row.background_id
  };
}

// This expression is shared by authentication and the final read fence. Each
// execution is ONE PostgreSQL statement snapshot, including the selections used
// to construct DisplayContext. Do not include last_seen_at or delivery progress:
// this request legitimately updates those without changing authorization.
const policyRows=(table:string,fields:string,where:string,order:string)=>
  `COALESCE((SELECT jsonb_agg(${fields} ORDER BY ${order}) FROM ${table} policy WHERE policy.household_id=d.household_id AND (${where})), '[]'::jsonb)`;
const displaySelectionsSql=`jsonb_build_object(
  'people',${policyRows('display_setup_people','to_jsonb(policy.person_id)','policy.setup_id=s.id','policy.person_id')},
  'grants',${policyRows('display_person_grants',"jsonb_build_object('person_id',policy.person_id,'profile_allowed',policy.profile_allowed,'birthday_allowed',policy.birthday_allowed)",'policy.display_id=d.id','policy.person_id')},
  'sources',${policyRows('display_setup_sources','to_jsonb(policy.connection_id)','policy.setup_id=s.id','policy.connection_id')},
  'calendarSources',${policyRows('display_setup_calendar_sources','to_jsonb(policy.source_id)','policy.setup_id=s.id','policy.source_id')},
  'sensors',${policyRows('display_setup_sensors','to_jsonb(policy.sensor_id)','policy.setup_id=s.id','policy.sensor_id')},
  'selectedPeople',COALESCE((SELECT jsonb_agg(person.id ORDER BY person.id) FROM persons person WHERE person.household_id=d.household_id
    AND (CASE WHEN d.person_ids_override IS NULL THEN EXISTS(SELECT 1 FROM display_setup_people selected WHERE selected.household_id=d.household_id AND selected.setup_id=s.id AND selected.person_id=person.id) ELSE person.id=ANY(d.person_ids_override) END)), '[]'::jsonb))`;
const displayPolicySql=`jsonb_build_object(
  'device',jsonb_build_array(d.name,d.locale,d.theme,d.privacy_mode,d.external_items_enabled,d.setup_id,d.birthday_mode,d.person_ids_override),
  'setup',to_jsonb(s),'selections',selection.value,
  'household',(SELECT jsonb_build_array(h.name,h.timezone,h.default_locale,h.show_upcoming_birthday) FROM households h WHERE h.id=d.household_id),
  'connectionGrants',${policyRows('integration_connection_display_grants','to_jsonb(policy)','policy.display_id=d.id','policy.connection_id')},
  'connections',${policyRows('integration_connections','jsonb_build_array(policy.id,policy.revoked_at)','EXISTS(SELECT 1 FROM integration_connection_display_grants g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.connection_id=policy.id)','policy.id')},
  'calendarGrants',${policyRows('calendar_source_display_targets','to_jsonb(policy)','policy.display_id=d.id','policy.source_id')},
  'calendarSources',${policyRows('calendar_sources','jsonb_build_array(policy.id,policy.connection_id,policy.enabled,policy.subject_household)','EXISTS(SELECT 1 FROM calendar_source_display_targets g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.source_id=policy.id)','policy.id')},
  'calendarSubjects',${policyRows('calendar_source_person_subjects','to_jsonb(policy)','EXISTS(SELECT 1 FROM calendar_source_display_targets g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.source_id=policy.source_id)','policy.source_id,policy.person_id')},
  'calendarConnections',${policyRows('calendar_connections',`jsonb_build_array(policy.id,policy.disconnected_at,policy.owner_account_id,
    (SELECT jsonb_build_array(a.disabled_at,m.capabilities,p.age_group) FROM accounts a JOIN memberships m ON m.account_id=a.id AND m.household_id=d.household_id JOIN persons p ON p.id=m.person_id AND p.household_id=m.household_id WHERE a.id=policy.owner_account_id))`,'EXISTS(SELECT 1 FROM integration_connection_display_grants g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.connection_id=policy.integration_connection_id)','policy.id')},
  'sensorGrants',${policyRows('home_assistant_temperature_display_targets','to_jsonb(policy)','policy.display_id=d.id','policy.sensor_id')},
  'sensors',${policyRows('home_assistant_temperature_sensors','jsonb_build_array(policy.id,policy.connection_id,policy.enabled,policy.target_household)','EXISTS(SELECT 1 FROM home_assistant_temperature_display_targets g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.sensor_id=policy.id)','policy.id')},
  'sensorPeople',${policyRows('home_assistant_temperature_person_readers','to_jsonb(policy)','EXISTS(SELECT 1 FROM home_assistant_temperature_display_targets g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.sensor_id=policy.sensor_id)','policy.sensor_id,policy.person_id')},
  'boardGrants',${policyRows('display_board_read_grants','to_jsonb(policy)','policy.display_id=d.id','policy.display_id')},
  'actionPolicy',${policyRows('display_action_policies','to_jsonb(policy)','policy.display_id=d.id','policy.display_id')},
  'actionPeople',${policyRows('display_action_people','to_jsonb(policy)','policy.display_id=d.id','policy.person_id')},
  'actionDisplays',${policyRows('display_action_displays',`jsonb_build_array(policy.recipient_display_id,(SELECT jsonb_build_array(recipient.revoked_at,recipient.credential_expires_at) FROM displays recipient WHERE recipient.id=policy.recipient_display_id AND recipient.household_id=d.household_id))`,'policy.display_id=d.id','policy.recipient_display_id')},
  'mediaGrants',${policyRows('media_album_display_grants','to_jsonb(policy)','policy.display_id=d.id','policy.album_id')},
  'mediaSettings',${policyRows('media_household_settings','to_jsonb(policy)','true','policy.household_id')},
  'controlGrants',${policyRows('home_assistant_control_display_grants','to_jsonb(policy)','policy.display_id=d.id','policy.entity_id')},
  'controlEntities',${policyRows('home_assistant_control_entities','jsonb_build_array(policy.id,policy.connection_id,policy.selected,policy.supported_actions)','EXISTS(SELECT 1 FROM home_assistant_control_display_grants g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.entity_id=policy.id)','policy.id')})`;
const displayPolicyJoins=`JOIN display_setups s ON s.id=d.setup_id AND s.household_id=d.household_id
  CROSS JOIN LATERAL (SELECT ${displaySelectionsSql} AS value) selection
  CROSS JOIN LATERAL (SELECT encode(digest((${displayPolicySql})::text,'sha256'),'hex') AS fingerprint) policy`;
const displayResponseFences=new WeakMap<FastifyRequest,DisplayContext>();
interface DisplayItemWitness {id:string;sensor_id:string|null;hash:string;}
// Captured by each bounded item SELECT, never inferred later from returned IDs.
// The same expression is probed by item PK at the final response snapshot.
function displayItemWitnessSql(displayId:string,people:string,sources:string,sensorId='NULL::uuid'):string{
  return `encode(digest(jsonb_build_array(i.connection_id,i.target_household,i.metadata->'calendar',
    i.status='active' AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp()) AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp()),
    (SELECT connection.revoked_at IS NULL FROM integration_connections connection WHERE connection.id=i.connection_id AND connection.household_id=i.household_id),
    EXISTS(SELECT 1 FROM integration_connection_display_grants witness_connection WHERE witness_connection.connection_id=i.connection_id AND witness_connection.display_id=${displayId} AND witness_connection.household_id=i.household_id),
    EXISTS(SELECT 1 FROM integration_item_display_targets witness_target WHERE witness_target.item_id=i.id AND witness_target.display_id=${displayId} AND witness_target.household_id=i.household_id),
    COALESCE((SELECT jsonb_agg(witness_person.person_id ORDER BY witness_person.person_id) FROM integration_item_person_targets witness_person WHERE witness_person.item_id=i.id AND witness_person.person_id=ANY(${people}::uuid[]) AND witness_person.household_id=i.household_id),'[]'::jsonb),
    COALESCE((SELECT jsonb_agg(witness_subject.person_id ORDER BY witness_subject.person_id) FROM integration_item_person_subjects witness_subject WHERE witness_subject.item_id=i.id AND witness_subject.person_id=ANY(${people}::uuid[]) AND witness_subject.household_id=i.household_id),'[]'::jsonb),
    EXISTS(SELECT 1 FROM calendar_occurrences witness_occurrence WHERE witness_occurrence.integration_item_id=i.id),
    EXISTS(SELECT 1 FROM calendar_occurrences witness_occurrence WHERE witness_occurrence.integration_item_id=i.id AND witness_occurrence.source_id=ANY(${sources}::uuid[])),
    (SELECT jsonb_build_array(witness_sensor.id,witness_sensor.connection_id,witness_sensor.integration_item_id,witness_sensor.enabled,witness_sensor.target_household,
      EXISTS(SELECT 1 FROM home_assistant_temperature_display_targets witness_sensor_target WHERE witness_sensor_target.sensor_id=witness_sensor.id AND witness_sensor_target.display_id=${displayId} AND witness_sensor_target.household_id=i.household_id),
      COALESCE((SELECT jsonb_agg(reader.person_id ORDER BY reader.person_id) FROM home_assistant_temperature_person_readers reader WHERE reader.sensor_id=witness_sensor.id AND reader.person_id=ANY(${people}::uuid[]) AND reader.household_id=i.household_id),'[]'::jsonb),
      (SELECT jsonb_build_array(calendar.provider,calendar.disconnected_at,
        EXISTS(SELECT 1 FROM memberships owner JOIN persons owner_person ON owner_person.id=owner.person_id AND owner_person.household_id=owner.household_id AND owner_person.age_group='adult' JOIN accounts owner_account ON owner_account.id=owner.account_id AND owner_account.disabled_at IS NULL WHERE owner.account_id=calendar.owner_account_id AND owner.household_id=calendar.household_id AND owner.capabilities ? 'household.view'))
       FROM calendar_connections calendar WHERE calendar.id=witness_sensor.connection_id AND calendar.household_id=i.household_id))
      FROM home_assistant_temperature_sensors witness_sensor WHERE witness_sensor.id=${sensorId} AND witness_sensor.household_id=i.household_id)
    )::text,'sha256'),'hex')`;
}
function rememberDisplayItems(display:DisplayContext,rows:ExternalItemRow[]):void{
  if(!display.itemWitnesses)return;
  for(const row of rows){
    if(!row.acl_witness)throw new DomainError('CONFLICT',409);
    const witness:DisplayItemWitness={id:row.id,sensor_id:row.acl_sensor_id??null,hash:row.acl_witness};
    const key=`${witness.id}:${witness.sensor_id??''}`,previous=display.itemWitnesses.get(key);
    if(previous&&previous.hash!==witness.hash)throw new DomainError('CONFLICT',409);
    display.itemWitnesses.set(key,witness);
    // One hub response is <=200 ordinary +2000 temperature items. Photo
    // rechecks share this cap; policy churn never expands a request unboundedly.
    if(display.itemWitnesses.size>2200)throw new DomainError('CONFLICT',409);
  }
}
const DISPLAY_MESSAGE_CARD_LIMIT=200;
function displayMessageWitnessSql(displayId:string,people:string,alias='msg'):string{
  return `encode(digest(jsonb_build_array(msg.author_membership_id,msg.audience_household,msg.state,msg.revision,
    msg.state='published' AND msg.publish_at<=clock_timestamp() AND msg.expires_at>clock_timestamp(),
    (SELECT author.person_id FROM memberships author WHERE author.id=msg.author_membership_id AND author.household_id=msg.household_id),
    EXISTS(SELECT 1 FROM message_display_targets target WHERE target.message_id=msg.id AND target.display_id=${displayId} AND target.household_id=msg.household_id AND target.delivery_state IN ('queued','delivered','displayed')),
    EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=msg.id),
    COALESCE((SELECT jsonb_agg(audience.person_id ORDER BY audience.person_id) FROM message_person_audiences audience WHERE audience.message_id=msg.id AND audience.person_id=ANY(${people}::uuid[])),'[]'::jsonb)
    )::text,'sha256'),'hex')`.replaceAll('msg.',`${alias}.`);
}
function rememberDisplayMessages(display:DisplayContext,rows:{id:string;acl_witness?:string}[]):void{
  if(!display.messageWitnesses)return;
  for(const row of rows){
    if(!row.acl_witness)throw new DomainError('CONFLICT',409);
    const previous=display.messageWitnesses.get(row.id);
    if(previous&&previous.hash!==row.acl_witness)throw new DomainError('CONFLICT',409);
    display.messageWitnesses.set(row.id,{id:row.id,hash:row.acl_witness});
    if(display.messageWitnesses.size>DISPLAY_MESSAGE_CARD_LIMIT+3)throw new DomainError('CONFLICT',409);
  }
}
interface DisplaySchoolWitness {id:string;people:string[];audience_people:string[];current:boolean;hash:string;}
function displaySchoolWitnessSql(displayId:string,people:string,audiencePeople:string,current:string):string{
  return `encode(digest(jsonb_build_array(event.task_id,event.message_id,event.active,event.actions,event.school_expires_at,
    task.owner_membership_id,task.state,task.revision,task.approved_revision,task.presentation_kind,
    ${schoolTaskAuthorized},
    COALESCE((SELECT jsonb_agg(school_subject.person_id ORDER BY school_subject.person_id) FROM monitor_task_subjects school_subject WHERE school_subject.task_id=task.id AND school_subject.household_id=task.household_id AND school_subject.person_id=ANY(${people}::uuid[])),'[]'::jsonb),
    ${displayMessageWitnessSql(displayId,audiencePeople,'message')},
    CASE WHEN ${current} THEN event.school_expires_at>clock_timestamp() AND message.expires_at>clock_timestamp() AND message.state IN ('scheduled','published') ELSE true END
    )::text,'sha256'),'hex')`;
}
function rememberDisplaySchools(display:DisplayContext,rows:SchoolActivityRow[],people:string[],audiencePeople:string[],current:boolean):void{
  if(!display.schoolWitnesses)return;
  for(const row of rows){
    if(!row.acl_witness)throw new DomainError('CONFLICT',409);
    const witness={id:row.id,people,audience_people:audiencePeople,current,hash:row.acl_witness};
    const key=JSON.stringify([row.id,people,audiencePeople,current]),previous=display.schoolWitnesses.get(key);
    if(previous&&previous.hash!==witness.hash)throw new DomainError('CONFLICT',409);
    display.schoolWitnesses.set(key,witness);
    if(display.schoolWitnesses.size>50)throw new DomainError('CONFLICT',409);
  }
}
async function assertDisplayCredential(display:DisplayContext,checkPolicy=false,db:DbClient=pool):Promise<void>{
  const row=(await db.query<{policy_fingerprint?:string;item_policy_valid?:boolean;message_policy_valid?:boolean;school_policy_valid?:boolean}>(`SELECT ${checkPolicy?`policy.fingerprint AS policy_fingerprint,
      NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($5::jsonb) witness(id uuid,sensor_id uuid,hash text)
        LEFT JOIN LATERAL (SELECT ${displayItemWitnessSql('d.id','$6','$7','witness.sensor_id')} AS hash
          FROM integration_items i WHERE i.id=witness.id AND i.household_id=d.household_id LIMIT 1) current_item ON true
        WHERE current_item.hash IS DISTINCT FROM witness.hash) AS item_policy_valid,
      NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($8::jsonb) witness(id uuid,hash text)
        LEFT JOIN LATERAL (SELECT ${displayMessageWitnessSql('d.id','$6')} AS hash FROM messages msg WHERE msg.id=witness.id AND msg.household_id=d.household_id LIMIT 1) current_message ON true
        WHERE current_message.hash IS DISTINCT FROM witness.hash) AS message_policy_valid,
      NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($9::jsonb) witness(id uuid,people uuid[],audience_people uuid[],current boolean,hash text)
        LEFT JOIN LATERAL (SELECT ${displaySchoolWitnessSql('d.id','witness.people','witness.audience_people','witness.current')} AS hash
          FROM monitor_events event JOIN monitor_tasks task ON task.id=event.task_id AND task.household_id=event.household_id
          JOIN messages message ON message.id=event.message_id AND message.household_id=event.household_id
          WHERE event.id=witness.id AND event.household_id=d.household_id LIMIT 1) current_school ON true
        WHERE current_school.hash IS DISTINCT FROM witness.hash) AS school_policy_valid`:'d.id'} FROM displays d
    ${checkPolicy?displayPolicyJoins:''}
    WHERE d.id=$1 AND d.household_id=$2 AND d.credential_hash=$3 AND d.credential_generation=$4
      AND d.revoked_at IS NULL AND d.credential_expires_at>clock_timestamp()`,[display.id,display.householdId,display.credentialHash,display.credentialGeneration,
        ...(checkPolicy?[JSON.stringify([...display.itemWitnesses?.values()??[]]),display.selectedPersonIds,display.calendarSourceIds,JSON.stringify([...display.messageWitnesses?.values()??[]]),JSON.stringify([...display.schoolWitnesses?.values()??[]])]:[])])).rows[0];
  if(!row)throw new DomainError('UNAUTHENTICATED',401);
  if(checkPolicy&&(!display.policyFingerprint||row.policy_fingerprint!==display.policyFingerprint||!row.item_policy_valid||!row.message_policy_valid||!row.school_policy_valid))throw new DomainError('CONFLICT',409);
}

async function displayAuth(request: FastifyRequest): Promise<DisplayContext> {
  const token=request.cookies[DISPLAY_COOKIE];if(!token)throw new DomainError('UNAUTHENTICATED',401);
  const result=await pool.query<DisplayContextRow>(`SELECT d.id,d.name,d.household_id,COALESCE(d.locale,s.locale) AS locale,COALESCE(d.theme,s.theme) AS theme,
      d.locale AS locale_override,d.theme AS theme_override,d.credential_generation,d.birthday_mode,d.person_ids_override,s.locale AS setup_locale,s.theme AS setup_theme,s.name AS setup_name,d.privacy_mode,d.external_items_enabled,d.setup_id,s.cards,s.card_order,s.family_layout_enabled,s.all_sources,s.all_sensors,s.album_ids,s.background_id,
      selection.value AS selections,policy.fingerprint AS policy_fingerprint
    FROM displays d ${displayPolicyJoins}
    WHERE d.credential_hash=$1 AND d.revoked_at IS NULL AND d.credential_expires_at>clock_timestamp()`,[tokenHash(token)]);
  const row=result.rows[0];if(!row)throw new DomainError('UNAUTHENTICATED',401);
  const context=await displayContextFromRow(row,tokenHash(token),true);
  context.itemWitnesses=new Map();context.messageWitnesses=new Map();context.schoolWitnesses=new Map();displayResponseFences.set(request,context);return context;
}

async function displayContextForManager(householdId:string,displayId:string,db:DbClient=pool,lock=false,lockGrants=false):Promise<DisplayContext>{
  const row=(await db.query<DisplayContextRow&{credential_hash:string}>(`SELECT d.id,d.name,d.household_id,d.credential_hash,COALESCE(d.locale,s.locale) AS locale,COALESCE(d.theme,s.theme) AS theme,
      d.locale AS locale_override,d.theme AS theme_override,d.credential_generation,d.birthday_mode,d.person_ids_override,s.locale AS setup_locale,s.theme AS setup_theme,s.name AS setup_name,d.privacy_mode,d.external_items_enabled,d.setup_id,s.cards,s.card_order,s.family_layout_enabled,s.all_sources,s.all_sensors,s.album_ids,s.background_id
      ,selection.value AS selections,policy.fingerprint AS policy_fingerprint
    FROM displays d ${displayPolicyJoins}
    WHERE d.id=$1 AND d.household_id=$2 AND d.revoked_at IS NULL AND d.credential_expires_at>clock_timestamp()${lock?' FOR SHARE OF d,s':''}`,[displayId,householdId])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);
  return displayContextFromRow(row,row.credential_hash,false,db,lockGrants);
}

function previewContextTag(display:DisplayContext):string{
  return Buffer.from(JSON.stringify({cards:display.cards,familyLayoutEnabled:display.familyLayoutEnabled,allSources:display.allSources,allSensors:display.allSensors,personIds:display.selectedPersonIds,sourceIds:display.sourceIds,calendarSourceIds:display.calendarSourceIds,sensorIds:display.sensorIds,albumIds:display.albumIds,backgroundId:display.backgroundId}),'utf8').toString('base64url');
}

function parsePreviewContextTag(value:unknown):{cards:string[];familyLayoutEnabled:boolean;allSources:boolean;allSensors:boolean;personIds:string[];sourceIds:string[];calendarSourceIds:string[];sensorIds:string[];albumIds:string[];backgroundId:string|null}{
  if(typeof value!=='string'||value.length>8192||!/^[A-Za-z0-9_-]+$/.test(value))throw new DomainError('NOT_FOUND',404);
  try{return parse(displayPreviewSelectionSchema,JSON.parse(Buffer.from(value,'base64url').toString('utf8')));}catch{throw new DomainError('NOT_FOUND',404);}
}

type DisplayActionKey='message_create'|'message_schedule'|'grocery_write'|'dinner_write'|'photo_upload'|'home_assistant_control';

async function lockDisplayAction(client:DbClient,householdId:string,displayId:string,action:DisplayActionKey):Promise<boolean> {
  const row=(await client.query<{allowed:boolean}>(`SELECT ${action} AS allowed FROM display_action_policies WHERE household_id=$1 AND display_id=$2 FOR UPDATE`,[householdId,displayId])).rows[0];
  if(!row)throw new DomainError('UNAUTHENTICATED',401);
  return row.allowed;
}

async function lockDisplayMessageActor(client:DbClient,request:FastifyRequest,display:DisplayContext,recipientDisplayIds:string[]):Promise<{id:string;householdId:string;name:string;messageSchedule:boolean}>{
  const token=request.cookies[DISPLAY_COOKIE];if(!token)throw new DomainError('UNAUTHENTICATED',401);
  if(recipientDisplayIds.includes(display.id))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_message_recipient'});
  const deviceIds=[...new Set([display.id,...recipientDisplayIds])].sort();
  const devices=(await client.query<{id:string;household_id:string;name:string;credential_hash:string|null;credential_expires_at:Date|null;revoked_at:Date|null}>(`SELECT id,household_id,name,credential_hash,credential_expires_at,revoked_at FROM displays
    WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,[display.householdId,deviceIds])).rows;
  if(devices.length!==deviceIds.length)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_message_recipient'});
  const actor=devices.find((row)=>row.id===display.id);
  if(!actor||actor.credential_hash!==tokenHash(token)||actor.revoked_at||!actor.credential_expires_at||actor.credential_expires_at<=new Date())throw new DomainError('UNAUTHENTICATED',401);
  const recipients=devices.filter((row)=>row.id!==display.id);
  if(recipients.some((row)=>row.revoked_at||!row.credential_expires_at||row.credential_expires_at<=new Date()))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_message_recipient'});
  if(!await lockDisplayAction(client,display.householdId,display.id,'message_create'))throw new DomainError('FORBIDDEN',403,{reason:'display_action_not_granted'});
  const messageSchedule=await lockDisplayAction(client,display.householdId,display.id,'message_schedule');
  return{id:actor.id,householdId:actor.household_id,name:actor.name,messageSchedule};
}

async function lockDisplayMessageRecipients(client:DbClient,display:DisplayContext,personIds:string[],displayIds:string[]):Promise<void>{
  const people=personIds.length?(await client.query<{id:string}>(`SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,[display.householdId,personIds])).rows:[];
  if(people.length!==personIds.length)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_message_recipient'});
  const allowedPeople=(await client.query<{person_id:string}>(`SELECT person_id FROM display_action_people WHERE household_id=$1 AND display_id=$2 AND person_id=ANY($3::uuid[]) ORDER BY person_id FOR SHARE`,[display.householdId,display.id,personIds])).rows;
  const allowedDisplays=(await client.query<{recipient_display_id:string}>(`SELECT recipient_display_id FROM display_action_displays WHERE household_id=$1 AND display_id=$2 AND recipient_display_id=ANY($3::uuid[]) ORDER BY recipient_display_id FOR SHARE`,[display.householdId,display.id,displayIds])).rows;
  if(allowedPeople.length!==personIds.length||allowedDisplays.length!==displayIds.length)throw new DomainError('FORBIDDEN',403,{reason:'message_recipient_not_allowed'});
}

async function integrationAuth(request: FastifyRequest): Promise<IntegrationContext> {
  await durableRateLimit('integration_auth_ip', request.ip, 90, 60);
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization) : null;
  if (!match) throw new DomainError('UNAUTHENTICATED', 401);
  const result = await pool.query<{
    credential_id:string; credential_revision:number; connection_id:string; household_id:string; installation_id:string; capabilities:IntegrationCapability[];
  }>(`SELECT cr.id AS credential_id,cr.revision AS credential_revision,cr.connection_id,c.household_id,h.installation_id,cr.capabilities
      FROM integration_credentials cr
      JOIN integration_connections c ON c.id=cr.connection_id
      JOIN households h ON h.id=c.household_id
      WHERE cr.token_hash=$1 AND cr.revoked_at IS NULL AND (cr.expires_at IS NULL OR cr.expires_at>clock_timestamp())
        AND c.revoked_at IS NULL`, [tokenHash(match[1]!)]) ;
  const row = result.rows[0];
  if (!row) {
    await durableRateLimit('integration_auth_invalid', request.ip, 20, 60);
    throw new DomainError('UNAUTHENTICATED', 401);
  }
  await pool.query('UPDATE integration_credentials SET last_used_at=clock_timestamp() WHERE id=$1', [row.credential_id]);
  return {
    credentialId: row.credential_id, credentialRevision:row.credential_revision, connectionId: row.connection_id, householdId: row.household_id,
    installationId: row.installation_id, capabilities: row.capabilities
  };
}

function requireIntegrationCapability(actual: readonly IntegrationCapability[], required: IntegrationCapability): void {
  if (!actual.includes(required)) throw new DomainError('FORBIDDEN', 403);
}

function canonicalIntegrationPayload(body: ReturnType<typeof integrationItemUpsertSchema.parse>): { hash:string; body:typeof body } {
  const normalized = {
    ...body,
    targets: {
      household: body.targets.household,
      personIds: [...body.targets.personIds].sort(),
      displayIds: [...body.targets.displayIds].sort()
    },
    publishAt: body.publishAt ? new Date(body.publishAt).toISOString() : null,
    startsAt: body.startsAt ? new Date(body.startsAt).toISOString() : null,
    endsAt: body.endsAt ? new Date(body.endsAt).toISOString() : null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null,
    source: {
      ...body.source,
      observedAt: new Date(body.source.observedAt).toISOString(),
      ...(body.source.generatedAt ? { generatedAt: new Date(body.source.generatedAt).toISOString() } : {})
    }
  };
  const { expectedRevision: _expectedRevision, ...canonical } = normalized;
  return { hash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'), body: normalized };
}

async function auditIntegration(client: DbClient, integration: IntegrationContext, action:string, subjectType:string, subjectId:string, metadata:Record<string,unknown>={}):Promise<void>{
  await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
    VALUES ($1,$2,'integration',$3,$4,$5,$6,$7)`, [integration.installationId,integration.householdId,integration.connectionId,action,subjectType,subjectId,JSON.stringify({...metadata,credentialId:integration.credentialId,credentialRevision:integration.credentialRevision})]);
}

async function lockIntegrationAuthority(client:pg.PoolClient,integration:IntegrationContext,capability:IntegrationCapability):Promise<void>{
  const connection=await client.query(`SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR UPDATE`,[integration.connectionId,integration.householdId]);
  if(!connection.rowCount)throw new DomainError('UNAUTHENTICATED',401);
  const credential=await client.query<{capabilities:IntegrationCapability[]}>(`SELECT capabilities FROM integration_credentials
    WHERE id=$1 AND connection_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR UPDATE`,[integration.credentialId,integration.connectionId]);
  if(!credential.rowCount)throw new DomainError('UNAUTHENTICATED',401);
  requireIntegrationCapability(credential.rows[0]!.capabilities,capability);
}

interface ExternalItemRow {
  id:string; external_id:string; kind:string; content_locale:'en'|'nb'|null; target_household:boolean; title:string; body:string;
  entries:Array<{label:string;detail?:string}>; priority:string; publish_at:Date|null; starts_at:Date|null;
  ends_at:Date|null; expires_at:Date|null; source:Record<string,unknown>; metadata:Record<string,unknown>;
  status:string; revision:number; updated_at:Date; person_ids:string[]; display_ids:string[];
  subject_person_ids:string[];
  calendar_connection_state:string|null; calendar_source_error_code:string|null; calendar_provider_status:string|null; calendar_owner_authorized:boolean;
  temperature_sensor_available:boolean|null;
  acl_witness?:string;acl_sensor_id?:string|null;
}

function mapExternalItem(row:ExternalItemRow,options:{includeExternalId?:boolean;forDisplay?:boolean;selectedPersonIds?:string[]}={}):Record<string,unknown>{
  const source=options.forDisplay
    ? Object.fromEntries(Object.entries(row.source).filter(([key])=>!['url','links'].includes(key)))
    : row.source;
  const metadata=options.forDisplay
    ? Object.fromEntries(Object.entries(row.metadata).filter(([key])=>key!=='actionUrl'))
    : row.metadata;
  const storedCalendar=metadata.calendar&&typeof metadata.calendar==='object'&&!Array.isArray(metadata.calendar)?metadata.calendar as Record<string,unknown>:undefined;
  const storedFreshnessReason=['sync_failed','provider_disabled','reauthorization_required','source_missing'].includes(String(storedCalendar?.freshnessReason))?String(storedCalendar?.freshnessReason):undefined;
  const calendarIsStale=storedCalendar&&row.calendar_connection_state?row.calendar_owner_authorized!==true||storedCalendar.freshness==='stale'||!['connected','syncing','error'].includes(row.calendar_connection_state):false;
  const calendarFreshness=storedCalendar&&row.calendar_connection_state?{
    freshness:calendarIsStale?'stale':'current',
    lastSuccessfulSyncAt:typeof storedCalendar.lastSuccessfulSyncAt==='string'?storedCalendar.lastSuccessfulSyncAt:null,
    ...(calendarIsStale?{reason:row.calendar_owner_authorized!==true?'reauthorization_required':row.calendar_provider_status==='disabled'?'provider_disabled':storedFreshnessReason??(row.calendar_source_error_code?'sync_failed':'reauthorization_required')}:{})
  }:undefined;
  const calendarMetadata=calendarFreshness&&metadata.calendar&&typeof metadata.calendar==='object'&&!Array.isArray(metadata.calendar)
    ?{...Object.fromEntries(Object.entries(metadata.calendar as Record<string,unknown>).filter(([key])=>key!=='freshnessReason')),...calendarFreshness}
    :calendarFreshness;
  const storedTemperature=metadata.temperature&&typeof metadata.temperature==='object'&&!Array.isArray(metadata.temperature)?metadata.temperature as Record<string,unknown>:undefined;
  const temperatureAuthorityStale=Boolean(storedTemperature&&row.calendar_connection_state&&(row.calendar_owner_authorized!==true||row.calendar_provider_status==='disabled'||['expired','awaiting_consent','setup'].includes(row.calendar_connection_state)));
  const temperatureMetadata=storedTemperature?{...storedTemperature,...(temperatureAuthorityStale?{status:'stale',freshness:'stale',reason:row.calendar_owner_authorized!==true?'reauthorization_required':row.calendar_provider_status==='disabled'?'provider_disabled':'reauthorization_required'}:row.temperature_sensor_available===false?{status:'unavailable',freshness:'stale',reason:'sensor_missing'}:{})}:undefined;
  return {
    id:row.id,
    ...(options.includeExternalId?{externalId:row.external_id,status:row.status}:{}),
    kind:row.kind,contentLocale:row.content_locale,
    targets:{household:row.target_household,personIds:options.selectedPersonIds?row.person_ids.filter((id)=>options.selectedPersonIds!.includes(id)):row.person_ids,...(options.includeExternalId?{displayIds:row.display_ids}:{})},
    subjects:{personIds:options.selectedPersonIds?row.subject_person_ids.filter((id)=>options.selectedPersonIds!.includes(id)):row.subject_person_ids},
    title:row.title,body:row.body,entries:row.entries,priority:row.priority,
    publishAt:row.publish_at?.toISOString()??null,startsAt:row.starts_at?.toISOString()??null,
    endsAt:row.ends_at?.toISOString()??null,expiresAt:row.expires_at?.toISOString()??null,
    source,metadata:{...metadata,...(calendarMetadata?{calendar:calendarMetadata}:{}),...(temperatureMetadata?{temperature:temperatureMetadata}:{})},revision:row.revision,updatedAt:row.updated_at.toISOString()
  };
}

const externalItemProjectionColumns=`i.id,i.external_id,i.kind,i.content_locale,i.target_household,i.title,i.body,i.entries,i.priority,
  i.publish_at,i.starts_at,i.ends_at,i.expires_at,i.source,i.metadata,i.status,i.revision,i.updated_at,
  (SELECT calendar.state FROM calendar_connections calendar WHERE calendar.integration_connection_id=i.connection_id) AS calendar_connection_state,
  (SELECT source.last_error_code FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE occurrence.integration_item_id=i.id LIMIT 1) AS calendar_source_error_code,
  (SELECT provider.status FROM calendar_connections calendar JOIN households calendar_household ON calendar_household.id=calendar.household_id LEFT JOIN installation_calendar_provider_configs provider ON provider.installation_id=calendar_household.installation_id AND provider.provider=calendar.provider WHERE calendar.integration_connection_id=i.connection_id) AS calendar_provider_status,
  EXISTS(SELECT 1 FROM calendar_connections calendar JOIN memberships calendar_owner ON calendar_owner.account_id=calendar.owner_account_id AND calendar_owner.household_id=calendar.household_id JOIN persons calendar_person ON calendar_person.id=calendar_owner.person_id AND calendar_person.household_id=calendar_owner.household_id AND calendar_person.age_group='adult' JOIN accounts calendar_account ON calendar_account.id=calendar.owner_account_id AND calendar_account.disabled_at IS NULL WHERE calendar.integration_connection_id=i.connection_id AND calendar_owner.capabilities ? 'household.view') AS calendar_owner_authorized,
  (SELECT sensor.available FROM home_assistant_temperature_sensors sensor WHERE sensor.integration_item_id=i.id LIMIT 1) AS temperature_sensor_available,
  COALESCE((SELECT json_agg(t.person_id ORDER BY t.person_id) FROM integration_item_person_targets t WHERE t.item_id=i.id),'[]') AS person_ids,
  COALESCE((SELECT json_agg(t.person_id ORDER BY t.person_id) FROM integration_item_person_subjects t WHERE t.item_id=i.id),'[]') AS subject_person_ids,
  COALESCE((SELECT json_agg(t.display_id ORDER BY t.display_id) FROM integration_item_display_targets t WHERE t.item_id=i.id),'[]') AS display_ids`;

async function homeItems(householdId:string,personId:string,canViewAll:boolean):Promise<Record<string,unknown>[]>{
  const rows=await pool.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns}
    FROM integration_items i JOIN integration_connections c ON c.id=i.connection_id AND c.household_id=i.household_id
    WHERE i.household_id=$1 AND i.status='active' AND c.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM home_assistant_temperature_sensors hidden_sensor WHERE hidden_sensor.integration_item_id=i.id)
      AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp())
      AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
      AND ($3 OR i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets vt WHERE vt.item_id=i.id AND vt.person_id=$2))
    ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      i.starts_at NULLS LAST,i.updated_at DESC,i.id LIMIT 300`,[householdId,personId,canViewAll]);
  // Home Assistant discovery rejects registries above 2,000 entities; keep
  // this independent projection bounded at that same per-source ceiling.
  const temperatures=await pool.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns}
    FROM home_assistant_temperature_sensors sensor
    JOIN calendar_connections calendar ON calendar.id=sensor.connection_id AND calendar.household_id=sensor.household_id AND calendar.provider='home_assistant' AND calendar.disconnected_at IS NULL
    JOIN integration_connections c ON c.id=calendar.integration_connection_id AND c.household_id=sensor.household_id AND c.revoked_at IS NULL
    JOIN integration_items i ON i.id=sensor.integration_item_id AND i.household_id=sensor.household_id AND i.connection_id=c.id
    JOIN households h ON h.id=calendar.household_id
    WHERE sensor.household_id=$1 AND sensor.enabled AND i.status='active'
      AND ($3 OR sensor.target_household OR EXISTS(SELECT 1 FROM home_assistant_temperature_person_readers reader WHERE reader.sensor_id=sensor.id AND reader.person_id=$2))
      AND ($3 OR i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets item_reader WHERE item_reader.item_id=i.id AND item_reader.person_id=$2))
      AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp()) AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
      AND EXISTS(SELECT 1 FROM memberships owner JOIN persons owner_person ON owner_person.id=owner.person_id AND owner_person.household_id=owner.household_id AND owner_person.age_group='adult' JOIN accounts owner_account ON owner_account.id=owner.account_id AND owner_account.disabled_at IS NULL WHERE owner.account_id=calendar.owner_account_id AND owner.household_id=calendar.household_id AND owner.capabilities ? 'household.view')
    ORDER BY sensor.display_order,sensor.id LIMIT 2000`,[householdId,personId,canViewAll]);
  return [...rows.rows.map((row)=>mapExternalItem(row)),...temperatures.rows.map((row)=>mapExternalItem(row))];
}

interface ActivityCursor {at:string;rank:0|1;id:string;}
interface ActivityRow extends ExternalItemRow {activity_at:Date;activity_person_id:string|null;activity_person_ids:string[];activity_person_colors:Record<string,string>;}
function dateOnly(value:unknown):string|undefined{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return undefined;
  const parsed=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value?value:undefined;
}
function dateOffset(value:string,offset:number):string{
  const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
function weekStart(value:string):string{const day=new Date(`${value}T00:00:00Z`).getUTCDay();return dateOffset(value,-((day+6)%7));}
function activityIdFilter(value:unknown,field:string,maximum:number):string[]|undefined{
  if(value===undefined)return undefined;
  const values=typeof value==='string'?value.split(','):Array.isArray(value)?value.flatMap((part)=>typeof part==='string'?part.split(','):[]):[];
  const normalized=[...new Set(values.map((part)=>part.trim()).filter(Boolean))];
  if(!normalized.length||normalized.length>maximum||normalized.some((id)=>!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(id)))throw new DomainError('VALIDATION_FAILED',400,{reason:`invalid_${field}`});
  return normalized;
}
function activitySourcePagination(query:Record<string,unknown>):{limit:number;cursor:string|null}{
  const limit=query.limit===undefined?100:Number(query.limit);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_source_limit'});
  const cursor=query.cursor;
  if(cursor!==undefined&&(typeof cursor!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(cursor)))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_source_cursor'});
  return{limit,cursor:typeof cursor==='string'?cursor:null};
}
function activitySourcePage(rows:Array<{id:string;name:string}>,limit:number){
  const sources=rows.slice(0,limit);
  return{sources,nextCursor:rows.length>limit?sources.at(-1)!.id:null};
}
function decodeActivityCursor(value:unknown):ActivityCursor|undefined{
  if(value===undefined)return undefined;if(typeof value!=='string'||value.length>512)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_cursor'});
  try{const parsed=JSON.parse(Buffer.from(value,'base64url').toString('utf8')) as Record<string,unknown>;const at=typeof parsed.at==='string'&&Number.isFinite(Date.parse(parsed.at))?new Date(parsed.at).toISOString():undefined;const rank=parsed.rank;const id=typeof parsed.id==='string'&&/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i.test(parsed.id)?parsed.id:undefined;if(!at||(rank!==0&&rank!==1)||!id)throw new Error();return{at,rank,id};}catch{throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_cursor'});}
}
function encodeActivityCursor(cursor:ActivityCursor):string{return Buffer.from(JSON.stringify(cursor)).toString('base64url');}

interface SchoolActivityRow extends SchoolProvenanceRow {acl_witness?:string;id:string;task_id:string;person_id:string;person_ids:string[];person_colors:Record<string,string>;event_date:string;event_time:string|null;event_type:string;description:string;actions:string[];evidence:Record<string,unknown>;confidence:number|null;uncertainty:string|null;school_expires_at:Date;source_url:string|null;recorded_at:Date|null;activity_at:Date;}
const schoolActivitySelect=`event.id,event.task_id,subject.person_id,subject.person_ids,event.event_date::text,event.event_time::text,event.event_type,event.description,event.actions,event.evidence,event.confidence,event.uncertainty,event.school_expires_at,COALESCE(event.evidence->>'sourceUrl',run.source_url) AS source_url,run.checked_at AS recorded_at,${schoolProvenanceColumns},
  COALESCE((SELECT jsonb_object_agg(person.id::text,person.color_token) FROM persons person WHERE person.household_id=event.household_id AND person.id=ANY(subject.person_ids)),'{}'::jsonb) AS person_colors,
  ((event.event_date+COALESCE(event.event_time,TIME '00:00')) AT TIME ZONE household.timezone) AS activity_at`;
const schoolReaderAcl=`($3 OR message.audience_household OR message.author_membership_id=$4 OR EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=message.id AND audience.person_id=$5))`;
const schoolReaderAclWeek=`($5 OR message.audience_household OR message.author_membership_id=$6 OR EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=message.id AND audience.person_id=$7))`;
const schoolTaskAuthorized=`EXISTS(SELECT 1 FROM memberships task_owner JOIN accounts owner_account ON owner_account.id=task_owner.account_id AND owner_account.disabled_at IS NULL
  WHERE task_owner.id=task.owner_membership_id AND task_owner.household_id=task.household_id
    AND task_owner.capabilities ? 'household.manage' AND task_owner.capabilities ? 'message.create.household' AND task_owner.capabilities ? 'message.schedule'
    AND ((SELECT count(*) FROM monitor_task_display_targets target WHERE target.task_id=task.id)=0 OR
      (task_owner.capabilities ? 'message.publish.display' AND ((task_owner.capabilities ? 'display.manage') OR NOT EXISTS(SELECT 1 FROM monitor_task_display_targets target WHERE target.task_id=task.id AND NOT EXISTS(SELECT 1 FROM membership_display_grants grant_row WHERE grant_row.household_id=task.household_id AND grant_row.membership_id=task_owner.id AND grant_row.display_id=target.display_id))))))`;

async function schoolActivitiesForHome(householdId:string,viewer:{personId:string;membershipId:string},canViewAll:boolean,today:string):Promise<Record<string,unknown>[]>{
  const rows=await pool.query<SchoolActivityRow>(`SELECT ${schoolActivitySelect}
    FROM monitor_events event JOIN monitor_tasks task ON task.id=event.task_id AND task.household_id=event.household_id
    JOIN LATERAL (SELECT subject.person_id,ARRAY[subject.person_id] AS person_ids FROM monitor_task_subjects subject WHERE subject.task_id=task.id AND subject.household_id=task.household_id) subject ON true
    JOIN households household ON household.id=task.household_id
    JOIN messages message ON message.id=event.message_id AND message.household_id=event.household_id AND message.state IN ('scheduled','published')
    ${schoolProvenanceJoins}
    WHERE event.household_id=$1 AND event.event_date BETWEEN $2::date AND ($2::date+1)
      AND event.active AND jsonb_typeof(event.actions)='array' AND ${schoolHasPracticalActionsSql}
      AND task.presentation_kind='school' AND task.state='active' AND task.approved_revision=task.revision
      AND event.school_expires_at>clock_timestamp() AND message.expires_at>clock_timestamp()
      AND ${schoolTaskAuthorized} AND ${schoolReaderAcl}
    ORDER BY event.event_date,event.event_time NULLS FIRST,event.id LIMIT 200`,[householdId,today,canViewAll,viewer.membershipId,viewer.personId]);
  return rows.rows.map((row)=>({type:'school',id:row.id,taskId:row.task_id,personId:row.person_id,personIds:row.person_ids,personColors:row.person_colors,date:row.event_date,time:row.event_time,kind:row.event_type,title:row.description,...schoolProjectionMetadata(row),evidence:row.evidence,confidence:row.confidence,uncertainty:row.uncertainty,sourceUrl:row.source_url,expiresAt:row.school_expires_at.toISOString()}));
}

async function personActivities(input:{householdId:string;personIds:string[]|null;viewer:{personId:string;membershipId:string};canViewAll:boolean;from:string;to:string;limit:number;sourceIds?:string[];cursor?:ActivityCursor;maxDays:number;upcomingOnly?:boolean;display?:DisplayContext}):Promise<{activities:Record<string,unknown>[];nextCursor:string|null}>{
  const {householdId,personIds,viewer,canViewAll,from,to,limit,sourceIds,cursor}=input;
  const calendarCursor=`AND ($9::timestamptz IS NULL OR activity.starts_at>$9::timestamptz OR (activity.starts_at=$9::timestamptz AND $10=0 AND i.id::text>$11))`;
  const display=input.display;
  const displayCalendarSource=`(EXISTS(SELECT 1 FROM calendar_occurrences selected_occurrence WHERE selected_occurrence.integration_item_id=i.id)
      AND ($15::boolean OR EXISTS(SELECT 1 FROM calendar_occurrences selected_occurrence WHERE selected_occurrence.integration_item_id=i.id AND selected_occurrence.source_id=ANY($17::uuid[]))))`;
  const displayGenericSource=`(NOT EXISTS(SELECT 1 FROM calendar_occurrences generic_occurrence WHERE generic_occurrence.integration_item_id=i.id)
      AND ($15::boolean OR connection.id=ANY($16::uuid[])))`;
  const calendar=await pool.query<ActivityRow>(`SELECT ${externalItemProjectionColumns},${display?displayItemWitnessSql('$12','$19','$17'):'NULLIF($19::uuid[],$19::uuid[])::text'} AS acl_witness,activity.starts_at AS activity_at,
      (SELECT min(subject.person_id::text)::uuid FROM integration_item_person_subjects subject WHERE subject.item_id=i.id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2))) AS activity_person_id,
      COALESCE((SELECT array_agg(subject.person_id ORDER BY subject.person_id) FROM integration_item_person_subjects subject WHERE subject.item_id=i.id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2))),ARRAY[]::uuid[]) AS activity_person_ids,
      COALESCE((SELECT jsonb_object_agg(subject.person_id::text,person.color_token) FROM integration_item_person_subjects subject JOIN persons person ON person.id=subject.person_id AND person.household_id=i.household_id WHERE subject.item_id=i.id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2))),'{}'::jsonb) AS activity_person_colors
    FROM integration_items i JOIN integration_connections connection ON connection.id=i.connection_id AND connection.household_id=i.household_id AND connection.revoked_at IS NULL
    JOIN households household ON household.id=i.household_id
    -- Calendar all-day timestamps encode civil dates, not UTC instants. Keep
    -- their stored/returned values, but compare local-midnight boundaries.
    CROSS JOIN LATERAL (SELECT
      CASE WHEN i.metadata->'calendar' IS NOT NULL AND i.metadata->'allDay'='true'::jsonb
        THEN (i.starts_at AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE household.timezone ELSE i.starts_at END AS starts_at,
      CASE WHEN i.metadata->'calendar' IS NOT NULL AND i.metadata->'allDay'='true'::jsonb
        THEN COALESCE((i.ends_at AT TIME ZONE 'UTC')::date,(i.starts_at AT TIME ZONE 'UTC')::date+1)::timestamp AT TIME ZONE household.timezone WHEN i.ends_at=i.starts_at THEN NULL ELSE i.ends_at END AS ends_at) activity
    WHERE i.household_id=$1 AND i.kind IN ('event','reminder') AND i.status='active'
      AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp()) AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
      AND (activity.ends_at IS NULL AND activity.starts_at >= ($3::date::timestamp AT TIME ZONE household.timezone) OR activity.ends_at > ($3::date::timestamp AT TIME ZONE household.timezone))
      AND activity.starts_at < (($4::date+1)::timestamp AT TIME ZONE household.timezone)
      AND (activity.ends_at IS NULL OR activity.ends_at>activity.starts_at)
      AND ((i.kind='event' AND i.metadata->'calendar' IS NOT NULL AND (COALESCE((i.metadata#>>'{calendar,subjectHousehold}')::boolean,false) OR EXISTS(SELECT 1 FROM integration_item_person_subjects placement WHERE placement.item_id=i.id AND ($2::uuid[] IS NULL OR placement.person_id=ANY($2)))))
        OR (i.kind IN ('event','reminder') AND i.metadata->'calendar' IS NULL AND (i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets placement WHERE placement.item_id=i.id AND ($2::uuid[] IS NULL OR placement.person_id=ANY($2))))))
      AND (($12::uuid IS NULL AND ($5 OR i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets readable WHERE readable.item_id=i.id AND readable.person_id=$6)))
        OR ($12::uuid IS NOT NULL AND $13::boolean AND $14::boolean
          AND EXISTS(SELECT 1 FROM integration_connection_display_grants cg WHERE cg.household_id=i.household_id AND cg.connection_id=i.connection_id AND cg.display_id=$12)
          AND EXISTS(SELECT 1 FROM integration_item_display_targets dt WHERE dt.household_id=i.household_id AND dt.item_id=i.id AND dt.display_id=$12)
          AND (${displayCalendarSource} OR ${displayGenericSource})))
      AND ($18::timestamptz IS NULL OR (activity.ends_at IS NULL AND activity.starts_at>=$18::timestamptz OR activity.ends_at>$18::timestamptz))
      AND ($18::timestamptz IS NULL OR COALESCE(i.metadata#>>'{calendar,status}','') NOT IN ('cancelled','canceled','declined'))
      AND ($8::uuid[] IS NULL OR EXISTS(SELECT 1 FROM calendar_occurrences occurrence WHERE occurrence.integration_item_id=i.id AND occurrence.source_id=ANY($8)))
      AND NOT EXISTS(SELECT 1 FROM home_assistant_temperature_sensors hidden_sensor WHERE hidden_sensor.integration_item_id=i.id)
      ${calendarCursor}
    ORDER BY activity.starts_at,i.id LIMIT $7`,[householdId,personIds,from,to,canViewAll,viewer.personId,limit+1,sourceIds??null,cursor?.at??null,cursor?.rank??null,cursor?.id??null,display?.id??null,display?.externalItemsEnabled??false,Boolean(display?.cards.includes('external_items')),display?.allSources??false,display?.sourceIds??[],display?.calendarSourceIds??[],input.upcomingOnly?new Date():null,display?.selectedPersonIds??[]]);
  const schoolCursor=`AND ($10::timestamptz IS NULL OR ((event.event_date+COALESCE(event.event_time,TIME '00:00')) AT TIME ZONE household.timezone)>$10::timestamptz OR (((event.event_date+COALESCE(event.event_time,TIME '00:00')) AT TIME ZONE household.timezone)=$10::timestamptz AND ($11<1 OR ($11=1 AND event.id::text>$12))))`;
  const schoolReader=display
    ?`($5::boolean IS NOT NULL AND $6::uuid IS NOT NULL AND $7::uuid IS NOT NULL)
      AND EXISTS(SELECT 1 FROM message_display_targets target WHERE target.household_id=message.household_id AND target.message_id=message.id AND target.display_id=$13 AND target.delivery_state IN ('queued','delivered','displayed'))
      AND (message.audience_household OR NOT EXISTS(SELECT 1 FROM message_person_audiences any_audience WHERE any_audience.message_id=message.id) OR EXISTS(SELECT 1 FROM message_person_audiences visible_audience WHERE visible_audience.message_id=message.id AND visible_audience.person_id=ANY($2::uuid[])))`
    :schoolReaderAclWeek;
  const school=await pool.query<SchoolActivityRow>(`SELECT ${schoolActivitySelect},${display?displaySchoolWitnessSql('$13','$2','$2',input.upcomingOnly?'TRUE':'FALSE'):'NULL::text'} AS acl_witness
    FROM monitor_events event JOIN monitor_tasks task ON task.id=event.task_id AND task.household_id=event.household_id
    JOIN LATERAL (SELECT min(subject.person_id::text)::uuid AS person_id,array_agg(subject.person_id ORDER BY subject.person_id) AS person_ids FROM monitor_task_subjects subject WHERE subject.task_id=task.id AND subject.household_id=task.household_id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2)) HAVING count(*)>0) subject ON true
    JOIN households household ON household.id=task.household_id
    JOIN messages message ON message.id=event.message_id AND message.household_id=event.household_id AND message.state IN ('scheduled','published','expired')
    ${schoolProvenanceJoins}
    WHERE event.household_id=$1 AND event.event_date BETWEEN $3::date AND $4::date AND ($8::uuid[] IS NULL OR $13::uuid IS NOT NULL)
      AND event.active AND jsonb_typeof(event.actions)='array'
      ${input.upcomingOnly?`AND ${schoolHasPracticalActionsSql}`:''}
      AND task.presentation_kind='school' AND task.state='active' AND task.approved_revision=task.revision
      ${input.upcomingOnly?`AND event.school_expires_at>clock_timestamp() AND message.expires_at>clock_timestamp() AND message.state IN ('scheduled','published')`:''}
      AND ${schoolTaskAuthorized} AND ${schoolReader}
      ${schoolCursor}
    ORDER BY activity_at,event.id LIMIT $9`,[householdId,personIds,from,to,canViewAll,viewer.membershipId,viewer.personId,sourceIds??null,limit+1,cursor?.at??null,cursor?.rank??0,cursor?.id??null,display?.id??null]);
  const merged=[
    ...calendar.rows.map((row)=>({rank:0 as const,id:row.id,at:row.activity_at.toISOString(),value:{type:'calendar',personId:row.activity_person_id,...mapExternalItem(row,{forDisplay:Boolean(display),selectedPersonIds:display?.selectedPersonIds}),personIds:row.activity_person_ids,personColors:row.activity_person_colors}})),
    ...school.rows.map((row)=>({rank:1 as const,id:row.id,at:row.activity_at.toISOString(),value:{type:'school',personId:row.person_id,personIds:row.person_ids,personColors:row.person_colors,id:row.id,taskId:row.task_id,date:row.event_date,time:row.event_time,startsAt:row.activity_at.toISOString(),kind:row.event_type,title:row.description,...schoolProjectionMetadata(row),evidence:row.evidence,confidence:row.confidence,uncertainty:row.uncertainty,sourceUrl:row.source_url,expiresAt:row.school_expires_at.toISOString()}}))
  ].filter((row)=>!cursor||row.at>cursor.at||(row.at===cursor.at&&(row.rank>cursor.rank||(row.rank===cursor.rank&&row.id>cursor.id))))
    .sort((left,right)=>left.at.localeCompare(right.at)||left.rank-right.rank||left.id.localeCompare(right.id));
  const page=merged.slice(0,limit);const more=merged.length>limit;
  if(display){const emitted=new Set(page.filter(row=>row.rank===0).map(row=>row.id));rememberDisplayItems(display,calendar.rows.filter(row=>emitted.has(row.id)));
    const emittedSchool=new Set(page.filter(row=>row.rank===1).map(row=>row.id));rememberDisplaySchools(display,school.rows.filter(row=>emittedSchool.has(row.id)),personIds??display.selectedPersonIds,personIds??display.selectedPersonIds,Boolean(input.upcomingOnly));}
  return{activities:page.map((row)=>row.value),nextCursor:more&&page.length?encodeActivityCursor({at:page.at(-1)!.at,rank:page.at(-1)!.rank,id:page.at(-1)!.id}):null};
}

async function displayHub(display:DisplayContext,db:DbClient=pool,lockRows=false):Promise<Record<string,unknown>|undefined>{
  if(display.privacyMode || !display.externalItemsEnabled || !display.cards.includes('external_items'))return undefined;
  const rows=await db.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns},${displayItemWitnessSql('$1','$6','$5')} AS acl_witness
    FROM integration_items i
    JOIN integration_connections c ON c.id=i.connection_id AND c.household_id=i.household_id AND c.revoked_at IS NULL
    JOIN integration_connection_display_grants g ON g.connection_id=i.connection_id AND g.household_id=i.household_id AND g.display_id=$1
    JOIN integration_item_display_targets dt ON dt.item_id=i.id AND dt.household_id=i.household_id AND dt.display_id=$1
    WHERE i.household_id=$2 AND i.status='active'
      AND ($3::boolean OR
        (NOT EXISTS(SELECT 1 FROM calendar_occurrences source_occurrence WHERE source_occurrence.integration_item_id=i.id) AND c.id=ANY($4::uuid[])) OR
        EXISTS(SELECT 1 FROM calendar_occurrences source_occurrence WHERE source_occurrence.integration_item_id=i.id AND source_occurrence.source_id=ANY($5::uuid[])))
      AND ((i.metadata->'calendar' IS NOT NULL AND (COALESCE((i.metadata#>>'{calendar,subjectHousehold}')::boolean,false)
          OR EXISTS(SELECT 1 FROM integration_item_person_subjects selected_subject WHERE selected_subject.item_id=i.id AND selected_subject.person_id=ANY($6::uuid[]))))
        OR (i.metadata->'calendar' IS NULL AND (i.target_household
          OR EXISTS(SELECT 1 FROM integration_item_person_targets selected_target WHERE selected_target.item_id=i.id AND selected_target.person_id=ANY($6::uuid[])))))
      AND NOT EXISTS(SELECT 1 FROM home_assistant_temperature_sensors hidden_sensor WHERE hidden_sensor.integration_item_id=i.id)
      AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp())
      AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
      ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      i.starts_at NULLS LAST,i.updated_at DESC,i.id LIMIT 200${lockRows?' FOR SHARE OF i,c,g,dt':''}`,[display.id,display.householdId,display.allSources,display.sourceIds,display.calendarSourceIds,display.selectedPersonIds]);
  const temperatures=await db.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns},${displayItemWitnessSql('$1','$5','$6','sensor.id')} AS acl_witness,sensor.id AS acl_sensor_id
    FROM home_assistant_temperature_sensors sensor
    JOIN calendar_connections calendar ON calendar.id=sensor.connection_id AND calendar.household_id=sensor.household_id AND calendar.provider='home_assistant' AND calendar.disconnected_at IS NULL
    JOIN integration_connections c ON c.id=calendar.integration_connection_id AND c.household_id=sensor.household_id AND c.revoked_at IS NULL
    JOIN integration_connection_display_grants g ON g.connection_id=c.id AND g.household_id=c.household_id AND g.display_id=$1
    JOIN home_assistant_temperature_display_targets sensor_target ON sensor_target.sensor_id=sensor.id AND sensor_target.household_id=sensor.household_id AND sensor_target.display_id=$1
    JOIN integration_items i ON i.id=sensor.integration_item_id AND i.household_id=sensor.household_id AND i.connection_id=c.id
    JOIN integration_item_display_targets dt ON dt.item_id=i.id AND dt.household_id=i.household_id AND dt.display_id=$1
    WHERE sensor.household_id=$2 AND sensor.enabled AND i.status='active'
      AND ($3::boolean OR sensor.id=ANY($4::uuid[]))
      AND (sensor.target_household OR EXISTS(SELECT 1 FROM home_assistant_temperature_person_readers selected_sensor_reader WHERE selected_sensor_reader.sensor_id=sensor.id AND selected_sensor_reader.person_id=ANY($5::uuid[])))
      AND (i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets selected_item_reader WHERE selected_item_reader.item_id=i.id AND selected_item_reader.person_id=ANY($5::uuid[])))
      AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp()) AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
      AND EXISTS(SELECT 1 FROM memberships owner JOIN persons owner_person ON owner_person.id=owner.person_id AND owner_person.household_id=owner.household_id AND owner_person.age_group='adult' JOIN accounts owner_account ON owner_account.id=owner.account_id AND owner_account.disabled_at IS NULL WHERE owner.account_id=calendar.owner_account_id AND owner.household_id=calendar.household_id AND owner.capabilities ? 'household.view')
    ORDER BY sensor.display_order,sensor.id LIMIT 2000${lockRows?' FOR SHARE OF sensor,calendar,c,g,sensor_target,i,dt':''}`,[display.id,display.householdId,display.allSensors,display.sensorIds,display.selectedPersonIds,display.calendarSourceIds]);
  const allRows=[...rows.rows,...temperatures.rows];
  rememberDisplayItems(display,allRows);
  const personIds=[...new Set(allRows.flatMap((row)=>[...row.person_ids,...row.subject_person_ids]))];
  const permittedPeople=display.selectedPersonIds.length?personIds.filter((personId)=>display.selectedPersonIds.includes(personId)):[];
  const people=permittedPeople.length?(await db.query<{id:string;display_name:string;avatar_key:string|null;color_token:string;photo_revision:number|null}>(`SELECT p.id,p.display_name,p.avatar_key,p.color_token,ph.revision AS photo_revision FROM persons p LEFT JOIN person_profile_photos ph ON ph.person_id=p.id AND ph.household_id=p.household_id WHERE p.household_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY p.display_name,p.id`,[display.householdId,permittedPeople])).rows:[];
  return {people:people.map((person)=>({id:person.id,displayName:person.display_name,avatarKey:person.avatar_key,colorToken:person.color_token,photo:displayPhotoProjection(person.id,person.photo_revision)})),items:allRows.map((row)=>mapExternalItem(row,{forDisplay:true,selectedPersonIds:display.selectedPersonIds}))};
}

async function displayPersonPhotoVisible(display:DisplayContext,personId:string,db:DbClient=pool,lockRows=false):Promise<boolean>{
  if(display.privacyMode||!display.selectedPersonIds.includes(personId))return false;
  if(display.familyLayoutEnabled&&display.cards.includes('family_layout')&&display.profilePersonIds.includes(personId))return true;
  if(display.cards.includes('household_messages')){
    const message=await db.query<{id:string;acl_witness:string}>(`SELECT msg.id,${displayMessageWitnessSql('$3','$4')} AS acl_witness FROM messages msg JOIN memberships author ON author.id=msg.author_membership_id
      JOIN message_display_targets target ON target.message_id=msg.id AND target.household_id=msg.household_id
      WHERE msg.household_id=$1 AND author.person_id=$2 AND target.display_id=$3 AND msg.state='published'
        AND target.delivery_state IN ('queued','delivered','displayed') AND msg.publish_at<=clock_timestamp() AND msg.expires_at>clock_timestamp()
        AND (msg.audience_household OR NOT EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=msg.id)
          OR EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=msg.id AND audience.person_id=ANY($4::uuid[])))${lockRows?' FOR SHARE OF msg,target,author':''}`,[display.householdId,personId,display.id,display.selectedPersonIds]);
    if(message.rows[0]){rememberDisplayMessages(display,message.rows);return true;}
  }

  if(display.cards.includes('external_items')){
    const hub=await displayHub(display,db,lockRows);
    if(hub&&Array.isArray(hub.people)&&(hub.people as Array<{id:string}>).some((person)=>person.id===personId))return true;
  }
  return false;
}

async function integrationConnectionResponse(connectionId:string,householdId:string):Promise<Record<string,unknown>>{
  const connection=(await pool.query<{id:string;name:string;revision:number;revoked_at:Date|null;created_at:Date;updated_at:Date}>(`SELECT id,name,revision,revoked_at,created_at,updated_at FROM integration_connections WHERE id=$1 AND household_id=$2`,[connectionId,householdId])).rows[0];
  if(!connection)throw new DomainError('NOT_FOUND',404);
  const [displays,credentials]=await Promise.all([
    pool.query<{display_id:string}>('SELECT display_id FROM integration_connection_display_grants WHERE connection_id=$1 AND household_id=$2 ORDER BY display_id',[connectionId,householdId]),
    pool.query<{id:string;name:string;capabilities:IntegrationCapability[];expires_at:Date|null;last_used_at:Date|null;revoked_at:Date|null;created_at:Date;revision:number}>(`SELECT id,name,capabilities,expires_at,last_used_at,revoked_at,created_at,revision FROM integration_credentials WHERE connection_id=$1 ORDER BY created_at,id`,[connectionId])
  ]);
  return {
    id:connection.id,name:connection.name,revision:connection.revision,revokedAt:connection.revoked_at?.toISOString()??null,
    createdAt:connection.created_at.toISOString(),updatedAt:connection.updated_at.toISOString(),
    displayIds:displays.rows.map((row)=>row.display_id),
    credentials:credentials.rows.map((credential)=>({
      id:credential.id,name:credential.name,capabilities:credential.capabilities,expiresAt:credential.expires_at?.toISOString()??null,
      lastUsedAt:credential.last_used_at?.toISOString()??null,revokedAt:credential.revoked_at?.toISOString()??null,
      createdAt:credential.created_at.toISOString(),revision:credential.revision
    }))
  };
}

function params(request: FastifyRequest): Record<string, string> { return request.params as Record<string, string>; }

function mediaActor(auth:AuthContext):MediaMemberActor{return{accountId:auth.accountId,sessionId:auth.sessionId,householdId:auth.householdId,membershipId:auth.membershipId,personId:auth.personId};}

function photoProjection(householdId:string,personId:string,revision:number|null):Record<string,unknown>|null{
  return revision?{revision,url96:`/api/v1/households/${householdId}/people/${personId}/photo/96?v=${revision}`,url512:`/api/v1/households/${householdId}/people/${personId}/photo/512?v=${revision}`}:null;
}

function displayPhotoProjection(personId:string,revision:number|null):Record<string,unknown>|null{
  return revision?{revision,url96:`/api/v1/display/people/${personId}/photo/96?v=${revision}`,url512:`/api/v1/display/people/${personId}/photo/512?v=${revision}`}:null;
}

function previewPhotoProjection(householdId:string,displayId:string,personId:string,revision:number|null,selectionTag:string):Record<string,unknown>|null{
  if(!revision)return null;
  const base=`/api/v1/households/${householdId}/displays/${displayId}/preview/people/${personId}/photo`;
  return{revision,url96:`${base}/96?v=${revision}&s=${selectionTag}`,url512:`${base}/512?v=${revision}&s=${selectionTag}`};
}

interface DisplaySetupInput {
  name:string;cards:string[];cardOrder:string[];familyLayoutEnabled:boolean;allSources:boolean;allSensors:boolean;personIds:string[];sourceIds:string[];calendarSourceIds:string[];
  sensorIds:string[];albumIds:string[];backgroundId:string|null;locale:'en'|'nb';theme:'light'|'dark'|'system';
}

type DisplaySetupQuery = Pick<pg.PoolClient,'query'>;

async function displaySetupResponse(client:DisplaySetupQuery,householdId:string,setupId:string):Promise<Record<string,unknown>>{
  const setup=(await client.query<{id:string;name:string;revision:number;cards:string[];card_order:string[];family_layout_enabled:boolean;all_sources:boolean;all_sensors:boolean;album_ids:string[];background_id:string|null;locale:'en'|'nb';theme:'light'|'dark'|'system';is_default:boolean}>(`SELECT id,name,revision,cards,card_order,family_layout_enabled,all_sources,all_sensors,album_ids,background_id,locale,theme,is_default FROM display_setups WHERE id=$1 AND household_id=$2`,[setupId,householdId])).rows[0];
  if(!setup)throw new DomainError('NOT_FOUND',404);
  const [people,sources,calendarSources,sensors]=await Promise.all([
    client.query<{person_id:string}>('SELECT person_id FROM display_setup_people WHERE household_id=$1 AND setup_id=$2 ORDER BY person_id',[householdId,setupId]),
    client.query<{connection_id:string}>('SELECT connection_id FROM display_setup_sources WHERE household_id=$1 AND setup_id=$2 ORDER BY connection_id',[householdId,setupId]),
    client.query<{source_id:string}>('SELECT source_id FROM display_setup_calendar_sources WHERE household_id=$1 AND setup_id=$2 ORDER BY source_id',[householdId,setupId]),
    client.query<{sensor_id:string}>('SELECT sensor_id FROM display_setup_sensors WHERE household_id=$1 AND setup_id=$2 ORDER BY sensor_id',[householdId,setupId])
  ]);
  return {id:setup.id,name:setup.name,revision:setup.revision,cards:setup.cards,cardOrder:setup.card_order,familyLayoutEnabled:setup.family_layout_enabled,allSources:setup.all_sources,allSensors:setup.all_sensors,
    personIds:people.rows.map((row)=>row.person_id),sourceIds:sources.rows.map((row)=>row.connection_id),calendarSourceIds:calendarSources.rows.map((row)=>row.source_id),sensorIds:sensors.rows.map((row)=>row.sensor_id),albumIds:setup.album_ids,backgroundId:setup.background_id,
    locale:setup.locale,theme:setup.theme,isDefault:setup.is_default};
}

async function writeDisplaySetupSelections(client:DbClient,householdId:string,setupId:string,input:DisplaySetupInput,membershipId:string,bumpRevision=true):Promise<void>{
  await validateDisplaySetupMediaSelection(client,householdId,membershipId,input.albumIds,input.backgroundId);
  const checks=await Promise.all([
    client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.personIds]),
    client.query('SELECT id FROM integration_connections WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.sourceIds]),
    client.query('SELECT id FROM calendar_sources WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.calendarSourceIds]),
    client.query('SELECT id FROM home_assistant_temperature_sensors WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.sensorIds])
  ]);
  for(const [index,ids] of [[0,input.personIds],[1,input.sourceIds],[2,input.calendarSourceIds],[3,input.sensorIds]] as const){
    if(checks[index]!.rowCount!==new Set(ids).size)throw new DomainError('NOT_FOUND',404);
  }
  await client.query(`UPDATE display_setups SET name=$3,cards=$4::jsonb,card_order=$5::jsonb,family_layout_enabled=$6,
    all_sources=$7,all_sensors=$8,album_ids=$9::jsonb,background_id=$10,locale=$11,theme=$12,revision=revision+$13::int,updated_at=clock_timestamp()
    WHERE id=$1 AND household_id=$2`,[setupId,householdId,input.name,JSON.stringify(input.cards),JSON.stringify(input.cardOrder),input.familyLayoutEnabled,input.allSources,input.allSensors,JSON.stringify(input.albumIds),input.backgroundId,input.locale,input.theme,bumpRevision?1:0]);
  for(const table of ['display_setup_people','display_setup_sources','display_setup_calendar_sources','display_setup_sensors'])await client.query(`DELETE FROM ${table} WHERE household_id=$1 AND setup_id=$2`,[householdId,setupId]);
  for(const personId of input.personIds)await client.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[householdId,setupId,personId]);
  for(const sourceId of input.sourceIds)await client.query('INSERT INTO display_setup_sources(household_id,setup_id,connection_id) VALUES($1,$2,$3)',[householdId,setupId,sourceId]);
  for(const sourceId of input.calendarSourceIds)await client.query('INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id) VALUES($1,$2,$3)',[householdId,setupId,sourceId]);
  for(const sensorId of input.sensorIds)await client.query('INSERT INTO display_setup_sensors(household_id,setup_id,sensor_id) VALUES($1,$2,$3)',[householdId,setupId,sensorId]);
}

async function updateDisplayPersonGrants(client:DbClient,householdId:string,displayId:string,profileIds?:string[],birthdayIds?:string[]):Promise<void>{
  const requested=[...(profileIds??[]),...(birthdayIds??[])];
  if(requested.length){
    const selected=await client.query(`SELECT person.id AS person_id FROM persons person JOIN displays device ON device.household_id=person.household_id AND device.id=$2 WHERE person.household_id=$1 AND person.id=ANY($3::uuid[]) AND person.id=ANY(COALESCE(device.person_ids_override,ARRAY(SELECT selected.person_id FROM display_setup_people selected WHERE selected.household_id=$1 AND selected.setup_id=device.setup_id)))`,[householdId,displayId,requested]);
    if(selected.rowCount!==new Set(requested).size)throw new DomainError('VALIDATION_FAILED',400,{reason:'display_person_not_selected'});
  }
  if(profileIds){
    await client.query(`DELETE FROM display_person_grants WHERE household_id=$1 AND display_id=$2 AND profile_allowed AND NOT birthday_allowed AND NOT(person_id=ANY($3::uuid[]))`,[householdId,displayId,profileIds]);
    await client.query(`UPDATE display_person_grants SET profile_allowed=false WHERE household_id=$1 AND display_id=$2 AND profile_allowed AND birthday_allowed AND NOT(person_id=ANY($3::uuid[]))`,[householdId,displayId,profileIds]);
    for(const personId of profileIds)await client.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed) VALUES($1,$2,$3,true)
      ON CONFLICT(display_id,person_id) DO UPDATE SET profile_allowed=true`,[householdId,displayId,personId]);
  }
  if(birthdayIds){
    await client.query(`DELETE FROM display_person_grants WHERE household_id=$1 AND display_id=$2 AND birthday_allowed AND NOT profile_allowed AND NOT(person_id=ANY($3::uuid[]))`,[householdId,displayId,birthdayIds]);
    await client.query(`UPDATE display_person_grants SET birthday_allowed=false WHERE household_id=$1 AND display_id=$2 AND birthday_allowed AND profile_allowed AND NOT(person_id=ANY($3::uuid[]))`,[householdId,displayId,birthdayIds]);
    for(const personId of birthdayIds)await client.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,birthday_allowed) VALUES($1,$2,$3,true)
      ON CONFLICT(display_id,person_id) DO UPDATE SET birthday_allowed=true`,[householdId,displayId,personId]);
  }
}

async function displayContentReadiness(db:DbClient,display:DisplayContext):Promise<{calendar:'privacy'|'none_selected'|'external_disabled'|'not_shared'|'ready'}>{
  if(display.privacyMode)return{calendar:'privacy'};
  if(!display.externalItemsEnabled||!display.cards.includes('external_items'))return{calendar:'external_disabled'};
  const shared=await db.query<{applicable:boolean|null;shared_count:number}>(`SELECT bool_or(source.subject_household OR EXISTS(SELECT 1 FROM calendar_source_person_subjects subject WHERE subject.household_id=source.household_id AND subject.source_id=source.id AND subject.person_id=ANY($5::uuid[]))) AS applicable,count(*)::int AS shared_count FROM calendar_sources source
    JOIN calendar_connections calendar ON calendar.id=source.connection_id AND calendar.household_id=source.household_id
    JOIN integration_connections connection ON connection.id=calendar.integration_connection_id AND connection.household_id=calendar.household_id AND connection.revoked_at IS NULL
    JOIN integration_connection_display_grants permission ON permission.household_id=connection.household_id AND permission.connection_id=connection.id AND permission.display_id=$2
    JOIN calendar_source_display_targets source_permission ON source_permission.household_id=source.household_id AND source_permission.source_id=source.id AND source_permission.display_id=$2
    WHERE source.household_id=$1 AND source.enabled AND calendar.disconnected_at IS NULL
      AND ($3::boolean OR source.id=ANY($4::uuid[]))`,[display.householdId,display.id,display.allSources,display.calendarSourceIds,display.selectedPersonIds]);
  const available=shared.rows[0]!;
  return{calendar:available.applicable?'ready':available.shared_count>0&&!display.selectedPersonIds.length?'none_selected':'not_shared'};
}
async function displayAdministrativeResponse(db:DbClient,householdId:string,displayId:string):Promise<Record<string,unknown>>{
  const row=(await db.query<DisplayContextRow&{credential_hash:string|null;revoked_at:Date|null;last_seen_at:Date|null;created_at:Date}>(`SELECT d.*,COALESCE(d.locale,s.locale) AS locale,COALESCE(d.theme,s.theme) AS theme,
    d.locale AS locale_override,d.theme AS theme_override,s.locale AS setup_locale,s.theme AS setup_theme,s.name AS setup_name,
    s.cards,s.card_order,s.family_layout_enabled,s.all_sources,s.all_sensors,s.album_ids,s.background_id
    FROM displays d JOIN display_setups s ON s.id=d.setup_id AND s.household_id=d.household_id WHERE d.id=$1 AND d.household_id=$2`,[displayId,householdId])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);
  const context=await displayContextFromRow(row,row.credential_hash??'',false,db);
  return{id:row.id,name:row.name,setup_id:row.setup_id,locale:row.locale,theme:row.theme,privacy_mode:row.privacy_mode,external_items_enabled:row.external_items_enabled,revoked_at:row.revoked_at,last_seen_at:row.last_seen_at,created_at:row.created_at,
    profile_person_ids:context.profilePersonIds,birthday_person_ids:context.birthdayPersonIds,
    credentialGeneration:row.credential_generation,birthdayMode:row.birthday_mode,personIdsOverride:row.person_ids_override,localeOverride:row.locale_override,themeOverride:row.theme_override,setupName:row.setup_name,
    setupDefaults:{locale:row.setup_locale,theme:row.setup_theme,personIds:context.setupPersonIds},
    effective:{locale:row.locale,theme:row.theme,personIds:context.selectedPersonIds},contentReadiness:await displayContentReadiness(db,context)};
}

async function defaultDisplaySetup(client:DbClient,householdId:string):Promise<string>{
  const household=(await client.query<{default_locale:'en'|'nb'}>('SELECT default_locale FROM households WHERE id=$1 FOR UPDATE',[householdId])).rows[0];
  if(!household)throw new DomainError('NOT_FOUND',404);
  const inserted=await client.query<{id:string}>(`INSERT INTO display_setups(household_id,name,locale,theme,is_default,all_sources,all_sensors)
    VALUES($1,'Default display setup',$2,'system',true,true,true)
    ON CONFLICT (household_id) WHERE is_default DO NOTHING RETURNING id`,[householdId,household.default_locale]);
  if(inserted.rowCount){
    await client.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) SELECT $1,$2,id FROM persons WHERE household_id=$1',[householdId,inserted.rows[0]!.id]);
    return inserted.rows[0]!.id;
  }
  const existing=(await client.query<{id:string}>('SELECT id FROM display_setups WHERE household_id=$1 AND is_default',[householdId])).rows[0];
  if(!existing)throw new DomainError('CONFLICT',409);
  return existing.id;
}

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

async function displayCanComposeMessage(display:DisplayContext):Promise<boolean>{
  if(display.privacyMode||!display.cards.includes('new_message'))return false;
  const row=(await pool.query<{available:boolean}>(`SELECT policy.message_create AND (
      EXISTS(SELECT 1 FROM display_action_people allowed WHERE allowed.household_id=policy.household_id AND allowed.display_id=policy.display_id)
      OR EXISTS(SELECT 1 FROM display_action_displays allowed JOIN displays recipient ON recipient.id=allowed.recipient_display_id AND recipient.household_id=allowed.household_id
        WHERE allowed.household_id=policy.household_id AND allowed.display_id=policy.display_id AND recipient.revoked_at IS NULL AND recipient.credential_expires_at>clock_timestamp())
    ) AS available FROM display_action_policies policy WHERE policy.household_id=$1 AND policy.display_id=$2`,[display.householdId,display.id])).rows[0];
  return row?.available===true;
}

async function projectionFor(display: DisplayContext,options:{markDelivered?:boolean;preview?:boolean;previewTag?:string}={}): Promise<Record<string, unknown>> {
  const now = new Date();
  const hardCache = new Date(now.getTime() + 15 * 60_000);
  const label=await pool.query<{display_name:string;household_name:string;timezone:string;show_upcoming_birthday:boolean}>(`SELECT d.name AS display_name,h.name AS household_name,h.timezone,h.show_upcoming_birthday FROM displays d JOIN households h ON h.id=d.household_id WHERE d.id=$1 AND h.id=$2`,[display.id,display.householdId]);
  const cards = display.privacyMode || !display.cards.includes('household_messages') ? [] : (await pool.query<{
        id:string; body:string; importance:string; publish_at:Date; expires_at:Date; revision:number; author_name:string; author_type:'member'|'display';author_display_id:string|null; author_person_id:string|null; author_avatar_key:string|null;author_color_token:string|null;author_photo_revision:number|null;acl_witness:string
  }>(`SELECT ${displayMessageWitnessSql('$1','$3','m')} AS acl_witness,m.id,m.body,m.importance,m.publish_at,m.expires_at,m.revision,COALESCE(p.display_name,m.author_display_name) AS author_name,
      CASE WHEN m.author_display_id IS NULL THEN 'member' ELSE 'display' END AS author_type,m.author_display_id,p.id AS author_person_id,p.avatar_key AS author_avatar_key,p.color_token AS author_color_token,ph.revision AS author_photo_revision
      FROM messages m JOIN message_display_targets t ON t.message_id=m.id AND t.household_id=m.household_id
      LEFT JOIN memberships ms ON ms.id=m.author_membership_id LEFT JOIN persons p ON p.id=ms.person_id AND p.household_id=m.household_id
      LEFT JOIN person_profile_photos ph ON ph.person_id=p.id AND ph.household_id=p.household_id
      WHERE t.display_id=$1 AND m.household_id=$2 AND m.state='published' AND t.delivery_state IN ('queued','delivered','displayed')
        AND (m.audience_household OR NOT EXISTS(SELECT 1 FROM message_person_audiences restricted WHERE restricted.message_id=m.id)
          OR EXISTS(SELECT 1 FROM message_person_audiences selected WHERE selected.message_id=m.id AND selected.person_id=ANY($3::uuid[])))
        AND m.publish_at<=clock_timestamp() AND m.expires_at>clock_timestamp()
      ORDER BY CASE m.importance WHEN 'attention' THEN 0 ELSE 1 END,m.publish_at,m.id LIMIT ${DISPLAY_MESSAGE_CARD_LIMIT}`, [display.id, display.householdId,display.selectedPersonIds])).rows.map((row) => {rememberDisplayMessages(display,[row]);return({
        id: row.id, kind: 'household_message', body: row.body, importance: row.importance,
        author: row.author_name,authorType:row.author_type,authorDisplayId:row.author_display_id, authorPersonId: row.author_person_id, authorAvatarKey: row.author_avatar_key,authorColorToken:row.author_person_id&&display.selectedPersonIds.includes(row.author_person_id)?row.author_color_token:null,authorPhoto:row.author_person_id&&display.selectedPersonIds.includes(row.author_person_id)?(options.preview?previewPhotoProjection(display.householdId,display.id,row.author_person_id,row.author_photo_revision,options.previewTag??''):displayPhotoProjection(row.author_person_id,row.author_photo_revision)):null, publishAt: row.publish_at.toISOString(), expiresAt: row.expires_at.toISOString(), revision: row.revision
      });});
  if(options.markDelivered!==false&&!display.privacyMode && cards.length){
    const cardIds=cards.map((card)=>(card as {id:string}).id);
    await pool.query(`UPDATE message_display_targets t SET delivery_state='delivered',delivered_revision=m.revision,delivered_at=clock_timestamp(),displayed_at=CASE WHEN t.delivered_revision IS DISTINCT FROM m.revision THEN NULL ELSE t.displayed_at END
      FROM messages m WHERE t.message_id=m.id AND t.display_id=$1 AND m.id=ANY($2::uuid[])
      AND m.state='published' AND m.publish_at<=clock_timestamp() AND m.expires_at>clock_timestamp()
      AND t.delivery_state IN ('queued','delivered','displayed')
      AND EXISTS(SELECT 1 FROM displays d WHERE d.id=t.display_id AND d.revoked_at IS NULL AND d.credential_hash=$3 AND d.credential_generation=$4 AND d.credential_expires_at>clock_timestamp())
      AND (t.delivery_state='queued' OR t.delivered_revision IS DISTINCT FROM m.revision)`,[display.id,cardIds,display.credentialHash,display.credentialGeneration]);
  }
  const hub=await displayHub(display);
  const familyProfiles=(!display.privacyMode && display.familyLayoutEnabled && display.cards.includes('family_layout') && display.profilePersonIds.length)
    ?(await pool.query<{id:string;display_name:string;avatar_key:string|null;color_token:string;photo_revision:number|null}>(`SELECT p.id,p.display_name,p.avatar_key,p.color_token,ph.revision AS photo_revision FROM persons p
      JOIN display_person_grants profile ON profile.household_id=p.household_id AND profile.person_id=p.id AND profile.display_id=$4 AND profile.profile_allowed
      LEFT JOIN person_profile_photos ph ON ph.person_id=p.id AND ph.household_id=p.household_id
      WHERE p.household_id=$1 AND p.id=ANY($2::uuid[]) AND p.id=ANY($3::uuid[]) ORDER BY p.display_name,p.id`,[display.householdId,display.selectedPersonIds,display.profilePersonIds,display.id])).rows:[];
  const birthdayPeople=display.privacyMode||display.birthdayMode==='off'?[]
    :display.birthdayMode==='all'
      ?(await pool.query<{id:string;display_name:string;birth_date:string}>(`SELECT id,display_name,birth_date::text FROM persons WHERE household_id=$1 AND birth_date IS NOT NULL ORDER BY display_name,id`,[display.householdId])).rows
      :display.familyLayoutEnabled&&display.cards.includes('family_layout')&&label.rows[0]?.show_upcoming_birthday&&display.birthdayPersonIds.length
        ?(await pool.query<{id:string;display_name:string;birth_date:string}>(`SELECT p.id,p.display_name,p.birth_date::text FROM persons p
          JOIN display_person_grants birthday ON birthday.household_id=p.household_id AND birthday.person_id=p.id AND birthday.display_id=$4 AND birthday.birthday_allowed
          WHERE p.household_id=$1 AND p.id=ANY($2::uuid[]) AND p.id=ANY($3::uuid[]) AND p.birth_date IS NOT NULL ORDER BY p.display_name,p.id`,[display.householdId,display.selectedPersonIds,display.birthdayPersonIds,display.id])).rows:[];
  const localToday=localDateInTimezone(now,label.rows[0]?.timezone??'UTC');
  const upcomingBirthdays=birthdaysDueSoon(birthdayPeople.map((person)=>({id:person.id,displayName:person.display_name,birthDate:person.birth_date})),localToday);
  const contentReadiness=await displayContentReadiness(pool,display);
  const [boardGrant,boardActions]=await Promise.all([
    pool.query<{grocery_read:boolean;dinner_read:boolean}>(`SELECT grocery_read,dinner_read FROM display_board_read_grants WHERE household_id=$1 AND display_id=$2`,[display.householdId,display.id]),
    pool.query<{grocery_write:boolean;dinner_write:boolean;home_assistant_control:boolean}>(`SELECT grocery_write,dinner_write,home_assistant_control FROM display_action_policies WHERE household_id=$1 AND display_id=$2`,[display.householdId,display.id])
  ]).then(([grants,actions])=>[grants.rows[0],actions.rows[0]] as const);
  const boardReadable={
    groceries:!display.privacyMode&&display.cards.includes('groceries')&&boardGrant?.grocery_read===true,
    dinners:!display.privacyMode&&display.cards.includes('dinners')&&boardGrant?.dinner_read===true
  };
  const boardWritable={groceries:boardReadable.groceries&&boardActions?.grocery_write===true,dinners:boardReadable.dinners&&boardActions?.dinner_write===true};
  const boardWeekEnd=dateOffset(localToday,6);
  const groceries=(!display.privacyMode&&display.cards.includes('groceries')&&boardGrant?.grocery_read)
    ?(await pool.query(`SELECT item.id,item.label,item.checked,item.revision FROM household_grocery_items item WHERE item.household_id=$1 AND item.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM display_board_read_grants grant_row JOIN displays device ON device.id=grant_row.display_id AND device.household_id=grant_row.household_id
        JOIN display_setups setup ON setup.id=device.setup_id AND setup.household_id=device.household_id WHERE grant_row.household_id=$1 AND grant_row.display_id=$2 AND grant_row.grocery_read AND device.privacy_mode=false AND ($3::boolean OR setup.cards ? 'groceries'))
      ORDER BY item.created_at,item.id LIMIT 200`,[display.householdId,display.id,Boolean(options.preview)])).rows:[];
  const dinners=(!display.privacyMode&&display.cards.includes('dinners')&&boardGrant?.dinner_read)
    ?(await pool.query(`SELECT assignment.id,assignment.local_date::text AS "localDate",CASE WHEN assignment.deleted_at IS NULL THEN assignment.title_snapshot ELSE NULL END AS title,
      CASE WHEN assignment.deleted_at IS NULL THEN assignment.emoji_snapshot ELSE NULL END AS emoji,assignment.revision,(assignment.deleted_at IS NOT NULL) AS cleared FROM household_dinner_assignments assignment
      WHERE assignment.household_id=$1 AND assignment.local_date BETWEEN $3::date AND $4::date
        AND EXISTS(SELECT 1 FROM display_board_read_grants grant_row JOIN displays device ON device.id=grant_row.display_id AND device.household_id=grant_row.household_id
          JOIN display_setups setup ON setup.id=device.setup_id AND setup.household_id=device.household_id WHERE grant_row.household_id=$1 AND grant_row.display_id=$2 AND grant_row.dinner_read AND device.privacy_mode=false AND ($5::boolean OR setup.cards ? 'dinners'))
      ORDER BY assignment.local_date,assignment.id LIMIT 7`,[display.householdId,display.id,localToday,boardWeekEnd,Boolean(options.preview)])).rows:[];
  return {
    display: {
      id: display.id, name: label.rows[0]?.display_name, householdName: label.rows[0]?.household_name,
      timezone: label.rows[0]?.timezone, locale: display.locale, theme: display.theme,
      privacyMode: display.privacyMode, externalItemsEnabled: display.externalItemsEnabled,setupId:display.setupId,setupName:display.setupName
    },
    setup:{cards:display.cards,cardOrder:display.cardOrder,familyLayoutEnabled:display.familyLayoutEnabled,personIds:display.privacyMode?[]:display.selectedPersonIds,
      sourceIds:display.privacyMode?[]:display.sourceIds,calendarSourceIds:display.privacyMode?[]:display.calendarSourceIds,sensorIds:display.privacyMode?[]:display.sensorIds,
      albumIds:display.albumIds,backgroundId:display.backgroundId},
    birthdays:{mode:display.birthdayMode,localDate:localToday,entries:upcomingBirthdays},contentReadiness,
    displayGrants:{personIds:display.privacyMode?[]:display.grantedPersonIds.filter(id=>display.selectedPersonIds.includes(id)),profilePersonIds:display.privacyMode?[]:display.profilePersonIds.filter(id=>display.selectedPersonIds.includes(id)),birthdayPersonIds:display.privacyMode||display.birthdayMode!=='legacy_selected'?[]:display.birthdayPersonIds.filter(id=>display.selectedPersonIds.includes(id))},
    familyLayout:{enabled:!display.privacyMode&&display.familyLayoutEnabled&&display.cards.includes('family_layout'),
      people:familyProfiles.map((person)=>({id:person.id,displayName:person.display_name,avatarKey:person.avatar_key,colorToken:person.color_token,photo:options.preview?previewPhotoProjection(display.householdId,display.id,person.id,person.photo_revision,options.previewTag??''):displayPhotoProjection(person.id,person.photo_revision)})),
      upcomingBirthdays},
    cards,householdBoards:{groceries,dinners,from:localToday,to:boardWeekEnd,readable:boardReadable,writable:boardWritable},...(hub?{hub:options.preview?{...hub,people:(hub.people as Array<Record<string,unknown>>).map((person)=>{const photo=person.photo as {revision?:number}|null;return{...person,photo:previewPhotoProjection(display.householdId,display.id,String(person.id),photo?.revision??null,options.previewTag??'')};})}:hub}:{}),
    actionAvailability:{newMessage:await displayCanComposeMessage(display),homeAssistantControl:!options.preview&&!display.privacyMode&&display.cards.includes('home_assistant')&&boardActions?.home_assistant_control===true},serverNow:now.toISOString(),generatedAt:now.toISOString(),cacheUntil:hardCache.toISOString(),maxStaleSeconds:900
  };
}

export async function buildApp(options: { aiTransport?: AiHttpTransport; aiKeyFile?: string; calendarTransport?:CalendarTransport; homeAssistantControlTransport?:HomeAssistantControlTransport; photoNormalizer?:typeof normalizeProfilePhoto; mediaImageNormalizer?:typeof normalizeMediaImage; monitorFetcher?: MonitorSourceFetcher; monitorWeather?: MetWeatherClient; runtimeConfig?: RuntimeConfig; webRoot?: string; synchronousMonitorActionsForLegacyTests?:boolean; liveE2eEnabled?:boolean; logStream?:Writable } = {}): Promise<FastifyInstance> {
  const runtime = options.runtimeConfig ?? loadRuntimeConfig();
  const logger=process.env.NODE_ENV==='test'&&!options.logStream?false:{
    level:'info',...(options.logStream?{stream:options.logStream}:{}),serializers:{req:safeRequestLog}
  };
  const app = Fastify({ logger, trustProxy: runtime.trustProxy, bodyLimit: 32 * 1024, requestTimeout: 15_000 });
  const responseSecurityHeaders=browserSecurityHeaders(runtime.secureCookies);
  const aiAdmin = new AiAdminService({ transport: options.aiTransport, keyFile: options.aiKeyFile });
  const monitors = new MonitorService(aiAdmin,options.monitorFetcher,options.monitorWeather);
  const monitorEngine = new MonitorEngine(options.monitorFetcher,aiAdmin,options.monitorWeather);
  const monitorExecutions = new MonitorExecutionQueue(monitors,monitorEngine,aiAdmin);
  const calendars=new CalendarService(options.calendarTransport,new AiCredentialVault(options.aiKeyFile));
  const homeAssistantControls=new HomeAssistantControlService(calendars,options.homeAssistantControlTransport??new HomeAssistantControlClient());
  const normalizePhoto=options.photoNormalizer??normalizeProfilePhoto;
  const media=options.mediaImageNormalizer?new MediaService({normalizer:options.mediaImageNormalizer}):mediaService;
  await app.register(cookie);
  app.addHook('onSend',async(request,reply,payload)=>{
    const displayFence=displayResponseFences.get(request);displayResponseFences.delete(request);
    if(displayFence&&['GET','HEAD'].includes(request.method)&&reply.statusCode<400){
      reply.header('Cache-Control','private, no-store');
      try{await assertDisplayCredential(displayFence,true);}catch(error){
        reply.removeHeader('ETag').removeHeader('Content-Length').type('application/json; charset=utf-8');throw error;
      }
    }
    applyBrowserSecurityHeaders(reply,responseSecurityHeaders);
    return payload;
  });
  const projectionEvents=new ProjectionEventFanout();
  await projectionEvents.start();
  app.decorate('projectionStreamStats',()=>projectionEvents.stats());
  app.addHook('preClose',async()=>projectionEvents.close());
  const householdBoards=new HouseholdBoardService(async(client,actor,board,write)=>{
    const allowed=board==='groceries'?'grocery_read':'dinner_read';
    const card=board;
    const grant=(await client.query<{allowed:boolean;selected:boolean;privacy_mode:boolean}>(`SELECT read_grant.${allowed} AS allowed,
      setup.cards ? $3 AS selected,display.privacy_mode FROM display_board_read_grants read_grant
      JOIN displays display ON display.id=read_grant.display_id AND display.household_id=read_grant.household_id
      JOIN display_setups setup ON setup.id=display.setup_id AND setup.household_id=display.household_id
      WHERE read_grant.household_id=$1 AND read_grant.display_id=$2 FOR UPDATE OF read_grant,display,setup`,[actor.householdId,actor.id,card])).rows[0];
    if(!grant||!grant.allowed||!grant.selected||grant.privacy_mode)throw new DomainError('FORBIDDEN',403,{reason:'display_board_read_not_granted'});
    if(write&&!await lockDisplayAction(client,actor.householdId,actor.id,board==='groceries'?'grocery_write':'dinner_write'))throw new DomainError('FORBIDDEN',403,{reason:'display_action_not_granted'});
  });

  app.addHook('onRequest', async (request) => {
    if (!isUnsafe(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) {
      const pathname=request.url.split('?',1)[0]??request.url;
      const integrationWrite=request.method==='POST'&&pathname==='/api/v1/integrations/items';
      const integrationDelete=request.method==='DELETE'&&/^\/api\/v1\/integrations\/items\/[^/]+$/.test(pathname);
      if(integrationWrite||integrationDelete)return;
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

  const liveE2eEnabled=options.liveE2eEnabled??process.env.SAMVEV_LIVE_E2E_ENABLED==='true';
  app.get('/api/v1/e2e/fixtures/weekly-plan',async(request,reply)=>{
    if(!liveE2eEnabled)throw new DomainError('NOT_FOUND',404);
    await durableRateLimit('live_e2e_fixture',request.ip,60,60);
    const today=localDateInTimezone(new Date(),'Europe/Oslo');const tomorrow=new Date(`${today}T12:00:00.000Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const tomorrowText=tomorrow.toISOString().slice(0,10);
    return reply.header('cache-control','public, max-age=60').header('x-robots-tag','noindex, nofollow').type('text/html; charset=utf-8').send(`<!doctype html><html lang="nb"><head><meta charset="utf-8"><title>Syntetisk ukeplan</title></head><body><main><h1>Syntetisk ukeplan</h1><p>Kun for Samvev live-E2E.</p><h2>${tomorrowText}</h2><p>Uteaktivitet i morgen. Ta med klær som passer været.</p></main></body></html>`);
  });

  app.get('/api/v1/e2e/attestation',async(request,reply)=>{
    if(!liveE2eEnabled)throw new DomainError('NOT_FOUND',404);reply.header('cache-control','no-store');const session=await sessionAccount(request);await durableRateLimit('live_e2e_attestation',session.accountId,60,900);
    return{attestation:await liveE2eAttestation(session.accountId)};
  });

  app.get('/api/v1/e2e/households/:householdId/monitors/:monitorId/executions/:executionId/evidence',async(request,reply)=>{
    if(!liveE2eEnabled)throw new DomainError('NOT_FOUND',404);reply.header('cache-control','no-store');const session=await sessionAccount(request);await durableRateLimit('live_e2e_evidence',session.accountId,240,3600);
    return{evidence:await liveE2eExecutionEvidence(session.accountId,params(request).householdId!,params(request).monitorId!,params(request).executionId!)};
  });

  app.get('/api/v1/setup/status', async () => {
    const result = await pool.query<{ claimed_at: Date|null; setup_step: string; default_locale: string; demo_mode:boolean }>('SELECT claimed_at,setup_step,default_locale,demo_mode FROM installations WHERE singleton=true');
    const row = result.rows[0];
    return { claimed: Boolean(row?.claimed_at), setupStep: row?.setup_step ?? 'welcome', locale: row?.default_locale ?? 'nb', demo: row?.demo_mode ?? false, demoAvailable: process.env.SAMVEV_DEMO_MODE === 'true' };
  });

  app.get('/api/v1/public/contact',async(_request,reply)=>{
    reply.header('Cache-Control','no-store');
    return{contact:await readAnonymousPublicContact()};
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
    const colorToken=await assignPersonColor(client,householdId);
    const person = await client.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,color_token) VALUES ($1,$2,'adult',$3) RETURNING id`, [householdId,body.owner.displayName,colorToken]);
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
    const account = await pool.query(`SELECT id,installation_id,email_normalized AS email,locale,theme FROM accounts WHERE id=$1`, [session.accountId]);
    const memberships = await pool.query(`SELECT m.id,m.household_id,m.person_id,m.role_preset,m.capabilities,m.revision,h.name AS household_name,h.timezone,h.default_locale AS household_locale,p.display_name,p.age_group,(m.capabilities ? 'household.view' AND p.age_group='adult') AS calendar_access,
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

  app.get('/api/v1/households/:householdId/ai/settings', async (request,reply) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    reply.header('Cache-Control','private, no-store');return aiAdmin.settings(auth.householdId,{installationId:auth.installationId,accountId:auth.accountId,membershipId:auth.membershipId});
  });

  app.patch('/api/v1/households/:householdId/ai/settings', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    const body = parse(aiSettingsUpdateSchema, request.body);
    const result = await aiAdmin.updateSettings(auth.householdId, body,{installationId:auth.installationId,accountId:auth.accountId,membershipId:auth.membershipId});
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
    const result = await aiAdmin.testConnection(auth.householdId,body.modelTier,{ownerAccountId:auth.accountId,ownerMembershipId:auth.membershipId,category:'test',phase:'connection_test'});
    await audit(pool, auth, 'ai.connection_tested', 'ai_settings', auth.householdId, {
      provider: result.provider, modelTier: body.modelTier, available: result.available
    });
    return result;
  });

  app.get('/api/v1/households/:householdId/ai/usage', async (request,reply) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.manage');
    reply.header('Cache-Control','private, no-store');const query=parse(aiUsageQuerySchema,request.query??{});return aiAdmin.usage(auth.householdId,query.days,auth.accountId);
  });

  app.post('/api/v1/households/:householdId/ai/chatgpt/helper',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    await operationRateLimit(request,auth,'chatgpt_helper',{account:10,household:30,ip:20,windowSeconds:3600});
    await transaction(async(client)=>{await client.query(`INSERT INTO ai_chatgpt_helper_profiles(household_id,account_id) VALUES($1,$2) ON CONFLICT(household_id,account_id) DO UPDATE SET updated_at=clock_timestamp()`,[auth.householdId,auth.accountId]);await audit(client,auth,'ai.chatgpt_helper_prepared','ai_chatgpt_helper_profile',auth.accountId,{tokenFree:true});});
    const hostId=await aiAdmin.chatgpt.hostId(auth.installationId);
    const base=`${runtime.publicOrigin}/api/v1/households/${auth.householdId}/ai/chatgpt/helper-files`;
    const output='$HOME/samvev-chatgpt-credential.json',registration='$HOME/.config/samvev/chatgpt-registration.json';
    reply.header('Cache-Control','private, no-store');
    return{status:'ready_for_local_consent',hostId,downloads:[{name:'chatgpt-connect.ts',url:`${base}/chatgpt-connect.ts`},{name:'chatgpt-connect-core.mjs',url:`${base}/chatgpt-connect-core.mjs`}],localCommand:`node ./chatgpt-connect.ts --host-id '${hostId}' --registration \"${registration}\" --output \"${output}\"`,serverImportCommand:`bash scripts/chatgpt-import-runtime.sh --household '${auth.householdId}' --owner-account '${auth.accountId}' --file '<private-credential-path>'`,requiresLocalBrowserConsent:true,automaticallyImports:false,automaticallyCallsModel:false};
  });
  app.get('/api/v1/households/:householdId/ai/chatgpt/helper-files/:file',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');const file=params(request).file!;
    if(file!=='chatgpt-connect.ts'&&file!=='chatgpt-connect-core.mjs')throw new DomainError('NOT_FOUND',404);
    const data=await readFile(new URL(`../../../scripts/${file}`,import.meta.url));
    return reply.header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename=\"${file}\"`).type(file.endsWith('.mjs')?'text/javascript; charset=utf-8':'application/typescript; charset=utf-8').send(data);
  });

  app.post('/api/v1/households/:householdId/ai/chatgpt/import',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    if(!runtime.secureCookies)throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'secure_import_required',command:'npm run ai:chatgpt-import'});
    const body=parse(aiChatGptImportSchema,request.body);const registration=await aiAdmin.chatgpt.import(auth,body.credential,body.expectedRevision);await audit(pool,auth,'ai.chatgpt_imported','ai_chatgpt_registration',(registration as {id:string}).id);return reply.status(201).send({registration});
  });
  app.get('/api/v1/households/:householdId/ai/chatgpt/:registrationId/models',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');reply.header('Cache-Control','private, no-store');return aiAdmin.chatgpt.models(auth,params(request).registrationId!);
  });
  app.post('/api/v1/households/:householdId/ai/chatgpt/:registrationId/disconnect',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');const body=parse(aiChatGptDisconnectSchema,request.body);const result=await aiAdmin.chatgpt.disconnect(auth,params(request).registrationId!,body.expectedRevision);await audit(pool,auth,'ai.chatgpt_disconnected','ai_chatgpt_registration',params(request).registrationId!,{revocationConfirmed:result.revocationConfirmed});return result;
  });
  app.post('/api/v1/households/:householdId/ai/chatgpt/:registrationId/resume',async(request)=>{const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');const body=parse(aiChatGptDisconnectSchema,request.body);return{registration:await aiAdmin.chatgpt.resume(auth,params(request).registrationId!,body.expectedRevision)};});
  app.post('/api/v1/households/:householdId/ai/chatgpt/:registrationId/select',async(request)=>{const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');const body=parse(aiChatGptSelectSchema,request.body);const result=await aiAdmin.chatgpt.select(auth,params(request).registrationId!,body.expectedRevision);await audit(pool,auth,'ai.chatgpt_selected','ai_chatgpt_registration',params(request).registrationId!);return result;});

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
  app.post('/api/v1/households/:householdId/monitors/:monitorId/interpret', async (request,reply) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    await durableRateLimit('monitor_interpret',auth.householdId,30,3600);
    const body=parse(monitorTaskRevisionSchema,request.body);if(options.synchronousMonitorActionsForLegacyTests)return monitors.interpret(auth,params(request).monitorId!,body.expectedRevision);const run=await monitorExecutions.enqueue(auth,params(request).monitorId!,body.expectedRevision,'interpretation');return reply.status(202).send({run});
  });
  for(const action of ['approve','pause','resume'] as const)app.post(`/api/v1/households/:householdId/monitors/:monitorId/${action}`,async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskRevisionSchema,request.body);return monitors.setState(auth,params(request).monitorId!,body.expectedRevision,action);
  });
  for(const action of ['test','run','smarter'] as const)app.post(`/api/v1/households/:householdId/monitors/:monitorId/${action}`,async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskRevisionSchema,request.body);await durableRateLimit('monitor_manual_run',auth.householdId,30,3600);
    const kind=action==='run'?'manual':action;if(options.synchronousMonitorActionsForLegacyTests)return monitorEngine.runManual(auth,params(request).monitorId!,body.expectedRevision,kind);const run=await monitorExecutions.enqueue(auth,params(request).monitorId!,body.expectedRevision,kind);return reply.status(202).send({run});
  });
  app.get('/api/v1/households/:householdId/monitors/:monitorId/runs/:runId',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');return{run:await monitorExecutions.get(auth,params(request).monitorId!,params(request).runId!)};
  });
  app.post('/api/v1/households/:householdId/monitors/:monitorId/quality',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskQualitySchema,request.body);return monitors.setQuality(auth,params(request).monitorId!,body.expectedRevision,body.quality);
  });
  app.patch('/api/v1/households/:householdId/monitors/:monitorId/subjects',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    return replaceMonitorSubjects(auth,params(request).monitorId!,parse(monitorTaskSubjectsSchema,request.body));
  });
  app.get('/api/v1/households/:householdId/monitors/:monitorId/presentation',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');reply.header('Cache-Control','private, no-store');
    const row=(await pool.query<{presentation_kind:string|null;school_end_local_time:string|null;presentation_revision:number}>(`SELECT presentation_kind,school_end_local_time::text,presentation_revision FROM monitor_tasks WHERE id=$1 AND household_id=$2`,[params(request).monitorId,auth.householdId])).rows[0];
    if(!row)throw new DomainError('NOT_FOUND',404);
    return{taskId:params(request).monitorId,presentationKind:row.presentation_kind,schoolEndLocalTime:row.school_end_local_time?.slice(0,5)??null,presentationRevision:row.presentation_revision};
  });
  app.put('/api/v1/households/:householdId/monitors/:monitorId/presentation',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');reply.header('Cache-Control','private, no-store');
    await operationRateLimit(request,auth,'monitor_presentation_update',{account:60,household:240,ip:120,windowSeconds:3600});
    return updateMonitorPresentation(auth,params(request).monitorId!,parse(monitorPresentationUpdateSchema,request.body));
  });
  app.put('/api/v1/households/:householdId/monitors/:monitorId/results/:runId/review',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    return reviewMonitorResult(auth,params(request).monitorId!,params(request).runId!,parse(monitorResultReviewSchema,request.body));
  });
  app.delete('/api/v1/households/:householdId/monitors/:monitorId',async (request,reply) => {
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const body=parse(monitorTaskRevisionSchema,request.body);await monitors.remove(auth,params(request).monitorId!,body.expectedRevision);return reply.status(204).send();
  });

  app.get('/api/v1/households/:householdId/people', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.view');
    const canManagePeople=auth.capabilities.includes('people.manage');
    const canManageAccounts=auth.capabilities.includes('account.manage');
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;
    const today=localDateInTimezone(new Date(),household.timezone);
    const result = await pool.query(`SELECT p.id,p.display_name,p.avatar_key AS "avatarKey",p.color_token AS "colorToken",p.age_group,p.revision AS person_revision,p.photo_revision AS "photoRevision",ph.revision AS asset_photo_revision,
      CASE WHEN $2 THEN p.birth_date::text ELSE NULL END AS birth_date,m.id AS membership_id,m.role_preset,
      CASE WHEN $2 THEN m.capabilities ELSE '[]'::jsonb END AS capabilities,m.revision,
      (m.account_id IS NOT NULL) AS has_login,(m.account_id IS NOT NULL AND a.password_hash IS NOT NULL AND a.disabled_at IS NULL) AS has_active_login,
      CASE WHEN m.account_id IS NULL THEN 'profile' WHEN a.disabled_at IS NOT NULL THEN 'disabled' WHEN a.password_hash IS NULL THEN 'pending' ELSE 'active' END AS account_status,
      CASE WHEN $3 THEN a.email_normalized ELSE NULL END AS email,
      CASE WHEN $3 THEN a.id ELSE NULL END AS account_id,
      CASE WHEN $3 THEN a.revision ELSE NULL END AS account_revision,
      CASE WHEN $2 THEN COALESCE((SELECT json_agg(display_id) FROM membership_display_grants g WHERE g.membership_id=m.id),'[]') ELSE '[]'::json END AS display_ids
      FROM persons p LEFT JOIN memberships m ON m.person_id=p.id AND m.household_id=p.household_id LEFT JOIN accounts a ON a.id=m.account_id
      LEFT JOIN person_profile_photos ph ON ph.person_id=p.id AND ph.household_id=p.household_id
      WHERE p.household_id=$1 ORDER BY p.created_at`, [auth.householdId,canManagePeople,canManageAccounts]);
    return { people: result.rows.map((row)=>{
      const person=row as Record<string,unknown>;person.photo=photoProjection(auth.householdId,String(person.id),typeof person.asset_photo_revision==='number'?person.asset_photo_revision:null);delete person.asset_photo_revision;
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

  app.get('/api/v1/households/:householdId/people/:personId/monitors',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    const person=await pool.query('SELECT id FROM persons WHERE id=$1 AND household_id=$2',[params(request).personId,auth.householdId]);
    if(!person.rowCount)throw new DomainError('NOT_FOUND',404);
    reply.header('Cache-Control','private, no-store');
    return{tasks:await personMonitorSummaries(pool,auth.householdId,params(request).personId!,auth.accountId)};
  });

  app.put('/api/v1/households/:householdId/people/:personId/photo',{bodyLimit:14_100_000},async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);const personId=params(request).personId!;
    if(auth.personId!==personId)requireCapability(auth.capabilities,'people.manage');
    await operationRateLimit(request,auth,'person_photo_upload',{account:30,household:120,ip:60,windowSeconds:3600});
    const body=parse(personPhotoUploadSchema,request.body);const photo=await normalizePhoto(body.imageBase64,body.crop);
    const result=await transaction(async(client)=>{
      // Actor before target; session KEY SHARE permits last_seen updates and
      // revocation, while account/membership SHARE holds identity and grants.
      await recheckPersonPhotoAuth(client,request,auth,personId);
      const person=(await client.query<{photo_revision:number}>('SELECT photo_revision FROM persons WHERE id=$1 AND household_id=$2 FOR UPDATE',[personId,auth.householdId])).rows[0];
      if(!person)throw new DomainError('NOT_FOUND',404);
      if(person.photo_revision!==body.expectedPhotoRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'photo'});
      const next=person.photo_revision+1;
      await client.query(`INSERT INTO person_profile_photos(person_id,household_id,revision,content_sha256,original_mime,width,height,variant_96,variant_512,updated_by_account_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(person_id) DO UPDATE SET revision=EXCLUDED.revision,content_sha256=EXCLUDED.content_sha256,original_mime=EXCLUDED.original_mime,width=EXCLUDED.width,height=EXCLUDED.height,variant_96=EXCLUDED.variant_96,variant_512=EXCLUDED.variant_512,updated_by_account_id=EXCLUDED.updated_by_account_id,updated_at=clock_timestamp()`,[personId,auth.householdId,next,photo.contentSha256,photo.originalMime,photo.width,photo.height,photo.variant96,photo.variant512,auth.accountId]);
      await client.query('UPDATE persons SET photo_revision=$3 WHERE id=$1 AND household_id=$2',[personId,auth.householdId,next]);
      await audit(client,auth,'person.photo_updated','person',personId,{photoRevision:next});
      // The target/image/audit operations can wait. Do not acquire more locks
      // here; evaluate current authority and real expiry after every wait.
      await recheckPersonPhotoAuth(client,request,auth,personId,false);return next;
    });
    reply.header('Cache-Control','private, no-store');return{personId,photoRevision:result};
  });

  app.delete('/api/v1/households/:householdId/people/:personId/photo',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);const personId=params(request).personId!;
    if(auth.personId!==personId)requireCapability(auth.capabilities,'people.manage');
    const body=parse(personPhotoRevisionSchema,request.body);
    await transaction(async(client)=>{
      await recheckPersonPhotoAuth(client,request,auth,personId);
      const person=(await client.query<{photo_revision:number}>('SELECT photo_revision FROM persons WHERE id=$1 AND household_id=$2 FOR UPDATE',[personId,auth.householdId])).rows[0];if(!person)throw new DomainError('NOT_FOUND',404);
      if(person.photo_revision!==body.expectedPhotoRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'photo'});
      const deleted=await client.query('DELETE FROM person_profile_photos WHERE person_id=$1 AND household_id=$2 RETURNING person_id',[personId,auth.householdId]);
      if(!deleted.rowCount)throw new DomainError('NOT_FOUND',404);
      await client.query('UPDATE persons SET photo_revision=photo_revision+1 WHERE id=$1 AND household_id=$2',[personId,auth.householdId]);
      await audit(client,auth,'person.photo_removed','person',personId,{photoRevision:body.expectedPhotoRevision});
      await recheckPersonPhotoAuth(client,request,auth,personId,false);
    });
    return reply.status(204).send();
  });

  app.get('/api/v1/households/:householdId/people/:personId/photo/:variant',async(request,reply)=>{
    const householdId=params(request).householdId!,personId=params(request).personId!,variant=params(request).variant!;
    if(!['96','512'].includes(variant))throw new DomainError('NOT_FOUND',404);
    const requestedRevision=Number((request.query as Record<string,unknown>).v);
    if(!Number.isSafeInteger(requestedRevision)||requestedRevision<1)throw new DomainError('NOT_FOUND',404);
    const auth=await authForHousehold(request,householdId);requireCapability(auth.capabilities,'household.view');
    const photo=(await pool.query<{revision:number;content_sha256:string;data:Buffer}>(`SELECT revision,content_sha256,${variant==='96'?'variant_96':'variant_512'} AS data FROM person_profile_photos WHERE person_id=$1 AND household_id=$2`,[personId,householdId])).rows[0];
    if(!photo||photo.revision!==requestedRevision)throw new DomainError('NOT_FOUND',404);const etag=`\"photo-${photo.revision}-${createHash('sha256').update(photo.data).digest('hex').slice(0,16)}-${variant}\"`;
    reply.header('Cache-Control','private, no-store').header('ETag',etag).header('X-Content-Type-Options','nosniff').type('image/webp');
    if(request.headers['if-none-match']===etag)return reply.status(304).send();return reply.send(photo.data);
  });

  app.get('/api/v1/display/people/:personId/photo/:variant',async(request,reply)=>{
    const display=await displayAuth(request);const personId=params(request).personId!,variant=params(request).variant!;
    if(!['96','512'].includes(variant))throw new DomainError('NOT_FOUND',404);
    const requestedRevision=Number((request.query as Record<string,unknown>).v);
    if(!Number.isSafeInteger(requestedRevision)||requestedRevision<1)throw new DomainError('NOT_FOUND',404);
    if(!await displayPersonPhotoVisible(display,personId))throw new DomainError('NOT_FOUND',404);
    const requested=(await pool.query<{revision:number}>(`SELECT revision FROM person_profile_photos WHERE person_id=$1 AND household_id=$2`,[personId,display.householdId])).rows[0];
    if(!requested||requested.revision!==requestedRevision)throw new DomainError('NOT_FOUND',404);
    const photo=await transaction(async(client)=>{
      const current=await displayContextForManager(display.householdId,display.id,client,true,true);
      current.itemWitnesses=display.itemWitnesses;current.messageWitnesses=display.messageWitnesses;
      if(current.credentialHash!==display.credentialHash||current.privacyMode!==display.privacyMode||current.externalItemsEnabled!==display.externalItemsEnabled)throw new DomainError('UNAUTHENTICATED',401);
      if(!await displayPersonPhotoVisible(current,personId,client,true))throw new DomainError('NOT_FOUND',404);
      const selected=(await client.query<{revision:number;content_sha256:string;data:Buffer}>(`SELECT revision,content_sha256,${variant==='96'?'variant_96':'variant_512'} AS data FROM person_profile_photos WHERE person_id=$1 AND household_id=$2 FOR SHARE`,[personId,display.householdId])).rows[0];
      if(!selected||selected.revision!==requestedRevision)throw new DomainError('NOT_FOUND',404);
      if(!await displayPersonPhotoVisible(current,personId,client,true))throw new DomainError('NOT_FOUND',404);
      const active=(await client.query(`SELECT id FROM displays WHERE id=$1 AND household_id=$2 AND credential_hash=$3 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp()`,[display.id,display.householdId,display.credentialHash])).rows[0];
      if(!active)throw new DomainError('UNAUTHENTICATED',401);
      return selected;
    });
    const etag=`\"photo-${photo.revision}-${createHash('sha256').update(photo.data).digest('hex').slice(0,16)}-${variant}\"`;
    reply.header('Cache-Control','private, no-store').header('ETag',etag).header('X-Content-Type-Options','nosniff').type('image/webp');
    if(request.headers['if-none-match']===etag)return reply.status(304).send();return reply.send(photo.data);
  });

  app.get('/api/v1/households/:householdId/displays/:displayId/preview/people/:personId/photo/:variant',async(request,reply)=>{
    const householdId=params(request).householdId!,displayId=params(request).displayId!,personId=params(request).personId!,variant=params(request).variant!;
    if(!['96','512'].includes(variant))throw new DomainError('NOT_FOUND',404);
    const revision=Number((request.query as Record<string,unknown>).v);if(!Number.isSafeInteger(revision)||revision<1)throw new DomainError('NOT_FOUND',404);
    const selection=parsePreviewContextTag((request.query as Record<string,unknown>).s);const auth=await authForHousehold(request,householdId);requireCapability(auth.capabilities,'display.manage');
    const device=await displayContextForManager(householdId,displayId);const candidate:DisplayContext={...device,cards:selection.cards,familyLayoutEnabled:selection.familyLayoutEnabled,allSources:selection.allSources,allSensors:selection.allSensors,selectedPersonIds:device.personIdsOverride??selection.personIds,sourceIds:selection.sourceIds,calendarSourceIds:selection.calendarSourceIds,sensorIds:selection.sensorIds,albumIds:selection.albumIds,backgroundId:selection.backgroundId};
    if(!await displayPersonPhotoVisible(candidate,personId))throw new DomainError('NOT_FOUND',404);
    const requested=(await pool.query<{revision:number}>(`SELECT revision FROM person_profile_photos WHERE person_id=$1 AND household_id=$2`,[personId,householdId])).rows[0];
    if(!requested||requested.revision!==revision)throw new DomainError('NOT_FOUND',404);
    const photo=await transaction(async(client)=>{
      // Match media operations: lock manager authority before the target device.
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      const currentDevice=await displayContextForManager(householdId,displayId,client,true,true);
      if(currentDevice.credentialHash!==device.credentialHash||currentDevice.privacyMode!==device.privacyMode||currentDevice.externalItemsEnabled!==device.externalItemsEnabled)throw new DomainError('NOT_FOUND',404);
      const current:DisplayContext={...currentDevice,cards:selection.cards,familyLayoutEnabled:selection.familyLayoutEnabled,allSources:selection.allSources,allSensors:selection.allSensors,selectedPersonIds:currentDevice.personIdsOverride??selection.personIds,sourceIds:selection.sourceIds,calendarSourceIds:selection.calendarSourceIds,sensorIds:selection.sensorIds,albumIds:selection.albumIds,backgroundId:selection.backgroundId};
      if(!await displayPersonPhotoVisible(current,personId,client,true))throw new DomainError('NOT_FOUND',404);
      const selected=(await client.query<{revision:number;content_sha256:string;data:Buffer}>(`SELECT revision,content_sha256,${variant==='96'?'variant_96':'variant_512'} AS data FROM person_profile_photos WHERE person_id=$1 AND household_id=$2 FOR SHARE`,[personId,householdId])).rows[0];
      if(!selected||selected.revision!==revision)throw new DomainError('NOT_FOUND',404);
      if(!await displayPersonPhotoVisible(current,personId,client,true))throw new DomainError('NOT_FOUND',404);
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      const final=(await client.query<{session_id:string}>(`SELECT session.id AS session_id FROM sessions session JOIN accounts account ON account.id=session.account_id JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$2 JOIN displays device ON device.id=$3 AND device.household_id=$2
        WHERE session.id=$1 AND session.account_id=$4 AND membership.id=$5 AND membership.capabilities ? 'display.manage' AND account.disabled_at IS NULL
          AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp() AND device.credential_hash=$6 AND device.revoked_at IS NULL AND device.credential_expires_at>clock_timestamp()
          AND device.privacy_mode=$7 AND device.external_items_enabled=$8`,[auth.sessionId,householdId,displayId,auth.accountId,auth.membershipId,device.credentialHash,device.privacyMode,device.externalItemsEnabled])).rows[0];
      if(!final)throw new DomainError('NOT_FOUND',404);
      return selected;
    });
    const etag=`\"photo-${photo.revision}-${createHash('sha256').update(photo.data).digest('hex').slice(0,16)}-${variant}\"`;
    reply.header('Cache-Control','private, no-store').header('ETag',etag).header('X-Content-Type-Options','nosniff').type('image/webp');
    if(request.headers['if-none-match']===etag)return reply.status(304).send();return reply.send(photo.data);
  });

  app.get('/api/v1/households/:householdId/media/albums',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.listAlbums(mediaActor(auth));
  });
  app.post('/api/v1/households/:householdId/media/albums',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'media_album_create',{account:30,household:100,ip:60,windowSeconds:3600});const body=parse(mediaAlbumCreateSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await media.createAlbum(mediaActor(auth),body));
  });
  app.patch('/api/v1/households/:householdId/media/albums/:albumId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.updateAlbum(mediaActor(auth),params(request).albumId!,parse(mediaAlbumUpdateSchema,request.body));
  });
  app.delete('/api/v1/households/:householdId/media/albums/:albumId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');const body=parse(mediaAssetDeleteSchema,request.body);reply.header('Cache-Control','private, no-store');return media.deleteAlbum(mediaActor(auth),params(request).albumId!,body.expectedRevision);
  });
  app.get('/api/v1/households/:householdId/media/albums/:albumId/grants',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.albumGrants(mediaActor(auth),params(request).albumId!);
  });
  app.put('/api/v1/households/:householdId/media/albums/:albumId/grants',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.setGrant(mediaActor(auth),params(request).albumId!,parse(mediaAlbumGrantSchema,request.body));
  });
  app.put('/api/v1/households/:householdId/media/albums/:albumId/displays/:displayId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');requireCapability(auth.capabilities,'display.manage');reply.header('Cache-Control','private, no-store');return media.setDisplayGrant(mediaActor(auth),params(request).albumId!,params(request).displayId!,parse(mediaDisplayGrantSchema,request.body));
  });
  app.get('/api/v1/households/:householdId/media/albums/:albumId/assets',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.listAssets(mediaActor(auth),params(request).albumId!);
  });
  app.post('/api/v1/households/:householdId/media/albums/:albumId/assets',{bodyLimit:14_500_000},async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'media_asset_upload',{account:30,household:150,ip:60,windowSeconds:3600});const body=parse(mediaAssetUploadSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await media.uploadMemberAsset(mediaActor(auth),params(request).albumId!,body));
  });
  app.patch('/api/v1/households/:householdId/media/assets/:assetId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.updateAsset(mediaActor(auth),params(request).assetId!,parse(mediaAssetUpdateSchema,request.body));
  });
  app.put('/api/v1/households/:householdId/media/assets/:assetId',{bodyLimit:14_500_000},async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'media_asset_replace',{account:30,household:150,ip:60,windowSeconds:3600});const body=parse(mediaAssetReplaceSchema,request.body);const result=await media.replaceMemberAsset(mediaActor(auth),params(request).assetId!,body);reply.header('Cache-Control','private, no-store');return result;
  });
  app.delete('/api/v1/households/:householdId/media/assets/:assetId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.deleteAsset(mediaActor(auth),params(request).assetId!,parse(mediaAssetDeleteSchema,request.body));
  });
  app.get('/api/v1/households/:householdId/media/assets/:assetId/:variant',async(request,reply)=>{
    const householdId=params(request).householdId!,assetId=params(request).assetId!,variant=params(request).variant!;if(variant!=='master'&&variant!=='preview')throw new DomainError('NOT_FOUND',404);const revision=Number((request.query as Record<string,unknown>).v);if(!Number.isSafeInteger(revision)||revision<1)throw new DomainError('NOT_FOUND',404);const auth=await authForHousehold(request,householdId);requireCapability(auth.capabilities,'household.view');const result=await media.assetBytesMember(mediaActor(auth),assetId,variant,revision,request.headers['if-none-match']);reply.header('Cache-Control','private, no-store').header('ETag',result.etag).header('X-Content-Type-Options','nosniff').type(result.contentType);if(result.notModified)return reply.status(304).send();return reply.send(result.bytes);
  });
  app.get('/api/v1/households/:householdId/displays/:displayId/preview/assets/:assetId/:variant',async(request,reply)=>{
    const householdId=params(request).householdId!,displayId=params(request).displayId!,assetId=params(request).assetId!,variant=params(request).variant!;
    if(variant!=='master'&&variant!=='preview')throw new DomainError('NOT_FOUND',404);
    const query=request.query as Record<string,unknown>,revision=Number(query.v);if(!Number.isSafeInteger(revision)||revision<1)throw new DomainError('NOT_FOUND',404);
    const selection=parsePreviewContextTag(query.s),auth=await authForHousehold(request,householdId);requireCapability(auth.capabilities,'display.manage');
    const display=await displayContextForManager(householdId,displayId);
    const result=await media.previewAssetBytes(mediaActor(auth),{id:display.id,householdId,setupId:display.setupId,privacyMode:display.privacyMode,credentialHash:display.credentialHash},selection,assetId,variant,revision,request.headers['if-none-match']);
    reply.header('Cache-Control','private, no-store').header('ETag',result.etag).header('X-Content-Type-Options','nosniff').type(result.contentType);
    if(result.notModified)return reply.status(304).send();return reply.send(result.bytes);
  });
  app.get('/api/v1/households/:householdId/media/background',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.householdBackground(mediaActor(auth));
  });
  app.put('/api/v1/households/:householdId/media/background',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return media.setHouseholdBackground(mediaActor(auth),parse(mediaBackgroundUpdateSchema,request.body));
  });
  app.get('/api/v1/display/media',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');return media.displayProjection({id:display.id,householdId:display.householdId,setupId:display.setupId,privacyMode:display.privacyMode,credentialHash:display.credentialHash});
  });
  app.post('/api/v1/display/media/albums/:albumId/assets',{bodyLimit:14_500_000},async(request,reply)=>{
    const display=await displayAuth(request);await durableRateLimit('media_display_upload_display',display.id,30,3600);await durableRateLimit('media_display_upload_ip',request.ip,60,3600);const body=parse(mediaAssetUploadSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await media.uploadDisplayAsset({id:display.id,householdId:display.householdId,setupId:display.setupId,privacyMode:display.privacyMode,credentialHash:display.credentialHash},params(request).albumId!,body));
  });
  app.get('/api/v1/display/media/assets/:assetId/:variant',async(request,reply)=>{
    const display=await displayAuth(request);const assetId=params(request).assetId!,variant=params(request).variant!;if(variant!=='master'&&variant!=='preview')throw new DomainError('NOT_FOUND',404);const revision=Number((request.query as Record<string,unknown>).v);if(!Number.isSafeInteger(revision)||revision<1)throw new DomainError('NOT_FOUND',404);const result=await media.assetBytesDisplay({id:display.id,householdId:display.householdId,setupId:display.setupId,privacyMode:display.privacyMode,credentialHash:display.credentialHash},assetId,variant,revision,request.headers['if-none-match']);reply.header('Cache-Control','private, no-store').header('ETag',result.etag).header('X-Content-Type-Options','nosniff').type(result.contentType);if(result.notModified)return reply.status(304).send();return reply.send(result.bytes);
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
      const colorToken=await assignPersonColor(client,auth.householdId);
      const person = await client.query<{id:string}>(`INSERT INTO persons(household_id,display_name,avatar_key,age_group,birth_date,color_token) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [auth.householdId,body.displayName,body.avatarKey??null,ageGroup,body.birthDate??null,colorToken]);
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
      const updated=await client.query(`UPDATE persons SET display_name=COALESCE($3,display_name),avatar_key=CASE WHEN $4 THEN $5 ELSE avatar_key END,color_token=COALESCE($6,color_token),birth_date=$7,age_group=$8,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$9 RETURNING id,display_name,avatar_key AS "avatarKey",color_token AS "colorToken",birth_date::text,age_group,revision`,[params(request).personId,auth.householdId,body.displayName??null,body.avatarKey!==undefined,body.avatarKey??null,body.colorToken??null,birthDate,ageGroup,body.expectedRevision]);
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

  app.get('/api/v1/households/:householdId/home',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');
    reply.header('Cache-Control','private, no-store');
    const household=(await pool.query<{id:string;name:string;timezone:string;default_locale:'en'|'nb';show_upcoming_birthday:boolean}>(`SELECT id,name,timezone,default_locale,show_upcoming_birthday FROM households WHERE id=$1`,[auth.householdId])).rows[0]!;
    const people=await pool.query<{id:string;display_name:string;avatar_key:string|null;color_token:string;age_group:string;birth_date:string|null;photo_revision:number;asset_photo_revision:number|null}>(`SELECT p.id,p.display_name,p.avatar_key,p.color_token,p.age_group,p.birth_date::text,p.photo_revision,ph.revision AS asset_photo_revision FROM persons p LEFT JOIN person_profile_photos ph ON ph.person_id=p.id AND ph.household_id=p.household_id WHERE p.household_id=$1 ORDER BY p.created_at,p.id`,[auth.householdId]);
    const canViewAll=auth.capabilities.includes('household.manage');
    const messages=await pool.query<{id:string;body:string;importance:string;author_name:string;author_type:'member'|'display';author_display_id:string|null;author_person_id:string|null;author_color_token:string|null;author_photo_revision:number|null;publish_at:Date;expires_at:Date;revision:number;audience_household:boolean;person_ids:string[]}>(`SELECT m.id,m.body,m.importance,COALESCE(p.display_name,m.author_display_name) AS author_name,CASE WHEN m.author_display_id IS NULL THEN 'member' ELSE 'display' END AS author_type,m.author_display_id,p.id AS author_person_id,p.color_token AS author_color_token,ph.revision AS author_photo_revision,m.publish_at,m.expires_at,m.revision,m.audience_household,
      COALESCE((SELECT json_agg(pa.person_id ORDER BY pa.person_id) FROM message_person_audiences pa WHERE pa.message_id=m.id),'[]') AS person_ids
      FROM messages m LEFT JOIN memberships am ON am.id=m.author_membership_id LEFT JOIN persons p ON p.id=am.person_id AND p.household_id=m.household_id LEFT JOIN person_profile_photos ph ON ph.person_id=p.id AND ph.household_id=p.household_id
      WHERE m.household_id=$1 AND m.state IN ('scheduled','published') AND m.expires_at>clock_timestamp()
        AND m.publish_at<clock_timestamp()+interval '2 days'
        AND NOT EXISTS(SELECT 1 FROM monitor_events school_event JOIN monitor_tasks school_task ON school_task.id=school_event.task_id AND school_task.household_id=school_event.household_id WHERE school_event.message_id=m.id AND school_task.presentation_kind='school')
        AND ($2 OR m.audience_household OR m.author_membership_id=$3 OR EXISTS(SELECT 1 FROM message_person_audiences va WHERE va.message_id=m.id AND va.person_id=$4))
      ORDER BY CASE m.importance WHEN 'attention' THEN 0 ELSE 1 END,m.publish_at,m.id LIMIT 200`,[auth.householdId,canViewAll,auth.membershipId,auth.personId]);
    const now=new Date();
    const localToday=localDateInTimezone(now,household.timezone);
    const birthdayPeople=people.rows.filter((person)=>person.birth_date).map((person)=>({id:person.id,displayName:person.display_name,birthDate:person.birth_date!}));
    const upcomingBirthday=household.show_upcoming_birthday
      ? nextBirthday(birthdayPeople,localToday)
      : null;
    const {ageTurning:_privateAgeGuess,...safeUpcomingBirthday}=upcomingBirthday??{};
    const upcomingBirthdays=household.show_upcoming_birthday?birthdaysDueSoon(birthdayPeople,localToday):[];
    return {
      household:{id:household.id,name:household.name,timezone:household.timezone,locale:household.default_locale,localDate:localToday},
      viewer:{personId:auth.personId,membershipId:auth.membershipId},
      people:people.rows.map((person)=>({id:person.id,displayName:person.display_name,avatarKey:person.avatar_key,colorToken:person.color_token,photoRevision:person.photo_revision,photo:photoProjection(auth.householdId,person.id,person.asset_photo_revision),ageGroup:person.age_group})),
      upcomingBirthday:upcomingBirthday?safeUpcomingBirthday:null,upcomingBirthdays,schoolActivities:await schoolActivitiesForHome(auth.householdId,{personId:auth.personId,membershipId:auth.membershipId},canViewAll,localToday),items:await homeItems(auth.householdId,auth.personId,canViewAll),
      messages:messages.rows.map((message)=>({
        id:message.id,body:message.body,importance:message.importance,authorName:message.author_name,authorType:message.author_type,authorDisplayId:message.author_display_id,authorPersonId:message.author_person_id,authorColorToken:message.author_color_token,authorPhoto:message.author_person_id?photoProjection(auth.householdId,message.author_person_id,message.author_photo_revision):null,
        publishAt:message.publish_at.toISOString(),expiresAt:message.expires_at.toISOString(),revision:message.revision,
        targets:{household:message.audience_household,personIds:message.person_ids}
      })),serverNow:now.toISOString()
    };
  });

  const memberBoardActor=(auth:AuthContext):BoardActor=>({kind:'member',id:auth.accountId,accountId:auth.accountId,sessionId:auth.sessionId,membershipId:auth.membershipId,householdId:auth.householdId});
  const displayBoardActor=(request:FastifyRequest,display:DisplayContext):Extract<BoardActor,{kind:'display'}>=>{
    const token=request.cookies[DISPLAY_COOKIE];if(!token)throw new DomainError('UNAUTHENTICATED',401);
    return{kind:'display',id:display.id,credentialHash:tokenHash(token),householdId:display.householdId};
  };
  const householdBoardMemberAuth=async(request:FastifyRequest)=>{const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');return auth;};
  app.get('/api/v1/households/:householdId/groceries',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);reply.header('Cache-Control','private, no-store');return householdBoards.listGroceries(auth.householdId);
  });
  app.post('/api/v1/households/:householdId/groceries',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const body=parse(groceryCreateSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await householdBoards.createGrocery(memberBoardActor(auth),body));
  });
  app.patch('/api/v1/households/:householdId/groceries/:itemId',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const body=parse(groceryUpdateSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.updateGrocery(memberBoardActor(auth),params(request).itemId!,body);
  });
  app.delete('/api/v1/households/:householdId/groceries/:itemId',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const body=parse(groceryDeleteSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.deleteGrocery(memberBoardActor(auth),params(request).itemId!,body);
  });
  app.get('/api/v1/households/:householdId/dinner-options',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);reply.header('Cache-Control','private, no-store');return householdBoards.listDinnerOptions(auth.householdId);
  });
  app.post('/api/v1/households/:householdId/dinner-options',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const body=parse(dinnerOptionCreateSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await householdBoards.createDinnerOption(memberBoardActor(auth),body));
  });
  app.patch('/api/v1/households/:householdId/dinner-options/:optionId',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const body=parse(dinnerOptionUpdateSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.updateDinnerOption(memberBoardActor(auth),params(request).optionId!,body);
  });
  app.delete('/api/v1/households/:householdId/dinner-options/:optionId',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const body=parse(groceryDeleteSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.deleteDinnerOption(memberBoardActor(auth),params(request).optionId!,body);
  });
  app.get('/api/v1/households/:householdId/dinners',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);reply.header('Cache-Control','private, no-store');const query=(request.query??{}) as Record<string,unknown>;
    const from=dateOnly(query.from),to=dateOnly(query.to);if(!from||!to)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_dinner_date_window'});
    const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000+1;if(days<1||days>31)throw new DomainError('VALIDATION_FAILED',400,{reason:'dinner_window_max_31_days'});
    return{from,to,...await householdBoards.listDinners(auth.householdId,from,to)};
  });
  app.put('/api/v1/households/:householdId/dinners/:localDate',async(request,reply)=>{
    const auth=await householdBoardMemberAuth(request);const localDate=dateOnly(params(request).localDate);if(!localDate)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_dinner_local_date'});
    const body=parse(dinnerAssignmentSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.setDinner(memberBoardActor(auth),localDate,body);
  });
  app.get('/api/v1/households/:householdId/displays/:displayId/board-read-grants',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');reply.header('Cache-Control','private, no-store');
    const row=(await pool.query(`SELECT revision,grocery_read AS "groceryRead",dinner_read AS "dinnerRead" FROM display_board_read_grants WHERE household_id=$1 AND display_id=$2`,[auth.householdId,params(request).displayId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);return row;
  });
  app.put('/api/v1/households/:householdId/displays/:displayId/board-read-grants',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');const body=parse(displayBoardReadGrantSchema,request.body);reply.header('Cache-Control','private, no-store');
    return transaction(async(client)=>{
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      const current=(await client.query<{revision:number}>(`SELECT revision FROM display_board_read_grants WHERE household_id=$1 AND display_id=$2 FOR UPDATE`,[auth.householdId,params(request).displayId])).rows[0];
      if(!current)throw new DomainError('NOT_FOUND',404);if(current.revision!==body.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:current.revision});
      const updated=(await client.query(`UPDATE display_board_read_grants SET grocery_read=$3,dinner_read=$4,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND display_id=$2 RETURNING revision,grocery_read AS "groceryRead",dinner_read AS "dinnerRead"`,[auth.householdId,params(request).displayId,body.groceryRead,body.dinnerRead])).rows[0];
      await audit(client,auth,'display.board_read_grants_updated','display',params(request).displayId,{groceryRead:body.groceryRead,dinnerRead:body.dinnerRead,revision:updated.revision});
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      return updated;
    });
  });
  app.get('/api/v1/display/groceries',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');return householdBoards.listDisplayGroceries(displayBoardActor(request,display));
  });
  app.get('/api/v1/display/dinners',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');const query=(request.query??{}) as Record<string,unknown>;const from=dateOnly(query.from),to=dateOnly(query.to);
    if(!from||!to)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_dinner_date_window'});const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000+1;if(days<1||days>31)throw new DomainError('VALIDATION_FAILED',400,{reason:'dinner_window_max_31_days'});
    return{from,to,...await householdBoards.listDisplayDinners(displayBoardActor(request,display),from,to)};
  });
  app.get('/api/v1/display/dinner-options',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');return householdBoards.listDisplayDinnerOptions(displayBoardActor(request,display));
  });
  app.post('/api/v1/display/groceries',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(groceryCreateSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await householdBoards.createGrocery(displayBoardActor(request,display),body));
  });
  app.patch('/api/v1/display/groceries/:itemId',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(groceryUpdateSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.updateGrocery(displayBoardActor(request,display),params(request).itemId!,body);
  });
  app.delete('/api/v1/display/groceries/:itemId',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(groceryDeleteSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.deleteGrocery(displayBoardActor(request,display),params(request).itemId!,body);
  });
  app.post('/api/v1/display/dinner-options',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(dinnerOptionCreateSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await householdBoards.createDinnerOption(displayBoardActor(request,display),body));
  });
  app.patch('/api/v1/display/dinner-options/:optionId',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(dinnerOptionUpdateSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.updateDinnerOption(displayBoardActor(request,display),params(request).optionId!,body);
  });
  app.delete('/api/v1/display/dinner-options/:optionId',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(groceryDeleteSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.deleteDinnerOption(displayBoardActor(request,display),params(request).optionId!,body);
  });
  app.put('/api/v1/display/dinners/:localDate',async(request,reply)=>{
    const display=await displayAuth(request);const localDate=dateOnly(params(request).localDate);if(!localDate)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_dinner_local_date'});
    const body=parse(dinnerAssignmentSchema,request.body);reply.header('Cache-Control','private, no-store');return householdBoards.setDinner(displayBoardActor(request,display),localDate,body);
  });

  app.get('/api/v1/households/:householdId/people/:personId/activities',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');
    const personId=params(request).personId!;const person=(await pool.query('SELECT id FROM persons WHERE id=$1 AND household_id=$2',[personId,auth.householdId])).rows[0];if(!person)throw new DomainError('NOT_FOUND',404);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;const today=localDateInTimezone(new Date(),household.timezone);const query=(request.query??{}) as Record<string,unknown>;
    const from=dateOnly(query.from),to=dateOnly(query.to);if(!from||!to||from<weekStart(today))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_date_window'});
    const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000+1;if(days<1||days>7)throw new DomainError('VALIDATION_FAILED',400,{reason:'activity_window_max_seven_days'});
    const rawLimit=query.limit===undefined?20:Number(query.limit);if(!Number.isInteger(rawLimit)||rawLimit<1||rawLimit>50)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_limit'});
    const page=await personActivities({householdId:auth.householdId,personIds:[personId],viewer:{personId:auth.personId,membershipId:auth.membershipId},canViewAll:auth.capabilities.includes('household.manage'),from,to,limit:rawLimit,cursor:decodeActivityCursor(query.cursor),maxDays:7});
    return{personId,from,to,...page,serverNow:new Date().toISOString()};
  });
  app.get('/api/v1/households/:householdId/people/:personId/activities/next',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');
    const personId=params(request).personId!;const person=(await pool.query('SELECT id FROM persons WHERE id=$1 AND household_id=$2',[personId,auth.householdId])).rows[0];if(!person)throw new DomainError('NOT_FOUND',404);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;const from=localDateInTimezone(new Date(),household.timezone);const to=dateOffset(from,365);
    const page=await personActivities({householdId:auth.householdId,personIds:[personId],viewer:{personId:auth.personId,membershipId:auth.membershipId},canViewAll:auth.capabilities.includes('household.manage'),from,to,limit:1,maxDays:366,upcomingOnly:true});
    return{personId,activity:page.activities[0]??null,serverNow:new Date().toISOString()};
  });

  app.get('/api/v1/households/:householdId/activities/sources',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');
    const {limit,cursor}=activitySourcePagination((request.query??{}) as Record<string,unknown>);
    return transaction(async(client)=>{
      await recheckHouseholdAuth(client,request,auth,'household.view');
      // Source visibility is the source-level form of the activity item reader
      // ACL. Subjects place events on people; they never grant source access.
      const rows=(await client.query<{id:string;name:string}>(`SELECT source.id,COALESCE(source.display_name,source.name) AS name
        FROM calendar_sources source
        JOIN calendar_connections connection ON connection.id=source.connection_id AND connection.household_id=source.household_id
        JOIN integration_connections integration ON integration.id=connection.integration_connection_id AND integration.household_id=source.household_id AND integration.revoked_at IS NULL
        JOIN memberships viewer ON viewer.id=$2 AND viewer.account_id=$3 AND viewer.household_id=source.household_id
        WHERE source.household_id=$1 AND source.enabled AND connection.disconnected_at IS NULL
          AND (viewer.capabilities ? 'household.manage' OR source.target_household OR EXISTS(SELECT 1 FROM calendar_source_person_readers reader WHERE reader.household_id=source.household_id AND reader.source_id=source.id AND reader.person_id=viewer.person_id))
          AND ($4::uuid IS NULL OR source.id>$4::uuid)
        ORDER BY source.id LIMIT $5`,[auth.householdId,auth.membershipId,auth.accountId,cursor,limit+1])).rows;
      // Keep stale, readable calendars selectable even when they have no active
      // items. Only current authority is rechecked after any query lock waits.
      await recheckHouseholdAuth(client,request,auth,'household.view');
      return activitySourcePage(rows,limit);
    });
  });

  app.get('/api/v1/households/:householdId/activities',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');
    const query=(request.query??{}) as Record<string,unknown>;const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;const today=localDateInTimezone(new Date(),household.timezone);
    const from=dateOnly(query.from),to=dateOnly(query.to);if(!from||!to||from<weekStart(today))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_date_window'});
    const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000+1;if(days<1||days>7)throw new DomainError('VALIDATION_FAILED',400,{reason:'activity_window_max_seven_days'});
    const requestedPeople=activityIdFilter(query.personIds,'activity_people',50);const sourceIds=activityIdFilter(query.sourceIds,'activity_sources',20);
    if(requestedPeople){const valid=await pool.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[auth.householdId,requestedPeople]);if(valid.rowCount!==requestedPeople.length)throw new DomainError('NOT_FOUND',404);}
    if(sourceIds){const valid=await pool.query('SELECT id FROM calendar_sources WHERE household_id=$1 AND id=ANY($2::uuid[])',[auth.householdId,sourceIds]);if(valid.rowCount!==sourceIds.length)throw new DomainError('NOT_FOUND',404);}
    const rawLimit=query.limit===undefined?20:Number(query.limit);if(!Number.isInteger(rawLimit)||rawLimit<1||rawLimit>50)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_limit'});const cursor=decodeActivityCursor(query.cursor);
    const page=await personActivities({householdId:auth.householdId,personIds:requestedPeople??null,viewer:{personId:auth.personId,membershipId:auth.membershipId},canViewAll:auth.capabilities.includes('household.manage'),from,to,limit:rawLimit,sourceIds,cursor,maxDays:7});
    const activities=page.activities.map((row)=>{const normalized={...row};if(row.type==='calendar'){const subjects=row.subjects as {personIds?:unknown}|undefined;normalized.personIds=Array.isArray(subjects?.personIds)?subjects.personIds:[];}else normalized.personIds=Array.isArray(row.personIds)?row.personIds:typeof row.personId==='string'?[row.personId]:[];delete normalized.personId;return normalized;});
    return{from,to,personIds:requestedPeople??null,sourceIds:sourceIds??null,...page,activities,serverNow:new Date().toISOString()};
  });
  app.get('/api/v1/households/:householdId/activities/next',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');
    const query=(request.query??{}) as Record<string,unknown>;const requestedPeople=activityIdFilter(query.personIds,'activity_people',50);const sourceIds=activityIdFilter(query.sourceIds,'activity_sources',20);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[auth.householdId])).rows[0]!;const from=localDateInTimezone(new Date(),household.timezone);const to=dateOffset(from,365);
    if(requestedPeople){const valid=await pool.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[auth.householdId,requestedPeople]);if(valid.rowCount!==requestedPeople.length)throw new DomainError('NOT_FOUND',404);}
    if(sourceIds){const valid=await pool.query('SELECT id FROM calendar_sources WHERE household_id=$1 AND id=ANY($2::uuid[])',[auth.householdId,sourceIds]);if(valid.rowCount!==sourceIds.length)throw new DomainError('NOT_FOUND',404);}
    const page=await personActivities({householdId:auth.householdId,personIds:requestedPeople??null,viewer:{personId:auth.personId,membershipId:auth.membershipId},canViewAll:auth.capabilities.includes('household.manage'),from,to,limit:1,sourceIds,maxDays:366,upcomingOnly:true});
    const activity=page.activities[0]??null;if(activity){if(activity.type==='calendar'){const subjects=activity.subjects as {personIds?:unknown}|undefined;activity.personIds=Array.isArray(subjects?.personIds)?subjects.personIds:[];}else activity.personIds=Array.isArray(activity.personIds)?activity.personIds:typeof activity.personId==='string'?[activity.personId]:[];delete activity.personId;}return{activity,serverNow:new Date().toISOString()};
  });

  app.get('/api/v1/households/:householdId/people/:personId/school-activities/:eventId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');
    const {personId,eventId}=params(request);const person=await pool.query('SELECT id FROM persons WHERE id=$1 AND household_id=$2',[personId,auth.householdId]);if(!person.rowCount)throw new DomainError('NOT_FOUND',404);
    const row=(await pool.query<SchoolActivityRow>(`SELECT ${schoolActivitySelect}
      FROM monitor_events event JOIN monitor_tasks task ON task.id=event.task_id AND task.household_id=event.household_id
      JOIN LATERAL (SELECT subject.person_id,ARRAY[subject.person_id] AS person_ids FROM monitor_task_subjects subject WHERE subject.task_id=task.id AND subject.household_id=task.household_id AND subject.person_id=$2) subject ON true
      JOIN households household ON household.id=task.household_id
      JOIN messages message ON message.id=event.message_id AND message.household_id=event.household_id
      ${schoolProvenanceJoins}
      WHERE event.id=$1 AND event.household_id=$3 AND task.presentation_kind='school' AND event.actions IS NOT NULL
        AND ${schoolTaskAuthorized} AND ($4 OR message.audience_household OR message.author_membership_id=$5 OR EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=message.id AND audience.person_id=$6))`, [eventId,personId,auth.householdId,auth.capabilities.includes('household.manage'),auth.membershipId,auth.personId])).rows[0];
    if(!row)throw new DomainError('NOT_FOUND',404);
    return{type:'school',id:row.id,taskId:row.task_id,personId:row.person_id,date:row.event_date,time:row.event_time,kind:row.event_type,title:row.description,...schoolProjectionMetadata(row),evidence:row.evidence,confidence:row.confidence,uncertainty:row.uncertainty,sourceUrl:row.source_url,expiresAt:row.school_expires_at?.toISOString()??null};
  });

  app.get('/api/v1/households/:householdId/events',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');
    let canViewAll=auth.capabilities.includes('household.manage');
    let responseClosed=false;
    let authorizationCheckUnavailable=false;
    const send=(event:{type:string;data:Record<string,unknown>})=>{if(!responseClosed)reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);};
    const unsubscribe=projectionEvents.subscribe(`member:${auth.membershipId}`,auth.householdId,send,()=>reply.raw.end());
    reply.hijack();
    const response=reply.raw;
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no',...responseSecurityHeaders});
    const initiallyConnected=projectionEvents.listenerConnected();
    send({type:'ready',data:{generatedAt:new Date().toISOString(),listenerConnected:initiallyConnected,pollingFallback:!initiallyConnected}});
    const revalidateMs=Math.max(50,Number(process.env.SAMVEV_SSE_REVALIDATE_MS??15_000));
    const timer=setInterval(async()=>{
      try{
        const current=await authForHousehold(request,auth.householdId);requireCapability(current.capabilities,'household.view');
        const currentCanViewAll=current.capabilities.includes('household.manage');
        if(currentCanViewAll!==canViewAll){canViewAll=currentCanViewAll;send({type:'authorization-changed',data:{refetchRequired:true}});}
        if(authorizationCheckUnavailable){authorizationCheckUnavailable=false;if(projectionEvents.listenerConnected())send({type:'listener-restored',data:{pollingFallback:true,listenerConnected:true,refetchRequired:true}});}
        const listenerConnected=projectionEvents.listenerConnected();
        send({type:'heartbeat',data:{serverNow:new Date().toISOString(),listenerConnected,pollingFallback:!listenerConnected}});
      }catch(error){
        if(error instanceof DomainError&&(error.status===401||error.status===403||error.status===404)){send({type:'authorization-revoked',data:{}});response.end();return;}
        if(!authorizationCheckUnavailable){authorizationCheckUnavailable=true;send({type:'listener-degraded',data:{pollingFallback:true,listenerConnected:projectionEvents.listenerConnected(),reason:'authorization-check-unavailable'}});}
      }
    },revalidateMs);
    const cleanup=()=>{if(responseClosed)return;responseClosed=true;clearInterval(timer);unsubscribe();};
    response.once('close',cleanup);
  });

  app.get('/api/v1/households/:householdId/integrations',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    reply.header('Cache-Control','private, no-store');
    const ids=await pool.query<{id:string}>(`SELECT connection.id FROM integration_connections connection WHERE connection.household_id=$1 AND NOT EXISTS(SELECT 1 FROM calendar_connections calendar WHERE calendar.integration_connection_id=connection.id) ORDER BY connection.created_at,connection.id`,[auth.householdId]);
    return {connections:await Promise.all(ids.rows.map((row)=>integrationConnectionResponse(row.id,auth.householdId)))};
  });

  app.post('/api/v1/households/:householdId/integrations',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    reply.header('Cache-Control','private, no-store');
    const body=parse(integrationConnectionCreateSchema,request.body);
    const credentialToken=body.credential?`samvev_it_${opaqueToken()}`:undefined;
    const connectionId=await transaction(async(client)=>{
      if(body.displayIds.length){
        const displays=await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL',[auth.householdId,body.displayIds]);
        if(displays.rowCount!==new Set(body.displayIds).size)throw new DomainError('NOT_FOUND',404);
      }
      if(body.credential?.expiresAt&&new Date(body.credential.expiresAt)<=new Date())throw new DomainError('VALIDATION_FAILED',400,{reason:'credential_expiry_must_be_future'});
      const connection=(await client.query<{id:string}>('INSERT INTO integration_connections(household_id,name) VALUES($1,$2) RETURNING id',[auth.householdId,body.name])).rows[0]!;
      for(const displayId of body.displayIds)await client.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[auth.householdId,connection.id,displayId]);
      if(body.credential)await client.query(`INSERT INTO integration_credentials(connection_id,name,token_hash,capabilities,expires_at) VALUES($1,$2,$3,$4,$5)`,[connection.id,body.credential.name,tokenHash(credentialToken!),JSON.stringify(body.credential.capabilities),body.credential.expiresAt]);
      await audit(client,auth,'integration.connection_created','integration_connection',connection.id,{displayCount:body.displayIds.length,credentialCreated:Boolean(body.credential)});
      return connection.id;
    });
    return reply.status(201).send({connection:await integrationConnectionResponse(connectionId,auth.householdId),...(credentialToken?{credentialToken}:{})});
  });

  app.patch('/api/v1/households/:householdId/integrations/:connectionId',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    reply.header('Cache-Control','private, no-store');
    const body=parse(integrationConnectionUpdateSchema,request.body);const connectionId=params(request).connectionId!;
    await transaction(async(client)=>{
      const current=await client.query('SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 FOR UPDATE',[connectionId,auth.householdId]);
      if(!current.rowCount)throw new DomainError('NOT_FOUND',404);
      if(body.displayIds){const displays=await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL',[auth.householdId,body.displayIds]);if(displays.rowCount!==new Set(body.displayIds).size)throw new DomainError('NOT_FOUND',404);}
      const updated=await client.query(`UPDATE integration_connections SET name=COALESCE($3,name),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$4 RETURNING id`,[connectionId,auth.householdId,body.name??null,body.expectedRevision]);
      if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      if(body.displayIds){await client.query('DELETE FROM integration_connection_display_grants WHERE connection_id=$1',[connectionId]);for(const displayId of body.displayIds)await client.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[auth.householdId,connectionId,displayId]);}
      await audit(client,auth,'integration.connection_updated','integration_connection',connectionId,{displayCount:body.displayIds?.length});
    });
    return {connection:await integrationConnectionResponse(connectionId,auth.householdId)};
  });

  app.post('/api/v1/households/:householdId/integrations/:connectionId/revoke',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    reply.header('Cache-Control','private, no-store');
    const body=parse(integrationConnectionRevisionSchema,request.body);const connectionId=params(request).connectionId!;
    await transaction(async(client)=>{
      const current=await client.query<{revoked_at:Date|null}>('SELECT revoked_at FROM integration_connections WHERE id=$1 AND household_id=$2 FOR UPDATE',[connectionId,auth.householdId]);
      if(!current.rowCount)throw new DomainError('NOT_FOUND',404);if(current.rows[0]!.revoked_at)throw new DomainError('CONFLICT',409,{reason:'connection_already_revoked'});
      const updated=await client.query('UPDATE integration_connections SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 RETURNING id',[connectionId,body.expectedRevision]);
      if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      await client.query('UPDATE integration_credentials SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revision=CASE WHEN revoked_at IS NULL THEN revision+1 ELSE revision END WHERE connection_id=$1',[connectionId]);
      await calendars.fenceIntegrationRevocation(client,connectionId);
      await audit(client,auth,'integration.connection_revoked','integration_connection',connectionId);
    });
    return {connection:await integrationConnectionResponse(connectionId,auth.householdId)};
  });

  app.post('/api/v1/households/:householdId/integrations/:connectionId/credentials',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    reply.header('Cache-Control','private, no-store');
    const body=parse(integrationCredentialCreateSchema,request.body);const connectionId=params(request).connectionId!;const credentialToken=`samvev_it_${opaqueToken()}`;
    const credentialId=await transaction(async(client)=>{
      const current=await client.query('SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR UPDATE',[connectionId,auth.householdId]);if(!current.rowCount)throw new DomainError('NOT_FOUND',404);
      if(body.expiresAt&&new Date(body.expiresAt)<=new Date())throw new DomainError('VALIDATION_FAILED',400,{reason:'credential_expiry_must_be_future'});
      const bumped=await client.query('UPDATE integration_connections SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 RETURNING id',[connectionId,body.expectedRevision]);if(!bumped.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      const credential=(await client.query<{id:string}>('INSERT INTO integration_credentials(connection_id,name,token_hash,capabilities,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[connectionId,body.name,tokenHash(credentialToken),JSON.stringify(body.capabilities),body.expiresAt])).rows[0]!;
      await audit(client,auth,'integration.credential_created','integration_credential',credential.id,{connectionId,capabilities:body.capabilities,expiresAt:body.expiresAt});return credential.id;
    });
    return reply.status(201).send({credentialId,credentialToken,connection:await integrationConnectionResponse(connectionId,auth.householdId)});
  });

  app.post('/api/v1/households/:householdId/integrations/:connectionId/credentials/:credentialId/revoke',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');
    reply.header('Cache-Control','private, no-store');
    const body=parse(integrationCredentialRevokeSchema,request.body);const connectionId=params(request).connectionId!;const credentialId=params(request).credentialId!;
    await transaction(async(client)=>{
      const connection=await client.query('SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 FOR UPDATE',[connectionId,auth.householdId]);if(!connection.rowCount)throw new DomainError('NOT_FOUND',404);
      const credential=await client.query<{revoked_at:Date|null}>('SELECT revoked_at FROM integration_credentials WHERE id=$1 AND connection_id=$2 FOR UPDATE',[credentialId,connectionId]);if(!credential.rowCount)throw new DomainError('NOT_FOUND',404);if(credential.rows[0]!.revoked_at)throw new DomainError('CONFLICT',409,{reason:'credential_already_revoked'});
      const updated=await client.query('UPDATE integration_credentials SET revoked_at=clock_timestamp(),revision=revision+1 WHERE id=$1 AND connection_id=$2 AND revision=$3 RETURNING id',[credentialId,connectionId,body.expectedRevision]);if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      await audit(client,auth,'integration.credential_revoked','integration_credential',credentialId,{connectionId});
    });
    return {connection:await integrationConnectionResponse(connectionId,auth.householdId)};
  });

  const homeAssistantMemberActor=(auth:AuthContext):Extract<HomeAssistantControlActor,{kind:'member'}>=>({kind:'member',id:auth.accountId,accountId:auth.accountId,sessionId:auth.sessionId,membershipId:auth.membershipId,personId:auth.personId,householdId:auth.householdId});
  const homeAssistantDisplayActor=(request:FastifyRequest,display:DisplayContext):Extract<HomeAssistantControlActor,{kind:'display'}>=>{
    const token=request.cookies[DISPLAY_COOKIE];if(!token)throw new DomainError('UNAUTHENTICATED',401);
    return{kind:'display',id:display.id,credentialHash:tokenHash(token),householdId:display.householdId,privacyMode:display.privacyMode,cards:display.cards};
  };
  app.get('/api/v1/households/:householdId/home-assistant/controls/configuration',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');reply.header('Cache-Control','private, no-store');return homeAssistantControls.configuration(homeAssistantMemberActor(auth));
  });
  app.get('/api/v1/households/:householdId/home-assistant/controls',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return homeAssistantControls.list(homeAssistantMemberActor(auth));
  });
  app.get('/api/v1/households/:householdId/home-assistant/controls/:entityId/state',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return homeAssistantControls.read(homeAssistantMemberActor(auth),params(request).entityId!);
  });
  app.post('/api/v1/households/:householdId/home-assistant/controls/:entityId/confirm-open',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'ha_control_confirmation',{account:30,household:90,ip:60,windowSeconds:3600});const body=parse(homeAssistantControlRevisionSchema,request.body);reply.header('Cache-Control','no-store');return homeAssistantControls.confirmOpen(homeAssistantMemberActor(auth),params(request).entityId!,body.expectedRevision);
  });
  app.post('/api/v1/households/:householdId/home-assistant/controls/:entityId/actions',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'ha_control_action',{account:30,household:90,ip:60,windowSeconds:3600});const body=parse(homeAssistantControlDispatchSchema,request.body);reply.header('Cache-Control','no-store');return homeAssistantControls.dispatch(homeAssistantMemberActor(auth),params(request).entityId!,body);
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/home-assistant/controls/discover',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');await operationRateLimit(request,auth,'ha_control_discovery',{account:20,household:60,ip:40,windowSeconds:3600});const body=parse(homeAssistantControlDiscoverySchema,request.body);reply.header('Cache-Control','private, no-store');return homeAssistantControls.discover(homeAssistantMemberActor(auth),params(request).connectionId!,body.expectedConnectionRevision);
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/home-assistant/controls',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');await operationRateLimit(request,auth,'ha_control_select',{account:30,household:90,ip:60,windowSeconds:3600});const body=parse(homeAssistantControlSelectSchema,request.body);reply.header('Cache-Control','private, no-store');return reply.status(201).send({entity:await homeAssistantControls.select(homeAssistantMemberActor(auth),params(request).connectionId!,body)});
  });
  app.put('/api/v1/households/:householdId/home-assistant/controls/:entityId/grants',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');const body=parse(homeAssistantControlGrantSchema,request.body);reply.header('Cache-Control','private, no-store');return homeAssistantControls.configureGrants(homeAssistantMemberActor(auth),params(request).entityId!,body);
  });
  app.post('/api/v1/households/:householdId/home-assistant/controls/:entityId/deselect',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');const body=parse(homeAssistantControlRevisionSchema,request.body);reply.header('Cache-Control','private, no-store');return homeAssistantControls.deselect(homeAssistantMemberActor(auth),params(request).entityId!,body.expectedRevision);
  });
  app.get('/api/v1/display/home-assistant/controls',async(request,reply)=>{const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');return homeAssistantControls.list(homeAssistantDisplayActor(request,display));});
  app.get('/api/v1/display/home-assistant/controls/:entityId/state',async(request,reply)=>{const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');return homeAssistantControls.read(homeAssistantDisplayActor(request,display),params(request).entityId!);});
  app.post('/api/v1/display/home-assistant/controls/:entityId/confirm-open',async(request,reply)=>{const display=await displayAuth(request);await durableRateLimit('ha_control_confirmation_display',display.id,30,3600);const body=parse(homeAssistantControlRevisionSchema,request.body);reply.header('Cache-Control','no-store');return homeAssistantControls.confirmOpen(homeAssistantDisplayActor(request,display),params(request).entityId!,body.expectedRevision);});
  app.post('/api/v1/display/home-assistant/controls/:entityId/actions',async(request,reply)=>{const display=await displayAuth(request);await durableRateLimit('ha_control_action_display',display.id,30,3600);const body=parse(homeAssistantControlDispatchSchema,request.body);reply.header('Cache-Control','no-store');return homeAssistantControls.dispatch(homeAssistantDisplayActor(request,display),params(request).entityId!,body);});
  app.get('/api/v1/households/:householdId/calendar-connections',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');reply.header('Cache-Control','private, no-store');return{connections:await calendars.list(auth)};
  });
  app.get('/api/v1/households/:householdId/calendar-connections/readiness',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');const canAdmin=Boolean((await pool.query(`SELECT 1 FROM memberships membership JOIN households household ON household.id=membership.household_id AND household.installation_id=$1 WHERE membership.account_id=$2 AND membership.capabilities ? 'installation.manage' LIMIT 1`,[auth.installationId,auth.accountId])).rowCount);reply.header('Cache-Control','private, no-store');return{providers:await calendars.connectionReadiness(auth,runtime.publicOrigin),canAdmin};
  });
  app.post('/api/v1/households/:householdId/calendar-connections',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'calendar_connection_create',{account:12,household:30,ip:24,windowSeconds:3600});const body=parse(calendarConnectionCreateSchema,request.body);return reply.status(201).send({connection:await calendars.create(auth,body)});
  });
  app.get('/api/v1/households/:householdId/calendar-connections/:connectionId/ics-subscription',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');reply.header('Cache-Control','private, no-store').header('Pragma','no-cache').header('Referrer-Policy','no-referrer');return calendars.getIcsSubscriptionUrl(auth,params(request).connectionId!);
  });
  app.patch('/api/v1/households/:householdId/calendar-connections/:connectionId/ics-subscription',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.manage');await operationRateLimit(request,auth,'calendar_ics_subscription_update',{account:20,household:50,ip:40,windowSeconds:3600});const body=parse(calendarIcsUrlUpdateSchema,request.body);reply.header('Cache-Control','private, no-store').header('Pragma','no-cache').header('Referrer-Policy','no-referrer');return calendars.updateIcsSubscriptionUrl(auth,params(request).connectionId!,body);
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/oauth/start',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'calendar_oauth_start',{account:20,household:60,ip:40,windowSeconds:3600});return calendars.startOAuth(auth,params(request).connectionId!,runtime.publicOrigin);
  });
  app.patch('/api/v1/households/:householdId/calendar-connections/:connectionId/sources/:sourceId',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');return{connection:await calendars.updateSource(auth,params(request).connectionId!,params(request).sourceId!,parse(calendarSourceUpdateSchema,request.body))};
  });
  app.patch('/api/v1/households/:householdId/calendar-connections/:connectionId/sync-schedule',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');return{connection:await calendars.updateSyncSchedule(auth,params(request).connectionId!,parse(calendarSyncScheduleSchema,request.body))};
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/sources/refresh',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'calendar_source_discovery',{account:20,household:60,ip:40,windowSeconds:3600});const body=parse(calendarSourceRefreshSchema,request.body);reply.header('Cache-Control','private, no-store');return{connection:await calendars.refreshSources(auth,params(request).connectionId!,body.expectedRevision)};
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/temperature-sensors/discover',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'temperature_sensor_discovery',{account:30,household:90,ip:60,windowSeconds:3600});reply.header('Cache-Control','private, no-store');return calendars.discoverTemperatureSensors(auth,params(request).connectionId!,parse(temperatureSensorDiscoverySchema,request.body));
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/temperature-sensors',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'temperature_sensor_select',{account:30,household:90,ip:60,windowSeconds:3600});reply.header('Cache-Control','private, no-store');return{connection:await calendars.selectTemperatureSensor(auth,params(request).connectionId!,parse(temperatureSensorSelectSchema,request.body))};
  });
  app.patch('/api/v1/households/:householdId/calendar-connections/:connectionId/temperature-sensors/:sensorId',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');return{connection:await calendars.updateTemperatureSensor(auth,params(request).connectionId!,params(request).sensorId!,parse(temperatureSensorUpdateSchema,request.body))};
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/temperature-sensors/:sensorId/preview',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'temperature_sensor_preview',{account:60,household:180,ip:120,windowSeconds:3600});const body=parse(temperatureSensorRevisionSchema,request.body);reply.header('Cache-Control','private, no-store');return calendars.previewTemperatureSensor(auth,params(request).connectionId!,params(request).sensorId!,body.expectedRevision);
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/temperature-sensors/:sensorId/sync',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'temperature_sensor_sync',{account:30,household:90,ip:60,windowSeconds:3600});const body=parse(temperatureSensorRevisionSchema,request.body);return reply.status(200).send({result:await calendars.syncTemperatureSensor(auth,params(request).connectionId!,params(request).sensorId!,body.expectedRevision),connection:await calendars.get(auth,params(request).connectionId!)});
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/sources/:sourceId/preview',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'calendar_preview',{account:60,household:180,ip:120,windowSeconds:3600});const body=parse(calendarPreviewSchema,request.body);reply.header('Cache-Control','private, no-store');return calendars.preview(auth,params(request).connectionId!,params(request).sourceId!,body.expectedSourceRevision);
  });
  app.post('/api/v1/households/:householdId/calendar-connections/oauth/:provider/complete',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');const provider=params(request).provider;if(provider!=='google'&&provider!=='microsoft'&&provider!=='home_assistant')throw new DomainError('NOT_FOUND',404);const body=parse(calendarOAuthCompleteSchema,request.body);await calendars.completeOAuth(auth,provider,body.completionToken);reply.header('Cache-Control','private, no-store');return{connection:await calendars.list(auth)};
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/sync',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');await operationRateLimit(request,auth,'calendar_manual_sync',{account:30,household:90,ip:60,windowSeconds:3600});const body=parse(calendarConnectionRevisionSchema,request.body);const result=await calendars.sync(auth,params(request).connectionId!,body.expectedRevision);return reply.status(200).send({result,connection:await calendars.get(auth,params(request).connectionId!)});
  });
  app.post('/api/v1/households/:householdId/calendar-connections/:connectionId/disconnect',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'household.view');const body=parse(calendarConnectionRevisionSchema,request.body);return{connection:await calendars.disconnect(auth,params(request).connectionId!,body.expectedRevision)};
  });
  app.get('/api/v1/calendar/oauth/:provider/callback',async(request,reply)=>{
    await durableRateLimit('calendar_oauth_callback_ip',request.ip,60,900);const provider=params(request).provider;if(provider!=='google'&&provider!=='microsoft'&&provider!=='home_assistant')throw new DomainError('NOT_FOUND',404);const query=request.query as Record<string,unknown>;if(typeof query.state!=='string'||query.state.length>512||(typeof query.code==='string'&&query.code.length>4096)||(typeof query.error==='string'&&query.error.length>256))throw new DomainError('VALIDATION_FAILED',400);const staged=await calendars.stageOAuthCallback(provider,query.state,typeof query.code==='string'?query.code:undefined,typeof query.error==='string'?query.error:undefined);reply.header('Cache-Control','private, no-store');if(staged.denied)return reply.redirect(`${runtime.publicOrigin}/integrations?calendar=consent_denied`);return reply.redirect(`${runtime.publicOrigin}/integrations#calendar-oauth=${encodeURIComponent(staged.completionToken)}`);
  });

  app.get('/api/v1/installations/:installationId/calendar-providers',async(request,reply)=>{const auth=await authForInstallation(request,params(request).installationId!);reply.header('Cache-Control','private, no-store');return{installationId:auth.installationId,canAdmin:true,providers:await calendars.readiness(auth,runtime.publicOrigin)};});
  app.put('/api/v1/installations/:installationId/calendar-providers/:provider',{bodyLimit:16*1024},async(request,reply)=>{const auth=await authForInstallation(request,params(request).installationId!),provider=params(request).provider;if(provider!=='google'&&provider!=='microsoft'&&provider!=='home_assistant')throw new DomainError('NOT_FOUND',404);await operationRateLimit(request,auth,'calendar_provider_configuration',{account:20,household:40,ip:30,windowSeconds:3600});const body=parse(calendarProviderConfigurationSchema,request.body);reply.header('Cache-Control','private, no-store');return{installationId:auth.installationId,canAdmin:true,providers:await calendars.updateProvider(auth,provider,body,runtime.publicOrigin)};});
  app.get('/api/v1/installations/:installationId/public-contact',async(request,reply)=>{
    const auth=await authForInstallation(request,params(request).installationId!);reply.header('Cache-Control','private, no-store');
    return{installationId:auth.installationId,contact:await readPublicContact(auth.installationId)};
  });
  app.put('/api/v1/installations/:installationId/public-contact',{bodyLimit:4*1024},async(request,reply)=>{
    const auth=await authForInstallation(request,params(request).installationId!);
    await operationRateLimit(request,auth,'installation_public_contact',{account:20,household:40,ip:30,windowSeconds:3600});
    const body=parse(installationPublicContactUpdateSchema,request.body);const contact=await updatePublicContact(auth,body);
    reply.header('Cache-Control','private, no-store');return{contact};
  });

  app.post('/api/v1/integrations/items',async(request,reply)=>{
    const integration=await integrationAuth(request);requireIntegrationCapability(integration.capabilities,'integration.items.write');
    await durableRateLimit('integration_items_write',integration.credentialId,120,60);
    await durableRateLimit('integration_items_write_connection',integration.connectionId,120,60);
    const parsed=parse(integrationItemUpsertSchema,request.body);const canonical=canonicalIntegrationPayload(parsed);
    const outcome=await transaction(async(client)=>{
      await lockIntegrationAuthority(client,integration,'integration.items.write');
      const existing=await client.query<{id:string;revision:number;request_hash:string;status:string}>(`SELECT id,revision,request_hash,status FROM integration_items WHERE connection_id=$1 AND external_id=$2 FOR UPDATE`,[integration.connectionId,canonical.body.externalId]);
      if(existing.rows[0]?.status==='withdrawn')throw new DomainError('CONFLICT',409,{reason:'item_permanently_withdrawn',revision:existing.rows[0].revision});
      if(existing.rows[0]?.request_hash===canonical.hash){
        const row=(await client.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns} FROM integration_items i WHERE i.id=$1 AND i.connection_id=$2`,[existing.rows[0].id,integration.connectionId])).rows[0]!;
        return {result:'unchanged' as const,item:mapExternalItem(row,{includeExternalId:true})};
      }
      if(canonical.body.targets.personIds.length){
        const people=await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[integration.householdId,canonical.body.targets.personIds]);
        if(people.rowCount!==canonical.body.targets.personIds.length)throw new DomainError('NOT_FOUND',404,{reason:'person_target_not_found'});
      }
      if(canonical.body.targets.displayIds.length){
        const displays=await client.query(`SELECT d.id FROM displays d JOIN integration_connection_display_grants g ON g.display_id=d.id AND g.household_id=d.household_id
          WHERE d.household_id=$1 AND g.connection_id=$2 AND d.id=ANY($3::uuid[]) AND d.revoked_at IS NULL`,[integration.householdId,integration.connectionId,canonical.body.targets.displayIds]);
        if(displays.rowCount!==canonical.body.targets.displayIds.length)throw new DomainError('FORBIDDEN',403,{reason:'display_target_not_granted'});
      }
      let itemId:string;let result:'created'|'updated';
      if(existing.rowCount){
        const current=existing.rows[0]!;itemId=current.id;
        if(current.revision!==canonical.body.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:current.revision});
        await client.query(`UPDATE integration_items SET kind=$2,content_locale=$3,target_household=$4,title=$5,body=$6,entries=$7,priority=$8,publish_at=$9,starts_at=$10,ends_at=$11,expires_at=$12,source=$13,metadata=$14,request_hash=$15,revision=revision+1,updated_at=clock_timestamp()
          WHERE id=$1`,[itemId,canonical.body.kind,canonical.body.contentLocale,canonical.body.targets.household,canonical.body.title,canonical.body.body,JSON.stringify(canonical.body.entries),canonical.body.priority,canonical.body.publishAt,canonical.body.startsAt,canonical.body.endsAt,canonical.body.expiresAt,JSON.stringify(canonical.body.source),JSON.stringify(canonical.body.metadata),canonical.hash]);
        await client.query('DELETE FROM integration_item_person_targets WHERE item_id=$1',[itemId]);
        await client.query('DELETE FROM integration_item_display_targets WHERE item_id=$1',[itemId]);
        result='updated';
      }else{
        if(canonical.body.expectedRevision!==0)throw new DomainError('REVISION_CONFLICT',409,{revision:0});
        itemId=(await client.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,content_locale,target_household,title,body,entries,priority,publish_at,starts_at,ends_at,expires_at,source,metadata,request_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,[integration.householdId,integration.connectionId,canonical.body.externalId,canonical.body.kind,canonical.body.contentLocale,canonical.body.targets.household,canonical.body.title,canonical.body.body,JSON.stringify(canonical.body.entries),canonical.body.priority,canonical.body.publishAt,canonical.body.startsAt,canonical.body.endsAt,canonical.body.expiresAt,JSON.stringify(canonical.body.source),JSON.stringify(canonical.body.metadata),canonical.hash])).rows[0]!.id;
        result='created';
      }
      for(const personId of canonical.body.targets.personIds)await client.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[integration.householdId,itemId,personId]);
      for(const displayId of canonical.body.targets.displayIds)await client.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[integration.householdId,itemId,displayId]);
      await auditIntegration(client,integration,result==='created'?'integration.item_created':'integration.item_updated','integration_item',itemId,{kind:canonical.body.kind,priority:canonical.body.priority});
      const row=(await client.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns} FROM integration_items i WHERE i.id=$1 AND i.connection_id=$2`,[itemId,integration.connectionId])).rows[0]!;
      return {result,item:mapExternalItem(row,{includeExternalId:true})};
    });
    reply.header('Cache-Control','no-store');return reply.status(outcome.result==='created'?201:200).send(outcome);
  });

  app.get('/api/v1/integrations/items',async(request,reply)=>{
    const integration=await integrationAuth(request);requireIntegrationCapability(integration.capabilities,'integration.items.read');
    await durableRateLimit('integration_items_read',integration.credentialId,300,60);
    await durableRateLimit('integration_items_read_connection',integration.connectionId,300,60);
    const rows=await transaction(async(client)=>{await lockIntegrationAuthority(client,integration,'integration.items.read');return client.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns} FROM integration_items i WHERE i.connection_id=$1 AND i.household_id=$2 ORDER BY i.updated_at DESC,i.id LIMIT 500`,[integration.connectionId,integration.householdId]);});
    reply.header('Cache-Control','no-store');return {items:rows.rows.map((row)=>mapExternalItem(row,{includeExternalId:true}))};
  });

  app.get('/api/v1/integrations/items/:externalId',async(request,reply)=>{
    const integration=await integrationAuth(request);requireIntegrationCapability(integration.capabilities,'integration.items.read');
    await durableRateLimit('integration_items_read',integration.credentialId,300,60);
    await durableRateLimit('integration_items_read_connection',integration.connectionId,300,60);
    const externalId=params(request).externalId!;if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(externalId))throw new DomainError('NOT_FOUND',404);
    const row=await transaction(async(client)=>{await lockIntegrationAuthority(client,integration,'integration.items.read');return (await client.query<ExternalItemRow>(`SELECT ${externalItemProjectionColumns} FROM integration_items i WHERE i.connection_id=$1 AND i.household_id=$2 AND i.external_id=$3`,[integration.connectionId,integration.householdId,externalId])).rows[0];});
    if(!row)throw new DomainError('NOT_FOUND',404);reply.header('Cache-Control','no-store');return {item:mapExternalItem(row,{includeExternalId:true})};
  });

  app.delete('/api/v1/integrations/items/:externalId',async(request,reply)=>{
    const integration=await integrationAuth(request);requireIntegrationCapability(integration.capabilities,'integration.items.delete');
    await durableRateLimit('integration_items_delete',integration.credentialId,60,60);
    await durableRateLimit('integration_items_delete_connection',integration.connectionId,60,60);
    const body=parse(integrationItemWithdrawSchema,request.body);const externalId=params(request).externalId!;if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(externalId))throw new DomainError('NOT_FOUND',404);
    const outcome=await transaction(async(client)=>{
      await lockIntegrationAuthority(client,integration,'integration.items.delete');
      const current=await client.query<{id:string;revision:number;status:string}>('SELECT id,revision,status FROM integration_items WHERE connection_id=$1 AND household_id=$2 AND external_id=$3 FOR UPDATE',[integration.connectionId,integration.householdId,externalId]);
      if(!current.rowCount)throw new DomainError('NOT_FOUND',404);const item=current.rows[0]!;
      if(item.status==='withdrawn')return {result:'unchanged' as const,item:{externalId,status:'withdrawn',revision:item.revision}};
      if(item.revision!==body.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:item.revision});
      const updated=(await client.query<{revision:number}>('UPDATE integration_items SET status=\'withdrawn\',withdrawn_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision',[item.id])).rows[0]!;
      await auditIntegration(client,integration,'integration.item_withdrawn','integration_item',item.id);
      return {result:'withdrawn' as const,item:{externalId,status:'withdrawn',revision:updated.revision}};
    });
    reply.header('Cache-Control','no-store');return outcome;
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

  app.get('/api/v1/households/:householdId/display-setups',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');reply.header('Cache-Control','private, no-store');
    const rows=await pool.query<{id:string}>(`SELECT id FROM display_setups WHERE household_id=$1 ORDER BY created_at,id`,[auth.householdId]);
    const setups=await Promise.all(rows.rows.map((row)=>displaySetupResponse(pool,auth.householdId,row.id)));
    return {setups};
  });

  app.get('/api/v1/households/:householdId/displays/:displayId/action-policy',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');reply.header('Cache-Control','private, no-store');
    const displayId=params(request).displayId!;
    const policy=(await pool.query<{revision:number;message_create:boolean;message_schedule:boolean;grocery_write:boolean;dinner_write:boolean;photo_upload:boolean;home_assistant_control:boolean}>(`SELECT revision,message_create,message_schedule,grocery_write,dinner_write,photo_upload,home_assistant_control FROM display_action_policies WHERE household_id=$1 AND display_id=$2`,[auth.householdId,displayId])).rows[0];
    if(!policy)throw new DomainError('NOT_FOUND',404);
    const [people,displays]=await Promise.all([
      pool.query<{person_id:string}>('SELECT person_id FROM display_action_people WHERE household_id=$1 AND display_id=$2 ORDER BY person_id',[auth.householdId,displayId]),
      pool.query<{recipient_display_id:string}>('SELECT recipient_display_id FROM display_action_displays WHERE household_id=$1 AND display_id=$2 ORDER BY recipient_display_id',[auth.householdId,displayId])
    ]);
    return{revision:policy.revision,messageCreate:policy.message_create,messageSchedule:policy.message_schedule,groceryWrite:policy.grocery_write,dinnerWrite:policy.dinner_write,photoUpload:policy.photo_upload,homeAssistantControl:policy.home_assistant_control,personIds:people.rows.map(row=>row.person_id),displayIds:displays.rows.map(row=>row.recipient_display_id)};
  });

  app.post('/api/v1/households/:householdId/displays/:displayId/preview',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');reply.header('Cache-Control','private, no-store');
    const householdId=auth.householdId;const displayId=params(request).displayId!;const source=parse(displaySetupPreviewSchema,request.body);
    const selected=await transaction(async(client)=>{
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      const device=(await client.query(`SELECT id FROM displays WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp() FOR SHARE`,[displayId,householdId])).rows[0];if(!device)throw new DomainError('NOT_FOUND',404);
      const deviceContext=await displayContextForManager(householdId,displayId,client,true,true);
      let input:DisplaySetupInput;
      if(source.setupId){await client.query('SELECT id FROM display_setups WHERE id=$1 AND household_id=$2 FOR SHARE',[source.setupId,householdId]);const saved=await displaySetupResponse(client,householdId,source.setupId);input={name:String(saved.name),cards:saved.cards as string[],cardOrder:saved.cardOrder as string[],familyLayoutEnabled:Boolean(saved.familyLayoutEnabled),allSources:Boolean(saved.allSources),allSensors:Boolean(saved.allSensors),personIds:saved.personIds as string[],sourceIds:saved.sourceIds as string[],calendarSourceIds:saved.calendarSourceIds as string[],sensorIds:saved.sensorIds as string[],albumIds:saved.albumIds as string[],backgroundId:saved.backgroundId as string|null,locale:saved.locale as 'en'|'nb',theme:saved.theme as 'light'|'dark'|'system'};}
      else input=source.draft as DisplaySetupInput;
      const checks=await Promise.all([
        client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.personIds]),
        client.query('SELECT id FROM integration_connections WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.sourceIds]),
        client.query('SELECT id FROM calendar_sources WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.calendarSourceIds]),
        client.query('SELECT id FROM home_assistant_temperature_sensors WHERE household_id=$1 AND id=ANY($2::uuid[])',[householdId,input.sensorIds])
      ]);
      for(const [index,ids] of [[0,input.personIds],[1,input.sourceIds],[2,input.calendarSourceIds],[3,input.sensorIds]] as const)if(checks[index]!.rowCount!==new Set(ids).size)throw new DomainError('NOT_FOUND',404);
      await validateDisplaySetupMediaSelection(client,householdId,auth.membershipId,input.albumIds,input.backgroundId);
      return {input,deviceContext};
    });
    const device=selected.deviceContext,selectedInput=selected.input;
    const preview:DisplayContext={...device,setupId:source.setupId??device.setupId,setupName:selectedInput.name,cards:selectedInput.cards,cardOrder:selectedInput.cardOrder,familyLayoutEnabled:selectedInput.familyLayoutEnabled,
      allSources:selectedInput.allSources,allSensors:selectedInput.allSensors,selectedPersonIds:device.personIdsOverride??selectedInput.personIds,setupPersonIds:selectedInput.personIds,setupLocale:selectedInput.locale,setupTheme:selectedInput.theme,sourceIds:selectedInput.sourceIds,calendarSourceIds:selectedInput.calendarSourceIds,sensorIds:selectedInput.sensorIds,
      albumIds:selectedInput.albumIds,backgroundId:selectedInput.backgroundId,locale:device.localeOverride??selectedInput.locale,theme:device.themeOverride??selectedInput.theme};
    preview.itemWitnesses=new Map();preview.messageWitnesses=new Map();preview.schoolWitnesses=new Map();
    const tag=previewContextTag(preview);const mediaActorDevice={id:preview.id,householdId,setupId:preview.setupId,privacyMode:preview.privacyMode,credentialHash:preview.credentialHash};
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[householdId])).rows[0]!;
    const today=localDateInTimezone(new Date(),household.timezone),weekTo=dateOffset(weekStart(today),6);
    const [projection,previewMedia,week,next,day]=await Promise.all([
      projectionFor(preview,{markDelivered:false,preview:true,previewTag:tag}),
      media.previewProjection(mediaActor(auth),mediaActorDevice,{cards:preview.cards,albumIds:preview.albumIds,backgroundId:preview.backgroundId},tag),
      !preview.privacyMode&&preview.cards.includes('week')?personActivities({householdId,personIds:preview.selectedPersonIds,viewer:{personId:preview.id,membershipId:preview.id},canViewAll:false,from:today,to:weekTo,limit:50,maxDays:7,display:preview}):Promise.resolve(null),
      !preview.privacyMode&&preview.cards.includes('next')?personActivities({householdId,personIds:preview.selectedPersonIds,viewer:{personId:preview.id,membershipId:preview.id},canViewAll:false,from:today,to:dateOffset(today,365),limit:1,maxDays:366,upcomingOnly:true,display:preview}):Promise.resolve(null),
      !preview.privacyMode&&preview.cards.some((card)=>card==='today'||card==='tomorrow')?personActivities({householdId,personIds:preview.selectedPersonIds,viewer:{personId:preview.id,membershipId:preview.id},canViewAll:false,from:today,to:dateOffset(today,1),limit:100,maxDays:2,display:preview}):Promise.resolve(null)
    ]);
    await transaction(async(client)=>{
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      const live=(await client.query<{privacy_mode:boolean;external_items_enabled:boolean;birthday_mode:string;person_ids_override:string[]|null;credential_generation:number}>(`SELECT privacy_mode,external_items_enabled,birthday_mode,person_ids_override,credential_generation FROM displays WHERE id=$1 AND household_id=$2 AND credential_hash=$3 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp() FOR SHARE`,[displayId,householdId,device.credentialHash])).rows[0];
      if(!live||live.privacy_mode!==device.privacyMode||live.external_items_enabled!==device.externalItemsEnabled||live.credential_generation!==device.credentialGeneration||live.birthday_mode!==device.birthdayMode||JSON.stringify(live.person_ids_override)!==JSON.stringify(device.personIdsOverride))throw new DomainError('NOT_FOUND',404);
      await assertDisplayCredential(preview,true,client);
      const final=(await client.query<{session_id:string}>(`SELECT session.id AS session_id FROM sessions session JOIN accounts account ON account.id=session.account_id JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$2 JOIN displays device ON device.id=$3 AND device.household_id=$2
        WHERE session.id=$1 AND session.account_id=$4 AND membership.id=$5 AND membership.capabilities ? 'display.manage' AND account.disabled_at IS NULL
          AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp() AND device.credential_hash=$6 AND device.revoked_at IS NULL AND device.credential_expires_at>clock_timestamp()
          AND device.privacy_mode=$7 AND device.external_items_enabled=$8`,[auth.sessionId,householdId,displayId,auth.accountId,auth.membershipId,device.credentialHash,device.privacyMode,device.externalItemsEnabled])).rows[0];
      if(!final)throw new DomainError('NOT_FOUND',404);
    });
    const safeProjection={...projection,preview:true,media:previewMedia,...(week?{weekActivities:week}:{}),...(next?{nextActivity:next.activities[0]??null}:{}),...(day?{dayActivities:day}:{})} as Record<string,any>;
    safeProjection.actionAvailability={...safeProjection.actionAvailability,newMessage:false,homeAssistantControl:false};
    safeProjection.householdBoards={...safeProjection.householdBoards,writable:{groceries:false,dinners:false}};
    return safeProjection;
  });

  app.post('/api/v1/households/:householdId/display-setups',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');
    const body=parse(displaySetupCreateSchema,request.body) as DisplaySetupInput;
    const setup=await transaction(async(client)=>{
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      const inserted=await client.query<{id:string}>(`INSERT INTO display_setups(household_id,name,cards,card_order,family_layout_enabled,album_ids,background_id,locale,theme)
        VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9) RETURNING id`,[auth.householdId,body.name,JSON.stringify(body.cards),JSON.stringify(body.cardOrder),body.familyLayoutEnabled,JSON.stringify(body.albumIds),body.backgroundId,body.locale,body.theme]);
      await writeDisplaySetupSelections(client,auth.householdId,inserted.rows[0]!.id,body,auth.membershipId,false);
      return displaySetupResponse(client,auth.householdId,inserted.rows[0]!.id);
    });
    return reply.status(201).send(setup);
  });

  app.patch('/api/v1/households/:householdId/display-setups/:setupId',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');
    const body=parse(displaySetupUpdateSchema,request.body);const input:DisplaySetupInput=body;
    return transaction(async(client)=>{
      const current=(await client.query<{revision:number}>(`SELECT revision FROM display_setups WHERE id=$1 AND household_id=$2 FOR UPDATE`,[params(request).setupId,auth.householdId])).rows[0];
      if(!current)throw new DomainError('NOT_FOUND',404);
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      if(current.revision!==body.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:current.revision});
      await writeDisplaySetupSelections(client,auth.householdId,params(request).setupId!,input,auth.membershipId);
      return displaySetupResponse(client,auth.householdId,params(request).setupId!);
    });
  });

  app.get('/api/v1/households/:householdId/displays', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'household.view');
    const result = await pool.query(`SELECT d.id,d.name,d.setup_id,COALESCE(d.locale,s.locale) AS locale,COALESCE(d.theme,s.theme) AS theme,d.privacy_mode,d.external_items_enabled,d.revoked_at,d.last_seen_at,d.created_at,
      COALESCE((SELECT json_agg(person_id ORDER BY person_id) FROM display_person_grants g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.profile_allowed),'[]') AS profile_person_ids,
      COALESCE((SELECT json_agg(person_id ORDER BY person_id) FROM display_person_grants g WHERE g.household_id=d.household_id AND g.display_id=d.id AND g.birthday_allowed),'[]') AS birthday_person_ids
      FROM displays d JOIN display_setups s ON s.id=d.setup_id AND s.household_id=d.household_id WHERE d.household_id=$1 ORDER BY d.created_at`, [auth.householdId]);
    return {displays:auth.capabilities.includes('display.manage')?await Promise.all(result.rows.map((row)=>displayAdministrativeResponse(pool,auth.householdId,String(row.id)))):result.rows};
  });

  app.patch('/api/v1/households/:householdId/displays/:displayId', async (request) => {
    const auth = await authForHousehold(request, params(request).householdId!);
    requireCapability(auth.capabilities, 'display.manage');
    const body = parse(displayUpdateSchema, request.body);
    return transaction(async(client)=>{
      const locked=(await client.query<{id:string}>('SELECT id FROM displays WHERE id=$1 AND household_id=$2 FOR UPDATE',[params(request).displayId,auth.householdId])).rows[0];
      if(!locked)throw new DomainError('NOT_FOUND',404);
      if(body.setupId){const setup=await client.query('SELECT id FROM display_setups WHERE household_id=$1 AND id=$2 FOR SHARE',[auth.householdId,body.setupId]);if(!setup.rowCount)throw new DomainError('NOT_FOUND',404);}
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      if(body.birthdayPersonIds!==undefined){const current=(await client.query<{birthday_mode:string}>('SELECT birthday_mode FROM displays WHERE id=$1 AND household_id=$2',[params(request).displayId,auth.householdId])).rows[0]!;if(current.birthday_mode!=='legacy_selected')throw new DomainError('VALIDATION_FAILED',400,{reason:'birthday_policy_explicit_required'});}
      if(body.personIdsOverride?.length){
        const people=await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[auth.householdId,body.personIdsOverride]);
        if(people.rowCount!==body.personIdsOverride.length)throw new DomainError('NOT_FOUND',404);
      }
      const result = await client.query(`UPDATE displays SET setup_id=COALESCE($10::uuid,setup_id),locale=CASE WHEN $3::boolean THEN $4::text ELSE locale END,theme=CASE WHEN $5::boolean THEN $6::text ELSE theme END,
        privacy_mode=COALESCE($7,privacy_mode),external_items_enabled=COALESCE($8,external_items_enabled),revoked_at=CASE WHEN $9::boolean IS TRUE THEN clock_timestamp() ELSE revoked_at END,credential_hash=CASE WHEN $9::boolean IS TRUE THEN NULL ELSE credential_hash END
        WHERE id=$1 AND household_id=$2 RETURNING id`, [params(request).displayId,auth.householdId,Object.hasOwn(body,'locale'),body.locale??null,Object.hasOwn(body,'theme'),body.theme??null,body.privacyMode ?? null,body.externalItemsEnabled ?? null,body.revoked ?? null,body.setupId??null]);
      if (!result.rowCount) throw new DomainError('NOT_FOUND', 404);
      if(Object.hasOwn(body,'birthdayMode')||Object.hasOwn(body,'personIdsOverride'))await client.query(`UPDATE displays SET birthday_mode=COALESCE($3,birthday_mode),person_ids_override=CASE WHEN $4::boolean THEN $5::uuid[] ELSE person_ids_override END WHERE id=$1 AND household_id=$2`,[params(request).displayId,auth.householdId,body.birthdayMode??null,Object.hasOwn(body,'personIdsOverride'),body.personIdsOverride??null]);
      if(Object.hasOwn(body,'profilePersonIds')||Object.hasOwn(body,'birthdayPersonIds'))await updateDisplayPersonGrants(client,auth.householdId,params(request).displayId!,body.profilePersonIds,body.birthdayPersonIds);
      if(body.revoked) await client.query(`UPDATE message_display_targets SET delivery_state='failed',failure_code='DISPLAY_REVOKED' WHERE display_id=$1 AND delivery_state='queued'`,[params(request).displayId]);
      await audit(client,auth,body.revoked === true?'display.revoked':'display.updated','display',params(request).displayId,{privacyMode:body.privacyMode,externalItemsEnabled:body.externalItemsEnabled,profileGrantCount:body.profilePersonIds?.length,birthdayGrantCount:body.birthdayPersonIds?.length,birthdayMode:body.birthdayMode,personOverrideCount:body.personIdsOverride===null?null:body.personIdsOverride?.length});
      return displayAdministrativeResponse(client,auth.householdId,params(request).displayId!);
    });
  });

  app.patch('/api/v1/households/:householdId/displays/:displayId/action-policy',async(request)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');
    const body=parse(displayActionPolicyUpdateSchema,request.body);const displayId=params(request).displayId!;
    return transaction(async(client)=>{
      if(body.displayIds.includes(displayId))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_message_recipient'});
      const lockIds=[...new Set([displayId,...body.displayIds])].sort();
      const lockedDisplays=(await client.query<{id:string;revoked_at:Date|null;credential_expires_at:Date|null}>(`SELECT id,revoked_at,credential_expires_at FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,[auth.householdId,lockIds])).rows;
      if(lockedDisplays.length!==lockIds.length)throw new DomainError('NOT_FOUND',404);
      const current=(await client.query<{revision:number}>(`SELECT revision FROM display_action_policies WHERE household_id=$1 AND display_id=$2 FOR UPDATE`,[auth.householdId,displayId])).rows[0];
      if(!current)throw new DomainError('NOT_FOUND',404);
      const people=body.personIds.length?(await client.query<{id:string}>(`SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,[auth.householdId,body.personIds])).rows:[];
      const recipientRows=lockedDisplays.filter((row)=>body.displayIds.includes(row.id));
      if(people.length!==body.personIds.length||recipientRows.some((row)=>row.revoked_at||!row.credential_expires_at||row.credential_expires_at<=new Date()))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_message_recipient'});
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      if(current.revision!==body.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:current.revision});
      await client.query(`UPDATE display_action_policies SET message_create=$3,message_schedule=$4,grocery_write=$5,dinner_write=$6,photo_upload=$7,home_assistant_control=$8,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND display_id=$2`,[auth.householdId,displayId,body.messageCreate,body.messageSchedule,body.groceryWrite,body.dinnerWrite,body.photoUpload,body.homeAssistantControl]);
      await client.query('DELETE FROM display_action_people WHERE display_id=$1',[displayId]);
      await client.query('DELETE FROM display_action_displays WHERE display_id=$1',[displayId]);
      for(const personId of body.personIds)await client.query('INSERT INTO display_action_people(household_id,display_id,person_id) VALUES($1,$2,$3)',[auth.householdId,displayId,personId]);
      for(const recipientId of body.displayIds)await client.query('INSERT INTO display_action_displays(household_id,display_id,recipient_display_id) VALUES($1,$2,$3)',[auth.householdId,displayId,recipientId]);
      const policy=(await client.query(`SELECT revision,message_create AS "messageCreate",message_schedule AS "messageSchedule",grocery_write AS "groceryWrite",dinner_write AS "dinnerWrite",photo_upload AS "photoUpload",home_assistant_control AS "homeAssistantControl" FROM display_action_policies WHERE display_id=$1`,[displayId])).rows[0];
      await audit(client,auth,'display.action_policy_updated','display',displayId,{revision:policy.revision,messageCreate:body.messageCreate,messageSchedule:body.messageSchedule,personRecipientCount:body.personIds.length,displayRecipientCount:body.displayIds.length});
      return{...policy,personIds:body.personIds,displayIds:body.displayIds};
    });
  });

  app.get('/api/v1/display/message-recipients',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    const policy=(await pool.query<{revision:number;messageCreate:boolean;messageSchedule:boolean}>(`SELECT revision,message_create AS "messageCreate",message_schedule AS "messageSchedule" FROM display_action_policies WHERE household_id=$1 AND display_id=$2`,[display.householdId,display.id])).rows[0];
    if(!policy)throw new DomainError('UNAUTHENTICATED',401);
    const [people,displays]=await Promise.all([
      pool.query(`SELECT p.id,p.display_name AS "displayName" FROM display_action_people allowed JOIN persons p ON p.id=allowed.person_id AND p.household_id=allowed.household_id WHERE allowed.household_id=$1 AND allowed.display_id=$2 ORDER BY p.display_name,p.id`,[display.householdId,display.id]),
      pool.query(`SELECT recipient.id,recipient.name FROM display_action_displays allowed JOIN displays recipient ON recipient.id=allowed.recipient_display_id AND recipient.household_id=allowed.household_id WHERE allowed.household_id=$1 AND allowed.display_id=$2 AND recipient.revoked_at IS NULL AND recipient.credential_expires_at>clock_timestamp() ORDER BY recipient.name,recipient.id`,[display.householdId,display.id])
    ]);
    return{policy,people:people.rows,displays:displays.rows};
  });

  app.post('/api/v1/display/messages',async(request,reply)=>{
    const display=await displayAuth(request);const body=parse(displayMessageCreateSchema,request.body);
    await durableRateLimit('display_message_create',display.id,12,60);
    await durableRateLimit('display_message_create_ip',request.ip,60,60);
    const publishAt=body.publishAt?new Date(body.publishAt):undefined;const expiresAt=new Date(body.expiresAt);
    const requestHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const result=await transaction(async(client)=>{
      const actor=await lockDisplayMessageActor(client,request,display,body.audience.displayIds);
      await lockDisplayMessageRecipients(client,display,body.audience.personIds,body.audience.displayIds);
      const existing=(await client.query<{id:string;request_hash:string|null;state:string;revision:number}>(`SELECT id,request_hash,state,revision FROM messages WHERE author_display_id=$1 AND idempotency_key=$2 FOR UPDATE`,[actor.id,body.idempotencyKey])).rows[0];
      const active=(await client.query<{count:number}>(`SELECT count(*)::int AS count FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[])
        AND revoked_at IS NULL AND credential_expires_at>clock_timestamp()`,[display.householdId,[actor.id,...body.audience.displayIds]])).rows[0]!.count;
      if(active!==new Set([actor.id,...body.audience.displayIds]).size)throw new DomainError('UNAUTHENTICATED',401);
      const now=new Date();const effectivePublishAt=publishAt??now;const state=initialMessageState(effectivePublishAt,expiresAt,now);
      if(effectivePublishAt>now&&!actor.messageSchedule)throw new DomainError('FORBIDDEN',403,{reason:'display_action_not_granted'});
      if(existing){if(existing.request_hash!==requestHash)throw new DomainError('CONFLICT',409,{reason:'idempotency_payload_mismatch'});return{id:existing.id,state:existing.state,revision:existing.revision,replayed:true};}
      const inserted=(await client.query<{id:string;revision:number}>(`INSERT INTO messages(household_id,author_display_id,author_display_name,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
        VALUES($1,$2,$3,$4,$5,false,$6,$7,$8,$9,CASE WHEN $8='published' THEN clock_timestamp() END) RETURNING id,revision`,[actor.householdId,actor.id,actor.name,body.body,body.importance,effectivePublishAt,expiresAt,state,body.idempotencyKey])).rows[0]!;
      await client.query('UPDATE messages SET request_hash=$2 WHERE id=$1',[inserted.id,requestHash]);
      for(const personId of body.audience.personIds)await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[actor.householdId,inserted.id,personId]);
      for(const recipientId of body.audience.displayIds)await client.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'queued')`,[actor.householdId,inserted.id,recipientId]);
      await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,actor_display_name,idempotency_key) VALUES($1,NULL,$2,1,'display',$3,$4,$5)`,[inserted.id,state,actor.id,actor.name,`create:${inserted.id}`]);
      return{...(await client.query(`SELECT id,body,importance,publish_at AS "publishAt",expires_at AS "expiresAt",state,revision FROM messages WHERE id=$1`,[inserted.id])).rows[0],replayed:false};
    });
    return reply.status(result.replayed?200:201).header('Cache-Control','no-store').send(result);
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

  app.post('/api/v1/households/:householdId/displays/:displayId/pairing/approve',async(request,reply)=>{
    const auth=await authForHousehold(request,params(request).householdId!);requireCapability(auth.capabilities,'display.manage');
    const body=parse(displayReconnectApproveSchema,request.body);
    await durableRateLimit('pairing_approve_ip',request.ip,20,900);await durableRateLimit('pairing_approve',`${request.ip}:${body.code}`,10,900);
    const result=await transaction(async(client)=>{
      const pairing=(await client.query<{id:string}>(`SELECT id FROM pairing_requests WHERE code_hash=$1 AND expires_at>clock_timestamp() AND approved_at IS NULL AND redeemed_at IS NULL FOR UPDATE`,[tokenHash(body.code)])).rows[0];
      if(!pairing)throw new DomainError('PAIRING_INVALID',404);
      const device=(await client.query<{id:string;credential_generation:number}>(`SELECT id,credential_generation FROM displays WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR UPDATE`,[params(request).displayId,auth.householdId])).rows[0];
      if(!device)throw new DomainError('NOT_FOUND',404);
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      if(device.credential_generation!==body.expectedCredentialGeneration)throw new DomainError('REVISION_CONFLICT',409,{credentialGeneration:device.credential_generation});
      const approved=await client.query(`UPDATE pairing_requests SET approved_at=clock_timestamp(),display_id=$2,expected_credential_generation=$3 WHERE id=$1 AND approved_at IS NULL AND redeemed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,[pairing.id,device.id,device.credential_generation]);
      if(!approved.rowCount)throw new DomainError('PAIRING_EXPIRED',410);
      await audit(client,auth,'display.reconnect_approved','display',device.id,{credentialGeneration:device.credential_generation});
      return{displayId:device.id,credentialGeneration:device.credential_generation};
    });
    return reply.header('Cache-Control','no-store').send(result);
  });

  app.post('/api/v1/display/disconnect',async(request,reply)=>{
    parse(displayDisconnectSchema,request.body);
    const token=request.cookies[DISPLAY_COOKIE];
    if(token)await pool.query(`UPDATE displays SET credential_hash=NULL,credential_expires_at=NULL,credential_generation=credential_generation+1 WHERE credential_hash=$1 AND revoked_at IS NULL`,[tokenHash(token)]);
    reply.clearCookie(DISPLAY_COOKIE,{path:'/api/v1/display',sameSite:'strict',secure:runtime.secureCookies,httpOnly:true});
    return reply.header('Cache-Control','no-store').status(204).send();
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
      await recheckHouseholdAuth(client,request,auth,'display.manage');
      let setupId=body.setupId;
      if(setupId){
        const setup=await client.query('SELECT id FROM display_setups WHERE id=$1 AND household_id=$2 FOR SHARE',[setupId,auth.householdId]);
        if(!setup.rowCount)throw new DomainError('NOT_FOUND',404);
      }else setupId=await defaultDisplaySetup(client,auth.householdId);
      const display = await client.query<{id:string}>(`INSERT INTO displays(household_id,setup_id,name,locale,theme,privacy_mode,allowed_content) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [auth.householdId,setupId,body.name,body.locale??null,body.theme??null,body.privacyMode,body.allowedContent]);
      const approved = await client.query(`UPDATE pairing_requests SET approved_at=clock_timestamp(),display_id=$2,expected_credential_generation=(SELECT credential_generation FROM displays WHERE id=$2) WHERE id=$1 AND approved_at IS NULL RETURNING id`, [pairing.rows[0]!.id,display.rows[0]!.id]);
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
      const pairing = await client.query<{id:string;display_id:string|null;verifier_hash:string;expected_credential_generation:number|null}>(`SELECT id,display_id,verifier_hash,expected_credential_generation FROM pairing_requests WHERE id=$1 AND expires_at>clock_timestamp() AND approved_at IS NOT NULL AND redeemed_at IS NULL FOR UPDATE`, [body.pairingId]);
      const row = pairing.rows[0];
      if (!row || tokenHash(body.verifier) !== row.verifier_hash || !row.display_id) throw new DomainError('PAIRING_EXPIRED', 410);
      const target=await client.query(`SELECT id FROM displays WHERE id=$1 AND credential_generation=$2 AND revoked_at IS NULL FOR UPDATE`,[row.display_id,row.expected_credential_generation]);
      if(!target.rowCount)throw new DomainError('PAIRING_EXPIRED',410);
      const claimed = await client.query(`UPDATE pairing_requests SET redeemed_at=clock_timestamp() WHERE id=$1 AND redeemed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`, [row.id]);
      if (!claimed.rowCount) throw new DomainError('PAIRING_EXPIRED', 410);
      const display = await client.query(`UPDATE displays d SET credential_hash=$2,credential_expires_at=clock_timestamp()+interval '90 days',credential_generation=credential_generation+1
        FROM display_setups s WHERE d.id=$1 AND d.setup_id=s.id AND d.household_id=s.household_id AND d.revoked_at IS NULL AND d.credential_generation=$3
        RETURNING d.id,d.name,COALESCE(d.locale,s.locale) AS locale,COALESCE(d.theme,s.theme) AS theme,d.privacy_mode,d.external_items_enabled,d.setup_id`, [row.display_id,tokenHash(credential),row.expected_credential_generation]);
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
      COALESCE(p.display_name,m.author_display_name) AS author_name,CASE WHEN m.author_display_id IS NULL THEN 'member' ELSE 'display' END AS author_type,m.author_display_id,p.id AS author_person_id,COALESCE((m.author_membership_id=$3 OR $2),false) AS can_edit,
      COALESCE((SELECT json_agg(person_id) FROM message_person_audiences WHERE message_id=m.id),'[]') AS person_ids,
      COALESCE((SELECT json_agg(display_id) FROM message_display_targets WHERE message_id=m.id AND delivery_state<>'cancelled'),'[]') AS display_ids,
      COALESCE((SELECT json_agg(json_build_object('displayId',display_id,'state',delivery_state,'deliveredAt',delivered_at,'displayedAt',displayed_at,'revision',delivered_revision)) FROM message_display_targets WHERE message_id=m.id),'[]') AS deliveries,
      COALESCE((SELECT json_agg(json_build_object('action',CASE WHEN e.from_state=e.to_state THEN 'edited' ELSE 'withdrawn' END,'actorName',ep.display_name,'occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id)
        FROM message_lifecycle_events e JOIN memberships em ON em.account_id=e.actor_id AND em.household_id=m.household_id JOIN persons ep ON ep.id=em.person_id AND ep.household_id=em.household_id
        WHERE e.message_id=m.id AND e.actor_type='account' AND (e.from_state=e.to_state OR e.to_state IN ('cancelled','withdrawn'))),'[]') AS activity
      FROM messages m LEFT JOIN memberships am ON am.id=m.author_membership_id LEFT JOIN persons p ON p.id=am.person_id AND p.household_id=m.household_id
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

  app.get('/api/v1/display/activities/sources',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    const {limit,cursor}=activitySourcePagination((request.query??{}) as Record<string,unknown>);
    return transaction(async(client)=>{
      const current=await displayContextForManager(display.householdId,display.id,client,true,true);
      if(current.credentialHash!==display.credentialHash)throw new DomainError('UNAUTHENTICATED',401);
      const rows=!current.privacyMode&&current.externalItemsEnabled&&current.cards.includes('external_items')?(await client.query<{id:string;name:string}>(`SELECT source.id,COALESCE(source.display_name,source.name) AS name
        FROM calendar_sources source
        JOIN calendar_connections connection ON connection.id=source.connection_id AND connection.household_id=source.household_id
        JOIN integration_connections integration ON integration.id=connection.integration_connection_id AND integration.household_id=source.household_id AND integration.revoked_at IS NULL
        JOIN calendar_source_display_targets source_grant ON source_grant.source_id=source.id AND source_grant.household_id=source.household_id AND source_grant.display_id=$2
        JOIN integration_connection_display_grants connection_grant ON connection_grant.connection_id=integration.id AND connection_grant.household_id=source.household_id AND connection_grant.display_id=$2
        WHERE source.household_id=$1 AND source.enabled AND connection.disconnected_at IS NULL
          AND ($3::boolean OR source.id=ANY($4::uuid[]))
          AND (source.subject_household OR EXISTS(SELECT 1 FROM calendar_source_person_subjects subject WHERE subject.household_id=source.household_id AND subject.source_id=source.id AND subject.person_id=ANY($5::uuid[])))
          AND ($6::uuid IS NULL OR source.id>$6::uuid)
        ORDER BY source.id LIMIT $7`,[display.householdId,display.id,current.allSources,current.calendarSourceIds,current.selectedPersonIds,cursor,limit+1])).rows:[];
      const live=(await client.query(`SELECT id FROM displays WHERE id=$1 AND household_id=$2 AND credential_hash=$3 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp()
        AND privacy_mode=$4 AND external_items_enabled=$5 AND setup_id=$6`,[display.id,display.householdId,display.credentialHash,current.privacyMode,current.externalItemsEnabled,current.setupId])).rows[0];
      if(!live)throw new DomainError('UNAUTHENTICATED',401);
      return activitySourcePage(rows,limit);
    });
  });

  app.get('/api/v1/display/activities',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    if(display.privacyMode)return{from:null,to:null,activities:[],nextCursor:null,serverNow:new Date().toISOString()};
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[display.householdId])).rows[0];
    if(!household)throw new DomainError('UNAUTHENTICATED',401);
    const today=localDateInTimezone(new Date(),household.timezone);const query=(request.query??{}) as Record<string,unknown>;
    const from=dateOnly(query.from),to=dateOnly(query.to);
    if(!from||!to||from<weekStart(today))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_date_window'});
    const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000+1;
    if(days<1||days>7)throw new DomainError('VALIDATION_FAILED',400,{reason:'activity_window_max_seven_days'});
    const requested=activityIdFilter(query.personIds,'activity_people',50);
    const personIds=requested?display.selectedPersonIds.filter((id)=>requested.includes(id)):display.selectedPersonIds;
    const limit=query.limit===undefined?20:Number(query.limit);
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_limit'});
    const page=await personActivities({householdId:display.householdId,personIds,viewer:{personId:display.id,membershipId:display.id},canViewAll:false,from,to,limit,cursor:decodeActivityCursor(query.cursor),maxDays:7,display});
    const activities=page.activities.map((row)=>{const normalized={...row};if(row.type==='calendar'){const subjects=row.subjects as {personIds?:unknown}|undefined;normalized.personIds=Array.isArray(subjects?.personIds)?subjects.personIds:[];}else normalized.personIds=Array.isArray(row.personIds)?row.personIds:typeof row.personId==='string'?[row.personId]:[];delete normalized.personId;return normalized;});
    return{from,to,...page,activities,serverNow:new Date().toISOString()};
  });

  app.get('/api/v1/display/activities/next',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    if(display.privacyMode)return{activity:null,serverNow:new Date().toISOString()};
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[display.householdId])).rows[0];
    if(!household)throw new DomainError('UNAUTHENTICATED',401);
    const query=(request.query??{}) as Record<string,unknown>;const requested=activityIdFilter(query.personIds,'activity_people',50);
    const personIds=requested?display.selectedPersonIds.filter((id)=>requested.includes(id)):display.selectedPersonIds;
    const from=localDateInTimezone(new Date(),household.timezone);const to=dateOffset(from,365);
    const page=await personActivities({householdId:display.householdId,personIds,viewer:{personId:display.id,membershipId:display.id},canViewAll:false,from,to,limit:1,maxDays:366,upcomingOnly:true,display});
    const activity=page.activities[0]??null;
    if(activity){if(activity.type==='calendar'){const subjects=activity.subjects as {personIds?:unknown}|undefined;activity.personIds=Array.isArray(subjects?.personIds)?subjects.personIds:[];}else activity.personIds=Array.isArray(activity.personIds)?activity.personIds:typeof activity.personId==='string'?[activity.personId]:[];delete activity.personId;}
    return{activity,serverNow:new Date().toISOString()};
  });

  app.get('/api/v1/display/people/:personId/activities',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    const personId=params(request).personId!;if(display.privacyMode||!display.selectedPersonIds.includes(personId))throw new DomainError('NOT_FOUND',404);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[display.householdId])).rows[0];if(!household)throw new DomainError('UNAUTHENTICATED',401);
    const today=localDateInTimezone(new Date(),household.timezone),query=(request.query??{}) as Record<string,unknown>,from=dateOnly(query.from),to=dateOnly(query.to);
    if(!from||!to||from<weekStart(today))throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_date_window'});
    const days=(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86_400_000+1;if(days<1||days>7)throw new DomainError('VALIDATION_FAILED',400,{reason:'activity_window_max_seven_days'});
    const limit=query.limit===undefined?20:Number(query.limit);if(!Number.isInteger(limit)||limit<1||limit>50)throw new DomainError('VALIDATION_FAILED',400,{reason:'invalid_activity_limit'});
    const page=await personActivities({householdId:display.householdId,personIds:[personId],viewer:{personId:display.id,membershipId:display.id},canViewAll:false,from,to,limit,cursor:decodeActivityCursor(query.cursor),maxDays:7,display});
    const activities=page.activities.map((row)=>{const normalized={...row};if(row.type==='calendar'){const subjects=row.subjects as {personIds?:unknown}|undefined;normalized.personIds=Array.isArray(subjects?.personIds)?subjects.personIds:[];}else normalized.personIds=Array.isArray(row.personIds)?row.personIds:[];delete normalized.personId;return normalized;});
    return{personId,from,to,...page,activities,serverNow:new Date().toISOString()};
  });

  app.get('/api/v1/display/people/:personId/activities/next',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    const personId=params(request).personId!;if(display.privacyMode||!display.selectedPersonIds.includes(personId))throw new DomainError('NOT_FOUND',404);
    const household=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[display.householdId])).rows[0];if(!household)throw new DomainError('UNAUTHENTICATED',401);
    const from=localDateInTimezone(new Date(),household.timezone),page=await personActivities({householdId:display.householdId,personIds:[personId],viewer:{personId:display.id,membershipId:display.id},canViewAll:false,from,to:dateOffset(from,365),limit:1,maxDays:366,upcomingOnly:true,display});
    const activity=page.activities[0]??null;if(activity){if(activity.type==='calendar'){const subjects=activity.subjects as {personIds?:unknown}|undefined;activity.personIds=Array.isArray(subjects?.personIds)?subjects.personIds:[];}else activity.personIds=Array.isArray(activity.personIds)?activity.personIds:[];delete activity.personId;}
    return{personId,activity,serverNow:new Date().toISOString()};
  });

  app.get('/api/v1/display/people/:personId/school-activities/:eventId',async(request,reply)=>{
    const display=await displayAuth(request);reply.header('Cache-Control','private, no-store');
    if(display.privacyMode)throw new DomainError('NOT_FOUND',404);
    const personId=params(request).personId!,eventId=params(request).eventId!;if(!display.selectedPersonIds.includes(personId))throw new DomainError('NOT_FOUND',404);
    const row=(await pool.query<SchoolActivityRow>(`SELECT ${schoolActivitySelect},${displaySchoolWitnessSql('$4','ARRAY[$2::uuid]','$5','TRUE')} AS acl_witness
      FROM monitor_events event JOIN monitor_tasks task ON task.id=event.task_id AND task.household_id=event.household_id
      JOIN LATERAL (SELECT subject.person_id,ARRAY[subject.person_id] AS person_ids FROM monitor_task_subjects subject WHERE subject.task_id=task.id AND subject.household_id=task.household_id AND subject.person_id=$2) subject ON true
      JOIN households household ON household.id=task.household_id
      JOIN messages message ON message.id=event.message_id AND message.household_id=event.household_id
      JOIN message_display_targets target ON target.household_id=message.household_id AND target.message_id=message.id AND target.display_id=$4 AND target.delivery_state IN ('queued','delivered','displayed')
      ${schoolProvenanceJoins}
      WHERE event.id=$1 AND event.household_id=$3 AND event.active AND event.actions IS NOT NULL AND task.presentation_kind='school' AND task.state='active' AND task.approved_revision=task.revision
        AND event.school_expires_at>clock_timestamp() AND jsonb_typeof(event.actions)='array' AND ${schoolHasPracticalActionsSql}
        AND message.state='published' AND message.publish_at<=clock_timestamp() AND message.expires_at>clock_timestamp()
        AND ${schoolTaskAuthorized}
        AND (message.audience_household OR NOT EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=message.id)
          OR EXISTS(SELECT 1 FROM message_person_audiences audience WHERE audience.message_id=message.id AND audience.person_id=ANY($5::uuid[])))`,[eventId,personId,display.householdId,display.id,display.selectedPersonIds])).rows[0];
    if(!row)throw new DomainError('NOT_FOUND',404);
    rememberDisplaySchools(display,[row],[personId],display.selectedPersonIds,true);
    return{type:'school',id:row.id,taskId:row.task_id,personId:row.person_id,date:row.event_date,time:row.event_time,startsAt:row.activity_at.toISOString(),kind:row.event_type,title:row.description,...schoolProjectionMetadata(row),evidence:row.evidence,confidence:row.confidence,uncertainty:row.uncertainty,sourceUrl:row.source_url,expiresAt:row.school_expires_at?.toISOString()??null};
  });

  app.post('/api/v1/display/render-ack', async (request, reply) => {
    const display=await displayAuth(request);
    if(display.privacyMode||!display.cards.includes('household_messages')) throw new DomainError('FORBIDDEN',403);
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
          AND (m.audience_household OR NOT EXISTS(SELECT 1 FROM message_person_audiences restricted WHERE restricted.message_id=m.id)
            OR EXISTS(SELECT 1 FROM message_person_audiences selected WHERE selected.message_id=m.id AND selected.person_id=ANY($5::uuid[])))
          AND t.delivery_state IN ('delivered','displayed') AND t.delivered_revision=$4
        FOR UPDATE OF t,d,m`,[body.cardId,display.id,display.householdId,body.revision,display.selectedPersonIds]);
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
    await assertDisplayCredential(display);
    const unsubscribe=projectionEvents.subscribe(display.id,display.householdId,send,()=>reply.raw.end(),()=>assertDisplayCredential(display));
    try{await assertDisplayCredential(display);}catch(error){unsubscribe();throw error;}
    reply.hijack();
    const response=reply.raw;
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no',...responseSecurityHeaders});
    const initiallyConnected=projectionEvents.listenerConnected();
    send({type:'ready',data:{generatedAt:new Date().toISOString(),listenerConnected:initiallyConnected,pollingFallback:!initiallyConnected}});
    if(!initiallyConnected)send({type:'listener-degraded',data:{pollingFallback:true,listenerConnected:false,reason:'notification-listener-unavailable'}});
    const revalidateMs=Math.max(50,Number(process.env.SAMVEV_SSE_REVALIDATE_MS ?? 15_000));
    const timer=setInterval(async()=>{
      try{
        await assertDisplayCredential(display);
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
      const colorToken=await assignPersonColor(client,householdId);
      const person=(await client.query<{id:string}>('INSERT INTO persons(household_id,display_name,age_group,color_token) VALUES ($1,$2,$3,$4) RETURNING id',[householdId,row.name,row.age,colorToken])).rows[0]!;
      let accountId:null|string=null;
      if(row.email){const password=await hashPassword('Synthetic-demo-pass-42');accountId=(await client.query<{id:string}>('INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES ($1,$2,$3,\'en\',\'system\') RETURNING id',[installation,row.email,password])).rows[0]!.id;}
      await client.query('INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES ($1,$2,$3,$4,$5)',[householdId,accountId,person.id,row.role,JSON.stringify(row.caps)]);
    }
    await client.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
      VALUES ($1,$2,'Welcome to the synthetic Samvev demo','normal',true,clock_timestamp(),clock_timestamp()+interval '8 hours','published','demo-welcome-v1',clock_timestamp()),
             ($1,$2,'Remember the synthetic gym bag','attention',true,clock_timestamp()+interval '2 minutes',clock_timestamp()+interval '7 minutes','scheduled','demo-schedule-v1',NULL)`,[householdId,author]);
  });
}
