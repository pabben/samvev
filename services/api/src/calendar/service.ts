import { createHash, randomUUID } from 'node:crypto';
import ical from 'node-ical';
import { DomainError, opaqueToken, tokenHash } from '@samvev/core';
import { AiCredentialVault } from '../ai/credential-vault.ts';
import { createOAuthAttempt } from '../ai/oauth-primitives.ts';
import { pool, transaction, type DbClient } from '../db.ts';
import { SecretSubscriptionFetcher } from '../monitor/source-fetcher.ts';

export type CalendarProvider='google'|'microsoft'|'ics';
export interface CalendarActor{accountId:string;sessionId:string;installationId:string;householdId:string;membershipId:string;capabilities:string[];}
export interface CalendarTokenSet{accessToken:string;refreshToken?:string;expiresAt:string;scopes:string[];providerSubject:string;accountLabel?:string;}
export interface CalendarInfo{externalId:string;name:string;}
export interface CalendarEvent{uid:string;instanceId:string;title:string;start:string;end:string|null;allDay:boolean;cancelled:boolean;location?:string;}
export interface CalendarPage<T>{items:T[];nextPageToken?:string;}
export interface CalendarTransport{
  exchangeCode(provider:Exclude<CalendarProvider,'ics'>,input:{code:string;verifier:string;redirectUri:string}):Promise<CalendarTokenSet>;
  refresh(provider:CalendarProvider,refreshToken:string):Promise<CalendarTokenSet>;
  revoke(provider:Exclude<CalendarProvider,'ics'>,token:string):Promise<'confirmed'|'local_only'>;
  listCalendars(provider:Exclude<CalendarProvider,'ics'>,accessToken:string,pageToken?:string):Promise<CalendarPage<CalendarInfo>>;
  listEvents(provider:CalendarProvider,accessToken:string,calendarId:string,window:{from:string;to:string},pageToken?:string):Promise<CalendarPage<CalendarEvent>>;
  fetchIcs(url:string):Promise<string>;
}

type ProviderConfig={clientId:string;clientSecret:string;authorizationEndpoint:string;tokenEndpoint:string;scopes:string[]};
function providerConfig(provider:Exclude<CalendarProvider,'ics'>):ProviderConfig{
  if(provider==='google'){
    const clientId=process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_ID?.trim(),clientSecret=process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET?.trim();if(!clientId||!clientSecret)throw new DomainError('CONFLICT',409,{reason:'google_calendar_registration_missing'});
    return{clientId,clientSecret,authorizationEndpoint:'https://accounts.google.com/o/oauth2/v2/auth',tokenEndpoint:'https://oauth2.googleapis.com/token',scopes:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly']};
  }
  const clientId=process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID?.trim(),clientSecret=process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET?.trim();if(!clientId||!clientSecret)throw new DomainError('CONFLICT',409,{reason:'microsoft_calendar_registration_missing'});
  const tenant=(process.env.SAMVEV_MICROSOFT_CALENDAR_TENANT??'common').trim();
  return{clientId,clientSecret,authorizationEndpoint:`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,tokenEndpoint:`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,scopes:['openid','email','offline_access','Calendars.ReadBasic']};
}
function callbackUri(publicOrigin:string,provider:Exclude<CalendarProvider,'ics'>):string{
  let origin:URL;try{origin=new URL(publicOrigin);}catch{throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_public_origin_invalid'});}
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.origin!==publicOrigin)throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_public_origin_invalid'});
  return `${origin.origin}/api/v1/calendar/oauth/${provider}/callback`;
}
async function jsonRequest(url:string,init:RequestInit):Promise<Record<string,any>>{const response=await fetch(url,{...init,signal:AbortSignal.timeout(15_000)});const text=await response.text();let body:unknown;try{body=JSON.parse(text);}catch{throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid',httpStatus:response.status});}if(!response.ok)throw new DomainError(response.status===401?'CONFLICT':'MONITOR_SOURCE_UNAVAILABLE',response.status===401?409:502,{reason:response.status===401?'calendar_reauthorization_required':'calendar_provider_unavailable',httpStatus:response.status});if(!body||typeof body!=='object'||Array.isArray(body))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});return body as Record<string,any>;}
export class DefaultCalendarTransport implements CalendarTransport{
  private readonly ics=new SecretSubscriptionFetcher();
  async exchangeCode(provider:Exclude<CalendarProvider,'ics'>,input:{code:string;verifier:string;redirectUri:string}):Promise<CalendarTokenSet>{
    const config=providerConfig(provider);const params=new URLSearchParams({client_id:config.clientId,grant_type:'authorization_code',code:input.code,redirect_uri:input.redirectUri,code_verifier:input.verifier,...(config.clientSecret?{client_secret:config.clientSecret}:{})});const data=await jsonRequest(config.tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});if(typeof data.access_token!=='string')throw new DomainError('CONFLICT',409,{reason:'calendar_identity_invalid'});const identity=await jsonRequest(provider==='google'?'https://openidconnect.googleapis.com/v1/userinfo':'https://graph.microsoft.com/oidc/userinfo',{headers:{authorization:`Bearer ${data.access_token}`}});const subject=String(identity.sub??'');if(!subject)throw new DomainError('CONFLICT',409,{reason:'calendar_identity_invalid'});return{accessToken:data.access_token,refreshToken:typeof data.refresh_token==='string'?data.refresh_token:undefined,expiresAt:new Date(Date.now()+Number(data.expires_in??3600)*1000).toISOString(),scopes:String(data.scope??config.scopes.join(' ')).split(/\s+/).filter(Boolean),providerSubject:subject,accountLabel:typeof identity.email==='string'?identity.email:undefined};
  }
  async refresh(provider:CalendarProvider,refreshToken:string):Promise<CalendarTokenSet>{if(provider==='ics')throw new DomainError('CONFLICT',409);const config=providerConfig(provider);const params=new URLSearchParams({client_id:config.clientId,grant_type:'refresh_token',refresh_token:refreshToken,scope:config.scopes.join(' '),...(config.clientSecret?{client_secret:config.clientSecret}:{})});const data=await jsonRequest(config.tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});if(typeof data.access_token!=='string')throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});return{accessToken:data.access_token,refreshToken:typeof data.refresh_token==='string'?data.refresh_token:refreshToken,expiresAt:new Date(Date.now()+Number(data.expires_in??3600)*1000).toISOString(),scopes:String(data.scope??config.scopes.join(' ')).split(/\s+/).filter(Boolean),providerSubject:'retained'};}
  async revoke(provider:Exclude<CalendarProvider,'ics'>,token:string):Promise<'confirmed'|'local_only'>{if(provider!=='google')return'local_only';const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(15_000)});if(!response.ok&&response.status!==400)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);return'confirmed';}
  async listCalendars(provider:Exclude<CalendarProvider,'ics'>,accessToken:string,pageToken?:string):Promise<CalendarPage<CalendarInfo>>{
    if(provider==='google'){const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');url.searchParams.set('maxResults','250');if(pageToken)url.searchParams.set('pageToken',pageToken);const data=await jsonRequest(url.toString(),{headers:{authorization:`Bearer ${accessToken}`}});if(!Array.isArray(data.items)||(data.nextPageToken!==undefined&&typeof data.nextPageToken!=='string'))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});return{items:data.items.map((item:any)=>{if(!item||typeof item.id!=='string')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});return{externalId:item.id,name:String(item.summaryOverride??item.summary??'Calendar')}}),nextPageToken:data.nextPageToken};}
    const url=pageToken??'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name&$top=100';const parsed=new URL(url);if(parsed.origin!=='https://graph.microsoft.com'||!parsed.pathname.startsWith('/v1.0/me/calendars'))throw new DomainError('AI_ENDPOINT_BLOCKED',422);const data=await jsonRequest(url,{headers:{authorization:`Bearer ${accessToken}`}});if(!Array.isArray(data.value)||(data['@odata.nextLink']!==undefined&&typeof data['@odata.nextLink']!=='string'))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});return{items:data.value.map((item:any)=>{if(!item||typeof item.id!=='string')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});return{externalId:item.id,name:String(item.name??'Calendar')}}),nextPageToken:data['@odata.nextLink']};
  }
  async listEvents(provider:CalendarProvider,accessToken:string,calendarId:string,window:{from:string;to:string},pageToken?:string):Promise<CalendarPage<CalendarEvent>>{
    if(provider==='ics')throw new DomainError('CONFLICT',409);
    if(provider==='google'){
      const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
      url.searchParams.set('timeMin',window.from);url.searchParams.set('timeMax',window.to);url.searchParams.set('singleEvents','true');url.searchParams.set('showDeleted','true');url.searchParams.set('maxResults','2500');if(pageToken)url.searchParams.set('pageToken',pageToken);
      const data=await jsonRequest(url.toString(),{headers:{authorization:`Bearer ${accessToken}`}});
      if(!Array.isArray(data.items)||(data.nextPageToken!==undefined&&typeof data.nextPageToken!=='string'))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});
      return{items:data.items.map((item:any)=>{
        const cancelled=item?.status==='cancelled',recurring=typeof item?.recurringEventId==='string';
        const identityStart=item?.originalStartTime??{},actualStart=item?.start??identityStart;
        const identityValue=identityStart.dateTime??identityStart.date;
        if(typeof item?.id!=='string'||(recurring&&typeof identityValue!=='string')||(!cancelled&&typeof actualStart.dateTime!=='string'&&typeof actualStart.date!=='string'))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});
        return{uid:String(recurring?item.recurringEventId:(item.iCalUID??item.id)),instanceId:recurring?String(identityValue):item.id,title:String(item.summary??'Untitled event'),start:String(actualStart.dateTime??actualStart.date??'1970-01-01T00:00:00.000Z'),end:item.end?String(item.end.dateTime??item.end.date??null):null,allDay:Boolean(actualStart.date&&!actualStart.dateTime),cancelled,location:typeof item.location==='string'?item.location:undefined};
      }),nextPageToken:data.nextPageToken};
    }
    const url=pageToken??`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?startDateTime=${encodeURIComponent(window.from)}&endDateTime=${encodeURIComponent(window.to)}&$select=id,subject,start,end,isAllDay,isCancelled,seriesMasterId,originalStart,location&$top=100`;const parsed=new URL(url);if(parsed.origin!=='https://graph.microsoft.com'||!/^\/v1\.0\/me\/calendars\/[^/]+\/calendarView$/.test(parsed.pathname))throw new DomainError('AI_ENDPOINT_BLOCKED',422);const data=await jsonRequest(url,{headers:{authorization:`Bearer ${accessToken}`,Prefer:'outlook.timezone="UTC"'}});if(!Array.isArray(data.value)||(data['@odata.nextLink']!==undefined&&typeof data['@odata.nextLink']!=='string'))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});const instant=(value:unknown)=>{const text=String(value??'');return /(?:Z|[+-]\d\d:\d\d)$/.test(text)?text:`${text}Z`;};return{items:data.value.map((item:any)=>{if(!item||typeof item.id!=='string'||(!item.isCancelled&&typeof item.start?.dateTime!=='string'))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});const recurring=typeof item.seriesMasterId==='string';return{uid:String(recurring?item.seriesMasterId:item.id),instanceId:recurring?String(item.originalStart??item.start.dateTime):'single',title:String(item.subject??'Untitled event'),start:instant(item.start?.dateTime),end:item.end?.dateTime?instant(item.end.dateTime):null,allDay:Boolean(item.isAllDay),cancelled:Boolean(item.isCancelled),location:typeof item.location?.displayName==='string'?item.location.displayName:undefined}}),nextPageToken:data['@odata.nextLink']};
  }
  fetchIcs(url:string){return this.ics.fetch(url);}
}

interface StoredCredential{accessToken?:string;refreshToken?:string;expiresAt?:string;providerSubject?:string;url?:string;}
interface ConnectionRow{id:string;household_id:string;integration_connection_id:string;owner_account_id:string;provider:CalendarProvider;bridge_kind:string;name:string;state:string;credential_ciphertext:string|null;revision:number;sync_generation:number;lease_token:string|null;}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const calendarAad=(householdId:string,connectionId:string,accountId:string)=>`${householdId}:calendar:${connectionId}:account:${accountId}`;
const windowFor=(now=new Date())=>({from:new Date(now.getTime()-7*86400_000).toISOString(),to:new Date(now.getTime()+180*86400_000).toISOString()});
function ensureManager(actor:CalendarActor){if(!actor.capabilities.includes('household.manage'))throw new DomainError('FORBIDDEN',403);}
function canonicalEvent(event:CalendarEvent){let start:string,end:string|null;try{start=/^\d{4}-\d{2}-\d{2}$/.test(event.start)?`${event.start}T00:00:00.000Z`:new Date(event.start).toISOString();end=event.end?(/^\d{4}-\d{2}-\d{2}$/.test(event.end)?`${event.end}T00:00:00.000Z`:new Date(event.end).toISOString()):null;}catch{throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_event_time_invalid'});}if(end&&end<start)throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_event_time_invalid'});return{...event,start,end,title:event.title.normalize('NFKC').trim().slice(0,160)||'Untitled event',location:event.location?.normalize('NFKC').trim().slice(0,160)};}
export function parseIcsEvents(text:string,window:{from:string;to:string}):CalendarEvent[]{
  const parsed=ical.sync.parseICS(text),from=new Date(window.from),to=new Date(window.to),events:CalendarEvent[]=[];
  const stamp=(value:Date)=>value.toISOString();
  for(const item of Object.values(parsed)){
    if(item.type!=='VEVENT')continue;
    const event=item as ical.VEvent;
    if(event.rrule&&event.start){
      const overrides=new Map<string,ical.VEvent>();
      for(const [key,override] of Object.entries(event.recurrences??{})){
        const original=override.recurrenceid instanceof Date?stamp(override.recurrenceid):key;
        overrides.set(original,override);
      }
      const excluded=new Set<string>();
      for(const [key,date] of Object.entries(event.exdate??{}))excluded.add(date instanceof Date?stamp(date):key);
      const baseDuration=Math.max(0,(event.end?.getTime()??event.start.getTime())-event.start.getTime());
      for(const original of event.rrule.between(from,to,true)){
        const identity=stamp(original),override=overrides.get(identity);
        if(excluded.has(identity)&&!override)continue;
        const start=override?.start??original;
        const duration=override?.start&&override.end?Math.max(0,override.end.getTime()-override.start.getTime()):baseDuration;
        events.push({uid:String(event.uid),instanceId:identity,title:String(override?.summary??event.summary??'Untitled event'),start:stamp(start),end:duration?stamp(new Date(start.getTime()+duration)):null,allDay:(override?.datetype??event.datetype)==='date',cancelled:String(override?.status??event.status??'').toUpperCase()==='CANCELLED',location:String(override?.location??event.location??'')||undefined});
      }
    }else if(event.start&&event.start<to&&(event.end??event.start)>=from){
      events.push({uid:String(event.uid),instanceId:event.recurrenceid?.toISOString()??event.start.toISOString(),title:String(event.summary??'Untitled event'),start:event.start.toISOString(),end:event.end?.toISOString()??null,allDay:event.datetype==='date',cancelled:String(event.status??'').toUpperCase()==='CANCELLED',location:String(event.location??'')||undefined});
    }
  }
  return events.map(canonicalEvent);
}

export class CalendarService{
  constructor(private readonly transport:CalendarTransport=new DefaultCalendarTransport(),private readonly vault=new AiCredentialVault()){}
  readiness(publicOrigin:string){
    const googleRequired=['SAMVEV_GOOGLE_CALENDAR_CLIENT_ID','SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET'];
    const microsoftRequired=['SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID','SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET'];
    return{
      google:{configured:googleRequired.every((name)=>Boolean(process.env[name]?.trim())),redirectUri:callbackUri(publicOrigin,'google'),requiredEnvironment:googleRequired},
      microsoft:{configured:microsoftRequired.every((name)=>Boolean(process.env[name]?.trim())),redirectUri:callbackUri(publicOrigin,'microsoft'),requiredEnvironment:microsoftRequired},
      ics:{configured:true,redirectUri:null,requiredEnvironment:[]}
    };
  }
  async create(actor:CalendarActor,input:{provider:CalendarProvider;name:string;bridgeKind:'direct'|'spond_calendar';icsUrl?:string}){
    ensureManager(actor);
    return transaction(async(client)=>{
      const integration=(await client.query<{id:string}>('INSERT INTO integration_connections(household_id,name) VALUES($1,$2) RETURNING id',[actor.householdId,input.name])).rows[0]!;
      const state=input.provider==='ics'?'connected':'setup';
      const connection=(await client.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,bridge_kind,name,state) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[actor.householdId,integration.id,actor.accountId,input.provider,input.bridgeKind,input.name,state])).rows[0]!;
      if(input.provider==='ics'){
        const cipher=await this.vault.encrypt(calendarAad(actor.householdId,connection.id,actor.accountId),JSON.stringify({url:input.icsUrl}));
        await client.query('UPDATE calendar_connections SET credential_ciphertext=$2 WHERE id=$1',[connection.id,cipher]);
        await client.query(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name) VALUES($1,$2,'ics-primary',$3)`,[actor.householdId,connection.id,input.name]);
      }
      await this.audit(client,actor,'calendar.connection_created',connection.id,{provider:input.provider,bridgeKind:input.bridgeKind});
      return this.get(actor,connection.id,client);
    });
  }
  async startOAuth(actor:CalendarActor,id:string,publicOrigin:string){
    ensureManager(actor);const row=await this.row(actor,id);if(row.provider==='ics')throw new DomainError('CONFLICT',409);
    const config=providerConfig(row.provider),attempt=createOAuthAttempt(),redirectUri=callbackUri(publicOrigin,row.provider);
    const verifier=await this.vault.encrypt(calendarAad(actor.householdId,id,actor.accountId),attempt.verifier);
    await transaction(async(client)=>{
      const changed=await client.query(`UPDATE calendar_connections SET state='awaiting_consent',last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND owner_account_id=$3 AND disconnected_at IS NULL`,[id,actor.householdId,actor.accountId]);if(!changed.rowCount)throw new DomainError('NOT_FOUND',404);
      await client.query('UPDATE calendar_oauth_sessions SET consumed_at=clock_timestamp() WHERE connection_id=$1 AND consumed_at IS NULL',[id]);
      await client.query(`INSERT INTO calendar_oauth_sessions(connection_id,owner_account_id,initiating_session_id,state_hash,verifier_ciphertext,redirect_uri,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '10 minutes')`,[id,actor.accountId,actor.sessionId,tokenHash(attempt.state),verifier,redirectUri]);
    });
    const url=new URL(config.authorizationEndpoint);for(const [key,value] of Object.entries({client_id:config.clientId,response_type:'code',redirect_uri:redirectUri,scope:config.scopes.join(' '),state:attempt.state,code_challenge:attempt.challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'}))url.searchParams.set(key,value);return{authorizationUrl:url.toString(),connectionId:id};
  }
  async stageOAuthCallback(provider:Exclude<CalendarProvider,'ics'>,state:string,code?:string,error?:string){
    const completionToken=opaqueToken(),stateHash=tokenHash(state);
    return transaction(async(client)=>{
      const found=(await client.query<{id:string;connection_id:string;owner_account_id:string;household_id:string}>(`SELECT s.id,s.connection_id,s.owner_account_id,c.household_id FROM calendar_oauth_sessions s JOIN calendar_connections c ON c.id=s.connection_id WHERE s.state_hash=$1 AND s.consumed_at IS NULL AND s.expires_at>clock_timestamp() AND c.provider=$2 AND c.state='awaiting_consent' AND c.disconnected_at IS NULL FOR UPDATE OF s,c`,[stateHash,provider])).rows[0];
      if(!found)throw new DomainError('CONFLICT',409,{reason:'calendar_oauth_state_invalid'});
      if(error||!code){
        await client.query('UPDATE calendar_oauth_sessions SET consumed_at=clock_timestamp(),callback_received_at=clock_timestamp() WHERE id=$1',[found.id]);
        await client.query(`UPDATE calendar_connections SET state='setup',last_error_code='CALENDAR_CONSENT_DENIED',updated_at=clock_timestamp() WHERE id=$1 AND state='awaiting_consent'`,[found.connection_id]);
        return{denied:true as const};
      }
      const cipher=await this.vault.encrypt(calendarAad(found.household_id,found.connection_id,found.owner_account_id),code);
      await client.query('UPDATE calendar_oauth_sessions SET consumed_at=clock_timestamp(),callback_received_at=clock_timestamp(),completion_hash=$2,authorization_code_ciphertext=$3 WHERE id=$1',[found.id,tokenHash(completionToken),cipher]);
      return{denied:false as const,completionToken};
    });
  }
  async completeOAuth(actor:CalendarActor,provider:Exclude<CalendarProvider,'ics'>,completionToken:string){
    ensureManager(actor);
    const session=await transaction(async(client)=>{
      const found=(await client.query<{id:string;connection_id:string;owner_account_id:string;verifier_ciphertext:string;authorization_code_ciphertext:string;redirect_uri:string;household_id:string;provider:CalendarProvider}>(`
        SELECT s.id,s.connection_id,s.owner_account_id,s.verifier_ciphertext,s.authorization_code_ciphertext,s.redirect_uri,c.household_id,c.provider
        FROM calendar_oauth_sessions s JOIN calendar_connections c ON c.id=s.connection_id
        JOIN memberships membership ON membership.account_id=s.owner_account_id AND membership.household_id=c.household_id
        JOIN accounts account ON account.id=s.owner_account_id AND account.disabled_at IS NULL
        JOIN sessions initiating ON initiating.id=s.initiating_session_id AND initiating.account_id=s.owner_account_id AND initiating.revoked_at IS NULL AND initiating.expires_at>clock_timestamp()
        WHERE s.completion_hash=$1 AND s.authorization_code_ciphertext IS NOT NULL AND s.expires_at>clock_timestamp()
          AND s.owner_account_id=$2 AND s.initiating_session_id=$3 AND c.household_id=$4 AND c.provider=$5 AND c.owner_account_id=s.owner_account_id AND c.state='awaiting_consent' AND c.disconnected_at IS NULL
          AND membership.capabilities ? 'household.manage'
        FOR UPDATE OF s,c,membership,account,initiating`,[tokenHash(completionToken),actor.accountId,actor.sessionId,actor.householdId,provider])).rows[0];
      if(!found)throw new DomainError('CONFLICT',409,{reason:'calendar_oauth_state_invalid'});
      await client.query('UPDATE calendar_oauth_sessions SET completion_hash=NULL,authorization_code_ciphertext=NULL WHERE id=$1',[found.id]);
      return found;
    });
    const aad=calendarAad(session.household_id,session.connection_id,session.owner_account_id);
    const [verifier,code]=await Promise.all([this.vault.decrypt(aad,session.verifier_ciphertext),this.vault.decrypt(aad,session.authorization_code_ciphertext)]);
    let tokens:CalendarTokenSet,pages:{items:CalendarInfo[];pageCount:number};
    try{
      tokens=await this.transport.exchangeCode(provider,{code,verifier,redirectUri:session.redirect_uri});
      const required=providerConfig(provider).scopes.filter((scope)=>scope.includes('calendar')||scope==='Calendars.ReadBasic');
      if(required.some((scope)=>!tokens.scopes.includes(scope)))throw new DomainError('FORBIDDEN',403,{reason:'calendar_scopes_missing'});
      pages=await this.allPages((page)=>this.transport.listCalendars(provider,tokens.accessToken,page));
    }catch(error){await pool.query(`UPDATE calendar_connections SET state='error',last_error_code='CALENDAR_OAUTH_FAILED',updated_at=clock_timestamp() WHERE id=$1 AND state='awaiting_consent' AND disconnected_at IS NULL`,[session.connection_id]);throw error;}
    const credential=await this.vault.encrypt(aad,JSON.stringify(tokens));
    await transaction(async(client)=>{
      const authorized=await client.query(`SELECT 1 FROM calendar_connections c JOIN memberships m ON m.account_id=c.owner_account_id AND m.household_id=c.household_id JOIN accounts a ON a.id=c.owner_account_id AND a.disabled_at IS NULL WHERE c.id=$1 AND c.household_id=$2 AND c.owner_account_id=$3 AND c.provider=$4 AND c.state='awaiting_consent' AND c.disconnected_at IS NULL AND m.capabilities ? 'household.manage' FOR UPDATE OF c,m,a`,[session.connection_id,session.household_id,session.owner_account_id,provider]);
      if(!authorized.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_oauth_superseded'});
      const duplicate=await client.query<{id:string}>('SELECT id FROM calendar_connections WHERE household_id=$1 AND provider=$2 AND provider_subject_hash=$3 AND id<>$4 AND disconnected_at IS NULL FOR SHARE',[session.household_id,provider,sha(`${provider}\n${tokens.providerSubject}`),session.connection_id]);
      if(duplicate.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_account_already_connected',existingConnectionId:(duplicate.rows[0] as {id?:string}).id});
      await client.query(`UPDATE calendar_connections SET state='connected',credential_ciphertext=$3,provider_subject_hash=$4,account_label=$5,granted_scopes=$6,access_expires_at=$7,revision=revision+1,last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2`,[session.connection_id,session.household_id,credential,sha(`${provider}\n${tokens.providerSubject}`),tokens.accountLabel??null,tokens.scopes,tokens.expiresAt]);
      for(const calendar of pages.items)await client.query(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(connection_id,external_id) DO UPDATE SET name=EXCLUDED.name,updated_at=clock_timestamp()`,[session.household_id,session.connection_id,calendar.externalId,calendar.name]);
    });
    return{connectionId:session.connection_id,completed:true};
  }
  async updateSource(actor:CalendarActor,connectionId:string,sourceId:string,input:{expectedRevision:number;enabled:boolean;bridgeKind:'direct'|'spond_calendar';appliesTo:{household:boolean;personIds:string[]};visibility:{household:boolean;personIds:string[];displayIds:string[]}}){
    ensureManager(actor);
    await transaction(async(client)=>{
      const source=await client.query(`SELECT s.id FROM calendar_sources s JOIN calendar_connections c ON c.id=s.connection_id WHERE s.id=$1 AND s.connection_id=$2 AND s.household_id=$3 AND c.disconnected_at IS NULL FOR UPDATE OF s,c`,[sourceId,connectionId,actor.householdId]);
      if(!source.rowCount)throw new DomainError('NOT_FOUND',404);
      const people=[...new Set([...input.appliesTo.personIds,...input.visibility.personIds])];
      if(people.length&&(await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[actor.householdId,people])).rowCount!==people.length)throw new DomainError('NOT_FOUND',404);
      if(input.visibility.displayIds.length&&(await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL',[actor.householdId,input.visibility.displayIds])).rowCount!==input.visibility.displayIds.length)throw new DomainError('NOT_FOUND',404);
      if(input.bridgeKind==='spond_calendar'&&(await client.query(`SELECT 1 FROM calendar_connections WHERE id=$1 AND provider IN ('google','microsoft')`,[connectionId])).rowCount!==1)throw new DomainError('VALIDATION_FAILED',400,{reason:'spond_bridge_requires_google_or_microsoft'});
      const changed=await client.query('UPDATE calendar_sources SET enabled=$3,bridge_kind=$4,subject_household=$5,target_household=$6,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$7 RETURNING id',[sourceId,actor.householdId,input.enabled,input.bridgeKind,input.appliesTo.household,input.visibility.household,input.expectedRevision]);
      if(!changed.rowCount)throw new DomainError('REVISION_CONFLICT',409);
      await client.query('DELETE FROM calendar_source_person_subjects WHERE source_id=$1',[sourceId]);
      for(const personId of input.appliesTo.personIds)await client.query('INSERT INTO calendar_source_person_subjects(household_id,source_id,person_id) VALUES($1,$2,$3)',[actor.householdId,sourceId,personId]);
      await client.query('DELETE FROM calendar_source_person_readers WHERE source_id=$1',[sourceId]);
      for(const personId of input.visibility.personIds)await client.query('INSERT INTO calendar_source_person_readers(household_id,source_id,person_id) VALUES($1,$2,$3)',[actor.householdId,sourceId,personId]);
      await client.query('DELETE FROM calendar_source_display_targets WHERE source_id=$1',[sourceId]);
      for(const displayId of input.visibility.displayIds){
        await client.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[actor.householdId,sourceId,displayId]);
        await client.query(`INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) SELECT $1,integration_connection_id,$3 FROM calendar_connections WHERE id=$2 ON CONFLICT DO NOTHING`,[actor.householdId,connectionId,displayId]);
      }
      const activeItems=await client.query<{occurrence_id:string;item_id:string}>(`SELECT occurrence.id occurrence_id,item.id item_id FROM calendar_occurrences occurrence JOIN integration_items item ON item.id=occurrence.integration_item_id WHERE occurrence.source_id=$1 AND occurrence.status='active' FOR UPDATE OF occurrence,item`,[sourceId]);
      for(const item of activeItems.rows){
        if(!input.enabled){await this.withdrawOccurrence(client,{id:item.occurrence_id,integration_item_id:item.item_id});continue;}
        await client.query('UPDATE integration_items SET target_household=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[item.item_id,input.visibility.household]);
        await client.query('DELETE FROM integration_item_person_subjects WHERE item_id=$1',[item.item_id]);for(const personId of input.appliesTo.personIds)await client.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[actor.householdId,item.item_id,personId]);
        await client.query('DELETE FROM integration_item_person_targets WHERE item_id=$1',[item.item_id]);for(const personId of input.visibility.personIds)await client.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[actor.householdId,item.item_id,personId]);
        await client.query('DELETE FROM integration_item_display_targets WHERE item_id=$1',[item.item_id]);for(const displayId of input.visibility.displayIds)await client.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[actor.householdId,item.item_id,displayId]);
      }
      await client.query(`DELETE FROM integration_connection_display_grants grant_row USING calendar_connections connection WHERE connection.id=$1 AND grant_row.connection_id=connection.integration_connection_id AND NOT EXISTS(SELECT 1 FROM calendar_sources source JOIN calendar_source_display_targets target ON target.source_id=source.id WHERE source.connection_id=$1 AND target.display_id=grant_row.display_id)`,[connectionId]);
      await client.query(`UPDATE calendar_connections SET next_sync_at=CASE WHEN EXISTS(SELECT 1 FROM calendar_sources WHERE connection_id=$1 AND enabled) THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1`,[connectionId]);
      await this.audit(client,actor,'calendar.source_updated',sourceId,{enabled:input.enabled,bridgeKind:input.bridgeKind,subjectCount:input.appliesTo.personIds.length,readerCount:input.visibility.personIds.length,displayCount:input.visibility.displayIds.length});
    });
    return this.get(actor,connectionId);
  }
  async preview(actor:CalendarActor,connectionId:string,sourceId:string,expectedSourceRevision:number){
    ensureManager(actor);
    const source=(await pool.query<{external_id:string;revision:number}>(`SELECT source.external_id,source.revision FROM calendar_sources source JOIN calendar_connections connection ON connection.id=source.connection_id WHERE source.id=$1 AND source.connection_id=$2 AND source.household_id=$3 AND connection.disconnected_at IS NULL`,[sourceId,connectionId,actor.householdId])).rows[0];
    if(!source)throw new DomainError('NOT_FOUND',404);
    if(source.revision!==expectedSourceRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'calendar_source'});
    const row=await this.row(actor,connectionId),window=windowFor();
    let events:CalendarEvent[],pageCount=0;
    const aad=calendarAad(row.household_id,row.id,row.owner_account_id);
    if(row.provider==='ics'){
      const credential=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;
      if(!credential.url)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
      events=parseIcsEvents(await this.transport.fetchIcs(credential.url),window);pageCount=1;
    }else{
      let credential=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;
      if(!credential.accessToken||!credential.expiresAt)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
      if(new Date(credential.expiresAt).getTime()<Date.now()+60_000){
        if(!credential.refreshToken)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
        const refreshed=await this.transport.refresh(row.provider,credential.refreshToken);
        credential={...credential,...refreshed,providerSubject:credential.providerSubject};
        const changed=await pool.query(`UPDATE calendar_connections SET credential_ciphertext=$3,access_expires_at=$4,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND disconnected_at IS NULL`,[row.id,row.household_id,await this.vault.encrypt(aad,JSON.stringify(credential)),refreshed.expiresAt]);
        if(!changed.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_superseded'});
      }
      const pages=await this.allPages((token)=>this.transport.listEvents(row.provider,credential.accessToken!,source.external_id,window,token));
      events=pages.items.map(canonicalEvent);pageCount=pages.pageCount;
    }
    return{sourceId,sourceRevision:source.revision,window,pageCount,totalCount:events.filter((event)=>!event.cancelled).length,events:events.filter((event)=>!event.cancelled).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,25).map((event)=>({title:event.title,start:event.start,end:event.end,allDay:event.allDay,location:event.location??null}))};
  }
  async disconnect(actor:CalendarActor,id:string,expectedRevision:number){
    ensureManager(actor);
    const disconnected=await transaction(async(client)=>{
      const current=(await client.query<ConnectionRow>(`SELECT * FROM calendar_connections WHERE id=$1 AND household_id=$2 AND disconnected_at IS NULL FOR UPDATE`,[id,actor.householdId])).rows[0];
      if(!current)throw new DomainError('NOT_FOUND',404);if(current.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);
      await client.query(`UPDATE calendar_connections SET state='disconnected',credential_ciphertext=NULL,revision=revision+1,next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,disconnected_at=clock_timestamp(),last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1`,[id]);
      await this.withdrawAll(client,id);
      await client.query('UPDATE integration_connections SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[current.integration_connection_id]);
      await this.audit(client,actor,'calendar.connection_disconnected',id,{remoteRevocation:'pending'});
      return{...current,credentialCiphertext:current.credential_ciphertext};
    });
    let remote:'confirmed'|'local_only'|'failed'=disconnected.provider==='ics'?'local_only':'failed';
    if(disconnected.provider!=='ics'&&disconnected.credentialCiphertext){
      try{const secret=JSON.parse(await this.vault.decrypt(calendarAad(actor.householdId,id,disconnected.owner_account_id),disconnected.credentialCiphertext)) as StoredCredential;const token=secret.refreshToken??secret.accessToken;if(token)remote=await this.transport.revoke(disconnected.provider,token);else remote='local_only';}catch{remote='failed';}
    }
    const errorCode=remote==='confirmed'||disconnected.provider==='ics'?null:'CALENDAR_REMOTE_REVOCATION_UNCONFIRMED';
    await pool.query('UPDATE calendar_connections SET last_error_code=$2 WHERE id=$1 AND state=\'disconnected\'',[id,errorCode]);
    await pool.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,'calendar.remote_revocation','calendar_connection',$4,$5)`,[actor.installationId,actor.householdId,actor.accountId,id,JSON.stringify({status:remote})]);
    return this.get(actor,id);
  }
  async fenceIntegrationRevocation(client:DbClient,integrationConnectionId:string):Promise<boolean>{
    const calendar=(await client.query<{id:string;provider:CalendarProvider}>(`SELECT id,provider FROM calendar_connections WHERE integration_connection_id=$1 AND disconnected_at IS NULL FOR UPDATE`,[integrationConnectionId])).rows[0];
    if(!calendar)return false;
    await client.query(`UPDATE calendar_connections SET state='disconnected',credential_ciphertext=NULL,revision=revision+1,sync_generation=sync_generation+1,next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,disconnected_at=clock_timestamp(),last_error_code=CASE WHEN provider='ics' THEN NULL ELSE 'CALENDAR_REMOTE_REVOCATION_UNCONFIRMED' END,updated_at=clock_timestamp() WHERE id=$1`,[calendar.id]);
    await client.query(`UPDATE calendar_oauth_sessions SET consumed_at=COALESCE(consumed_at,clock_timestamp()),completion_hash=NULL,authorization_code_ciphertext=NULL WHERE connection_id=$1`,[calendar.id]);
    await this.withdrawAll(client,calendar.id);
    return true;
  }
  async sync(actor:CalendarActor,id:string,expectedRevision?:number){
    ensureManager(actor);const row=await this.row(actor,id);if(expectedRevision!==undefined&&row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);return this.syncConnection(row);
  }
  async syncConnection(rowOrId:ConnectionRow|string){
    const requested=typeof rowOrId==='string'?(await pool.query<ConnectionRow>('SELECT * FROM calendar_connections WHERE id=$1',[rowOrId])).rows[0]:rowOrId;if(!requested)throw new DomainError('NOT_FOUND',404);
    const lease=randomUUID();
    const claimed=await pool.query<ConnectionRow>(`UPDATE calendar_connections connection SET state='syncing',lease_token=$2,lease_expires_at=clock_timestamp()+interval '5 minutes',last_sync_started_at=clock_timestamp(),last_error_code=NULL
      WHERE connection.id=$1 AND connection.disconnected_at IS NULL AND connection.state IN ('connected','error','syncing') AND (connection.lease_expires_at IS NULL OR connection.lease_expires_at<clock_timestamp())
        AND EXISTS(SELECT 1 FROM memberships membership JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL WHERE membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id AND membership.capabilities ? 'household.manage')
        AND EXISTS(SELECT 1 FROM integration_connections authority WHERE authority.id=connection.integration_connection_id AND authority.household_id=connection.household_id AND authority.revoked_at IS NULL)
      RETURNING connection.*`,[requested.id,lease]);
    const row=claimed.rows[0];if(!row)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_unavailable'});
    const generation=Number(row.sync_generation)+1;
    const attempt=(await pool.query<{id:string}>('INSERT INTO calendar_sync_attempts(connection_id,generation,outcome) VALUES($1,$2,\'started\') RETURNING id',[row.id,generation])).rows[0]!;
    let pageCount=0,eventCount=0;
    try{
      const sources=(await pool.query<{id:string;external_id:string}>(`SELECT id,external_id FROM calendar_sources WHERE connection_id=$1 AND enabled ORDER BY id`,[row.id])).rows;
      const eventMap=new Map<string,CalendarEvent[]>(),aad=calendarAad(row.household_id,row.id,row.owner_account_id);
      if(row.provider==='ics'){
        const secret=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;if(!secret.url)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
        const text=await this.transport.fetchIcs(secret.url);if(sources[0])eventMap.set(sources[0].id,parseIcsEvents(text,windowFor()));pageCount=1;
      }else{
        let secret=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;
        if(!secret.accessToken||!secret.expiresAt)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
        if(new Date(secret.expiresAt).getTime()<Date.now()+60_000){
          if(!secret.refreshToken)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
          const refreshed=await this.transport.refresh(row.provider,secret.refreshToken);secret={...secret,...refreshed,providerSubject:secret.providerSubject};
          const persisted=await pool.query('UPDATE calendar_connections SET credential_ciphertext=$2,access_expires_at=$3 WHERE id=$1 AND lease_token=$4 AND disconnected_at IS NULL RETURNING id',[row.id,await this.vault.encrypt(aad,JSON.stringify(secret)),refreshed.expiresAt,lease]);
          if(!persisted.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_superseded'});
        }
        for(const source of sources){const pages=await this.allPages((token)=>this.transport.listEvents(row.provider,secret.accessToken!,source.external_id,windowFor(),token));eventMap.set(source.id,pages.items.map(canonicalEvent));pageCount+=pages.pageCount;}
      }
      for(const values of eventMap.values())eventCount+=values.length;
      await transaction(async(client)=>{
        const locked=await client.query(`SELECT 1 FROM calendar_connections connection JOIN memberships membership ON membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id JOIN accounts account ON account.id=connection.owner_account_id AND account.disabled_at IS NULL JOIN integration_connections authority ON authority.id=connection.integration_connection_id AND authority.household_id=connection.household_id AND authority.revoked_at IS NULL WHERE connection.id=$1 AND connection.lease_token=$2 AND connection.lease_expires_at>clock_timestamp() AND connection.disconnected_at IS NULL AND membership.capabilities ? 'household.manage' FOR UPDATE OF connection,membership,account,authority`,[row.id,lease]);
        if(!locked.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_superseded'});
        for(const [sourceId,events] of eventMap)await this.reconcileSource(client,row,sourceId,events,generation);
        await client.query(`UPDATE calendar_connections SET state='connected',sync_generation=$3,last_sync_succeeded_at=clock_timestamp(),next_sync_at=CASE WHEN EXISTS(SELECT 1 FROM calendar_sources WHERE connection_id=$1 AND enabled) THEN clock_timestamp()+interval '15 minutes' ELSE NULL END,last_error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2`,[row.id,lease,generation]);
        await client.query(`UPDATE calendar_sync_attempts SET outcome='succeeded',page_count=$2,event_count=$3,completed_at=clock_timestamp() WHERE id=$1`,[attempt.id,pageCount,eventCount]);
      });
      return{generation,pageCount,eventCount};
    }catch(error){
      const code=error instanceof DomainError&&error.details?.reason==='calendar_reauthorization_required'?'CALENDAR_REAUTHORIZATION_REQUIRED':'CALENDAR_SYNC_FAILED';
      await pool.query(`UPDATE calendar_connections SET state=CASE WHEN $3='CALENDAR_REAUTHORIZATION_REQUIRED' THEN 'expired' ELSE 'error' END,last_error_code=$3,next_sync_at=CASE WHEN $3='CALENDAR_REAUTHORIZATION_REQUIRED' THEN NULL ELSE clock_timestamp()+interval '15 minutes' END,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2`,[row.id,lease,code]);
      await pool.query(`UPDATE calendar_sync_attempts SET outcome='failed',page_count=$2,event_count=$3,error_code=$4,completed_at=clock_timestamp() WHERE id=$1`,[attempt.id,pageCount,eventCount,code]);throw error;
    }
  }
  async get(actor:CalendarActor,id:string,client:DbClient=pool){ensureManager(actor);const row=(await client.query<any>(`SELECT id,provider,bridge_kind,name,state,account_label,granted_scopes,revision,last_sync_started_at,last_sync_succeeded_at,next_sync_at,last_error_code,disconnected_at FROM calendar_connections WHERE id=$1 AND household_id=$2`,[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);const sources=await client.query<any>(`SELECT s.id,s.external_id,s.name,s.enabled,s.bridge_kind,s.subject_household,s.target_household,s.revision,COALESCE((SELECT json_agg(person_id ORDER BY person_id) FROM calendar_source_person_subjects WHERE source_id=s.id),'[]') subject_person_ids,COALESCE((SELECT json_agg(person_id ORDER BY person_id) FROM calendar_source_person_readers WHERE source_id=s.id),'[]') reader_person_ids,COALESCE((SELECT json_agg(display_id ORDER BY display_id) FROM calendar_source_display_targets WHERE source_id=s.id),'[]') display_ids FROM calendar_sources s WHERE s.connection_id=$1 ORDER BY s.name,s.id`,[id]);return{id:row.id,provider:row.provider,bridgeKind:row.bridge_kind,name:row.name,state:row.state,accountLabel:row.account_label,grantedScopes:row.granted_scopes,revision:row.revision,lastSyncStartedAt:row.last_sync_started_at?.toISOString()??null,lastSyncSucceededAt:row.last_sync_succeeded_at?.toISOString()??null,nextSyncAt:row.next_sync_at?.toISOString()??null,errorCode:row.last_error_code,disconnectedAt:row.disconnected_at?.toISOString()??null,sources:sources.rows.map((source:any)=>({id:source.id,externalId:source.external_id,name:source.name,enabled:source.enabled,bridgeKind:source.bridge_kind,appliesTo:{household:source.subject_household,personIds:source.subject_person_ids},visibility:{household:source.target_household,personIds:source.reader_person_ids,displayIds:source.display_ids},revision:source.revision}))};}
  async list(actor:CalendarActor){ensureManager(actor);const ids=await pool.query<{id:string}>('SELECT id FROM calendar_connections WHERE household_id=$1 ORDER BY created_at,id',[actor.householdId]);return Promise.all(ids.rows.map((row)=>this.get(actor,row.id)));}
  private async row(actor:CalendarActor,id:string){const row=(await pool.query<ConnectionRow>('SELECT * FROM calendar_connections WHERE id=$1 AND household_id=$2',[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);return row;}
  private async allPages<T>(fn:(token?:string)=>Promise<CalendarPage<T>>):Promise<{items:T[];pageCount:number}>{const items:T[]=[];let token:string|undefined,pageCount=0;const seen=new Set<string>();do{const page=await fn(token);pageCount++;items.push(...page.items);if(pageCount>100)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);token=page.nextPageToken;if(token){if(seen.has(token))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);seen.add(token);}}while(token);return{items,pageCount};}
  private async reconcileSource(client:DbClient,connection:ConnectionRow,sourceId:string,events:CalendarEvent[],generation:number){const source=(await client.query<any>(`SELECT s.*,COALESCE((SELECT array_agg(person_id ORDER BY person_id) FROM calendar_source_person_subjects WHERE source_id=s.id),'{}'::uuid[]) subject_person_ids,COALESCE((SELECT array_agg(person_id ORDER BY person_id) FROM calendar_source_person_readers WHERE source_id=s.id),'{}'::uuid[]) reader_person_ids,COALESCE((SELECT array_agg(display_id ORDER BY display_id) FROM calendar_source_display_targets WHERE source_id=s.id),'{}'::uuid[]) display_ids FROM calendar_sources s WHERE s.id=$1 AND s.connection_id=$2 AND s.enabled FOR UPDATE`,[sourceId,connection.id])).rows[0];if(!source)return;const unique=new Map<string,CalendarEvent>();for(const event of events)unique.set(`${event.uid}\n${event.instanceId}`,event);for(const event of unique.values()){const existing=(await client.query<any>('SELECT * FROM calendar_occurrences WHERE source_id=$1 AND event_uid=$2 AND instance_id=$3 FOR UPDATE',[sourceId,event.uid,event.instanceId])).rows[0];if(event.cancelled){if(existing?.status==='active')await this.withdrawOccurrence(client,existing);if(existing)await client.query('UPDATE calendar_occurrences SET last_seen_generation=$2,updated_at=clock_timestamp() WHERE id=$1',[existing.id,generation]);continue;}const incarnation=existing?.status==='withdrawn'?Number(existing.incarnation)+1:Number(existing?.incarnation??1);const externalId=existing?.status==='active'?existing.external_item_id:`cal:${sourceId.slice(0,8)}:${sha(`${event.uid}\n${event.instanceId}`).slice(0,20)}:${incarnation}`;const fingerprint=sha(JSON.stringify(event));let itemId=existing?.status==='active'?existing.integration_item_id:null;if(!itemId){itemId=(await client.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,publish_at,starts_at,ends_at,expires_at,source,metadata,status,request_hash,content_locale) VALUES($1,$2,$3,'event',$4,$5,$5,'normal',NULL,$6,$7,$8,$9,$10,'active',$11,NULL) RETURNING id`,[connection.household_id,connection.integration_connection_id,externalId,source.target_household,event.title,event.start,event.end,new Date(new Date(event.end??event.start).getTime()+86400_000),JSON.stringify({label:`${connection.name}: ${source.name}`,observedAt:new Date().toISOString(),uncertainty:'low'}),JSON.stringify({category:'activity',allDay:event.allDay,...(event.location?{location:event.location}:{}),calendar:{provider:connection.provider,sourceId,bridgeKind:source.bridge_kind,subjectHousehold:source.subject_household}}),fingerprint])).rows[0]!.id;}else if(existing.fingerprint!==fingerprint){await client.query(`UPDATE integration_items SET title=$2,body=$2,starts_at=$3,ends_at=$4,expires_at=$5,source=$6,metadata=$7,request_hash=$8,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status='active'`,[itemId,event.title,event.start,event.end,new Date(new Date(event.end??event.start).getTime()+86400_000),JSON.stringify({label:`${connection.name}: ${source.name}`,observedAt:new Date().toISOString(),uncertainty:'low'}),JSON.stringify({category:'activity',allDay:event.allDay,...(event.location?{location:event.location}:{}),calendar:{provider:connection.provider,sourceId,bridgeKind:source.bridge_kind,subjectHousehold:source.subject_household}}),fingerprint]);}
      await client.query('DELETE FROM integration_item_person_subjects WHERE item_id=$1',[itemId]);for(const personId of source.subject_person_ids)await client.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[connection.household_id,itemId,personId]);await client.query('DELETE FROM integration_item_person_targets WHERE item_id=$1',[itemId]);for(const personId of source.reader_person_ids)await client.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[connection.household_id,itemId,personId]);await client.query('DELETE FROM integration_item_display_targets WHERE item_id=$1',[itemId]);for(const displayId of source.display_ids)await client.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[connection.household_id,itemId,displayId]);if(existing)await client.query(`UPDATE calendar_occurrences SET incarnation=$2,integration_item_id=$3,external_item_id=$4,fingerprint=$5,status='active',last_seen_generation=$6,updated_at=clock_timestamp() WHERE id=$1`,[existing.id,incarnation,itemId,externalId,fingerprint,generation]);else await client.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,incarnation,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,[connection.household_id,sourceId,event.uid,event.instanceId,incarnation,itemId,externalId,fingerprint,generation]);}
    const missing=await client.query<any>(`SELECT * FROM calendar_occurrences WHERE source_id=$1 AND status='active' AND last_seen_generation<$2 FOR UPDATE`,[sourceId,generation]);for(const occurrence of missing.rows)await this.withdrawOccurrence(client,occurrence);
  }
  private async withdrawOccurrence(client:DbClient,occurrence:any){if(occurrence.integration_item_id)await client.query(`UPDATE integration_items SET status='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status='active'`,[occurrence.integration_item_id]);await client.query(`UPDATE calendar_occurrences SET status='withdrawn',updated_at=clock_timestamp() WHERE id=$1`,[occurrence.id]);}
  private async withdrawAll(client:DbClient,connectionId:string){const rows=await client.query<any>(`SELECT occurrence.* FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE source.connection_id=$1 AND occurrence.status='active' FOR UPDATE OF occurrence`,[connectionId]);for(const row of rows.rows)await this.withdrawOccurrence(client,row);}
  private async audit(client:DbClient,actor:CalendarActor,action:string,subjectId:string,metadata:Record<string,unknown>={}){await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,$4,'calendar_connection',$5,$6)`,[actor.installationId,actor.householdId,actor.accountId,action,subjectId,JSON.stringify(metadata)]);}
}

export async function runCalendarSyncBatch(service=new CalendarService()):Promise<{claimed:number;succeeded:number;failed:number}>{const ids=await pool.query<{id:string}>('SELECT id FROM calendar_connections WHERE state IN (\'connected\',\'error\',\'syncing\') AND next_sync_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) ORDER BY next_sync_at,id LIMIT 5');let succeeded=0,failed=0;for(const row of ids.rows)try{await service.syncConnection(row.id);succeeded++;}catch{failed++;}return{claimed:ids.rowCount??0,succeeded,failed};}
