import assert from 'node:assert/strict';
import test,{after,before,type TestContext} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {opaqueToken,tokenHash} from '@samvev/core';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';

const origin='https://round13-all-day.test.invalid';
let app:FastifyInstance,householdId:string,viewerId:string,childId:string,viewerCookie:string,connectionId:string,sourceId:string,displayId:string,displayCookie:string,ungrantedCookie:string;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function endpoints(){return[
  {path:`/api/v1/households/${householdId}/activities`,cookie:viewerCookie},
  {path:`/api/v1/households/${householdId}/people/${childId}/activities`,cookie:viewerCookie},
  {path:'/api/v1/display/activities',cookie:displayCookie}
];}
async function get(path:string,cookie:string){const response=await app.inject({method:'GET',url:path,headers:{cookie}});assert.equal(response.statusCode,200,response.body);return response.json();}
async function reset(zone:string){await pool.query('DELETE FROM integration_items WHERE household_id=$1',[householdId]);await pool.query('UPDATE households SET timezone=$2 WHERE id=$1',[householdId,zone]);}
async function withClock(t:TestContext,instant:string,run:()=>Promise<void>){
  // Only JavaScript Date is mocked. Timers, SQL authorization/publication/
  // expiry and every school clock_timestamp() remain on the real DB clock.
  t.mock.timers.enable({apis:['Date'],now:Date.parse(instant)});
  try{await run();}finally{t.mock.timers.reset();}
}
async function event(start:string,end:string|null,options:{allDay?:boolean;private?:boolean;generic?:boolean}={}){
  const key=randomUUID(),allDay=options.allDay??true;
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,publish_at,expires_at,source,metadata,request_hash)
    VALUES($1,$2,$3,'event',$4,'Synthetic civil calendar event','Synthetic only','normal',$5,$6,clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','{}',$7,$8) RETURNING id`,
    [householdId,connectionId,key,!options.private,start,end,JSON.stringify(options.generic?{allDay}:{allDay,calendar:{provider:'ics',sourceId,subjectHousehold:true}}),digest(key)])).rows[0]!.id;
  if(options.private)await pool.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item,childId]);
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item,childId]);
  if(!options.generic)await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,'single',$4,$3,$5,'active',1)`,[householdId,sourceId,key,item,digest(key)]);
  if(!options.private)await pool.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[householdId,item,displayId]);
  return item;
}
async function windowIds(from:string,to=from){
  const responses=[];
  for(const endpoint of endpoints())responses.push(await get(`${endpoint.path}?from=${from}&to=${to}&limit=50`,endpoint.cookie));
  return responses;
}
async function assertNext(id:string|null){for(const endpoint of endpoints()){const response=await get(`${endpoint.path}/next`,endpoint.cookie);assert.equal(response.activity?.id??null,id,endpoint.path);assert.ok(!Array.isArray(response.activity));}}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('All-day activity tests refuse a non-isolated samvev_test database');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic civil calendar owner',email:'all-day-owner@test.invalid',password:'Synthetic-all-day-owner-password-42'},household:{name:'Synthetic civil calendar household',timezone:'Pacific/Honolulu',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;const ownerAccount=(await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1',[claim.json().membershipId])).rows[0]!.account_id;
  viewerId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic calendar reader','adult') RETURNING id`,[householdId])).rows[0]!.id;
  childId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic calendar subject','child') RETURNING id`,[householdId])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,'all-day-reader@test.invalid','synthetic-unused-hash','en','light' FROM households WHERE id=$1 RETURNING id`,[householdId])).rows[0]!.id;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'limited','["household.view"]')`,[householdId,account,viewerId]);
  const token=opaqueToken();await pool.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`,[account,tokenHash(token),tokenHash(opaqueToken())]);viewerCookie=`samvev_session=${token}`;
  connectionId=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic civil calendar integration') RETURNING id`,[householdId])).rows[0]!.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state) VALUES($1,$2,$3,'ics','Synthetic civil calendar','connected') RETURNING id`,[householdId,connectionId,ownerAccount])).rows[0]!.id;
  sourceId=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household,subject_household) VALUES($1,$2,'synthetic-civil-source','Synthetic civil source',true,true,true) RETURNING id`,[householdId,calendar])).rows[0]!.id;
  const setup=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,cards,card_order,all_sources,locale,theme) VALUES($1,'Synthetic civil setup','["external_items","week","next"]','["external_items","week","next"]',true,'en','light') RETURNING id`,[householdId])).rows[0]!.id;
  await pool.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[householdId,setup,childId]);
  for(const granted of [true,false]){const token=opaqueToken(),device=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,setup_id,credential_hash,credential_expires_at,external_items_enabled) VALUES($1,'Synthetic civil device',$2,$3,clock_timestamp()+interval '90 days',true) RETURNING id`,[householdId,setup,tokenHash(token)])).rows[0]!.id;if(granted){displayId=device;displayCookie=`samvev_display=${token}`;}else ungrantedCookie=`samvev_display=${token}`;}
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[householdId,connectionId,displayId]);
});
after(async()=>{await app.close();await pool.end();});

test('west-offset all-day activities remain ongoing until local exclusive end and omit adjacent civil days',async t=>{
  await reset('Pacific/Honolulu');
  await withClock(t,'2026-10-16T03:30:00Z',async()=>{
    const ongoing=await event('2026-10-15T00:00:00Z','2026-10-16T00:00:00Z');
    const noEnd=await event('2026-10-15T00:00:00Z',null),tomorrow=await event('2026-10-16T00:00:00Z','2026-10-17T00:00:00Z');
    await event('2026-10-14T00:00:00Z','2026-10-15T00:00:00Z');await event('2026-10-14T00:00:00Z','2026-10-17T00:00:00Z',{private:true});
    const timed=await event('2026-10-16T05:00:00Z','2026-10-16T06:00:00Z',{allDay:false});
    for(const response of await windowIds('2026-10-15')){assert.deepEqual(response.activities.map((row:{id:string})=>row.id).sort(),[ongoing,noEnd,timed].sort());const row=response.activities.find((row:{id:string})=>row.id===ongoing);assert.equal(row.startsAt,'2026-10-15T00:00:00.000Z');assert.equal(row.endsAt,'2026-10-16T00:00:00.000Z','DTO preserves civil sentinels');}
    await assertNext([ongoing,noEnd].sort()[0]!);
    t.mock.timers.setTime(Date.parse('2026-10-16T10:00:00Z'));await assertNext(tomorrow);
    for(const response of await windowIds('2026-10-16'))assert.deepEqual(response.activities.map((row:{id:string})=>row.id),[tomorrow],'local midnight is exclusive, including the missing-end single-day fallback');
    assert.deepEqual((await get('/api/v1/display/activities?from=2026-10-16&to=2026-10-16',ungrantedCookie)).activities,[],'shared setup does not grant another device item access');
    assert.equal((await get('/api/v1/display/activities/next',ungrantedCookie)).activity,null);
  });
});

test('east-offset all-day activities exclude yesterday after local midnight even before the UTC marker',async t=>{
  await reset('Pacific/Kiritimati');
  await withClock(t,'2026-10-15T23:30:00Z',async()=>{
    await event('2026-10-15T00:00:00Z','2026-10-16T00:00:00Z');
    const today=await event('2026-10-16T00:00:00Z','2026-10-17T00:00:00Z'),noEnd=await event('2026-10-16T00:00:00Z',null),tomorrow=await event('2026-10-17T00:00:00Z','2026-10-18T00:00:00Z');
    const timed=await event('2026-10-15T23:45:00Z','2026-10-16T00:30:00Z',{allDay:false});
    await event('2026-10-14T00:00:00Z','2026-10-18T00:00:00Z',{private:true});
    for(const response of await windowIds('2026-10-16'))assert.deepEqual(response.activities.map((row:{id:string})=>row.id).sort(),[today,noEnd,timed].sort());
    await assertNext([today,noEnd].sort()[0]!);
    t.mock.timers.setTime(Date.parse('2026-10-16T10:00:00Z'));await assertNext(tomorrow);
  });
});

test('local all-day boundaries order with timed instants and remain stable through every pagination cursor',async t=>{
  await reset('Pacific/Honolulu');
  await withClock(t,'2026-10-16T03:30:00Z',async()=>{
    const early=await event('2026-10-16T05:00:00Z','2026-10-16T06:00:00Z',{allDay:false}),allDay=await event('2026-10-16T00:00:00Z','2026-10-17T00:00:00Z');
    const same=await event('2026-10-16T10:00:00Z','2026-10-16T11:00:00Z',{allDay:false}),late=await event('2026-10-16T11:00:00Z','2026-10-16T12:00:00Z',{allDay:false});
    await assertNext(early);
    const expected=[early,...[allDay,same].sort(),late];
    for(const endpoint of endpoints()){
      const seen:string[]=[];let cursor:string|null=null;
      do{const response=await get(`${endpoint.path}?from=2026-10-15&to=2026-10-16&limit=1${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,endpoint.cookie);assert.equal(response.activities.length,1);const row=response.activities[0];seen.push(row.id);cursor=response.nextCursor;assert.ok(seen.length<=4,'pagination terminates');if(cursor&&[allDay,same].includes(row.id))assert.equal(JSON.parse(Buffer.from(cursor,'base64url').toString()).at,'2026-10-16T10:00:00.000Z');if(row.id===allDay)assert.equal(row.startsAt,'2026-10-16T00:00:00.000Z');}while(cursor);
      assert.deepEqual(seen,expected,endpoint.path);assert.equal(new Set(seen).size,4);
    }
  });
});

test('DST all-day end is local midnight and generic allDay metadata retains its existing instant semantics',async t=>{
  await reset('Europe/Oslo');
  await withClock(t,'2026-10-25T22:30:00Z',async()=>{
    const allDay=await event('2026-10-25T00:00:00Z','2026-10-26T00:00:00Z');await assertNext(allDay);
    t.mock.timers.setTime(Date.parse('2026-10-25T23:00:00Z'));await assertNext(null);
    for(const response of await windowIds('2026-10-26'))assert.deepEqual(response.activities,[],'a 25-hour civil day ends at household midnight, not its UTC sentinel');
    const generic=await event('2026-10-25T23:15:00Z','2026-10-26T00:15:00Z',{generic:true});await assertNext(generic);
  });
});

test('Date-only activity clock mocking leaves real SQL session, publication and item expiry enforcement intact',async t=>{
  await reset('Pacific/Honolulu');
  await withClock(t,'2030-10-16T03:30:00Z',async()=>{
    const active=await event('2030-10-15T00:00:00Z','2030-10-16T00:00:00Z');
    const expired=await event('2030-10-14T00:00:00Z','2030-10-17T00:00:00Z'),unpublished=await event('2030-10-14T00:00:00Z','2030-10-17T00:00:00Z');
    await pool.query(`UPDATE integration_items SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[expired]);
    await pool.query(`UPDATE integration_items SET publish_at=clock_timestamp()+interval '1 day' WHERE id=$1`,[unpublished]);
    await assertNext(active);
    for(const response of await windowIds('2030-10-15'))assert.deepEqual(response.activities.map((row:{id:string})=>row.id),[active]);
    const hash=tokenHash(viewerCookie.slice('samvev_session='.length));
    await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1`,[hash]);
    try{for(const endpoint of endpoints().slice(0,2)){const response=await app.inject({method:'GET',url:`${endpoint.path}/next`,headers:{cookie:viewerCookie}});assert.equal(response.statusCode,401,response.body);}}
    finally{await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1`,[hash]);}
  });
});
