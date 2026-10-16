import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import pg from 'pg';
import {tokenHash} from '@samvev/core';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {normalizeProfilePhoto} from './people/photo.ts';

const origin='https://samvev-photo-auth.test.invalid';
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
let app:FastifyInstance,installationId:string,householdId:string,ownerAccountId:string,sequence=0;
let ownerHeaders:{cookie:string;'x-csrf-token':string;origin:string};
type Actor={accountId:string;membershipId:string;personId:string;sessionId:string;headers:{cookie:string;'x-csrf-token':string;origin:string}};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return{promise,resolve};}
let decodeBarrier:{entered:ReturnType<typeof deferred>;release:ReturnType<typeof deferred>}|null=null;
async function until(check:()=>Promise<boolean>,description:string,timeoutMs=4_000){const deadline=Date.now()+timeoutMs;do{if(await check())return;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);assert.fail(description);}
async function person(){return(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic photo target','child') RETURNING id`,[householdId])).rows[0]!.id;}
async function actor(capabilities:string[]=[]):Promise<Actor>{
  const n=++sequence,personId=await person();
  const accountId=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,$2,password_hash,'en','light' FROM accounts WHERE id=$1 RETURNING id`,[ownerAccountId,`photo-auth-${n}@test.invalid`])).rows[0]!.id;
  const membershipId=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'limited',$4) RETURNING id`,[householdId,accountId,personId,JSON.stringify(capabilities)])).rows[0]!.id;
  const token=`synthetic-photo-session-${n}`,csrf=`synthetic-photo-csrf-${n}`;
  const sessionId=(await pool.query<{id:string}>(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour') RETURNING id`,[accountId,tokenHash(token),tokenHash(csrf)])).rows[0]!.id;
  return{accountId,membershipId,personId,sessionId,headers:{cookie:`samvev_session=${token}`,'x-csrf-token':csrf,origin}};
}
function photoPath(personId:string){return`/api/v1/households/${householdId}/people/${personId}/photo`;}
async function seedPhoto(viewer:Actor,personId=viewer.personId){const response=await app.inject({method:'PUT',url:photoPath(personId),headers:viewer.headers,payload:{imageBase64:image,expectedPhotoRevision:0}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().photoRevision,1);}
async function snapshot(personId:string){
  const photo=(await pool.query(`SELECT person.photo_revision,photo.revision AS asset_revision,photo.content_sha256,photo.updated_at,photo.updated_by_account_id,
    encode(photo.variant_96,'hex') AS variant_96,encode(photo.variant_512,'hex') AS variant_512 FROM persons person LEFT JOIN person_profile_photos photo ON photo.person_id=person.id AND photo.household_id=person.household_id WHERE person.id=$1`,[personId])).rows[0];
  const audit=(await pool.query<{n:number}>(`SELECT count(*)::int AS n FROM audit_events WHERE household_id=$1 AND subject_id=$2 AND action IN ('person.photo_updated','person.photo_removed')`,[householdId,personId])).rows[0]!.n;
  return{photo,audit};
}
async function waitForLock(blockerPid:number,fragment:string){let blocked:{pid:number;query:string}|undefined;await until(async()=>{blocked=(await pool.query<{pid:number;query:string}>(`SELECT pid,query FROM pg_stat_activity WHERE datname=current_database() AND application_name='samvev-api' AND wait_event_type='Lock' AND query ILIKE $1 AND $2=ANY(pg_blocking_pids(pid))`,[`%${fragment}%`,blockerPid])).rows[0];return Boolean(blocked);},`photo request did not reach real database barrier: ${fragment}`);return blocked!;}
async function blocker(){const client=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000,application_name:'samvev-photo-auth-blocker'});await client.connect();await client.query('BEGIN');const pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;return{client,pid};}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Photo authorization test refuses a non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false},photoNormalizer:async(base64,crop)=>{const barrier=decodeBarrier;if(barrier){barrier.entered.resolve();await barrier.release.promise;}return normalizeProfilePhoto(base64,crop);}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic photo owner',email:'photo-owner@test.invalid',password:'Synthetic-photo-owner-password-42'},household:{name:'Synthetic photo authorization household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);
  const raw=claim.headers['set-cookie'];ownerHeaders={cookie:(Array.isArray(raw)?raw:[raw!]).map(value=>value.split(';')[0]).join('; '),'x-csrf-token':claim.json().csrfToken,origin};
  householdId=claim.json().householdId;const owner=(await pool.query<{account_id:string;installation_id:string}>(`SELECT membership.account_id,household.installation_id FROM memberships membership JOIN households household ON household.id=membership.household_id WHERE membership.id=$1`,[claim.json().membershipId])).rows[0]!;ownerAccountId=owner.account_id;installationId=owner.installation_id;
});
after(async()=>{decodeBarrier?.release.resolve();await app?.close();await pool.end();});

test('photo replacement rejects authority revoked during normalization, preserving bytes, revision and audit',async t=>{
  for(const kind of ['session-revoked','session-expired','account-disabled','capability-removed','membership-removed','self-reassigned'] as const){await t.test(kind,{timeout:10_000},async()=>{
    const viewer=await actor(kind==='self-reassigned'?[]:['people.manage']);const target=kind==='self-reassigned'?viewer.personId:await person();await seedPhoto(viewer,target);const before=await snapshot(target);
    const barrier={entered:deferred(),release:deferred()};decodeBarrier=barrier;
    const response=app.inject({method:'PUT',url:photoPath(target),headers:viewer.headers,payload:{imageBase64:image,expectedPhotoRevision:1}}).then(value=>value);
    try{
      await Promise.race([barrier.entered.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('photo normalizer barrier not reached')),4_000))]);
      if(kind==='session-revoked')await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1',[viewer.sessionId]);
      if(kind==='session-expired')await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[viewer.sessionId]);
      if(kind==='account-disabled')await pool.query('UPDATE accounts SET disabled_at=clock_timestamp() WHERE id=$1',[viewer.accountId]);
      if(kind==='capability-removed')await pool.query("UPDATE memberships SET capabilities='[]'::jsonb WHERE id=$1",[viewer.membershipId]);
      if(kind==='membership-removed')await pool.query('DELETE FROM memberships WHERE id=$1',[viewer.membershipId]);
      if(kind==='self-reassigned')await pool.query('UPDATE memberships SET person_id=$2 WHERE id=$1',[viewer.membershipId,await person()]);
    }finally{decodeBarrier=null;barrier.release.resolve();}
    const denied=await response;assert.equal(denied.statusCode,['capability-removed','self-reassigned'].includes(kind)?403:401,denied.body);assert.deepEqual(await snapshot(target),before,'rejected replacement must not change bytes/revision/updater or insert an audit');
  });}
});

test('self-photo upload and removal preserve access for a child without management or household-view grants',async()=>{
  const viewer=await actor();await seedPhoto(viewer);const removed=await app.inject({method:'DELETE',url:photoPath(viewer.personId),headers:viewer.headers,payload:{expectedPhotoRevision:1}});assert.equal(removed.statusCode,204,removed.body);const state=await snapshot(viewer.personId);assert.equal(state.photo.photo_revision,2);assert.equal(state.photo.asset_revision,null);assert.equal(state.audit,2);
});

test('PUT and DELETE roll back when a real target-person lock wait outlives the initiating session',async t=>{
  for(const method of ['PUT','DELETE'] as const){await t.test(method,{timeout:12_000},async()=>{
    const viewer=await actor();await seedPhoto(viewer);const before=await snapshot(viewer.personId),held=await blocker();let response:Promise<LightMyRequestResponse>|undefined;
    try{
      await held.client.query('SELECT id FROM persons WHERE id=$1 FOR UPDATE',[viewer.personId]);
      await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[viewer.sessionId]);
      response=app.inject({method,url:photoPath(viewer.personId),headers:viewer.headers,payload:{expectedPhotoRevision:1,...(method==='PUT'?{imageBase64:image}:{})}}).then(value=>value);
      await waitForLock(held.pid,'SELECT photo_revision FROM persons');
      await until(async()=>(await pool.query<{expired:boolean}>('SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1',[viewer.sessionId])).rows[0]!.expired,'SQL session clock did not reach expiry');
    }finally{await held.client.query('ROLLBACK');await held.client.end();}
    assert.ok(response);const denied=await response;assert.equal(denied.statusCode,401,denied.body);assert.deepEqual(await snapshot(viewer.personId),before,'target wait expiry must roll back image/revision/audit together');
  });}
});

test('PUT and DELETE enforce final authority after image-row and audit-insert waits with full rollback',async t=>{
  for(const method of ['PUT','DELETE'] as const){for(const wait of ['image','audit'] as const){await t.test(`${method} ${wait}`,{timeout:10_000},async()=>{
    const viewer=await actor();await seedPhoto(viewer);const before=await snapshot(viewer.personId),held=await blocker();let response:Promise<LightMyRequestResponse>|undefined;
    try{
      if(wait==='image')await held.client.query('SELECT person_id FROM person_profile_photos WHERE person_id=$1 FOR UPDATE',[viewer.personId]);
      else await held.client.query('LOCK TABLE audit_events IN SHARE MODE');
      response=app.inject({method,url:photoPath(viewer.personId),headers:viewer.headers,payload:{expectedPhotoRevision:1,...(method==='PUT'?{imageBase64:image}:{})}}).then(value=>value);
      await waitForLock(held.pid,wait==='audit'?'INSERT INTO audit_events':method==='PUT'?'INSERT INTO person_profile_photos':'DELETE FROM person_profile_photos');
      // Session KEY SHARE intentionally permits both last_seen and revocation.
      // Expire only after the real post-authorization mutation/audit barrier.
      await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[viewer.sessionId]);
    }finally{await held.client.query('ROLLBACK');await held.client.end();}
    assert.ok(response);const denied=await response;assert.equal(denied.statusCode,401,denied.body);assert.deepEqual(await snapshot(viewer.personId),before,`${method} ${wait} wait must roll back bytes/revision/audit atomically`);
  });}}
});


test('photo writes and account management keep installation-before-actor ordering without an audit deadlock',{timeout:12_000},async()=>{
  const viewer=await actor();await seedPhoto(viewer);const held=await blocker();let photo:Promise<LightMyRequestResponse>|undefined,disable:Promise<LightMyRequestResponse>|undefined,managementQuery='';
  try{
    await held.client.query('SELECT person_id FROM person_profile_photos WHERE person_id=$1 FOR UPDATE',[viewer.personId]);
    photo=app.inject({method:'PUT',url:photoPath(viewer.personId),headers:viewer.headers,payload:{imageBase64:image,expectedPhotoRevision:1}}).then(value=>value);
    const photoWait=await waitForLock(held.pid,'INSERT INTO person_profile_photos');
    const revision=(await pool.query<{revision:number}>('SELECT revision FROM accounts WHERE id=$1',[viewer.accountId])).rows[0]!.revision;
    disable=app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/accounts/${viewer.accountId}`,headers:ownerHeaders,payload:{expectedRevision:revision,disabled:true}}).then(value=>value);
    // Without the installation pin, management owns installation and waits on
    // the photo's account lock; releasing the image then creates a real cycle
    // when the photo insert reaches its installation audit FK.
    managementQuery=(await waitForLock(photoWait.pid,'')).query;
  }finally{await held.client.query('ROLLBACK');await held.client.end();}
  assert.ok(photo);assert.ok(disable);const [written,disabled]=await Promise.all([photo,disable]);assert.equal(written.statusCode,200,written.body);assert.equal(disabled.statusCode,200,disabled.body);assert.match(managementQuery,/SELECT id FROM installations/);
  const state=await snapshot(viewer.personId);assert.equal(state.photo.photo_revision,2);assert.equal(state.photo.asset_revision,2);assert.equal(state.audit,2);assert.equal((await pool.query('SELECT disabled_at IS NOT NULL AS disabled FROM accounts WHERE id=$1',[viewer.accountId])).rows[0].disabled,true);
});
