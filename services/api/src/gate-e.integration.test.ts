import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { hashPassword, tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';

let app:FastifyInstance;

function cookies(response:LightMyRequestResponse):string{
  const value=response.headers['set-cookie'];
  return (Array.isArray(value)?value:value?[value]:[]).map((item)=>item.split(';')[0]).join('; ');
}

function auth(cookie:string,csrf:string){return {cookie,'x-csrf-token':csrf};}
function sha(value:string){return createHash('sha256').update(value).digest('hex');}
async function waitFor(predicate:()=>boolean,timeoutMs=2_000):Promise<void>{
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(predicate())return;await new Promise((resolve)=>setTimeout(resolve,25));}
  assert.fail('condition did not become true before timeout');
}

interface CapturedSseEvent { type:string; data:Record<string,unknown> }
function captureSse(response:Response):{events:CapturedSseEvent[];done:Promise<void>}{
  const events:CapturedSseEvent[]=[];
  const done=(async()=>{
    const reader=response.body!.getReader();
    const decoder=new TextDecoder();
    let buffered='';
    while(true){
      const {done,value}=await reader.read();
      buffered+=decoder.decode(value,{stream:!done});
      let boundary=buffered.indexOf('\n\n');
      while(boundary>=0){
        const block=buffered.slice(0,boundary);
        buffered=buffered.slice(boundary+2);
        const type=block.split('\n').find((line)=>line.startsWith('event: '))?.slice(7);
        const data=block.split('\n').find((line)=>line.startsWith('data: '))?.slice(6);
        if(type && data)events.push({type,data:JSON.parse(data) as Record<string,unknown>});
        boundary=buffered.indexOf('\n\n');
      }
      if(done)return;
    }
  })().catch((error:unknown)=>{if((error as {name?:string}).name!=='AbortError')throw error;});
  return {events,done};
}

before(async()=>{
  const databaseUrl=new URL(process.env.DATABASE_URL ?? '');
  if(databaseUrl.hostname!=='test-db' || databaseUrl.pathname!=='/samvev_test')throw new Error('Gate E integration tests refuse non-isolated DATABASE_URL');
  process.env.SAMVEV_SSE_MAX_PER_DISPLAY='10';
  process.env.SAMVEV_SSE_MAX_GLOBAL='20';
  process.env.SAMVEV_SSE_REVALIDATE_MS='100';
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp();
});

after(async()=>{
  await app.close();
  const listenerCount=await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='samvev-api-projection-listener'`);
  assert.equal(listenerCount.rows[0].count,0);
  await pool.end();
});

test('Gate E security, projection, activity and bounded realtime regressions',async()=>{
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin'});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',payload:{
    claimToken:begin.json().claimToken,
    owner:{displayName:'Gate owner',email:'gate-owner@test.invalid',password:'Synthetic-owner-pass-42'},
    household:{name:'Gate household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}
  }});
  assert.equal(claim.statusCode,200,claim.body);
  const adminCookie=cookies(claim);
  const adminCsrf=claim.json().csrfToken as string;
  const householdId=claim.json().householdId as string;
  const ownerMembershipId=claim.json().membershipId as string;

  const displayA=await pairDisplay('Hall A','en','light',adminCookie,adminCsrf,householdId);
  const displayB=await pairDisplay('Hall B','nb','dark',adminCookie,adminCsrf,householdId);

  const limited=await createPerson(adminCookie,adminCsrf,householdId,{
    displayName:'Limited writer',ageGroup:'teen',rolePreset:'limited',
    capabilities:['household.view','message.create.household','message.publish.display','message.schedule'],
    displayIds:[displayA.id,displayB.id],login:{email:'gate-limited@test.invalid',password:'Synthetic-limited-pass-42',locale:'en',theme:'system'}
  });
  const limitedLogin=await login('gate-limited@test.invalid','Synthetic-limited-pass-42');

  const profileManager=await createPerson(adminCookie,adminCsrf,householdId,{
    displayName:'Profile manager',ageGroup:'adult',rolePreset:'member',capabilities:['household.view','people.manage'],displayIds:[],
    login:{email:'profiles@test.invalid',password:'Synthetic-profile-pass-42',locale:'en',theme:'light'}
  });
  assert.ok(profileManager.membershipId);
  const profileLogin=await login('profiles@test.invalid','Synthetic-profile-pass-42');
  const profilePeople=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:profileLogin.cookie}});
  assert.equal(profilePeople.statusCode,200);
  assert.ok(profilePeople.json().people.some((person:{display_name:string})=>person.display_name==='Gate owner'));
  assert.ok(profilePeople.json().people.every((person:{email:null})=>person.email===null));
  assert.ok(profilePeople.json().people.some((person:{capabilities:string[]})=>person.capabilities.includes('installation.manage')));
  const profileOnly=await createPerson(profileLogin.cookie,profileLogin.csrf,householdId,{displayName:'Profile only',ageGroup:'child',rolePreset:'limited',capabilities:['household.view'],displayIds:[]});
  assert.equal(profileOnly.hasLogin,false);
  const forbiddenLoginCreate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(profileLogin.cookie,profileLogin.csrf),payload:{displayName:'Must not get login',ageGroup:'teen',rolePreset:'limited',capabilities:['household.view'],displayIds:[],login:{email:'forbidden@test.invalid',password:'Synthetic-forbidden-pass-42',locale:'en',theme:'light'}}});
  assert.equal(forbiddenLoginCreate.statusCode,403);

  await createPerson(adminCookie,adminCsrf,householdId,{
    displayName:'Account viewer',ageGroup:'adult',rolePreset:'member',capabilities:['household.view','account.manage'],displayIds:[],
    login:{email:'accounts@test.invalid',password:'Synthetic-account-pass-42',locale:'en',theme:'light'}
  });
  const accountLogin=await login('accounts@test.invalid','Synthetic-account-pass-42');
  const accountPeople=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:accountLogin.cookie}});
  assert.ok(accountPeople.json().people.some((person:{email:string|null})=>person.email==='gate-owner@test.invalid'));
  assert.ok(accountPeople.json().people.every((person:{capabilities:string[]})=>person.capabilities.length===0));
  assert.equal((await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(accountLogin.cookie,accountLogin.csrf),payload:{displayName:'No profile permission',ageGroup:'child',rolePreset:'limited',capabilities:['household.view'],displayIds:[]}})).statusCode,403);

  const noLoginElevated=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(adminCookie,adminCsrf),payload:{displayName:'No-login owner',ageGroup:'adult',rolePreset:'installation_admin',displayIds:[]}});
  assert.equal(noLoginElevated.statusCode,400);
  assert.equal(noLoginElevated.json().error.details.reason,'elevated_login_required');

  const multiPayload={body:'Normal multi-target card',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayA.id,displayB.id]},expiresAt:new Date(Date.now()+10*60_000).toISOString(),idempotencyKey:'gate-multi-target'};
  const multi=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedLogin.cookie,limitedLogin.csrf),payload:multiPayload});
  assert.equal(multi.statusCode,201,multi.body);
  const attention=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedLogin.cookie,limitedLogin.csrf),payload:{body:'Attention expires first',importance:'attention',audience:{household:false,personIds:[],displayIds:[displayA.id]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'gate-attention-first'}});
  assert.equal(attention.statusCode,201,attention.body);
  const projectionA=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayA.cookie}});
  assert.equal(projectionA.statusCode,200,projectionA.body);
  assert.equal(projectionA.json().display.timezone,'Europe/Oslo');
  assert.deepEqual(projectionA.json().cards.slice(0,2).map((card:{importance:string})=>card.importance),['attention','normal']);
  const ttlSeconds=(Date.parse(projectionA.json().cacheUntil)-Date.parse(projectionA.json().generatedAt))/1000;
  assert.ok(ttlSeconds>=899 && ttlSeconds<=900);
  assert.ok(Date.parse(projectionA.json().cacheUntil)>Date.parse(projectionA.json().cards[0].expiresAt));
  const projectionB=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayB.cookie}});
  assert.ok(projectionB.json().cards.some((card:{id:string})=>card.id===multi.json().id));

  const removeB=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${multi.json().id}`,headers:auth(limitedLogin.cookie,limitedLogin.csrf),payload:{audience:{household:false,personIds:[],displayIds:[displayA.id]},expectedRevision:1}});
  assert.equal(removeB.statusCode,200,removeB.body);
  const bodyOnly=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${multi.json().id}`,headers:auth(limitedLogin.cookie,limitedLogin.csrf),payload:{body:'Edited without resurrecting B',importance:'attention',expectedRevision:2}});
  assert.equal(bodyOnly.statusCode,200,bodyOnly.body);
  await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayA.cookie}});
  const staleAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayA.cookie},payload:{cardId:multi.json().id,revision:2,renderedAt:new Date().toISOString()}});
  assert.equal(staleAck.statusCode,404);
  const targetB=await pool.query('SELECT delivery_state FROM message_display_targets WHERE message_id=$1 AND display_id=$2',[multi.json().id,displayB.id]);
  assert.equal(targetB.rows[0].delivery_state,'cancelled');
  const afterRemovalB=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayB.cookie}});
  assert.ok(!afterRemovalB.json().cards.some((card:{id:string})=>card.id===multi.json().id));
  const removedAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayB.cookie},payload:{cardId:multi.json().id,revision:3,renderedAt:new Date().toISOString()}});
  assert.equal(removedAck.statusCode,404);
  await pool.query(`INSERT INTO rate_limits(bucket,key_hash,window_started_at,attempts) VALUES ('display_render_ack',$1,clock_timestamp(),180) ON CONFLICT(bucket,key_hash) DO UPDATE SET window_started_at=clock_timestamp(),attempts=180`,[tokenHash(displayA.id)]);
  const boundedAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayA.cookie},payload:{cardId:multi.json().id,revision:3,renderedAt:new Date().toISOString()}});
  assert.equal(boundedAck.statusCode,429);
  await pool.query(`DELETE FROM rate_limits WHERE bucket='display_render_ack' AND key_hash=$1`,[tokenHash(displayA.id)]);

  const undelivered=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedLogin.cookie,limitedLogin.csrf),payload:{body:'Not fetched yet',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayB.id]},expiresAt:new Date(Date.now()+5*60_000).toISOString(),idempotencyKey:'gate-undelivered-ack'}});
  const undeliveredAck=await app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayB.cookie},payload:{cardId:undelivered.json().id,revision:1,renderedAt:new Date().toISOString()}});
  assert.equal(undeliveredAck.statusCode,404);

  const adminEdit=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${attention.json().id}`,headers:auth(adminCookie,adminCsrf),payload:{body:'Owner safely edited this card',expectedRevision:1}});
  assert.equal(adminEdit.statusCode,200,adminEdit.body);
  const adminWithdraw=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages/${attention.json().id}/withdraw`,headers:auth(adminCookie,adminCsrf),payload:{expectedRevision:2}});
  assert.equal(adminWithdraw.statusCode,200,adminWithdraw.body);
  const authorList=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:limitedLogin.cookie}});
  const affected=authorList.json().messages.find((message:{id:string})=>message.id===attention.json().id);
  assert.equal(affected.author_name,'Limited writer');
  assert.deepEqual(affected.activity.map((event:{action:string;actorName:string})=>[event.action,event.actorName]),[['edited','Gate owner'],['withdrawn','Gate owner']]);
  const adminAudit=await pool.query(`SELECT action,metadata FROM audit_events WHERE subject_id=$1 ORDER BY id`,[attention.json().id]);
  assert.deepEqual(adminAudit.rows.map((row)=>row.action),['message.edited_by_admin','message.withdrawn_by_admin']);
  assert.ok(adminAudit.rows.every((row)=>!JSON.stringify(row).includes('Owner safely edited this card')));

  const foreign=await createForeignHousehold();
  const foreignLogin=await login('foreign-gate@test.invalid','Synthetic-foreign-pass-42');
  const isolated=await app.inject({method:'GET',url:`/api/v1/households/${foreign.householdId}/messages`,headers:{cookie:limitedLogin.cookie}});
  assert.equal(isolated.statusCode,404);
  const foreignWriter=await pool.connect();
  await foreignWriter.query('BEGIN');
  await foreignWriter.query('SELECT id FROM messages WHERE id=$1 FOR UPDATE',[foreign.messageId]);
  try{
    const denied=await Promise.race([
      app.inject({method:'POST',url:'/api/v1/display/render-ack',headers:{cookie:displayA.cookie},payload:{cardId:foreign.messageId,revision:1,renderedAt:new Date().toISOString()}}),
      new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('cross-household ACK waited on foreign message lock')),1_500))
    ]);
    assert.equal(denied.statusCode,404);
  }finally{await foreignWriter.query('ROLLBACK');foreignWriter.release();}
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${foreign.householdId}/messages`,headers:{cookie:foreignLogin.cookie}})).statusCode,200);

  await pool.query(`INSERT INTO rate_limits(bucket,key_hash,window_started_at,attempts) VALUES ('old-test',$1,clock_timestamp()-interval '2 days',1)`,[tokenHash('expired')]);
  const unknown=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'unknown-gate@test.invalid',password:'Synthetic-unknown-pass-42'}});
  assert.equal(unknown.statusCode,401);
  assert.deepEqual(unknown.json().error.code,'UNAUTHENTICATED');
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM rate_limits WHERE bucket='old-test'`)).rows[0].count,0);
  const loginBuckets=await pool.query(`SELECT bucket FROM rate_limits WHERE bucket IN ('login','login_ip')`);
  assert.deepEqual(new Set(loginBuckets.rows.map((row)=>row.bucket)),new Set(['login','login_ip']));
  await pool.query(`INSERT INTO rate_limits(bucket,key_hash,window_started_at,attempts) VALUES ('login_ip',$1,clock_timestamp(),30) ON CONFLICT(bucket,key_hash) DO UPDATE SET window_started_at=clock_timestamp(),attempts=30`,[tokenHash('127.0.0.1')]);
  const aggregateLimited=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'another-unknown@test.invalid',password:'Synthetic-unknown-pass-42'}});
  assert.equal(aggregateLimited.statusCode,429);
  await pool.query(`DELETE FROM rate_limits WHERE bucket='login_ip'`);

  const phantom=await createPerson(adminCookie,adminCsrf,householdId,{displayName:'Legacy no-login profile',ageGroup:'adult',rolePreset:'limited',capabilities:['household.view'],displayIds:[]});
  await pool.query(`UPDATE memberships SET role_preset='installation_admin',capabilities=$2 WHERE id=$1`,[phantom.membershipId,JSON.stringify(allCapabilities)]);
  const secondAdmin=await createPerson(adminCookie,adminCsrf,householdId,{
    displayName:'Second owner',ageGroup:'adult',rolePreset:'installation_admin',displayIds:[],
    login:{email:'second-owner@test.invalid',password:'Synthetic-second-pass-42',locale:'en',theme:'light'}
  });
  const secondAccount=await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1',[secondAdmin.membershipId]);
  await pool.query('UPDATE accounts SET disabled_at=clock_timestamp() WHERE id=$1',[secondAccount.rows[0]!.account_id]);
  const disabledLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'second-owner@test.invalid',password:'Synthetic-second-pass-42'}});
  assert.equal(disabledLogin.statusCode,401);
  const activeLoginForProfileManager=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:profileLogin.cookie}});
  assert.equal(activeLoginForProfileManager.statusCode,200);
  assert.equal(activeLoginForProfileManager.json().people.find((person:{display_name:string})=>person.display_name==='Gate owner').has_active_login,true);
  assert.equal(activeLoginForProfileManager.json().people.find((person:{display_name:string})=>person.display_name==='Second owner').has_active_login,false);
  assert.equal(activeLoginForProfileManager.json().people.find((person:{display_name:string})=>person.display_name==='Profile only').has_active_login,false);
  assert.ok(activeLoginForProfileManager.json().people.every((person:{email:null})=>person.email===null));
  const activeLoginForAccountManager=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:accountLogin.cookie}});
  assert.equal(activeLoginForAccountManager.statusCode,200);
  assert.equal(activeLoginForAccountManager.json().people.find((person:{display_name:string})=>person.display_name==='Gate owner').has_active_login,true);
  assert.equal(activeLoginForAccountManager.json().people.find((person:{display_name:string})=>person.display_name==='Second owner').has_active_login,false);
  assert.ok(activeLoginForAccountManager.json().people.every((person:{capabilities:string[]})=>person.capabilities.length===0));
  const activeLoginForMember=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:limitedLogin.cookie}});
  assert.equal(activeLoginForMember.statusCode,200);
  assert.ok(activeLoginForMember.json().people.every((person:Record<string,unknown>)=>!Object.hasOwn(person,'has_active_login')));
  const managerRemoval=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerMembershipId}`,headers:auth(adminCookie,adminCsrf),payload:{rolePreset:'installation_admin',capabilities:allCapabilities.filter((capability)=>capability!=='household.manage'),displayIds:[],expectedRevision:1}});
  assert.equal(managerRemoval.statusCode,409);
  assert.equal(managerRemoval.json().error.details.reason,'last_household_manager');
  const capabilityRemoval=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerMembershipId}`,headers:auth(adminCookie,adminCsrf),payload:{rolePreset:'installation_admin',capabilities:allCapabilities.filter((capability)=>capability!=='capability.manage'),displayIds:[],expectedRevision:1}});
  assert.equal(capabilityRemoval.statusCode,409);
  assert.equal(capabilityRemoval.json().error.details.reason,'last_installation_owner');
  await pool.query('UPDATE accounts SET disabled_at=NULL WHERE id=$1',[secondAccount.rows[0]!.account_id]);
  const transfer=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerMembershipId}`,headers:auth(adminCookie,adminCsrf),payload:{rolePreset:'member',capabilities:['household.view'],displayIds:[],expectedRevision:1}});
  assert.equal(transfer.statusCode,200,transfer.body);
  const secondLogin=await login('second-owner@test.invalid','Synthetic-second-pass-42');
  assert.ok((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:secondLogin.cookie}})).json().memberships[0].capabilities.includes('installation.manage'));

  const address=await app.listen({host:'127.0.0.1',port:0});
  const stats=()=>((app as unknown) as {projectionStreamStats:()=>{subscriptions:number;listenerConnected:boolean}}).projectionStreamStats();

  const listenerLossController=new AbortController();
  const listenerLossResponse=await fetch(`${address}/api/v1/display/events`,{headers:{cookie:displayA.cookie},signal:listenerLossController.signal});
  assert.equal(listenerLossResponse.status,200);
  const listenerLossCapture=captureSse(listenerLossResponse);
  await waitFor(()=>listenerLossCapture.events.some((event)=>event.type==='ready'));
  assert.equal(listenerLossCapture.events.find((event)=>event.type==='ready')?.data.pollingFallback,false);
  assert.equal((await pool.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name,'samvev_test');
  const terminated=await pool.query<{terminated:boolean}>(`SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
    WHERE datname=current_database() AND application_name='samvev-api-projection-listener' AND pid<>pg_backend_pid()`);
  assert.ok(terminated.rows.some((row)=>row.terminated));
  await waitFor(()=>!stats().listenerConnected);
  await waitFor(()=>listenerLossCapture.events.some((event)=>event.type==='listener-degraded' && event.data.reason==='notification-listener-unavailable'));

  const degradedController=new AbortController();
  const degradedResponse=await fetch(`${address}/api/v1/display/events`,{headers:{cookie:displayA.cookie},signal:degradedController.signal});
  assert.equal(degradedResponse.status,200);
  const degradedCapture=captureSse(degradedResponse);
  await waitFor(()=>degradedCapture.events.some((event)=>event.type==='ready'));
  const degradedReady=degradedCapture.events.find((event)=>event.type==='ready')!;
  assert.equal(degradedReady.data.listenerConnected,false);
  assert.equal(degradedReady.data.pollingFallback,true);
  await waitFor(()=>degradedCapture.events.some((event)=>event.type==='listener-degraded'));
  assert.equal((await app.inject({method:'GET',url:'/api/v1/health'})).statusCode,200);
  await waitFor(()=>stats().listenerConnected,3_000);
  await waitFor(()=>listenerLossCapture.events.some((event)=>event.type==='listener-restored'),3_000);
  await waitFor(()=>degradedCapture.events.some((event)=>event.type==='listener-restored'),3_000);
  await waitFor(()=>degradedCapture.events.some((event)=>event.type==='heartbeat' && event.data.pollingFallback===false),3_000);
  assert.ok(!listenerLossCapture.events.some((event)=>event.type==='authorization-revoked'));
  assert.ok(!degradedCapture.events.some((event)=>event.type==='authorization-revoked'));
  listenerLossController.abort();
  degradedController.abort();
  await Promise.all([listenerLossCapture.done,degradedCapture.done]);
  await waitFor(()=>stats().subscriptions===0);

  const controllers=Array.from({length:10},()=>new AbortController());
  const streams=await Promise.all(controllers.map((controller)=>fetch(`${address}/api/v1/display/events`,{headers:{cookie:displayB.cookie},signal:controller.signal})));
  assert.ok(streams.every((response)=>response.status===200));
  assert.deepEqual({subscriptions:stats().subscriptions,listenerConnected:stats().listenerConnected},{subscriptions:10,listenerConnected:true});
  const overflow=await fetch(`${address}/api/v1/display/events`,{headers:{cookie:displayB.cookie}});
  assert.equal(overflow.status,429);
  await overflow.body?.cancel();
  assert.equal((await app.inject({method:'GET',url:'/api/v1/health'})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'second-owner@test.invalid',password:'Synthetic-second-pass-42'}})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayB.cookie}})).statusCode,200);
  const whileStreaming=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:auth(limitedLogin.cookie,limitedLogin.csrf),payload:{body:'Created while ten streams stay open',importance:'normal',audience:{household:false,personIds:[],displayIds:[displayB.id]},expiresAt:new Date(Date.now()+5*60_000).toISOString(),idempotencyKey:'gate-ten-streams'}});
  assert.equal(whileStreaming.statusCode,201,whileStreaming.body);
  const revoke=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayB.id}`,headers:auth(secondLogin.cookie,secondLogin.csrf),payload:{revoked:true}});
  assert.equal(revoke.statusCode,200,revoke.body);
  await waitFor(()=>stats().subscriptions===0,3_000);
  controllers.forEach((controller)=>controller.abort());
  for(const response of streams)await response.body?.cancel().catch(()=>undefined);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayB.cookie}})).statusCode,401);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/health'})).statusCode,200);
});

const allCapabilities=['installation.manage','household.view','household.manage','people.manage','account.manage','capability.manage','message.create.household','message.publish.display','message.schedule','message.manage.household','display.manage'];

async function login(email:string,password:string):Promise<{cookie:string;csrf:string}>{
  const response=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});
  assert.equal(response.statusCode,200,response.body);
  return {cookie:cookies(response),csrf:response.json().csrfToken};
}

async function createPerson(cookie:string,csrf:string,householdId:string,payload:Record<string,unknown>):Promise<{personId:string;membershipId:string;hasLogin:boolean}>{
  const response=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(cookie,csrf),payload});
  assert.equal(response.statusCode,201,response.body);
  return response.json();
}

async function pairDisplay(name:string,locale:'en'|'nb',theme:'light'|'dark',cookie:string,csrf:string,householdId:string):Promise<{id:string;cookie:string}>{
  const verifier=`${name}-browser-verifier-with-enough-entropy-0123456789`;
  const start=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',payload:{verifierHash:sha(verifier)}});
  const approve=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/pairing/approve`,headers:auth(cookie,csrf),payload:{code:start.json().code,name,locale,theme,privacyMode:false,allowedContent:'household_messages'}});
  assert.equal(approve.statusCode,201,approve.body);
  const redeem=await app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',payload:{pairingId:start.json().pairingId,verifier}});
  assert.equal(redeem.statusCode,200,redeem.body);
  return {id:approve.json().displayId,cookie:cookies(redeem)};
}

async function createForeignHousehold():Promise<{householdId:string;messageId:string}>{
  const installation=(await pool.query<{id:string}>('SELECT id FROM installations WHERE singleton=true')).rows[0]!.id;
  const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES ($1,'Foreign household','UTC','en') RETURNING id`,[installation])).rows[0]!;
  const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES ($1,'Foreign owner','adult') RETURNING id`,[household.id])).rows[0]!;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES ($1,'foreign-gate@test.invalid',$2,'en','light') RETURNING id`,[installation,await hashPassword('Synthetic-foreign-pass-42')])).rows[0]!;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES ($1,$2,$3,'household_admin',$4) RETURNING id`,[household.id,account.id,person.id,JSON.stringify(allCapabilities.filter((capability)=>capability!=='installation.manage'))])).rows[0]!;
  const message=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES ($1,$2,'Foreign locked message','normal',true,clock_timestamp(),clock_timestamp()+interval '10 minutes','published','foreign-lock',clock_timestamp()) RETURNING id`,[household.id,membership.id])).rows[0]!;
  return {householdId:household.id,messageId:message.id};
}
