import { createHash } from 'node:crypto';
import { DomainError } from '@samvev/core';
import { AiCredentialVault } from '../ai/credential-vault.ts';
import { pool, transaction, type DbClient } from '../db.ts';

export type RegisteredCalendarProvider='google'|'microsoft'|'home_assistant';
export type ProviderRuntimeConfig={
  provider:RegisteredCalendarProvider;
  source:'database'|'legacy_environment';
  revision:number;
  clientIdHash:string;
  clientId:string;
  clientSecret?:string;
  tenant?:string;
  origin?:string;
};
export type ProviderConfigActor={installationId:string;householdId:string;accountId:string;sessionId:string;membershipId:string;capabilities:string[]};

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const aad=(installationId:string,provider:RegisteredCalendarProvider)=>`${installationId}:calendar-provider:${provider}`;
const GOOGLE_AUTH_ENDPOINTS=new Set(['https://accounts.google.com/o/oauth2/auth','https://accounts.google.com/o/oauth2/v2/auth']);
const GOOGLE_TOKEN_ENDPOINTS=new Set(['https://accounts.google.com/o/oauth2/token','https://oauth2.googleapis.com/token']);

export function calendarCallbackUri(publicOrigin:string,provider:RegisteredCalendarProvider):string{
  let origin:URL;try{origin=new URL(publicOrigin);}catch{throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_public_origin_invalid'});}
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.origin!==publicOrigin)throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_public_origin_invalid'});
  return `${origin.origin}/api/v1/calendar/oauth/${provider}/callback`;
}

export function normalizeHomeAssistantOrigin(value:string):string{
  let url:URL;try{url=new URL(value);}catch{throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_origin_invalid'});}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_origin_invalid'});
  return url.origin;
}

function tenant(value:string|undefined):string{
  const result=(value??'common').trim();
  if(!/^(?:common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(result))throw new DomainError('VALIDATION_FAILED',400,{reason:'microsoft_tenant_invalid'});
  return result;
}

function nonSecretHint(clientId:string):string{return clientId.length<=12?clientId:`${clientId.slice(0,6)}…${clientId.slice(-4)}`;}

export class CalendarProviderConfigurationService{
  constructor(private readonly vault=new AiCredentialVault()){}

  async resolve(installationId:string,provider:RegisteredCalendarProvider):Promise<ProviderRuntimeConfig>{
    const row=(await pool.query<{status:'active'|'disabled';config_ciphertext:string|null;client_id_hash:string|null;revision:number}>(`SELECT status,config_ciphertext,client_id_hash,revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2`,[installationId,provider])).rows[0];
    if(row){
      if(row.status!=='active'||!row.config_ciphertext)throw new DomainError('CONFLICT',409,{reason:`${provider}_calendar_registration_missing`});
      let parsed:Record<string,unknown>;try{parsed=JSON.parse(await this.vault.decrypt(aad(installationId,provider),row.config_ciphertext));}catch{throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_provider_configuration_invalid'});}
      const clientId=typeof parsed.clientId==='string'?parsed.clientId:'';
      if(!clientId||sha(clientId)!==row.client_id_hash)throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_provider_configuration_invalid'});
      if(provider==='home_assistant')return{provider,source:'database',revision:row.revision,clientIdHash:row.client_id_hash!,clientId,origin:normalizeHomeAssistantOrigin(String(parsed.origin??''))};
      const clientSecret=typeof parsed.clientSecret==='string'?parsed.clientSecret:'';if(!clientSecret)throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_provider_configuration_invalid'});
      return{provider,source:'database',revision:row.revision,clientIdHash:row.client_id_hash!,clientId,clientSecret,...(provider==='microsoft'?{tenant:tenant(String(parsed.tenant??'common'))}:{})};
    }
    if(provider==='home_assistant')throw new DomainError('CONFLICT',409,{reason:'home_assistant_calendar_registration_missing'});
    const prefix=provider==='google'?'SAMVEV_GOOGLE_CALENDAR':'SAMVEV_MICROSOFT_CALENDAR';
    const clientId=process.env[`${prefix}_CLIENT_ID`]?.trim(),clientSecret=process.env[`${prefix}_CLIENT_SECRET`]?.trim();
    if(!clientId||!clientSecret)throw new DomainError('CONFLICT',409,{reason:`${provider}_calendar_registration_missing`});
    return{provider,source:'legacy_environment',revision:0,clientIdHash:sha(clientId),clientId,clientSecret,...(provider==='microsoft'?{tenant:tenant(process.env.SAMVEV_MICROSOFT_CALENDAR_TENANT)}:{})};
  }

  async readiness(actor:ProviderConfigActor,publicOrigin:string){
    if(!actor.capabilities.includes('installation.manage'))throw new DomainError('FORBIDDEN',403);
    const rows=await pool.query<{provider:RegisteredCalendarProvider;status:'active'|'disabled';revision:number;config_ciphertext:string|null}>(`SELECT provider,status,revision,config_ciphertext FROM installation_calendar_provider_configs WHERE installation_id=$1`,[actor.installationId]);
    const result:Record<string,unknown>={};
    for(const provider of ['google','microsoft','home_assistant'] as const){
      const row=rows.rows.find((item)=>item.provider===provider);let runtime:ProviderRuntimeConfig|undefined;
      try{runtime=await this.resolve(actor.installationId,provider);}catch{/* represented as missing/disabled */}
      result[provider]={
        state:row?.status==='disabled'?'disabled':runtime?'configured':'missing',
        configured:Boolean(runtime),source:row?'database':runtime?.source??'none',revision:row?.revision??runtime?.revision??0,
        redirectUri:calendarCallbackUri(publicOrigin,provider),
        clientIdHint:runtime?nonSecretHint(runtime.clientId):null,
        ...(provider==='microsoft'?{tenant:runtime?.tenant??null}:{}),
        ...(provider==='home_assistant'?{origin:runtime?.origin??null}:{}),
        scopes:provider==='google'?['openid','email','calendar.calendarlist.readonly','calendar.events.readonly']:provider==='microsoft'?['openid','email','offline_access','Calendars.ReadBasic']:['Home Assistant token scope (instance-defined)']
      };
    }
    return result;
  }

  async update(actor:ProviderConfigActor,provider:RegisteredCalendarProvider,input:{expectedRevision:number;status:'active'|'disabled';clientId?:string;clientSecret?:string;tenant?:string;origin?:string;googleOAuthJson?:unknown},publicOrigin:string){
    if(!actor.capabilities.includes('installation.manage'))throw new DomainError('FORBIDDEN',403);
    const legacyClientId=provider==='google'?process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_ID?.trim():provider==='microsoft'?process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID?.trim():undefined;
    const legacyClientIdHash=legacyClientId?sha(legacyClientId):null;
    let config:Record<string,string>|undefined,clientIdHash:string|null=null;
    if(input.status==='active'){
      if(provider==='google'){
        if(input.googleOAuthJson!==undefined){
          const root=input.googleOAuthJson;if(!root||typeof root!=='object'||Array.isArray(root)||!('web' in root)||!root.web||typeof root.web!=='object'||Array.isArray(root.web)||'installed' in root)throw new DomainError('VALIDATION_FAILED',400,{reason:'google_oauth_web_configuration_required'});
          const web=root.web as Record<string,unknown>,redirects=web.redirect_uris;
          if(typeof web.auth_uri!=='string'||!GOOGLE_AUTH_ENDPOINTS.has(web.auth_uri)||typeof web.token_uri!=='string'||!GOOGLE_TOKEN_ENDPOINTS.has(web.token_uri)||typeof web.client_id!=='string'||typeof web.client_secret!=='string'||!Array.isArray(redirects)||redirects.some((value)=>typeof value!=='string')||!redirects.includes(calendarCallbackUri(publicOrigin,'google')))throw new DomainError('VALIDATION_FAILED',400,{reason:'google_oauth_configuration_mismatch'});
          config={clientId:web.client_id.trim(),clientSecret:web.client_secret.trim()};
        }else config={clientId:input.clientId?.trim()??'',clientSecret:input.clientSecret?.trim()??''};
      }else if(provider==='microsoft')config={clientId:input.clientId?.trim()??'',clientSecret:input.clientSecret?.trim()??'',tenant:tenant(input.tenant)};
      else {const origin=normalizeHomeAssistantOrigin(input.origin??'');config={clientId:publicOrigin,origin};}
      if(!config.clientId||config.clientId.length>1000||(provider!=='home_assistant'&&(!config.clientSecret||config.clientSecret.length>4000)))throw new DomainError('VALIDATION_FAILED',400,{reason:'calendar_provider_configuration_invalid'});
      clientIdHash=sha(config.clientId);
    }
    const ciphertext=config?await this.vault.encrypt(aad(actor.installationId,provider),JSON.stringify(config)):null;
    await transaction(async(client)=>{
      await client.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[actor.installationId]);
      const authority=await client.query(`SELECT 1 FROM memberships membership JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL JOIN households household ON household.id=membership.household_id AND household.installation_id=$1 JOIN sessions session ON session.id=$5 AND session.account_id=membership.account_id AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp() WHERE membership.id=$2 AND membership.account_id=$3 AND membership.household_id=$4 AND person.age_group='adult' AND membership.capabilities ? 'installation.manage' FOR SHARE OF membership,person,account,household,session`,[actor.installationId,actor.membershipId,actor.accountId,actor.householdId,actor.sessionId]);
      if(!authority.rowCount)throw new DomainError('FORBIDDEN',403);
      const current=(await client.query<{revision:number;client_id_hash:string|null;status:string;config_ciphertext:string|null}>('SELECT revision,client_id_hash,status,config_ciphertext FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2 FOR UPDATE',[actor.installationId,provider])).rows[0];
      if((current?.revision??0)!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'calendar_provider'});
      const unknownLegacyCredentials=!current&&!legacyClientIdHash&&Boolean((await client.query(`SELECT 1 FROM calendar_connections connection JOIN households household ON household.id=connection.household_id WHERE household.installation_id=$1 AND connection.provider=$2 AND connection.disconnected_at IS NULL AND connection.credential_ciphertext IS NOT NULL LIMIT 1`,[actor.installationId,provider])).rowCount);
      const revision=(current?.revision??0)+1;
      await client.query(`INSERT INTO installation_calendar_provider_configs(installation_id,provider,status,config_ciphertext,client_id_hash,revision,updated_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(installation_id,provider) DO UPDATE SET status=EXCLUDED.status,config_ciphertext=EXCLUDED.config_ciphertext,client_id_hash=EXCLUDED.client_id_hash,revision=EXCLUDED.revision,updated_by_account_id=EXCLUDED.updated_by_account_id,updated_at=clock_timestamp()`,[actor.installationId,provider,input.status,ciphertext,clientIdHash,revision,actor.accountId]);
      await client.query(`UPDATE calendar_oauth_sessions oauth SET consumed_at=COALESCE(consumed_at,clock_timestamp()),completion_hash=NULL,authorization_code_ciphertext=NULL FROM calendar_connections connection JOIN households household ON household.id=connection.household_id WHERE oauth.connection_id=connection.id AND household.installation_id=$1 AND connection.provider=$2 AND oauth.consumed_at IS NULL`,[actor.installationId,provider]);
      // A locked database row is always authoritative, even if its encrypted
      // payload is damaged. Legacy environment values are consulted only when
      // no database row exists. This lets an administrator repair a corrupt
      // registration without accidentally retaining credentials issued to a
      // different OAuth client.
      const previousClientIdHash=current?current.client_id_hash:legacyClientIdHash;
      const clientChanged=unknownLegacyCredentials||previousClientIdHash!==null&&previousClientIdHash!==clientIdHash;
      let previousHomeAssistantOriginHash:string|null=null,homeAssistantOriginChanged=false;
      if(provider==='home_assistant'&&current?.status==='active'&&current.config_ciphertext){
        try{const previous=JSON.parse(await this.vault.decrypt(aad(actor.installationId,provider),current.config_ciphertext)) as Record<string,unknown>;previousHomeAssistantOriginHash=sha(normalizeHomeAssistantOrigin(String(previous.origin??'')));homeAssistantOriginChanged=Boolean(config&&previousHomeAssistantOriginHash!==sha(config.origin!));}catch{homeAssistantOriginChanged=true;}
      }
      // Keep the last verified HA origin on the connection before disabling
      // clears the encrypted provider configuration. Only bind rows that are
      // still using that exact active provider revision/client registration.
      if(provider==='home_assistant'&&previousHomeAssistantOriginHash&&current){
        await client.query(`UPDATE calendar_connections connection SET home_assistant_origin_hash=COALESCE(connection.home_assistant_origin_hash,$2) FROM households household WHERE household.id=connection.household_id AND household.installation_id=$1 AND connection.provider='home_assistant' AND connection.disconnected_at IS NULL AND connection.state IN ('connected','syncing','error') AND connection.credential_ciphertext IS NOT NULL AND connection.provider_config_revision=$3 AND connection.provider_client_id_hash=$4`,[actor.installationId,previousHomeAssistantOriginHash,current.revision,current.client_id_hash]);
      }
      await client.query(`UPDATE calendar_sync_attempts attempt SET outcome='superseded',error_code='CALENDAR_SYNC_SUPERSEDED',completed_at=clock_timestamp() FROM calendar_connections connection JOIN households household ON household.id=connection.household_id WHERE attempt.connection_id=connection.id AND household.installation_id=$1 AND connection.provider=$2 AND attempt.outcome='started'`,[actor.installationId,provider]);
      if(input.status==='disabled'||clientChanged||homeAssistantOriginChanged){
        await client.query(`UPDATE calendar_connections connection SET state='expired',credential_ciphertext=NULL,next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,credential_lease_token=NULL,credential_lease_expires_at=NULL,sync_generation=sync_generation+1,last_error_code='CALENDAR_REAUTHORIZATION_REQUIRED',provider_config_revision=$3,provider_client_id_hash=$4,replacement_required=CASE WHEN connection.provider='microsoft' AND $5 THEN true ELSE connection.replacement_required END,updated_at=clock_timestamp() FROM households household WHERE household.id=connection.household_id AND household.installation_id=$1 AND connection.provider=$2 AND connection.disconnected_at IS NULL`,[actor.installationId,provider,revision,clientIdHash,clientChanged]);
        await client.query(`UPDATE integration_items item SET metadata=jsonb_set(jsonb_set(item.metadata,'{calendar,freshness}','"stale"'::jsonb,true),'{calendar,freshnessReason}',to_jsonb($3::text),true),revision=item.revision+1,updated_at=clock_timestamp() FROM integration_connections integration,calendar_connections connection,households household WHERE item.connection_id=integration.id AND connection.integration_connection_id=integration.id AND household.id=connection.household_id AND household.installation_id=$1 AND connection.provider=$2 AND connection.disconnected_at IS NULL AND item.status='active' AND item.metadata ? 'calendar' AND (item.metadata #>> '{calendar,freshness}' IS DISTINCT FROM 'stale' OR item.metadata #>> '{calendar,freshnessReason}' IS DISTINCT FROM $3)`,[actor.installationId,provider,input.status==='disabled'?'provider_disabled':'reauthorization_required']);
        if(provider==='home_assistant'&&homeAssistantOriginChanged){
          await client.query(`UPDATE home_assistant_temperature_sensors sensor SET enabled=false,available=false,status='stale',last_successful_poll_at=NULL,last_validated_at=NULL,next_poll_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code='HOME_ASSISTANT_ORIGIN_CHANGED',revision=sensor.revision+1,updated_at=clock_timestamp() FROM calendar_connections connection,households household WHERE sensor.connection_id=connection.id AND household.id=connection.household_id AND household.installation_id=$1 AND connection.provider='home_assistant'`,[actor.installationId]);
          await client.query(`UPDATE integration_items item SET body='—',metadata=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item.metadata,'{temperature,value}','null'::jsonb,true),'{temperature,lastValidValue}','null'::jsonb,true),'{temperature,lastValidUnit}','null'::jsonb,true),'{temperature,lastValidAt}','null'::jsonb,true),'{temperature,status}','"unavailable"'::jsonb,true),'{temperature,freshness}','"stale"'::jsonb,true),'{temperature,reason}','"origin_changed"'::jsonb,true),source=jsonb_set(item.source,'{uncertainty}','"unknown"'::jsonb,true),revision=item.revision+1,updated_at=clock_timestamp() FROM home_assistant_temperature_sensors sensor,calendar_connections connection,households household WHERE sensor.connection_id=connection.id AND sensor.integration_item_id=item.id AND household.id=connection.household_id AND household.installation_id=$1 AND connection.provider='home_assistant' AND item.status='active' AND item.metadata ? 'temperature'`,[actor.installationId]);
        }else{
          await client.query(`UPDATE home_assistant_temperature_sensors sensor SET status=CASE WHEN sensor.enabled AND sensor.available THEN 'stale' ELSE sensor.status END,next_poll_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=CASE WHEN sensor.enabled AND sensor.available THEN 'CALENDAR_REAUTHORIZATION_REQUIRED' ELSE sensor.last_error_code END,revision=sensor.revision+1,updated_at=clock_timestamp() FROM calendar_connections connection,households household WHERE sensor.connection_id=connection.id AND household.id=connection.household_id AND household.installation_id=$1 AND connection.provider=$2`,[actor.installationId,provider]);
          await client.query(`UPDATE integration_items item SET metadata=jsonb_set(jsonb_set(item.metadata,'{temperature,freshness}','"stale"'::jsonb,true),'{temperature,reason}','"reauthorization_required"'::jsonb,true),revision=item.revision+1,updated_at=clock_timestamp() FROM home_assistant_temperature_sensors sensor,calendar_connections connection,households household WHERE sensor.connection_id=connection.id AND sensor.integration_item_id=item.id AND household.id=connection.household_id AND household.installation_id=$1 AND connection.provider='home_assistant' AND sensor.enabled AND sensor.available AND item.status='active' AND item.metadata ? 'temperature'`,[actor.installationId]);
        }
      }else{
        await client.query(`UPDATE calendar_connections connection SET provider_config_revision=$3,provider_client_id_hash=$4,sync_generation=sync_generation+1,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() FROM households household WHERE household.id=connection.household_id AND household.installation_id=$1 AND connection.provider=$2 AND connection.disconnected_at IS NULL`,[actor.installationId,provider,revision,clientIdHash]);
        await client.query(`UPDATE calendar_connections connection SET state='error',last_error_code='CALENDAR_RETRY_PENDING',next_sync_at=clock_timestamp(),updated_at=clock_timestamp() FROM households household, integration_connections authority WHERE household.id=connection.household_id AND authority.id=connection.integration_connection_id AND authority.revoked_at IS NULL AND household.installation_id=$1 AND connection.provider=$2 AND connection.disconnected_at IS NULL AND connection.credential_ciphertext IS NOT NULL AND connection.last_error_code='CALENDAR_CLIENT_CONFIGURATION_INVALID' AND EXISTS(SELECT 1 FROM calendar_sources source WHERE source.connection_id=connection.id AND source.enabled) AND EXISTS(SELECT 1 FROM memberships membership JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult' JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL WHERE membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id AND membership.capabilities ? 'household.view')`,[actor.installationId,provider]);
      }
      await this.audit(client,actor,'calendar.provider_configuration_updated',actor.installationId,{provider,status:input.status,revision,clientIdChanged:clientChanged});
    });
    return this.readiness(actor,publicOrigin);
  }

  private audit(client:DbClient,actor:ProviderConfigActor,action:string,subjectId:string,metadata:Record<string,unknown>){return client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,$4,'calendar_provider',$5,$6)`,[actor.installationId,actor.householdId,actor.accountId,action,subjectId,JSON.stringify(metadata)]);}
}
