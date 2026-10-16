import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { DomainError } from '@samvev/core';
import { createPinnedLookup, type PinnedAddress } from '../pinned-lookup.ts';
import { normalizeHomeAssistantOrigin, type ProviderRuntimeConfig } from './provider-config.ts';

const MAX_RESPONSE_BYTES=2*1024*1024;
const TIMEOUT_MS=15_000;
const MAX_CALENDAR_EVENTS=500;
type JsonObject=Record<string,any>;
type AddressLookup=(hostname:string)=>Promise<Array<{address:string;family:number}>>;
const defaultAddressLookup:AddressLookup=(hostname)=>lookup(hostname,{all:true,verbatim:true}) as Promise<Array<{address:string;family:number}>>;

async function pinned(origin:string,addressLookup:AddressLookup=defaultAddressLookup):Promise<PinnedAddress>{
  const url=new URL(normalizeHomeAssistantOrigin(origin)),hostname=url.hostname.replace(/^\[|\]$/g,'');
  const family=isIP(hostname);if(family)return{address:hostname,family:family as 4|6};
  let rows:Array<{address:string;family:number}>;try{rows=await addressLookup(hostname);}catch{throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'});}
  const first=rows[0];if(!first||(first.family!==4&&first.family!==6))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'});
  return{address:first.address,family:first.family};
}

function allowedRequest(method:'GET'|'POST',path:string):boolean{
  if(method==='POST')return path==='/auth/token'||path==='/auth/revoke';
  return path==='/api/calendars'||/^\/api\/calendars\/[a-z0-9_.-]+(?:\?.*)?$/.test(path)||/^\/api\/states\/(?:calendar|sensor|light|cover)\.[a-z0-9_]+$/.test(path);
}

async function request(origin:string,path:string,input:{method:'GET'|'POST';token?:string;form?:URLSearchParams;json?:unknown;maxBytes?:number},timeoutMs=TIMEOUT_MS,addressLookup:AddressLookup=defaultAddressLookup):Promise<{status:number;body:Buffer;contentType:string}>{
  const deadlineAt=Date.now()+timeoutMs;
  if(!allowedRequest(input.method,path))throw new DomainError('AI_ENDPOINT_BLOCKED',422,{reason:'home_assistant_path_blocked'});
  const base=new URL(normalizeHomeAssistantOrigin(origin)),url=new URL(path,base);if(url.origin!==base.origin)throw new DomainError('AI_ENDPOINT_BLOCKED',422,{reason:'home_assistant_origin_mismatch'});
  const target=await new Promise<PinnedAddress>((resolve,reject)=>{const timer=setTimeout(()=>reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'})),Math.max(1,deadlineAt-Date.now()));pinned(base.origin,addressLookup).then((value)=>{clearTimeout(timer);resolve(value);},(error)=>{clearTimeout(timer);reject(error);});});
  const body=input.form?Buffer.from(input.form.toString()):input.json===undefined?undefined:Buffer.from(JSON.stringify(input.json));
  return new Promise((resolve,reject)=>{
    const fn=url.protocol==='https:'?httpsRequest:httpRequest;
    const headers:Record<string,string>={accept:'application/json','user-agent':'Samvev-Calendar/1.0'};
    if(input.token)headers.authorization=`Bearer ${input.token}`;
    if(body){headers['content-type']=input.form?'application/x-www-form-urlencoded':'application/json';headers['content-length']=String(body.length);}
    const remaining=deadlineAt-Date.now();if(remaining<=0)return reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'}));
    const options:RequestOptions={method:input.method,headers,lookup:createPinnedLookup(target),signal:AbortSignal.timeout(remaining)};
    const req=fn(url,options,(res)=>{const chunks:Buffer[]=[];let bytes=0,max=input.maxBytes??MAX_RESPONSE_BYTES;res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>max)res.destroy(new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'home_assistant_response_too_large'}));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{const status=res.statusCode??502;if(status>=300&&status<400)return reject(new DomainError('AI_ENDPOINT_BLOCKED',422,{reason:'home_assistant_redirect_blocked'}));resolve({status,body:Buffer.concat(chunks),contentType:String(res.headers['content-type']??'')});});});
    req.on('error',(error)=>reject(error instanceof DomainError?error:new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'})));if(body)req.write(body);req.end();
  });
}

function json(response:{status:number;body:Buffer;contentType:string},context:'auth'|'resource'):JsonObject|JsonObject[]{
  let value:unknown;try{value=JSON.parse(response.body.toString('utf8'));}catch{throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});}
  if(response.status<200||response.status>=300){
    if((context==='auth'&&(response.status===400||response.status===401||response.status===403))||(context==='resource'&&response.status===401))throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
    if(context==='resource'&&response.status===403)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_permission_denied'});
    throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable',httpStatus:response.status});
  }
  if(!value||typeof value!=='object')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});return value as JsonObject|JsonObject[];
}

function websocketFrame(payload:string|Buffer,opcode=0x1):Buffer{
  const body=Buffer.isBuffer(payload)?payload:Buffer.from(payload),mask=randomBytes(4);let header:Buffer;
  if(body.length<126){header=Buffer.from([0x80|opcode,0x80|body.length]);}
  else if(body.length<=0xffff){header=Buffer.alloc(4);header[0]=0x81;header[1]=0x80|126;header.writeUInt16BE(body.length,2);}
  else {header=Buffer.alloc(10);header[0]=0x81;header[1]=0x80|127;header.writeBigUInt64BE(BigInt(body.length),2);}
  const masked=Buffer.alloc(body.length);for(let index=0;index<body.length;index++)masked[index]=body[index]!^mask[index%4]!;return Buffer.concat([header,mask,masked]);
}

class WebSocketReader{
  private buffer=Buffer.alloc(0);private waiters:Array<()=>void>=[];private error:unknown;
  constructor(private readonly socket:Socket|TLSSocket,private readonly deadline:{epochMs:number;monotonicMs:number},private readonly control:boolean){socket.on('data',(chunk:Buffer)=>{if(this.buffer.length+chunk.length>MAX_RESPONSE_BYTES+16){this.error=new Error('buffer');socket.destroy();}else this.buffer=Buffer.concat([this.buffer,chunk]);this.wake();});socket.on('error',(error)=>{this.error=error;this.wake();});socket.on('close',()=>{this.error??=new Error('closed');this.wake();});}
  private wake(){for(const waiter of this.waiters.splice(0))waiter();}
  private async need(bytes:number):Promise<void>{while(this.buffer.length<bytes){if(this.error)throw this.error;const remaining=Math.min(this.deadline.epochMs-Date.now(),this.deadline.monotonicMs-performance.now());if(remaining<=0){this.socket.destroy();throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:this.control?'home_assistant_control_dispatch_expired':'home_assistant_unavailable'});}await new Promise<void>((resolve,reject)=>{const waiter=()=>{clearTimeout(timeout);resolve();};const timeout=setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0)this.waiters.splice(index,1);this.socket.destroy();reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:this.control?'home_assistant_control_dispatch_expired':'home_assistant_unavailable'}));},remaining);this.waiters.push(waiter);});}}
  async bytes(count:number):Promise<Buffer>{await this.need(count);const value=this.buffer.subarray(0,count);this.buffer=this.buffer.subarray(count);return value;}
  async message():Promise<JsonObject>{
    const first=await this.bytes(2),opcode=first[0]!&0x0f,masked=Boolean(first[1]!&0x80),final=Boolean(first[0]!&0x80);let length=first[1]!&0x7f;
    if(length===126)length=(await this.bytes(2)).readUInt16BE(0);else if(length===127){const wide=(await this.bytes(8)).readBigUInt64BE(0);if(wide>BigInt(MAX_RESPONSE_BYTES))throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);length=Number(wide);}
    if(masked||!final||length>MAX_RESPONSE_BYTES)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    if(opcode===0x8)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_closed'});
    if(opcode===0x9){const ping=await this.bytes(length);this.socket.write(websocketFrame(ping,0x0a));return this.message();}
    if(opcode!==0x1)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    let result:unknown;try{result=JSON.parse((await this.bytes(length)).toString('utf8'));}catch{throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});}
    if(!result||typeof result!=='object'||Array.isArray(result))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});return result as JsonObject;
  }
}

async function websocketCommands(origin:string,accessToken:string,commands:Array<{id:number;type:string;[key:string]:unknown}>,timeoutMs=TIMEOUT_MS,addressLookup:AddressLookup=defaultAddressLookup,absoluteDeadline?:HomeAssistantControlDeadline):Promise<JsonObject[]>{
  const deadline=absoluteDeadline??{epochMs:Date.now()+timeoutMs,monotonicMs:performance.now()+timeoutMs},remainingMs=()=>Math.min(deadline.epochMs-Date.now(),deadline.monotonicMs-performance.now());
  const url=new URL(normalizeHomeAssistantOrigin(origin));
  const target=await new Promise<PinnedAddress>((resolve,reject)=>{const remaining=remainingMs();if(remaining<=0)return reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:absoluteDeadline?'home_assistant_control_dispatch_expired':'home_assistant_unavailable'}));const timer=setTimeout(()=>reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:absoluteDeadline?'home_assistant_control_dispatch_expired':'home_assistant_unavailable'})),remaining);pinned(url.origin,addressLookup).then((value)=>{clearTimeout(timer);resolve(value);},(error)=>{clearTimeout(timer);reject(error);});});
  const port=Number(url.port||((url.protocol==='https:')?443:80));
  const socket:Socket|TLSSocket=await new Promise((resolve,reject)=>{let candidate:Socket|TLSSocket;const timer=setTimeout(()=>candidate.destroy(new Error('timeout')),Math.max(1,remainingMs()));if(url.protocol==='https:'){candidate=tlsConnect({host:target.address,port,servername:isIP(url.hostname)?undefined:url.hostname,rejectUnauthorized:true});candidate.once('secureConnect',()=>{clearTimeout(timer);resolve(candidate);});}else{candidate=netConnect({host:target.address,port});candidate.once('connect',()=>{clearTimeout(timer);resolve(candidate);});}candidate.once('error',(error)=>{clearTimeout(timer);reject(error);});});
  const deadlineTimer=setTimeout(()=>socket.destroy(new Error('timeout')),Math.max(1,remainingMs()));
  try{
    const key=randomBytes(16).toString('base64'),host=url.port?`${url.hostname}:${url.port}`:url.hostname;
    socket.write(`GET /api/websocket HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let head=Buffer.alloc(0);while(!head.includes('\r\n\r\n')){if(remainingMs()<=0)throw new Error('timeout');head=Buffer.concat([head,await new Promise<Buffer>((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);})]);if(head.length>16_384)throw new Error('headers');}
    const marker=head.indexOf('\r\n\r\n'),headers=head.subarray(0,marker).toString('latin1'),rest=head.subarray(marker+4);
    const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    if(!/^HTTP\/1\.1 101 /i.test(headers)||!new RegExp(`^Sec-WebSocket-Accept: ${accept.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'mi').test(headers))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    const reader=new WebSocketReader(socket,deadline,Boolean(absoluteDeadline));if(rest.length)socket.unshift(rest);
    const required=await reader.message();if(required.type!=='auth_required')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    socket.write(websocketFrame(JSON.stringify({type:'auth',access_token:accessToken})));const auth=await reader.message();if(auth.type==='auth_invalid')throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});if(auth.type!=='auth_ok')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    const results:JsonObject[]=[];for(const command of commands){if(remainingMs()<=0)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:absoluteDeadline?'home_assistant_control_dispatch_expired':'home_assistant_unavailable'});socket.write(websocketFrame(JSON.stringify(command)));const response=await reader.message();if(response.id!==command.id||response.type!=='result'||response.success!==true)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_command_failed'});results.push(response.result as JsonObject);}
    return results;
  }finally{clearTimeout(deadlineTimer);socket.destroy();}
}

export interface HomeAssistantSource{externalId:string;name:string;provenance:Record<string,unknown>;sourceWarning?:string;}
export interface HomeAssistantTemperatureCandidate{externalId:string;entityId:string;identityKind:'registry'|'entity';name:string;nativeUnit?:string;provenance:Record<string,unknown>;}
export interface HomeAssistantTemperatureObservation{value:number|null;unit:string|null;status:'current'|'unavailable';lastReportedAt:string|null;lastUpdatedAt:string|null;fetchedAt:string;reason?:'unavailable'|'unknown'|'invalid_value'|'invalid_unit'|'invalid_type';}
export type HomeAssistantControlAction='light.turn_on'|'light.turn_off'|'cover.open_cover';
export type HomeAssistantControlDeadline={epochMs:number;monotonicMs:number};
export interface HomeAssistantControlEntity{registryId:string;entityId:string;deviceRegistryId:string|null;domain:'light'|'cover';name:string;supportedActions:HomeAssistantControlAction[];state:string|null;stateStatus:'current'|'unknown'|'unavailable';lastChangedAt:string|null;}
export interface HomeAssistantControlState{state:string|null;stateStatus:'current'|'unknown'|'unavailable';lastChangedAt:string|null;supportedActions:HomeAssistantControlAction[];}

function controlState(value:unknown):{state:string|null;stateStatus:'current'|'unknown'|'unavailable';lastChangedAt:string|null}{
  if(!value||typeof value!=='object'||Array.isArray(value))return{state:null,stateStatus:'unknown',lastChangedAt:null};
  const row=value as JsonObject,state=typeof row.state==='string'&&row.state.length<=64?row.state:null;
  return{state,stateStatus:state==='unknown'?'unknown':state==='unavailable'||state===null?'unavailable':'current',lastChangedAt:validHomeAssistantInstant(row.last_changed)};
}

function validRfc3339Instant(value:string):boolean{
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]),second=Number(match[6]),offsetHour=Number(match[8]??0),offsetMinute=Number(match[9]??0),civil=new Date(Date.UTC(year,month-1,day));
  return civil.getUTCFullYear()===year&&civil.getUTCMonth()===month-1&&civil.getUTCDate()===day&&hour<=23&&minute<=59&&second<=59&&offsetHour<=23&&offsetMinute<=59&&Number.isFinite(new Date(value).getTime());
}
function validHomeAssistantInstant(value:unknown):string|null{
  return typeof value==='string'&&value.length<=100&&validRfc3339Instant(value)?value:null;
}

export function parseHomeAssistantCalendarEvents(value:unknown,entityId:string){
  if(!Array.isArray(value)||value.length>MAX_CALENDAR_EVENTS)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});
  const invalid=()=>new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_calendar_event_invalid',entityId});
  const civil=(text:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;const [year,month,day]=text.split('-').map(Number),date=new Date(Date.UTC(year!,month!-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month!-1&&date.getUTCDate()===day;};
  const dateValue=(item:unknown):{value:string;allDay:boolean}|undefined=>{if(!item||typeof item!=='object'||Array.isArray(item))return undefined;const row=item as Record<string,unknown>,hasDate=typeof row.date==='string',hasDateTime=typeof row.dateTime==='string';if(hasDate===hasDateTime)return undefined;if(hasDate){const text=row.date as string;return civil(text)?{value:text,allDay:true}:undefined;}const text=row.dateTime as string;if(text.length>100||!validRfc3339Instant(text))return undefined;return{value:text,allDay:false};};
  const duplicateOrdinals=new Map<string,number>();
  return value.map((event:any)=>{const summary=typeof event?.summary==='string'?event.summary.slice(0,2048):'Untitled event',start=dateValue(event?.start),hasEnd=event?.end!==undefined&&event?.end!==null,end=hasEnd?dateValue(event.end):undefined;if(!start||hasEnd&&!end||end&&end.allDay!==start.allDay)throw invalid();if(end&&(start.allDay?end.value<=start.value:new Date(end.value).getTime()<=new Date(start.value).getTime()))throw invalid();const status=['cancelled','tentative','confirmed','declined','unanswered'].includes(event?.status)?event.status as 'cancelled'|'tentative'|'confirmed'|'declined'|'unanswered':undefined;const location=typeof event?.location==='string'?event.location.slice(0,1024):undefined;const providerUid=typeof event?.uid==='string'&&event.uid.length>0&&event.uid.length<=2048?event.uid:undefined;const exact=createHash('sha256').update(JSON.stringify({summary,start:start.value,end:end?.value??null,status:status??null,location:location??null})).digest('hex');const ordinal=(duplicateOrdinals.get(exact)??0)+1;duplicateOrdinals.set(exact,ordinal);return{uid:providerUid??`local:${exact}:${ordinal}`,instanceId:providerUid&&typeof event?.recurrence_id==='string'&&event.recurrence_id?event.recurrence_id:'single',identityKind:providerUid?'provider' as const:'local_snapshot' as const,title:summary,start:start.value,end:end?.value??null,allDay:start.allDay,cancelled:status==='cancelled',...(status?{status}:{}),location};});
}

export class HomeAssistantClient{
  constructor(private readonly websocketTimeoutMs=TIMEOUT_MS,private readonly requestTimeoutMs=TIMEOUT_MS,private readonly addressLookup:AddressLookup=defaultAddressLookup){}
  authorizationUrl(config:ProviderRuntimeConfig,redirectUri:string,state:string):string{
    const url=new URL('/auth/authorize',config.origin);url.searchParams.set('client_id',config.clientId);url.searchParams.set('redirect_uri',redirectUri);url.searchParams.set('state',state);return url.toString();
  }
  async exchangeCode(config:ProviderRuntimeConfig,input:{code:string;redirectUri:string}){
    const response=await request(config.origin!,'/auth/token',{method:'POST',form:new URLSearchParams({grant_type:'authorization_code',code:input.code,client_id:config.clientId,redirect_uri:input.redirectUri}),maxBytes:256*1024},this.requestTimeoutMs,this.addressLookup);const data=json(response,'auth') as JsonObject;
    const accessToken=typeof data.access_token==='string'&&data.access_token.length<=32_000?data.access_token:'';const refreshToken=typeof data.refresh_token==='string'&&data.refresh_token.length<=32_000?data.refresh_token:'';const expiresIn=Number(data.expires_in);
    if(!accessToken||!refreshToken||!Number.isFinite(expiresIn)||expiresIn<=0||expiresIn>31_536_000)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});
    const [identity]=await websocketCommands(config.origin!,accessToken,[{id:1,type:'auth/current_user'}],this.websocketTimeoutMs,this.addressLookup);const subject=typeof identity?.id==='string'?identity.id:'';if(!subject||subject.length>512)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_identity_invalid'});
    return{accessToken,refreshToken,expiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),scopes:['home_assistant_instance_token'],providerSubject:subject,accountLabel:typeof identity?.name==='string'?identity.name.slice(0,254):undefined};
  }
  async refresh(config:ProviderRuntimeConfig,refreshToken:string){
    const response=await request(config.origin!,'/auth/token',{method:'POST',form:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,client_id:config.clientId}),maxBytes:256*1024},this.requestTimeoutMs,this.addressLookup);const data=json(response,'auth') as JsonObject;
    const accessToken=typeof data.access_token==='string'&&data.access_token.length<=32_000?data.access_token:'';const expiresIn=Number(data.expires_in);if(!accessToken||!Number.isFinite(expiresIn)||expiresIn<=0||expiresIn>31_536_000)throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});
    return{accessToken,refreshToken,expiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),scopes:['home_assistant_instance_token'],providerSubject:'retained'};
  }
  async revoke(config:ProviderRuntimeConfig,token:string):Promise<'confirmed'>{const response=await request(config.origin!,'/auth/revoke',{method:'POST',form:new URLSearchParams({token}),maxBytes:64*1024},this.requestTimeoutMs,this.addressLookup);if(response.status<200||response.status>=300)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'});return'confirmed';}
  async listSources(config:ProviderRuntimeConfig,accessToken:string):Promise<HomeAssistantSource[]>{
    const [registry]=await websocketCommands(config.origin!,accessToken,[{id:1,type:'config/entity_registry/list'}],this.websocketTimeoutMs,this.addressLookup);if(!Array.isArray(registry))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_registry_invalid'});
    const registered=new Map<string,JsonObject>();for(const entry of registry){if(entry&&typeof entry==='object'&&typeof entry.id==='string'&&entry.id.length<=512&&typeof entry.entity_id==='string'&&/^calendar\.[a-z0-9_]+$/.test(entry.entity_id))registered.set(entry.entity_id,entry);}
    const response=await request(config.origin!,'/api/calendars',{method:'GET',token:accessToken},this.requestTimeoutMs,this.addressLookup);const calendars=json(response,'resource');if(!Array.isArray(calendars)||calendars.length>500)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});
    return calendars.flatMap((calendar:any)=>{const entityId=typeof calendar?.entity_id==='string'&&/^calendar\.[a-z0-9_]+$/.test(calendar.entity_id)?calendar.entity_id:'';if(!entityId)return[];const entry=registered.get(entityId),isSpond=entry?.platform==='spond_tracker',name=typeof calendar.name==='string'?calendar.name:entityId;return[{externalId:entry?String(entry.id):`entity:${entityId}`,name:name.slice(0,200),provenance:{integrationDomain:isSpond?'spond_tracker':'home_assistant',entityId,platform:'calendar',identityKind:entry?'registry':'entity',registryId:entry?String(entry.id):null,configEntryId:typeof entry?.config_entry_id==='string'?entry.config_entry_id:null,...(isSpond?{validatedContractVersion:'0.12.2',referenceCommit:'0d8efdd'}:{})},...(isSpond?{sourceWarning:'home_assistant_spond_bounded_cache_status_and_first_name_identity_limitations'}:entry?{}:{sourceWarning:'home_assistant_entity_id_identity_rename_not_guaranteed'})}];});
  }
  async listTemperatureSensors(config:ProviderRuntimeConfig,accessToken:string):Promise<HomeAssistantTemperatureCandidate[]>{
    const [registry]=await websocketCommands(config.origin!,accessToken,[{id:1,type:'config/entity_registry/list'}],this.websocketTimeoutMs,this.addressLookup);if(!Array.isArray(registry)||registry.length>20_000)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_registry_invalid'});
    const candidates=registry.filter((entry:any)=>!entry?.disabled_by&&typeof entry?.entity_id==='string'&&/^sensor\.[a-z0-9_]+$/.test(entry.entity_id));if(candidates.length>2000)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'home_assistant_sensor_registry_too_large'});
    return candidates.map((entry:any)=>{const entityId=entry.entity_id as string,registryId=typeof entry.id==='string'&&entry.id.length<=512?entry.id:undefined,name=typeof entry.name==='string'&&entry.name?entry.name:typeof entry.original_name==='string'&&entry.original_name?entry.original_name:entityId,nativeUnit=typeof entry.unit_of_measurement==='string'?entry.unit_of_measurement:undefined,deviceClass=entry.device_class??entry.original_device_class;return{externalId:registryId??`entity:${entityId}`,entityId,identityKind:registryId?'registry':'entity',name:name.slice(0,200),...(nativeUnit?{nativeUnit:nativeUnit.slice(0,24)}:{}),provenance:{integrationDomain:'home_assistant',platform:'sensor',registryId:registryId??null,entityId,deviceClass:typeof deviceClass==='string'?deviceClass:null,requiresTargetedTemperatureValidation:true}};});
  }
  async listEvents(config:ProviderRuntimeConfig,accessToken:string,sourceIdentity:string,window:{from:string;to:string}){
    if(!sourceIdentity||sourceIdentity.length>512)throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_calendar_identity_invalid'});
    const [registry]=await websocketCommands(config.origin!,accessToken,[{id:1,type:'config/entity_registry/list'}],this.websocketTimeoutMs,this.addressLookup);if(!Array.isArray(registry))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_registry_invalid'});
    const entry=sourceIdentity.startsWith('entity:')?undefined:registry.find((candidate:any)=>candidate&&candidate.id===sourceIdentity);
    const fallback=sourceIdentity.startsWith('entity:')?sourceIdentity.slice(7):'';
    const entityId=typeof entry?.entity_id==='string'&&/^calendar\.[a-z0-9_]+$/.test(entry.entity_id)?entry.entity_id:/^calendar\.[a-z0-9_]+$/.test(fallback)?fallback:'';
    if(!entityId)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_calendar_source_unavailable'});
    const health=json(await request(config.origin!,`/api/states/${entityId}`,{method:'GET',token:accessToken},this.requestTimeoutMs,this.addressLookup),'resource') as JsonObject;if(health.entity_id!==entityId)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});if(!['on','off'].includes(String(health.state)))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_calendar_source_stale',sourceKind:entry?.platform==='spond_tracker'?'spond':'calendar'});
    const path=`/api/calendars/${entityId}?start=${encodeURIComponent(window.from)}&end=${encodeURIComponent(window.to)}`;const response=await request(config.origin!,path,{method:'GET',token:accessToken},this.requestTimeoutMs,this.addressLookup);return parseHomeAssistantCalendarEvents(json(response,'resource'),entityId);
  }
  async readTemperatureSensor(config:ProviderRuntimeConfig,accessToken:string,entityId:string):Promise<HomeAssistantTemperatureObservation>{
    if(!/^sensor\.[a-z0-9_]+$/.test(entityId))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_sensor_identity_invalid'});const fetchedAt=new Date().toISOString();const state=json(await request(config.origin!,`/api/states/${entityId}`,{method:'GET',token:accessToken},this.requestTimeoutMs,this.addressLookup),'resource') as JsonObject;if(state.entity_id!==entityId)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});const lastReportedAt=validHomeAssistantInstant(state.last_reported),lastUpdatedAt=validHomeAssistantInstant(state.last_updated);
    if(state.state==='unavailable'||state.state==='unknown')return{value:null,unit:null,status:'unavailable',lastReportedAt,lastUpdatedAt,fetchedAt,reason:state.state};if(state.attributes?.device_class!=='temperature')return{value:null,unit:null,status:'unavailable',lastReportedAt,lastUpdatedAt,fetchedAt,reason:'invalid_type'};
    const rawUnit=typeof state.attributes?.unit_of_measurement==='string'?state.attributes.unit_of_measurement:'';const unit=rawUnit==='C'||rawUnit==='°C'?'°C':rawUnit==='F'||rawUnit==='°F'?'°F':null;if(!unit)return{value:null,unit:null,status:'unavailable',lastReportedAt,lastUpdatedAt,fetchedAt,reason:'invalid_unit'};const rawValue=state.state,value=typeof rawValue==='number'?rawValue:typeof rawValue==='string'&&rawValue.trim().length?Number(rawValue):Number.NaN;const valid=Number.isFinite(value)&&(unit==='°C'?value>=-150&&value<=300:value>=-238&&value<=572);if(!valid)return{value:null,unit,status:'unavailable',lastReportedAt,lastUpdatedAt,fetchedAt,reason:'invalid_value'};return{value,unit,status:'current',lastReportedAt,lastUpdatedAt,fetchedAt};
  }
}

// Narrow wire helpers are shared with the separate control client. Calendar
// synchronization itself has no service-call method and remains read-only.
export async function listHomeAssistantControlRegistry(config:ProviderRuntimeConfig,accessToken:string):Promise<HomeAssistantControlEntity[]>{
  const [registry]=await websocketCommands(config.origin!,accessToken,[{id:1,type:'config/entity_registry/list'}]);
  if(!Array.isArray(registry)||registry.length>20_000)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_registry_invalid'});
  const result:HomeAssistantControlEntity[]=[];
  for(const entry of registry){
    if(!entry||typeof entry!=='object'||entry.disabled_by||typeof entry.id!=='string'||entry.id.length<1||entry.id.length>512||typeof entry.entity_id!=='string')continue;
    const match=/^(light|cover)\.[a-z0-9_]+$/.exec(entry.entity_id);if(!match)continue;
    const domain=match[1] as 'light'|'cover',deviceRegistryId=typeof entry.device_id==='string'&&entry.device_id.length<=512?entry.device_id:null;
    const name=typeof entry.name==='string'&&entry.name?entry.name:typeof entry.original_name==='string'&&entry.original_name?entry.original_name:entry.entity_id;
    result.push({registryId:entry.id,entityId:entry.entity_id,deviceRegistryId,domain,name:name.slice(0,200),supportedActions:[],state:null,stateStatus:'unknown',lastChangedAt:null});
    if(result.length>1000)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'home_assistant_control_registry_too_large'});
  }
  return result;
}

export async function readHomeAssistantControlState(config:ProviderRuntimeConfig,accessToken:string,entityId:string):Promise<HomeAssistantControlState>{
  if(!/^(light|cover)\.[a-z0-9_]+$/.test(entityId))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_entity_invalid'});
  const state=json(await request(config.origin!,`/api/states/${entityId}`,{method:'GET',token:accessToken}),'resource') as JsonObject;
  if(state.entity_id!==entityId)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});
  const snapshot=controlState(state),attrs=state.attributes&&typeof state.attributes==='object'&&!Array.isArray(state.attributes)?state.attributes as JsonObject:{};
  const supportedActions:HomeAssistantControlAction[]=snapshot.stateStatus!=='current'?[]:entityId.startsWith('light.')?['light.turn_on','light.turn_off']:(Number(attrs.supported_features)&1)===1?['cover.open_cover']:[];
  return{...snapshot,supportedActions};
}

export async function issueHomeAssistantControlService(config:ProviderRuntimeConfig,accessToken:string,entityId:string,action:HomeAssistantControlAction,deadline:HomeAssistantControlDeadline):Promise<void>{
  if(!/^(light|cover)\.[a-z0-9_]+$/.test(entityId))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_entity_invalid'});
  const mapping:Record<HomeAssistantControlAction,{domain:'light'|'cover';service:'turn_on'|'turn_off'|'open_cover'}>={
    'light.turn_on':{domain:'light',service:'turn_on'},'light.turn_off':{domain:'light',service:'turn_off'},'cover.open_cover':{domain:'cover',service:'open_cover'}
  };
  const spec=mapping[action];if(!spec||(entityId.startsWith('light.')&&spec.domain!=='light')||(entityId.startsWith('cover.')&&spec.domain!=='cover'))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_action_invalid'});
  // Service responses and changed_states are deliberately discarded.
  await websocketCommands(config.origin!,accessToken,[{id:1,type:'call_service',domain:spec.domain,service:spec.service,service_data:{entity_id:entityId}}],TIMEOUT_MS,defaultAddressLookup,deadline);
}
