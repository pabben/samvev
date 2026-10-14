import { createHash, randomBytes } from 'node:crypto';
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
  return path==='/api/calendars'||/^\/api\/calendars\/[a-z0-9_.-]+(?:\?.*)?$/.test(path);
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
  constructor(private readonly socket:Socket|TLSSocket,private readonly deadlineAt:number){socket.on('data',(chunk:Buffer)=>{if(this.buffer.length+chunk.length>MAX_RESPONSE_BYTES+16){this.error=new Error('buffer');socket.destroy();}else this.buffer=Buffer.concat([this.buffer,chunk]);this.wake();});socket.on('error',(error)=>{this.error=error;this.wake();});socket.on('close',()=>{this.error??=new Error('closed');this.wake();});}
  private wake(){for(const waiter of this.waiters.splice(0))waiter();}
  private async need(bytes:number):Promise<void>{while(this.buffer.length<bytes){if(this.error)throw this.error;const remaining=this.deadlineAt-Date.now();if(remaining<=0){this.socket.destroy();throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'});}await new Promise<void>((resolve,reject)=>{const waiter=()=>{clearTimeout(timeout);resolve();};const timeout=setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0)this.waiters.splice(index,1);this.socket.destroy();reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'}));},remaining);this.waiters.push(waiter);});}}
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

async function websocketCommands(origin:string,accessToken:string,commands:Array<{id:number;type:string}>,timeoutMs=TIMEOUT_MS,addressLookup:AddressLookup=defaultAddressLookup):Promise<JsonObject[]>{
  const deadlineAt=Date.now()+timeoutMs;
  const url=new URL(normalizeHomeAssistantOrigin(origin));
  const target=await new Promise<PinnedAddress>((resolve,reject)=>{const remaining=deadlineAt-Date.now();if(remaining<=0)return reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'}));const timer=setTimeout(()=>reject(new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_unavailable'})),remaining);pinned(url.origin,addressLookup).then((value)=>{clearTimeout(timer);resolve(value);},(error)=>{clearTimeout(timer);reject(error);});});
  const port=Number(url.port||((url.protocol==='https:')?443:80));
  const socket:Socket|TLSSocket=await new Promise((resolve,reject)=>{let candidate:Socket|TLSSocket;const timer=setTimeout(()=>candidate.destroy(new Error('timeout')),Math.max(1,deadlineAt-Date.now()));if(url.protocol==='https:'){candidate=tlsConnect({host:target.address,port,servername:isIP(url.hostname)?undefined:url.hostname,rejectUnauthorized:true});candidate.once('secureConnect',()=>{clearTimeout(timer);resolve(candidate);});}else{candidate=netConnect({host:target.address,port});candidate.once('connect',()=>{clearTimeout(timer);resolve(candidate);});}candidate.once('error',(error)=>{clearTimeout(timer);reject(error);});});
  const deadlineTimer=setTimeout(()=>socket.destroy(new Error('timeout')),Math.max(1,deadlineAt-Date.now()));
  try{
    const key=randomBytes(16).toString('base64'),host=url.port?`${url.hostname}:${url.port}`:url.hostname;
    socket.write(`GET /api/websocket HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let head=Buffer.alloc(0);while(!head.includes('\r\n\r\n')){if(Date.now()>=deadlineAt)throw new Error('timeout');head=Buffer.concat([head,await new Promise<Buffer>((resolve,reject)=>{socket.once('data',resolve);socket.once('error',reject);})]);if(head.length>16_384)throw new Error('headers');}
    const marker=head.indexOf('\r\n\r\n'),headers=head.subarray(0,marker).toString('latin1'),rest=head.subarray(marker+4);
    const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    if(!/^HTTP\/1\.1 101 /i.test(headers)||!new RegExp(`^Sec-WebSocket-Accept: ${accept.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'mi').test(headers))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    const reader=new WebSocketReader(socket,deadlineAt);if(rest.length)socket.unshift(rest);
    const required=await reader.message();if(required.type!=='auth_required')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    socket.write(websocketFrame(JSON.stringify({type:'auth',access_token:accessToken})));const auth=await reader.message();if(auth.type==='auth_invalid')throw new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required'});if(auth.type!=='auth_ok')throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_websocket_invalid'});
    const results:JsonObject[]=[];for(const command of commands){socket.write(websocketFrame(JSON.stringify(command)));const response=await reader.message();if(response.id!==command.id||response.type!=='result'||response.success!==true)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_command_failed'});results.push(response.result as JsonObject);}
    return results;
  }finally{clearTimeout(deadlineTimer);socket.destroy();}
}

export interface HomeAssistantSource{externalId:string;name:string;provenance:Record<string,unknown>;sourceWarning:string;}

export function parseHomeAssistantCalendarEvents(value:unknown,entityId:string){
  if(!Array.isArray(value)||value.length>MAX_CALENDAR_EVENTS)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413,{reason:'calendar_snapshot_too_large'});
  const dateValue=(item:unknown):{value:string;allDay:boolean}|undefined=>{if(!item||typeof item!=='object'||Array.isArray(item))return undefined;const row=item as Record<string,unknown>;if(typeof row.dateTime==='string'&&row.dateTime.length<=100)return{value:row.dateTime,allDay:false};if(typeof row.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.date))return{value:row.date,allDay:true};return undefined;};
  return value.map((event:any)=>{const summary=typeof event?.summary==='string'?event.summary:'Untitled event',start=dateValue(event?.start),end=dateValue(event?.end),uid=typeof event?.uid==='string'&&event.uid.length>0&&event.uid.length<=2048?event.uid:'';if(!start||!uid)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_calendar_identity_missing',entityId});const status=event?.status==='cancelled'||event?.status==='tentative'||event?.status==='confirmed'?event.status:undefined;return{uid,instanceId:typeof event?.recurrence_id==='string'&&event.recurrence_id?event.recurrence_id:'single',title:summary,start:start.value,end:end?.value??null,allDay:start.allDay,cancelled:status==='cancelled',...(status?{status}:{}),location:typeof event?.location==='string'?event.location:undefined};});
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
    const spond=new Map<string,JsonObject>();for(const entry of registry){if(entry&&typeof entry==='object'&&entry.platform==='spond_tracker'&&typeof entry.id==='string'&&entry.id.length<=512&&typeof entry.entity_id==='string'&&/^calendar\.[a-z0-9_]+$/.test(entry.entity_id))spond.set(entry.entity_id,entry);}
    const response=await request(config.origin!,'/api/calendars',{method:'GET',token:accessToken},this.requestTimeoutMs,this.addressLookup);const calendars=json(response,'resource');if(!Array.isArray(calendars)||calendars.length>500)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_response_invalid'});
    return calendars.flatMap((calendar:any)=>{const entityId=typeof calendar?.entity_id==='string'?calendar.entity_id:'',entry=spond.get(entityId);if(!entry)return[];const name=typeof calendar.name==='string'?calendar.name:entityId;return[{externalId:String(entry.id),name:name.slice(0,200),provenance:{integrationDomain:'spond_tracker',entityId,platform:'calendar',registryId:String(entry.id),configEntryId:typeof entry.config_entry_id==='string'?entry.config_entry_id:null,validatedContractVersion:'0.12.2',referenceCommit:'0d8efdd'},sourceWarning:'home_assistant_spond_bounded_cache_status_and_first_name_identity_limitations'}];});
  }
  async listEvents(config:ProviderRuntimeConfig,accessToken:string,registryId:string,window:{from:string;to:string}){
    if(!registryId||registryId.length>512)throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_registry_identity_invalid'});
    const [registry]=await websocketCommands(config.origin!,accessToken,[{id:1,type:'config/entity_registry/list'}],this.websocketTimeoutMs,this.addressLookup);if(!Array.isArray(registry))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_registry_invalid'});
    const entry=registry.find((candidate:any)=>candidate&&candidate.id===registryId&&candidate.platform==='spond_tracker');
    const entityId=typeof entry?.entity_id==='string'&&/^calendar\.[a-z0-9_]+$/.test(entry.entity_id)?entry.entity_id:'';
    if(!entityId)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'home_assistant_calendar_source_unavailable'});
    const path=`/api/calendars/${entityId}?start=${encodeURIComponent(window.from)}&end=${encodeURIComponent(window.to)}`;const response=await request(config.origin!,path,{method:'GET',token:accessToken},this.requestTimeoutMs,this.addressLookup);return parseHomeAssistantCalendarEvents(json(response,'resource'),entityId);
  }
}
