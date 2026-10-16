import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {opaqueToken,hashPassword,tokenHash} from '@samvev/core';
import {roleCapabilityPresets} from '@samvev/contracts';
import pg from 'pg';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {localDateInTimezone} from './people/domain.ts';

interface Session{cookie:string;csrf:string;accountId:string;membershipId:string;personId:string;}
const origin='https://samvev-round13-board.test.invalid';
let app:FastifyInstance,householdId:string,owner:Session,child:Session,displayId:string,displayCookie:string;
function cookie(response:LightMyRequestResponse):string{const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map((item)=>item.split(';')[0]).join('; ');}
function auth(session:Session){return{cookie:session.cookie,'x-csrf-token':session.csrf,origin};}
function date(value:Date){return value.toISOString().slice(0,10);}
function sessionToken(cookieValue:string){return cookieValue.split(';').find((part)=>part.trim().startsWith('samvev_session='))!.trim().slice('samvev_session='.length);}
async function waitForBlockedQuery(fragment:string){
  for(let attempt=0;attempt<200;attempt++){
    const blocked=(await pool.query(`SELECT pid FROM pg_stat_activity WHERE application_name='samvev-api' AND state='active' AND wait_event_type='Lock' AND query ILIKE $1 LIMIT 1`,[`%${fragment}%`])).rowCount;
    if(blocked)return;
    await pool.query('SELECT pg_sleep(0.025)');
  }
  throw new Error(`timed out waiting for blocked database query: ${fragment}`);
}
async function waitForMemberExpiry(sessionId:string){
  for(let attempt=0;attempt<200;attempt++){
    const expired=(await pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1',[sessionId])).rows[0]?.expired;
    if(expired)return;
    await pool.query('SELECT pg_sleep(0.025)');
  }
  throw new Error('timed out waiting for member session expiry');
}
async function waitForDisplayExpiry(id:string){
  for(let attempt=0;attempt<200;attempt++){
    const expired=(await pool.query('SELECT credential_expires_at<=clock_timestamp() AS expired FROM displays WHERE id=$1',[id])).rows[0]?.expired;
    if(expired)return;
    await pool.query('SELECT pg_sleep(0.025)');
  }
  throw new Error('timed out waiting for display credential expiry');
}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Round 13 Household Board refuses a non-isolated test database');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic board owner',email:'round13-board-owner@test.invalid',password:'Synthetic-board-owner-password-42'},household:{name:'Synthetic board household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;const ownerRow=(await pool.query<{account_id:string;person_id:string}>('SELECT account_id,person_id FROM memberships WHERE id=$1',[claim.json().membershipId])).rows[0]!;
  owner={cookie:cookie(claim),csrf:claim.json().csrfToken,accountId:ownerRow.account_id,membershipId:claim.json().membershipId,personId:ownerRow.person_id};
  const childPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic board child','child') RETURNING id`,[householdId])).rows[0]!;
  const childAccount=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,'round13-board-child@test.invalid',$2,'en','light' FROM households WHERE id=$1 RETURNING id`,[householdId,await hashPassword('Synthetic-board-child-password-42')])).rows[0]!;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'member',$4) RETURNING id`,[householdId,childAccount.id,childPerson.id,JSON.stringify(roleCapabilityPresets.member)])).rows[0]!;
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'round13-board-child@test.invalid',password:'Synthetic-board-child-password-42'}});assert.equal(login.statusCode,200,login.body);
  child={cookie:cookie(login),csrf:login.json().csrfToken,accountId:childAccount.id,membershipId:membership.id,personId:childPerson.id};
  const setup=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,locale,theme,is_default) VALUES($1,'Synthetic board setup','en','light',true) RETURNING id`,[householdId])).rows[0]!;
  const deviceToken=opaqueToken();const device=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic board display','en','light',$2,$3,clock_timestamp()+interval '90 days') RETURNING id`,[householdId,setup.id,tokenHash(deviceToken)])).rows[0]!;
  displayId=device.id;displayCookie=`samvev_display=${deviceToken}`;
});
after(async()=>{await app.close();await pool.end();});

test('native household boards enforce member revisions, tombstones, idempotency, display grants and daily snapshots',async()=>{
  const base=`/api/v1/households/${householdId}`;
  const added=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic apples',checked:false,requestKey:'child-grocery-create-01'}});assert.equal(added.statusCode,201,added.body);
  const itemId=added.json().item.id;
  const replay=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic apples',checked:false,requestKey:'child-grocery-create-01'}});assert.equal(replay.statusCode,201);assert.equal(replay.json().item.id,itemId);
  const mismatchedReplay=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Different apples',checked:false,requestKey:'child-grocery-create-01'}});assert.equal(mismatchedReplay.statusCode,409);assert.equal(mismatchedReplay.json().error.details.reason,'idempotency_payload_mismatch');
  const updated=await app.inject({method:'PATCH',url:`${base}/groceries/${itemId}`,headers:auth(owner),payload:{checked:true,expectedRevision:1,requestKey:'owner-check-item-0001'}});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().item.checked,true);
  const undo=await app.inject({method:'PATCH',url:`${base}/groceries/${itemId}`,headers:auth(child),payload:{checked:false,expectedRevision:2,requestKey:'child-uncheck-item-01'}});assert.equal(undo.statusCode,200);assert.equal(undo.json().item.checked,false);
  const concurrent=await Promise.all([
    app.inject({method:'PATCH',url:`${base}/groceries/${itemId}`,headers:auth(owner),payload:{checked:true,expectedRevision:3,requestKey:'owner-race-check-0001'}}),
    app.inject({method:'PATCH',url:`${base}/groceries/${itemId}`,headers:auth(child),payload:{checked:true,expectedRevision:3,requestKey:'child-race-check-01'}})
  ]);assert.deepEqual(concurrent.map((response)=>response.statusCode).sort(),[200,409]);
  const currentRevision=(await pool.query<{revision:number}>('SELECT revision FROM household_grocery_items WHERE id=$1',[itemId])).rows[0]!.revision;
  const removed=await app.inject({method:'DELETE',url:`${base}/groceries/${itemId}`,headers:auth(child),payload:{expectedRevision:currentRevision,requestKey:'child-delete-item-001'}});assert.equal(removed.statusCode,200,removed.body);
  const staleRestore=await app.inject({method:'PATCH',url:`${base}/groceries/${itemId}`,headers:auth(owner),payload:{checked:false,expectedRevision:currentRevision,requestKey:'owner-stale-restore-1'}});assert.equal(staleRestore.statusCode,409);
  assert.equal((await app.inject({method:'GET',url:`${base}/groceries`,headers:auth(owner)})).json().items.some((row:any)=>row.id===itemId),false);

  const option=await app.inject({method:'POST',url:`${base}/dinner-options`,headers:auth(child),payload:{title:'Synthetic lentil stew',emoji:'🥘',requestKey:'child-option-create-01'}});assert.equal(option.statusCode,201,option.body);const optionId=option.json().option.id;
  const today=localDateInTimezone(new Date(),'Europe/Oslo'),tomorrow=date(new Date(new Date(`${today}T12:00:00Z`).valueOf()+86_400_000));
  const assignments=await Promise.all([
    app.inject({method:'PUT',url:`${base}/dinners/${today}`,headers:auth(owner),payload:{optionId,expectedRevision:0,requestKey:'owner-day-assignment-1'}}),
    app.inject({method:'PUT',url:`${base}/dinners/${today}`,headers:auth(child),payload:{optionId,expectedRevision:0,requestKey:'child-day-assignment-1'}})
  ]);assert.deepEqual(assignments.map((response)=>response.statusCode).sort(),[200,409]);
  const first=assignments.find((response)=>response.statusCode===200)!;assert.equal(first.json().assignment.title,'Synthetic lentil stew');
  const renamed=await app.inject({method:'PATCH',url:`${base}/dinner-options/${optionId}`,headers:auth(owner),payload:{title:'Renamed stew',expectedRevision:1,requestKey:'owner-option-rename-1'}});assert.equal(renamed.statusCode,200);
  const day=await app.inject({method:'GET',url:`${base}/dinners?from=${today}&to=${today}`,headers:auth(owner)});assert.equal(day.statusCode,200);assert.equal(day.json().assignments.length,1);assert.equal(day.json().assignments[0].title,'Synthetic lentil stew');
  const week=await app.inject({method:'GET',url:`${base}/dinners?from=${today}&to=${tomorrow}`,headers:auth(owner)});assert.equal(week.statusCode,200);assert.equal(week.json().assignments.length,1);assert.equal(week.json().assignments[0].id,day.json().assignments[0].id);
  const deletedOption=await app.inject({method:'DELETE',url:`${base}/dinner-options/${optionId}`,headers:auth(child),payload:{expectedRevision:2,requestKey:'child-option-delete-01'}});assert.equal(deletedOption.statusCode,200,deletedOption.body);
  const afterOptionDelete=await app.inject({method:'GET',url:`${base}/dinners?from=${today}&to=${today}`,headers:auth(owner)});assert.equal(afterOptionDelete.json().assignments[0].title,'Synthetic lentil stew');
  const cleared=await app.inject({method:'PUT',url:`${base}/dinners/${today}`,headers:auth(owner),payload:{optionId:null,expectedRevision:1,requestKey:'owner-clear-dinner-01'}});assert.equal(cleared.statusCode,200);assert.equal(cleared.json().assignment.cleared,true);
  const afterReload=await app.inject({method:'GET',url:`${base}/dinners?from=${today}&to=${today}`,headers:auth(owner)});assert.equal(afterReload.statusCode,200);assert.deepEqual(afterReload.json().assignments[0],{id:day.json().assignments[0].id,localDate:today,title:null,emoji:null,revision:2,cleared:true});
  const freshOption=await app.inject({method:'POST',url:`${base}/dinner-options`,headers:auth(child),payload:{title:'Synthetic tomato soup',emoji:'🍅',requestKey:'child-option-after-clear-1'}});assert.equal(freshOption.statusCode,201,freshOption.body);
  const reassigned=await app.inject({method:'PUT',url:`${base}/dinners/${today}`,headers:auth(child),payload:{optionId:freshOption.json().option.id,expectedRevision:2,requestKey:'child-reassign-cleared-01'}});assert.equal(reassigned.statusCode,200,'cleared-day revision survives reload and accepts a new valid option');assert.equal(reassigned.json().assignment.revision,3);assert.equal(reassigned.json().assignment.title,'Synthetic tomato soup');assert.equal(reassigned.json().assignment.emoji,'🍅');assert.equal(reassigned.json().assignment.id,day.json().assignments[0].id);
  const staleAssignment=await app.inject({method:'PUT',url:`${base}/dinners/${today}`,headers:auth(child),payload:{optionId,expectedRevision:1,requestKey:'child-stale-dinner-01'}});assert.equal(staleAssignment.statusCode,409);

  const displayBase='/api/v1/display';
  const deniedDefault=await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:displayCookie}});assert.equal(deniedDefault.statusCode,403);
  const deniedWrite=await app.inject({method:'POST',url:`${displayBase}/groceries`,headers:{cookie:displayCookie,origin},payload:{label:'Synthetic display item',checked:false,requestKey:'display-grocery-denied-1'}});assert.equal(deniedWrite.statusCode,403);
  const grants=await app.inject({method:'PUT',url:`${base}/displays/${displayId}/board-read-grants`,headers:auth(owner),payload:{expectedRevision:1,groceryRead:true,dinnerRead:false}});assert.equal(grants.statusCode,200,grants.body);
  const selectedGrantOnly=await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:displayCookie}});assert.equal(selectedGrantOnly.statusCode,403,'setup card selection is independently required');
  const secondToken=opaqueToken();const secondDisplay=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,setup_id,credential_hash,credential_expires_at) SELECT household_id,'Synthetic second display','en','light',setup_id,$2,clock_timestamp()+interval '90 days' FROM displays WHERE id=$1 RETURNING id`,[displayId,tokenHash(secondToken)])).rows[0]!;
  assert.ok(secondDisplay.id);const copiedSetupDenied=await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:`samvev_display=${secondToken}`}});assert.equal(copiedSetupDenied.statusCode,403,'sharing a setup never copies device-level read grants');
  await pool.query(`UPDATE display_setups SET cards='["groceries","dinners"]'::jsonb,card_order='["groceries","dinners"]'::jsonb WHERE household_id=$1 AND id=(SELECT setup_id FROM displays WHERE id=$2)`,[householdId,displayId]);
  const readOnly=await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:displayCookie}});assert.equal(readOnly.statusCode,200,readOnly.body);
  assert.equal((await app.inject({method:'GET',url:`${displayBase}/dinners?from=${today}&to=${tomorrow}`,headers:{cookie:displayCookie}})).statusCode,403,'grocery read does not imply dinner read');
  const noWritePolicy=await app.inject({method:'POST',url:`${displayBase}/groceries`,headers:{cookie:displayCookie,origin},payload:{label:'Synthetic display item',checked:false,requestKey:'display-grocery-no-write-1'}});assert.equal(noWritePolicy.statusCode,403,'read permission does not grant write policy');
  await pool.query(`UPDATE display_action_policies SET grocery_write=true WHERE display_id=$1`,[displayId]);
  const displayAdded=await app.inject({method:'POST',url:`${displayBase}/groceries`,headers:{cookie:displayCookie,origin},payload:{label:'Synthetic display item',checked:false,requestKey:'display-grocery-create-1'}});assert.equal(displayAdded.statusCode,201,displayAdded.body);
  assert.equal((await app.inject({method:'POST',url:`${displayBase}/dinner-options`,headers:{cookie:displayCookie,origin},payload:{title:'Synthetic device dinner',emoji:'🍲',requestKey:'display-dinner-no-grant-1'}})).statusCode,403);
  const listener=new pg.Client({connectionString:process.env.DATABASE_URL});await listener.connect();await listener.query('LISTEN display_projection');
  const invalidation=new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('display_projection notification timed out')),2_000);listener.once('notification',(message)=>{clearTimeout(timer);resolve(message.payload??'');});});
  const sseItem=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic SSE invalidation',checked:false,requestKey:'child-sse-grocery-01'}});assert.equal(sseItem.statusCode,201);assert.equal(await invalidation,householdId);await listener.end();
  const secondGrant=await app.inject({method:'PUT',url:`${base}/displays/${displayId}/board-read-grants`,headers:auth(owner),payload:{expectedRevision:2,groceryRead:true,dinnerRead:true}});assert.equal(secondGrant.statusCode,200,secondGrant.body);
  const displayDinners=await app.inject({method:'GET',url:`${displayBase}/dinners?from=${today}&to=${tomorrow}`,headers:{cookie:displayCookie}});assert.equal(displayDinners.statusCode,200,displayDinners.body);
  assert.equal((await app.inject({method:'POST',url:`${displayBase}/dinner-options`,headers:{cookie:displayCookie,origin},payload:{title:'Synthetic device dinner',emoji:'🍲',requestKey:'display-dinner-no-policy-1'}})).statusCode,403,'dinner read does not imply dinner write policy');
  await pool.query(`UPDATE display_action_policies SET dinner_write=true WHERE display_id=$1`,[displayId]);
  const displayOption=await app.inject({method:'POST',url:`${displayBase}/dinner-options`,headers:{cookie:displayCookie,origin},payload:{title:'Synthetic device dinner',emoji:'🍲',requestKey:'display-dinner-create-1'}});assert.equal(displayOption.statusCode,201,displayOption.body);
  const displayOptionList=await app.inject({method:'GET',url:`${displayBase}/dinner-options`,headers:{cookie:displayCookie}});assert.equal(displayOptionList.statusCode,200);assert.ok(displayOptionList.json().options.some((row:any)=>row.id===displayOption.json().option.id));
  const displayAssignment=await app.inject({method:'PUT',url:`${displayBase}/dinners/${tomorrow}`,headers:{cookie:displayCookie,origin},payload:{optionId:displayOption.json().option.id,expectedRevision:0,requestKey:'display-dinner-set-0001'}});assert.equal(displayAssignment.statusCode,200,displayAssignment.body);
  const projection=await app.inject({method:'GET',url:`${displayBase}/projection`,headers:{cookie:displayCookie}});assert.equal(projection.statusCode,200);assert.ok(projection.json().householdBoards.groceries.some((row:any)=>row.id===displayAdded.json().item.id));
  const secondStillDenied=await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:`samvev_display=${secondToken}`}});assert.equal(secondStillDenied.statusCode,403);
  const isolation=(await app.inject({method:'GET',url:`/api/v1/households/${householdId}/groceries`,headers:auth(owner)})).json();assert.equal(isolation.items.some((row:any)=>row.id===displayAdded.json().item.id),true);
  await pool.query('UPDATE displays SET privacy_mode=true WHERE id=$1',[displayId]);assert.equal((await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:displayCookie}})).statusCode,403);
  await pool.query('UPDATE displays SET privacy_mode=false,revoked_at=clock_timestamp() WHERE id=$1',[displayId]);assert.equal((await app.inject({method:'GET',url:`${displayBase}/groceries`,headers:{cookie:displayCookie}})).statusCode,401);

  const replayItem=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic replay probe',checked:false,requestKey:'child-revoked-replay-1'}});assert.equal(replayItem.statusCode,201);
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[child.membershipId,JSON.stringify([])]);
  const revokedCapability=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic replay probe',checked:false,requestKey:'child-revoked-replay-1'}});assert.equal(revokedCapability.statusCode,403,'replay rechecks household visibility capability');
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[child.membershipId,JSON.stringify(roleCapabilityPresets.member)]);
  await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id=$1',[child.accountId]);
  const revokedReplay=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic replay probe',checked:false,requestKey:'child-revoked-replay-1'}});assert.equal(revokedReplay.statusCode,401,'idempotent replay still requires an active session');
  const childLoginAgain=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'round13-board-child@test.invalid',password:'Synthetic-board-child-password-42'}});assert.equal(childLoginAgain.statusCode,200);
  child.cookie=cookie(childLoginAgain);child.csrf=childLoginAgain.json().csrfToken;
  const crossSessionReplay=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic replay probe',checked:false,requestKey:'child-revoked-replay-1'}});assert.equal(crossSessionReplay.statusCode,201,'account-bound idempotency replays from a new active session');
  const advisory=new pg.Client({connectionString:process.env.DATABASE_URL});await advisory.connect();await advisory.query('BEGIN');await advisory.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${householdId}:member:${child.accountId}:child-revoked-replay-1`]);
  await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE token_hash=$1`,[tokenHash(child.cookie.split(';')[0]!.split('=')[1]!)]);
  const expiredMemberReplay=app.inject({method:'POST',url:`${base}/groceries`,headers:auth(child),payload:{label:'Synthetic replay probe',checked:false,requestKey:'child-revoked-replay-1'}});
  try{await waitForBlockedQuery('pg_advisory_xact_lock');await waitForMemberExpiry((await pool.query<{id:string}>(`SELECT id FROM sessions WHERE token_hash=$1`,[tokenHash(child.cookie.split(';')[0]!.split('=')[1]!)] )).rows[0]!.id);}finally{await advisory.query('ROLLBACK');await advisory.end();}
  const expiredMemberReplayResult=await expiredMemberReplay;assert.equal(expiredMemberReplayResult.statusCode,401,'expired member cannot replay a stored receipt after lock wait');
  const memberReplayRows=await pool.query<{count:string}>(`SELECT count(*)::text AS count FROM household_grocery_items WHERE household_id=$1 AND label='Synthetic replay probe' AND deleted_at IS NULL`,[householdId]);assert.equal(memberReplayRows.rows[0]!.count,'1','expired replay leaves the original item only');
  const installationId=(await pool.query<{id:string}>('SELECT installation_id AS id FROM households WHERE id=$1',[householdId])).rows[0]!.id;
  const unrelated=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic unrelated board','UTC','en') RETURNING id`,[installationId])).rows[0]!;
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${unrelated.id}/groceries`,headers:auth(owner)})).statusCode,404,'a member cannot read another household board');

  const grantLock=new pg.Client({connectionString:process.env.DATABASE_URL});await grantLock.connect();await grantLock.query('BEGIN');await grantLock.query('SELECT display_id FROM display_board_read_grants WHERE display_id=$1 FOR UPDATE',[secondDisplay.id]);
  const ownerSessionId=(await pool.query<{id:string}>('SELECT id FROM sessions WHERE token_hash=$1',[tokenHash(sessionToken(owner.cookie))])).rows[0]!.id;
  await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`,[ownerSessionId]);
  const expiringGrantUpdate=app.inject({method:'PUT',url:`${base}/displays/${secondDisplay.id}/board-read-grants`,headers:auth(owner),payload:{expectedRevision:1,groceryRead:true,dinnerRead:true}});
  try{await waitForBlockedQuery('SELECT revision FROM display_board_read_grants');await waitForMemberExpiry(ownerSessionId);}finally{await grantLock.query('ROLLBACK');await grantLock.end();}
  assert.equal((await expiringGrantUpdate).statusCode,401,'admin authority expiring during grant-row lock wait rolls back the grant update');
  assert.deepEqual((await pool.query(`SELECT revision,grocery_read AS "groceryRead",dinner_read AS "dinnerRead" FROM display_board_read_grants WHERE display_id=$1`,[secondDisplay.id])).rows[0],{revision:1,groceryRead:false,dinnerRead:false});
  const ownerLoginAgain=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'round13-board-owner@test.invalid',password:'Synthetic-board-owner-password-42'}});assert.equal(ownerLoginAgain.statusCode,200);
  owner.cookie=cookie(ownerLoginAgain);owner.csrf=ownerLoginAgain.json().csrfToken;
  await pool.query(`UPDATE display_board_read_grants SET grocery_read=true,dinner_read=true,revision=revision+1 WHERE display_id=$1`,[secondDisplay.id]);
  await pool.query(`UPDATE display_action_policies SET grocery_write=true,dinner_write=true WHERE display_id=$1`,[secondDisplay.id]);

  const expiringMemberItem=await app.inject({method:'POST',url:`${base}/groceries`,headers:auth(owner),payload:{label:'Synthetic late member write',checked:false,requestKey:'owner-late-write-seed-01'}});assert.equal(expiringMemberItem.statusCode,201);
  const lateItemId=expiringMemberItem.json().item.id;const memberItemLock=new pg.Client({connectionString:process.env.DATABASE_URL});await memberItemLock.connect();await memberItemLock.query('BEGIN');await memberItemLock.query('SELECT id FROM household_grocery_items WHERE id=$1 FOR UPDATE',[lateItemId]);
  const lateMemberSessionId=(await pool.query<{id:string}>('SELECT id FROM sessions WHERE token_hash=$1',[tokenHash(sessionToken(owner.cookie))])).rows[0]!.id;
  await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`,[lateMemberSessionId]);
  const lateMemberWrite=app.inject({method:'PATCH',url:`${base}/groceries/${lateItemId}`,headers:auth(owner),payload:{label:'Must roll back after expiry',expectedRevision:1,requestKey:'owner-late-write-0001'}});
  try{await waitForBlockedQuery('UPDATE household_grocery_items SET label=COALESCE');await waitForMemberExpiry(lateMemberSessionId);}finally{await memberItemLock.query('ROLLBACK');await memberItemLock.end();}
  assert.equal((await lateMemberWrite).statusCode,401,'member authority expiring during item lock wait rolls back the mutation');
  assert.deepEqual((await pool.query('SELECT label,revision FROM household_grocery_items WHERE id=$1',[lateItemId])).rows[0],{label:'Synthetic late member write',revision:1});
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM household_board_requests WHERE actor_type='member' AND actor_id=$1 AND request_key='owner-late-write-0001'`,[owner.accountId])).rows[0]!.count,0);

  const displayItemLock=new pg.Client({connectionString:process.env.DATABASE_URL});await displayItemLock.connect();await displayItemLock.query('BEGIN');await displayItemLock.query('SELECT id FROM household_grocery_items WHERE id=$1 FOR UPDATE',[lateItemId]);
  await pool.query(`UPDATE displays SET credential_expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`,[secondDisplay.id]);
  const lateDisplayWrite=app.inject({method:'PATCH',url:`${displayBase}/groceries/${lateItemId}`,headers:{cookie:`samvev_display=${secondToken}`,origin},payload:{checked:true,expectedRevision:1,requestKey:'display-late-write-0001'}});
  try{await waitForBlockedQuery('UPDATE household_grocery_items SET label=COALESCE');await waitForDisplayExpiry(secondDisplay.id);}finally{await displayItemLock.query('ROLLBACK');await displayItemLock.end();}
  assert.equal((await lateDisplayWrite).statusCode,401,'device authority expiring during item lock wait rolls back the mutation');
  assert.deepEqual((await pool.query('SELECT label,checked,revision FROM household_grocery_items WHERE id=$1',[lateItemId])).rows[0],{label:'Synthetic late member write',checked:false,revision:1});
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM household_board_requests WHERE actor_type='display' AND actor_id=$1 AND request_key='display-late-write-0001'`,[secondDisplay.id])).rows[0]!.count,0);

  await pool.query(`UPDATE displays SET credential_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1`,[secondDisplay.id]);
  const displayReceipt=await app.inject({method:'POST',url:`${displayBase}/groceries`,headers:{cookie:`samvev_display=${secondToken}`,origin},payload:{label:'Synthetic display replay expiry',checked:false,requestKey:'display-expiring-replay-01'}});assert.equal(displayReceipt.statusCode,201,displayReceipt.body);
  const displayAdvisory=new pg.Client({connectionString:process.env.DATABASE_URL});await displayAdvisory.connect();await displayAdvisory.query('BEGIN');await displayAdvisory.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${householdId}:display:${secondDisplay.id}:display-expiring-replay-01`]);
  await pool.query(`UPDATE displays SET credential_expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`,[secondDisplay.id]);
  const lateDisplayReplay=app.inject({method:'POST',url:`${displayBase}/groceries`,headers:{cookie:`samvev_display=${secondToken}`,origin},payload:{label:'Synthetic display replay expiry',checked:false,requestKey:'display-expiring-replay-01'}});
  try{await waitForBlockedQuery('pg_advisory_xact_lock');await waitForDisplayExpiry(secondDisplay.id);}finally{await displayAdvisory.query('ROLLBACK');await displayAdvisory.end();}
  assert.equal((await lateDisplayReplay).statusCode,401,'device authority expiring during receipt lookup wait prevents replay');
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM household_grocery_items WHERE household_id=$1 AND label='Synthetic display replay expiry' AND deleted_at IS NULL`,[householdId])).rows[0]!.count,1);
});
