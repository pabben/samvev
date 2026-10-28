import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test,{before,after} from 'node:test';
import type {FastifyInstance} from 'fastify';
import {roleCapabilityPresets} from '@samvev/contracts';
import {tokenHash} from '@samvev/core';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {localDateInTimezone} from './people/domain.ts';

const origin='https://round15-display-policy.test.invalid';
let app:FastifyInstance,baseUrl:string;
const oldRevalidate=process.env.SAMVEV_SSE_REVALIDATE_MS;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');assert.equal(database.hostname,'test-db');assert.equal(database.pathname,'/samvev_test');
  process.env.SAMVEV_SSE_REVALIDATE_MS='60000';await migrate();
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  baseUrl=await app.listen({host:'127.0.0.1',port:0});
});
after(async()=>{await app.close();await pool.end();if(oldRevalidate===undefined)delete process.env.SAMVEV_SSE_REVALIDATE_MS;else process.env.SAMVEV_SSE_REVALIDATE_MS=oldRevalidate;});

async function fixture(){
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  const installation=(await pool.query<{id:string}>(`INSERT INTO installations(claimed_at,setup_step) VALUES(clock_timestamp(),'complete') RETURNING id`)).rows[0]!.id;
  const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,show_upcoming_birthday) VALUES($1,'Synthetic display policy','Europe/Oslo','en',true) RETURNING id`,[installation])).rows[0]!.id;
  const ownerPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic owner','adult') RETURNING id`,[household])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'display-policy@test.invalid','unused','en','light') RETURNING id`,[installation])).rows[0]!.id;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[household,account,ownerPerson,JSON.stringify(roleCapabilityPresets.household_admin)])).rows[0]!.id;
  const session=(await pool.query<{id:string}>(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour') RETURNING id`,[account,tokenHash('synthetic-display-manager'),tokenHash('synthetic-display-csrf')])).rows[0]!.id;
  const headers={origin,cookie:'samvev_session=synthetic-display-manager','x-csrf-token':'synthetic-display-csrf'};
  const today=localDateInTimezone(new Date(),'Europe/Oslo');const tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const selected=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES($1,'Synthetic selected birthday','child',$2) RETURNING id`,[household,`2010-${today.slice(5)}`])).rows[0]!.id;
  const unselected=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES($1,'Synthetic unselected birthday','child',$2) RETURNING id`,[household,`2011-${tomorrow.toISOString().slice(5,10)}`])).rows[0]!.id;
  const setup=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,locale,theme,cards,card_order) VALUES($1,'Synthetic assigned setup','nb','dark','["household_messages","family_layout","external_items","today","tomorrow","next"]','["household_messages","family_layout","external_items","today","tomorrow","next"]') RETURNING id`,[household])).rows[0]!.id;
  await pool.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[household,setup,selected]);
  const display=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,setup_id,name,locale,theme,privacy_mode,external_items_enabled,credential_hash,credential_expires_at) VALUES($1,$2,'Synthetic existing registration','en',NULL,false,true,$3,clock_timestamp()+interval '1 hour') RETURNING id`,[household,setup,tokenHash('synthetic-old-display')])).rows[0]!.id;
  await pool.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed) VALUES($1,$2,$3,true)',[household,display,selected]);
  return{installation,household,account,membership,session,selected,unselected,setup,display,headers,today,cookie:'samvev_display=synthetic-old-display',base:`/api/v1/households/${household}/displays`};
}
async function start(){
  const verifier=`synthetic-display-verifier-${randomUUID()}`;
  const response=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',headers:{origin},payload:{verifierHash:hash(verifier)}});assert.equal(response.statusCode,201,response.body);
  return{...response.json(),verifier};
}
async function approve(f:Awaited<ReturnType<typeof fixture>>,pair:Awaited<ReturnType<typeof start>>,generation=1){
  return app.inject({method:'POST',url:`${f.base}/${f.display}/pairing/approve`,headers:f.headers,payload:{code:pair.code,expectedCredentialGeneration:generation}});
}
async function redeem(pair:Awaited<ReturnType<typeof start>>){return app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',headers:{origin},payload:{pairingId:pair.pairingId,verifier:pair.verifier}});}
function cookieOf(response:{headers:Record<string,unknown>}){const raw=response.headers['set-cookie'];return String(Array.isArray(raw)?raw[0]:raw).split(';')[0]!;}
async function projection(cookie:string){return app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie}});}
async function waitBlocked(fragment:string){const deadline=Date.now()+4000;while(Date.now()<deadline){const blocked=await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1`,[`%${fragment}%`]);if(blocked.rowCount)return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail(`missing blocked query: ${fragment}`);}

test('additive migrations preserve mixed/all-current legacy consents and approved pairing generations',async()=>{
  const client=await pool.connect();try{await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE displays(id uuid PRIMARY KEY,household_id uuid,credential_hash text,credential_expires_at timestamptz) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE pairing_requests(id uuid,display_id uuid,approved_at timestamptz,redeemed_at timestamptz) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE display_person_grants(household_id uuid,display_id uuid,person_id uuid,profile_allowed boolean,birthday_allowed boolean) ON COMMIT DROP');
    const household=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()];
    await client.query('INSERT INTO displays(id,household_id) SELECT unnest($1::uuid[]),$2',[ids,household]);
    await client.query('INSERT INTO display_person_grants VALUES($1,$2,$3,true,true),($1,$2,$4,false,false),($1,$5,$3,false,true),($1,$5,$4,true,true)',[household,ids[0],randomUUID(),randomUUID(),ids[1]]);
    await client.query('INSERT INTO pairing_requests VALUES($1,$2,clock_timestamp(),NULL)',[randomUUID(),ids[0]]);
    const before=(await client.query('SELECT * FROM display_person_grants ORDER BY display_id,person_id')).rows;
    await client.query(await readFile(new URL('../migrations/043_display_credential_generation.sql',import.meta.url),'utf8'));
    await client.query(await readFile(new URL('../migrations/044_display_presentation_policy.sql',import.meta.url),'utf8'));
    const rows=(await client.query<{id:string;birthday_mode:string;person_ids_override:string[]|null;credential_generation:number}>('SELECT * FROM displays')).rows;
    assert.equal(rows.find(row=>row.id===ids[0])!.birthday_mode,'legacy_selected');assert.equal(rows.find(row=>row.id===ids[1])!.birthday_mode,'legacy_selected');assert.equal(rows.find(row=>row.id===ids[2])!.birthday_mode,'off');
    assert.ok(rows.every(row=>row.person_ids_override===null&&row.credential_generation===1));
    assert.equal((await client.query('SELECT expected_credential_generation FROM pairing_requests')).rows[0].expected_credential_generation,1);
    assert.deepEqual((await client.query('SELECT * FROM display_person_grants ORDER BY display_id,person_id')).rows,before);
  }finally{await client.query('ROLLBACK');client.release();}
  await migrate();assert.equal((await pool.query(`SELECT count(*)::int AS n FROM schema_migrations WHERE version IN ('043_display_credential_generation.sql','044_display_presentation_policy.sql')`)).rows[0].n,2);
});

test('reconnect preserves registration and grants, rotates on redeem only, and stale disconnect cannot affect the replacement',async()=>{
  const f=await fixture();const before=(await pool.query('SELECT to_jsonb(d)-ARRAY[\'credential_hash\',\'credential_expires_at\',\'credential_generation\',\'last_seen_at\'] AS value FROM displays d WHERE id=$1',[f.display])).rows[0].value;
  const grants=(await pool.query('SELECT * FROM display_person_grants WHERE display_id=$1',[f.display])).rows;
  const pair=await start();assert.equal((await approve(f,pair)).statusCode,200);assert.equal((await projection(f.cookie)).statusCode,200,'approval alone retains old access');
  const result=await redeem(pair);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().id,f.display);assert.equal((await pool.query('SELECT credential_generation FROM displays WHERE id=$1',[f.display])).rows[0].credential_generation,2);assert.equal(Object.hasOwn(result.json(),'credential_generation'),false);const replacement=cookieOf(result);
  assert.equal((await projection(f.cookie)).statusCode,401);assert.equal((await projection(replacement)).statusCode,200);assert.equal((await redeem(pair)).statusCode,410);
  const detachOld=await app.inject({method:'POST',url:'/api/v1/display/disconnect',headers:{origin,cookie:f.cookie+'; '+f.headers.cookie},payload:{}});assert.equal(detachOld.statusCode,204,detachOld.body);assert.match(String(detachOld.headers['set-cookie']),/Path=\/api\/v1\/display/);assert.doesNotMatch(String(detachOld.headers['set-cookie']),/samvev_session/);
  assert.equal((await projection(replacement)).statusCode,200);
  assert.deepEqual((await pool.query('SELECT to_jsonb(d)-ARRAY[\'credential_hash\',\'credential_expires_at\',\'credential_generation\',\'last_seen_at\'] AS value FROM displays d WHERE id=$1',[f.display])).rows[0].value,before);
  assert.deepEqual((await pool.query('SELECT * FROM display_person_grants WHERE display_id=$1',[f.display])).rows,grants);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/display/disconnect',headers:{origin,cookie:replacement},payload:{displayId:f.display}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/display/disconnect',headers:{origin,cookie:replacement},payload:{}})).statusCode,204);
  assert.equal((await projection(replacement)).statusCode,401);assert.equal((await pool.query('SELECT revoked_at FROM displays WHERE id=$1',[f.display])).rows[0].revoked_at,null);
  assert.equal((await app.inject({method:'GET',url:f.base,headers:f.headers})).statusCode,200,'display disconnect preserves the administrator session');
});

test('concurrent reconnects, stale generation, verifier, expiry and revoked registration fail closed',async()=>{
  const f=await fixture(),first=await start(),second=await start();assert.equal((await approve(f,first)).statusCode,200);assert.equal((await approve(f,second)).statusCode,200);
  const results=await Promise.all([redeem(first),redeem(second)]);assert.deepEqual(results.map(row=>row.statusCode).sort(),[200,410]);
  assert.equal((await approve(f,await start(),1)).statusCode,409);
  const pair=await start();assert.equal((await approve(f,pair,2)).statusCode,200);
  assert.equal((await redeem({...pair,verifier:'incorrect-verifier-012345678901234567890123456789'})).statusCode,410);
  await pool.query(`UPDATE pairing_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[pair.pairingId]);assert.equal((await redeem(pair)).statusCode,410);
  const expiredDevice=await start();await pool.query(`UPDATE displays SET credential_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[f.display]);assert.equal((await approve(f,expiredDevice,2)).statusCode,200);assert.equal((await redeem(expiredDevice)).statusCode,200,'expired credentials may reconnect');
  const expiring=await start();assert.equal((await approve(f,expiring,3)).statusCode,200);
  await pool.query(`UPDATE pairing_requests SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1`,[expiring.pairingId]);
  const displayLock=await pool.connect();await displayLock.query('BEGIN');await displayLock.query('SELECT id FROM displays WHERE id=$1 FOR UPDATE',[f.display]);
  try{const pending=redeem(expiring).then(value=>value);await waitBlocked('SELECT id FROM displays');await new Promise(resolve=>setTimeout(resolve,1100));await displayLock.query('COMMIT');assert.equal((await pending).statusCode,410,'code expiry is rechecked after waiting for its display lock');}finally{await displayLock.query('ROLLBACK');displayLock.release();}
  const revoked=await start();assert.equal((await approve(f,revoked,3)).statusCode,200);await pool.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE id=$1',[f.display]);assert.equal((await redeem(revoked)).statusCode,410,'revocation after approval fences redemption');assert.equal((await approve(f,await start(),3)).statusCode,404);
});

test('approval rechecks CSRF, household and session authority after waiting for a pairing lock',async()=>{
  const f=await fixture(),pair=await start();
  assert.equal((await app.inject({method:'POST',url:`${f.base}/${f.display}/pairing/approve`,headers:{...f.headers,'x-csrf-token':'wrong'},payload:{code:pair.code,expectedCredentialGeneration:1}})).statusCode,403);
  const other=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic other','UTC','en') RETURNING id`,[f.installation])).rows[0]!.id;
  assert.equal((await app.inject({method:'POST',url:`/api/v1/households/${other}/displays/${f.display}/pairing/approve`,headers:f.headers,payload:{code:pair.code,expectedCredentialGeneration:1}})).statusCode,404);
  const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM pairing_requests WHERE id=$1 FOR UPDATE',[pair.pairingId]);
  try{const pending=approve(f,pair).then(value=>value);await waitBlocked('SELECT id FROM pairing_requests');await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1',[f.session]);await lock.query('COMMIT');assert.equal((await pending).statusCode,401);assert.equal((await pool.query('SELECT approved_at FROM pairing_requests WHERE id=$1',[pair.pairingId])).rows[0].approved_at,null);}finally{await lock.query('ROLLBACK');lock.release();}
});

test('notified SSE closes old credentials immediately and final fences reject projection and activity reads across rotation',async()=>{
  const f=await fixture();const abort=new AbortController();
  const stream=await fetch(`${baseUrl}/api/v1/display/events`,{headers:{cookie:f.cookie},signal:abort.signal});assert.equal(stream.status,200);const reader=stream.body!.getReader();const decoder=new TextDecoder();let output='';
  const until=async(marker:string)=>{const deadline=Date.now()+4000;while(!output.includes(marker)){if(Date.now()>deadline)assert.fail(`missing SSE ${marker}`);const step=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('SSE deadline')),4000))]);if(step.done)break;output+=decoder.decode(step.value);}assert.ok(output.includes(marker));};
  try{await until('event: ready');const pair=await start();assert.equal((await approve(f,pair)).statusCode,200);const rotated=await redeem(pair);assert.equal(rotated.statusCode,200,rotated.body);await until('event: authorization-revoked');assert.equal((await projection(f.cookie)).statusCode,401);
    let current=cookieOf(rotated),generation=2;
    await pool.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic fenced private message','normal',true,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','published','synthetic-fenced-message',clock_timestamp())`,[f.household,f.membership]);
    await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) SELECT $1,id,$2,'delivered' FROM messages WHERE idempotency_key='synthetic-fenced-message'`,[f.household,f.display]);
    for(const [url,table,fragment] of [['/api/v1/display/projection','messages','FROM messages m'],[`/api/v1/display/activities?from=${f.today}&to=${f.today}`,'integration_items','SELECT i.id,i.external_id']] as const){
      const next=await start();assert.equal((await approve(f,next,generation)).statusCode,200);const lock=await pool.connect();await lock.query('BEGIN');await lock.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
      try{const pending=app.inject({method:'GET',url,headers:{cookie:current}}).then(value=>value);await Promise.race([waitBlocked(fragment),pending.then(value=>assert.fail(`read finished before lock: ${value.statusCode} ${value.body}`))]);const replacement=await redeem(next);assert.equal(replacement.statusCode,200,replacement.body);current=cookieOf(replacement);generation++;await lock.query('COMMIT');const denied=await pending;assert.equal(denied.statusCode,401,denied.body);assert.doesNotMatch(denied.body,/Synthetic fenced private message/);}finally{await lock.query('ROLLBACK');lock.release();}
    }
  }finally{abort.abort();await reader.cancel().catch(()=>undefined);await new Promise(resolve=>setTimeout(resolve,25));}
});

test('birthday modes preserve legacy limits and all covers unselected and later people without granting profiles or calendars',async()=>{
  const f=await fixture();let response=(await projection(f.cookie)).json();assert.deepEqual(response.birthdays.entries,[]);assert.equal(response.birthdays.mode,'off');
  await pool.query("UPDATE displays SET birthday_mode='legacy_selected' WHERE id=$1",[f.display]);await pool.query('UPDATE display_person_grants SET birthday_allowed=true WHERE display_id=$1 AND person_id=$2',[f.display,f.selected]);
  response=(await projection(f.cookie)).json();assert.deepEqual(response.birthdays.entries.map((entry:any)=>entry.personId),[f.selected]);
  const patch=async(payload:object)=>app.inject({method:'PATCH',url:`${f.base}/${f.display}`,headers:f.headers,payload});
  assert.equal((await patch({theme:'light'})).statusCode,200);assert.equal((await projection(f.cookie)).json().birthdays.mode,'legacy_selected');
  assert.equal((await patch({birthdayMode:'all',birthdayPersonIds:[]})).statusCode,400);
  await pool.query('UPDATE households SET show_upcoming_birthday=false WHERE id=$1',[f.household]);
  assert.equal((await patch({birthdayMode:'all',personIdsOverride:[]})).statusCode,200);
  const later=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES($1,'Synthetic newly registered birthday','child',$2) RETURNING id`,[f.household,`2012-${f.today.slice(5)}`])).rows[0]!.id;
  response=(await projection(f.cookie)).json();assert.deepEqual(response.birthdays.entries.map((entry:any)=>entry.personId).sort(),[f.selected,f.unselected,later].sort());assert.deepEqual(response.familyLayout.people,[]);
  for(const entry of response.birthdays.entries)assert.deepEqual(Object.keys(entry).sort(),['due','displayName','personId'].sort());
  assert.equal((await pool.query('SELECT 1 FROM display_person_grants WHERE display_id=$1 AND person_id=ANY($2::uuid[])',[f.display,[f.unselected,later]])).rowCount,0);
  await pool.query(`UPDATE display_setups SET cards='["today","tomorrow"]',card_order='["today","tomorrow"]',family_layout_enabled=false WHERE id=$1`,[f.setup]);
  response=(await projection(f.cookie)).json();assert.equal(response.familyLayout.enabled,false);assert.equal(response.birthdays.entries.length,3,'standalone day cards do not require family layout');
  assert.equal((await patch({birthdayMode:'off'})).statusCode,200);response=(await projection(f.cookie)).json();assert.deepEqual(response.birthdays.entries,[]);assert.deepEqual(response.familyLayout.upcomingBirthdays,[]);
  assert.equal((await patch({birthdayPersonIds:[f.selected]})).statusCode,400,'legacy payload cannot silently reactivate explicit off');
  assert.equal((await patch({birthdayMode:'all',privacyMode:true})).statusCode,200);assert.deepEqual((await projection(f.cookie)).json().birthdays.entries,[]);
  assert.equal((await patch({revoked:true})).statusCode,200);assert.equal((await projection(f.cookie)).statusCode,401);
});

test('device person override inherits or selects none without changing setup/grants and preview follows identical precedence',async()=>{
  const f=await fixture();const patch=async(payload:object)=>app.inject({method:'PATCH',url:`${f.base}/${f.display}`,headers:f.headers,payload});
  const inherited=(await app.inject({method:'GET',url:f.base,headers:f.headers})).json().displays[0];assert.equal(inherited.personIdsOverride,null);assert.deepEqual(inherited.effective.personIds,[f.selected]);assert.equal(inherited.localeOverride,'en');assert.equal(inherited.themeOverride,null);assert.equal(inherited.effective.theme,'dark');assert.equal(inherited.credentialGeneration,1);
  const before=(await pool.query('SELECT * FROM display_person_grants WHERE display_id=$1',[f.display])).rows;
  const empty=await patch({personIdsOverride:[]});assert.equal(empty.statusCode,200,empty.body);assert.deepEqual(empty.json().effective.personIds,[]);assert.equal(empty.json().contentReadiness.calendar,'not_shared','no selected people is not a blanket calendar prohibition; this fixture has no shared calendar');
  let preview=await app.inject({method:'POST',url:`${f.base}/${f.display}/preview`,headers:f.headers,payload:{setupId:f.setup}});assert.equal(preview.statusCode,200,preview.body);assert.deepEqual(preview.json().setup.personIds,[]);
  assert.equal((await patch({personIdsOverride:[f.unselected]})).statusCode,200);assert.deepEqual((await projection(f.cookie)).json().setup.personIds,[f.unselected]);assert.deepEqual((await projection(f.cookie)).json().familyLayout.people,[],'selection does not grant a profile');
  preview=await app.inject({method:'POST',url:`${f.base}/${f.display}/preview`,headers:f.headers,payload:{setupId:f.setup}});assert.equal(preview.statusCode,200,preview.body);assert.deepEqual(preview.json().setup.personIds,[f.unselected]);
  assert.deepEqual((await pool.query('SELECT person_id FROM display_setup_people WHERE setup_id=$1',[f.setup])).rows.map(row=>row.person_id),[f.selected]);assert.deepEqual((await pool.query('SELECT * FROM display_person_grants WHERE display_id=$1',[f.display])).rows,before);
  assert.equal((await patch({personIdsOverride:[f.selected,f.selected]})).statusCode,400);assert.equal((await patch({personIdsOverride:[randomUUID()]})).statusCode,404);
  assert.equal((await patch({personIdsOverride:null,locale:null,theme:'system'})).statusCode,200);const follow=(await app.inject({method:'GET',url:f.base,headers:f.headers})).json().displays[0];assert.deepEqual(follow.effective.personIds,[f.selected]);assert.equal(follow.effective.locale,'nb');assert.equal(follow.effective.theme,'system');
  assert.equal(follow.contentReadiness.calendar,'not_shared');
  const connection=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic unshared label') RETURNING id`,[f.household])).rows[0]!.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name) VALUES($1,$2,$3,'ics','Synthetic calendar') RETURNING id`,[f.household,connection,f.account])).rows[0]!.id;
  const source=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,subject_household) VALUES($1,$2,'synthetic-empty','Synthetic hidden source name',true,true) RETURNING id`,[f.household,calendar])).rows[0]!.id;
  await pool.query('INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id) VALUES($1,$2,$3)',[f.household,f.setup,source]);await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[f.household,connection,f.display]);await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[f.household,source,f.display]);
  const ready=(await projection(f.cookie)).json();assert.equal(ready.contentReadiness.calendar,'ready','an empty but shared source is configured');assert.doesNotMatch(JSON.stringify(ready.contentReadiness),/Synthetic/);
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[f.membership,JSON.stringify(['household.view'])]);
  const memberView=await app.inject({method:'GET',url:f.base,headers:f.headers});assert.equal(memberView.statusCode,200,memberView.body);
  for(const field of ['credentialGeneration','birthdayMode','personIdsOverride','localeOverride','themeOverride','setupDefaults','effective','contentReadiness'])assert.equal(Object.hasOwn(memberView.json().displays[0],field),false,'new administrative policy is manager-only');
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[f.membership,JSON.stringify(roleCapabilityPresets.household_admin)]);
  assert.equal((await patch({externalItemsEnabled:false})).json().contentReadiness.calendar,'external_disabled');assert.equal((await patch({privacyMode:true})).json().contentReadiness.calendar,'privacy');
});

test('readiness intersects the selected calendar source grant and allows shared household sources without selected people',async()=>{
  const f=await fixture(),privateName='Synthetic unshared selected calendar B';
  const connection=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic mixed calendar connection') RETURNING id`,[f.household])).rows[0]!.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name) VALUES($1,$2,$3,'ics','Synthetic mixed calendar') RETURNING id`,[f.household,connection,f.account])).rows[0]!.id;
  const shared=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,subject_household) VALUES($1,$2,'shared-A','Synthetic shared calendar A',true,true) RETURNING id`,[f.household,calendar])).rows[0]!.id;
  const unshared=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,subject_household) VALUES($1,$2,'private-B',$3,true,true) RETURNING id`,[f.household,calendar,privateName])).rows[0]!.id;
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[f.household,connection,f.display]);
  await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[f.household,shared,f.display]);
  await pool.query('INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id) VALUES($1,$2,$3)',[f.household,f.setup,unshared]);
  const blocked=await projection(f.cookie);assert.equal(blocked.statusCode,200,blocked.body);assert.equal(blocked.json().contentReadiness.calendar,'not_shared');assert.ok(!blocked.body.includes(privateName));
  const manager=await app.inject({method:'GET',url:f.base,headers:f.headers});assert.equal(manager.statusCode,200,manager.body);assert.equal(manager.json().displays[0].contentReadiness.calendar,'not_shared');assert.ok(!manager.body.includes(privateName));
  const hiddenCatalog=await app.inject({method:'GET',url:'/api/v1/display/activities/sources',headers:{cookie:f.cookie}});assert.equal(hiddenCatalog.statusCode,200,hiddenCatalog.body);assert.deepEqual(hiddenCatalog.json().sources,[]);assert.ok(!hiddenCatalog.body.includes(privateName));
  await pool.query('UPDATE display_setup_calendar_sources SET source_id=$3 WHERE household_id=$1 AND setup_id=$2',[f.household,f.setup,shared]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM integration_items WHERE household_id=$1',[f.household])).rows[0].n,0);
  assert.equal((await projection(f.cookie)).json().contentReadiness.calendar,'ready','a selected shared source with zero events is ready');
  const empty=await app.inject({method:'PATCH',url:`${f.base}/${f.display}`,headers:f.headers,payload:{personIdsOverride:[]}});assert.equal(empty.statusCode,200,empty.body);assert.equal(empty.json().contentReadiness.calendar,'ready','household calendars do not require selected people');
  await pool.query('UPDATE calendar_sources SET subject_household=false WHERE id=$1',[shared]);
  await pool.query('INSERT INTO calendar_source_person_subjects(household_id,source_id,person_id) VALUES($1,$2,$3)',[f.household,shared,f.selected]);
  assert.equal((await projection(f.cookie)).json().contentReadiness.calendar,'none_selected','an empty person selection is informative for a shared person-scoped source');
  await pool.query('UPDATE calendar_sources SET subject_household=true WHERE id=$1',[shared]);
  const visibleCatalog=await app.inject({method:'GET',url:'/api/v1/display/activities/sources',headers:{cookie:f.cookie}});assert.equal(visibleCatalog.statusCode,200,visibleCatalog.body);assert.deepEqual(visibleCatalog.json().sources.map((source:any)=>source.id),[shared]);assert.ok(!visibleCatalog.body.includes(privateName));
  const start=new Date(Date.now()+60_000),end=new Date(start.getTime()+60_000),date=localDateInTimezone(start,'Europe/Oslo');
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash) VALUES($1,$2,'synthetic-household-ready','event',true,'Synthetic household activity','Synthetic detail','normal',$3,$4,$5,$6,$7) RETURNING id`,[f.household,connection,start,end,JSON.stringify({observedAt:start.toISOString(),uncertainty:'low'}),JSON.stringify({calendar:{provider:'ics',sourceId:shared,subjectHousehold:true}}),hash('synthetic-household-ready')])).rows[0]!.id;
  await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,'synthetic-household-ready','single',$3,'synthetic-household-ready',$4,'active',1)`,[f.household,shared,item,hash('synthetic-household-ready')]);
  await pool.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[f.household,item,f.display]);
  const activities=await app.inject({method:'GET',url:`/api/v1/display/activities?from=${date}&to=${date}`,headers:{cookie:f.cookie}});assert.equal(activities.statusCode,200,activities.body);assert.ok(activities.json().activities.some((activity:any)=>activity.id===item),'the unchanged projection ACL actually admits a shared household activity with an empty person selection');
  await pool.query('DELETE FROM calendar_source_display_targets WHERE household_id=$1 AND source_id=$2 AND display_id=$3',[f.household,shared,f.display]);
  const info=(await projection(f.cookie)).json().contentReadiness;assert.equal(info.calendar,'not_shared','missing source-level sharing is not misreported as a person-selection requirement');
});
