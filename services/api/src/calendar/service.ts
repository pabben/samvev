import { createHash, randomUUID } from 'node:crypto';
import ical from 'node-ical';
import { DomainError, opaqueToken, tokenHash } from '@samvev/core';
import { AiCredentialVault } from '../ai/credential-vault.ts';
import { createOAuthAttempt } from '../ai/oauth-primitives.ts';
import { pool, transaction, type DbClient } from '../db.ts';
import { SecretSubscriptionFetcher } from '../monitor/source-fetcher.ts';
import { CalendarProviderConfigurationService,calendarCallbackUri,type ProviderRuntimeConfig,type RegisteredCalendarProvider } from './provider-config.ts';
import { HomeAssistantClient } from './home-assistant-client.ts';

export type CalendarProvider='google'|'microsoft'|'ics'|'home_assistant';
export interface CalendarActor{accountId:string;sessionId:string;installationId:string;householdId:string;membershipId:string;personId?:string;capabilities:string[];}
export interface CalendarTokenSet{accessToken:string;refreshToken?:string;expiresAt:string;scopes:string[];providerSubject:string;accountLabel?:string;}
export interface CalendarInfo{externalId:string;name:string;provenance?:Record<string,unknown>;sourceWarning?:string;}
export interface CalendarEvent{uid:string;instanceId:string;title:string;start:string;end:string|null;allDay:boolean;cancelled:boolean;status?:'confirmed'|'tentative'|'declined'|'unanswered'|'cancelled';location?:string;}
export interface CalendarPage<T>{items:T[];nextPageToken?:string;responseBytes?:number;}
type LegacyCalendarReadiness={google:{configured:boolean;redirectUri:string;requiredEnvironment:string[]};microsoft:{configured:boolean;redirectUri:string;requiredEnvironment:string[]};ics:{configured:true;redirectUri:null;requiredEnvironment:never[]}};
export interface CalendarTransport{
  exchangeCode(provider:Exclude<CalendarProvider,'ics'>,input:{code:string;verifier:string;redirectUri:string;config?:ProviderRuntimeConfig}):Promise<CalendarTokenSet>;
  refresh(provider:CalendarProvider,refreshToken:string,config?:ProviderRuntimeConfig):Promise<CalendarTokenSet>;
  revoke(provider:Exclude<CalendarProvider,'ics'>,token:string,config?:ProviderRuntimeConfig):Promise<'confirmed'|'local_only'>;
  listCalendars(provider:Exclude<CalendarProvider,'ics'>,accessToken:string,pageToken?:string,config?:ProviderRuntimeConfig):Promise<CalendarPage<CalendarInfo>>;
  listEvents(provider:CalendarProvider,accessToken:string,calendarId:string,window:{from:string;to:string},pageToken?:string,config?:ProviderRuntimeConfig):Promise<CalendarPage<CalendarEvent>>;
  fetchIcs(url:string):Promise<string>;
}

type ProviderConfig={clientId:string;clientSecret:string;authorizationEndpoint:string;tokenEndpoint:string;scopes:string[]};
function providerConfig(provider:Exclude<CalendarProvider,'ics'|'home_assistant'>,runtime?:ProviderRuntimeConfig):ProviderConfig{
  if(runtime){
    if(runtime.provider!==provider||!runtime.clientSecret)throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_provider_configuration_invalid'});
    if(provider==='google')return{clientId:runtime.clientId,clientSecret:runtime.clientSecret,authorizationEndpoint:'https://accounts.google.com/o/oauth2/v2/auth',tokenEndpoint:'https://oauth2.googleapis.com/token',scopes:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly']};
    return{clientId:runtime.clientId,clientSecret:runtime.clientSecret,authorizationEndpoint:`https://login.microsoftonline.com/${encodeURIComponent(runtime.tenant??'common')}/oauth2/v2.0/authorize`,tokenEndpoint:`https://login.microsoftonline.com/${encodeURIComponent(runtime.tenant??'common')}/oauth2/v2.0/token`,scopes:['openid','email','offline_access','Calendars.ReadBasic']};
  }
  if(provider==='google'){
    const clientId=process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_ID?.trim(),clientSecret=process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET?.trim();if(!clientId||!clientSecret)throw new DomainError('CONFLICT',409,{reason:'google_calendar_registration_missing'});
    return{clientId,clientSecret,authorizationEndpoint:'https://accounts.google.com/o/oauth2/v2/auth',tokenEndpoint:'https://oauth2.googleapis.com/token',scopes:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly']};
  }
  const clientId=process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID?.trim(),clientSecret=process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET?.trim();if(!clientId||!clientSecret)throw new DomainError('CONFLICT',409,{reason:'microsoft_calendar_registration_missing'});
  const tenant=(process.env.SAMVEV_MICROSOFT_CALENDAR_TENANT??'common').trim();
  return{clientId,clientSecret,authorizationEndpoint:`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,tokenEndpoint:`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,scopes:['openid','email','offline_access','Calendars.ReadBasic']};
}
const PROVIDER_JSON_MAX_BYTES=1024*1024;
const PROVIDER_TOKEN_MAX_BYTES=256*1024;
const PROVIDER_IDENTITY_MAX_BYTES=64*1024;
const PROVIDER_PAGE_MAX_ITEMS=3000;
const SNAPSHOT_MAX_ITEMS=10_000;
const SNAPSHOT_MAX_BYTES=8*1024*1024;
const CALENDAR_LIST_MAX_ITEMS=500;

function invalidProviderResponse():DomainError{return new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});}
function boundedString(value:unknown,max:number,{optional=false}:{optional?:boolean}={}):string|undefined{
  if(value===undefined||value===null){if(optional)return undefined;throw invalidProviderResponse();}
  if(typeof value!=='string'||value.length===0||value.length>max)throw invalidProviderResponse();
  return value;
}
async function boundedResponseText(response:Response,maxBytes:number):Promise<{text:string;bytes:number}>{
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_provider_response_too_large'});
  if(!response.body){return{text:'',bytes:0};}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{
    while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_provider_response_too_large'});}chunks.push(next.value);}
  }finally{reader.releaseLock();}
  return{text:Buffer.concat(chunks.map((chunk)=>Buffer.from(chunk)),bytes).toString('utf8'),bytes};
}
async function jsonRequest(url:string,init:RequestInit,maxBytes=PROVIDER_JSON_MAX_BYTES,context:'resource'|'token'='resource'):Promise<{body:Record<string,any>;bytes:number}>{
  let response:Response;try{response=await fetch(url,{...init,signal:AbortSignal.timeout(15_000)});}catch{throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_unavailable'});}
  let payload:{text:string;bytes:number};try{payload=await boundedResponseText(response,maxBytes);}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_unavailable'});}let body:unknown;
  try{body=JSON.parse(payload.text);}catch{throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:response.ok?'calendar_provider_response_invalid':'calendar_provider_unavailable',httpStatus:response.status});}
  if(!response.ok){
    const providerCode=body&&typeof body==='object'&&!Array.isArray(body)&&typeof (body as Record<string,unknown>).error==='string'?String((body as Record<string,unknown>).error):'';
    if(context==='token'&&providerCode==='invalid_grant')throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
    if(context==='token'&&['invalid_client','unauthorized_client','invalid_scope'].includes(providerCode))throw new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_client_configuration_invalid'});
    if(context==='resource'&&response.status===401)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
    throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_unavailable',httpStatus:response.status});
  }
  if(!body||typeof body!=='object'||Array.isArray(body))throw invalidProviderResponse();return{body:body as Record<string,any>,bytes:payload.bytes};
}
function nextToken(value:unknown,max=8192):string|undefined{return value===undefined?undefined:boundedString(value,max);}
function calendarInfo(value:unknown):CalendarInfo{
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalidProviderResponse();const item=value as Record<string,unknown>;
  return{externalId:boundedString(item.id,2048)!,name:boundedString(item.summaryOverride??item.summary??item.name??'Calendar',512)!};
}
export class DefaultCalendarTransport implements CalendarTransport{
  private readonly ics=new SecretSubscriptionFetcher();
  private readonly homeAssistant=new HomeAssistantClient();
  async exchangeCode(provider:Exclude<CalendarProvider,'ics'>,input:{code:string;verifier:string;redirectUri:string;config?:ProviderRuntimeConfig}):Promise<CalendarTokenSet>{
    if(provider==='home_assistant'){if(!input.config)throw new DomainError('AI_CONFIGURATION_INVALID',422);return this.homeAssistant.exchangeCode(input.config,input);}
    const config=providerConfig(provider,input.config);const params=new URLSearchParams({client_id:config.clientId,grant_type:'authorization_code',code:input.code,redirect_uri:input.redirectUri,code_verifier:input.verifier,client_secret:config.clientSecret});const {body:data}=await jsonRequest(config.tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params},PROVIDER_TOKEN_MAX_BYTES,'token');const accessToken=boundedString(data.access_token,32_000);const refreshToken=boundedString(data.refresh_token,32_000,{optional:true});const expiresIn=Number(data.expires_in??3600);if(!Number.isFinite(expiresIn)||expiresIn<=0||expiresIn>31_536_000)throw new DomainError('CONFLICT',409,{reason:'calendar_identity_invalid'});const {body:identity}=await jsonRequest(provider==='google'?'https://openidconnect.googleapis.com/v1/userinfo':'https://graph.microsoft.com/oidc/userinfo',{headers:{authorization:`Bearer ${accessToken}`}},PROVIDER_IDENTITY_MAX_BYTES);const subject=boundedString(identity.sub,512);const scopeText=data.scope===undefined?config.scopes.join(' '):boundedString(data.scope,8192)!;return{accessToken:accessToken!,...(refreshToken?{refreshToken}:{}),expiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),scopes:scopeText.split(/\s+/).filter(Boolean),providerSubject:subject!,accountLabel:boundedString(identity.email,320,{optional:true})};
  }
  async refresh(provider:CalendarProvider,refreshToken:string,runtime?:ProviderRuntimeConfig):Promise<CalendarTokenSet>{if(provider==='ics')throw new DomainError('CONFLICT',409);if(provider==='home_assistant'){if(!runtime)throw new DomainError('AI_CONFIGURATION_INVALID',422);return this.homeAssistant.refresh(runtime,refreshToken);}const config=providerConfig(provider,runtime);const params=new URLSearchParams({client_id:config.clientId,grant_type:'refresh_token',refresh_token:refreshToken,scope:config.scopes.join(' '),client_secret:config.clientSecret});const {body:data}=await jsonRequest(config.tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params},PROVIDER_TOKEN_MAX_BYTES,'token');const accessToken=boundedString(data.access_token,32_000),nextRefresh=boundedString(data.refresh_token,32_000,{optional:true});const expiresIn=Number(data.expires_in??3600);if(!Number.isFinite(expiresIn)||expiresIn<=0||expiresIn>31_536_000)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});const scopeText=data.scope===undefined?config.scopes.join(' '):boundedString(data.scope,8192)!;return{accessToken:accessToken!,refreshToken:nextRefresh??refreshToken,expiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),scopes:scopeText.split(/\s+/).filter(Boolean),providerSubject:'retained'};}
  async revoke(provider:Exclude<CalendarProvider,'ics'>,token:string,runtime?:ProviderRuntimeConfig):Promise<'confirmed'|'local_only'>{if(provider==='home_assistant'){if(!runtime)throw new DomainError('AI_CONFIGURATION_INVALID',422);return this.homeAssistant.revoke(runtime,token);}if(provider!=='google')return'local_only';const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(15_000)});if(!response.ok&&response.status!==400)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);return'confirmed';}
  async listCalendars(provider:Exclude<CalendarProvider,'ics'>,accessToken:string,pageToken?:string,runtime?:ProviderRuntimeConfig):Promise<CalendarPage<CalendarInfo>>{
    if(provider==='home_assistant'){if(!runtime||pageToken)throw new DomainError('AI_CONFIGURATION_INVALID',422);const items=await this.homeAssistant.listSources(runtime,accessToken);return{items,responseBytes:Buffer.byteLength(JSON.stringify(items))};}
    if(provider==='google'){const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');url.searchParams.set('maxResults','250');if(pageToken)url.searchParams.set('pageToken',pageToken);const {body:data,bytes}=await jsonRequest(url.toString(),{headers:{authorization:`Bearer ${accessToken}`}});if(!Array.isArray(data.items)||data.items.length>PROVIDER_PAGE_MAX_ITEMS)throw invalidProviderResponse();return{items:data.items.map(calendarInfo),nextPageToken:nextToken(data.nextPageToken,4096),responseBytes:bytes};}
    const url=pageToken??'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name&$top=100';const parsed=new URL(url);if(parsed.origin!=='https://graph.microsoft.com'||!parsed.pathname.startsWith('/v1.0/me/calendars'))throw new DomainError('AI_ENDPOINT_BLOCKED',422);const {body:data,bytes}=await jsonRequest(url,{headers:{authorization:`Bearer ${accessToken}`}});if(!Array.isArray(data.value)||data.value.length>PROVIDER_PAGE_MAX_ITEMS)throw invalidProviderResponse();return{items:data.value.map(calendarInfo),nextPageToken:nextToken(data['@odata.nextLink']),responseBytes:bytes};
  }
  async listEvents(provider:CalendarProvider,accessToken:string,calendarId:string,window:{from:string;to:string},pageToken?:string,runtime?:ProviderRuntimeConfig):Promise<CalendarPage<CalendarEvent>>{
    if(provider==='ics')throw new DomainError('CONFLICT',409);
    if(provider==='home_assistant'){if(!runtime||pageToken)throw new DomainError('AI_CONFIGURATION_INVALID',422);const items=await this.homeAssistant.listEvents(runtime,accessToken,calendarId,window);return{items,responseBytes:Buffer.byteLength(JSON.stringify(items))};}
    if(provider==='google'){
      const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
      url.searchParams.set('timeMin',window.from);url.searchParams.set('timeMax',window.to);url.searchParams.set('singleEvents','true');url.searchParams.set('showDeleted','true');url.searchParams.set('maxResults','2500');if(pageToken)url.searchParams.set('pageToken',pageToken);
      const {body:data,bytes}=await jsonRequest(url.toString(),{headers:{authorization:`Bearer ${accessToken}`}});
      if(!Array.isArray(data.items)||data.items.length>PROVIDER_PAGE_MAX_ITEMS)throw invalidProviderResponse();
      return{items:data.items.map((item:any)=>{
        const cancelled=item?.status==='cancelled',recurring=typeof item?.recurringEventId==='string';
        const ownResponse=Array.isArray(item?.attendees)?item.attendees.find((attendee:any)=>attendee&&attendee.self===true)?.responseStatus:undefined;
        const status:CalendarEvent['status']=cancelled?'cancelled':item?.status==='tentative'||ownResponse==='tentative'?'tentative':ownResponse==='declined'?'declined':ownResponse==='needsAction'?'unanswered':'confirmed';
        const identityStart=item?.originalStartTime??{},actualStart=item?.start??identityStart;
        const identityValue=identityStart.dateTime??identityStart.date;
        const id=boundedString(item?.id,2048);if((recurring&&typeof identityValue!=='string')||(!cancelled&&typeof actualStart.dateTime!=='string'&&typeof actualStart.date!=='string'))throw invalidProviderResponse();
        return{uid:boundedString(recurring?item.recurringEventId:(item.iCalUID??id),2048)!,instanceId:boundedString(recurring?identityValue:id,2048)!,title:boundedString(item.summary??'Untitled event',2048)!,start:boundedString(actualStart.dateTime??actualStart.date??'1970-01-01T00:00:00.000Z',100)!,end:item.end?boundedString(item.end.dateTime??item.end.date,100,{optional:true})??null:null,allDay:Boolean(actualStart.date&&!actualStart.dateTime),cancelled,status,location:boundedString(item.location,1024,{optional:true})};
      }),nextPageToken:nextToken(data.nextPageToken,4096),responseBytes:bytes};
    }
    const url=pageToken??`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView?startDateTime=${encodeURIComponent(window.from)}&endDateTime=${encodeURIComponent(window.to)}&$select=id,subject,start,end,isAllDay,isCancelled,seriesMasterId,originalStart,location,responseStatus&$top=100`;const parsed=new URL(url);if(parsed.origin!=='https://graph.microsoft.com'||!/^\/v1\.0\/me\/calendars\/[^/]+\/calendarView$/.test(parsed.pathname))throw new DomainError('AI_ENDPOINT_BLOCKED',422);const {body:data,bytes}=await jsonRequest(url,{headers:{authorization:`Bearer ${accessToken}`,Prefer:'outlook.timezone="UTC"'}});if(!Array.isArray(data.value)||data.value.length>PROVIDER_PAGE_MAX_ITEMS)throw invalidProviderResponse();const instant=(value:unknown)=>{const text=boundedString(value,100)!;return /(?:Z|[+-]\d\d:\d\d)$/.test(text)?text:`${text}Z`;};return{items:data.value.map((item:any)=>{const id=boundedString(item?.id,2048);if(!item||(!item.isCancelled&&typeof item.start?.dateTime!=='string'))throw invalidProviderResponse();const recurring=typeof item.seriesMasterId==='string',response=item.responseStatus?.response;const status:CalendarEvent['status']=item.isCancelled?'cancelled':response==='declined'?'declined':response==='tentativelyAccepted'?'tentative':response==='notResponded'||response==='none'?'unanswered':'confirmed';return{uid:boundedString(recurring?item.seriesMasterId:id,2048)!,instanceId:recurring?boundedString(item.originalStart??item.start?.dateTime,100)!:'single',title:boundedString(item.subject??'Untitled event',2048)!,start:instant(item.start?.dateTime??item.originalStart),end:item.end?.dateTime?instant(item.end.dateTime):null,allDay:Boolean(item.isAllDay),cancelled:Boolean(item.isCancelled),status,location:boundedString(item.location?.displayName,1024,{optional:true})}}),nextPageToken:nextToken(data['@odata.nextLink']),responseBytes:bytes};
  }
  fetchIcs(url:string){return this.ics.fetch(url);}
}

interface StoredCredential{accessToken?:string;refreshToken?:string;expiresAt?:string;providerSubject?:string;url?:string;}
interface ConnectionRow{id:string;household_id:string;installation_id:string;integration_connection_id:string;owner_account_id:string;provider:CalendarProvider;bridge_kind:string;name:string;state:string;credential_ciphertext:string|null;revision:number;sync_generation:number;lease_token:string|null;provider_config_revision:number;provider_client_id_hash:string|null;}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const calendarAad=(householdId:string,connectionId:string,accountId:string)=>`${householdId}:calendar:${connectionId}:account:${accountId}`;
const windowFor=(now=new Date())=>({from:new Date(now.getTime()-7*86400_000).toISOString(),to:new Date(now.getTime()+180*86400_000).toISOString()});
const requiredCalendarScopes=(provider:Exclude<CalendarProvider,'ics'>,runtime?:ProviderRuntimeConfig)=>provider==='home_assistant'?['home_assistant_instance_token']:providerConfig(provider,runtime).scopes.filter((scope)=>scope.includes('calendar')||scope==='Calendars.ReadBasic');
function requireCalendarScopes(provider:Exclude<CalendarProvider,'ics'>,scopes:string[],reauthorization=false,runtime?:ProviderRuntimeConfig):void{if(requiredCalendarScopes(provider,runtime).some((scope)=>!scopes.includes(scope)))throw new DomainError(reauthorization?'CONFLICT':'FORBIDDEN',reauthorization?409:403,{reason:reauthorization?'calendar_reauthorization_required':'calendar_scopes_missing'});}
function calendarFailureCode(error:unknown):'CALENDAR_REAUTHORIZATION_REQUIRED'|'CALENDAR_CLIENT_CONFIGURATION_INVALID'|'CALENDAR_SYNC_FAILED'{const reason=error instanceof DomainError?error.details?.reason:undefined;return reason==='calendar_reauthorization_required'?'CALENDAR_REAUTHORIZATION_REQUIRED':reason==='calendar_client_configuration_invalid'?'CALENDAR_CLIENT_CONFIGURATION_INVALID':'CALENDAR_SYNC_FAILED';}
function calendarItemMetadata(current:unknown,connection:Pick<ConnectionRow,'provider'>,source:{id:string;bridge_kind:string;subject_household:boolean},event?:CalendarEvent):Record<string,unknown>{
  const metadata=current&&typeof current==='object'&&!Array.isArray(current)?{...(current as Record<string,unknown>)}:{};
  const calendar=metadata.calendar&&typeof metadata.calendar==='object'&&!Array.isArray(metadata.calendar)?{...(metadata.calendar as Record<string,unknown>)}:{};
  if(event)delete calendar.freshnessReason;
  metadata.calendar={...calendar,provider:connection.provider,sourceId:source.id,bridgeKind:source.bridge_kind,subjectHousehold:source.subject_household,freshness:event?'current':calendar.freshness??'current',...(event?{status:event.status??'unknown'}:{})};
  if(event){metadata.category='activity';metadata.allDay=event.allDay;if(event.location)metadata.location=event.location;else delete metadata.location;}
  return metadata;
}
function canonicalEvent(event:CalendarEvent){
  const uid=boundedString(event.uid,2048),instanceId=boundedString(event.instanceId,2048),title=boundedString(event.title,2048),location=boundedString(event.location,1024,{optional:true});
  if(typeof event.allDay!=='boolean'||typeof event.cancelled!=='boolean'||event.status!==undefined&&!['confirmed','tentative','declined','unanswered','cancelled'].includes(event.status))throw invalidProviderResponse();
  let start:string,end:string|null;try{const rawStart=boundedString(event.start,100)!;start=/^\d{4}-\d{2}-\d{2}$/.test(rawStart)?`${rawStart}T00:00:00.000Z`:new Date(rawStart).toISOString();const rawEnd=boundedString(event.end,100,{optional:true});end=rawEnd?(/^\d{4}-\d{2}-\d{2}$/.test(rawEnd)?`${rawEnd}T00:00:00.000Z`:new Date(rawEnd).toISOString()):null;}catch{throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_event_time_invalid'});}
  if(end&&end<start)throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_event_time_invalid'});return{...event,uid:uid!,instanceId:instanceId!,start,end,title:title!.normalize('NFKC').trim().slice(0,160)||'Untitled event',location:location?.normalize('NFKC').trim().slice(0,160)};
}
export function parseIcsEvents(text:string,window:{from:string;to:string}):CalendarEvent[]{
  const parsed=ical.sync.parseICS(text),from=new Date(window.from),to=new Date(window.to),events:CalendarEvent[]=[];
  if(Object.keys(parsed).length>SNAPSHOT_MAX_ITEMS)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});
  const push=(event:CalendarEvent)=>{if(events.length>=SNAPSHOT_MAX_ITEMS)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});events.push(event);};
  const stamp=(value:Date)=>value.toISOString();
  for(const item of Object.values(parsed)){
    if(item.type!=='VEVENT')continue;
    const event=item as ical.VEvent;
    if(event.rrule&&event.start){
      if(event.rrule.options.freq>3)throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_recurrence_frequency_unsupported'});
      const overrides=new Map<string,ical.VEvent>();
      for(const [key,override] of Object.entries(event.recurrences??{})){
        const original=override.recurrenceid instanceof Date?stamp(override.recurrenceid):key;
        overrides.set(original,override);
      }
      const excluded=new Set<string>();
      for(const [key,date] of Object.entries(event.exdate??{}))excluded.add(date instanceof Date?stamp(date):key);
      const baseDuration=Math.max(0,(event.end?.getTime()??event.start.getTime())-event.start.getTime());
      const remaining=SNAPSHOT_MAX_ITEMS-events.length;let exceeded=false;
      const occurrences=event.rrule.between(from,to,true,(_date,length)=>{if(length>=remaining){exceeded=true;return false;}return true;});
      if(exceeded)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});
      for(const original of occurrences){
        const identity=stamp(original),override=overrides.get(identity);
        if(excluded.has(identity)&&!override)continue;
        const start=override?.start??original;
        const duration=override?.start&&override.end?Math.max(0,override.end.getTime()-override.start.getTime()):baseDuration;
        push({uid:String(event.uid),instanceId:identity,title:String(override?.summary??event.summary??'Untitled event'),start:stamp(start),end:duration?stamp(new Date(start.getTime()+duration)):null,allDay:(override?.datetype??event.datetype)==='date',cancelled:String(override?.status??event.status??'').toUpperCase()==='CANCELLED',location:String(override?.location??event.location??'')||undefined});
      }
    }else if(event.start&&event.start<to&&(event.end??event.start)>=from){
      push({uid:String(event.uid),instanceId:event.recurrenceid?.toISOString()??event.start.toISOString(),title:String(event.summary??'Untitled event'),start:event.start.toISOString(),end:event.end?.toISOString()??null,allDay:event.datetype==='date',cancelled:String(event.status??'').toUpperCase()==='CANCELLED',location:String(event.location??'')||undefined});
    }
  }
  return events.map(canonicalEvent);
}

export class CalendarService{
  private readonly providers:CalendarProviderConfigurationService;
  constructor(private readonly transport:CalendarTransport=new DefaultCalendarTransport(),private readonly vault=new AiCredentialVault(),private readonly now:()=>Date=()=>new Date(),providers?:CalendarProviderConfigurationService){this.providers=providers??new CalendarProviderConfigurationService(vault);}
  readiness(actor:CalendarActor,publicOrigin:string):Promise<Record<string,unknown>>;
  readiness(publicOrigin:string):LegacyCalendarReadiness;
  readiness(actorOrOrigin:CalendarActor|string,publicOrigin?:string):Promise<Record<string,unknown>>|LegacyCalendarReadiness{
    if(typeof actorOrOrigin!=='string')return this.providers.readiness(actorOrOrigin,publicOrigin!);
    const origin=actorOrOrigin,googleRequired=['SAMVEV_GOOGLE_CALENDAR_CLIENT_ID','SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET'],microsoftRequired=['SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID','SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET'];return{google:{configured:googleRequired.every((name)=>Boolean(process.env[name]?.trim())),redirectUri:calendarCallbackUri(origin,'google'),requiredEnvironment:googleRequired},microsoft:{configured:microsoftRequired.every((name)=>Boolean(process.env[name]?.trim())),redirectUri:calendarCallbackUri(origin,'microsoft'),requiredEnvironment:microsoftRequired},ics:{configured:true,redirectUri:null,requiredEnvironment:[]}};
  }
  updateProvider(actor:CalendarActor,provider:RegisteredCalendarProvider,input:{expectedRevision:number;status:'active'|'disabled';clientId?:string;clientSecret?:string;tenant?:string;origin?:string;googleOAuthJson?:unknown},publicOrigin:string){return this.providers.update(actor,provider,input,publicOrigin);}
  async connectionReadiness(actor:CalendarActor,publicOrigin:string){
    await this.authorize(actor);
    const configured=async(provider:RegisteredCalendarProvider)=>{try{await this.providers.resolve(actor.installationId,provider);return true;}catch{return false;}};
    return{google:{configured:await configured('google'),redirectUri:calendarCallbackUri(publicOrigin,'google')},microsoft:{configured:await configured('microsoft'),redirectUri:calendarCallbackUri(publicOrigin,'microsoft')},home_assistant:{configured:await configured('home_assistant'),redirectUri:calendarCallbackUri(publicOrigin,'home_assistant')},ics:{configured:true,redirectUri:null}};
  }
  async create(actor:CalendarActor,input:{provider:CalendarProvider;name:string;bridgeKind:'direct'|'spond_calendar'|'spond_home_assistant';icsUrl?:string}){
    await this.authorize(actor);
    let runtime:ProviderRuntimeConfig|undefined;if(input.provider!=='ics')runtime=await this.providers.resolve(actor.installationId,input.provider);
    return transaction(async(client)=>{
      await this.authorize(actor,undefined,client);
      if(runtime)await this.assertRuntimeConfig(client,actor.installationId,runtime);
      await client.query('SELECT id FROM households WHERE id=$1 FOR UPDATE',[actor.householdId]);
      const active=(await client.query<{count:number}>(`SELECT count(*)::int count FROM calendar_connections WHERE household_id=$1 AND disconnected_at IS NULL`,[actor.householdId])).rows[0]?.count??0;
      if(active>=12)throw new DomainError('CONFLICT',409,{reason:'calendar_connection_limit_reached'});
      const integration=(await client.query<{id:string}>('INSERT INTO integration_connections(household_id,name) VALUES($1,$2) RETURNING id',[actor.householdId,input.name])).rows[0]!;
      const state=input.provider==='ics'?'connected':'setup';
      const connection=(await client.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,bridge_kind,name,state,provider_config_revision,provider_client_id_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[actor.householdId,integration.id,actor.accountId,input.provider,input.bridgeKind,input.name,state,runtime?.revision??0,runtime?.clientIdHash??null])).rows[0]!;
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
    const row=await this.row(actor,id);await this.authorize(actor,row);if(row.provider==='ics')throw new DomainError('CONFLICT',409);
    if(row.owner_account_id!==actor.accountId)throw new DomainError('FORBIDDEN',403,{reason:'calendar_account_owner_required'});
    const runtime=await this.providers.resolve(actor.installationId,row.provider),attempt=createOAuthAttempt(),redirectUri=calendarCallbackUri(publicOrigin,row.provider);
    const verifier=await this.vault.encrypt(calendarAad(actor.householdId,id,actor.accountId),attempt.verifier);
    await transaction(async(client)=>{
      await this.authorize(actor,row,client);
      await this.assertRuntimeConfig(client,actor.installationId,runtime);
      await client.query(`DELETE FROM calendar_oauth_sessions WHERE expires_at<clock_timestamp()-interval '1 day' OR consumed_at<clock_timestamp()-interval '1 day'`);
      const changed=await client.query<{sync_generation:number}>(`UPDATE calendar_connections SET state='awaiting_consent',sync_generation=sync_generation+1,next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,provider_config_revision=$4,provider_client_id_hash=$5,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND owner_account_id=$3 AND disconnected_at IS NULL RETURNING sync_generation`,[id,actor.householdId,row.owner_account_id,runtime.revision,runtime.clientIdHash]);if(!changed.rowCount)throw new DomainError('NOT_FOUND',404);
      await client.query(`UPDATE calendar_sync_attempts SET outcome='superseded',error_code='CALENDAR_SYNC_SUPERSEDED',completed_at=clock_timestamp() WHERE connection_id=$1 AND outcome='started'`,[id]);
      await client.query('UPDATE calendar_oauth_sessions SET consumed_at=COALESCE(consumed_at,clock_timestamp()),completion_hash=NULL,authorization_code_ciphertext=NULL WHERE connection_id=$1',[id]);
      await client.query(`INSERT INTO calendar_oauth_sessions(connection_id,owner_account_id,initiating_session_id,state_hash,verifier_ciphertext,redirect_uri,connection_generation,provider_config_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '10 minutes')`,[id,row.owner_account_id,actor.sessionId,tokenHash(attempt.state),verifier,redirectUri,changed.rows[0]!.sync_generation,runtime.revision]);
    });
    if(row.provider==='home_assistant')return{authorizationUrl:new HomeAssistantClient().authorizationUrl(runtime,redirectUri,attempt.state),connectionId:id};
    const config=providerConfig(row.provider,runtime),url=new URL(config.authorizationEndpoint);for(const [key,value] of Object.entries({client_id:config.clientId,response_type:'code',redirect_uri:redirectUri,scope:config.scopes.join(' '),state:attempt.state,code_challenge:attempt.challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'}))url.searchParams.set(key,value);return{authorizationUrl:url.toString(),connectionId:id};
  }
  async stageOAuthCallback(provider:Exclude<CalendarProvider,'ics'>,state:string,code?:string,error?:string){
    const completionToken=opaqueToken(),stateHash=tokenHash(state);
    return transaction(async(client)=>{
      const found=(await client.query<{id:string;connection_id:string;owner_account_id:string;household_id:string}>(`SELECT s.id,s.connection_id,s.owner_account_id,c.household_id FROM calendar_oauth_sessions s JOIN calendar_connections c ON c.id=s.connection_id WHERE s.state_hash=$1 AND s.consumed_at IS NULL AND s.expires_at>clock_timestamp() AND s.connection_generation=c.sync_generation AND c.provider=$2 AND c.state='awaiting_consent' AND c.disconnected_at IS NULL FOR UPDATE OF s,c`,[stateHash,provider])).rows[0];
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
    await this.authorize(actor);
    const session=await transaction(async(client)=>{
      const found=(await client.query<{id:string;connection_id:string;owner_account_id:string;verifier_ciphertext:string;authorization_code_ciphertext:string;redirect_uri:string;connection_generation:number;provider_config_revision:number;household_id:string;installation_id:string;provider:Exclude<CalendarProvider,'ics'>}>(`
        SELECT s.id,s.connection_id,s.owner_account_id,s.verifier_ciphertext,s.authorization_code_ciphertext,s.redirect_uri,s.connection_generation,s.provider_config_revision,c.household_id,h.installation_id,c.provider
        FROM calendar_oauth_sessions s JOIN calendar_connections c ON c.id=s.connection_id JOIN households h ON h.id=c.household_id
        JOIN memberships membership ON membership.account_id=s.owner_account_id AND membership.household_id=c.household_id
        JOIN accounts account ON account.id=s.owner_account_id AND account.disabled_at IS NULL
        JOIN sessions initiating ON initiating.id=s.initiating_session_id AND initiating.account_id=s.owner_account_id AND initiating.revoked_at IS NULL AND initiating.expires_at>clock_timestamp()
        WHERE s.completion_hash=$1 AND s.authorization_code_ciphertext IS NOT NULL AND s.expires_at>clock_timestamp()
          AND s.owner_account_id=$2 AND s.initiating_session_id=$3 AND c.household_id=$4 AND c.provider=$5 AND c.owner_account_id=s.owner_account_id AND s.connection_generation=c.sync_generation AND s.provider_config_revision=c.provider_config_revision AND c.state='awaiting_consent' AND c.disconnected_at IS NULL
          AND membership.capabilities ? 'household.view' AND EXISTS(SELECT 1 FROM persons person WHERE person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult')
        FOR UPDATE OF s,c,membership,account,initiating`,[tokenHash(completionToken),actor.accountId,actor.sessionId,actor.householdId,provider])).rows[0];
      if(!found)throw new DomainError('CONFLICT',409,{reason:'calendar_oauth_state_invalid'});
      await client.query('UPDATE calendar_oauth_sessions SET completion_hash=NULL,authorization_code_ciphertext=NULL WHERE id=$1',[found.id]);
      return found;
    });
    const runtime=await this.providers.resolve(session.installation_id,provider);if(runtime.revision!==session.provider_config_revision)throw new DomainError('CONFLICT',409,{reason:'calendar_oauth_superseded'});
    const aad=calendarAad(session.household_id,session.connection_id,session.owner_account_id);
    const [verifier,code]=await Promise.all([this.vault.decrypt(aad,session.verifier_ciphertext),this.vault.decrypt(aad,session.authorization_code_ciphertext)]);
    let tokens:CalendarTokenSet,pages:{items:CalendarInfo[];pageCount:number};
    try{
      tokens=await this.transport.exchangeCode(provider,{code,verifier,redirectUri:session.redirect_uri,config:runtime});
      requireCalendarScopes(provider,tokens.scopes,false,runtime);
      pages=await this.allPages((page)=>this.transport.listCalendars(provider,tokens.accessToken,page,runtime),CALENDAR_LIST_MAX_ITEMS);
      pages.items=pages.items.map((calendar)=>({externalId:boundedString(calendar.externalId,500)!,name:boundedString(calendar.name,200)!,provenance:calendar.provenance,sourceWarning:calendar.sourceWarning}));
    }catch(error){const code=calendarFailureCode(error);await pool.query(`UPDATE calendar_connections SET state=CASE WHEN $3='CALENDAR_REAUTHORIZATION_REQUIRED' THEN 'expired' ELSE 'error' END,last_error_code=CASE WHEN $3 IN ('CALENDAR_REAUTHORIZATION_REQUIRED','CALENDAR_CLIENT_CONFIGURATION_INVALID') THEN $3 ELSE 'CALENDAR_OAUTH_FAILED' END,next_sync_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND sync_generation=$2 AND state='awaiting_consent' AND disconnected_at IS NULL`,[session.connection_id,session.connection_generation,code]);throw error;}
    const credential=await this.vault.encrypt(aad,JSON.stringify(tokens));
    await transaction(async(client)=>{
	      await this.assertRuntimeConfig(client,session.installation_id,runtime);
	      const authorized=await client.query<{provider_subject_hash:string|null}>(`SELECT c.provider_subject_hash FROM calendar_connections c JOIN memberships m ON m.account_id=c.owner_account_id AND m.household_id=c.household_id JOIN persons person ON person.id=m.person_id AND person.household_id=m.household_id AND person.age_group='adult' JOIN accounts a ON a.id=c.owner_account_id AND a.disabled_at IS NULL JOIN calendar_oauth_sessions oauth ON oauth.id=$5 AND oauth.connection_id=c.id AND oauth.connection_generation=c.sync_generation JOIN sessions initiating ON initiating.id=oauth.initiating_session_id AND initiating.account_id=oauth.owner_account_id AND initiating.revoked_at IS NULL AND initiating.expires_at>clock_timestamp() WHERE c.id=$1 AND c.household_id=$2 AND c.owner_account_id=$3 AND c.provider=$4 AND c.sync_generation=$6 AND c.state='awaiting_consent' AND c.disconnected_at IS NULL AND oauth.initiating_session_id=$7 AND oauth.provider_config_revision=$8 AND c.provider_config_revision=$8 AND m.capabilities ? 'household.view' FOR UPDATE OF c,m,person,a,oauth,initiating`,[session.connection_id,session.household_id,session.owner_account_id,provider,session.id,session.connection_generation,actor.sessionId,runtime.revision]);
      if(!authorized.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_oauth_superseded'});
      const providerSubjectHash=sha(`${provider}\n${tokens.providerSubject}`);if(authorized.rows[0]!.provider_subject_hash&&authorized.rows[0]!.provider_subject_hash!==providerSubjectHash)throw new DomainError('CONFLICT',409,{reason:'calendar_provider_account_mismatch'});
      const duplicate=await client.query('SELECT 1 FROM calendar_connections WHERE household_id=$1 AND provider=$2 AND provider_subject_hash=$3 AND id<>$4 AND disconnected_at IS NULL FOR SHARE',[session.household_id,provider,sha(`${provider}\n${tokens.providerSubject}`),session.connection_id]);
      if(duplicate.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_account_already_connected'});
      await client.query(`UPDATE calendar_connections SET state='connected',credential_ciphertext=$3,provider_subject_hash=$4,account_label=$5,granted_scopes=$6,access_expires_at=$7,revision=revision+1,next_sync_at=CASE WHEN EXISTS(SELECT 1 FROM calendar_sources WHERE connection_id=$1 AND enabled) THEN clock_timestamp() ELSE NULL END,last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2`,[session.connection_id,session.household_id,credential,providerSubjectHash,tokens.accountLabel??null,tokens.scopes,tokens.expiresAt]);
	      for(const calendar of pages.items){
          if(provider==='home_assistant')await client.query(`UPDATE calendar_sources legacy SET external_id=$3,updated_at=clock_timestamp() WHERE legacy.household_id=$1 AND legacy.connection_id=$2 AND legacy.external_id<>$3 AND legacy.source_provenance->>'registryId'=$3 AND NOT EXISTS(SELECT 1 FROM calendar_sources current WHERE current.connection_id=$2 AND current.external_id=$3)`,[session.household_id,session.connection_id,calendar.externalId]);
          await client.query(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,bridge_kind,source_provenance) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connection_id,external_id) DO UPDATE SET name=EXCLUDED.name,source_provenance=EXCLUDED.source_provenance,updated_at=clock_timestamp()`,[session.household_id,session.connection_id,calendar.externalId,calendar.name,provider==='home_assistant'?'spond_home_assistant':'direct',JSON.stringify({...calendar.provenance,...(calendar.sourceWarning?{warning:calendar.sourceWarning}:{})})]);
        }
    });
    return{connectionId:session.connection_id,completed:true};
  }
  async updateSource(actor:CalendarActor,connectionId:string,sourceId:string,input:{expectedRevision:number;enabled:boolean;bridgeKind:'direct'|'spond_calendar'|'spond_home_assistant';appliesTo:{household:boolean;personIds:string[]};visibility:{household:boolean;personIds:string[];displayIds:string[]}}){
    const connection=await this.row(actor,connectionId);await this.authorize(actor,connection);
    await transaction(async(client)=>{
      const source=await client.query<{id:string;provider:CalendarProvider}>(`SELECT s.id,c.provider FROM calendar_sources s JOIN calendar_connections c ON c.id=s.connection_id WHERE s.id=$1 AND s.connection_id=$2 AND s.household_id=$3 AND c.disconnected_at IS NULL FOR UPDATE OF s,c`,[sourceId,connectionId,actor.householdId]);
      if(!source.rowCount)throw new DomainError('NOT_FOUND',404);
      const canShare=await this.authorize(actor,connection,client);if(!canShare&&(input.appliesTo.household||input.visibility.household||input.visibility.displayIds.length||input.appliesTo.personIds.length!==1||input.appliesTo.personIds[0]!==actor.personId||input.visibility.personIds.length!==1||input.visibility.personIds[0]!==actor.personId))throw new DomainError('FORBIDDEN',403,{reason:'calendar_private_mapping_required'});
      const people=[...new Set([...input.appliesTo.personIds,...input.visibility.personIds])];
      if(people.length&&(await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[actor.householdId,people])).rowCount!==people.length)throw new DomainError('NOT_FOUND',404);
      if(input.visibility.displayIds.length&&(await client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL',[actor.householdId,input.visibility.displayIds])).rowCount!==input.visibility.displayIds.length)throw new DomainError('NOT_FOUND',404);
      if(input.bridgeKind==='spond_calendar'&&(await client.query(`SELECT 1 FROM calendar_connections WHERE id=$1 AND provider IN ('google','microsoft')`,[connectionId])).rowCount!==1)throw new DomainError('VALIDATION_FAILED',400,{reason:'spond_bridge_requires_google_or_microsoft'});
      if(input.bridgeKind==='spond_home_assistant'&&(await client.query(`SELECT 1 FROM calendar_connections WHERE id=$1 AND provider='home_assistant'`,[connectionId])).rowCount!==1)throw new DomainError('VALIDATION_FAILED',400,{reason:'spond_home_assistant_requires_home_assistant'});
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
      const activeItems=await client.query<{occurrence_id:string;item_id:string;metadata:Record<string,unknown>}>(`SELECT occurrence.id occurrence_id,item.id item_id,item.metadata FROM calendar_occurrences occurrence JOIN integration_items item ON item.id=occurrence.integration_item_id WHERE occurrence.source_id=$1 AND occurrence.status='active' FOR UPDATE OF occurrence,item`,[sourceId]);
      for(const item of activeItems.rows){
        if(!input.enabled){await this.withdrawOccurrence(client,{id:item.occurrence_id,integration_item_id:item.item_id});continue;}
        const metadata=calendarItemMetadata(item.metadata,{provider:source.rows[0]!.provider},{id:sourceId,bridge_kind:input.bridgeKind,subject_household:input.appliesTo.household});
        await client.query('UPDATE integration_items SET target_household=$2,metadata=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[item.item_id,input.visibility.household,JSON.stringify(metadata)]);
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
    const owned=await this.row(actor,connectionId);await this.authorize(actor,owned);
    const source=(await pool.query<{external_id:string;revision:number}>(`SELECT source.external_id,source.revision FROM calendar_sources source JOIN calendar_connections connection ON connection.id=source.connection_id WHERE source.id=$1 AND source.connection_id=$2 AND source.household_id=$3 AND connection.disconnected_at IS NULL`,[sourceId,connectionId,actor.householdId])).rows[0];
    if(!source)throw new DomainError('NOT_FOUND',404);
    if(source.revision!==expectedSourceRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'calendar_source'});
    const row=owned,window=windowFor(this.now());
    let events:CalendarEvent[],pageCount=0;
    const aad=calendarAad(row.household_id,row.id,row.owner_account_id);
    if(row.provider==='ics'){
      const credential=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;
      if(!credential.url)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
      events=parseIcsEvents(await this.transport.fetchIcs(credential.url),window);pageCount=1;
    }else{
      const runtime=await this.runtimeFor(row);
      let credential=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;
      if(!credential.accessToken||!credential.expiresAt)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
      if(new Date(credential.expiresAt).getTime()<Date.now()+60_000){
        if(!credential.refreshToken)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
        const refreshed=await this.transport.refresh(row.provider,credential.refreshToken,runtime);
        requireCalendarScopes(row.provider,refreshed.scopes,true,runtime);
        credential={...credential,...refreshed,providerSubject:credential.providerSubject};
        const changed=await pool.query(`UPDATE calendar_connections SET credential_ciphertext=$3,access_expires_at=$4,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND sync_generation=$5 AND state='connected' AND disconnected_at IS NULL`,[row.id,row.household_id,await this.vault.encrypt(aad,JSON.stringify(credential)),refreshed.expiresAt,row.sync_generation]);
        if(!changed.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_superseded'});
      }
      const pages=await this.allPages((token)=>this.transport.listEvents(row.provider,credential.accessToken!,source.external_id,window,token,runtime));
      events=pages.items.map(canonicalEvent);pageCount=pages.pageCount;
    }
    await this.assertPreviewFence(row,sourceId,source.revision);
    return{sourceId,sourceRevision:source.revision,window,pageCount,totalCount:events.filter((event)=>!event.cancelled).length,events:events.filter((event)=>!event.cancelled).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,25).map((event)=>({title:event.title,start:event.start,end:event.end,allDay:event.allDay,status:event.status??'unknown',location:event.location??null}))};
  }
  async disconnect(actor:CalendarActor,id:string,expectedRevision:number){
    const owned=await this.row(actor,id);await this.authorize(actor,owned);
    const disconnected=await transaction(async(client)=>{
      const current=(await client.query<ConnectionRow>(`SELECT * FROM calendar_connections WHERE id=$1 AND household_id=$2 AND disconnected_at IS NULL FOR UPDATE`,[id,actor.householdId])).rows[0];
      if(!current)throw new DomainError('NOT_FOUND',404);if(current.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);
      await this.authorize(actor,current,client);
      await client.query(`UPDATE calendar_connections SET state='disconnected',credential_ciphertext=NULL,revision=revision+1,sync_generation=sync_generation+1,next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,disconnected_at=clock_timestamp(),last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1`,[id]);
      await this.withdrawAll(client,id);
      await client.query('UPDATE integration_connections SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[current.integration_connection_id]);
      await this.audit(client,actor,'calendar.connection_disconnected',id,{remoteRevocation:'pending'});
      return{...current,credentialCiphertext:current.credential_ciphertext};
    });
    let remote:'confirmed'|'local_only'|'failed'=disconnected.provider==='ics'?'local_only':'failed';
    if(disconnected.provider!=='ics'&&disconnected.credentialCiphertext){
      try{const secret=JSON.parse(await this.vault.decrypt(calendarAad(actor.householdId,id,disconnected.owner_account_id),disconnected.credentialCiphertext)) as StoredCredential;const token=secret.refreshToken??secret.accessToken;if(token)remote=await this.transport.revoke(disconnected.provider,token,await this.runtimeFor(owned));else remote='local_only';}catch{remote='failed';}
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
    const row=await this.row(actor,id);await this.authorize(actor,row);if(expectedRevision!==undefined&&row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);return this.syncConnection(row);
  }
  async syncConnection(rowOrId:ConnectionRow|string){
    const requested=typeof rowOrId==='string'?(await pool.query<ConnectionRow>('SELECT connection.*,household.installation_id FROM calendar_connections connection JOIN households household ON household.id=connection.household_id WHERE connection.id=$1',[rowOrId])).rows[0]:rowOrId;if(!requested)throw new DomainError('NOT_FOUND',404);
    const lease=randomUUID();
    const claimed=await pool.query<ConnectionRow>(`UPDATE calendar_connections connection SET state='syncing',lease_token=$2,lease_expires_at=clock_timestamp()+interval '5 minutes',last_sync_started_at=clock_timestamp(),last_error_code=NULL
      WHERE connection.id=$1 AND connection.disconnected_at IS NULL AND connection.state IN ('connected','error','syncing') AND (connection.lease_expires_at IS NULL OR connection.lease_expires_at<clock_timestamp())
        AND EXISTS(SELECT 1 FROM memberships membership JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL WHERE membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id AND membership.capabilities ? 'household.view' AND person.age_group='adult')
        AND EXISTS(SELECT 1 FROM integration_connections authority WHERE authority.id=connection.integration_connection_id AND authority.household_id=connection.household_id AND authority.revoked_at IS NULL)
      RETURNING connection.*,(SELECT installation_id FROM households WHERE id=connection.household_id) installation_id`,[requested.id,lease]);
    const row=claimed.rows[0];if(!row){
      const fenced=await transaction(async(client)=>{
        const invalid=await client.query<{integration_connection_id:string}>(`UPDATE calendar_connections connection SET state='expired',credential_ciphertext=NULL,next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,sync_generation=sync_generation+1,last_error_code='CALENDAR_AUTHORIZATION_UNAVAILABLE',updated_at=clock_timestamp() WHERE connection.id=$1 AND connection.disconnected_at IS NULL AND connection.state IN ('connected','error','syncing') AND NOT EXISTS(SELECT 1 FROM memberships membership JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult' JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL WHERE membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id AND membership.capabilities ? 'household.view') RETURNING connection.integration_connection_id`,[requested.id]);
        const authority=invalid.rows[0];if(!authority)return false;
        await client.query(`UPDATE integration_items SET metadata=jsonb_set(jsonb_set(metadata,'{calendar,freshness}','"stale"'::jsonb,true),'{calendar,freshnessReason}','"reauthorization_required"'::jsonb,true),revision=revision+1,updated_at=clock_timestamp() WHERE connection_id=$1 AND status='active' AND (metadata #>> '{calendar,freshness}' IS DISTINCT FROM 'stale' OR metadata #>> '{calendar,freshnessReason}' IS DISTINCT FROM 'reauthorization_required')`,[authority.integration_connection_id]);
        await client.query(`UPDATE calendar_oauth_sessions SET consumed_at=COALESCE(consumed_at,clock_timestamp()),completion_hash=NULL,authorization_code_ciphertext=NULL WHERE connection_id=$1`,[requested.id]);return true;
      });
      if(fenced)throw new DomainError('CONFLICT',409,{reason:'calendar_owner_authorization_unavailable'});
      throw new DomainError('CONFLICT',409,{reason:'calendar_sync_unavailable'});
    }
    const generation=Number(row.sync_generation)+1;
    const attempt=(await pool.query<{id:string}>('INSERT INTO calendar_sync_attempts(connection_id,generation,outcome) VALUES($1,$2,\'started\') RETURNING id',[row.id,generation])).rows[0]!;
    let pageCount=0,eventCount=0;
    try{
      const sources=(await pool.query<{id:string;external_id:string}>(`SELECT id,external_id FROM calendar_sources WHERE connection_id=$1 AND enabled ORDER BY id`,[row.id])).rows;
      const eventMap=new Map<string,CalendarEvent[]>(),aad=calendarAad(row.household_id,row.id,row.owner_account_id);let snapshotBytes=0;
      const snapshotWindow=windowFor(this.now());
      if(row.provider==='ics'){
        const secret=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;if(!secret.url)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
        const text=await this.transport.fetchIcs(secret.url);snapshotBytes=Buffer.byteLength(text);if(snapshotBytes>SNAPSHOT_MAX_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});if(sources[0])eventMap.set(sources[0].id,parseIcsEvents(text,snapshotWindow));pageCount=1;
      }else{
        const runtime=await this.runtimeFor(row);
        let secret=JSON.parse(await this.vault.decrypt(aad,row.credential_ciphertext!)) as StoredCredential;
        if(!secret.accessToken||!secret.expiresAt)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
        if(new Date(secret.expiresAt).getTime()<Date.now()+60_000){
          if(!secret.refreshToken)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
          const refreshed=await this.transport.refresh(row.provider,secret.refreshToken,runtime);requireCalendarScopes(row.provider,refreshed.scopes,true,runtime);secret={...secret,...refreshed,providerSubject:secret.providerSubject};
          const persisted=await pool.query('UPDATE calendar_connections SET credential_ciphertext=$2,access_expires_at=$3 WHERE id=$1 AND lease_token=$4 AND disconnected_at IS NULL RETURNING id',[row.id,await this.vault.encrypt(aad,JSON.stringify(secret)),refreshed.expiresAt,lease]);
          if(!persisted.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_superseded'});
        }
        for(const source of sources){const pages=await this.allPages((token)=>this.transport.listEvents(row.provider,secret.accessToken!,source.external_id,snapshotWindow,token,runtime));snapshotBytes+=pages.byteCount;if(snapshotBytes>SNAPSHOT_MAX_BYTES||eventCount+pages.items.length>SNAPSHOT_MAX_ITEMS)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});const canonical=pages.items.map(canonicalEvent);eventMap.set(source.id,canonical);pageCount+=pages.pageCount;eventCount+=canonical.length;}
      }
      if(row.provider==='ics')for(const values of eventMap.values())eventCount+=values.length;
      await transaction(async(client)=>{
        const locked=await client.query(`SELECT 1 FROM calendar_connections connection JOIN memberships membership ON membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id JOIN accounts account ON account.id=connection.owner_account_id AND account.disabled_at IS NULL JOIN integration_connections authority ON authority.id=connection.integration_connection_id AND authority.household_id=connection.household_id AND authority.revoked_at IS NULL WHERE connection.id=$1 AND connection.lease_token=$2 AND connection.lease_expires_at>clock_timestamp() AND connection.disconnected_at IS NULL AND membership.capabilities ? 'household.view' AND person.age_group='adult' FOR UPDATE OF connection,membership,person,account,authority`,[row.id,lease]);
        if(!locked.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_sync_superseded'});
        for(const [sourceId,events] of eventMap)await this.reconcileSource(client,row,sourceId,events,generation);
        await client.query(`UPDATE integration_items SET metadata=jsonb_set(metadata #- '{calendar,freshnessReason}','{calendar,freshness}','"current"'::jsonb,true),revision=revision+1,updated_at=clock_timestamp() WHERE connection_id=$1 AND status='active' AND (metadata #>> '{calendar,freshness}' IS DISTINCT FROM 'current' OR metadata #> '{calendar,freshnessReason}' IS NOT NULL)`,[row.integration_connection_id]);
        await client.query(`UPDATE calendar_connections SET state='connected',sync_generation=$3,last_sync_succeeded_at=clock_timestamp(),next_sync_at=CASE WHEN EXISTS(SELECT 1 FROM calendar_sources WHERE connection_id=$1 AND enabled) THEN clock_timestamp()+interval '15 minutes' ELSE NULL END,last_error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2`,[row.id,lease,generation]);
        await client.query(`UPDATE calendar_sync_attempts SET outcome='succeeded',page_count=$2,event_count=$3,completed_at=clock_timestamp() WHERE id=$1 AND outcome='started'`,[attempt.id,pageCount,eventCount]);
      });
      return{generation,pageCount,eventCount};
    }catch(error){
      const code=calendarFailureCode(error);
      await transaction(async(client)=>{
        const failed=await client.query(`UPDATE calendar_connections SET state=CASE WHEN $3='CALENDAR_REAUTHORIZATION_REQUIRED' THEN 'expired' ELSE 'error' END,last_error_code=$3,next_sync_at=CASE WHEN $3 IN ('CALENDAR_REAUTHORIZATION_REQUIRED','CALENDAR_CLIENT_CONFIGURATION_INVALID') THEN NULL ELSE clock_timestamp()+interval '15 minutes' END,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 RETURNING integration_connection_id`,[row.id,lease,code]);
        if(failed.rowCount)await client.query(`UPDATE integration_items SET metadata=jsonb_set(jsonb_set(metadata,'{calendar,freshness}','"stale"'::jsonb,true),'{calendar,freshnessReason}',to_jsonb($2::text),true),revision=revision+1,updated_at=clock_timestamp() WHERE connection_id=$1 AND status='active' AND (metadata #>> '{calendar,freshness}' IS DISTINCT FROM 'stale' OR metadata #>> '{calendar,freshnessReason}' IS DISTINCT FROM $2)`,[row.integration_connection_id,code==='CALENDAR_REAUTHORIZATION_REQUIRED'?'reauthorization_required':'sync_failed']);
        await client.query(`UPDATE calendar_sync_attempts SET outcome='failed',page_count=$2,event_count=$3,error_code=$4,completed_at=clock_timestamp() WHERE id=$1 AND outcome='started'`,[attempt.id,pageCount,eventCount,code]);
      });throw error;
    }
  }
  async get(actor:CalendarActor,id:string,client:DbClient=pool){
    const row=(await client.query<any>(`SELECT connection.*,household.installation_id,EXISTS(SELECT 1 FROM memberships owner_membership JOIN persons owner_person ON owner_person.id=owner_membership.person_id AND owner_person.household_id=owner_membership.household_id AND owner_person.age_group='adult' JOIN accounts owner_account ON owner_account.id=owner_membership.account_id AND owner_account.disabled_at IS NULL WHERE owner_membership.account_id=connection.owner_account_id AND owner_membership.household_id=connection.household_id AND owner_membership.capabilities ? 'household.view') owner_authorized FROM calendar_connections connection JOIN households household ON household.id=connection.household_id WHERE connection.id=$1 AND connection.household_id=$2`,[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);const canShare=await this.authorize(actor,row,client);
    const sources=await client.query<any>(`SELECT s.id,s.external_id,s.name,s.enabled,s.bridge_kind,s.subject_household,s.target_household,s.source_provenance,s.revision,COALESCE((SELECT json_agg(person_id ORDER BY person_id) FROM calendar_source_person_subjects WHERE source_id=s.id),'[]') subject_person_ids,COALESCE((SELECT json_agg(person_id ORDER BY person_id) FROM calendar_source_person_readers WHERE source_id=s.id),'[]') reader_person_ids,COALESCE((SELECT json_agg(display_id ORDER BY display_id) FROM calendar_source_display_targets WHERE source_id=s.id),'[]') display_ids FROM calendar_sources s WHERE s.connection_id=$1 ORDER BY s.name,s.id`,[id]);
    return{id:row.id,provider:row.provider,bridgeKind:row.bridge_kind,name:row.name,state:row.owner_authorized?row.state:'expired',accountLabel:row.account_label,grantedScopes:row.granted_scopes,revision:row.revision,ownerAccountId:row.owner_account_id,canShare,lastSyncStartedAt:row.last_sync_started_at?.toISOString()??null,lastSyncSucceededAt:row.last_sync_succeeded_at?.toISOString()??null,nextSyncAt:row.owner_authorized?row.next_sync_at?.toISOString()??null:null,errorCode:row.owner_authorized?row.last_error_code:'CALENDAR_AUTHORIZATION_UNAVAILABLE',disconnectedAt:row.disconnected_at?.toISOString()??null,sources:sources.rows.map((source:any)=>({id:source.id,externalId:source.external_id,name:source.name,enabled:source.enabled,bridgeKind:source.bridge_kind,sourceProvenance:source.source_provenance,sourceWarning:source.source_provenance?.warning??null,appliesTo:{household:source.subject_household,personIds:source.subject_person_ids},visibility:{household:source.target_household,personIds:source.reader_person_ids,displayIds:source.display_ids},revision:source.revision}))};
  }
  async list(actor:CalendarActor){const canShare=await this.authorize(actor);const ids=await pool.query<{id:string}>(`SELECT id FROM calendar_connections WHERE household_id=$1 AND ($2::boolean OR owner_account_id=$3) ORDER BY created_at,id`,[actor.householdId,canShare,actor.accountId]);return Promise.all(ids.rows.map((row)=>this.get(actor,row.id)));}
  private async row(actor:CalendarActor,id:string,client:DbClient=pool){const row=(await client.query<ConnectionRow>('SELECT connection.*,household.installation_id FROM calendar_connections connection JOIN households household ON household.id=connection.household_id WHERE connection.id=$1 AND connection.household_id=$2',[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);return row;}
  private async authorize(actor:CalendarActor,row?:Pick<ConnectionRow,'owner_account_id'>,client:DbClient=pool):Promise<boolean>{
    if(!actor.capabilities.includes('household.view'))throw new DomainError('FORBIDDEN',403);
    const authority=(await client.query<{age_group:string;capabilities:string[]}>(`SELECT person.age_group,membership.capabilities FROM memberships membership JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL WHERE membership.id=$1 AND membership.account_id=$2 AND membership.household_id=$3`,[actor.membershipId,actor.accountId,actor.householdId])).rows[0];
    const manager=Boolean(authority?.capabilities.includes('household.manage'));if(!authority||!authority.capabilities.includes('household.view')||authority.age_group!=='adult')throw new DomainError('FORBIDDEN',403,{reason:'calendar_adult_account_required'});if(row&&!manager&&row.owner_account_id!==actor.accountId)throw new DomainError('NOT_FOUND',404);return manager;
  }
  private async runtimeFor(row:ConnectionRow):Promise<ProviderRuntimeConfig>{
    if(row.provider==='ics')throw new DomainError('CONFLICT',409);const runtime=await this.providers.resolve(row.installation_id,row.provider);
    if(runtime.source==='legacy_environment'&&runtime.revision===0&&row.provider_config_revision===0&&row.provider_client_id_hash===null){const bound=await pool.query(`UPDATE calendar_connections SET provider_client_id_hash=$2,updated_at=clock_timestamp() WHERE id=$1 AND provider_config_revision=0 AND provider_client_id_hash IS NULL AND disconnected_at IS NULL RETURNING id`,[row.id,runtime.clientIdHash]);if(!bound.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});row.provider_client_id_hash=runtime.clientIdHash;}
    if(runtime.revision!==row.provider_config_revision||runtime.clientIdHash!==row.provider_client_id_hash)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});return runtime;
  }
  private async assertRuntimeConfig(client:DbClient,installationId:string,runtime:ProviderRuntimeConfig):Promise<void>{
    await client.query('SELECT id FROM installations WHERE id=$1 FOR SHARE',[installationId]);
    const current=(await client.query<{status:string;revision:number;client_id_hash:string|null}>('SELECT status,revision,client_id_hash FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2 FOR SHARE',[installationId,runtime.provider])).rows[0];
    const valid=runtime.source==='legacy_environment'?!current:Boolean(current&&current.status==='active'&&current.revision===runtime.revision&&current.client_id_hash===runtime.clientIdHash);if(!valid)throw new DomainError('CONFLICT',409,{reason:'calendar_provider_configuration_superseded'});
  }
  private async assertPreviewFence(row:ConnectionRow,sourceId:string,sourceRevision:number):Promise<void>{const current=await pool.query(`SELECT 1 FROM calendar_connections connection JOIN calendar_sources source ON source.connection_id=connection.id AND source.id=$2 JOIN memberships membership ON membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id JOIN accounts account ON account.id=connection.owner_account_id AND account.disabled_at IS NULL JOIN integration_connections authority ON authority.id=connection.integration_connection_id AND authority.revoked_at IS NULL WHERE connection.id=$1 AND connection.household_id=$3 AND connection.owner_account_id=$4 AND connection.disconnected_at IS NULL AND connection.state='connected' AND connection.sync_generation=$5 AND source.revision=$6 AND membership.capabilities ? 'household.view' AND person.age_group='adult'`,[row.id,sourceId,row.household_id,row.owner_account_id,row.sync_generation,sourceRevision]);if(!current.rowCount)throw new DomainError('CONFLICT',409,{reason:'calendar_preview_superseded'});}
  private async allPages<T>(fn:(token?:string)=>Promise<CalendarPage<T>>,maxItems=SNAPSHOT_MAX_ITEMS):Promise<{items:T[];pageCount:number;byteCount:number}>{const items:T[]=[];let token:string|undefined,pageCount=0,byteCount=0;const seen=new Set<string>();do{const page=await fn(token);if(!Array.isArray(page.items))throw invalidProviderResponse();pageCount++;byteCount+=page.responseBytes??Buffer.byteLength(JSON.stringify(page.items));if(items.length+page.items.length>maxItems||byteCount>SNAPSHOT_MAX_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});items.push(...page.items);token=page.nextPageToken;if(token){if(pageCount>=100)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});if(typeof token!=='string'||token.length>8192||seen.has(token))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});seen.add(token);}}while(token);return{items,pageCount,byteCount};}
  private async reconcileSource(client:DbClient,connection:ConnectionRow,sourceId:string,events:CalendarEvent[],generation:number){
    const source=(await client.query<any>(`SELECT s.*,COALESCE((SELECT array_agg(person_id ORDER BY person_id) FROM calendar_source_person_subjects WHERE source_id=s.id),'{}'::uuid[]) subject_person_ids,COALESCE((SELECT array_agg(person_id ORDER BY person_id) FROM calendar_source_person_readers WHERE source_id=s.id),'{}'::uuid[]) reader_person_ids,COALESCE((SELECT array_agg(display_id ORDER BY display_id) FROM calendar_source_display_targets WHERE source_id=s.id),'{}'::uuid[]) display_ids FROM calendar_sources s WHERE s.id=$1 AND s.connection_id=$2 AND s.enabled FOR UPDATE`,[sourceId,connection.id])).rows[0];
    if(!source)return;
    const unique=new Map<string,CalendarEvent>();for(const event of events)unique.set(`${event.uid}\n${event.instanceId}`,event);
    for(const event of unique.values()){
      const existing=(await client.query<any>(`SELECT occurrence.* FROM calendar_occurrences occurrence WHERE occurrence.source_id=$1 AND occurrence.event_uid=$2 AND occurrence.instance_id=$3 FOR UPDATE`,[sourceId,event.uid,event.instanceId])).rows[0];
      if(existing?.integration_item_id)existing.item_metadata=(await client.query<{metadata:Record<string,unknown>}>('SELECT metadata FROM integration_items WHERE id=$1 FOR UPDATE',[existing.integration_item_id])).rows[0]?.metadata;
      if(event.cancelled){if(existing?.status==='active')await this.withdrawOccurrence(client,existing);if(existing)await client.query('UPDATE calendar_occurrences SET last_seen_generation=$2,updated_at=clock_timestamp() WHERE id=$1',[existing.id,generation]);continue;}
      const incarnation=existing?.status==='withdrawn'?Number(existing.incarnation)+1:Number(existing?.incarnation??1);
      const externalId=existing?.status==='active'?existing.external_item_id:`cal:${sourceId.slice(0,8)}:${sha(`${event.uid}\n${event.instanceId}`).slice(0,20)}:${incarnation}`;
      const fingerprint=sha(JSON.stringify(event));let itemId=existing?.status==='active'?existing.integration_item_id:null;
      const metadata=calendarItemMetadata(existing?.item_metadata,connection,source,event);
      if(!itemId){
        itemId=(await client.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,publish_at,starts_at,ends_at,expires_at,source,metadata,status,request_hash,content_locale) VALUES($1,$2,$3,'event',$4,$5,$5,'normal',NULL,$6,$7,$8,$9,$10,'active',$11,NULL) RETURNING id`,[connection.household_id,connection.integration_connection_id,externalId,source.target_household,event.title,event.start,event.end,new Date(new Date(event.end??event.start).getTime()+86400_000),JSON.stringify({label:`${connection.name}: ${source.name}`,observedAt:this.now().toISOString(),uncertainty:'low'}),JSON.stringify(metadata),fingerprint])).rows[0]!.id;
      }else if(existing.fingerprint!==fingerprint){
        await client.query(`UPDATE integration_items SET title=$2,body=$2,starts_at=$3,ends_at=$4,expires_at=$5,source=$6,metadata=$7,request_hash=$8,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status='active'`,[itemId,event.title,event.start,event.end,new Date(new Date(event.end??event.start).getTime()+86400_000),JSON.stringify({label:`${connection.name}: ${source.name}`,observedAt:this.now().toISOString(),uncertainty:'low'}),JSON.stringify(metadata),fingerprint]);
      }else if(existing.item_metadata?.calendar?.subjectHousehold!==source.subject_household||existing.item_metadata?.calendar?.bridgeKind!==source.bridge_kind){
        await client.query(`UPDATE integration_items SET metadata=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status='active'`,[itemId,JSON.stringify(metadata)]);
      }
      await client.query('DELETE FROM integration_item_person_subjects WHERE item_id=$1',[itemId]);for(const personId of source.subject_person_ids)await client.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[connection.household_id,itemId,personId]);
      await client.query('DELETE FROM integration_item_person_targets WHERE item_id=$1',[itemId]);for(const personId of source.reader_person_ids)await client.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[connection.household_id,itemId,personId]);
      await client.query('DELETE FROM integration_item_display_targets WHERE item_id=$1',[itemId]);for(const displayId of source.display_ids)await client.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[connection.household_id,itemId,displayId]);
      if(existing)await client.query(`UPDATE calendar_occurrences SET incarnation=$2,integration_item_id=$3,external_item_id=$4,fingerprint=$5,status='active',last_seen_generation=$6,updated_at=clock_timestamp() WHERE id=$1`,[existing.id,incarnation,itemId,externalId,fingerprint,generation]);else await client.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,incarnation,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,[connection.household_id,sourceId,event.uid,event.instanceId,incarnation,itemId,externalId,fingerprint,generation]);
    }
    const missing=await client.query<any>(`SELECT * FROM calendar_occurrences WHERE source_id=$1 AND status='active' AND last_seen_generation<$2 FOR UPDATE`,[sourceId,generation]);for(const occurrence of missing.rows)await this.withdrawOccurrence(client,occurrence);
  }
  private async withdrawOccurrence(client:DbClient,occurrence:any){if(occurrence.integration_item_id)await client.query(`UPDATE integration_items SET status='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status='active'`,[occurrence.integration_item_id]);await client.query(`UPDATE calendar_occurrences SET status='withdrawn',updated_at=clock_timestamp() WHERE id=$1`,[occurrence.id]);}
  private async withdrawAll(client:DbClient,connectionId:string){const rows=await client.query<any>(`SELECT occurrence.* FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE source.connection_id=$1 AND occurrence.status='active' FOR UPDATE OF occurrence`,[connectionId]);for(const row of rows.rows)await this.withdrawOccurrence(client,row);}
  private async audit(client:DbClient,actor:CalendarActor,action:string,subjectId:string,metadata:Record<string,unknown>={}){await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,$4,'calendar_connection',$5,$6)`,[actor.installationId,actor.householdId,actor.accountId,action,subjectId,JSON.stringify(metadata)]);}
}

export async function runCalendarSyncBatch(service=new CalendarService()):Promise<{claimed:number;succeeded:number;failed:number}>{const ids=await pool.query<{id:string}>('SELECT id FROM calendar_connections WHERE state IN (\'connected\',\'error\',\'syncing\') AND next_sync_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) ORDER BY next_sync_at,id LIMIT 5');let succeeded=0,failed=0;for(const row of ids.rows)try{await service.syncConnection(row.id);succeeded++;}catch{failed++;}return{claimed:ids.rowCount??0,succeeded,failed};}
