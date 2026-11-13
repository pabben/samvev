import assert from 'node:assert/strict';
import test,{before,beforeEach,after} from 'node:test';
import {roleCapabilityPresets} from '@samvev/contracts';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';

const origin='https://samvev-ha-bridge.test.invalid';
let app:FastifyInstance,householdId:string,ownerPersonId:string,connectionId:string,token:string,cookie:string,csrf:string;
const future=(minutes=60)=>new Date(Date.now()+minutes*60_000).toISOString();
function cookies(response:LightMyRequestResponse){const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map(value=>value.split(';')[0]).join('; ');}
function admin(){return{cookie,origin,'x-csrf-token':csrf};}
function bearer(value=token){return{authorization:`Bearer ${value}`};}
const allCaps=['ha.groceries.read','ha.groceries.write','ha.messages.read','ha.messages.write','ha.calendar.read','ha.calendar.write'];
async function createConnection(capabilities=allCaps){const response=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/integrations`,headers:admin(),payload:{name:'Synthetic HA connection',displayIds:[],credential:{name:'Synthetic HA credential',capabilities,expiresAt:null}}});assert.equal(response.statusCode,201,response.body);return{connectionId:response.json().connection.id,credentialId:response.json().connection.credentials[0].id,token:response.json().credentialToken};}
async function setSharing(id=connectionId,expectedRevision=0,overrides:Record<string,unknown>={}){const response=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/integrations/${id}/ha-sharing`,headers:admin(),payload:{expectedRevision,listIds:['groceries'],household:true,personIds:[],calendarSourceIds:[],...overrides}});assert.equal(response.statusCode,200,response.body);return response.json();}
async function machine(method:'GET'|'POST'|'PATCH'|'DELETE',path:string,payload?:object,auth=token){return app.inject({method,url:`/api/v1/ha/${path}`,headers:bearer(auth),...(payload?{payload}:{})});}
before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');assert.equal(url.hostname,'test-db');assert.equal(url.pathname,'/samvev_test');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claimed=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic bridge owner',email:'ha-owner@test.invalid',password:'Synthetic-ha-owner-password-42'},household:{name:'Synthetic bridge household',timezone:'Europe/Oslo',locale:'nb'},preferences:{locale:'nb',theme:'light'}}});assert.equal(claimed.statusCode,200,claimed.body);
  householdId=claimed.json().householdId;cookie=cookies(claimed);csrf=claimed.json().csrfToken;
  ownerPersonId=(await pool.query('SELECT person_id FROM memberships WHERE id=$1',[claimed.json().membershipId])).rows[0].person_id;
  ({connectionId,token}=await createConnection());await setSharing();
});
beforeEach(async()=>{await pool.query('TRUNCATE rate_limits');});
after(async()=>{await app.close();await pool.end();});

test('bridge authenticates separately and shares only explicit resources and server revisions',async()=>{
  const connection=await machine('GET','connection');assert.equal(connection.statusCode,200,connection.body);assert.equal(connection.json().schemaVersion,1);assert.equal(connection.json().connectionId,connectionId);assert.equal(connection.headers['cache-control'],'private, no-store');
  assert.equal((await app.inject({method:'GET',url:'/api/v1/ha/snapshot',headers:admin()})).statusCode,401);
  assert.equal((await machine('GET','snapshot',undefined,'wrong-token-with-enough-characters-00000000')).statusCode,401);
  const unshared=await createConnection();assert.deepEqual((await machine('GET','snapshot',undefined,unshared.token)).json().lists,[]);
  assert.equal((await machine('POST','lists/groceries/items',{label:'Denied',checked:false,requestKey:'unshared-create-0001'},unshared.token)).statusCode,403);
  const legacy=await createConnection(['integration.items.read']);assert.equal((await machine('GET','snapshot',undefined,legacy.token)).statusCode,403);
  const readOnly=await createConnection(['ha.groceries.read']);await setSharing(readOnly.connectionId,0,{personIds:[ownerPersonId]});
  for(const path of ['connection','snapshot']){
    const scoped=await machine('GET',path,undefined,readOnly.token);assert.equal(scoped.statusCode,200,scoped.body);
    assert.deepEqual(scoped.json().grants,{revision:1,listIds:['groceries'],household:false,personIds:[],calendarSourceIds:[],allowSharedNativeWrites:false},'a grocery-only credential cannot inspect unrelated audience grants');
    assert.equal(scoped.body.includes(ownerPersonId),false,'person IDs are absent from grocery-only metadata');
  }
  assert.equal((await machine('POST','lists/groceries/items',{label:'Denied',checked:false,requestKey:'readonly-create-0001'},readOnly.token)).statusCode,403);
  const item=await machine('POST','lists/groceries/items',{label:'Synthetic apples',checked:false,requestKey:'grocery-create-0001'});assert.equal(item.statusCode,201,item.body);const id=item.json().item.id;
  const writeOnly=await createConnection(['ha.groceries.write','ha.messages.write','ha.calendar.write']);await setSharing(writeOnly.connectionId);
  const writeOnlyPatch=await machine('PATCH',`lists/groceries/items/${id}`,{checked:true,expectedRevision:1,requestKey:'write-only-patch-0001'},writeOnly.token);assert.equal(writeOnlyPatch.statusCode,403,'returning authoritative fields requires paired read permission');assert.equal(JSON.stringify(writeOnlyPatch.json()).includes('Synthetic apples'),false);
  assert.equal((await machine('POST','messages',{body:'Write-only denied',importance:'normal',audience:{household:true,personIds:[]},expiresAt:future(),requestKey:'write-only-message-0001'},writeOnly.token)).statusCode,403);
  assert.equal((await machine('POST','calendars/samvev/events',{summary:'Write-only denied',start:'2027-03-28',end:'2027-03-29',requestKey:'write-only-event-0001'},writeOnly.token)).statusCode,403);
  const retry=await machine('POST','lists/groceries/items',{label:'Synthetic apples',checked:false,requestKey:'grocery-create-0001'});assert.equal(retry.json().item.id,id);
  assert.equal((await machine('POST','lists/groceries/items',{label:'Changed replay',checked:false,requestKey:'grocery-create-0001'})).statusCode,409);
  const browserRead=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/groceries`,headers:admin()});assert.equal(browserRead.json().items.find((value:any)=>value.id===id).label,'Synthetic apples');
  const updated=await machine('PATCH',`lists/groceries/items/${id}`,{label:'Synthetic green apples',checked:true,expectedRevision:1,requestKey:'grocery-update-0001'});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().item.revision,2);
  const repeat=await machine('PATCH',`lists/groceries/items/${id}`,{label:'Synthetic green apples',checked:true,expectedRevision:1,requestKey:'grocery-update-0001'});assert.equal(repeat.statusCode,200);assert.equal(repeat.json().item.revision,2);
  const races=await Promise.all(['a','b'].map(value=>machine('PATCH',`lists/groceries/items/${id}`,{checked:false,expectedRevision:2,requestKey:`grocery-race-${value}-0001`})));assert.deepEqual(races.map(value=>value.statusCode).sort(),[200,409]);
  const removed=await machine('DELETE',`lists/groceries/items/${id}`,{expectedRevision:3,requestKey:'grocery-delete-0001'});assert.equal(removed.statusCode,200,removed.body);assert.equal((await machine('GET','snapshot')).json().lists[0].items.some((value:any)=>value.id===id),false);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/ha/lists/groceries/items',headers:{...bearer(),origin:'https://foreign.test.invalid'},payload:{label:'Foreign',checked:false,requestKey:'foreign-origin-0001'}})).statusCode,403);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE actor_type='integration' AND actor_id=$1 AND action LIKE '%reward%'`,[connectionId])).rows[0].count,0);
});

test('multiple messages preserve authors, audiences, expiry, ownership and lifecycle without render receipts',async()=>{
  const browserMessage=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:admin(),payload:{body:'Synthetic browser message',importance:'normal',audience:{household:true,personIds:[],displayIds:[]},expiresAt:future(),idempotencyKey:'browser-message-0001'}});assert.equal(browserMessage.statusCode,201,browserMessage.body);
  const message=await machine('POST','messages',{body:'Synthetic HA message',importance:'attention',audience:{household:true,personIds:[]},expiresAt:future(),requestKey:'ha-message-create-0001'});assert.equal(message.statusCode,201,message.body);const id=message.json().message.id;assert.equal(message.json().message.authorType,'integration');
  const retry=await machine('POST','messages',{body:'Synthetic HA message',importance:'attention',audience:{household:true,personIds:[]},expiresAt:message.json().message.expiresAt,requestKey:'ha-message-create-0001'});assert.equal(retry.statusCode,201,retry.body);assert.equal(retry.json().message.id,id);
  const snapshot=await machine('GET','snapshot');assert.equal(snapshot.json().messages.length,2);assert.equal(snapshot.json().messages[0].id,id);
  const browserHome=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:admin()});assert.equal(browserHome.statusCode,200,browserHome.body);assert.ok(JSON.stringify(browserHome.json()).includes('Synthetic HA message'));
  const update=await machine('PATCH',`messages/${id}`,{body:'Synthetic revised HA message',expectedRevision:1,requestKey:'ha-message-update-0001'});assert.equal(update.statusCode,200,update.body);assert.equal(update.json().message.revision,2);
  assert.equal((await machine('PATCH',`messages/${id}`,{body:'Stale overwrite',expectedRevision:1,requestKey:'ha-message-stale-0001'})).statusCode,409);
  assert.equal((await machine('PATCH',`messages/${browserMessage.json().id}`,{body:'Not owned',expectedRevision:1,requestKey:'ha-message-owner-0001'})).statusCode,404);
  const denied=await machine('POST','messages',{body:'Private denied',importance:'normal',audience:{household:false,personIds:[ownerPersonId]},expiresAt:future(),requestKey:'ha-message-denied-0001'});assert.equal(denied.statusCode,403,denied.body);
  await setSharing(connectionId,1,{personIds:[ownerPersonId]});
  const privateMessage=await machine('POST','messages',{body:'Explicitly shared person',importance:'normal',audience:{household:false,personIds:[ownerPersonId]},expiresAt:future(),requestKey:'ha-message-person-0001'});assert.equal(privateMessage.statusCode,201,privateMessage.body);
  assert.equal((await machine('GET','snapshot')).json().messages.length,3);
  await pool.query(`UPDATE messages SET expires_at=clock_timestamp()-interval '1 second',publish_at=clock_timestamp()-interval '1 hour' WHERE id=$1`,[privateMessage.json().message.id]);assert.equal((await machine('GET','snapshot')).json().messages.length,2);
  const withdrawn=await machine('POST',`messages/${id}/withdraw`,{expectedRevision:2,requestKey:'ha-message-withdraw-0001'});assert.equal(withdrawn.statusCode,200,withdrawn.body);assert.equal(withdrawn.json().message.state,'withdrawn');assert.equal((await machine('GET','snapshot')).json().messages.length,1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM display_render_acks')).rows[0].count,0);
  assert.ok((await pool.query(`SELECT 1 FROM message_lifecycle_events WHERE message_id=$1 AND actor_type='integration' AND actor_id=$2`,[id,connectionId])).rowCount);
});

test('calendar roundtrip handles civil days, DST, overlaps, revisions, cancellation and immutable imported source writes',async()=>{
  const event={summary:'Synthetic DST event',start:'2027-03-28T01:30:00+01:00',end:'2027-03-28T03:30:00+02:00',description:'Synthetic appointment',location:'Synthetic room',requestKey:'ha-calendar-create-0001'};
  const created=await machine('POST','calendars/samvev/events',event);assert.equal(created.statusCode,201,created.body);const id=created.json().event.id;
  const replay=await machine('POST','calendars/samvev/events',event);assert.equal(replay.json().event.id,id);
  const allDay=await machine('POST','calendars/samvev/events',{summary:'Synthetic all day',start:'2027-03-28',end:'2027-03-29',requestKey:'ha-calendar-all-day-0001'});assert.equal(allDay.statusCode,201,allDay.body);assert.equal(allDay.json().event.start,'2027-03-28');
  const range='calendars/samvev/events?start=2027-03-27T23:00:00Z&end=2027-03-28T22:00:00Z';const events=await machine('GET',range);assert.equal(events.statusCode,200,events.body);assert.equal(events.json().events.length,2);assert.equal(events.json().events.find((value:any)=>value.id===id).start,'2027-03-28T00:30:00.000Z');
  const changed=await machine('PATCH',`calendars/samvev/events/${id}`,{summary:'Synthetic moved event',start:'2027-03-29T10:00:00+02:00',end:'2027-03-29T11:00:00+02:00',expectedRevision:1,requestKey:'ha-calendar-update-0001'});assert.equal(changed.statusCode,200,changed.body);assert.equal(changed.json().event.revision,2);assert.equal((await machine('GET',range)).json().events.length,1);
  assert.equal((await machine('PATCH',`calendars/samvev/events/${id}`,{summary:'Stale',expectedRevision:1,requestKey:'ha-calendar-stale-0001'})).statusCode,409);
  assert.equal((await machine('POST','calendars/00000000-0000-4000-8000-000000000000/events',event)).statusCode,403);
  assert.equal((await machine('POST','calendars/samvev/events',{...event,start:'2027-02-30',end:'2027-03-01',requestKey:'ha-calendar-invalid-0001'})).statusCode,400);
  const longDescription=await machine('POST','calendars/samvev/events',{summary:'Synthetic long description',start:'2027-05-01',end:'2027-05-02',description:'ø'.repeat(4000),requestKey:'ha-calendar-long-body-0001'});assert.equal(longDescription.statusCode,201,longDescription.body);assert.equal(longDescription.json().event.description.length,4000,'description uses existing body storage, not bounded metadata');
  const removal=await machine('DELETE',`calendars/samvev/events/${id}`,{expectedRevision:2,requestKey:'ha-calendar-delete-0001'});assert.equal(removal.statusCode,200,removal.body);const retry=await machine('DELETE',`calendars/samvev/events/${id}`,{expectedRevision:2,requestKey:'ha-calendar-delete-0001'});assert.equal(retry.statusCode,200,retry.body);
  assert.equal((await pool.query('SELECT status FROM integration_items WHERE id=$1',[id])).rows[0].status,'withdrawn');
});


test('imported calendar export keeps complete occurrence sets, source freshness and independent reader ACL',async()=>{
  const importedConnection=await createConnection(['integration.items.write']);
  const accountId=(await pool.query('SELECT account_id FROM memberships WHERE household_id=$1 AND person_id=$2',[householdId,ownerPersonId])).rows[0].account_id;
  const calendarId=(await pool.query(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state) VALUES($1,$2,$3,'ics','Synthetic imported calendar','connected') RETURNING id`,[householdId,importedConnection.connectionId,accountId])).rows[0].id;
  const sourceId=(await pool.query(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household,subject_household,last_sync_succeeded_at,last_complete_window_from,last_complete_window_to)
    VALUES($1,$2,'synthetic-recurring-source','Synthetic recurring source',true,false,true,clock_timestamp(),'2027-03-01','2027-05-01') RETURNING id`,[householdId,calendarId])).rows[0].id;
  const viewer=await createConnection(['ha.calendar.read']);await setSharing(viewer.connectionId,0,{listIds:[],household:false,personIds:[ownerPersonId],calendarSourceIds:[sourceId]});
  const unshared=await machine('GET','snapshot',undefined,viewer.token);assert.equal(unshared.statusCode,200,unshared.body);assert.equal(unshared.json().calendars.some((value:any)=>value.id===sourceId),false,'calendar subjects do not grant reading');
  await pool.query('INSERT INTO calendar_source_person_readers(household_id,source_id,person_id) VALUES($1,$2,$3)',[householdId,sourceId,ownerPersonId]);
  const visible=await machine('GET','snapshot',undefined,viewer.token);const descriptor=visible.json().calendars.find((value:any)=>value.id===sourceId);assert.equal(descriptor.writable,false);assert.equal(descriptor.freshness,'current');assert.ok(descriptor.lastCompleteWindow);
  // More than the member/display page limits: the HA range must not silently truncate.
  await pool.query(`WITH created AS (
    INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
    SELECT $1,$2,'series-occurrence-'||sequence,'event',false,'Synthetic recurrence '||sequence,'Synthetic occurrence','normal',
      '2027-03-28T08:00:00Z'::timestamptz+sequence*interval '1 minute','2027-03-28T09:00:00Z'::timestamptz+sequence*interval '1 minute','{}',
      jsonb_build_object('calendar',jsonb_build_object('provider','ics','sourceId',$3::text,'subjectHousehold',true,'status','confirmed')),
      repeat('a',64) FROM generate_series(1,251) sequence RETURNING id,external_id
    ), targeted AS (INSERT INTO integration_item_person_targets(household_id,item_id,person_id) SELECT $1,id,$4 FROM created RETURNING item_id)
    INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation)
    SELECT $1,$3::uuid,'synthetic-recurring-series',external_id,id,external_id,repeat('a',64),'active',1 FROM created`,[householdId,importedConnection.connectionId,sourceId,ownerPersonId]);
  const path=`calendars/${sourceId}/events?start=2027-03-28T00:00:00Z&end=2027-03-29T00:00:00Z`;
  const complete=await machine('GET',path,undefined,viewer.token);assert.equal(complete.statusCode,200,complete.body);assert.equal(complete.json().events.length,251);assert.ok(complete.json().events.every((value:any)=>value.readOnly&&value.source==='ics'));
  const cancelledId=complete.json().events[0].id;await pool.query(`UPDATE integration_items SET status='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1 WHERE id=$1`,[cancelledId]);assert.equal((await machine('GET',path,undefined,viewer.token)).json().events.length,250);
  await pool.query(`UPDATE calendar_connections SET state='error',last_error_code='CALENDAR_SYNC_FAILED' WHERE id=$1`,[calendarId]);const stale=await machine('GET','snapshot',undefined,viewer.token);assert.equal(stale.json().calendars.find((value:any)=>value.id===sourceId).freshness,'stale');assert.equal((await machine('GET',path,undefined,viewer.token)).json().events.length,250,'upstream failure retains previous authoritative events');
  await pool.query('DELETE FROM calendar_source_person_readers WHERE source_id=$1',[sourceId]);assert.equal((await machine('GET',path,undefined,viewer.token)).statusCode,403);
});


test('narrowed calendar sharing cannot mutate or replay an event still addressed to removed readers',async()=>{
  const actor=await createConnection();
  const secondPerson=(await pool.query(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic second reader','adult') RETURNING id`,[householdId])).rows[0].id;
  await setSharing(actor.connectionId,0,{household:true,personIds:[ownerPersonId]});
  const firstPayload={summary:'Synthetic original household audience',start:'2027-04-01',end:'2027-04-02',requestKey:'scope-event-household-0001'};
  const first=await machine('POST','calendars/samvev/events',firstPayload,actor.token);assert.equal(first.statusCode,201,first.body);
  await setSharing(actor.connectionId,1,{household:false,personIds:[ownerPersonId]});
  assert.equal((await machine('PATCH',`calendars/samvev/events/${first.json().event.id}`,{summary:'Must not reach removed household',expectedRevision:1,requestKey:'scope-update-household-0001'},actor.token)).statusCode,403);
  assert.equal((await machine('DELETE',`calendars/samvev/events/${first.json().event.id}`,{expectedRevision:1,requestKey:'scope-delete-household-0001'},actor.token)).statusCode,403);
  assert.equal((await machine('POST','calendars/samvev/events',firstPayload,actor.token)).statusCode,403,'receipt replay reauthorizes the full original audience');
  await setSharing(actor.connectionId,2,{household:false,personIds:[ownerPersonId,secondPerson]});
  const secondPayload={summary:'Synthetic original two-reader audience',start:'2027-04-02',end:'2027-04-03',requestKey:'scope-event-two-reader-0001'};
  const second=await machine('POST','calendars/samvev/events',secondPayload,actor.token);assert.equal(second.statusCode,201,second.body);
  await setSharing(actor.connectionId,3,{household:false,personIds:[ownerPersonId]});
  assert.equal((await machine('PATCH',`calendars/samvev/events/${second.json().event.id}`,{summary:'Must not reach removed reader',expectedRevision:1,requestKey:'scope-update-two-reader-0001'},actor.token)).statusCode,403);
  assert.equal((await machine('POST','calendars/samvev/events',secondPayload,actor.token)).statusCode,403);
  const unchanged=(await pool.query('SELECT revision,title FROM integration_items WHERE id=ANY($1::uuid[])',[[first.json().event.id,second.json().event.id]])).rows;
  assert.ok(unchanged.every((value:any)=>value.revision===1),'no denied write changes a revision');
});


test('a browser-added display audience stops HA writes and durable message replay',async()=>{
  const actor=await createConnection();await setSharing(actor.connectionId);
  const payload={body:'Synthetic message before display sharing',importance:'normal',audience:{household:true,personIds:[]},expiresAt:future(),requestKey:'message-display-guard-0001'};
  const message=await machine('POST','messages',payload,actor.token);assert.equal(message.statusCode,201,message.body);const id=message.json().message.id;
  const setup=(await pool.query(`INSERT INTO display_setups(household_id,name,locale,theme) VALUES($1,'Synthetic display audience setup','en','light') RETURNING id`,[householdId])).rows[0].id;
  const display=(await pool.query(`INSERT INTO displays(household_id,name,locale,theme,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic display recipient','en','light',$2,$3,clock_timestamp()+interval '1 day') RETURNING id`,[householdId,setup,'0'.repeat(64)])).rows[0].id;
  const browserEdit=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${id}`,headers:admin(),payload:{audience:{household:true,personIds:[],displayIds:[display]},expectedRevision:1}});assert.equal(browserEdit.statusCode,200,browserEdit.body);
  assert.equal((await machine('PATCH',`messages/${id}`,{body:'Must not affect ungranted screen',expectedRevision:2,requestKey:'message-display-edit-0001'},actor.token)).statusCode,403);
  assert.equal((await machine('POST',`messages/${id}/withdraw`,{expectedRevision:2,requestKey:'message-display-withdraw-0001'},actor.token)).statusCode,403);
  assert.equal((await machine('POST','messages',payload,actor.token)).statusCode,403,'receipt replay checks current display targets');
  const withdrawn=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages/${id}/withdraw`,headers:admin(),payload:{expectedRevision:2}});assert.equal(withdrawn.statusCode,200,withdrawn.body);
});

test('actual second-household content remains isolated and separately revoked credential rotation retains stable identity',async()=>{
  const account=(await pool.query('SELECT account_id FROM memberships WHERE household_id=$1 AND person_id=$2',[householdId,ownerPersonId])).rows[0].account_id;
  const otherHousehold=(await pool.query(`INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,'Synthetic separate HA household','UTC','en' FROM households WHERE id=$1 RETURNING id`,[householdId])).rows[0].id;
  const otherPerson=(await pool.query(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic separate owner','adult') RETURNING id`,[otherHousehold])).rows[0].id;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4)`,[otherHousehold,account,otherPerson,JSON.stringify(roleCapabilityPresets.household_admin)]);
  const created=await app.inject({method:'POST',url:`/api/v1/households/${otherHousehold}/integrations`,headers:admin(),payload:{name:'Synthetic other household HA',credential:{name:'Synthetic other credential',capabilities:allCaps}}});assert.equal(created.statusCode,201,created.body);
  const otherConnection=created.json().connection.id,otherToken=created.json().credentialToken;
  const sharing=await app.inject({method:'PATCH',url:`/api/v1/households/${otherHousehold}/integrations/${otherConnection}/ha-sharing`,headers:admin(),payload:{expectedRevision:0,listIds:['groceries'],household:true,personIds:[],calendarSourceIds:[]}});assert.equal(sharing.statusCode,200,sharing.body);
  const grocery=await machine('POST','lists/groceries/items',{label:'Synthetic second-household secret',checked:false,requestKey:'separate-grocery-0001'},otherToken);assert.equal(grocery.statusCode,201,grocery.body);
  const message=await machine('POST','messages',{body:'Synthetic second-household message',importance:'normal',audience:{household:true,personIds:[]},expiresAt:future(),requestKey:'separate-message-0001'},otherToken);assert.equal(message.statusCode,201,message.body);
  const event=await machine('POST','calendars/samvev/events',{summary:'Synthetic second-household event',start:'2027-04-01',end:'2027-04-02',requestKey:'separate-event-0001'},otherToken);assert.equal(event.statusCode,201,event.body);
  const current=await machine('GET','snapshot');assert.equal(JSON.stringify(current.json()).includes('second-household'),false);
  assert.equal((await machine('PATCH',`lists/groceries/items/${grocery.json().item.id}`,{checked:true,expectedRevision:1,requestKey:'cross-household-grocery-0001'})).statusCode,409);
  assert.equal((await machine('PATCH',`messages/${message.json().message.id}`,{body:'Cross-household forbidden',expectedRevision:1,requestKey:'cross-household-message-0001'})).statusCode,404);
  assert.equal((await machine('PATCH',`calendars/samvev/events/${event.json().event.id}`,{summary:'Cross-household forbidden',expectedRevision:1,requestKey:'cross-household-event-0001'})).statusCode,404);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/integrations/${otherConnection}/ha-sharing`,headers:admin()})).statusCode,404);
  const rotated=await app.inject({method:'POST',url:`/api/v1/households/${otherHousehold}/integrations/${otherConnection}/credentials`,headers:admin(),payload:{name:'Synthetic rotated credential',capabilities:allCaps,expiresAt:null,expectedRevision:1}});assert.equal(rotated.statusCode,201,rotated.body);const replacement=rotated.json().credentialToken;
  assert.equal((await machine('GET','connection',undefined,replacement)).json().connectionId,otherConnection);
  const oldCredential=created.json().connection.credentials[0].id;
  const revoked=await app.inject({method:'POST',url:`/api/v1/households/${otherHousehold}/integrations/${otherConnection}/credentials/${oldCredential}/revoke`,headers:admin(),payload:{expectedRevision:1}});assert.equal(revoked.statusCode,200,revoked.body);
  assert.equal((await machine('GET','snapshot',undefined,otherToken)).statusCode,401);assert.equal((await machine('GET','snapshot',undefined,replacement)).json().lists[0].items.length,1);
  const connectionRevoked=await app.inject({method:'POST',url:`/api/v1/households/${otherHousehold}/integrations/${otherConnection}/revoke`,headers:admin(),payload:{expectedRevision:2}});assert.equal(connectionRevoked.statusCode,200,connectionRevoked.body);
  assert.equal((await machine('GET','snapshot',undefined,replacement)).statusCode,401);
});



test('explicit shared-native policy edits UI messages with CAS, replay and the original author intact',async()=>{
  const writer=await createConnection();await setSharing(writer.connectionId);
  const created=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:admin(),payload:{body:'Synthetic UI-owned message',importance:'normal',audience:{household:true,personIds:[ownerPersonId],displayIds:[]},expiresAt:future(),idempotencyKey:'ui-native-shared-message-0001'}});assert.equal(created.statusCode,201,created.body);const id=created.json().id;
  const author=(await pool.query('SELECT author_membership_id,author_integration_id FROM messages WHERE id=$1',[id])).rows[0];
  assert.equal((await machine('GET','snapshot',undefined,writer.token)).json().messages.find((row:any)=>row.id===id).readOnly,true);
  assert.equal((await machine('PATCH',`messages/${id}`,{body:'Not authorized yet',expectedRevision:1,requestKey:'ui-before-policy-0001'},writer.token)).statusCode,404);
  await setSharing(writer.connectionId,1,{allowSharedNativeWrites:true,personIds:[ownerPersonId]});
  const shared=(await machine('GET','snapshot',undefined,writer.token)).json();assert.equal(shared.grants.allowSharedNativeWrites,true);assert.equal(shared.messages.find((row:any)=>row.id===id).readOnly,false);
  const payload={body:'Synthetic UI message edited by HA',expectedRevision:1,requestKey:'ui-shared-edit-0001'};
  const edit=await machine('PATCH',`messages/${id}`,payload,writer.token);assert.equal(edit.statusCode,200,edit.body);assert.equal(edit.json().message.authorType,'member');assert.equal(edit.json().message.revision,2);
  const replay=await machine('PATCH',`messages/${id}`,payload,writer.token);assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().message.revision,2);
  assert.equal((await machine('PATCH',`messages/${id}`,{body:'Stale overwrite',expectedRevision:1,requestKey:'ui-stale-edit-0001'},writer.token)).statusCode,409);
  const races=await Promise.all(['first','second'].map(value=>machine('PATCH',`messages/${id}`,{body:`Synthetic concurrent ${value}`,expectedRevision:2,requestKey:`ui-race-${value}-0001`},writer.token)));assert.deepEqual(races.map(row=>row.statusCode).sort(),[200,409]);
  const withdraw={expectedRevision:3,requestKey:'ui-shared-withdraw-0001'};const ended=await machine('POST',`messages/${id}/withdraw`,withdraw,writer.token);assert.equal(ended.statusCode,200,ended.body);assert.equal(ended.json().message.state,'withdrawn');
  assert.equal((await machine('POST',`messages/${id}/withdraw`,withdraw,writer.token)).statusCode,200,'a committed withdrawal replays its tombstone');
  const preserved=(await pool.query('SELECT author_membership_id,author_integration_id,revision FROM messages WHERE id=$1',[id])).rows[0];assert.equal(preserved.author_membership_id,author.author_membership_id);assert.equal(preserved.author_integration_id,null);assert.equal(preserved.revision,4);
  const actors=(await pool.query(`SELECT actor_type,actor_id FROM message_lifecycle_events WHERE message_id=$1 AND actor_type='integration'`,[id])).rows;assert.equal(actors.length,3);assert.ok(actors.every(row=>row.actor_id===writer.connectionId));
  await setSharing(writer.connectionId,2,{allowSharedNativeWrites:false,personIds:[ownerPersonId]});
  const deniedReplay=await machine('PATCH',`messages/${id}`,payload,writer.token);assert.equal(deniedReplay.statusCode,404);assert.equal(deniedReplay.body.includes('Synthetic UI message edited by HA'),false);
  assert.equal((await machine('POST',`messages/${id}/withdraw`,withdraw,writer.token)).statusCode,404);
});

test('shared UI-message display targets require household authority and worker-created provenance stays read-only',async()=>{
  const writer=await createConnection();await setSharing(writer.connectionId,0,{allowSharedNativeWrites:true,household:false,personIds:[ownerPersonId]});
  const display=(await pool.query(`SELECT id FROM displays WHERE household_id=$1 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp() LIMIT 1`,[householdId])).rows[0].id;
  const created=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:admin(),payload:{body:'Synthetic UI display message',importance:'normal',audience:{household:false,personIds:[ownerPersonId],displayIds:[display]},expiresAt:future(),idempotencyKey:'ui-display-shared-0001'}});assert.equal(created.statusCode,201,created.body);const id=created.json().id;
  assert.equal((await machine('GET','snapshot',undefined,writer.token)).json().messages.find((row:any)=>row.id===id).readOnly,true);
  assert.equal((await machine('PATCH',`messages/${id}`,{body:'No display authority',expectedRevision:1,requestKey:'ui-display-no-household-0001'},writer.token)).statusCode,403);
  await setSharing(writer.connectionId,1,{allowSharedNativeWrites:true,household:true,personIds:[ownerPersonId]});
  await pool.query(`UPDATE message_display_targets SET delivery_state='displayed',delivered_revision=1,displayed_at=clock_timestamp() WHERE message_id=$1`,[id]);
  const edit=await machine('PATCH',`messages/${id}`,{body:'Synthetic screen content edited',expectedRevision:1,requestKey:'ui-display-edit-0001'},writer.token);assert.equal(edit.statusCode,200,edit.body);
  const target=(await pool.query('SELECT display_id,delivery_state,delivered_revision FROM message_display_targets WHERE message_id=$1',[id])).rows;assert.equal(target.length,1);assert.equal(target[0].display_id,display);assert.equal(target[0].delivery_state,'queued');assert.equal(target[0].delivered_revision,null);
  const broaden=await machine('PATCH',`messages/${id}`,{audience:{household:true,personIds:[],displayIds:[display]},expectedRevision:2,requestKey:'ui-display-target-forged-0001'},writer.token);assert.equal(broaden.statusCode,400,'HA cannot add or replace display targets');
  const generated=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:admin(),payload:{body:'Synthetic worker-owned output',importance:'normal',audience:{household:true,personIds:[],displayIds:[]},expiresAt:future(),idempotencyKey:'synthetic-worker-provenance-0001'}});assert.equal(generated.statusCode,201,generated.body);const generatedId=generated.json().id;
  // Match monitor/engine.ts provenance: its creation is worker-attributed even
  // though the persisted author_membership_id names the task owner.
  await pool.query(`UPDATE message_lifecycle_events SET actor_type='worker',actor_id=NULL WHERE message_id=$1 AND from_state IS NULL`,[generatedId]);
  const rows=(await machine('GET','snapshot',undefined,writer.token)).json().messages;assert.equal(rows.find((row:any)=>row.id===generatedId).authorType,'member');assert.equal(rows.find((row:any)=>row.id===generatedId).readOnly,true);
  assert.equal((await machine('PATCH',`messages/${generatedId}`,{body:'Must not edit worker output',expectedRevision:1,requestKey:'worker-output-edit-denied-0001'},writer.token)).statusCode,403);
  assert.equal((await machine('POST',`messages/${generatedId}/withdraw`,{expectedRevision:1,requestKey:'worker-output-withdraw-denied-0001'},writer.token)).statusCode,403);
  const foreign=(await pool.query('SELECT id FROM messages WHERE household_id<>$1 LIMIT 1',[householdId])).rows[0];assert.ok(foreign);assert.equal((await machine('PATCH',`messages/${foreign.id}`,{body:'Cross-household denied',expectedRevision:1,requestKey:'shared-cross-household-message-0001'},writer.token)).statusCode,404);
});

test('shared native calendar writes preserve the source, reject narrower audiences and reauthorize tombstone retries',async()=>{
  const producer=await createConnection(),writer=await createConnection();await setSharing(producer.connectionId,0,{personIds:[ownerPersonId]});await setSharing(writer.connectionId,0,{personIds:[ownerPersonId]});
  const payload={summary:'Synthetic other-connection native event',start:'2027-06-01',end:'2027-06-02',description:'Native source content',requestKey:'shared-native-event-create-0001'};
  const created=await machine('POST','calendars/samvev/events',payload,producer.token);assert.equal(created.statusCode,201,created.body);const id=created.json().event.id;
  const source=(await pool.query('SELECT connection_id,external_id,source FROM integration_items WHERE id=$1',[id])).rows[0];
  const range='calendars/samvev/events?start=2027-05-31T22:00:00Z&end=2027-06-02T22:00:00Z';
  assert.equal((await machine('GET',range,undefined,writer.token)).json().events.find((row:any)=>row.id===id).readOnly,true);
  assert.equal((await machine('PATCH',`calendars/samvev/events/${id}`,{summary:'Not yet permitted',expectedRevision:1,requestKey:'shared-event-before-policy-0001'},writer.token)).statusCode,404);
  await setSharing(writer.connectionId,1,{allowSharedNativeWrites:true,personIds:[]});
  assert.equal((await machine('GET',range,undefined,writer.token)).json().events.find((row:any)=>row.id===id).readOnly,true,'one readable audience does not authorize changing all original targets');
  assert.equal((await machine('PATCH',`calendars/samvev/events/${id}`,{summary:'Unshared person denied',expectedRevision:1,requestKey:'shared-event-narrow-policy-0001'},writer.token)).statusCode,403);
  await setSharing(writer.connectionId,2,{allowSharedNativeWrites:true,personIds:[ownerPersonId]});
  assert.equal((await machine('GET',range,undefined,writer.token)).json().events.find((row:any)=>row.id===id).readOnly,false);
  const update={summary:'Synthetic shared event edited',expectedRevision:1,requestKey:'shared-native-event-edit-0001'};
  const edited=await machine('PATCH',`calendars/samvev/events/${id}`,update,writer.token);assert.equal(edited.statusCode,200,edited.body);assert.equal(edited.json().event.revision,2);
  assert.equal((await machine('PATCH',`calendars/samvev/events/${id}`,update,writer.token)).statusCode,200);
  assert.equal((await machine('PATCH',`calendars/samvev/events/${id}`,{summary:'Stale native edit',expectedRevision:1,requestKey:'shared-native-event-stale-0001'},writer.token)).statusCode,409);
  const preserved=(await pool.query('SELECT connection_id,external_id,source FROM integration_items WHERE id=$1',[id])).rows[0];assert.deepEqual(preserved,source);
  assert.ok((await pool.query(`SELECT 1 FROM audit_events WHERE subject_id=$1 AND actor_type='integration' AND actor_id=$2 AND action='ha.event_edited'`,[id,writer.connectionId])).rowCount);
  const removal={expectedRevision:2,requestKey:'shared-native-event-delete-0001'};assert.equal((await machine('DELETE',`calendars/samvev/events/${id}`,removal,writer.token)).statusCode,200);
  assert.equal((await machine('DELETE',`calendars/samvev/events/${id}`,removal,writer.token)).statusCode,200,'withdrawn native row remains a retry witness');
  await setSharing(writer.connectionId,3,{allowSharedNativeWrites:false,personIds:[ownerPersonId]});
  assert.equal((await machine('DELETE',`calendars/samvev/events/${id}`,removal,writer.token)).statusCode,404);
  await setSharing(writer.connectionId,4,{allowSharedNativeWrites:true,personIds:[ownerPersonId]});
  const foreign=(await pool.query(`SELECT id FROM integration_items WHERE household_id<>$1 AND kind='event' LIMIT 1`,[householdId])).rows[0];assert.ok(foreign);assert.equal((await machine('DELETE',`calendars/samvev/events/${foreign.id}`,{expectedRevision:1,requestKey:'shared-cross-household-event-0001'},writer.token)).statusCode,404);
});

test('shared-native full powers never permit provider occurrences or generic producers even with a forged native marker',async()=>{
  const writer=await createConnection();await setSharing(writer.connectionId,0,{allowSharedNativeWrites:true,personIds:[ownerPersonId]});
  const imported=(await pool.query(`SELECT item.id,occurrence.source_id FROM integration_items item JOIN calendar_occurrences occurrence ON occurrence.integration_item_id=item.id WHERE item.household_id=$1 AND item.status='active' LIMIT 1`,[householdId])).rows[0];assert.ok(imported);
  await pool.query(`UPDATE integration_items SET metadata=jsonb_set(metadata,'{haBridge}','true') WHERE id=$1`,[imported.id]);
  for(const method of ['PATCH','DELETE'] as const){const denied=await machine(method,`calendars/samvev/events/${imported.id}`,{...(method==='PATCH'?{summary:'Forbidden provider edit'}:{}),expectedRevision:1,requestKey:`shared-provider-${method.toLowerCase()}-0001`},writer.token);assert.equal(denied.statusCode,403,denied.body);}
  const producer=await createConnection();await setSharing(producer.connectionId);
  const nativePayload={summary:'Synthetic native later reclassified',start:'2027-07-01',end:'2027-07-02',requestKey:'reclassified-native-create-0001'};
  const native=await machine('POST','calendars/samvev/events',nativePayload,producer.token);assert.equal(native.statusCode,201,native.body);const nativeId=native.json().event.id;
  await pool.query(`UPDATE integration_items SET metadata=jsonb_set(metadata,'{calendar}','{"provider":"google"}') WHERE id=$1`,[nativeId]);
  const range='calendars/samvev/events?start=2027-06-30T22:00:00Z&end=2027-07-02T22:00:00Z';assert.equal((await machine('GET',range,undefined,writer.token)).json().events.find((row:any)=>row.id===nativeId).readOnly,true);
  assert.equal((await machine('POST','calendars/samvev/events',nativePayload,producer.token)).statusCode,403,'old native receipt cannot bypass a current provider source marker');
  // Remove calendar metadata but retain a real occurrence relation. This
  // independently proves that haBridge=true is not sufficient authority.
  await pool.query(`UPDATE integration_items SET metadata=metadata-'calendar' WHERE id=$1`,[imported.id]);
  assert.equal((await machine('PATCH',`calendars/samvev/events/${imported.id}`,{summary:'Occurrence still immutable',expectedRevision:1,requestKey:'shared-occurrence-forged-0001'},writer.token)).statusCode,403);
  const generic=(await pool.query(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
    VALUES($1,$2,'synthetic-generic-source-event','event',true,'Synthetic generic event','Generic producer content','normal','2027-07-01','2027-07-02','{}','{"haBridge":true}',repeat('b',64)) RETURNING id`,[householdId,producer.connectionId])).rows[0].id;
  assert.equal((await machine('GET',range,undefined,writer.token)).json().events.find((row:any)=>row.id===generic).readOnly,true);
  assert.equal((await pool.query('SELECT ha_native_origin FROM integration_items WHERE id=$1',[generic])).rows[0].ha_native_origin,false,'a forged producer JSON marker cannot set server-owned creation provenance');
  assert.equal((await machine('PATCH',`calendars/samvev/events/${generic}`,{summary:'Generic event denied',expectedRevision:1,requestKey:'shared-generic-producer-0001'},writer.token)).statusCode,403);
});


async function waitForHaLock(fragment:string){
  for(let attempt=0;attempt<200;attempt++){
    const blocked=await pool.query(`SELECT 1 FROM pg_stat_activity WHERE application_name='samvev-api' AND state='active' AND wait_event_type='Lock' AND query ILIKE $1`,[`%${fragment}%`]);
    if(blocked.rowCount)return;
    await pool.query('SELECT pg_sleep(0.01)');
  }
  throw new Error('Synthetic HA lock wait was not observed');
}

test('display revocation winning its row lock prevents a shared UI-message edit',async()=>{
  const writer=await createConnection();await setSharing(writer.connectionId,0,{allowSharedNativeWrites:true});
  const setup=(await pool.query(`INSERT INTO display_setups(household_id,name,locale,theme) VALUES($1,'Synthetic race setup','en','light') RETURNING id`,[householdId])).rows[0].id;
  const display=(await pool.query(`INSERT INTO displays(household_id,name,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic revocation race',$2,repeat('1',64),clock_timestamp()+interval '1 hour') RETURNING id`,[householdId,setup])).rows[0].id;
  const created=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:admin(),payload:{body:'Synthetic original race message',importance:'normal',audience:{household:true,personIds:[],displayIds:[display]},expiresAt:future(),idempotencyKey:'ui-display-revoke-race-0001'}});assert.equal(created.statusCode,201,created.body);const id=created.json().id;
  const blocker=await pool.connect();let pending:Promise<LightMyRequestResponse>|undefined;
  try{
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM displays WHERE id=$1 FOR UPDATE',[display]);
    pending=machine('PATCH',`messages/${id}`,{body:'Must roll back revoked display edit',expectedRevision:1,requestKey:'ui-display-revoke-race-edit-0001'},writer.token);
    await waitForHaLock('FOR SHARE OF display');await blocker.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE id=$1',[display]);await blocker.query('COMMIT');
    const response=await pending;assert.equal(response.statusCode,403,response.body);
  }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
  const unchanged=(await pool.query('SELECT body,revision FROM messages WHERE id=$1',[id])).rows[0];assert.equal(unchanged.revision,1);assert.equal(unchanged.body,'Synthetic original race message');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM integration_ha_requests WHERE connection_id=$1 AND request_key=$2',[writer.connectionId,'ui-display-revoke-race-edit-0001'])).rows[0].count,0);
});

test('display expiry during a blocked target reset rolls back the shared edit and its receipt',async()=>{
  const writer=await createConnection();await setSharing(writer.connectionId,0,{allowSharedNativeWrites:true});
  const setup=(await pool.query(`INSERT INTO display_setups(household_id,name,locale,theme) VALUES($1,'Synthetic expiry setup','en','light') RETURNING id`,[householdId])).rows[0].id;
  const display=(await pool.query(`INSERT INTO displays(household_id,name,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic expiry race',$2,repeat('2',64),clock_timestamp()+interval '1 hour') RETURNING id`,[householdId,setup])).rows[0].id;
  const created=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:admin(),payload:{body:'Synthetic before target wait',importance:'normal',audience:{household:true,personIds:[],displayIds:[display]},expiresAt:future(),idempotencyKey:'ui-display-expiry-race-0001'}});assert.equal(created.statusCode,201,created.body);const id=created.json().id;
  await pool.query(`UPDATE displays SET credential_expires_at=clock_timestamp()+interval '700 milliseconds' WHERE id=$1`,[display]);
  const blocker=await pool.connect();let pending:Promise<LightMyRequestResponse>|undefined;
  try{
    await blocker.query('BEGIN');await blocker.query('SELECT message_id FROM message_display_targets WHERE message_id=$1 FOR UPDATE',[id]);
    pending=machine('PATCH',`messages/${id}`,{body:'Must not commit after expiry',expectedRevision:1,requestKey:'ui-display-expiry-race-edit-0001'},writer.token);
    await waitForHaLock('UPDATE message_display_targets SET delivery_state');
    for(let attempt=0;attempt<200;attempt++){
      if((await pool.query('SELECT credential_expires_at<=clock_timestamp() AS expired FROM displays WHERE id=$1',[display])).rows[0].expired)break;
      await pool.query('SELECT pg_sleep(0.01)');
    }
    assert.equal((await pool.query('SELECT credential_expires_at<=clock_timestamp() AS expired FROM displays WHERE id=$1',[display])).rows[0].expired,true);
    await blocker.query('COMMIT');const response=await pending;assert.equal(response.statusCode,403,response.body);
  }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
  const unchanged=(await pool.query('SELECT body,revision FROM messages WHERE id=$1',[id])).rows[0];assert.equal(unchanged.revision,1);assert.equal(unchanged.body,'Synthetic before target wait');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM integration_ha_requests WHERE connection_id=$1 AND request_key=$2',[writer.connectionId,'ui-display-expiry-race-edit-0001'])).rows[0].count,0);
});

test('HA polling authenticates 105 valid reads without consuming the legacy IP budget',async()=>{
  // 50 imported sources + native calendar + snapshot, twice each minute, plus
  // the connection handshake. This is within the advertised sharing maximum.
  for(let index=0;index<105;index++){
    const response=await machine('GET','connection');assert.equal(response.statusCode,200,`HA request ${index+1}: ${response.body}`);
  }
  const legacy=await createConnection(['integration.items.read']);
  for(let index=0;index<90;index++){
    const response=await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer(legacy.token)});assert.equal(response.statusCode,200,`legacy request ${index+1}: ${response.body}`);
  }
  const exhausted=await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer(legacy.token)});assert.equal(exhausted.statusCode,429,'the unchanged legacy IP budget is 90/minute');
  assert.equal((await machine('GET','connection')).statusCode,200,'valid HA traffic has its own IP budget');
});

test('HA auth preserves the shared 20/minute invalid-token brute-force limit',async()=>{
  const invalidToken='synthetic-invalid-ha-token-with-enough-entropy-0001';
  for(let index=0;index<20;index++){
    const response=await machine('GET','connection',undefined,invalidToken);assert.equal(response.statusCode,401,response.body);
  }
  assert.equal((await machine('GET','connection',undefined,invalidToken)).statusCode,429);
  const legacyInvalid=await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer(invalidToken)});assert.equal(legacyInvalid.statusCode,429,'invalid guesses share their existing budget across HA and legacy routes');
  assert.equal((await machine('GET','connection')).statusCode,200,'failed guesses do not turn a valid HA token into invalid authentication');
});

test('missing and malformed HA bearer headers retain the original shared 90/IP budget',async()=>{
  for(let index=0;index<90;index++){
    const response=await app.inject({method:'GET',url:'/api/v1/ha/connection',headers:index%2?{authorization:'Bearer short'}:{}});assert.equal(response.statusCode,401,response.body);
  }
  const denied=await app.inject({method:'GET',url:'/api/v1/ha/connection',headers:{authorization:'Bearer short'}});assert.equal(denied.statusCode,429);
  const legacy=await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer()});assert.equal(legacy.statusCode,429,'malformed HA requests still consume the shared legacy abuse budget');
});

test('sharing removal, expiry and old receipt replay are enforced on every request',async()=>{
  await setSharing(connectionId,2,{listIds:[],household:false,personIds:[]});const cleared=await machine('GET','snapshot');assert.deepEqual(cleared.json().lists,[]);assert.deepEqual(cleared.json().messages,[]);assert.deepEqual(cleared.json().calendars,[]);
  const receipt=(await pool.query("SELECT response FROM integration_ha_requests WHERE connection_id=$1 AND request_key='ha-message-create-0001'",[connectionId])).rows[0].response.message;
  const oldMessageReplay=await machine('POST','messages',{body:'Synthetic HA message',importance:'attention',audience:{household:true,personIds:[]},expiresAt:receipt.expiresAt,requestKey:'ha-message-create-0001'});assert.equal(oldMessageReplay.statusCode,403,'an old durable receipt cannot bypass narrower sharing');
  const oldEventReplay=await machine('POST','calendars/samvev/events',{summary:'Synthetic all day',start:'2027-03-28',end:'2027-03-29',requestKey:'ha-calendar-all-day-0001'});assert.equal(oldEventReplay.statusCode,403,'calendar receipt content is reauthorized');
  assert.equal((await machine('POST','lists/groceries/items',{label:'After revocation',checked:false,requestKey:'revoked-grocery-0001'})).statusCode,403);
  assert.equal((await machine('POST','calendars/samvev/events',{summary:'After revocation',start:'2027-03-28',end:'2027-03-29',requestKey:'revoked-event-0001'})).statusCode,403);
  const badSharing=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/integrations/${connectionId}/ha-sharing`,headers:admin(),payload:{expectedRevision:3,listIds:[],household:false,personIds:['00000000-0000-4000-8000-000000000000'],calendarSourceIds:[]}});assert.equal(badSharing.statusCode,404,badSharing.body);
  await pool.query('UPDATE integration_credentials SET expires_at=clock_timestamp()-interval \'1 second\' WHERE connection_id=$1',[connectionId]);assert.equal((await machine('GET','snapshot')).statusCode,401);
});
