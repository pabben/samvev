import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {runLifecycleBatch} from './lifecycle.ts';

let app:FastifyInstance;
function cookies(response:LightMyRequestResponse):string{const value=response.headers['set-cookie'];return(Array.isArray(value)?value:value?[value]:[]).map((item)=>item.split(';')[0]).join('; ');}
function auth(cookie:string,csrf:string){return{cookie,'x-csrf-token':csrf};}
function sha(value:string){return createHash('sha256').update(value).digest('hex');}

before(async()=>{
  const databaseUrl=new URL(process.env.DATABASE_URL??'');
  if(databaseUrl.hostname!=='test-db'||databaseUrl.pathname!=='/samvev_test')throw new Error('Display message tests refuse non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp();
});
after(async()=>{await app.close();await pool.end();});

test('display authored messages use actual device identity and default-deny recipient/action policy',async()=>{
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin'});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',payload:{claimToken:begin.json().claimToken,owner:{displayName:'Message owner',email:'display-message-owner@test.invalid',password:'Synthetic-display-owner-42'},household:{name:'Display message household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});
  assert.equal(claim.statusCode,200,claim.body);const adminCookie=cookies(claim);const csrf=claim.json().csrfToken as string;const householdId=claim.json().householdId as string;
  const createPerson=async(displayName:string,email?:string)=>{
    const response=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(adminCookie,csrf),payload:{displayName,ageGroup:'child',rolePreset:'limited',capabilities:['household.view'],displayIds:[],...(email?{login:{email,password:'Synthetic-recipient-pass-42',locale:'en',theme:'system'}}:{})}});
    assert.equal(response.statusCode,201,response.body);return response.json().personId as string;
  };
  const recipientPersonId=await createPerson('Message recipient','display-message-recipient@test.invalid');const excludedPersonId=await createPerson('Excluded person');
  const recipientLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'display-message-recipient@test.invalid',password:'Synthetic-recipient-pass-42'}});assert.equal(recipientLogin.statusCode,200,recipientLogin.body);
  const recipientMemberCookie=cookies(recipientLogin);
  const pair=async(name:string)=>{
    const verifier=`${name}-display-message-verifier-0123456789`;
    const started=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',payload:{verifierHash:sha(verifier)}});assert.equal(started.statusCode,201,started.body);
    const approved=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/pairing/approve`,headers:auth(adminCookie,csrf),payload:{code:started.json().code,name,locale:'en',theme:'light',privacyMode:false,allowedContent:'household_messages'}});assert.equal(approved.statusCode,201,approved.body);
    const redeemed=await app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',payload:{pairingId:started.json().pairingId,verifier}});assert.equal(redeemed.statusCode,200,redeemed.body);
    return{id:approved.json().displayId as string,cookie:cookies(redeemed)};
  };
  const author=await pair('Entry display');const recipient=await pair('Kitchen display');
  const policyUrl=`/api/v1/households/${householdId}/displays/${author.id}/action-policy`;
  const setPolicy=async(expectedRevision:number,overrides:Record<string,unknown>={})=>app.inject({method:'PATCH',url:policyUrl,headers:auth(adminCookie,csrf),payload:{expectedRevision,messageCreate:true,messageSchedule:true,groceryWrite:false,dinnerWrite:false,photoUpload:false,homeAssistantControl:false,personIds:[recipientPersonId],displayIds:[recipient.id],...overrides}});

  const deniedDefault=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:recipient.cookie},payload:{body:'Default deny',audience:{personIds:[recipientPersonId],displayIds:[]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'default-deny-key-001'}});
  assert.equal(deniedDefault.statusCode,403);
  const createdPolicy=await setPolicy(1);assert.equal(createdPolicy.statusCode,200,createdPolicy.body);assert.equal(createdPolicy.json().revision,2);
  const choices=await app.inject({method:'GET',url:'/api/v1/display/message-recipients',headers:{cookie:author.cookie}});
  assert.equal(choices.statusCode,200,choices.body);assert.deepEqual(choices.json().people.map((person:{id:string})=>person.id),[recipientPersonId]);assert.deepEqual(choices.json().displays.map((display:{id:string})=>display.id),[recipient.id]);assert.equal(choices.json().policy.revision,2);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/message-recipients',headers:{cookie:recipient.cookie}})).json().people.length,0);

  const expiration=new Date(Date.now()+5*60_000).toISOString();
  const validMessage={body:'A note from the display',importance:'attention',audience:{personIds:[recipientPersonId],displayIds:[recipient.id]},expiresAt:expiration,idempotencyKey:'display-authored-message-001'};
  const spoof=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{...validMessage,authorMembershipId:'00000000-0000-4000-8000-000000000000'}});assert.equal(spoof.statusCode,400);
  const householdSpoof=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{...validMessage,audience:{...validMessage.audience,household:true}}});assert.equal(householdSpoof.statusCode,400);
  const disallowedPerson=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{...validMessage,audience:{personIds:[excludedPersonId],displayIds:[]},idempotencyKey:'excluded-person-message-001'}});assert.equal(disallowedPerson.statusCode,403);
  const foreignRecipient=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{...validMessage,audience:{personIds:[randomUUID()],displayIds:[]},idempotencyKey:'foreign-person-message-001'}});assert.equal(foreignRecipient.statusCode,400);
  const wrongOrigin=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie,origin:'https://attacker.invalid'},payload:validMessage});assert.equal(wrongOrigin.statusCode,403);

  const created=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:validMessage});assert.equal(created.statusCode,201,created.body);
  const stored=(await pool.query<{author_membership_id:string|null;author_display_id:string;author_display_name:string;audience_household:boolean}>(`SELECT author_membership_id,author_display_id,author_display_name,audience_household FROM messages WHERE id=$1`,[created.json().id])).rows[0]!;
  assert.equal(stored.author_membership_id,null);assert.equal(stored.author_display_id,author.id);assert.equal(stored.author_display_name,'Entry display');assert.equal(stored.audience_household,false);
  const event=(await pool.query<{actor_type:string;actor_id:string;actor_display_name:string}>(`SELECT actor_type,actor_id,actor_display_name FROM message_lifecycle_events WHERE message_id=$1`,[created.json().id])).rows[0]!;
  assert.deepEqual(event,{actor_type:'display',actor_id:author.id,actor_display_name:'Entry display'});
  const replay=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:validMessage});assert.equal(replay.statusCode,200);assert.deepEqual(Object.keys(replay.json()).sort(),['id','replayed','revision','state']);assert.equal(replay.json().id,created.json().id);assert.equal(replay.json().replayed,true);assert.equal(replay.json().revision,1);
  const projection=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:recipient.cookie}});assert.equal(projection.statusCode,200,projection.body);
  const projected=projection.json().cards.find((card:{id:string})=>card.id===created.json().id);assert.equal(projected.author,'Entry display');assert.equal(projected.authorType,'display');assert.equal(projected.authorDisplayId,author.id);assert.equal(projected.authorPersonId,null);
  const listed=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:adminCookie}});assert.equal(listed.statusCode,200,listed.body);
  const history=listed.json().messages.find((message:{id:string})=>message.id===created.json().id);assert.equal(history.author_type,'display');assert.equal(history.author_display_id,author.id);assert.equal(history.author_name,'Entry display');
  const recipientList=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:recipientMemberCookie}});assert.equal(recipientList.statusCode,200,recipientList.body);
  const recipientView=recipientList.json().messages.find((message:{id:string})=>message.id===created.json().id);assert.equal(recipientView.can_edit,false,'non-admin cannot edit a display-authored message');

  const edited=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/messages/${created.json().id}`,headers:auth(adminCookie,csrf),payload:{body:'Administrator edited the display note',audience:{household:false,personIds:[excludedPersonId],displayIds:[]},expectedRevision:1}});assert.equal(edited.statusCode,200,edited.body);
  const afterEdit=(await pool.query<{author_display_id:string;author_display_name:string}>(`SELECT author_display_id,author_display_name FROM messages WHERE id=$1`,[created.json().id])).rows[0]!;assert.deepEqual(afterEdit,{author_display_id:author.id,author_display_name:'Entry display'});
  const replayAfterPrivateEdit=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:validMessage});assert.equal(replayAfterPrivateEdit.statusCode,200);assert.deepEqual(Object.keys(replayAfterPrivateEdit.json()).sort(),['id','replayed','revision','state']);assert.equal(replayAfterPrivateEdit.json().id,created.json().id);assert.equal('Administrator edited the display note' in replayAfterPrivateEdit.json(),false);
  const revokePolicy=await setPolicy(2,{messageCreate:false});assert.equal(revokePolicy.statusCode,200,revokePolicy.body);
  const replayAfterRevocation=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:validMessage});assert.equal(replayAfterRevocation.statusCode,403,'an idempotent retry rechecks current permission');

  const scheduledGrant=await setPolicy(3,{messageCreate:true});assert.equal(scheduledGrant.statusCode,200,scheduledGrant.body);
  const recipientPolicy=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${recipient.id}/action-policy`,headers:auth(adminCookie,csrf),payload:{expectedRevision:1,messageCreate:true,messageSchedule:false,groceryWrite:false,dinnerWrite:false,photoUpload:false,homeAssistantControl:false,personIds:[],displayIds:[author.id]}});assert.equal(recipientPolicy.statusCode,200,recipientPolicy.body);
  const simultaneous=await Promise.all([
    app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{body:'A to B concurrently',audience:{personIds:[],displayIds:[recipient.id]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'display-message-a-to-b-001'}}),
    app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:recipient.cookie},payload:{body:'B to A concurrently',audience:{personIds:[],displayIds:[author.id]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'display-message-b-to-a-001'}})
  ]);
  assert.deepEqual(simultaneous.map((response)=>response.statusCode),[201,201]);
  const concurrentRows=await pool.query<{author_display_id:string;count:number}>(`SELECT author_display_id,count(*)::int AS count FROM messages WHERE idempotency_key=ANY($1::text[]) GROUP BY author_display_id ORDER BY author_display_id`,[['display-message-a-to-b-001','display-message-b-to-a-001']]);assert.equal(concurrentRows.rowCount,2);assert.deepEqual(concurrentRows.rows.map((row)=>row.count),[1,1]);
  const policyAndSend=await Promise.all([
    app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${recipient.id}/action-policy`,headers:auth(adminCookie,csrf),payload:{expectedRevision:2,messageCreate:true,messageSchedule:false,groceryWrite:false,dinnerWrite:false,photoUpload:false,homeAssistantControl:false,personIds:[],displayIds:[author.id]}}),
    app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{body:'A to B while recipient policy changes',audience:{personIds:[],displayIds:[recipient.id]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'display-message-policy-race-001'}})
  ]);
  assert.deepEqual(policyAndSend.map((response)=>response.statusCode),[200,201]);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM messages WHERE idempotency_key=$1',['display-message-policy-race-001'])).rows[0]!.count,1);
  const scheduledPayload={body:'Scheduled display note',audience:{personIds:[recipientPersonId],displayIds:[]},publishAt:new Date(Date.now()+60_000).toISOString(),expiresAt:new Date(Date.now()+120_000).toISOString(),idempotencyKey:'display-scheduled-message-001'};
  const scheduled=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:scheduledPayload});assert.equal(scheduled.statusCode,201,scheduled.body);assert.equal(scheduled.json().state,'scheduled');
  await pool.query(`UPDATE messages SET publish_at=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1`,[scheduled.json().id]);
  assert.deepEqual(await runLifecycleBatch(),{published:1,expired:0});
  assert.equal((await pool.query<{state:string}>('SELECT state FROM messages WHERE id=$1',[scheduled.json().id])).rows[0]!.state,'published');
  const disabledSchedule=await setPolicy(4,{messageCreate:true,messageSchedule:false});assert.equal(disabledSchedule.statusCode,200,disabledSchedule.body);
  const scheduleDenied=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{...scheduledPayload,idempotencyKey:'display-schedule-denied-001'}});assert.equal(scheduleDenied.statusCode,403);
  const expired=await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{...validMessage,audience:{personIds:[recipientPersonId],displayIds:[]},expiresAt:new Date(Date.now()-1000).toISOString(),idempotencyKey:'display-expired-message-001'}});assert.equal(expired.statusCode,422);
  await pool.query(`UPDATE messages SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[scheduled.json().id]);
  assert.deepEqual(await runLifecycleBatch(),{published:0,expired:1});
  const expiryEvent=(await pool.query<{to_state:string;actor_type:string}>('SELECT to_state,actor_type FROM message_lifecycle_events WHERE message_id=$1 ORDER BY id DESC LIMIT 1',[scheduled.json().id])).rows[0]!;assert.deepEqual(expiryEvent,{to_state:'expired',actor_type:'worker'});

  const expiryBlocker=await pool.connect();let expiringRequest:Promise<Awaited<ReturnType<typeof app.inject>>>|undefined;
  try{
    await expiryBlocker.query('BEGIN');await expiryBlocker.query('SELECT id FROM displays WHERE id=$1 FOR UPDATE',[recipient.id]);
    const expiresWhileBlocked=new Date(Date.now()+350).toISOString();
    expiringRequest=app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{body:'Must expire while blocked',audience:{personIds:[],displayIds:[recipient.id]},expiresAt:expiresWhileBlocked,idempotencyKey:'display-expiry-lock-wait-001'}});
    const deadline=Date.now()+3000;let waiting=false;
    while(Date.now()<deadline){const state=await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%ORDER BY id FOR UPDATE%'`);if(state.rows[0]!.count>0){waiting=true;break;}await new Promise((resolve)=>setTimeout(resolve,20));}
    assert.equal(waiting,true,'message write reached and waited on the locked target device');await new Promise((resolve)=>setTimeout(resolve,450));await expiryBlocker.query('COMMIT');
  }finally{await expiryBlocker.query('ROLLBACK').catch(()=>undefined);expiryBlocker.release();}
  assert.equal((await expiringRequest!).statusCode,422,'expiry is validated after the blocked authorization/recipient locks');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM messages WHERE idempotency_key=$1',['display-expiry-lock-wait-001'])).rows[0]!.count,0);

  const blocker=await pool.connect();let raceRequest:Promise<Awaited<ReturnType<typeof app.inject>>>|undefined;let waitingForPolicy=false;
  try{
    // Earlier assertions intentionally exercise many denials and retries. Reset only the isolated
    // test database's limiter rows so the lock-race request reaches PostgreSQL instead of 429.
    await pool.query('TRUNCATE rate_limits');
    await blocker.query('BEGIN');await blocker.query('SELECT display_id FROM display_action_policies WHERE display_id=$1 FOR UPDATE',[author.id]);
    raceRequest=app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:{body:'Must fail after permission revocation',audience:{personIds:[recipientPersonId],displayIds:[]},expiresAt:new Date(Date.now()+60_000).toISOString(),idempotencyKey:'display-action-race-001'}});
    const deadline=Date.now()+3000;
    while(Date.now()<deadline){const state=await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%FROM display_action_policies%' AND query ILIKE '%FOR UPDATE%'`);if(state.rows[0]!.count>0){waitingForPolicy=true;break;}await new Promise((resolve)=>setTimeout(resolve,20));}
    await blocker.query('UPDATE display_action_policies SET message_create=false,revision=revision+1 WHERE display_id=$1',[author.id]);await blocker.query('COMMIT');
  }finally{await blocker.query('ROLLBACK').catch(()=>undefined);blocker.release();}
  const raceResponse=await raceRequest!;assert.equal(waitingForPolicy,true,`request did not expose a policy-row lock wait (status ${raceResponse.statusCode}: ${raceResponse.body})`);assert.equal(raceResponse.statusCode,403,'revoked action permission is rechecked after acquiring the device-policy lock');

  const revoked=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${author.id}`,headers:auth(adminCookie,csrf),payload:{revoked:true}});assert.equal(revoked.statusCode,200,revoked.body);
  const historyAfterRevoke=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:adminCookie}});const retained=historyAfterRevoke.json().messages.find((message:{id:string})=>message.id===created.json().id);assert.equal(retained.author_display_id,author.id);assert.equal(retained.author_name,'Entry display');
  assert.equal((await app.inject({method:'POST',url:'/api/v1/display/messages',headers:{cookie:author.cookie},payload:validMessage})).statusCode,401);
});
