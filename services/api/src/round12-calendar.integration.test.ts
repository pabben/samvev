import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import type { CalendarEvent, CalendarInfo, CalendarPage, CalendarProvider, CalendarTokenSet, CalendarTransport } from './calendar/service.ts';
import type { HomeAssistantTemperatureCandidate, HomeAssistantTemperatureObservation } from './calendar/home-assistant-client.ts';

type Session = { cookie:string; csrf:string };
type Connection = { id:string; revision:number; provider?:CalendarProvider; state?:string; errorCode?:string|null; disconnectedAt?:string|null; sources:Array<any>; temperatureSensors:Array<any> };

const scopes = {
  google:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'],
  microsoft:['openid','email','offline_access','Calendars.ReadBasic'],
  home_assistant:['home_assistant_instance_token']
} as const;

const local = (title:string,start:string,end:string|null):CalendarEvent => ({
  uid:`local:${title}:${start}`,instanceId:'single',identityKind:'local_snapshot',title,start,end,allDay:false,cancelled:false
});

class Round12Transport implements CalendarTransport {
  microsoftSubject = 'subject-a';
  eventMode:'current'|'cached-unavailable'|'unknown'|'empty'|'partial' = 'current';
  uidless:CalendarEvent[] = [
    {...local('Synthetic local A','2026-10-24T08:00:00Z','2026-10-24T09:00:00Z'),uid:'local:synthetic-a:1'},
    {...local('Synthetic local A','2026-10-24T08:00:00Z','2026-10-24T09:00:00Z'),uid:'local:synthetic-a:2'}
  ];
  temperatures = new Map<string,HomeAssistantTemperatureObservation|Error>([
    ['registry-temperature-a',{value:-3.5,unit:'°C',status:'current',lastReportedAt:'2026-10-15T08:00:00Z',lastUpdatedAt:'2026-10-15T08:00:00Z',fetchedAt:'2026-10-15T10:00:00Z'}],
    ['registry-temperature-b',{value:68,unit:'°F',status:'current',lastReportedAt:'2026-10-15T09:00:00Z',lastUpdatedAt:'2026-10-15T09:00:00Z',fetchedAt:'2026-10-15T10:00:00Z'}]
  ]);
  eventBarrier:{started:()=>void; wait:Promise<void>}|undefined;
  discoveryBarrier:{started:()=>void; wait:Promise<void>}|undefined;
  calendarDiscoveryCalls=0;
  temperatureDiscoveryCalls=0;
  icsText='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
  async exchangeCode(provider:Exclude<CalendarProvider,'ics'>,input:{code:string}):Promise<CalendarTokenSet>{
    const subject=provider==='microsoft'?(input.code.includes('account-c')?'subject-c':this.microsoftSubject):`subject-${provider}`;
    return {accessToken:`access-${provider}`,refreshToken:`refresh-${provider}`,expiresAt:new Date(Date.now()+3_600_000).toISOString(),scopes:[...scopes[provider]],providerSubject:subject,accountLabel:`${provider}@synthetic.invalid`};
  }
  async refresh(provider:CalendarProvider):Promise<CalendarTokenSet>{
    if(provider==='ics')throw new Error('not used');
    return this.exchangeCode(provider,{code:'refresh'});
  }
  async revoke():Promise<'confirmed'>{return 'confirmed';}
  async listCalendars(provider:Exclude<CalendarProvider,'ics'>):Promise<CalendarPage<CalendarInfo>>{
    this.calendarDiscoveryCalls++;
    if(this.discoveryBarrier){const barrier=this.discoveryBarrier;barrier.started();await barrier.wait;this.discoveryBarrier=undefined;}
    if(provider!=='home_assistant')return {items:[{externalId:'primary',name:'Synthetic primary'}]};
    return {items:[
      {externalId:'registry-spond',name:'Synthetic Spond',provenance:{integrationDomain:'spond_tracker',entityId:'calendar.synthetic_spond',platform:'calendar',registryId:'registry-spond',identityKind:'registry'}},
      {externalId:'registry-general-a',name:'Synthetic general A',provenance:{integrationDomain:'home_assistant',entityId:'calendar.synthetic_general_a',platform:'calendar',registryId:'registry-general-a',identityKind:'registry'}},
      {externalId:'registry-waste',name:'Synthetic waste',provenance:{integrationDomain:'home_assistant',entityId:'calendar.synthetic_waste',platform:'calendar',registryId:'registry-waste',identityKind:'registry'}}
    ]};
  }
  async listEvents(_provider:CalendarProvider,_token:string,calendarId:string):Promise<CalendarPage<CalendarEvent>>{
    if(this.eventBarrier){const barrier=this.eventBarrier;barrier.started();await barrier.wait;this.eventBarrier=undefined;}
    if(this.eventMode==='cached-unavailable'||this.eventMode==='unknown')throw Object.assign(new Error('synthetic source health is not current'),{code:'MONITOR_SOURCE_UNAVAILABLE',details:{reason:'home_assistant_calendar_source_stale'}});
    if(this.eventMode==='partial')throw new Error('synthetic partial snapshot');
    if(this.eventMode==='empty')return {items:[]};
    if(calendarId==='registry-waste')return {items:[{uid:'local:waste-paper:1',instanceId:'single',identityKind:'local_snapshot',title:'Synthetic paper',start:'2026-10-24',end:'2026-10-25',allDay:true,cancelled:false},{uid:'local:waste-plastic:1',instanceId:'single',identityKind:'local_snapshot',title:'Synthetic plastic',start:'2026-10-24',end:'2026-10-25',allDay:true,cancelled:false}]};
    if(calendarId==='registry-general-a')return {items:this.uidless};
    return {items:[{uid:'spond-stable',instanceId:'single',identityKind:'provider',title:'Synthetic Spond activity',start:'2026-10-24T10:00:00Z',end:'2026-10-24T11:00:00Z',allDay:false,cancelled:false}]};
  }
  async listTemperatureSensors():Promise<HomeAssistantTemperatureCandidate[]>{this.temperatureDiscoveryCalls++;if(this.discoveryBarrier){const barrier=this.discoveryBarrier;barrier.started();await barrier.wait;this.discoveryBarrier=undefined;}return [
    {externalId:'registry-temperature-a',entityId:'sensor.synthetic_a',identityKind:'registry',name:'Synthetic outside',provenance:{integrationDomain:'home_assistant',platform:'sensor',requiresTargetedTemperatureValidation:true}},
    {externalId:'registry-temperature-b',entityId:'sensor.synthetic_b',identityKind:'registry',name:'Synthetic inside',provenance:{integrationDomain:'home_assistant',platform:'sensor',requiresTargetedTemperatureValidation:true}}
  ];}
  async readTemperatureSensor(_token:string,externalId:string,_config:any):Promise<HomeAssistantTemperatureObservation>{
    const value=this.temperatures.get(externalId);if(value instanceof Error)throw value;if(!value)throw new Error('missing synthetic sensor');return value;
  }
  async fetchIcs():Promise<string>{return this.icsText;}
}

let app:FastifyInstance, transport:Round12Transport, keyDir:string, installationId:string, householdId:string, owner:Session, manager:Session;
let ownerMembershipId:string, managerMembershipId:string;
function cookie(response:LightMyRequestResponse){const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map(value=>value.split(';')[0]).join('; ');}
function headers(session:Session){return {cookie:session.cookie,'x-csrf-token':session.csrf,origin:'https://samvev.test.invalid'};}
async function api(method:any,url:string,payload?:any,session=owner):Promise<any>{const response:any=await app.inject({method,url,headers:headers(session),payload});assert.ok(response.statusCode<400,`${method} ${url}: ${response.body}`);return response.json();}
async function login(){const response=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:'https://samvev.test.invalid'},payload:{email:'round12-owner@test.invalid',password:'Synthetic-round12-password-42'}});assert.equal(response.statusCode,200,response.body);return {cookie:cookie(response),csrf:response.json().csrfToken as string};}
async function configure(provider:'google'|'microsoft'|'home_assistant',expectedRevision:number){
  const payload:any={expectedRevision,status:'active'};
  if(provider==='google')payload.googleOAuthJson={web:{client_id:'synthetic-google-client',client_secret:'synthetic-google-secret',auth_uri:'https://accounts.google.com/o/oauth2/v2/auth',token_uri:'https://oauth2.googleapis.com/token',redirect_uris:['https://samvev.test.invalid/api/v1/calendar/oauth/google/callback']}};
  if(provider==='microsoft')Object.assign(payload,{clientId:'synthetic-microsoft-client',clientSecret:'synthetic-microsoft-secret',tenant:'common'});
  if(provider==='home_assistant')Object.assign(payload,{origin:'http://synthetic-ha.invalid'});
  return api('PUT',`/api/v1/installations/${installationId}/calendar-providers/${provider}`,payload);
}
async function connect(provider:'google'|'microsoft'|'home_assistant',name:string,code='synthetic-code',replacesConnectionId?:string):Promise<Connection>{
  const created=await api('POST',`/api/v1/households/${householdId}/calendar-connections`,{provider,name,bridgeKind:provider==='home_assistant'?'spond_home_assistant':'direct',...(replacesConnectionId?{replacesConnectionId}:{})});
  const id=created.connection.id;const started=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${id}/oauth/start`,{});const state=new URL(started.authorizationUrl).searchParams.get('state')!;
  const callback=await app.inject({method:'GET',url:`/api/v1/calendar/oauth/${provider}/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`});assert.equal(callback.statusCode,302,callback.body);const completion=decodeURIComponent(String(callback.headers.location).split('#calendar-oauth=')[1]!);
  const completed=await api('POST',`/api/v1/households/${householdId}/calendar-connections/oauth/${provider}/complete`,{completionToken:completion});return completed.connection.find((row:Connection)=>row.id===id)!;
}
async function enable(connection:Connection,source:any,subjects:{household:boolean;personIds:string[]}){
  return api('PATCH',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}`,{expectedRevision:source.revision,enabled:true,bridgeKind:'direct',purpose:source.externalId==='registry-waste'?'waste':'calendar',appliesTo:subjects,visibility:{household:true,personIds:[],displayIds:[]}});
}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('round12 calendar integration refuses a non-isolated test database');
  keyDir=await mkdtemp(join(tmpdir(),'samvev-round12-calendar-'));await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');transport=new Round12Transport();app=await buildApp({calendarTransport:transport,aiKeyFile:join(keyDir,'key'),runtimeConfig:{publicOrigin:'https://samvev.test.invalid',secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin:'https://samvev.test.invalid'}});const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin:'https://samvev.test.invalid'},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic round twelve owner',email:'round12-owner@test.invalid',password:'Synthetic-round12-password-42'},household:{name:'Synthetic round twelve',timezone:'Europe/Oslo',locale:'nb'},preferences:{locale:'nb',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);owner={cookie:cookie(claim),csrf:claim.json().csrfToken};householdId=claim.json().householdId;installationId=(await pool.query<{id:string}>('SELECT id FROM installations WHERE singleton=true')).rows[0]!.id;
  ownerMembershipId=claim.json().membershipId;const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic manager','adult') RETURNING id`,[householdId])).rows[0]!;const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'round12-manager@test.invalid','unused','nb','light') RETURNING id`,[installationId])).rows[0]!;managerMembershipId=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[householdId,account.id,person.id,JSON.stringify(['household.view','household.manage'])])).rows[0]!.id;const managerToken='round12-synthetic-manager-token',managerCsrf='round12-synthetic-manager-csrf';await pool.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`,[account.id,tokenHash(managerToken),tokenHash(managerCsrf)]);manager={cookie:`samvev_session=${managerToken}; samvev_csrf=${managerCsrf}`,csrf:managerCsrf};
});
after(async()=>{await app.close();await pool.end();await rm(keyDir,{recursive:true,force:true});});

test('F1 restores ordinary Google and Microsoft retries only after same-client registration repair',async()=>{
  await configure('google',0);await configure('microsoft',0);
  for(const provider of ['google','microsoft'] as const){
    const connection=await connect(provider,`Synthetic ${provider} repair`);const source=connection.sources[0];const enabled=await enable(connection,source,{household:true,personIds:[]});
    await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:enabled.connection.revision});
    const initiallyCurrent=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`)).connections.find((row:Connection)=>row.id===connection.id) as Connection,initialSource=initiallyCurrent.sources.find((item:any)=>item.id===source.id);assert.equal(initialSource.freshness,'current');assert.ok(initialSource.lastSyncSucceededAt);
    const before=(await pool.query<any>('SELECT last_sync_succeeded_at,credential_ciphertext FROM calendar_connections WHERE id=$1',[connection.id])).rows[0];
    await pool.query(`UPDATE calendar_connections SET state='error',last_error_code='CALENDAR_CLIENT_CONFIGURATION_INVALID',next_sync_at=NULL WHERE id=$1`,[connection.id]);
    const invalid=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`)).connections.find((row:Connection)=>row.id===connection.id) as Connection,invalidSource=invalid.sources.find((item:any)=>item.id===source.id);assert.equal(invalidSource.freshness,'stale');assert.equal(invalidSource.errorCode,'CALENDAR_CLIENT_CONFIGURATION_INVALID');assert.equal(invalidSource.lastSyncSucceededAt,initialSource.lastSyncSucceededAt,'invalid client does not fabricate a new source success');
    const revision=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,provider])).rows[0]!.revision;
    await configure(provider,revision);const repaired=(await pool.query<any>('SELECT last_error_code,next_sync_at,last_sync_succeeded_at,credential_ciphertext FROM calendar_connections WHERE id=$1',[connection.id])).rows[0];
    assert.equal(repaired.last_error_code,'CALENDAR_RETRY_PENDING');assert.ok(repaired.next_sync_at);assert.equal(String(repaired.last_sync_succeeded_at),String(before.last_sync_succeeded_at));assert.equal(repaired.credential_ciphertext, before.credential_ciphertext);
    const current=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`)).connections.find((row:Connection)=>row.id===connection.id) as Connection,currentSource=current.sources.find((item:any)=>item.id===source.id);assert.equal(current.errorCode,'CALENDAR_RETRY_PENDING');assert.equal(currentSource.freshness,'stale');assert.equal(currentSource.errorCode,'CALENDAR_RETRY_PENDING');assert.equal(currentSource.lastSyncSucceededAt,initialSource.lastSyncSucceededAt,'repair pending remains stale until the retry fetch succeeds');
    const recovered=(await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:current.revision})).connection as Connection,recoveredSource=recovered.sources.find((item:any)=>item.id===source.id);assert.equal(recovered.state,'connected');assert.equal(recoveredSource.freshness,'current');assert.equal(recoveredSource.errorCode,null);assert.ok(recoveredSource.lastSyncSucceededAt);
  }
});

test('F2 rejects a different Microsoft subject on ordinary reconnect and allows explicit replacement without copying ACLs',async()=>{
  const revision=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=\'microsoft\'',[installationId])).rows[0]!.revision;await configure('microsoft',revision);
  transport.microsoftSubject='subject-f2-a';const original=await connect('microsoft','Synthetic Outlook A');const enabled=await enable(original,original.sources[0],{household:true,personIds:[]});
  const changedRevision=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=\'microsoft\'',[installationId])).rows[0]!.revision;await api('PUT',`/api/v1/installations/${installationId}/calendar-providers/microsoft`,{expectedRevision:changedRevision,status:'active',clientId:'synthetic-microsoft-client-b',clientSecret:'synthetic-microsoft-secret-b',tenant:'common'});
  transport.microsoftSubject='subject-f2-b';const start=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${original.id}/oauth/start`,{});const state=new URL(start.authorizationUrl).searchParams.get('state')!;const callback=await app.inject({method:'GET',url:`/api/v1/calendar/oauth/microsoft/callback?state=${encodeURIComponent(state)}&code=synthetic-code`});assert.equal(callback.statusCode,302);const token=decodeURIComponent(String(callback.headers.location).split('#calendar-oauth=')[1]!);const ordinary=await app.inject({method:'POST',url:'/api/v1/households/'+householdId+'/calendar-connections/oauth/microsoft/complete',headers:headers(owner),payload:{completionToken:token}});assert.equal(ordinary.statusCode,409,'different client subject never rebinds the old connection');
  const replacement=await connect('microsoft','Synthetic Outlook B','synthetic-code',original.id);assert.ok(replacement.sources.length);for(const source of replacement.sources){assert.equal(source.enabled,false);assert.deepEqual(source.appliesTo,{household:false,personIds:[]});assert.deepEqual(source.visibility,{household:false,personIds:[],displayIds:[]});}
  assert.equal((await pool.query<{disconnected_at:Date|null}>('SELECT disconnected_at FROM calendar_connections WHERE id=$1',[original.id])).rows[0]!.disconnected_at instanceof Date,true);void enabled;
});

test('generic HA snapshots preserve prior content on cached/unhealthy responses and reconcile only complete snapshots',async()=>{
  await configure('home_assistant',0);const connection=await connect('home_assistant','Synthetic HA');const general=connection.sources.find(source=>source.externalId==='registry-general-a')!;const waste=connection.sources.find(source=>source.externalId==='registry-waste')!;
  let current=(await enable(connection,general,{household:true,personIds:[]})).connection;current=(await enable(current,waste,{household:true,personIds:[]})).connection;
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:current.revision});
  const initial=(await pool.query<{count:number}>(`SELECT count(*)::int count FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE source.external_id='registry-general-a' AND occurrence.status='active'`)).rows[0]!.count;assert.equal(initial,2,'legitimate UID-less duplicates survive');
  transport.eventMode='cached-unavailable';const failed=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,headers:headers(owner),payload:{expectedRevision:current.revision}});assert.equal(failed.statusCode,200,'a per-source health failure is reported as a partial sync, not a destructive global failure');assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE source.external_id='registry-general-a' AND occurrence.status='active'`)).rows[0]!.count,initial,'unhealthy cached 200-equivalent never withdraws retained occurrences');
  const stale=(await api('GET',`/api/v1/households/${householdId}/home`)).items.filter((item:any)=>item.metadata?.calendar?.sourceId===general.id);assert.ok(stale.every((item:any)=>item.metadata.calendar.freshness==='stale'));
  transport.eventMode='empty';await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:current.revision});assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE source.external_id='registry-general-a' AND occurrence.status='active'`)).rows[0]!.count,0,'a complete empty snapshot may reconcile');
});

test('long calendar preview and discovery do not commit after the initiating session is revoked',async()=>{
  const listed=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`)).connections as any[];const connection=listed.find(row=>row.provider==='google'&&!row.disconnectedAt) as Connection;let source=connection.sources[0];
  const staleRevision=source.revision;const updated=await api('PATCH',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}`,{expectedRevision:source.revision,enabled:source.enabled,bridgeKind:source.bridgeKind,purpose:source.purpose,displayName:source.displayName,appliesTo:source.appliesTo,visibility:source.visibility});source=updated.connection.sources.find((row:any)=>row.id===source.id);assert.ok(source.revision>staleRevision);
  const stalePreview=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}/preview`,headers:headers(owner),payload:{expectedSourceRevision:staleRevision}});assert.equal(stalePreview.statusCode,409,stalePreview.body);assert.equal(stalePreview.json().error.details.revisionKind,'calendar_source');
  const control=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}/preview`,headers:headers(owner),payload:{expectedSourceRevision:source.revision}});assert.equal(control.statusCode,200,control.body);
  let started!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{started=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});transport.eventBarrier={started,wait:hold};
  const preview=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}/preview`,headers:headers(owner),payload:{expectedSourceRevision:source.revision}});await reached;
  await pool.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=(SELECT id FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE email_normalized='round12-owner@test.invalid') AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`);release();
  const previewResult=await preview;assert.equal(previewResult.statusCode,409,previewResult.body);assert.equal(previewResult.json().error.details.reason,'calendar_preview_superseded');
  owner=await login();const ha=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`)).connections.find((row:Connection)=>row.id!==connection.id&&row.sources.some(source=>source.externalId==='registry-general-a')) as Connection;const before=(await pool.query<{updated_at:Date}>('SELECT updated_at FROM calendar_sources WHERE id=$1',[ha.sources.find(source=>source.externalId==='registry-general-a')!.id])).rows[0]!.updated_at;
  const refreshed=new Promise<void>(resolve=>{started=resolve;}),holdDiscovery=new Promise<void>(resolve=>{release=resolve;});transport.discoveryBarrier={started,wait:holdDiscovery};const refresh=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${ha.id}/sources/refresh`,headers:headers(owner),payload:{expectedRevision:ha.revision}});await refreshed;
  await pool.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=(SELECT id FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE email_normalized='round12-owner@test.invalid') AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`);release();const refreshResult=await refresh;assert.equal(refreshResult.statusCode,409,refreshResult.body);assert.equal(refreshResult.json().error.details.reason,'calendar_operation_superseded');assert.equal(String((await pool.query<{updated_at:Date}>('SELECT updated_at FROM calendar_sources WHERE id=$1',[ha.sources.find(source=>source.externalId==='registry-general-a')!.id])).rows[0]!.updated_at),String(before));
  owner=await login();const discoveryStarted=new Promise<void>(resolve=>{started=resolve;}),holdSensorDiscovery=new Promise<void>(resolve=>{release=resolve;});transport.discoveryBarrier={started,wait:holdSensorDiscovery};const discovery=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${ha.id}/temperature-sensors/discover`,headers:headers(owner),payload:{expectedRevision:ha.revision,search:'Synthetic',cursor:0}});await discoveryStarted;await pool.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=(SELECT id FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE email_normalized='round12-owner@test.invalid') AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`);release();const discoveryResult=await discovery;assert.equal(discoveryResult.statusCode,409,discoveryResult.body);assert.equal(discoveryResult.json().error.details.reason,'calendar_operation_superseded');
  owner=await login();const selectStarted=new Promise<void>(resolve=>{started=resolve;}),holdSelection=new Promise<void>(resolve=>{release=resolve;});transport.discoveryBarrier={started,wait:holdSelection};const selection=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${ha.id}/temperature-sensors`,headers:headers(owner),payload:{expectedRevision:ha.revision,externalId:'registry-temperature-a'}});await selectStarted;await pool.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=(SELECT id FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE email_normalized='round12-owner@test.invalid') AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`);release();const selectionResult=await selection;assert.equal(selectionResult.statusCode,409,selectionResult.body);assert.equal(selectionResult.json().error.details.reason,'calendar_operation_superseded');assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM home_assistant_temperature_sensors WHERE connection_id=$1`,[ha.id])).rows[0]!.count,0,'revoked selection does not persist a sensor');
  owner=await login();const successBefore=(await pool.query<{last_sync_succeeded_at:Date|null}>('SELECT last_sync_succeeded_at FROM calendar_connections WHERE id=$1',[ha.id])).rows[0]!.last_sync_succeeded_at;transport.eventMode='current';const syncStarted=new Promise<void>(resolve=>{started=resolve;}),holdSync=new Promise<void>(resolve=>{release=resolve;});transport.eventBarrier={started,wait:holdSync};const manualSync=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${ha.id}/sync`,headers:headers(owner),payload:{expectedRevision:ha.revision}});await syncStarted;await pool.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=(SELECT id FROM sessions WHERE account_id=(SELECT id FROM accounts WHERE email_normalized='round12-owner@test.invalid') AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)`);release();const manualResult=await manualSync;assert.equal(manualResult.statusCode,409,manualResult.body);assert.equal(manualResult.json().error.details.reason,'calendar_sync_superseded');assert.equal(String((await pool.query<{last_sync_succeeded_at:Date|null}>('SELECT last_sync_succeeded_at FROM calendar_connections WHERE id=$1',[ha.id])).rows[0]!.last_sync_succeeded_at),String(successBefore),'revoked manual sync cannot advance the aggregate success marker');
});

test('a manager demoted during a remote preview receives no private source data',async()=>{
  const managerConnections=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`,undefined,manager)).connections as Connection[];
  const google=managerConnections.find((connection)=>connection.provider==='google'&&!connection.disconnectedAt)!;const googleSource=google.sources[0]!;
  let started!:()=>void,release!:()=>void;const reached=new Promise<void>((resolve)=>{started=resolve;}),holdPreview=new Promise<void>((resolve)=>{release=resolve;});transport.eventBarrier={started,wait:holdPreview};
  const managerPreview=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${google.id}/sources/${googleSource.id}/preview`,headers:headers(manager),payload:{expectedSourceRevision:googleSource.revision}});await reached;
  await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[managerMembershipId,JSON.stringify(['household.view'])]);release();const preview=await managerPreview;await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[managerMembershipId,JSON.stringify(['household.view','household.manage'])]);assert.ok([403,404,409].includes(preview.statusCode),preview.body);assert.equal(preview.body.includes('Synthetic Spond activity'),false,'a manager demoted during the remote read receives no source preview');
});

test('a manager cannot start HA discovery after its connection owner loses authority',async()=>{
  await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[managerMembershipId,JSON.stringify(['household.view','household.manage'])]);
  await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[ownerMembershipId,JSON.stringify(['household.view','household.manage'])]);
  const ha=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`,undefined,manager)).connections.find((connection:Connection)=>connection.provider==='home_assistant'&&!connection.disconnectedAt)!;const callsBeforeOwnerLoss=transport.calendarDiscoveryCalls;
  await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[ownerMembershipId,JSON.stringify(['household.manage'])]);const ownerInvalid=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${ha.id}/sources/refresh`,headers:headers(manager),payload:{expectedRevision:ha.revision}});await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[ownerMembershipId,JSON.stringify(['household.view','household.manage'])]);assert.equal(ownerInvalid.statusCode,409,ownerInvalid.body);assert.equal(transport.calendarDiscoveryCalls,callsBeforeOwnerLoss,'a manager cannot begin remote discovery after the connection owner loses household.view');
});

test('a disconnected HA connection cannot release held temperature discovery identifiers',async()=>{
  await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[managerMembershipId,JSON.stringify(['household.view','household.manage'])]);
  await pool.query(`UPDATE memberships SET capabilities=$2,revision=revision+1 WHERE id=$1`,[ownerMembershipId,JSON.stringify(['household.view','household.manage'])]);
  const ha=(await api('GET',`/api/v1/households/${householdId}/calendar-connections`,undefined,manager)).connections.find((connection:Connection)=>connection.provider==='home_assistant'&&!connection.disconnectedAt)!;
  let started!:()=>void,release!:()=>void;const discoveryReached=new Promise<void>((resolve)=>{started=resolve;}),holdDiscovery=new Promise<void>((resolve)=>{release=resolve;});transport.discoveryBarrier={started,wait:holdDiscovery};const discovery=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${ha.id}/temperature-sensors/discover`,headers:headers(manager),payload:{expectedRevision:ha.revision,search:'Synthetic',cursor:0}});await discoveryReached;
  await pool.query(`UPDATE calendar_connections SET disconnected_at=clock_timestamp(),sync_generation=sync_generation+1 WHERE id=$1`,[ha.id]);release();const superseded=await discovery;assert.equal(superseded.statusCode,409,superseded.body);assert.equal(superseded.body.includes('sensor.synthetic_a'),false,'a disconnected connection cannot release discovered entity identifiers');
});

test('ICS preview and stored sync windows agree; disconnected calendar removal erases all imported history',async()=>{
  owner=await login();
  transport.icsText='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:synthetic-removal-event\r\nDTSTART:20261105T090000Z\r\nDTEND:20261105T100000Z\r\nSUMMARY:Synthetic removable event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const created=await api('POST',`/api/v1/households/${householdId}/calendar-connections`,{provider:'ics',name:'Synthetic removable ICS',icsUrl:'https://calendar.example/synthetic-removal.ics'});let connection=created.connection as Connection;let source=connection.sources[0]!;
  const backingIntegration=(await pool.query<{id:string}>('SELECT integration_connection_id id FROM calendar_connections WHERE id=$1',[connection.id])).rows[0]!.id;
  const secondSourceId=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name) VALUES($1,$2,'synthetic-second-source','Synthetic secondary source') RETURNING id`,[householdId,connection.id])).rows[0]!.id;
  const unrelatedSourcesBefore=(await pool.query<{count:number}>('SELECT count(*)::int count FROM calendar_sources WHERE household_id=$1 AND connection_id<>$2',[householdId,connection.id])).rows[0]!.count;
  const unrelatedImportsBefore=(await pool.query<{count:number}>('SELECT count(*)::int count FROM integration_items WHERE household_id=$1 AND connection_id<>$2',[householdId,backingIntegration])).rows[0]!.count;
  assert.deepEqual(source.syncWindowDays,{past:28,future:364},'new sources default to the requested four/twelve month window');
  const activeDelete=await app.inject({method:'DELETE',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}`,headers:headers(owner),payload:{expectedRevision:connection.revision}});assert.equal(activeDelete.statusCode,409,activeDelete.body);assert.equal(activeDelete.json().error.details.reason,'calendar_connection_must_be_disconnected');assert.equal((await pool.query('SELECT id FROM calendar_connections WHERE id=$1',[connection.id])).rowCount,1);
  const preview=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}/preview`,{expectedSourceRevision:source.revision,syncWindowDays:{past:28,future:364}});
  assert.equal(Date.parse(preview.window.to)-Date.parse(preview.window.from),392*24*60*60*1000);assert.deepEqual(preview.syncWindowDays,{past:28,future:364});
  const enabled=await api('PATCH',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}`,{expectedRevision:source.revision,enabled:true,syncWindowDays:{past:28,future:364},appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});connection=enabled.connection;source=connection.sources[0]!;
  assert.deepEqual(source.syncWindowDays,{past:28,future:364});const preserved=await api('PATCH',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sources/${source.id}`,{expectedRevision:source.revision,enabled:true,appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});connection=preserved.connection;source=connection.sources[0]!;assert.deepEqual(source.syncWindowDays,{past:28,future:364},'a later source update that omits the range preserves its saved choice');const synced=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:connection.revision});const syncedSource=synced.connection.sources.find((row:any)=>row.id===source.id);assert.equal(Date.parse(syncedSource.lastCompleteWindow.to)-Date.parse(syncedSource.lastCompleteWindow.from),392*24*60*60*1000,'worker reconciles the saved preview window');
  const before=(await pool.query<{count:number}>('SELECT count(*)::int count FROM integration_items WHERE household_id=$1 AND status=\'active\' AND metadata ? \'calendar\' AND metadata #>> \'{calendar,sourceId}\'=$2',[householdId,source.id])).rows[0]!.count;assert.equal(before,1);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int count FROM calendar_occurrences WHERE source_id=$1 AND status=\'active\'',[source.id])).rows[0]!.count,1);
  const ownItemsBefore=(await pool.query<{count:number}>(`SELECT count(*)::int count FROM integration_items WHERE household_id=$1 AND NOT(metadata ? 'calendar')`,[householdId])).rows[0]!.count;
  const ownMessagesBefore=(await pool.query<{count:number}>('SELECT count(*)::int count FROM messages WHERE household_id=$1',[householdId])).rows[0]!.count;
  const disconnected=(await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/disconnect`,{expectedRevision:connection.revision})).connection;
  const staleDelete=await app.inject({method:'DELETE',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}`,headers:headers(owner),payload:{expectedRevision:disconnected.revision-1}});assert.equal(staleDelete.statusCode,409,staleDelete.body);
  const removal=await app.inject({method:'DELETE',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}`,headers:headers(owner),payload:{expectedRevision:disconnected.revision}});assert.equal(removal.statusCode,200,removal.body);assert.equal(removal.json().removed,true);
  const tombstone=(await pool.query<any>('SELECT removed_at,revision,sync_generation,state,name,credential_ciphertext,account_label,provider_subject_hash,granted_scopes,next_sync_at,lease_token,credential_lease_token FROM calendar_connections WHERE id=$1 AND household_id=$2',[connection.id,householdId])).rows[0];assert.ok(tombstone?.removed_at);assert.equal(tombstone.state,'disconnected');assert.equal(tombstone.name,'Removed calendar');assert.equal(tombstone.credential_ciphertext,null);assert.equal(tombstone.account_label,null);assert.equal(tombstone.provider_subject_hash,null);assert.deepEqual(tombstone.granted_scopes,[]);assert.equal(tombstone.next_sync_at,null);assert.equal(tombstone.lease_token,null);assert.equal(tombstone.credential_lease_token,null);
  const backing=(await pool.query<any>('SELECT name,revoked_at FROM integration_connections WHERE id=$1 AND household_id=$2',[backingIntegration,householdId])).rows[0];assert.equal(backing.name,'Removed calendar');assert.ok(backing.revoked_at);assert.equal((await pool.query('SELECT id FROM integration_credentials WHERE connection_id=$1 AND revoked_at IS NULL',[backingIntegration])).rowCount,0);
  assert.equal((await pool.query('SELECT id FROM calendar_sources WHERE connection_id=$1',[connection.id])).rowCount,0,'all source rows owned by the removed connection cascade');assert.equal((await pool.query('SELECT id FROM calendar_sources WHERE id=$1',[secondSourceId])).rowCount,0);assert.equal((await pool.query('SELECT id FROM calendar_occurrences WHERE source_id=$1',[source.id])).rowCount,0,'the source FK cascades calendar-only occurrence rows');assert.equal((await pool.query('SELECT id FROM integration_items WHERE household_id=$1 AND connection_id=$2',[householdId,backingIntegration])).rowCount,0,'all current and historical imported payloads are physically deleted');assert.equal((await pool.query<{count:number}>('SELECT count(*)::int count FROM calendar_sources WHERE household_id=$1',[householdId])).rows[0]!.count,unrelatedSourcesBefore,'other connection sources are unaffected');assert.equal((await pool.query<{count:number}>('SELECT count(*)::int count FROM integration_items WHERE household_id=$1 AND connection_id<>$2',[householdId,backingIntegration])).rows[0]!.count,unrelatedImportsBefore,'other connections imported items remain unchanged');
  assert.equal((await pool.query<{confdeltype:string}>(`SELECT constraint_row.confdeltype FROM pg_constraint constraint_row WHERE constraint_row.conrelid='calendar_occurrences'::regclass AND constraint_row.conname='calendar_occurrences_household_id_source_id_fkey'`)).rows[0]?.confdeltype,'c','the installed occurrence source FK cascades');
  await migrate();assert.ok((await pool.query('SELECT removed_at FROM calendar_connections WHERE id=$1 AND removed_at IS NOT NULL',[connection.id])).rowCount,'re-running the isolated migration set preserves tombstone state');
  const oldR16Generic=(await pool.query<{id:string}>(`SELECT integration.id FROM integration_connections integration WHERE integration.id=$1 AND NOT EXISTS(SELECT 1 FROM calendar_connections calendar WHERE calendar.integration_connection_id=integration.id)`,[backingIntegration])).rowCount;assert.equal(oldR16Generic,0,'retained tombstone keeps the old R16 generic-list exclusion intact');
  assert.equal((await api('GET',`/api/v1/households/${householdId}/integrations`,undefined,manager)).connections.some((item:any)=>item.id===backingIntegration),false);
  assert.equal((await api('GET',`/api/v1/households/${householdId}/calendar-connections`,undefined,manager)).connections.some((item:any)=>item.id===connection.id),false,'new API listing hides removed tombstones');
  const hidden=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/ics-subscription`,headers:headers(manager)});assert.equal(hidden.statusCode,404,'direct reads hide removed tombstones');
  const noResync=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,headers:headers(manager),payload:{expectedRevision:tombstone.revision}});assert.equal(noResync.statusCode,404,'a removed connection cannot be manually resynced');assert.equal((await pool.query('SELECT id FROM integration_items WHERE household_id=$1 AND connection_id=$2',[householdId,backingIntegration])).rowCount,0);
  const retry=await app.inject({method:'DELETE',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}`,headers:headers(owner),payload:{expectedRevision:disconnected.revision}});assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().removed,true,'single removal retries are idempotent');
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM integration_items WHERE household_id=$1 AND NOT(metadata ? 'calendar')`,[householdId])).rows[0]!.count,ownItemsBefore,'Samvev-owned items are unchanged');assert.equal((await pool.query<{count:number}>('SELECT count(*)::int count FROM messages WHERE household_id=$1',[householdId])).rows[0]!.count,ownMessagesBefore,'household messages are unchanged');
});

test('batch calendar removal is idempotent, transactional against reactivation, and household-scoped',async()=>{
  owner=await login();
  const makeIcs=async(name:string)=>{const result=await api('POST',`/api/v1/households/${householdId}/calendar-connections`,{provider:'ics',name,icsUrl:`https://calendar.example/${encodeURIComponent(name)}.ics`});return result.connection as Connection;};
  const first=await makeIcs('Synthetic batch one'),second=await makeIcs('Synthetic batch two');
  const firstDisconnected=(await api('POST',`/api/v1/households/${householdId}/calendar-connections/${first.id}/disconnect`,{expectedRevision:first.revision})).connection;
  const secondDisconnected=(await api('POST',`/api/v1/households/${householdId}/calendar-connections/${second.id}/disconnect`,{expectedRevision:second.revision})).connection;
  await pool.query(`UPDATE calendar_connections SET state='connected',disconnected_at=NULL,revision=revision+1 WHERE id=$1`,[second.id]);
  const batchUrl=`/api/v1/households/${householdId}/calendar-connections/remove-disconnected`,batch=[{id:first.id,expectedRevision:firstDisconnected.revision},{id:second.id,expectedRevision:secondDisconnected.revision}];
  const raced=await app.inject({method:'POST',url:batchUrl,headers:headers(manager),payload:{connections:batch}});assert.equal(raced.statusCode,409,raced.body);assert.equal((await pool.query('SELECT id FROM calendar_connections WHERE id=$1',[first.id])).rowCount,1,'transaction rolls back earlier removals if another snapshotted connection became active');
  await pool.query(`UPDATE calendar_connections SET state='disconnected',disconnected_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,[second.id]);
  const currentSecond=(await pool.query<{revision:number}>('SELECT revision FROM calendar_connections WHERE id=$1',[second.id])).rows[0]!.revision;
  const removed=await api('POST',batchUrl,{connections:[{id:first.id,expectedRevision:firstDisconnected.revision},{id:second.id,expectedRevision:currentSecond}]},manager);assert.equal(removed.removedCount,2);
  const repeated=await api('POST',batchUrl,{connections:[{id:first.id,expectedRevision:firstDisconnected.revision},{id:second.id,expectedRevision:currentSecond}]},manager);assert.equal(repeated.removedCount,0,'repeating the same confirmed snapshot is safe');
  const foreignHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic other household','Europe/Oslo','en') RETURNING id`,[installationId])).rows[0]!.id;
  const foreignIntegration=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name,revoked_at) VALUES($1,'Synthetic foreign ICS',clock_timestamp()) RETURNING id`,[foreignHousehold])).rows[0]!.id;
  const foreign=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state,disconnected_at) VALUES($1,$2,(SELECT id FROM accounts WHERE email_normalized='round12-owner@test.invalid'),'ics','Synthetic foreign ICS','disconnected',clock_timestamp()) RETURNING id`,[foreignHousehold,foreignIntegration])).rows[0]!.id;
  const cross=await app.inject({method:'DELETE',url:`/api/v1/households/${householdId}/calendar-connections/${foreign}`,headers:headers(manager),payload:{expectedRevision:1}});assert.equal(cross.statusCode,404,cross.body);assert.equal((await pool.query('SELECT id FROM calendar_connections WHERE id=$1',[foreign])).rowCount,1,'foreign household data is untouched');
});

test('complete UID-less HA snapshots retain duplicate local identities across reorder and withdraw only removed entries',async()=>{
  owner=await login();transport.eventMode='current';transport.uidless=[
    {...local('Synthetic duplicate','2026-10-24T08:00:00Z','2026-10-24T09:00:00Z'),uid:'local:duplicate:one'},
    {...local('Synthetic duplicate','2026-10-24T08:00:00Z','2026-10-24T09:00:00Z'),uid:'local:duplicate:two'}
  ];
  const connection=await connect('home_assistant','Synthetic HA UID-less');const source=connection.sources.find((item)=>item.externalId==='registry-general-a')!;let current=(await enable(connection,source,{household:true,personIds:[]})).connection;
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:current.revision});const activeIds=()=>pool.query<{id:string}>(`SELECT occurrence.id FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE source.connection_id=$1 AND source.external_id='registry-general-a' AND occurrence.status='active' ORDER BY occurrence.id`,[connection.id]);const first=(await activeIds()).rows.map((row)=>row.id);assert.equal(first.length,2);
  transport.uidless=[...transport.uidless].reverse();await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:current.revision});assert.deepEqual((await activeIds()).rows.map((row)=>row.id),first,'reordering indistinguishable UID-less snapshots does not create or withdraw duplicates');
  transport.uidless=[transport.uidless[0]!];await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/sync`,{expectedRevision:current.revision});assert.equal((await activeIds()).rows.length,1,'a complete snapshot may withdraw the single removed local duplicate');
});
