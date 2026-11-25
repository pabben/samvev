import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createHash } from 'node:crypto';
import { tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import type { CalendarEvent, CalendarInfo, CalendarPage, CalendarProvider, CalendarTokenSet, CalendarTransport } from './calendar/service.ts';
import type { HomeAssistantTemperatureCandidate, HomeAssistantTemperatureObservation } from './calendar/home-assistant-client.ts';

type Session={cookie:string;csrf:string};
type Connection={id:string;revision:number;sources:any[];temperatureSensors:any[]};
const origin='https://samvev-round13.test.invalid';
const haScopes=['home_assistant_instance_token'];
const value=(n:number):HomeAssistantTemperatureObservation=>({value:n,unit:'°C',status:'current',lastReportedAt:new Date().toISOString(),lastUpdatedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()});

class TemperatureTransport implements CalendarTransport {
  candidates:HomeAssistantTemperatureCandidate[]=[
    {externalId:'registry-temperature-a',entityId:'sensor.synthetic_outside',identityKind:'registry',name:'Synthetic outside',provenance:{integrationDomain:'home_assistant',platform:'sensor',registryId:'registry-temperature-a'}},
    {externalId:'registry-temperature-b',entityId:'sensor.synthetic_inside',identityKind:'registry',name:'Synthetic inside',provenance:{integrationDomain:'home_assistant',platform:'sensor',registryId:'registry-temperature-b'}}
  ];
  reads:Array<{entityId:string;value:number|null}>=[];
  values=new Map([['sensor.synthetic_outside',value(-3)],['sensor.synthetic_inside',value(68)],['sensor.synthetic_outside_new',value(-7)]]);
  readBarrier:{started:()=>void;wait:Promise<void>}|undefined;
  async exchangeCode(provider:Exclude<CalendarProvider,'ics'>,input:{code:string}):Promise<CalendarTokenSet>{return{accessToken:'synthetic-token',refreshToken:'synthetic-refresh',expiresAt:new Date(Date.now()+3_600_000).toISOString(),scopes:provider==='home_assistant'?[...haScopes]:['openid','email'],providerSubject:input.code,accountLabel:'synthetic@invalid.test'};}
  async refresh(provider:CalendarProvider):Promise<CalendarTokenSet>{if(provider==='ics')throw new Error('not used');return{accessToken:'synthetic-token',refreshToken:'synthetic-refresh',expiresAt:new Date(Date.now()+3_600_000).toISOString(),scopes:provider==='home_assistant'?[...haScopes]:['openid','email'],providerSubject:'retained',accountLabel:'synthetic@invalid.test'};}
  async revoke():Promise<'confirmed'>{return'confirmed';}
  async listCalendars(provider:Exclude<CalendarProvider,'ics'>):Promise<CalendarPage<CalendarInfo>>{return{items:provider==='home_assistant'?[]:[{externalId:'primary',name:'Synthetic primary'}]};}
  async listEvents(_provider:CalendarProvider,_token:string,_calendarId:string,_window:{from:string;to:string}):Promise<CalendarPage<CalendarEvent>>{return{items:[]};}
  async listTemperatureSensors():Promise<HomeAssistantTemperatureCandidate[]>{return this.candidates.map((candidate)=>({...candidate}));}
  async readTemperatureSensor(_token:string,entityId:string):Promise<HomeAssistantTemperatureObservation>{
    if(this.readBarrier){const barrier=this.readBarrier;this.readBarrier=undefined;barrier.started();await barrier.wait;}
    const observation=this.values.get(entityId);this.reads.push({entityId,value:observation?.value??null});if(!observation)throw new Error(`missing synthetic entity ${entityId}`);return observation;
  }
  async fetchIcs():Promise<string>{return'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';}
}

let app:FastifyInstance,transport:TemperatureTransport,keyDir:string,householdId:string,installationId:string,owner:Session,ownerPersonId:string,oauthCodeNumber=0;
function cookie(response:LightMyRequestResponse){const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map((item)=>item.split(';')[0]).join('; ');}
function headers(session=owner){return{cookie:session.cookie,'x-csrf-token':session.csrf,origin};}
async function api(method:'GET'|'POST'|'PUT'|'PATCH'|'DELETE',url:string,payload?:any,session=owner){const response=await app.inject({method,url,headers:headers(session),payload});assert.ok(response.statusCode<400,`${method} ${url}: ${response.body}`);return response.json();}
async function configureHa(status:'active'|'disabled',expectedRevision:number,haOrigin='http://synthetic-ha.invalid'){
  return api('PUT',`/api/v1/installations/${installationId}/calendar-providers/home_assistant`,{expectedRevision,status,...(status==='active'?{origin:haOrigin}:{})});
}
async function connectHa():Promise<Connection>{
  const oauthCode=`synthetic-code-${++oauthCodeNumber}`;
  const created=await api('POST',`/api/v1/households/${householdId}/calendar-connections`,{provider:'home_assistant',name:'Synthetic HA',bridgeKind:'direct'});const id=created.connection.id;
  const started=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${id}/oauth/start`,{});const state=new URL(started.authorizationUrl).searchParams.get('state')!;
  const callback=await app.inject({method:'GET',url:`/api/v1/calendar/oauth/home_assistant/callback?state=${encodeURIComponent(state)}&code=${oauthCode}`});assert.equal(callback.statusCode,302,callback.body);const completion=decodeURIComponent(String(callback.headers.location).split('#calendar-oauth=')[1]!);
  const result=await api('POST',`/api/v1/households/${householdId}/calendar-connections/oauth/home_assistant/complete`,{completionToken:completion});return result.connection.find((row:Connection)=>row.id===id)!;
}
async function selectSensor(connection:Connection,externalId='registry-temperature-a'){
  return api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors`,{expectedRevision:connection.revision,externalId});
}
async function enableSensor(connection:Connection,sensor:any,personIds:string[]=[],displayIds:string[]=[]){
  return api('PATCH',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}`,{expectedRevision:sensor.revision,enabled:true,displayName:'Outside',order:0,visibility:{household:false,personIds,displayIds}});
}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('round13 temperature integration refuses a non-isolated test database');
  keyDir=await mkdtemp(join(tmpdir(),'samvev-round13-temperature-'));await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');transport=new TemperatureTransport();app=await buildApp({calendarTransport:transport,aiKeyFile:join(keyDir,'key'),runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic round thirteen owner',email:'round13-owner@test.invalid',password:'Synthetic-round13-password-42'},household:{name:'Synthetic round thirteen',timezone:'Europe/Oslo',locale:'nb'},preferences:{locale:'nb',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);owner={cookie:cookie(claim),csrf:claim.json().csrfToken};householdId=claim.json().householdId;ownerPersonId=(await pool.query<{person_id:string}>('SELECT person_id FROM memberships WHERE id=$1',[claim.json().membershipId])).rows[0]!.person_id;installationId=(await pool.query<{id:string}>('SELECT id FROM installations WHERE singleton=true')).rows[0]!.id;
  await configureHa('active',0);
});
beforeEach(()=>{
  transport.candidates=[
    {externalId:'registry-temperature-a',entityId:'sensor.synthetic_outside',identityKind:'registry',name:'Synthetic outside',provenance:{integrationDomain:'home_assistant',platform:'sensor',registryId:'registry-temperature-a'}},
    {externalId:'registry-temperature-b',entityId:'sensor.synthetic_inside',identityKind:'registry',name:'Synthetic inside',provenance:{integrationDomain:'home_assistant',platform:'sensor',registryId:'registry-temperature-b'}}
  ];
  transport.values.set('sensor.synthetic_outside',value(-3));transport.values.set('sensor.synthetic_inside',value(68));transport.values.set('sensor.synthetic_outside_new',value(-7));
});
after(async()=>{await app.close();await pool.end();await rm(keyDir,{recursive:true,force:true});});

test('T1 previews resolve the selected registry identity before reading, even after entity id reuse',async()=>{
  const connection=await connectHa();let selected=await selectSensor(connection);let sensor=selected.connection.temperatureSensors[0];
  const initial=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});assert.equal(initial.observation.value,-3);
  transport.values.set('sensor.synthetic_outside',value(68));transport.candidates=[
    {...transport.candidates[0]!,entityId:'sensor.synthetic_outside_new'},
    {...transport.candidates[1]!,entityId:'sensor.synthetic_outside'}
  ];
  const renamed=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});
  assert.equal(renamed.observation.value,-7,'the stable selected registry entity, rather than the new owner of its old entity id, supplies the reading');
  assert.equal(transport.reads.at(-1)?.entityId,'sensor.synthetic_outside_new');
});

test('T1 a worker read cannot write across a concurrent registry binding change',async()=>{
  const connection=await connectHa();const selected=await selectSensor(connection);const sensor=selected.connection.temperatureSensors[0];
  const preview=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});assert.equal(preview.observation.value,-3);
  const configured=await enableSensor(connection,selected.connection.temperatureSensors[0],[ownerPersonId]);const enabledConnection=configured.connection;
  let started!:()=>void,release!:()=>void;const reached=new Promise<void>((resolve)=>{started=resolve;}),hold=new Promise<void>((resolve)=>{release=resolve;});transport.readBarrier={started,wait:hold};
  const poll=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/sync`,headers:headers(),payload:{expectedRevision:enabledConnection.temperatureSensors[0].revision}});await reached;
  transport.candidates=[{...transport.candidates[0]!,entityId:'sensor.synthetic_outside_new'},transport.candidates[1]!];
  await pool.query("UPDATE home_assistant_temperature_sensors SET entity_id='sensor.synthetic_outside_new' WHERE id=$1",[sensor.id]);release();const result=await poll;
  assert.equal(result.statusCode,409,result.body);assert.equal(result.json().error.details.reason,'temperature_sync_superseded');
  const stored=(await pool.query<{last_value:string|null}>('SELECT last_value FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0];assert.notEqual(stored?.last_value,'-3','a result fetched through the stale entity binding is not committed');
});

test('T2 same-account same-origin OAuth recovery schedules enabled sensors while paused sensors stay paused',async()=>{
  const connection=await connectHa(),oauthCode=`synthetic-code-${oauthCodeNumber}`;const selected=await selectSensor(connection);let sensor=selected.connection.temperatureSensors[0];
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});
  const paused=await selectSensor(selected.connection,'registry-temperature-b');const pausedId=paused.connection.temperatureSensors.find((row:any)=>row.externalId==='registry-temperature-b').id;
  const enabled=(await enableSensor(connection,selected.connection.temperatureSensors.find((row:any)=>row.id===sensor.id),[ownerPersonId])).connection;sensor=enabled.temperatureSensors.find((row:any)=>row.id===sensor.id);
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/sync`,{expectedRevision:sensor.revision});
  await pool.query("UPDATE calendar_connections SET state='syncing' WHERE id=$1",[connection.id]);
  const providerRows=await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant']);
  await configureHa('disabled',providerRows.rows[0]!.revision);
  assert.ok((await pool.query<{home_assistant_origin_hash:string|null}>('SELECT home_assistant_origin_hash FROM calendar_connections WHERE id=$1',[connection.id])).rows[0]?.home_assistant_origin_hash,'verified syncing connections retain the current normalized origin binding through disable');
  const disabled=(await pool.query<{next_poll_at:Date|null;status:string}>('SELECT next_poll_at,status FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;assert.equal(disabled.next_poll_at,null);assert.equal(disabled.status,'stale');
  const afterDisable=await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant']);await configureHa('active',afterDisable.rows[0]!.revision);
  const start=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/oauth/start`,{});const state=new URL(start.authorizationUrl).searchParams.get('state')!;
  const callback=await app.inject({method:'GET',url:`/api/v1/calendar/oauth/home_assistant/callback?state=${encodeURIComponent(state)}&code=${oauthCode}`});assert.equal(callback.statusCode,302,callback.body);const completion=decodeURIComponent(String(callback.headers.location).split('#calendar-oauth=')[1]!);
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/oauth/home_assistant/complete`,{completionToken:completion});
  const resumed=(await pool.query<{next_poll_at:Date|null;status:string;last_value:string|null}>('SELECT next_poll_at,status,last_value FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;
  assert.ok(resumed.next_poll_at,'enabled, authorized sensor should be scheduled without requiring a manual save');assert.equal(resumed.status,'stale');assert.equal(resumed.last_value,'-3');
  const stillPaused=(await pool.query<{next_poll_at:Date|null;status:string;enabled:boolean}>('SELECT next_poll_at,status,enabled FROM home_assistant_temperature_sensors WHERE id=$1',[pausedId])).rows[0]!;assert.equal(stillPaused.enabled,false);assert.equal(stillPaused.next_poll_at,null);assert.equal(stillPaused.status,'inactive');
});

test('T1 a late missing-registry preview cannot overwrite a concurrent provider disable',async()=>{
  const connection=await connectHa(),selected=await selectSensor(connection),sensor=selected.connection.temperatureSensors[0];
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});
  const enabled=(await enableSensor(connection,selected.connection.temperatureSensors[0],[ownerPersonId])).connection,saved=enabled.temperatureSensors.find((row:any)=>row.id===sensor.id)!;
  let started!:()=>void;let release!:()=>void;const reached=new Promise<void>((resolve)=>{started=resolve;}),blocked=new Promise<void>((resolve)=>{release=resolve;});transport.readBarrier={started,wait:blocked};
  const preview=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,headers:headers(),payload:{expectedRevision:saved.revision}});await reached;
  const config=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant'])).rows[0]!;await configureHa('disabled',config.revision);transport.candidates=[];release();const result=await preview;assert.equal(result.statusCode,409);
  const after=(await pool.query<{available:boolean;status:string;last_error_code:string|null;last_validated_at:Date|null;next_poll_at:Date|null}>('SELECT available,status,last_error_code,last_validated_at,next_poll_at FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;
  assert.equal(after.available,true);assert.equal(after.status,'stale');assert.equal(after.last_error_code,'CALENDAR_REAUTHORIZATION_REQUIRED');assert.ok(after.last_validated_at);assert.equal(after.next_poll_at,null);
  const disabledRevision=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant'])).rows[0]!;await configureHa('active',disabledRevision.revision);
});

test('T1 a late missing-registry worker cannot overwrite a concurrent provider disable',async()=>{
  const connection=await connectHa(),selected=await selectSensor(connection),sensor=selected.connection.temperatureSensors[0];
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});
  const enabled=(await enableSensor(connection,selected.connection.temperatureSensors[0],[ownerPersonId])).connection,saved=enabled.temperatureSensors.find((row:any)=>row.id===sensor.id)!;
  let started!:()=>void;let release!:()=>void;const reached=new Promise<void>((resolve)=>{started=resolve;}),blocked=new Promise<void>((resolve)=>{release=resolve;});transport.readBarrier={started,wait:blocked};
  const poll=app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/sync`,headers:headers(),payload:{expectedRevision:saved.revision}});await reached;
  const config=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant'])).rows[0]!;await configureHa('disabled',config.revision);transport.candidates=[];release();const result=await poll;assert.equal(result.statusCode,409);
  const after=(await pool.query<{available:boolean;status:string;last_error_code:string|null;last_validated_at:Date|null;next_poll_at:Date|null;lease_token:string|null}>('SELECT available,status,last_error_code,last_validated_at,next_poll_at,lease_token FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;
  assert.equal(after.available,true);assert.equal(after.status,'stale');assert.equal(after.last_error_code,'CALENDAR_REAUTHORIZATION_REQUIRED');assert.ok(after.last_validated_at);assert.equal(after.next_poll_at,null);assert.equal(after.lease_token,null);
  const disabledRevision=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant'])).rows[0]!;await configureHa('active',disabledRevision.revision);
});

test('T2 a different HA origin and an unknown legacy binding cannot resume old sensor choices',async()=>{
  for(const scenario of ['changed-origin','unknown-binding'] as const){
    const connection=await connectHa(),oauthCode=`synthetic-code-${oauthCodeNumber}`;const selected=await selectSensor(connection);const sensor=selected.connection.temperatureSensors[0];
    await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});const enabled=(await enableSensor(connection,sensor,[ownerPersonId])).connection;const validated=enabled.temperatureSensors.find((row:any)=>row.id===sensor.id)!;await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/sync`,{expectedRevision:validated.revision});
    const provider=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant'])).rows[0]!.revision;await configureHa('disabled',provider);
    if(scenario==='unknown-binding')await pool.query('UPDATE calendar_connections SET home_assistant_origin_hash=NULL WHERE id=$1',[connection.id]);
    const afterDisable=(await pool.query<{revision:number}>('SELECT revision FROM installation_calendar_provider_configs WHERE installation_id=$1 AND provider=$2',[installationId,'home_assistant'])).rows[0]!.revision;await configureHa('active',afterDisable,scenario==='changed-origin'?'http://synthetic-ha-new.invalid':'http://synthetic-ha.invalid');
    const start=await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/oauth/start`,{});const state=new URL(start.authorizationUrl).searchParams.get('state')!;
    const callback=await app.inject({method:'GET',url:`/api/v1/calendar/oauth/home_assistant/callback?state=${encodeURIComponent(state)}&code=${oauthCode}`});assert.equal(callback.statusCode,302,callback.body);const completion=decodeURIComponent(String(callback.headers.location).split('#calendar-oauth=')[1]!);const completed=await api('POST',`/api/v1/households/${householdId}/calendar-connections/oauth/home_assistant/complete`,{completionToken:completion});
    const unchanged=(await pool.query<{next_poll_at:Date|null;available:boolean;last_error_code:string|null}>('SELECT next_poll_at,available,last_error_code FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;
    assert.equal(unchanged.next_poll_at,null,`${scenario} cannot transfer sensor polling authority`);assert.equal(unchanged.available,false);assert.equal(unchanged.last_error_code,'HOME_ASSISTANT_ORIGIN_CHANGED');
    if(scenario==='changed-origin'){
      let restored=completed.connection.find((row:Connection)=>row.id===connection.id)!;restored=(await selectSensor(restored,'registry-temperature-a')).connection;restored=(await selectSensor(restored,'registry-temperature-a')).connection;const selectedAgain=restored.temperatureSensors.find((row:any)=>row.id===sensor.id)!;const readCount=transport.reads.length;
      const forced=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/sync`,headers:headers(),payload:{expectedRevision:selectedAgain.revision}});
      assert.equal(forced.statusCode,409,'reselecting twice cannot bypass the origin-change validation gate');assert.equal(transport.reads.length,readCount,'no HA value is fetched before successful preview and explicit reapproval');
      const fenced=(await pool.query<{enabled:boolean;last_value:string|null;last_successful_poll_at:Date|null;integration_item_id:string|null}>('SELECT enabled,last_value,last_successful_poll_at,integration_item_id FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;assert.equal(fenced.enabled,false,'old authorization is paused after origin change');assert.equal(fenced.last_value,'-3','the previous observation remains stored for audit');assert.equal(fenced.last_successful_poll_at,null,'the previous origin no longer has current-source validation');
      const oldItem=(await pool.query<{temperature:any}>('SELECT metadata->\'temperature\' AS temperature FROM integration_items WHERE id=$1',[fenced.integration_item_id])).rows[0]!.temperature;assert.equal(oldItem.value,null);assert.equal(oldItem.lastValidValue,null);assert.equal(oldItem.reason,'origin_changed');
      transport.values.set('sensor.synthetic_outside',value(31));const preview=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,headers:headers(),payload:{expectedRevision:selectedAgain.revision}});assert.equal(preview.statusCode,200,preview.body);
      const afterPreview=(await pool.query<{enabled:boolean;available:boolean;last_value:string|null;last_successful_poll_at:Date|null;next_poll_at:Date|null;revision:number}>('SELECT enabled,available,last_value,last_successful_poll_at,next_poll_at,revision FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!;assert.equal(afterPreview.enabled,false);assert.equal(afterPreview.available,true);assert.equal(afterPreview.last_value,'-3','previous observation remains persisted');assert.equal(afterPreview.last_successful_poll_at,null);assert.equal(afterPreview.next_poll_at,null,'preview alone does not reauthorize polling');
      const approved=await enableSensor({id:connection.id,revision:restored.revision,sources:[],temperatureSensors:[]}, {...selectedAgain,revision:afterPreview.revision},[ownerPersonId]);const approvedSensor=approved.connection.temperatureSensors.find((row:any)=>row.id===sensor.id)!;
      const allowedSync=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/sync`,headers:headers(),payload:{expectedRevision:approvedSensor.revision}});assert.equal(allowedSync.statusCode,200,allowedSync.body);assert.equal((await pool.query<{last_value:string}>('SELECT last_value FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]?.last_value,'31');
    }
    void enabled;
  }
});

test('T3 allowed temperature items survive the home item cap and remain filtered by reader ACL',async()=>{
  const connection=await connectHa();let selected=await selectSensor(connection);let sensor=selected.connection.temperatureSensors[0];
  await api('POST',`/api/v1/households/${householdId}/calendar-connections/${connection.id}/temperature-sensors/${sensor.id}/preview`,{expectedRevision:sensor.revision});
  const displayToken='round13-synthetic-display-credential';const displayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,external_items_enabled,credential_hash,credential_expires_at) VALUES($1,'Synthetic panel','nb','light',true,$2,clock_timestamp()+interval '1 hour') RETURNING id`,[householdId,tokenHash(displayToken)])).rows[0]!.id;
  selected=(await enableSensor(connection,selected.connection.temperatureSensors[0],[ownerPersonId],[displayId])).connection;sensor=selected.temperatureSensors[0];
  const integrationId=(await pool.query<{integration_connection_id:string}>('SELECT integration_connection_id FROM calendar_connections WHERE id=$1',[connection.id])).rows[0]!.integration_connection_id;
  const digest=createHash('sha256').update('round13-calendar-items').digest('hex');
  const seedItems=async(prefix:string,count:number,targetHousehold:boolean,displayTarget?:string)=>{
    const ids=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,status,request_hash)
      SELECT $1,$2,$3||n,'event',$4,'Synthetic event '||n,'Synthetic calendar body','normal',clock_timestamp()+n*interval '1 minute',clock_timestamp()+(n+1)*interval '1 minute','{"label":"Synthetic calendar"}'::jsonb,'{}'::jsonb,'active',$5 FROM generate_series(1,$6) n RETURNING id`,[householdId,integrationId,prefix,targetHousehold,digest,count])).rows;
    if(displayTarget&&ids.length)await pool.query(`INSERT INTO integration_item_display_targets(household_id,item_id,display_id) SELECT $1,unnest($2::uuid[]),$3`,[householdId,ids.map((row)=>row.id),displayTarget]);
  };
  await seedItems('round13-home-event-',300,true);const home=await api('GET',`/api/v1/households/${householdId}/home`);assert.equal(home.items.filter((item:any)=>item.metadata?.temperature?.sensorId===sensor.id).length,1,'a permitted temperature remains present after 300 calendar items');
  const restrictedPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic restricted reader','child') RETURNING id`,[householdId])).rows[0]!.id;const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'round13-reader@test.invalid','unused','nb','light') RETURNING id`,[installationId])).rows[0]!.id;const token='round13-synthetic-reader-session',csrf='round13-synthetic-reader-csrf';await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'limited',$4)`,[householdId,account,restrictedPerson,JSON.stringify(['household.view'])]);await pool.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`,[account,tokenHash(token),tokenHash(csrf)]);const restricted={cookie:`samvev_session=${token}`,csrf};
  const privateHome=await api('GET',`/api/v1/households/${householdId}/home`,undefined,restricted);assert.equal(privateHome.items.some((item:any)=>item.metadata?.temperature?.sensorId===sensor.id),false,'a person outside the reader ACL gets no value or sensor metadata');
  await pool.query('INSERT INTO home_assistant_temperature_person_readers(household_id,sensor_id,person_id) VALUES($1,$2,$3)',[householdId,sensor.id,restrictedPerson]);
  const itemId=(await pool.query<{integration_item_id:string}>('SELECT integration_item_id FROM home_assistant_temperature_sensors WHERE id=$1',[sensor.id])).rows[0]!.integration_item_id;
  await pool.query('DELETE FROM integration_item_person_targets WHERE item_id=$1 AND person_id=$2',[itemId,restrictedPerson]);
  const divergedHome=await api('GET',`/api/v1/households/${householdId}/home`,undefined,restricted);assert.equal(divergedHome.items.some((item:any)=>item.metadata?.temperature?.sensorId===sensor.id),false,'sensor ACL cannot widen the original integration-item ACL');
  await seedItems('round13-display-event-',200,false,displayId);const projection=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:`samvev_display=${displayToken}`}});assert.equal(projection.statusCode,200,projection.body);assert.equal(projection.json().hub.items.filter((item:any)=>item.metadata?.temperature?.sensorId===sensor.id).length,1,'the explicitly granted display receives the temperature independently of its 200-item calendar cap');
  await pool.query('DELETE FROM home_assistant_temperature_display_targets WHERE sensor_id=$1 AND display_id=$2',[sensor.id,displayId]);const noLongerGranted=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:`samvev_display=${displayToken}`}});assert.equal(noLongerGranted.statusCode,200,noLongerGranted.body);assert.equal(noLongerGranted.json().hub.items.some((item:any)=>item.metadata?.temperature?.sensorId===sensor.id),false,'removing the sensor-specific display grant removes its value and metadata');
});
