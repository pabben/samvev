import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
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
    for(const [url,table,fragment] of [['/api/v1/display/projection','messages','jsonb_build_array(m.author_membership_id'],[`/api/v1/display/activities?from=${f.today}&to=${f.today}`,'integration_items','SELECT i.id,i.external_id']] as const){
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

// Delay the actual last projection query after it has read its result. Changes
// below commit while private family/birthday/hub/board content is already built,
// so a fresh initial authorization or an earlier per-query ACL cannot mask a
// missing final response fence. No production-only test hooks are involved.
async function policyFenceFixture(){
  const f=await fixture();
  await pool.query(`UPDATE display_setups SET family_layout_enabled=true,cards=cards||'["new_message","groceries"]'::jsonb,card_order=card_order||'["new_message","groceries"]'::jsonb WHERE id=$1`,[f.setup]);
  await pool.query("UPDATE displays SET birthday_mode='legacy_selected' WHERE id=$1",[f.display]);
  await pool.query('UPDATE display_person_grants SET birthday_allowed=true WHERE display_id=$1',[f.display]);
  await pool.query('UPDATE display_board_read_grants SET grocery_read=true WHERE display_id=$1',[f.display]);
  await pool.query('UPDATE display_action_policies SET message_create=true,grocery_write=true WHERE display_id=$1',[f.display]);
  await pool.query('INSERT INTO display_action_people(household_id,display_id,person_id) VALUES($1,$2,$3)',[f.household,f.display,f.selected]);
  const connection=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic fenced connection') RETURNING id`,[f.household])).rows[0]!.id;
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[f.household,connection,f.display]);
  await pool.query('INSERT INTO display_setup_sources(household_id,setup_id,connection_id) VALUES($1,$2,$3)',[f.household,f.setup,connection]);
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name) VALUES($1,$2,$3,'home_assistant','Synthetic fenced calendar') RETURNING id`,[f.household,connection,f.account])).rows[0]!.id;
  const source=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,subject_household) VALUES($1,$2,'fenced-source','Synthetic fenced source',true,true) RETURNING id`,[f.household,calendar])).rows[0]!.id;
  await pool.query('INSERT INTO calendar_source_display_targets(household_id,source_id,display_id) VALUES($1,$2,$3)',[f.household,source,f.display]);
  await pool.query('INSERT INTO display_setup_calendar_sources(household_id,setup_id,source_id) VALUES($1,$2,$3)',[f.household,f.setup,source]);
  const sensor=(await pool.query<{id:string}>(`INSERT INTO home_assistant_temperature_sensors(household_id,connection_id,external_id,entity_id,identity_kind,name,enabled,target_household) VALUES($1,$2,'fenced-sensor','sensor.fenced','entity','Synthetic fenced sensor',true,true) RETURNING id`,[f.household,calendar])).rows[0]!.id;
  await pool.query('INSERT INTO home_assistant_temperature_display_targets(household_id,sensor_id,display_id) VALUES($1,$2,$3)',[f.household,sensor,f.display]);
  await pool.query('INSERT INTO display_setup_sensors(household_id,setup_id,sensor_id) VALUES($1,$2,$3)',[f.household,f.setup,sensor]);
  const album=(await pool.query<{id:string}>(`INSERT INTO media_albums(household_id,owner_membership_id,name) VALUES($1,$2,'Synthetic fenced album') RETURNING id`,[f.household,f.membership])).rows[0]!.id;
  await pool.query('INSERT INTO media_album_display_grants(household_id,album_id,display_id,can_read,can_upload) VALUES($1,$2,$3,true,true)',[f.household,album,f.display]);
  const baseline=await projection(f.cookie);assert.equal(baseline.statusCode,200,baseline.body);
  assert.ok(baseline.body.includes('Synthetic selected birthday'),'private profile and due birthday exist before the concurrent policy change');
  assert.equal(baseline.json().familyLayout.people.length,1);assert.equal(baseline.json().birthdays.entries.length,1);
  return{...f,connection,calendar,source,sensor,album};
}
type FenceFixture=Awaited<ReturnType<typeof policyFenceFixture>>;
async function withLateProjection(f:FenceFixture,change:()=>Promise<void>){
  const original=pool.query;
  let resume!:()=>void,entered!:()=>void;
  const release=new Promise<void>(resolve=>{resume=resolve;}),paused=new Promise<void>(resolve=>{entered=resolve;});
  let armed=true;
  pool.query=(async(...args:unknown[])=>{
    const result=await (original as Function).apply(pool,args);
    if(armed&&typeof args[0]==='string'&&args[0].includes('SELECT policy.message_create AND')){armed=false;entered();await release;}
    return result;
  }) as typeof pool.query;
  const pending=projection(f.cookie).then(response=>response);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.race([paused,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('late projection query did not pause')),5000);}),pending.then(response=>assert.fail(`projection completed before pause: ${response.statusCode}`))]);
    if(timer)clearTimeout(timer);await change();resume();return await pending;
  }finally{if(timer)clearTimeout(timer);resume();await pending;pool.query=original;}
}
const policyChanges:[string,(f:FenceFixture)=>Promise<unknown>][]=[
  ['setup people',f=>pool.query('DELETE FROM display_setup_people WHERE setup_id=$1',[f.setup])],
  ['profile grant',f=>pool.query('UPDATE display_person_grants SET profile_allowed=false WHERE display_id=$1',[f.display])],
  ['birthday grant',f=>pool.query('UPDATE display_person_grants SET birthday_allowed=false WHERE display_id=$1',[f.display])],
  ['setup source selection',f=>pool.query('DELETE FROM display_setup_sources WHERE setup_id=$1',[f.setup])],
  ['setup calendar selection',f=>pool.query('DELETE FROM display_setup_calendar_sources WHERE setup_id=$1',[f.setup])],
  ['setup sensor selection',f=>pool.query('DELETE FROM display_setup_sensors WHERE setup_id=$1',[f.setup])],
  ['external items',async f=>{const response=await app.inject({method:'PATCH',url:`${f.base}/${f.display}`,headers:f.headers,payload:{externalItemsEnabled:false}});assert.equal(response.statusCode,200,response.body);}],
  ['setup cards',f=>pool.query(`UPDATE display_setups SET cards='["new_message"]',card_order='["new_message"]' WHERE id=$1`,[f.setup])],
  ['setup locale and theme',f=>pool.query("UPDATE display_setups SET locale='en',theme='light' WHERE id=$1",[f.setup])],
  ['device name',f=>pool.query("UPDATE displays SET name='Synthetic renamed display' WHERE id=$1",[f.display])],
  ['connection display grant',f=>pool.query('DELETE FROM integration_connection_display_grants WHERE display_id=$1',[f.display])],
  ['calendar source display grant',f=>pool.query('DELETE FROM calendar_source_display_targets WHERE display_id=$1',[f.display])],
  ['calendar source enabled policy',f=>pool.query('UPDATE calendar_sources SET enabled=false WHERE id=$1',[f.source])],
  ['temperature display grant',f=>pool.query('DELETE FROM home_assistant_temperature_display_targets WHERE display_id=$1',[f.display])],
  ['board read grant',f=>pool.query('UPDATE display_board_read_grants SET grocery_read=false WHERE display_id=$1',[f.display])],
  ['action policy',f=>pool.query('UPDATE display_action_policies SET grocery_write=false WHERE display_id=$1',[f.display])],
  ['media display grant',f=>pool.query('UPDATE media_album_display_grants SET can_read=false WHERE display_id=$1',[f.display])],
];
for(const [name,change] of policyChanges)test(`final display policy fence rejects a late ${name} change without returning private content`,async()=>{
  const f=await policyFenceFixture();
  const denied=await withLateProjection(f,async()=>{await change(f);});
  assert.equal(denied.statusCode,409,denied.body);assert.equal(denied.json().error.code,'CONFLICT');
  assert.doesNotMatch(denied.body,/Synthetic selected birthday|familyLayout|birthdays|householdBoards/);
  assert.match(denied.headers['cache-control']??'',/no-store/);
  assert.equal((await projection(f.cookie)).statusCode,200,'policy conflict must preserve the valid credential for a fresh projection');
});
test('unchanged effective display policy permits a late read despite volatile last-seen writes',async()=>{
  const f=await policyFenceFixture();
  const allowed=await withLateProjection(f,async()=>{await pool.query('UPDATE displays SET last_seen_at=clock_timestamp() WHERE id=$1',[f.display]);});
  assert.equal(allowed.statusCode,200,allowed.body);assert.equal(allowed.json().familyLayout.people.length,1);assert.equal(allowed.json().birthdays.entries.length,1);
});

async function itemWitnessFixture(kind:'generic'|'calendar'|'temperature'='generic'){
  const f=await policyFenceFixture();
  await pool.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[f.household,f.setup,f.unselected]);
  const starts=new Date(Date.now()+60_000),ends=new Date(starts.getTime()+3_600_000);
  const metadata=kind==='calendar'?{calendar:{provider:'home_assistant',sourceId:f.source,subjectHousehold:false}}:kind==='temperature'?{temperature:{status:'current'}}:{};
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
    VALUES($1,$2,'synthetic-witness-item',$3,false,'Synthetic witnessed private item','Synthetic witnessed private body','normal',$4,$5,$6,$7,$8) RETURNING id`,[f.household,f.connection,kind==='temperature'?'observation':'event',starts,ends,JSON.stringify({observedAt:starts.toISOString(),uncertainty:'low'}),JSON.stringify(metadata),hash('synthetic-witness-item')])).rows[0]!.id;
  await pool.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[f.household,item,f.display]);
  await pool.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3),($1,$2,$4)',[f.household,item,f.selected,f.unselected]);
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3),($1,$2,$4)',[f.household,item,f.selected,f.unselected]);
  if(kind==='calendar')await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,'synthetic-witness','single',$3,'synthetic-witness-item',$4,'active',1)`,[f.household,f.source,item,hash('synthetic-witness')]);
  if(kind==='temperature')await pool.query('UPDATE home_assistant_temperature_sensors SET integration_item_id=$2 WHERE id=$1',[f.sensor,item]);
  const baseline=await projection(f.cookie);assert.equal(baseline.statusCode,200,baseline.body);assert.ok(baseline.body.includes('Synthetic witnessed private item'));
  assert.doesNotMatch(baseline.body,/acl_witness|acl_sensor_id|itemWitnesses|photoMessageWitnesses|policy_fingerprint/);
  return{...f,item};
}
type ItemFixture=Awaited<ReturnType<typeof itemWitnessFixture>>;
async function beforeFinalItemFence(f:ItemFixture,url:string,change:()=>Promise<void>,headers:Record<string,string>={}){
  const original=pool.query;let entered!:()=>void,resume!:()=>void;
  const paused=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});let armed=true;
  pool.query=(async(...args:unknown[])=>{
    if(armed&&typeof args[0]==='string'&&args[0].includes('AS item_policy_valid')){armed=false;entered();await release;}
    return await (original as Function).apply(pool,args);
  }) as typeof pool.query;
  const pending=app.inject({method:'GET',url,headers:{cookie:f.cookie,...headers}}).then(response=>response);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.race([paused,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('item response never reached final fence')),5000);}),pending.then(response=>assert.fail(`response completed before final fence: ${response.statusCode} ${response.body}`))]);
    if(timer)clearTimeout(timer);await change();resume();return await pending;
  }finally{if(timer)clearTimeout(timer);resume();try{await pending;}finally{pool.query=original;}}
}
const itemRevocations:[string,'generic'|'calendar'|'temperature',(f:ItemFixture)=>Promise<unknown>][]=[
  ['direct display target','generic',f=>pool.query('DELETE FROM integration_item_display_targets WHERE item_id=$1 AND display_id=$2',[f.item,f.display])],
  ['one person target while another still permits access','generic',f=>pool.query('DELETE FROM integration_item_person_targets WHERE item_id=$1 AND person_id=$2',[f.item,f.selected])],
  ['one calendar subject while another still permits access','calendar',f=>pool.query('DELETE FROM integration_item_person_subjects WHERE item_id=$1 AND person_id=$2',[f.item,f.selected])],
  ['temperature item person target','temperature',f=>pool.query('DELETE FROM integration_item_person_targets WHERE item_id=$1 AND person_id=$2',[f.item,f.selected])]
];
for(const [label,kind,revoke] of itemRevocations)test(`bounded projection witness rejects late ${label} revocation`,async()=>{
  const f=await itemWitnessFixture(kind);
  const response=await beforeFinalItemFence(f,'/api/v1/display/projection',async()=>{await revoke(f);});
  assert.equal(response.statusCode,409,response.body);assert.doesNotMatch(response.body,/Synthetic witnessed|Synthetic selected/);
  assert.equal((await projection(f.cookie)).statusCode,200,'the valid display cookie survives policy conflict');
});
for(const suffix of ['activities','activities/next','people/PERSON/activities','people/PERSON/activities/next'])test(`bounded witness protects display ${suffix} without invalidating an unchanged page`,async()=>{
  const f=await itemWitnessFixture('calendar');
  const url=`/api/v1/display/${suffix.replace('PERSON',f.selected)}${suffix.endsWith('/next')?'':`?from=${f.today}&to=${f.today}`}`;
  const allowed=await app.inject({method:'GET',url,headers:{cookie:f.cookie}});assert.equal(allowed.statusCode,200,allowed.body);assert.ok(allowed.body.includes('Synthetic witnessed private item'));
  const denied=await beforeFinalItemFence(f,url,async()=>{await pool.query('DELETE FROM integration_item_person_subjects WHERE item_id=$1 AND person_id=$2',[f.item,f.selected]);});
  assert.equal(denied.statusCode,409,denied.body);assert.doesNotMatch(denied.body,/Synthetic witnessed|Synthetic selected/);
});
for(const notModified of [false,true])test(`item-authorized photo ${notModified?'304':'bytes'} is fenced after its transaction releases`,async()=>{
  const f=await itemWitnessFixture();
  await pool.query('UPDATE display_person_grants SET profile_allowed=false WHERE display_id=$1',[f.display]);
  const bytes=Buffer.from('synthetic-private-profile-photo');
  await pool.query(`INSERT INTO person_profile_photos(person_id,household_id,content_sha256,original_mime,width,height,variant_96,variant_512) VALUES($1,$2,$3,'image/webp',96,96,$4,$4)`,[f.selected,f.household,hash(bytes.toString()),bytes]);
  const url=`/api/v1/display/people/${f.selected}/photo/96?v=1`;
  const allowed=await app.inject({method:'GET',url,headers:{cookie:f.cookie}});assert.equal(allowed.statusCode,200,allowed.body);assert.deepEqual(allowed.rawPayload,bytes);
  const headers:Record<string,string>=notModified?{'if-none-match':String(allowed.headers.etag)}:{};
  const denied=await beforeFinalItemFence(f,url,async()=>{await pool.query('DELETE FROM integration_item_person_targets WHERE item_id=$1 AND person_id=$2',[f.item,f.selected]);await pool.query('DELETE FROM integration_item_person_subjects WHERE item_id=$1 AND person_id=$2',[f.item,f.selected]);},headers);
  assert.equal(denied.statusCode,409,denied.body);assert.doesNotMatch(denied.body,/synthetic-private-profile-photo/);assert.equal(denied.headers.etag,undefined);assert.match(denied.headers['content-type']??'',/application\/json/);
});

test('item fence EXPLAIN stays bounded with 10000 same-display and 10000 foreign historical items',async()=>{
  const f=await itemWitnessFixture();
  const original=pool.query;let auth:{sql:string;args:unknown[]}|undefined,fence:typeof auth;
  pool.query=(async(...args:unknown[])=>{
    if(typeof args[0]==='string'&&Array.isArray(args[1])){
      if(args[0].includes('selection.value AS selections'))auth={sql:args[0],args:args[1]};
      if(args[0].includes('AS item_policy_valid'))fence={sql:args[0],args:args[1]};
    }
    return await (original as Function).apply(pool,args);
  }) as typeof pool.query;
  try{assert.equal((await projection(f.cookie)).statusCode,200);}finally{pool.query=original;}
  assert.ok(auth&&fence);assert.equal(JSON.parse(fence.args[4] as string).length,1);
  assert.doesNotMatch(auth.sql,/FROM integration_item_(?:display_targets|person_targets|person_subjects)/,'authentication has no item-history aggregate');
  const explain=async(query:{sql:string;args:unknown[]})=>(await pool.query(`EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) ${query.sql}`,query.args)).rows[0]['QUERY PLAN'][0];
  const small=await explain(fence);
  const otherHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic foreign stress household','UTC','en') RETURNING id`,[f.installation])).rows[0]!.id;
  const otherPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic foreign stress person','adult') RETURNING id`,[otherHousehold])).rows[0]!.id;
  const otherConnection=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic foreign stress connection') RETURNING id`,[otherHousehold])).rows[0]!.id;
  const otherDisplay=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic foreign stress display','en','light') RETURNING id`,[otherHousehold])).rows[0]!.id;
  const otherCalendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name) VALUES($1,$2,$3,'home_assistant','Synthetic foreign stress calendar') RETURNING id`,[otherHousehold,otherConnection,f.account])).rows[0]!.id;
  const otherSource=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name) VALUES($1,$2,'stress-source','Synthetic foreign stress source') RETURNING id`,[otherHousehold,otherCalendar])).rows[0]!.id;
  for(const [household,connection,display,person,source] of [[f.household,f.connection,f.display,f.selected,f.source],[otherHousehold,otherConnection,otherDisplay,otherPerson,otherSource]]){
    await pool.query(`WITH inserted AS (INSERT INTO integration_items(household_id,connection_id,external_id,kind,title,body,priority,source,status,withdrawn_at,request_hash)
      SELECT $1,$2,'synthetic-stress-'||n,'event','Synthetic old item','Synthetic retained history','normal','{}','withdrawn',clock_timestamp(),repeat('a',64) FROM generate_series(1,10000) n RETURNING id)
      INSERT INTO integration_item_display_targets(household_id,item_id,display_id) SELECT $1,id,$3 FROM inserted`,[household,connection,display]);
    await pool.query(`INSERT INTO integration_item_person_targets(household_id,item_id,person_id) SELECT $1,id,$2 FROM integration_items WHERE household_id=$1 AND external_id LIKE 'synthetic-stress-%'`,[household,person]);
    await pool.query(`INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) SELECT $1,id,$2 FROM integration_items WHERE household_id=$1 AND external_id LIKE 'synthetic-stress-%'`,[household,person]);
    await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) SELECT $1,$2,external_id,'single',id,external_id,repeat('b',64),'withdrawn',1 FROM integration_items WHERE household_id=$1 AND external_id LIKE 'synthetic-stress-%'`,[household,source]);
  }
  for(const table of ['integration_items','integration_item_display_targets','integration_item_person_targets','integration_item_person_subjects','calendar_occurrences'])await pool.query(`ANALYZE ${table}`);
  const large=await explain(fence),authPlan=await explain(auth);
  const watched=new Set(['integration_items','integration_item_display_targets','integration_item_person_targets','integration_item_person_subjects','calendar_occurrences']);
  const nodes=(plan:any):any[]=>[plan,...(plan.Plans??[]).flatMap(nodes)];
  const probes=nodes(large.Plan).filter(node=>watched.has(node['Relation Name']));
  assert.ok(probes.length>=4,'the actual production fence probes returned item ACLs');
  for(const probe of probes){assert.notEqual(probe['Node Type'],'Seq Scan',`${probe['Relation Name']} scanned history`);assert.ok(((probe['Actual Rows']??0)+(probe['Rows Removed by Filter']??0))*(probe['Actual Loops']??1)<=100,`${probe['Relation Name']} work exceeded returned-item bound`);}
  assert.equal(nodes(authPlan.Plan).filter(node=>watched.has(node['Relation Name'])).length,0);
  const buffers=(plan:any)=>(plan.Plan['Shared Hit Blocks']??0)+(plan.Plan['Shared Read Blocks']??0);
  assert.ok(buffers(large)<=2*buffers(small)+128,`history expanded fence buffers ${buffers(small)} -> ${buffers(large)}`);
  const unchanged=await beforeFinalItemFence(f,'/api/v1/display/projection',async()=>{await pool.query(`DELETE FROM integration_item_person_targets WHERE item_id=(SELECT id FROM integration_items WHERE household_id=$1 AND external_id='synthetic-stress-1')`,[f.household]);});
  assert.equal(unchanged.statusCode,200,unchanged.body);assert.ok(unchanged.body.includes('Synthetic witnessed private item'),'unrelated historical ACL churn must not conflict');
  const directory='.local/m3/round15/item-witness';await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(`${directory}/explain.private.json`,JSON.stringify({returnedItemCount:1,sameDisplayHistory:10000,foreignHistory:10000,small,large,authPlan,smallBuffers:buffers(small),largeBuffers:buffers(large)},null,2)+'\n',{mode:0o600});
});
test('045 occurrence reverse index is partial and migration rerun preserves the ledger',async()=>{
  const before=(await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
  const index=(await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='calendar_occurrences_item_source_idx'`)).rows[0];
  assert.ok(index);assert.match(index.indexdef,/\(integration_item_id, source_id\)/);assert.match(index.indexdef,/WHERE \(integration_item_id IS NOT NULL\)/);
  await migrate();assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,before);
});
for(const notModified of [false,true])test(`message-authorized photo ${notModified?'304':'bytes'} carries a bounded message ACL witness`,async()=>{
  const f=await itemWitnessFixture();
  await pool.query('UPDATE display_person_grants SET profile_allowed=false WHERE display_id=$1',[f.display]);
  await pool.query(`UPDATE display_setups SET cards='["household_messages"]',card_order='["household_messages"]' WHERE id=$1`,[f.setup]);
  const author=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,person_id,role_preset,capabilities) VALUES($1,$2,'limited','["household.view"]') RETURNING id`,[f.household,f.selected])).rows[0]!.id;
  const message=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic author-only photo message','normal',true,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','published','synthetic-photo-witness',clock_timestamp()) RETURNING id`,[f.household,author])).rows[0]!.id;
  await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'delivered')`,[f.household,message,f.display]);
  const bytes=Buffer.from('synthetic-message-author-profile-photo');
  await pool.query(`INSERT INTO person_profile_photos(person_id,household_id,content_sha256,original_mime,width,height,variant_96,variant_512) VALUES($1,$2,$3,'image/webp',96,96,$4,$4)`,[f.selected,f.household,hash(bytes.toString()),bytes]);
  const url=`/api/v1/display/people/${f.selected}/photo/96?v=1`;
  const allowed=await app.inject({method:'GET',url,headers:{cookie:f.cookie}});assert.equal(allowed.statusCode,200,allowed.body);assert.deepEqual(allowed.rawPayload,bytes);
  const headers:Record<string,string>=notModified?{'if-none-match':String(allowed.headers.etag)}:{};
  const denied=await beforeFinalItemFence(f,url,async()=>{await pool.query('DELETE FROM message_display_targets WHERE message_id=$1 AND display_id=$2',[message,f.display]);},headers);
  assert.equal(denied.statusCode,409,denied.body);assert.equal(denied.headers.etag,undefined);assert.doesNotMatch(denied.body,/synthetic-message-author-profile-photo/);
});
for(const transient of ['connection','sensor-target','sensor-reader'] as const)test(`same-statement witness rejects a transient ${transient} grant even when initial and final global policy match`,async()=>{
  const f=await itemWitnessFixture(transient==='connection'?'generic':'temperature');
  if(transient==='connection')await pool.query('DELETE FROM integration_connection_display_grants WHERE display_id=$1 AND connection_id=$2',[f.display,f.connection]);
  if(transient==='sensor-target')await pool.query('DELETE FROM home_assistant_temperature_display_targets WHERE display_id=$1 AND sensor_id=$2',[f.display,f.sensor]);
  if(transient==='sensor-reader')await pool.query('UPDATE home_assistant_temperature_sensors SET target_household=false WHERE id=$1',[f.sensor]);
  const original=pool.query;let armed=true;
  const mutate=async(add:boolean)=>{
    if(transient==='connection')return (original as Function).call(pool,add?'INSERT INTO integration_connection_display_grants(household_id,display_id,connection_id) VALUES($1,$2,$3)':'DELETE FROM integration_connection_display_grants WHERE household_id=$1 AND display_id=$2 AND connection_id=$3',[f.household,f.display,f.connection]);
    if(transient==='sensor-target')return (original as Function).call(pool,add?'INSERT INTO home_assistant_temperature_display_targets(household_id,display_id,sensor_id) VALUES($1,$2,$3)':'DELETE FROM home_assistant_temperature_display_targets WHERE household_id=$1 AND display_id=$2 AND sensor_id=$3',[f.household,f.display,f.sensor]);
    return (original as Function).call(pool,add?'INSERT INTO home_assistant_temperature_person_readers(household_id,person_id,sensor_id) VALUES($1,$2,$3)':'DELETE FROM home_assistant_temperature_person_readers WHERE household_id=$1 AND person_id=$2 AND sensor_id=$3',[f.household,f.selected,f.sensor]);
  };
  pool.query=(async(...args:unknown[])=>{
    const sql=args[0];
    const selected=typeof sql==='string'&&sql.includes(' AS acl_witness')&&!sql.includes('AS item_policy_valid')&&(transient==='connection'?sql.includes('FROM integration_items i')&&sql.includes('LIMIT 200')&&!sql.includes('acl_sensor_id'):sql.includes('sensor.id AS acl_sensor_id'));
    if(armed&&selected){armed=false;await mutate(true);try{return await (original as Function).apply(pool,args);}finally{await mutate(false);}}
    return await (original as Function).apply(pool,args);
  }) as typeof pool.query;
  try{const denied=await projection(f.cookie);assert.equal(armed,false,'the actual content SELECT must run during the transient grant');assert.equal(denied.statusCode,409,denied.body);assert.doesNotMatch(denied.body,/Synthetic witnessed private/);}finally{pool.query=original;}
});

async function messageSchoolFixture(options:{ordinaryMessage?:boolean}={}){
  const f=await policyFenceFixture();
  const messageBody=options.ordinaryMessage?'Synthetic witnessed ordinary message':'Synthetic witnessed school message';
  const message=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,$2,$3,'attention',false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour','published','synthetic-message-school-witness',clock_timestamp()) RETURNING id`,[f.household,f.membership,messageBody])).rows[0]!.id;
  await pool.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3),($1,$2,$4)',[f.household,message,f.selected,f.unselected]);
  await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'queued')`,[f.household,message,f.display]);
  const task=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,revision,approved_revision,presentation_kind)
    VALUES($1,$2,'Synthetic school witness task','Keep synthetic source-supported school reminders.','https://school-witness.test.invalid/plan','["web.open"]','active',60,0,'08:00','default','routine',1,1,'school') RETURNING id`,[f.household,f.membership])).rows[0]!.id;
  if(options.ordinaryMessage)await pool.query('UPDATE monitor_tasks SET presentation_kind=NULL WHERE id=$1',[task]);
  await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3),($1,$2,$4)',[f.household,task,f.selected,f.unselected]);
  const event=(await pool.query<{id:string}>(`INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_type,description,actions,evidence,confidence,source_fingerprint,message_id,school_expires_at)
    VALUES($1,$2,'synthetic-school-witness',$3,'preparation','Synthetic witnessed school event','["Bring synthetic boots."]',$4,0.9,$5,$6,clock_timestamp()+interval '30 minutes') RETURNING id`,[f.household,task,f.today,JSON.stringify({quote:'Bring synthetic boots.',sourceUrl:'https://school-witness.test.invalid/plan'}),hash('school-witness'),message])).rows[0]!.id;
  return{...f,message,task,event,messageBody};
}
type MessageSchoolFixture=Awaited<ReturnType<typeof messageSchoolFixture>>;
async function afterMessageSchoolSelect(f:MessageSchoolFixture,url:string,school:boolean,change:()=>Promise<void>){
  const original=pool.query;let resume!:()=>void,entered!:()=>void,armed=true;
  const paused=new Promise<void>(resolve=>{entered=resolve;}),release=new Promise<void>(resolve=>{resume=resolve;});
  pool.query=(async(...args:unknown[])=>{
    const result=await (original as Function).apply(pool,args);const sql=args[0];
    const selected=typeof sql==='string'&&!sql.includes('AS item_policy_valid')&&(school?sql.includes('FROM monitor_events event')&&sql.includes('AS acl_witness'):sql.includes('AS acl_witness,m.id,m.body'));
    if(armed&&selected){armed=false;entered();await release;}
    return result;
  }) as typeof pool.query;
  const pending=app.inject({method:'GET',url,headers:{cookie:f.cookie}}).then(response=>response);let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.race([paused,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('content SELECT was not paused')),5000);}),pending.then(response=>assert.fail(`read completed before content SELECT pause: ${response.statusCode} ${response.body}`))]);
    if(timer)clearTimeout(timer);await change();resume();return await pending;
  }finally{if(timer)clearTimeout(timer);resume();try{await pending;}finally{pool.query=original;}}
}
for(const change of ['target','audience','state'] as const)test(`message card content SELECT witness rejects late ${change} revocation`,async()=>{
  const f=await messageSchoolFixture({ordinaryMessage:true});const allowed=await projection(f.cookie);assert.equal(allowed.statusCode,200,allowed.body);assert.ok(allowed.body.includes(f.messageBody));
  const denied=await afterMessageSchoolSelect(f,'/api/v1/display/projection',false,async()=>{
    if(change==='target')await pool.query('DELETE FROM message_display_targets WHERE message_id=$1 AND display_id=$2',[f.message,f.display]);
    if(change==='audience')await pool.query('DELETE FROM message_person_audiences WHERE message_id=$1 AND person_id=$2',[f.message,f.selected]);
    if(change==='state')await pool.query("UPDATE messages SET state='withdrawn',ended_at=clock_timestamp() WHERE id=$1",[f.message]);
  });
  assert.equal(denied.statusCode,409,denied.body);assert.ok(!denied.body.includes(f.messageBody));assert.equal(denied.headers.etag,undefined);assert.match(denied.headers['content-type']??'',/application\/json/);
  const fresh=await projection(f.cookie);assert.equal(fresh.statusCode,200,fresh.body);assert.ok(!fresh.body.includes(f.messageBody));
});
for(const [suffix,change] of [
  ['activities','owner'],['activities/next','subject'],['people/PERSON/activities','target'],['people/PERSON/activities/next','audience'],
  ['people/PERSON/school-activities/EVENT','owner'],['people/PERSON/school-activities/EVENT','subject']
] as const)test(`school ${suffix} same-content witness rejects late ${change} revocation`,async()=>{
  const f=await messageSchoolFixture();
  if(suffix==='activities/next')await pool.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[f.household,f.setup,f.unselected]);
  const url=`/api/v1/display/${suffix.replace('PERSON',f.selected).replace('EVENT',f.event)}${suffix.endsWith('activities')?`?from=${f.today}&to=${f.today}`:''}`;
  const allowed=await app.inject({method:'GET',url,headers:{cookie:f.cookie}});assert.equal(allowed.statusCode,200,allowed.body);assert.ok(allowed.body.includes('Synthetic witnessed school event'));
  const denied=await afterMessageSchoolSelect(f,url,true,async()=>{
    if(change==='owner')await pool.query("UPDATE memberships SET capabilities='[\"household.view\"]' WHERE id=$1",[f.membership]);
    if(change==='subject')await pool.query('DELETE FROM monitor_task_subjects WHERE task_id=$1 AND person_id=$2',[f.task,f.selected]);
    if(change==='target')await pool.query("UPDATE message_display_targets SET delivery_state='failed',failure_code='SYNTHETIC_REVOKE' WHERE message_id=$1 AND display_id=$2",[f.message,f.display]);
    if(change==='audience')await pool.query('DELETE FROM message_person_audiences WHERE message_id=$1 AND person_id=$2',[f.message,f.selected]);
  });
  assert.equal(denied.statusCode,409,denied.body);assert.doesNotMatch(denied.body,/Synthetic witnessed school/);assert.equal(denied.headers.etag,undefined);
  const fresh=await app.inject({method:'GET',url,headers:{cookie:f.cookie}});
  if(suffix.includes('school-activities'))assert.equal(fresh.statusCode,404,fresh.body);
  else{assert.equal(fresh.statusCode,200,fresh.body);if(suffix==='activities/next'&&change==='subject'){assert.deepEqual(fresh.json().activity.personIds,[f.unselected]);}else assert.ok(!fresh.body.includes('Synthetic witnessed school event'));}
});
test('expired school history remains authorized while current detail and Next stay empty',async()=>{
  const f=await messageSchoolFixture();await pool.query("UPDATE monitor_events SET school_expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[f.event]);
  await pool.query("UPDATE messages SET expires_at=clock_timestamp()-interval '1 second',state='expired' WHERE id=$1",[f.message]);
  const history=await app.inject({method:'GET',url:`/api/v1/display/activities?from=${f.today}&to=${f.today}`,headers:{cookie:f.cookie}});assert.equal(history.statusCode,200,history.body);assert.ok(history.body.includes('Synthetic witnessed school event'));
  const next=await app.inject({method:'GET',url:'/api/v1/display/activities/next',headers:{cookie:f.cookie}});assert.equal(next.statusCode,200,next.body);assert.equal(next.json().activity,null);
  const detail=await app.inject({method:'GET',url:`/api/v1/display/people/${f.selected}/school-activities/${f.event}`,headers:{cookie:f.cookie}});assert.equal(detail.statusCode,404,detail.body);
});
test('projection caps messages at200 by existing priority order and leaves omitted delivery targets queued',async()=>{
  const f=await fixture();
  await pool.query(`WITH messages AS (INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    SELECT $1,$2,'Synthetic priority message '||n,CASE WHEN n=205 THEN 'attention' ELSE 'normal' END,true,clock_timestamp()-n*interval '1 second',clock_timestamp()+interval '1 hour','published','synthetic-cap-'||n,clock_timestamp() FROM generate_series(1,205) n RETURNING id)
    INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) SELECT $1,id,$3,'queued' FROM messages`,[f.household,f.membership,f.display]);
  const response=await projection(f.cookie);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().cards.length,200);assert.equal(response.json().cards[0].body,'Synthetic priority message 205');assert.equal(response.json().cards[1].body,'Synthetic priority message 204');
  assert.doesNotMatch(response.body,/acl_witness|messageWitnesses|schoolWitnesses|school_policy_valid/);
  assert.deepEqual((await pool.query('SELECT delivery_state,count(*)::int AS n FROM message_display_targets WHERE display_id=$1 GROUP BY delivery_state ORDER BY delivery_state',[f.display])).rows,[{delivery_state:'delivered',n:200},{delivery_state:'queued',n:5}]);
});
