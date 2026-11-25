import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {DomainError} from '@samvev/core';
import {buildApp} from './app.ts';
import {AiCredentialVault} from './ai/credential-vault.ts';
import {
  CalendarService,DefaultCalendarTransport,runCalendarSyncBatch,
  type CalendarActor,type CalendarEvent,type CalendarPage,type CalendarTokenSet,type CalendarTransport
} from './calendar/service.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';

const guard=new URL(process.env.DATABASE_URL??'');
if(guard.hostname!=='test-db'||guard.pathname!=='/samvev_test')throw new Error('Round 10 integration tests refuse non-isolated DATABASE_URL');

let app:FastifyInstance,keyDirectory:string,actor:CalendarActor,sessionCookie:string;
let transport:SyntheticCalendarTransport,service:CalendarService,vault:AiCredentialVault;

class SyntheticCalendarTransport implements CalendarTransport{
  providerSubject='round10-provider-account';
  events:CalendarEvent[]=[{uid:'stable-event',instanceId:'single',title:'Synthetic stable event',start:'2026-11-10T09:00:00Z',end:'2026-11-10T10:00:00Z',allDay:false,cancelled:false}];
  pageMode=false;
  advanceClock?:()=>void;
  refreshFailure:unknown;
  eventRequests:Array<{window:{from:string;to:string};pageToken?:string}>=[];
  exchangeCode(_provider:'google'|'microsoft',_input:{code:string;verifier:string;redirectUri:string}):Promise<CalendarTokenSet>{return Promise.resolve({accessToken:'round10-access',refreshToken:'round10-refresh',expiresAt:new Date(Date.now()+3_600_000).toISOString(),scopes:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'],providerSubject:this.providerSubject,accountLabel:'round10@test.invalid'});}
  refresh():Promise<CalendarTokenSet>{if(this.refreshFailure)return Promise.reject(this.refreshFailure);return Promise.resolve({accessToken:'round10-refreshed',refreshToken:'round10-rotated',expiresAt:new Date(Date.now()+3_600_000).toISOString(),scopes:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'],providerSubject:'retained'});}
  revoke():Promise<'confirmed'>{return Promise.resolve('confirmed');}
  listCalendars():Promise<CalendarPage<{externalId:string;name:string}>>{return Promise.resolve({items:[{externalId:'round10-primary',name:'Round 10 primary'}]});}
  async listEvents(_provider:'google'|'microsoft'|'ics',_accessToken:string,_calendarId:string,window:{from:string;to:string},pageToken?:string):Promise<CalendarPage<CalendarEvent>>{
    this.eventRequests.push({window:{...window},...(pageToken?{pageToken}:{})});
    this.advanceClock?.();
    await new Promise((resolve)=>setTimeout(resolve,8));
    if(!this.pageMode)return{items:this.events};
    if(!pageToken)return{items:[this.events[0]!],nextPageToken:'empty-middle'};
    if(pageToken==='empty-middle')return{items:[],nextPageToken:'last-page'};
    return{items:[{...this.events[0]!,uid:'second-event',title:'Synthetic second event'}]};
  }
  fetchIcs():Promise<string>{throw new Error('unused');}
}

type Deferred<T>={arrived:Promise<void>;started:()=>void;resolve:(value:T)=>void;reject:(error:unknown)=>void;promise:Promise<T>};
function deferred<T>():Deferred<T>{
  let resolvePromise!:(value:T)=>void, rejectPromise!:(error:unknown)=>void, arrive!:(value:void)=>void;
  const arrived=new Promise<void>((resolve)=>{arrive=resolve;});
  const promise=new Promise<T>((resolve,reject)=>{resolvePromise=resolve;rejectPromise=reject;});
  return{arrived,started:()=>arrive(),resolve:resolvePromise,reject:rejectPromise,promise};
}
async function within<T>(promise:Promise<T>,label:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Timed out waiting for ${label}`)),2_000);})]);}
  finally{if(timer)clearTimeout(timer);}
}
class GatedCalendarTransport extends SyntheticCalendarTransport{
  exchangeGate?:Deferred<CalendarTokenSet>;
  eventsGate?:Deferred<CalendarPage<CalendarEvent>>;
  override exchangeCode(provider:'google'|'microsoft',input:{code:string;verifier:string;redirectUri:string}){
    if(this.exchangeGate){const gate=this.exchangeGate;this.exchangeGate=undefined;gate.started();return gate.promise;}
    return super.exchangeCode(provider,input);
  }
  override listEvents(provider:'google'|'microsoft'|'ics',token:string,calendarId:string,window:{from:string;to:string},pageToken?:string){
    if(this.eventsGate){const gate=this.eventsGate;this.eventsGate=undefined;gate.started();return gate.promise;}
    return super.listEvents(provider,token,calendarId,window,pageToken);
  }
}

function cookie(response:LightMyRequestResponse){const value=response.headers['set-cookie'];return (Array.isArray(value)?value:[value!]).map((part)=>part.split(';')[0]).join('; ');}

async function connectedCalendar(name:string){
  transport.providerSubject=`round10-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
  const created=await service.create(actor,{provider:'google',name,bridgeKind:'direct'});
  const started=await service.startOAuth(actor,created.id,'https://samvev.test.invalid');
  const state=new URL(started.authorizationUrl).searchParams.get('state')!;
  const staged=await service.stageOAuthCallback('google',state,'synthetic-code');
  assert.equal(staged.denied,false);
  await service.completeOAuth(actor,'google',(staged as {completionToken:string}).completionToken);
  const connected=await service.get(actor,created.id);
  return{connectionId:created.id,source:(connected.sources as Array<any>)[0]};
}

async function stagedOAuth(serviceForTest:CalendarService,name:string){
  const created=await serviceForTest.create(actor,{provider:'google',name,bridgeKind:'direct'});
  const started=await serviceForTest.startOAuth(actor,created.id,'https://samvev.test.invalid');
  const state=new URL(started.authorizationUrl).searchParams.get('state')!;
  const staged=await serviceForTest.stageOAuthCallback('google',state,'synthetic-gated-code');
  assert.equal(staged.denied,false);
  return{connectionId:created.id,completionToken:(staged as {completionToken:string}).completionToken};
}
async function enableSource(serviceForTest:CalendarService,connectionId:string){
  const connection=await serviceForTest.get(actor,connectionId);
  const source=(connection.sources as Array<any>)[0]!;
  await serviceForTest.updateSource(actor,connectionId,source.id,{expectedRevision:source.revision,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});
  return source.id;
}
function gatedTokens(subject:string):CalendarTokenSet{return{accessToken:'round10-gated-access',refreshToken:'round10-gated-refresh',expiresAt:new Date(Date.now()+3_600_000).toISOString(),scopes:['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'],providerSubject:subject,accountLabel:'round10-gated@test.invalid'};}

before(async()=>{
  process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_ID='round10-google-client';
  process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET='round10-google-secret';
  process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID='round10-microsoft-client';
  process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET='round10-microsoft-secret';
  keyDirectory=await mkdtemp(join(tmpdir(),'samvev-round10-'));
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  transport=new SyntheticCalendarTransport();
  const keyFile=join(keyDirectory,'key');
  vault=new AiCredentialVault(keyFile);service=new CalendarService(transport,vault);
  app=await buildApp({calendarTransport:transport,aiKeyFile:keyFile,runtimeConfig:{publicOrigin:'https://samvev.test.invalid',secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin:'https://samvev.test.invalid'}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin:'https://samvev.test.invalid'},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Round 10 Owner',email:'round10-owner@test.invalid',password:'Synthetic-password-42'},household:{name:'Round 10 household',timezone:'Europe/Oslo',locale:'nb'},preferences:{locale:'nb',theme:'system'}}});
  assert.equal(claim.statusCode,200,claim.body);sessionCookie=cookie(claim);
  const identity=(await pool.query<{account_id:string;session_id:string;installation_id:string;household_id:string;membership_id:string;capabilities:string[]}>(`SELECT a.id account_id,s.id session_id,a.installation_id,m.household_id,m.id membership_id,m.capabilities FROM accounts a JOIN sessions s ON s.account_id=a.id JOIN memberships m ON m.account_id=a.id WHERE a.email_normalized='round10-owner@test.invalid'`)).rows[0]!;
  actor={accountId:identity.account_id,sessionId:identity.session_id,installationId:identity.installation_id,householdId:identity.household_id,membershipId:identity.membership_id,capabilities:identity.capabilities};
});

after(async()=>{await app.close();await pool.end();await rm(keyDirectory,{recursive:true,force:true});});

test('source edits converge source-derived metadata without replacing occurrences or grants',async()=>{
  const {connectionId,source}=await connectedCalendar('Metadata calendar');
  const child=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Round 10 child','child') RETURNING id`,[actor.householdId])).rows[0]!;
  const display=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,privacy_mode,external_items_enabled) VALUES($1,'Round 10 display','nb','light',false,true) RETURNING id`,[actor.householdId])).rows[0]!;
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:1,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[display.id]}});
  await service.syncConnection(connectionId);
  const initial=(await pool.query<any>(`SELECT item.id,item.external_id,item.revision,item.metadata,occurrence.id occurrence_id FROM integration_items item JOIN calendar_occurrences occurrence ON occurrence.integration_item_id=item.id WHERE occurrence.source_id=$1 AND occurrence.status='active'`,[source.id])).rows[0]!;
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:2,enabled:true,bridgeKind:'spond_calendar',appliesTo:{household:false,personIds:[child.id]},visibility:{household:true,personIds:[],displayIds:[display.id]}});
  const changed=(await pool.query<any>('SELECT id,external_id,revision,metadata FROM integration_items WHERE id=$1',[initial.id])).rows[0]!;
  assert.equal(changed.id,initial.id);assert.equal(changed.external_id,initial.external_id);assert.equal(changed.metadata.calendar.subjectHousehold,false);assert.equal(changed.metadata.calendar.bridgeKind,'spond_calendar');
  assert.equal((await pool.query(`SELECT count(*)::int count FROM integration_connection_display_grants WHERE display_id=$1`,[display.id])).rows[0].count,1);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM integration_item_person_subjects WHERE item_id=$1 AND person_id=$2`,[initial.id,child.id])).rows[0].count,1);
  const revisionAfterEdit=changed.revision;await service.syncConnection(connectionId);
  const converged=(await pool.query<any>('SELECT id,external_id,revision,metadata FROM integration_items WHERE id=$1',[initial.id])).rows[0]!;
  assert.equal(converged.id,changed.id);assert.equal(converged.external_id,changed.external_id,'an unchanged provider snapshot keeps the occurrence identity');assert.equal(converged.revision,revisionAfterEdit+1,'a newly observed event advances its item-level observation metadata');assert.equal(converged.metadata.calendar.subjectHousehold,changed.metadata.calendar.subjectHousehold);assert.equal(converged.metadata.calendar.bridgeKind,changed.metadata.calendar.bridgeKind);assert.notEqual(converged.metadata.calendar.lastSuccessfulSyncAt,changed.metadata.calendar.lastSuccessfulSyncAt);
  const secondChild=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Round 10 second child','child') RETURNING id`,[actor.householdId])).rows[0]!;
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:3,enabled:true,bridgeKind:'direct',appliesTo:{household:false,personIds:[child.id,secondChild.id]},visibility:{household:true,personIds:[],displayIds:[display.id]}});
  assert.equal((await pool.query(`SELECT count(*)::int count FROM integration_item_person_subjects WHERE item_id=$1`,[initial.id])).rows[0].count,2);assert.equal((await pool.query(`SELECT metadata#>>'{calendar,bridgeKind}' bridge FROM integration_items WHERE id=$1`,[initial.id])).rows[0].bridge,'direct');
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:4,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[display.id]}});
  const household=(await pool.query<any>('SELECT id,external_id,metadata FROM integration_items WHERE id=$1',[initial.id])).rows[0]!;assert.equal(household.metadata.calendar.subjectHousehold,true);assert.equal((await pool.query(`SELECT count(*)::int count FROM integration_item_person_subjects WHERE item_id=$1`,[initial.id])).rows[0].count,0);assert.equal((await pool.query(`SELECT count(*)::int count FROM integration_item_display_targets WHERE item_id=$1 AND display_id=$2`,[initial.id,display.id])).rows[0].count,1);
  await pool.query(`UPDATE integration_items SET metadata=jsonb_set(metadata,'{calendar,subjectHousehold}','false'::jsonb),revision=revision+1 WHERE id=$1`,[initial.id]);
  const staleRevision=(await pool.query<{revision:number}>('SELECT revision FROM integration_items WHERE id=$1',[initial.id])).rows[0]!.revision;await service.syncConnection(connectionId);
  const repaired=(await pool.query<any>('SELECT id,external_id,revision,metadata FROM integration_items WHERE id=$1',[initial.id])).rows[0]!;
  assert.equal(repaired.metadata.calendar.subjectHousehold,true);assert.equal(repaired.revision,staleRevision+1);assert.equal(repaired.id,initial.id);assert.equal(repaired.external_id,initial.external_id);
});

test('reauthorization owns one generation, preserves provider binding and schedules enabled sources',async()=>{
  const {connectionId,source}=await connectedCalendar('Reauthorization calendar');
  assert.equal((await pool.query('SELECT next_sync_at FROM calendar_connections WHERE id=$1',[connectionId])).rows[0].next_sync_at,null,'first consent with no enabled source remains unscheduled');
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:1,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});
  await pool.query(`UPDATE calendar_connections SET state='expired',last_error_code='CALENDAR_REAUTHORIZATION_REQUIRED',next_sync_at=NULL,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE id=$1`,[connectionId]);
  const generationBefore=(await pool.query<{sync_generation:number}>('SELECT sync_generation FROM calendar_connections WHERE id=$1',[connectionId])).rows[0]!.sync_generation;
  const oldAttempt=(await pool.query<{id:string}>(`INSERT INTO calendar_sync_attempts(connection_id,generation,outcome) VALUES($1,$2,'started') RETURNING id`,[connectionId,generationBefore+1])).rows[0]!;
  const first=await service.startOAuth(actor,connectionId,'https://samvev.test.invalid');const firstState=new URL(first.authorizationUrl).searchParams.get('state')!;const oldStaged=await service.stageOAuthCallback('google',firstState,'old-code');assert.equal(oldStaged.denied,false);
  assert.equal((await pool.query('SELECT outcome FROM calendar_sync_attempts WHERE id=$1',[oldAttempt.id])).rows[0].outcome,'superseded');
  const second=await service.startOAuth(actor,connectionId,'https://samvev.test.invalid');
  const fenced=(await pool.query<any>('SELECT sync_generation,lease_token,lease_expires_at FROM calendar_connections WHERE id=$1',[connectionId])).rows[0]!;assert.equal(fenced.sync_generation,generationBefore+2);assert.equal(fenced.lease_token,null);assert.equal(fenced.lease_expires_at,null);
  await assert.rejects(()=>service.completeOAuth(actor,'google',(oldStaged as {completionToken:string}).completionToken),(error:any)=>error.details?.reason==='calendar_oauth_state_invalid'||error.details?.reason==='calendar_oauth_superseded');
  const secondState=new URL(second.authorizationUrl).searchParams.get('state')!;const staged=await service.stageOAuthCallback('google',secondState,'new-code');await service.completeOAuth(actor,'google',(staged as {completionToken:string}).completionToken);
  const ready=(await pool.query<any>('SELECT state,next_sync_at FROM calendar_connections WHERE id=$1',[connectionId])).rows[0]!;assert.equal(ready.state,'connected');assert.ok(ready.next_sync_at instanceof Date);
  const batch=await runCalendarSyncBatch(service);assert.deepEqual(batch,{claimed:1,succeeded:1,failed:0});
  const reboundStart=await service.startOAuth(actor,connectionId,'https://samvev.test.invalid');const reboundState=new URL(reboundStart.authorizationUrl).searchParams.get('state')!;const rebound=await service.stageOAuthCallback('google',reboundState,'different-account');transport.providerSubject='different-provider-account';
  await assert.rejects(()=>service.completeOAuth(actor,'google',(rebound as {completionToken:string}).completionToken),(error:any)=>error.details?.reason==='calendar_provider_account_mismatch');
  transport.providerSubject='round10-reauthorization-calendar';
  const boundBefore=(await pool.query('SELECT provider_subject_hash FROM calendar_connections WHERE id=$1',[connectionId])).rows[0].provider_subject_hash;const disconnected=await service.disconnect(actor,connectionId,3);assert.equal(disconnected.state,'disconnected');assert.equal((await pool.query('SELECT provider_subject_hash FROM calendar_connections WHERE id=$1',[connectionId])).rows[0].provider_subject_hash,boundBefore);assert.equal((await runCalendarSyncBatch(service)).claimed,0);
});

test('a delayed OAuth exchange cannot commit after a newer consent generation',async()=>{
  const gated=new GatedCalendarTransport(),gatedService=new CalendarService(gated,vault);
  const staged=await stagedOAuth(gatedService,'Gated OAuth reauthorization');
  const gate=deferred<CalendarTokenSet>();gated.exchangeGate=gate;
  const completing=gatedService.completeOAuth(actor,'google',staged.completionToken);
  try{
    await within(gate.arrived,'the delayed OAuth exchange');
    await gatedService.startOAuth(actor,staged.connectionId,'https://samvev.test.invalid');
    gate.resolve(gatedTokens('round10-gated-newer-consent'));
    await assert.rejects(()=>within(completing,'the fenced OAuth completion'),(error:any)=>error.details?.reason==='calendar_oauth_superseded');
    const row=(await pool.query<any>('SELECT state,credential_ciphertext,next_sync_at,provider_subject_hash FROM calendar_connections WHERE id=$1',[staged.connectionId])).rows[0]!;
    assert.deepEqual(row,{state:'awaiting_consent',credential_ciphertext:null,next_sync_at:null,provider_subject_hash:null});
    assert.equal((await pool.query('SELECT count(*)::int count FROM calendar_sources WHERE connection_id=$1',[staged.connectionId])).rows[0].count,0,'a late exchange must not add source rows');
  }finally{gate.resolve(gatedTokens('round10-gated-cleanup'));await completing.catch(()=>undefined);}
});

test('a delayed OAuth exchange rechecks the initiating session before it commits',async()=>{
  const gated=new GatedCalendarTransport(),gatedService=new CalendarService(gated,vault);
  const staged=await stagedOAuth(gatedService,'Gated OAuth revoked session');
  const gate=deferred<CalendarTokenSet>();gated.exchangeGate=gate;
  const completing=gatedService.completeOAuth(actor,'google',staged.completionToken);
  try{
    await within(gate.arrived,'the delayed OAuth exchange before session revocation');
    await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1',[actor.sessionId]);
    gate.resolve(gatedTokens('round10-gated-revoked-session'));
    await assert.rejects(()=>within(completing,'the revoked-session OAuth completion'),(error:any)=>error.details?.reason==='calendar_oauth_superseded');
    const row=(await pool.query<any>('SELECT state,credential_ciphertext,next_sync_at FROM calendar_connections WHERE id=$1',[staged.connectionId])).rows[0]!;
    assert.deepEqual(row,{state:'awaiting_consent',credential_ciphertext:null,next_sync_at:null});
  }finally{
    gate.resolve(gatedTokens('round10-gated-cleanup'));
    await completing.catch(()=>undefined);
    await pool.query('UPDATE sessions SET revoked_at=NULL WHERE id=$1',[actor.sessionId]);
  }
});

test('a delayed OAuth exchange cannot revive a disconnected connection',async()=>{
  const gated=new GatedCalendarTransport(),gatedService=new CalendarService(gated,vault);
  const staged=await stagedOAuth(gatedService,'Gated OAuth disconnect');
  const gate=deferred<CalendarTokenSet>();gated.exchangeGate=gate;
  const completing=gatedService.completeOAuth(actor,'google',staged.completionToken);
  try{
    await within(gate.arrived,'the delayed OAuth exchange before disconnect');
    const current=await gatedService.get(actor,staged.connectionId);
    await gatedService.disconnect(actor,staged.connectionId,current.revision);
    gate.resolve(gatedTokens('round10-gated-disconnected'));
    await assert.rejects(()=>within(completing,'the disconnected OAuth completion'),(error:any)=>error.details?.reason==='calendar_oauth_superseded');
    const row=(await pool.query<any>(`SELECT connection.state,connection.credential_ciphertext,connection.next_sync_at,connection.disconnected_at,authority.revoked_at FROM calendar_connections connection JOIN integration_connections authority ON authority.id=connection.integration_connection_id WHERE connection.id=$1`,[staged.connectionId])).rows[0]!;
    assert.equal(row.state,'disconnected');assert.equal(row.credential_ciphertext,null);assert.equal(row.next_sync_at,null);assert.ok(row.disconnected_at);assert.ok(row.revoked_at);
  }finally{gate.resolve(gatedTokens('round10-gated-cleanup'));await completing.catch(()=>undefined);}
});

test('a delayed calendar worker cannot reconcile after reauthorization or disconnect',async()=>{
  for(const action of ['reauthorize','disconnect'] as const){
    const gated=new GatedCalendarTransport(),gatedService=new CalendarService(gated,vault);
    gated.providerSubject=`round10-gated-worker-${action}`;
    const {connectionId,source}=await (async()=>{
      const created=await gatedService.create(actor,{provider:'google',name:`Gated worker ${action}`,bridgeKind:'direct'});
      const start=await gatedService.startOAuth(actor,created.id,'https://samvev.test.invalid');
      const state=new URL(start.authorizationUrl).searchParams.get('state')!;
      const callback=await gatedService.stageOAuthCallback('google',state,'synthetic-initial-code');
      await gatedService.completeOAuth(actor,'google',(callback as {completionToken:string}).completionToken);
      const connected=await gatedService.get(actor,created.id);return{connectionId:created.id,source:(connected.sources as Array<any>)[0]!};
    })();
    await gatedService.updateSource(actor,connectionId,source.id,{expectedRevision:source.revision,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});
    const gate=deferred<CalendarPage<CalendarEvent>>();gated.eventsGate=gate;
    const syncing=gatedService.syncConnection(connectionId);
    try{
      await within(gate.arrived,`the delayed worker ${action} fetch`);
      if(action==='reauthorize')await gatedService.startOAuth(actor,connectionId,'https://samvev.test.invalid');
      else{const current=await gatedService.get(actor,connectionId);await gatedService.disconnect(actor,connectionId,current.revision);}
      gate.resolve({items:gated.events});
      await assert.rejects(()=>within(syncing,`the fenced worker ${action} completion`),(error:any)=>error.details?.reason==='calendar_sync_superseded');
      const row=(await pool.query<any>('SELECT state,next_sync_at,lease_token,lease_expires_at,credential_ciphertext,disconnected_at FROM calendar_connections WHERE id=$1',[connectionId])).rows[0]!;
      assert.equal(row.lease_token,null);assert.equal(row.lease_expires_at,null);assert.equal(row.next_sync_at,null);
      if(action==='reauthorize'){assert.equal(row.state,'awaiting_consent');assert.equal(row.disconnected_at,null);assert.ok(row.credential_ciphertext);}
      else{assert.equal(row.state,'disconnected');assert.equal(row.credential_ciphertext,null);assert.ok(row.disconnected_at);}
      assert.equal((await pool.query('SELECT count(*)::int count FROM calendar_occurrences WHERE source_id=$1 AND status=\'active\'',[source.id])).rows[0].count,0,'late worker output must not make an event visible');
    }finally{gate.resolve({items:gated.events});await syncing.catch(()=>undefined);}
  }
});

test('token endpoint errors are context-specific and never expose provider descriptions',async(t)=>{
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const cases=[
    {status:400,body:{error:'invalid_grant',error_description:'do-not-leak'},reason:'calendar_reauthorization_required',code:'CONFLICT'},
    {status:401,body:{error:'invalid_client',error_description:'do-not-leak'},reason:'calendar_client_configuration_invalid',code:'AI_CONFIGURATION_INVALID'},
    {status:400,body:{error:'unauthorized_client'},reason:'calendar_client_configuration_invalid',code:'AI_CONFIGURATION_INVALID'},
    {status:400,body:{error:'invalid_scope'},reason:'calendar_client_configuration_invalid',code:'AI_CONFIGURATION_INVALID'},
    {status:400,body:{error:'unrelated'},reason:'calendar_provider_unavailable',code:'MONITOR_SOURCE_UNAVAILABLE'},
    {status:429,body:{error:'slow_down'},reason:'calendar_provider_unavailable',code:'MONITOR_SOURCE_UNAVAILABLE'},
    {status:503,body:{error:'temporarily_unavailable'},reason:'calendar_provider_unavailable',code:'MONITOR_SOURCE_UNAVAILABLE'}
  ];
  for(const provider of ['google','microsoft'] as const)for(const item of cases){globalThis.fetch=async()=>new Response(JSON.stringify(item.body),{status:item.status,headers:{'content-type':'application/json'}});await assert.rejects(()=>new DefaultCalendarTransport().refresh(provider,'synthetic-refresh'),(error:any)=>{assert.equal(error.code,item.code);assert.equal(error.details?.reason,item.reason);assert.equal(JSON.stringify(error).includes('do-not-leak'),false);return true;});}
  globalThis.fetch=async()=>{throw new TypeError('synthetic network failure with private detail');};
  await assert.rejects(()=>new DefaultCalendarTransport().refresh('microsoft','synthetic-refresh'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details?.reason==='calendar_provider_unavailable'&&!JSON.stringify(error).includes('private detail'));
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('private response stream detail'));}}),{status:503});
  await assert.rejects(()=>new DefaultCalendarTransport().refresh('google','synthetic-refresh'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details?.reason==='calendar_provider_unavailable'&&!JSON.stringify(error).includes('private response'));
});

test('refresh failures stop only permanent retries and expose allowlisted connection status',async()=>{
  const {connectionId,source}=await connectedCalendar('Refresh classification calendar');
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:1,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});
  const aad=`${actor.householdId}:calendar:${connectionId}:account:${actor.accountId}`;
  const expire=async()=>pool.query(`UPDATE calendar_connections SET state='connected',credential_ciphertext=$2,next_sync_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE id=$1`,[connectionId,await vault.encrypt(aad,JSON.stringify({accessToken:'expired-access',refreshToken:'round10-refresh',expiresAt:'2020-01-01T00:00:00.000Z',providerSubject:'round10-refresh-classification-calendar'}))]);
  await expire();transport.refreshFailure=new DomainError('CONFLICT',409,{reason:'calendar_reauthorization_required',providerDescription:'must-not-persist'});await assert.rejects(()=>service.syncConnection(connectionId));
  assert.deepEqual((await pool.query(`SELECT state,last_error_code,next_sync_at FROM calendar_connections WHERE id=$1`,[connectionId])).rows[0],{state:'expired',last_error_code:'CALENDAR_REAUTHORIZATION_REQUIRED',next_sync_at:null});assert.equal(JSON.stringify((await pool.query(`SELECT last_error_code FROM calendar_connections WHERE id=$1`,[connectionId])).rows[0]).includes('must-not-persist'),false);
  transport.refreshFailure=undefined;const restart=await service.startOAuth(actor,connectionId,'https://samvev.test.invalid');const state=new URL(restart.authorizationUrl).searchParams.get('state')!;const staged=await service.stageOAuthCallback('google',state,'recovered');await service.completeOAuth(actor,'google',(staged as {completionToken:string}).completionToken);assert.ok((await pool.query('SELECT next_sync_at FROM calendar_connections WHERE id=$1',[connectionId])).rows[0].next_sync_at instanceof Date);
  await expire();transport.refreshFailure=new DomainError('AI_CONFIGURATION_INVALID',422,{reason:'calendar_client_configuration_invalid',providerDescription:'must-not-persist'});await assert.rejects(()=>service.syncConnection(connectionId));
  assert.deepEqual((await pool.query(`SELECT state,last_error_code,next_sync_at FROM calendar_connections WHERE id=$1`,[connectionId])).rows[0],{state:'error',last_error_code:'CALENDAR_CLIENT_CONFIGURATION_INVALID',next_sync_at:null});transport.refreshFailure=undefined;
});

test('person summaries use one current-revision logical attempt and retain an older valid result',async()=>{
  const person=(await pool.query<{id:string}>('SELECT person_id id FROM memberships WHERE id=$1',[actor.membershipId])).rows[0]!;
  const createTask=async(name:string,revision=1)=>{const row=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,interpreted_rule,revision,approved_revision,next_check_at) VALUES($1,$2,$3,'Read synthetic source.','https://example.test.invalid/round10','active',60,1,'18:00','default','routine','{}',$4,$4,clock_timestamp()+interval '1 hour') RETURNING id`,[actor.householdId,actor.membershipId,name,revision])).rows[0]!;await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)',[actor.householdId,row.id,person.id]);return row;};
  const never=await createTask('Round 10 never run');let summaries=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks;const neverSummary=summaries.find((item:any)=>item.id===never.id)!;assert.equal(neverSummary.status,'not_run');assert.equal(neverSummary.latestAttempt.outcome,null);assert.equal(neverSummary.lastRunAt,null);
  const firstFailure=await createTask('Round 10 first early failure');await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools,error_code,completed_at) VALUES($1,$2,1,'manual','failed','openai_compatible',1,'local_simple',60000,60,'[]','AI_CONFIGURATION_INVALID',clock_timestamp())`,[actor.householdId,firstFailure.id]);summaries=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks;const firstFailureSummary=summaries.find((item:any)=>item.id===firstFailure.id)!;assert.equal(firstFailureSummary.status,'failed');assert.equal(firstFailureSummary.result,null);assert.equal(firstFailureSummary.latestAttempt.errorCode,'AI_CONFIGURATION_INVALID');
  const task=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,interpreted_rule,revision,approved_revision,next_check_at) VALUES($1,$2,'Round 10 task','Read synthetic source.','https://example.test.invalid/round10','active',60,1,'18:00','default','routine','{}',2,2,clock_timestamp()+interval '1 hour') RETURNING id`,[actor.householdId,actor.membershipId])).rows[0]!;
  await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)',[actor.householdId,task.id,person.id]);
  const older=(await pool.query<{id:string}>(`INSERT INTO monitor_runs(task_id,task_revision,outcome,run_kind,result_kind,result,source_url,checked_at) VALUES($1,1,'changed','scheduled','answer',$2,'https://example.test.invalid/round10',clock_timestamp()-interval '2 hours') RETURNING id`,[task.id,JSON.stringify({version:1,answer:'Older synthetic result'})])).rows[0]!;
  await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools,error_code,completed_at,queued_at) VALUES($1,$2,2,'scheduled','failed','openai_compatible',1,'local_simple',60000,60,'[]','MONITOR_WORKER_INTERRUPTED',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '2 minutes')`,[actor.householdId,task.id]);
  const response=await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}});assert.equal(response.statusCode,200,response.body);const summary=response.json().tasks.find((item:any)=>item.id===task.id)!;
  assert.equal(summary.status,'failed');assert.equal(summary.latestAttempt.errorCode,'MONITOR_WORKER_INTERRUPTED');assert.ok(summary.lastRunAt);assert.equal(summary.result.runId,older.id);assert.equal(summary.result.historical,true);
  await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools) VALUES($1,$2,1,'scheduled','queued','openai_compatible',1,'local_simple',60000,60,'[]')`,[actor.householdId,task.id]);
  const oldQueued=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks.find((item:any)=>item.id===task.id)!;assert.equal(oldQueued.status,'failed','an obsolete queued execution must not mask the current terminal failure');
  await pool.query(`DELETE FROM monitor_executions WHERE task_id=$1 AND status='queued'`,[task.id]);
  const currentQueued=(await pool.query<{id:string}>(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools) VALUES($1,$2,2,'manual','queued','openai_compatible',1,'local_simple',60000,60,'[]') RETURNING id`,[actor.householdId,task.id])).rows[0]!;let active=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks.find((item:any)=>item.id===task.id)!;assert.equal(active.status,'running');assert.equal(active.latestAttempt.outcome,'queued');assert.equal(active.result.runId,older.id);
  await pool.query(`UPDATE monitor_executions SET status='running',started_at=clock_timestamp(),worker_lease_token=gen_random_uuid(),worker_lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE id=$1`,[currentQueued.id]);active=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks.find((item:any)=>item.id===task.id)!;assert.equal(active.status,'running');assert.equal(active.latestAttempt.outcome,'running');await pool.query('DELETE FROM monitor_executions WHERE id=$1',[currentQueued.id]);
  const completed=await createTask('Round 10 linked completion');const execution=(await pool.query<{id:string}>(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools,result_summary,completed_at) VALUES($1,$2,1,'scheduled','succeeded','openai_compatible',1,'local_simple',60000,60,'[]',$3,clock_timestamp()) RETURNING id`,[actor.householdId,completed.id,JSON.stringify({outcome:'changed'})])).rows[0]!;const linked=(await pool.query<{id:string}>(`INSERT INTO monitor_runs(task_id,task_revision,outcome,run_kind,result_kind,result,source_url,execution_id,checked_at) VALUES($1,1,'changed','scheduled','answer',$2,'https://example.test.invalid/round10',$3,clock_timestamp()) RETURNING id`,[completed.id,JSON.stringify({version:1,answer:'Linked synthetic result'}),execution.id])).rows[0]!;const completedSummary=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks.find((item:any)=>item.id===completed.id)!;assert.equal(completedSummary.status,'findings');assert.equal(completedSummary.latestAttempt.outcome,'changed');assert.equal(completedSummary.result.runId,linked.id);assert.equal(completedSummary.result.historical,false);
});

test('a current active monitor attempt makes its retained result historical',async()=>{
  const person=(await pool.query<{id:string}>('SELECT person_id id FROM memberships WHERE id=$1',[actor.membershipId])).rows[0]!;const task=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,interpreted_rule,revision,approved_revision,next_check_at) VALUES($1,$2,'Round 10 active after result','Read synthetic source.','https://example.test.invalid/round10','active',60,1,'18:00','default','routine','{}',1,1,clock_timestamp()+interval '1 hour') RETURNING id`,[actor.householdId,actor.membershipId])).rows[0]!;await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)',[actor.householdId,task.id,person.id]);const result=(await pool.query<{id:string}>(`INSERT INTO monitor_runs(task_id,task_revision,outcome,run_kind,result_kind,result,source_url,checked_at) VALUES($1,1,'changed','scheduled','answer',$2,'https://example.test.invalid/round10',clock_timestamp()-interval '1 minute') RETURNING id`,[task.id,JSON.stringify({version:1,answer:'Retained synthetic result'})])).rows[0]!;await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools) VALUES($1,$2,1,'manual','queued','openai_compatible',1,'local_simple',60000,60,'[]')`,[actor.householdId,task.id]);const summary=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks.find((item:any)=>item.id===task.id)!;assert.equal(summary.status,'running');assert.equal(summary.result.runId,result.id);assert.equal(summary.result.historical,true,'a result predating the active logical attempt must be historical');
});

test('terminal monitor execution failure overrides its linked committed result',async()=>{
  const person=(await pool.query<{id:string}>('SELECT person_id id FROM memberships WHERE id=$1',[actor.membershipId])).rows[0]!;const task=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,interpreted_rule,revision,approved_revision,next_check_at) VALUES($1,$2,'Round 10 post-commit failure','Read synthetic source.','https://example.test.invalid/round10','active',60,1,'18:00','default','routine','{}',1,1,clock_timestamp()+interval '1 hour') RETURNING id`,[actor.householdId,actor.membershipId])).rows[0]!;await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)',[actor.householdId,task.id,person.id]);const execution=(await pool.query<{id:string}>(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools,error_code,completed_at,queued_at) VALUES($1,$2,1,'manual','failed','openai_compatible',1,'local_simple',60000,60,'[]','AI_UPSTREAM_ERROR','2026-11-02T12:02:00.000Z','2026-11-02T12:00:00.000Z') RETURNING id`,[actor.householdId,task.id])).rows[0]!;const result=(await pool.query<{id:string}>(`INSERT INTO monitor_runs(task_id,task_revision,outcome,run_kind,result_kind,result,source_url,execution_id,checked_at) VALUES($1,1,'changed','manual','answer',$2,'https://example.test.invalid/round10',$3,'2026-11-02T12:01:00.000Z') RETURNING id`,[task.id,JSON.stringify({version:1,answer:'Committed before audit failure'}),execution.id])).rows[0]!;const summary=(await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/people/${person.id}/monitors`,headers:{cookie:sessionCookie}})).json().tasks.find((item:any)=>item.id===task.id)!;assert.equal(summary.status,'failed');assert.equal(summary.latestAttempt.outcome,'failed');assert.equal(summary.latestAttempt.errorCode,'AI_UPSTREAM_ERROR');assert.equal(summary.lastRunAt,'2026-11-02T12:02:00.000Z');assert.equal(summary.result.runId,result.id);assert.equal(summary.result.historical,true,'a result attached before the terminal execution failure must be retained as historical');
});

test('one snapshot window is reused across an empty intermediate provider page',async(t)=>{
  transport.pageMode=true;transport.eventRequests=[];
  const {connectionId,source}=await connectedCalendar('Pagination calendar');
  await service.updateSource(actor,connectionId,source.id,{expectedRevision:1,enabled:true,bridgeKind:'direct',appliesTo:{household:true,personIds:[]},visibility:{household:true,personIds:[],displayIds:[]}});
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-01T12:00:00.000Z')});transport.advanceClock=()=>t.mock.timers.tick(60_000);
  await service.syncConnection(connectionId);transport.pageMode=false;transport.advanceClock=undefined;
  assert.equal(transport.eventRequests.length,3);assert.deepEqual(transport.eventRequests.map((request)=>request.window),[transport.eventRequests[0]!.window,transport.eventRequests[0]!.window,transport.eventRequests[0]!.window]);
  assert.deepEqual(transport.eventRequests.map((request)=>request.pageToken),[undefined,'empty-middle','last-page']);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM calendar_occurrences WHERE source_id=$1 AND status='active'`,[source.id])).rows[0].count,2);
});

test('round 10 repair migration is present exactly once',async()=>{
  assert.equal((await pool.query(`SELECT count(*)::int count FROM schema_migrations WHERE version='024_round10_calendar_and_monitor_repairs.sql'`)).rows[0].count,1);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM information_schema.columns WHERE table_name='calendar_oauth_sessions' AND column_name='connection_generation'`)).rows[0].count,1);
  const fixture=(await pool.query<{item_id:string;source_id:string;connection_id:string;revision:number}>(`SELECT item.id item_id,source.id source_id,connection.id connection_id,item.revision FROM integration_items item JOIN calendar_occurrences occurrence ON occurrence.integration_item_id=item.id AND occurrence.status='active' JOIN calendar_sources source ON source.id=occurrence.source_id AND source.enabled JOIN calendar_connections connection ON connection.id=source.connection_id AND connection.state='connected' WHERE item.status='active' ORDER BY item.created_at LIMIT 1`)).rows[0]!;assert.ok(fixture);
  await pool.query(`UPDATE integration_items SET metadata=jsonb_set(jsonb_set(metadata,'{calendar,bridgeKind}','"stale"'::jsonb),'{calendar,subjectHousehold}',to_jsonb(NOT (metadata#>>'{calendar,subjectHousehold}')::boolean))||'{"unrelated":"preserved"}'::jsonb WHERE id=$1`,[fixture.item_id]);await pool.query('UPDATE calendar_connections SET next_sync_at=NULL WHERE id=$1',[fixture.connection_id]);
  const before=(await pool.query<{revision:number}>('SELECT revision FROM integration_items WHERE id=$1',[fixture.item_id])).rows[0]!.revision;const sql=await readFile(new URL('../migrations/024_round10_calendar_and_monitor_repairs.sql',import.meta.url),'utf8');await pool.query(sql);
  const first=(await pool.query<any>(`SELECT item.revision,item.metadata,connection.next_sync_at FROM integration_items item JOIN calendar_connections connection ON connection.id=$2 WHERE item.id=$1`,[fixture.item_id,fixture.connection_id])).rows[0]!;assert.equal(first.revision,before+1);assert.equal(first.metadata.unrelated,'preserved');assert.ok(first.next_sync_at instanceof Date);const firstSchedule=first.next_sync_at.toISOString();await pool.query(sql);
  const second=(await pool.query<any>(`SELECT item.revision,item.metadata,connection.next_sync_at FROM integration_items item JOIN calendar_connections connection ON connection.id=$2 WHERE item.id=$1`,[fixture.item_id,fixture.connection_id])).rows[0]!;assert.equal(second.revision,first.revision);assert.equal(second.next_sync_at.toISOString(),firstSchedule);assert.equal(second.metadata.unrelated,'preserved');assert.equal((await pool.query(`SELECT count(*)::int count FROM calendar_connections WHERE (state IN ('setup','expired','awaiting_consent','disconnected') OR last_error_code='CALENDAR_CLIENT_CONFIGURATION_INVALID') AND next_sync_at IS NOT NULL`)).rows[0].count,0);
});

test('round 10 repair resumes only a connected authorized source and leaves paused or fenced connections unscheduled',async()=>{
  const sql=await readFile(new URL('../migrations/024_round10_calendar_and_monitor_repairs.sql',import.meta.url),'utf8');
  // This test needs a complete exclusion matrix. Retire only earlier synthetic
  // connections in this isolated test household so the product's twelve-live-
  // connection guard does not hide a migration result.
  await pool.query(`UPDATE calendar_connections SET state='disconnected',next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL,disconnected_at=clock_timestamp() WHERE household_id=$1 AND disconnected_at IS NULL`,[actor.householdId]);
  const connected=async(name:string)=>{const result=await connectedCalendar(name);await enableSource(service,result.connectionId);await pool.query('UPDATE calendar_connections SET next_sync_at=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=$1',[result.connectionId]);return result.connectionId;};
  const eligible=await connected('Repair eligible control');
  const paused=(await connectedCalendar('Repair paused source')).connectionId;
  const noManager=await connected('Repair owner without manage');
  const disabledOwner=await connected('Repair disabled owner');
  const revokedAuthority=await connected('Repair revoked authority');
  const liveLease=await connected('Repair live lease');
  const expired=await connected('Repair expired connection');
  const awaiting=await connected('Repair awaiting connection');
  const error=await connected('Repair error connection');
  const installation=(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[actor.householdId])).rows[0]!.installation_id;
  const createOwner=async(email:string,disabled:boolean)=>{
    const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,$2,'adult') RETURNING id`,[actor.householdId,email])).rows[0]!;
    const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme,disabled_at) VALUES($1,$2,'unused','nb','system',$3) RETURNING id`,[installation,email,disabled?'2026-01-01T00:00:00.000Z':null])).rows[0]!;
    await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'limited','[]'::jsonb)`,[actor.householdId,account.id,person.id]);
    return account.id;
  };
  const noManageAccount=await createOwner('round10-no-manage@test.invalid',false),disabledAccount=await createOwner('round10-disabled@test.invalid',true);
  await pool.query('UPDATE calendar_connections SET owner_account_id=$2 WHERE id=$1',[noManager,noManageAccount]);
  await pool.query('UPDATE calendar_connections SET owner_account_id=$2 WHERE id=$1',[disabledOwner,disabledAccount]);
  await pool.query(`UPDATE integration_connections authority SET revoked_at=clock_timestamp() FROM calendar_connections connection WHERE authority.id=connection.integration_connection_id AND connection.id=$1`,[revokedAuthority]);
  await pool.query(`UPDATE calendar_connections SET lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE id=$1`,[liveLease]);
  await pool.query(`UPDATE calendar_connections SET state='expired',next_sync_at=NULL WHERE id=$1`,[expired]);
  await pool.query(`UPDATE calendar_connections SET state='awaiting_consent',next_sync_at=NULL WHERE id=$1`,[awaiting]);
  await pool.query(`UPDATE calendar_connections SET state='error',next_sync_at=NULL WHERE id=$1`,[error]);
  await pool.query(sql);await pool.query(sql);
  const rows=(await pool.query<{id:string;next_sync_at:Date|null}>(`SELECT id,next_sync_at FROM calendar_connections WHERE id=ANY($1::uuid[])`,[[eligible,paused,noManager,disabledOwner,revokedAuthority,liveLease,expired,awaiting,error]])).rows;
  const byId=new Map(rows.map(row=>[row.id,row.next_sync_at]));
  assert.ok(byId.get(eligible),'the eligible enabled connected source must be repaired');
  for(const id of [paused,noManager,disabledOwner,revokedAuthority,liveLease,expired,awaiting,error])assert.equal(byId.get(id),null,`repair must not schedule excluded connection ${id}`);
});

test('round 10 migration preserves the R9 OAuth insert shape behind a fenced sentinel generation',async()=>{
  const column=(await pool.query<{column_default:string|null}>(`SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='calendar_oauth_sessions' AND column_name='connection_generation'`)).rows[0]!;assert.match(column.column_default??'',/\b0\b/);
  const connected=await connectedCalendar('R9 insert compatibility calendar'),connection={id:connected.connectionId};await pool.query(`UPDATE calendar_connections SET state='awaiting_consent',sync_generation=GREATEST(sync_generation,1) WHERE id=$1`,[connection.id]);
  const state='round10-r9-insert-state',hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const inserted=(await pool.query<{id:string;connection_generation:number}>(`INSERT INTO calendar_oauth_sessions(connection_id,owner_account_id,initiating_session_id,state_hash,verifier_ciphertext,redirect_uri,expires_at) VALUES($1,$2,$3,$4,'synthetic-verifier','https://samvev.test.invalid/api/v1/calendar/oauth/google/callback',clock_timestamp()+interval '10 minutes') RETURNING id,connection_generation`,[connection.id,actor.accountId,actor.sessionId,hash(state)])).rows[0]!;assert.equal(inserted.connection_generation,0);
  await assert.rejects(()=>service.stageOAuthCallback('google',state,'synthetic-code'),(error:any)=>error.details?.reason==='calendar_oauth_state_invalid');
});

test('round 10 migration invalidates only pre-upgrade OAuth completion credentials',async()=>{
  const sql=await readFile(new URL('../migrations/024_round10_calendar_and_monitor_repairs.sql',import.meta.url),'utf8');
  const connected=await connectedCalendar('Legacy callback migration calendar'),connection=(await pool.query<{id:string;sync_generation:number}>('SELECT id,sync_generation FROM calendar_connections WHERE id=$1',[connected.connectionId])).rows[0]!;
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');await pool.query('ALTER TABLE calendar_oauth_sessions ALTER COLUMN connection_generation DROP NOT NULL');
  const legacy=(await pool.query<{id:string}>(`INSERT INTO calendar_oauth_sessions(connection_id,owner_account_id,initiating_session_id,state_hash,verifier_ciphertext,redirect_uri,completion_hash,authorization_code_ciphertext,callback_received_at,consumed_at,connection_generation,expires_at) VALUES($1,$2,$3,$4,'legacy-verifier','https://samvev.test.invalid/api/v1/calendar/oauth/google/callback',$5,'legacy-code',clock_timestamp(),clock_timestamp(),NULL,clock_timestamp()+interval '10 minutes') RETURNING id`,[connection.id,actor.accountId,actor.sessionId,hash('legacy-state'),hash('legacy-completion')])).rows[0]!;
  const valid=(await pool.query<{id:string}>(`INSERT INTO calendar_oauth_sessions(connection_id,owner_account_id,initiating_session_id,state_hash,verifier_ciphertext,redirect_uri,completion_hash,authorization_code_ciphertext,callback_received_at,consumed_at,connection_generation,expires_at) VALUES($1,$2,$3,$4,'valid-verifier','https://samvev.test.invalid/api/v1/calendar/oauth/google/callback',$5,'valid-code',clock_timestamp(),clock_timestamp(),$6,clock_timestamp()+interval '10 minutes') RETURNING id`,[connection.id,actor.accountId,actor.sessionId,hash('valid-state'),hash('valid-completion'),connection.sync_generation])).rows[0]!;
  await pool.query(sql);const first=await pool.query<any>(`SELECT id,connection_generation,completion_hash,authorization_code_ciphertext FROM calendar_oauth_sessions WHERE id=ANY($1::uuid[]) ORDER BY id`,[[legacy.id,valid.id]]);const legacyAfter=first.rows.find((row:any)=>row.id===legacy.id),validAfter=first.rows.find((row:any)=>row.id===valid.id);assert.equal(legacyAfter.connection_generation,connection.sync_generation);assert.equal(legacyAfter.completion_hash,null);assert.equal(legacyAfter.authorization_code_ciphertext,null);assert.equal(validAfter.completion_hash,hash('valid-completion'));assert.equal(validAfter.authorization_code_ciphertext,'valid-code');
  await pool.query(sql);const validSecond=(await pool.query<any>('SELECT completion_hash,authorization_code_ciphertext,connection_generation FROM calendar_oauth_sessions WHERE id=$1',[valid.id])).rows[0]!;assert.equal(validSecond.completion_hash,hash('valid-completion'));assert.equal(validSecond.authorization_code_ciphertext,'valid-code');assert.equal(validSecond.connection_generation,connection.sync_generation);
});
