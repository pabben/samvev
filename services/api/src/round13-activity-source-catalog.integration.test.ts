import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {opaqueToken,tokenHash} from '@samvev/core';
import pg from 'pg';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';

const origin='https://round13-source-catalog.test.invalid';
let app:FastifyInstance,householdId:string,ownerAccountId:string,ownerCookie:string,viewerCookie:string,viewerAccountId:string,viewerPersonId:string;
let connectionId:string,integrationId:string,setupId:string,firstDisplayId:string,firstCookie:string,secondDisplayId:string,secondCookie:string;
let emptyId:string,futureId:string,privateId:string,readerId:string,unplacedId:string,otherHouseholdId:string;
const memberExpected:string[]=[],displayExpected:string[]=[];
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'];return(Array.isArray(value)?value:value?[value]:[]).map(part=>part.split(';')[0]).join('; ');}
const memberPath=()=>`/api/v1/households/${householdId}/activities/sources`;
const displayPath='/api/v1/display/activities/sources';
async function catalog(path:string,cookie:string,limit=100){
  const sources:Array<{id:string;name:string}>=[];let cursor:string|null=null,pages=0;
  do{
    const response:LightMyRequestResponse=await app.inject({method:'GET',url:`${path}?limit=${limit}${cursor?`&cursor=${cursor}`:''}`,headers:{cookie}});assert.equal(response.statusCode,200,response.body);assert.match(String(response.headers['cache-control']),/private, no-store/);
    const page=response.json<{sources:Array<{id:string;name:string}>;nextCursor:string|null}>();assert.deepEqual(Object.keys(page).sort(),['nextCursor','sources']);assert.ok(page.sources.length<=limit);for(const row of page.sources)assert.deepEqual(Object.keys(row).sort(),['id','name']);
    sources.push(...page.sources);cursor=page.nextCursor;pages++;assert.ok(pages<20,'source cursor must terminate');
  }while(cursor);
  assert.equal(new Set(sources.map(row=>row.id)).size,sources.length,'source pages contain no duplicate IDs');
  return{sources,pages};
}
async function makeConnection(household=householdId,revoked=false,disconnected=false){
  const integration=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name,revoked_at) VALUES($1,'Synthetic calendar integration',CASE WHEN $2 THEN clock_timestamp() END) RETURNING id`,[household,revoked])).rows[0]!.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state,disconnected_at,account_label,credential_ciphertext) VALUES($1,$2,$3,'ics','Synthetic calendar connection',CASE WHEN $4 THEN 'disconnected' ELSE 'error' END,CASE WHEN $4 THEN clock_timestamp() END,'synthetic-private-provider-label','synthetic-not-a-real-credential') RETURNING id`,[household,integration,ownerAccountId,disconnected])).rows[0]!.id;
  return{integration,calendar};
}
async function source(name:string,options:{connection?:string;household?:string;householdReader?:boolean;enabled?:boolean;subjectHousehold?:boolean;displayName?:string}={}){
  return(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,display_name,enabled,target_household,subject_household,available,last_error_code,source_provenance)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,'CALENDAR_SYNC_FAILED','{"private":"synthetic-hidden-provenance"}') RETURNING id`,[options.household??householdId,options.connection??connectionId,randomUUID(),name,options.displayName??null,options.enabled??true,options.householdReader??true,options.subjectHousehold??true])).rows[0]!.id;
}
async function pair(name:string){
  const token=opaqueToken();const row=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,setup_id,credential_hash,credential_expires_at,external_items_enabled) VALUES($1,$2,'en','light',$3,$4,clock_timestamp()+interval '90 days',true) RETURNING id`,[householdId,name,setupId,tokenHash(token)])).rows[0]!;
  return{id:row.id,cookie:`samvev_display=${token}`};
}
// Observe the exact session that owns our test lock, not SQL text: activity
// text is truncated and the auth snapshot may now encounter this lock first.
async function waitForCatalogBlocker(blocker:pg.Client,count=1){
  const pid=(await blocker.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  const deadline=Date.now()+4_000;
  do{
    const waiting=await pool.query(`SELECT activity.pid FROM pg_stat_activity activity
      WHERE activity.datname=current_database() AND activity.wait_event_type='Lock'
        AND $1::int=ANY(pg_blocking_pids(activity.pid))`,[pid]);
    if((waiting.rowCount??0)>=count)return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }while(Date.now()<deadline);
  assert.fail(`catalog must reach ${count} waits blocked by its test lock holder`);
}
async function waitForExpiry(query:string,values:string[]){const deadline=Date.now()+4_000;do{if((await pool.query<{expired:boolean}>(query,values)).rows[0]!.expired)return;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);assert.fail('actor must expire while the source query is blocked');}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Source catalog test refuses a non-isolated samvev_test database');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claimed=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic catalog owner',email:'source-catalog-owner@test.invalid',password:'Synthetic-source-catalog-password-42'},household:{name:'Synthetic catalog household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claimed.statusCode,200,claimed.body);
  householdId=claimed.json().householdId;ownerCookie=cookies(claimed);const owner=(await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1',[claimed.json().membershipId])).rows[0]!;ownerAccountId=owner.account_id;
  viewerPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic limited child reader','child') RETURNING id`,[householdId])).rows[0]!.id;
  viewerAccountId=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,'source-catalog-reader@test.invalid','synthetic-unused-password-hash','en','light' FROM households WHERE id=$1 RETURNING id`,[householdId])).rows[0]!.id;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'limited','["household.view"]')`,[householdId,viewerAccountId,viewerPersonId]);
  const viewerToken=opaqueToken();await pool.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`,[viewerAccountId,tokenHash(viewerToken),tokenHash(opaqueToken())]);viewerCookie=`samvev_session=${viewerToken}`;
  const connection=await makeConnection();connectionId=connection.calendar;integrationId=connection.integration;
  for(let index=0;index<105;index++){const id=await source(`Synthetic calendar ${String(index).padStart(3,'0')}`);memberExpected.push(id);displayExpected.push(id);}
  emptyId=await source('Synthetic empty stale calendar',{displayName:'Synthetic chosen empty label'});futureId=await source('Synthetic future-only calendar');readerId=await source('Synthetic member-readable private calendar',{householdReader:false});privateId=await source('Synthetic subject-only private calendar',{householdReader:false,subjectHousehold:false});unplacedId=await source('Synthetic unselected-person calendar',{subjectHousehold:false});
  memberExpected.push(emptyId,futureId,readerId,unplacedId);displayExpected.push(emptyId,futureId,readerId,privateId);
  await pool.query('INSERT INTO calendar_source_person_readers(household_id,source_id,person_id) VALUES($1,$2,$3)',[householdId,readerId,viewerPersonId]);
  await pool.query('INSERT INTO calendar_source_person_subjects(household_id,source_id,person_id) VALUES($1,$2,$3)',[householdId,privateId,viewerPersonId]);
  const hiddenPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic unselected subject','child') RETURNING id`,[householdId])).rows[0]!.id;
  await pool.query('INSERT INTO calendar_source_person_subjects(household_id,source_id,person_id) VALUES($1,$2,$3)',[householdId,unplacedId,hiddenPerson]);
  await source('Synthetic disabled calendar',{enabled:false});const disconnected=await makeConnection(householdId,false,true);await source('Synthetic disconnected calendar',{connection:disconnected.calendar});const revoked=await makeConnection(householdId,true);await source('Synthetic revoked integration calendar',{connection:revoked.calendar});
  otherHouseholdId=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,'Synthetic other catalog household','UTC','en' FROM households WHERE id=$1 RETURNING id`,[householdId])).rows[0]!.id;const other=await makeConnection(otherHouseholdId);await source('Synthetic other-household source',{connection:other.calendar,household:otherHouseholdId});
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,publish_at,starts_at,ends_at,expires_at,source,metadata,request_hash)
    VALUES($1,$2,'synthetic-future-catalog-item','event',true,'Synthetic unpublished future event','Synthetic only','normal',clock_timestamp()+interval '1 day',clock_timestamp()+interval '20 days',clock_timestamp()+interval '20 days 1 hour',clock_timestamp()+interval '21 days','{}',$3,$4) RETURNING id`,[householdId,integrationId,JSON.stringify({calendar:{sourceId:futureId,subjectHousehold:true}}),createHash('sha256').update('synthetic-future-catalog-item').digest('hex')])).rows[0]!.id;
  await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,'synthetic-future','single',$3,'synthetic-future-catalog-item',$4,'active',1)`,[householdId,futureId,item,'a'.repeat(64)]);
  setupId=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,cards,card_order,all_sources,locale,theme) VALUES($1,'Synthetic shared catalog setup','["external_items","week","next"]','["external_items","week","next"]',true,'en','light') RETURNING id`,[householdId])).rows[0]!.id;
  await pool.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[householdId,setupId,viewerPersonId]);
  for(const id of [emptyId,futureId])await pool.query('INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id) VALUES($1,$2,$3)',[householdId,setupId,id]);
  await pool.query('INSERT INTO display_setup_sources(household_id,setup_id,connection_id) VALUES($1,$2,$3)',[householdId,setupId,integrationId]);
  const first=await pair('Synthetic first catalog device');firstDisplayId=first.id;firstCookie=first.cookie;const second=await pair('Synthetic second catalog device');secondDisplayId=second.id;secondCookie=second.cookie;
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[householdId,integrationId,firstDisplayId]);
  for(const id of [...displayExpected,unplacedId])await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[householdId,id,firstDisplayId]);
});
after(async()=>{await app.close();await pool.end();});

test('member catalog exhausts over 100 sources including empty and future-only calendars without revealing private metadata',async()=>{
  const result=await catalog(memberPath(),viewerCookie);assert.equal(result.pages,2);assert.deepEqual(result.sources.map(row=>row.id),[...memberExpected].sort());assert.equal(result.sources.find(row=>row.id===emptyId)!.name,'Synthetic chosen empty label');assert.ok(result.sources.some(row=>row.id===futureId));assert.ok(result.sources.some(row=>row.id===readerId));assert.ok(!result.sources.some(row=>row.id===privateId),'being a source subject is not a source read grant');
  const home=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:{cookie:viewerCookie}});assert.equal(home.statusCode,200,home.body);assert.equal(home.json().items.length,0,'the catalog does not derive entries from projected active items');
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/calendar-connections`,headers:{cookie:viewerCookie}})).statusCode,403,'catalog access does not require calendar management');
  const manager=await catalog(memberPath(),ownerCookie);assert.ok(manager.sources.some(row=>row.id===privateId),'existing household manager read bypass is retained');
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${otherHouseholdId}/activities/sources`,headers:{cookie:viewerCookie}})).statusCode,404);
});

test('display catalog paginates device grants independently of a shared setup and member readership',async()=>{
  const result=await catalog(displayPath,firstCookie,37);assert.equal(result.pages,3);assert.deepEqual(result.sources.map(row=>row.id),[...displayExpected].sort());assert.ok(result.sources.some(row=>row.id===privateId),'explicit display readership is independent of member readership');assert.ok(!result.sources.some(row=>row.id===unplacedId),'source subject placement still intersects selected people');
  assert.deepEqual((await catalog(displayPath,secondCookie)).sources,[],'the same setup never grants another device source access');
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[householdId,integrationId,secondDisplayId]);assert.deepEqual((await catalog(displayPath,secondCookie)).sources,[],'connection grant alone does not grant a source');
  await pool.query('DELETE FROM integration_connection_display_grants WHERE household_id=$1 AND connection_id=$2 AND display_id=$3',[householdId,integrationId,secondDisplayId]);await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[householdId,emptyId,secondDisplayId]);assert.deepEqual((await catalog(displayPath,secondCookie)).sources,[],'source grant also requires current connection authority');
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[householdId,integrationId,secondDisplayId]);assert.deepEqual((await catalog(displayPath,secondCookie)).sources.map(row=>row.id),[emptyId]);
});

test('exact setup calendar selection narrows a generic selected connection and current grants remain required',async()=>{
  await pool.query('UPDATE display_setups SET all_sources=false WHERE id=$1',[setupId]);assert.deepEqual((await catalog(displayPath,firstCookie)).sources.map(row=>row.id),[emptyId,futureId].sort(),'generic connection selection cannot override individual calendar selection');
  await pool.query('DELETE FROM calendar_source_display_targets WHERE household_id=$1 AND source_id=$2 AND display_id=$3',[householdId,futureId,firstDisplayId]);assert.deepEqual((await catalog(displayPath,firstCookie)).sources.map(row=>row.id),[emptyId]);await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[householdId,futureId,firstDisplayId]);
});

test('privacy, external opt-in, card selection and revoked device gates apply to source catalogs',async()=>{
  for(const field of ['privacy_mode','external_items_enabled'] as const){await pool.query(`UPDATE displays SET ${field}=$2 WHERE id=$1`,[firstDisplayId,field==='privacy_mode']);assert.deepEqual((await catalog(displayPath,firstCookie)).sources,[]);await pool.query(`UPDATE displays SET ${field}=$2 WHERE id=$1`,[firstDisplayId,field!=='privacy_mode']);}
  await pool.query(`UPDATE display_setups SET cards='["week","next"]',card_order='["week","next"]' WHERE id=$1`,[setupId]);assert.deepEqual((await catalog(displayPath,firstCookie)).sources,[]);await pool.query(`UPDATE display_setups SET cards='["external_items","week","next"]',card_order='["external_items","week","next"]' WHERE id=$1`,[setupId]);
  await pool.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE id=$1',[secondDisplayId]);assert.equal((await app.inject({method:'GET',url:displayPath,headers:{cookie:secondCookie}})).statusCode,401);
  for(const query of ['limit=0','limit=101','limit=bad','cursor=not-a-uuid'])assert.equal((await app.inject({method:'GET',url:`${memberPath()}?${query}`,headers:{cookie:viewerCookie}})).statusCode,400);
});

test('catalogs discard source reader and device grants revoked while the source query waits',async()=>{
  const sorted=[...memberExpected].sort(),previous=sorted[sorted.indexOf(readerId)-1];
  const memberUrl=`${memberPath()}${previous?`?cursor=${previous}`:''}`;
  const before=await app.inject({method:'GET',url:memberUrl,headers:{cookie:viewerCookie}});assert.equal(before.statusCode,200,before.body);assert.equal(before.json().sources[0].id,readerId,'revoked source must be on the tested page');
  const lock=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE integration_connections IN ACCESS EXCLUSIVE MODE');
  let member!:Promise<LightMyRequestResponse>,display!:Promise<LightMyRequestResponse>;
  try{
    member=app.inject({method:'GET',url:memberUrl,headers:{cookie:viewerCookie}}).then(response=>response);
    display=app.inject({method:'GET',url:displayPath,headers:{cookie:firstCookie}}).then(response=>response);
    await waitForCatalogBlocker(lock,2);
    // Match the source mutation protocol: change the source revision before
    // replacing its reader/device grants, while the catalog snapshot waits.
    await pool.query('UPDATE calendar_sources SET revision=revision+1 WHERE id=ANY($1::uuid[])',[[readerId,futureId]]);
    await pool.query('DELETE FROM calendar_source_person_readers WHERE source_id=$1 AND person_id=$2',[readerId,viewerPersonId]);
    await pool.query('DELETE FROM calendar_source_display_targets WHERE source_id=$1 AND display_id=$2',[futureId,firstDisplayId]);
  }finally{await lock.query('ROLLBACK');await lock.end();}
  try{
    const [memberResult,displayResult]=await Promise.all([member,display]);assert.equal(memberResult.statusCode,200,memberResult.body);assert.equal(displayResult.statusCode,200,displayResult.body);
    assert.ok(!memberResult.json().sources.some((row:{id:string})=>row.id===readerId),'revoked member reader receives no cached source name');
    assert.ok(!displayResult.json().sources.some((row:{id:string})=>row.id===futureId),'revoked device grant receives no cached source name');
  }finally{
    await pool.query('INSERT INTO calendar_source_person_readers(household_id,source_id,person_id) VALUES($1,$2,$3)',[householdId,readerId,viewerPersonId]);
    await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[householdId,futureId,firstDisplayId]);
  }
});

test('display catalog applies setup narrowing committed while acquiring the current setup lock',async()=>{
  const lock=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await lock.connect();await lock.query('BEGIN');
  await lock.query('UPDATE display_setups SET revision=revision+1 WHERE id=$1',[setupId]);
  await lock.query('DELETE FROM display_setup_calendar_sources WHERE setup_id=$1 AND source_id=$2',[setupId,futureId]);
  let request!:Promise<LightMyRequestResponse>;
  try{
    request=app.inject({method:'GET',url:displayPath,headers:{cookie:firstCookie}}).then(response=>response);
    await waitForCatalogBlocker(lock);
    await lock.query('COMMIT');
    const response=await request;assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,'CONFLICT');assert.equal(response.json().sources,undefined,'changed policy returns no stale source page');
    assert.doesNotMatch(response.body,/Synthetic future-only calendar|Synthetic chosen empty label/);
    const fresh=await app.inject({method:'GET',url:displayPath,headers:{cookie:firstCookie}});assert.equal(fresh.statusCode,200,fresh.body);assert.deepEqual(fresh.json().sources.map((row:{id:string})=>row.id),[emptyId],'a fresh read preserves the narrowed selection without the removed source');
  }finally{
    await lock.query('ROLLBACK');await lock.end();
    if(request)await request;
    await pool.query('INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[householdId,setupId,futureId]);
  }
});

test('member catalog rejects session expiry after a source query lock wait',async()=>{
  const lock=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE calendar_sources IN ACCESS EXCLUSIVE MODE');let request!:Promise<LightMyRequestResponse>;
  try{const token=opaqueToken();const session=(await pool.query<{id:string}>(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1500 milliseconds') RETURNING id`,[viewerAccountId,tokenHash(token),tokenHash(opaqueToken())])).rows[0]!;request=app.inject({method:'GET',url:memberPath(),headers:{cookie:`samvev_session=${token}`}}).then(response=>response);await waitForCatalogBlocker(lock);await waitForExpiry('SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1',[session.id]);}finally{await lock.query('ROLLBACK');await lock.end();}
  const result=await request;assert.equal(result.statusCode,401,result.body);assert.equal(result.json().sources,undefined,'expired actor receives no source metadata');
});

test('display catalog rejects credential expiry after a source query lock wait',async()=>{
  const previous=(await pool.query<{credential_expires_at:Date}>('SELECT credential_expires_at FROM displays WHERE id=$1',[firstDisplayId])).rows[0]!.credential_expires_at;
  const lock=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE calendar_sources IN ACCESS EXCLUSIVE MODE');let request!:Promise<LightMyRequestResponse>;
  try{await pool.query(`UPDATE displays SET credential_expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`,[firstDisplayId]);request=app.inject({method:'GET',url:displayPath,headers:{cookie:firstCookie}}).then(response=>response);await waitForCatalogBlocker(lock);await waitForExpiry('SELECT credential_expires_at<=clock_timestamp() AS expired FROM displays WHERE id=$1',[firstDisplayId]);}finally{await lock.query('ROLLBACK');await lock.end();}
  const result=await request;assert.equal(result.statusCode,401,result.body);assert.equal(result.json().sources,undefined);await pool.query('UPDATE displays SET credential_expires_at=$2 WHERE id=$1',[firstDisplayId,previous]);
});
