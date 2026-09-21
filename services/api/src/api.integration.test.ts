import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import { runLifecycleBatch } from './lifecycle.ts';

let app:FastifyInstance;

function cookies(response:LightMyRequestResponse):string{
  const values=response.headers['set-cookie'];
  const list=Array.isArray(values)?values:values?[values]:[];
  return list.map((value)=>value.split(';')[0]).join('; ');
}

function auth(cookie:string,csrf:string){return {cookie,'x-csrf-token':csrf};}
function sha(value:string){return createHash('sha256').update(value).digest('hex');}

before(async()=>{
  const databaseUrl=new URL(process.env.DATABASE_URL ?? '');
  if(databaseUrl.hostname!=='test-db' || databaseUrl.pathname!=='/samvev_test') throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();
  await pool.query(`TRUNCATE installations, pairing_requests, rate_limits RESTART IDENTITY CASCADE`);
  app=await buildApp();
});

after(async()=>{await app.close();await pool.end();});

test('complete authorization, pairing, messaging and durable lifecycle flow',async()=>{
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin'});
  assert.equal(begin.statusCode,200);
  const claimToken=begin.json().claimToken as string;
  const claimBody={
    claimToken,
    owner:{displayName:'Test Owner',email:'owner@test.invalid',password:'Synthetic-owner-pass-42'},
    household:{name:'Test household',timezone:'Europe/Oslo',locale:'nb'},
    preferences:{locale:'nb',theme:'dark'}
  };
  const [claimA,claimB]=await Promise.all([
    app.inject({method:'POST',url:'/api/v1/setup/claim',payload:claimBody}),
    app.inject({method:'POST',url:'/api/v1/setup/claim',payload:{...claimBody,owner:{...claimBody.owner,email:'racer@test.invalid'}}})
  ]);
  const claimResponses=[claimA,claimB];
  assert.deepEqual(claimResponses.map((response)=>response.statusCode).sort(),[200,409]);
  const claimed=claimResponses.find((response)=>response.statusCode===200)!;
  const adminCookie=cookies(claimed);
  assert.match(String(claimed.headers['set-cookie']),/samvev_session=.*HttpOnly.*SameSite=Strict/i);
  const adminCsrf=claimed.json().csrfToken as string;
  const householdId=claimed.json().householdId as string;

  const me=await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:adminCookie}});
  assert.equal(me.statusCode,200);
  assert.equal(me.json().memberships[0].timezone,'Europe/Oslo');
  assert.equal(typeof me.json().csrfToken,'string');
  const ownerMembershipId=me.json().memberships[0].id as string;
  const missingCsrf=await app.inject({method:'PATCH',url:'/api/v1/me/preferences',headers:{cookie:adminCookie},payload:{theme:'light'}});
  assert.equal(missingCsrf.statusCode,403);
  assert.equal(missingCsrf.json().error.code,'CSRF_REQUIRED');
  const wrongOrigin=await app.inject({method:'PATCH',url:'/api/v1/me/preferences',headers:{...auth(adminCookie,adminCsrf),origin:'https://attacker.invalid'},payload:{theme:'light'}});
  assert.equal(wrongOrigin.statusCode,403);

  for(const displayName of ['No login one','No login two']){
    const created=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(adminCookie,adminCsrf),payload:{displayName,ageGroup:'child',rolePreset:'limited',capabilities:['household.view'],displayIds:[]}});
    assert.equal(created.statusCode,201,created.body);
    assert.equal(created.json().hasLogin,false);
  }

  const verifier='one-use-browser-verifier-with-enough-entropy-0123456789';
  const pairing=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',payload:{verifierHash:sha(verifier)}});
  assert.equal(pairing.statusCode,201,pairing.body);
  const approve=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/pairing/approve`,headers:auth(adminCookie,adminCsrf),payload:{code:pairing.json().code,name:'Kitchen',locale:'nb',theme:'dark',privacyMode:false,allowedContent:'household_messages'}});
  assert.equal(approve.statusCode,201,approve.body);
  const displayId=approve.json().displayId as string;
  const redeems=await Promise.all([
    app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',payload:{pairingId:pairing.json().pairingId,verifier}}),
    app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',payload:{pairingId:pairing.json().pairingId,verifier}})
  ]);
  assert.deepEqual(redeems.map((response)=>response.statusCode).sort(),[200,410]);
  const displayCookie=cookies(redeems.find((response)=>response.statusCode===200)!);
  assert.match(displayCookie,/samvev_display=/);
  const displaySetCookie=String(redeems.find((response)=>response.statusCode===200)!.headers['set-cookie']);
  assert.match(displaySetCookie,/samvev_display=.*HttpOnly/i);
  assert.match(displaySetCookie,/Path=\/api\/v1\/display/i);
  assert.match(displaySetCookie,/SameSite=Strict/i);
  const displayCannotAdmin=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:displayCookie}});
  assert.equal(displayCannotAdmin.statusCode,401);

  const expiredVerifier='expired-browser-verifier-with-enough-entropy-012345';
  const expiringPair=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',payload:{verifierHash:sha(expiredVerifier)}});
  await pool.query(`UPDATE pairing_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[expiringPair.json().pairingId]);
  const expiredRedeem=await app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',payload:{pairingId:expiringPair.json().pairingId,verifier:expiredVerifier}});
  assert.equal(expiredRedeem.statusCode,410);

  const limitedCreate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(adminCookie,adminCsrf),payload:{
    displayName:'Limited author',ageGroup:'teen',rolePreset:'limited',
    capabilities:['household.view','message.create.household','message.publish.display','message.schedule'],displayIds:[displayId],
    login:{email:'limited@test.invalid',password:'Synthetic-limited-pass-42',locale:'en',theme:'system'}
  }});
  assert.equal(limitedCreate.statusCode,201,limitedCreate.body);

  const managerCreate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(adminCookie,adminCsrf),payload:{
    displayName:'House manager',ageGroup:'adult',rolePreset:'household_admin',displayIds:[],
    login:{email:'manager@test.invalid',password:'Synthetic-manager-pass-42',locale:'en',theme:'light'}
  }});
  assert.equal(managerCreate.statusCode,201,managerCreate.body);

  const managerLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'manager@test.invalid',password:'Synthetic-manager-pass-42'}});
  const managerMe=await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:cookies(managerLogin)}});
  const ownerEscalation=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerMembershipId}`,headers:auth(cookies(managerLogin),managerLogin.json().csrfToken),payload:{rolePreset:'limited',capabilities:['household.view'],displayIds:[],expectedRevision:1}});
  assert.equal(ownerEscalation.statusCode,403);

  const ownerDemotion=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerMembershipId}`,headers:auth(adminCookie,adminCsrf),payload:{rolePreset:'household_admin',capabilities:['household.view','household.manage'],displayIds:[],expectedRevision:1}});
  assert.equal(ownerDemotion.statusCode,409);
  assert.equal(ownerDemotion.json().error.details.reason,'last_installation_owner');

  const limitedLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'limited@test.invalid',password:'Synthetic-limited-pass-42'}});
  assert.equal(limitedLogin.statusCode,200);
  const limitedCookie=cookies(limitedLogin);
  const limitedCsrf=limitedLogin.json().csrfToken as string;
  const expiresAt=new Date(Date.now()+60_000).toISOString();
  const immediatePayload={body:'Synthetic gym clothes reminder',importance:'attention',audience:{household:false,personIds:[],displayIds:[displayId]},expiresAt,idempotencyKey:'immediate-test-0001'};
  const immediate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:immediatePayload});
  assert.equal(immediate.statusCode,201,immediate.body);
  assert.equal(immediate.json().state,'published');
  const immediateId=immediate.json().id as string;
  const duplicateCreate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:immediatePayload});
  assert.equal(duplicateCreate.json().id,immediateId);
  const conflictingKey=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:{...immediatePayload,body:'Different request with reused key'}});
  assert.equal(conflictingKey.statusCode,409);
  assert.equal(conflictingKey.json().error.details.reason,'idempotency_payload_mismatch');

  const projection=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}});
  assert.equal(projection.statusCode,200,projection.body);
  assert.equal(projection.json().cards.length,1);
  assert.equal(projection.json().cards[0].body,'Synthetic gym clothes reminder');
  assert.equal(projection.json().display.name,'Kitchen');
  assert.ok(Date.parse(projection.json().cacheUntil)>Date.parse(expiresAt));
  assert.equal((Date.parse(projection.json().cacheUntil)-Date.parse(projection.json().generatedAt))/1000,900);

  const ack=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayCookie},payload:{cardId:immediateId,revision:1,renderedAt:new Date().toISOString()}});
  assert.equal(ack.statusCode,204,ack.body);
  const displayedOnce=await pool.query<{displayed_at:Date}>('SELECT displayed_at FROM message_display_targets WHERE message_id=$1 AND display_id=$2',[immediateId,displayId]);
  const duplicateAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayCookie},payload:{cardId:immediateId,revision:1,renderedAt:new Date().toISOString()}});
  assert.equal(duplicateAck.statusCode,204);
  const displayedTwice=await pool.query<{displayed_at:Date}>('SELECT displayed_at FROM message_display_targets WHERE message_id=$1 AND display_id=$2',[immediateId,displayId]);
  assert.equal(displayedTwice.rows[0]!.displayed_at.toISOString(),displayedOnce.rows[0]!.displayed_at.toISOString());
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM display_render_acks WHERE message_id=$1 AND display_id=$2',[immediateId,displayId])).rows[0].count,1);
  const listed=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:limitedCookie}});
  assert.equal(listed.json().messages[0].deliveries[0].state,'displayed');
  assert.equal(listed.json().messages[0].can_edit,true);

  const firstEdit=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${immediateId}`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'Synthetic edited reminder',expectedRevision:1}});
  assert.equal(firstEdit.statusCode,200,firstEdit.body);
  const staleEdit=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${immediateId}`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'Must conflict',expectedRevision:1}});
  assert.equal(staleEdit.statusCode,409);
  assert.equal(staleEdit.json().error.code,'REVISION_CONFLICT');

  const scheduled=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'Restart-safe schedule',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayId]},publishAt:new Date(Date.now()+60_000).toISOString(),expiresAt:new Date(Date.now()+120_000).toISOString(),idempotencyKey:'scheduled-test-0001'}});
  assert.equal(scheduled.statusCode,201,scheduled.body);
  assert.equal(scheduled.json().state,'scheduled');
  await pool.query(`UPDATE messages SET publish_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[scheduled.json().id]);
  assert.deepEqual(await runLifecycleBatch(),{published:1,expired:0});
  assert.deepEqual(await runLifecycleBatch(),{published:0,expired:0});

  const missed=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'Missed full window',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayId]},publishAt:new Date(Date.now()+60_000).toISOString(),expiresAt:new Date(Date.now()+120_000).toISOString(),idempotencyKey:'missed-window-0001'}});
  await pool.query(`UPDATE messages SET publish_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,[missed.json().id]);
  const missedBatch=await runLifecycleBatch();
  assert.equal(missedBatch.expired,1);
  const missedStates=await pool.query(`SELECT to_state FROM message_lifecycle_events WHERE message_id=$1 ORDER BY id`,[missed.json().id]);
  assert.deepEqual(missedStates.rows.map((row)=>row.to_state),['scheduled','expired']);

  const future=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'Withdraw this',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayId]},publishAt:new Date(Date.now()+120_000).toISOString(),expiresAt:new Date(Date.now()+180_000).toISOString(),idempotencyKey:'withdraw-test-0001'}});
  const withdrawn=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages/${future.json().id}/withdraw`,headers:auth(limitedCookie,limitedCsrf),payload:{expectedRevision:1}});
  assert.equal(withdrawn.json().state,'cancelled');

  await pool.query(`UPDATE membership_display_grants SET display_id=display_id WHERE membership_id=$1`,[limitedCreate.json().membershipId]);
  await pool.query(`DELETE FROM membership_display_grants WHERE membership_id=$1`,[limitedCreate.json().membershipId]);
  const revokedGrantEdit=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${scheduled.json().id}`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'No longer authorized target',expectedRevision:1}});
  assert.equal(revokedGrantEdit.statusCode,403);

  const other=await createOtherHousehold();
  const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'other@test.invalid',password:'Synthetic-other-pass-42'}});
  const crossRead=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:cookies(otherLogin)}});
  assert.equal(crossRead.statusCode,404);
  const crossTarget=await app.inject({method:'POST',url:`/api/v1/households/${other.householdId}/messages`,headers:auth(cookies(otherLogin),otherLogin.json().csrfToken),payload:{body:'Cross target denied',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayId]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'cross-target-0001'}});
  assert.equal(crossTarget.statusCode,404);

  const verifier2='second-browser-verifier-with-enough-entropy-123456789';
  const pair2=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',payload:{verifierHash:sha(verifier2)}});
  const otherApprove=await app.inject({method:'POST',url:`/api/v1/households/${other.householdId}/displays/pairing/approve`,headers:auth(cookies(otherLogin),otherLogin.json().csrfToken),payload:{code:pair2.json().code,name:'Other display',locale:'en',theme:'light',privacyMode:false,allowedContent:'household_messages'}});
  assert.equal(otherApprove.statusCode,201);
  const otherRedeem=await app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',payload:{pairingId:pair2.json().pairingId,verifier:verifier2}});
  const crossAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:cookies(otherRedeem)},payload:{cardId:immediateId,revision:2,renderedAt:new Date().toISOString()}});
  assert.equal(crossAck.statusCode,404);

  const privacy=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:auth(adminCookie,adminCsrf),payload:{privacyMode:true}});
  assert.equal(privacy.statusCode,200);
  const privateProjection=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}});
  assert.deepEqual(privateProjection.json().cards,[]);
  const privateAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayCookie},payload:{cardId:immediateId,revision:2,renderedAt:new Date().toISOString()}});
  assert.equal(privateAck.statusCode,403);
  await pool.query('INSERT INTO membership_display_grants(household_id,membership_id,display_id) VALUES ($1,$2,$3)',[householdId,limitedCreate.json().membershipId,displayId]);
  const pendingAtRevocation=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedCookie,limitedCsrf),payload:{body:'Publish after display revocation',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayId]},publishAt:new Date(Date.now()+60_000).toISOString(),expiresAt:new Date(Date.now()+120_000).toISOString(),idempotencyKey:'revoked-before-due-0001'}});
  assert.equal(pendingAtRevocation.statusCode,201,pendingAtRevocation.body);
  const revoke=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:auth(adminCookie,adminCsrf),payload:{revoked:true}});
  assert.equal(revoke.statusCode,200);
  await pool.query(`UPDATE messages SET publish_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[pendingAtRevocation.json().id]);
  await runLifecycleBatch();
  const revokedDelivery=await pool.query('SELECT delivery_state,failure_code FROM message_display_targets WHERE message_id=$1',[pendingAtRevocation.json().id]);
  assert.deepEqual(revokedDelivery.rows[0],{delivery_state:'failed',failure_code:'DISPLAY_REVOKED'});
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}})).statusCode,401);
});

test('scheduler does not starve due rows behind active published rows and migration is idempotent',async()=>{
  const fixture=await pool.query<{household_id:string;membership_id:string}>(`SELECT m.household_id,m.id AS membership_id FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE a.email_normalized='other@test.invalid'`);
  const {household_id:householdId,membership_id:membershipId}=fixture.rows[0]!;
  for(let i=0;i<101;i++) await pool.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES ($1,$2,$3,'normal',true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','published',$4,clock_timestamp())`,[householdId,membershipId,`Active ${i}`,`active-${i}`]);
  const due=await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key) VALUES ($1,$2,'Due after active rows','normal',true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour','scheduled','due-after-active') RETURNING id`,[householdId,membershipId]);
  const batch=await runLifecycleBatch(1);
  assert.deepEqual(batch,{published:1,expired:0});
  assert.equal((await pool.query('SELECT state FROM messages WHERE id=$1',[due.rows[0]!.id])).rows[0].state,'published');
  await migrate();
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count,4);
});

test('migration checksum mismatch fails closed without changing the isolated schema or application data', async()=>{
  const guard=new URL(process.env.DATABASE_URL ?? '');
  assert.equal(guard.hostname,'test-db');
  assert.equal(guard.pathname,'/samvev_test');
  const original=(await pool.query<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE version=$1',['001_m1.sql'])).rows[0];
  assert.ok(original);
  const before=await pool.query<{migration_count:number;installation_count:number}>(`SELECT
    (SELECT count(*)::int FROM schema_migrations) AS migration_count,
    (SELECT count(*)::int FROM installations) AS installation_count`);
  await pool.query("UPDATE schema_migrations SET checksum='qa-intentionally-corrupt-checksum' WHERE version=$1",['001_m1.sql']);
  try {
    await assert.rejects(migrate(),/Migration checksum mismatch: 001_m1\.sql/);
    const after=await pool.query<{migration_count:number;installation_count:number;checksum:string}>(`SELECT
      (SELECT count(*)::int FROM schema_migrations) AS migration_count,
      (SELECT count(*)::int FROM installations) AS installation_count,
      (SELECT checksum FROM schema_migrations WHERE version='001_m1.sql') AS checksum`);
    assert.deepEqual(after.rows[0],{migration_count:before.rows[0]!.migration_count,installation_count:before.rows[0]!.installation_count,checksum:'qa-intentionally-corrupt-checksum'});
  } finally {
    await pool.query('UPDATE schema_migrations SET checksum=$2 WHERE version=$1',['001_m1.sql',original!.checksum]);
  }
  await migrate();
});

test('demo mode is explicit, durable and contains only labeled synthetic data',async()=>{
  await pool.query(`TRUNCATE installations, pairing_requests, rate_limits RESTART IDENTITY CASCADE`);
  const statusBefore=await app.inject({method:'GET',url:'/api/v1/setup/status'});
  assert.equal(statusBefore.json().claimed,false);
  assert.equal(statusBefore.json().demoAvailable,true);
  const demo=await app.inject({method:'POST',url:'/api/v1/setup/demo'});
  assert.equal(demo.statusCode,200,demo.body);
  assert.equal(demo.json().demo,true);
  const statusAfter=await app.inject({method:'GET',url:'/api/v1/setup/status'});
  assert.equal(statusAfter.json().demo,true);
  const people=await app.inject({method:'GET',url:`/api/v1/households/${demo.json().householdId}/people`,headers:{cookie:cookies(demo)}});
  assert.equal(people.json().people.length,4);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM messages')).rows[0].count,2);
});

async function createOtherHousehold():Promise<{householdId:string}>{
  const installation=(await pool.query<{id:string}>('SELECT id FROM installations WHERE singleton=true')).rows[0]!.id;
  const passwordHash=(await import('@samvev/core')).hashPassword;
  const hashed=await passwordHash('Synthetic-other-pass-42');
  return (await (async()=>{
    const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES ($1,'Other household','UTC','en') RETURNING id`,[installation])).rows[0]!;
    const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES ($1,'Other owner','adult') RETURNING id`,[household.id])).rows[0]!;
    const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES ($1,'other@test.invalid',$2,'en','light') RETURNING id`,[installation,hashed])).rows[0]!;
    await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES ($1,$2,$3,'household_admin',$4)`,[household.id,account.id,person.id,JSON.stringify(['household.view','household.manage','people.manage','account.manage','capability.manage','message.create.household','message.publish.display','message.schedule','message.manage.household','display.manage'])]);
    return {householdId:household.id};
  })());
}
