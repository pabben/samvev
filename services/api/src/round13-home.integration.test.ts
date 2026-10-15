import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {createHash} from 'node:crypto';
import {roleCapabilityPresets} from '@samvev/contracts';
import {hashPassword} from '@samvev/core';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {localDateInTimezone} from './people/domain.ts';

interface Session{cookie:string;csrf:string;personId:string;membershipId:string;accountId:string;}
const origin='https://samvev-round13-home.test.invalid';
let app:FastifyInstance,householdId:string,installationId:string,owner:Session,viewer:Session,childId:string,sharedSubjectId:string;
function cookie(response:LightMyRequestResponse):string{const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map((item)=>item.split(';')[0]).join('; ');}
function headers(session:Session){return{cookie:session.cookie,'x-csrf-token':session.csrf,origin};}
function nextDate(value:string,days:number){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function monday(value:string){const day=new Date(`${value}T00:00:00Z`).getUTCDay();return nextDate(value,-((day+6)%7));}
function birthDateFor(value:string,year=2010){return`${year}${value.slice(4)}`;}
async function addCalendarItem(input:{externalId:string;title:string;startsAt:string;endsAt:string|null;targetHousehold:boolean;targetPersonId?:string;subjectPersonId?:string;generic?:boolean}){
  const connectionId=(await pool.query<{id:string}>(`SELECT id FROM integration_connections WHERE household_id=$1 LIMIT 1`,[householdId])).rows[0]!.id;
  const digest=createHash('sha256').update(input.externalId).digest('hex');
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,publish_at,expires_at,source,metadata,request_hash)
    VALUES($1,$2,$3,'event',$4,$5,'Synthetic calendar detail','normal',$6,$7,clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days',$8,$9,$10) RETURNING id`,[householdId,connectionId,input.externalId,input.targetHousehold,input.title,input.startsAt,input.endsAt,JSON.stringify({observedAt:new Date().toISOString(),uncertainty:'low'}),JSON.stringify(input.generic?{}:{calendar:{provider:'synthetic',sourceId:'synthetic-source',subjectHousehold:input.targetHousehold}}),digest])).rows[0]!;
  if(input.targetPersonId)await pool.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item.id,input.targetPersonId]);
  if(input.subjectPersonId)await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item.id,input.subjectPersonId]);
  return item.id;
}
async function attachCalendarSource(itemId:string,sourceKey:string){
  let calendar=(await pool.query<{id:string}>(`SELECT id FROM calendar_connections WHERE household_id=$1 ORDER BY id LIMIT 1`,[householdId])).rows[0];
  if(!calendar){const connection=(await pool.query<{id:string}>(`SELECT id FROM integration_connections WHERE household_id=$1 ORDER BY id LIMIT 1`,[householdId])).rows[0]!;calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name) VALUES($1,$2,$3,'ics','Synthetic calendar source') RETURNING id`,[householdId,connection.id,owner.accountId])).rows[0]!;}
  const source=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled) VALUES($1,$2,$3,$3,true) RETURNING id`,[householdId,calendar.id,sourceKey])).rows[0]!;
  await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,'instance-1',$4,$3,$5,'active',1)`,[householdId,source.id,sourceKey,itemId,createHash('sha256').update(sourceKey).digest('hex')]);
  return source.id;
}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Round 13 Home integration refuses a non-isolated test database');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic Home owner',email:'round13-home-owner@test.invalid',password:'Synthetic-home-owner-password-42'},household:{name:'Synthetic Home household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;owner={cookie:cookie(claim),csrf:claim.json().csrfToken,personId:'',membershipId:claim.json().membershipId,accountId:''};
  const ownerRow=(await pool.query<{person_id:string;account_id:string}>('SELECT person_id,account_id FROM memberships WHERE id=$1',[owner.membershipId])).rows[0]!;owner.personId=ownerRow.person_id;owner.accountId=ownerRow.account_id;
  installationId=(await pool.query<{id:string}>('SELECT id FROM installations WHERE singleton=true')).rows[0]!.id;
  const timezone=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[householdId])).rows[0]!.timezone;const tomorrow=nextDate(localDateInTimezone(new Date(),timezone),1);
  childId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES($1,'Synthetic child','child',$2) RETURNING id`,[householdId,birthDateFor(tomorrow)])).rows[0]!.id;
  await pool.query(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic calendar')`,[householdId]);
  const viewerPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic viewer','adult') RETURNING id`,[householdId])).rows[0]!;
  const viewerAccount=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'round13-home-viewer@test.invalid',$2,'en','light') RETURNING id`,[installationId,await hashPassword('Synthetic-home-viewer-password-42')])).rows[0]!;
  const viewerMembership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'member',$4) RETURNING id`,[householdId,viewerAccount.id,viewerPerson.id,JSON.stringify(roleCapabilityPresets.member)])).rows[0]!;
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'round13-home-viewer@test.invalid',password:'Synthetic-home-viewer-password-42'}});assert.equal(login.statusCode,200,login.body);
  viewer={cookie:cookie(login),csrf:login.json().csrfToken,personId:viewerPerson.id,membershipId:viewerMembership.id,accountId:viewerAccount.id};
});
after(async()=>{await app.close();await pool.end();});

test('Home returns all due birthdays without DOB/age while dashboard retains its scalar',async()=>{
  const timezone='Europe/Oslo',today=localDateInTimezone(new Date(),timezone),tomorrow=nextDate(today,1);
  const another=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group,birth_date) VALUES($1,'Synthetic birthday today','adult',$2) RETURNING id`,[householdId,birthDateFor(today,1987)])).rows[0]!;
  await pool.query(`UPDATE households SET show_upcoming_birthday=true WHERE id=$1`,[householdId]);
  const response=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:headers(viewer)});assert.equal(response.statusCode,200,response.body);
  const home=response.json();assert.equal(home.household.localDate,today);assert.deepEqual(home.upcomingBirthdays,[
    {personId:another.id,displayName:'Synthetic birthday today',due:'today'},
    {personId:childId,displayName:'Synthetic child',due:'tomorrow'}
  ]);
  assert.ok(home.upcomingBirthdays.every((item:Record<string,unknown>)=>!('birthDate'in item)&&!('date'in item)&&!('ageTurning'in item)));
  assert.ok(!('ageTurning'in home.upcomingBirthday),'Home does not expose an inferred age');
  const dashboard=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/dashboard`,headers:headers(viewer)});assert.equal(dashboard.statusCode,200);assert.equal(typeof dashboard.json().upcomingBirthday.displayName,'string');
  await pool.query(`UPDATE households SET show_upcoming_birthday=false WHERE id=$1`,[householdId]);assert.deepEqual((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:headers(viewer)})).json().upcomingBirthdays,[]);
});

test('weekly activities page chronologically, includes overlaps, intersects reader ACL and returns one selected next item',async()=>{
  const timezone='Europe/Oslo',from=localDateInTimezone(new Date(),timezone),to=nextDate(from,6);
  const overlapId=await addCalendarItem({externalId:'synthetic-overlap',title:'Synthetic overlapping multiday',startsAt:`${nextDate(from,-1)}T10:00:00Z`,endsAt:`${nextDate(from,1)}T09:00:00Z`,targetHousehold:true});
  const firstId=await addCalendarItem({externalId:'synthetic-first',title:'Synthetic first event',startsAt:`${nextDate(from,1)}T08:00:00Z`,endsAt:`${nextDate(from,1)}T09:00:00Z`,targetHousehold:true});
  const laterId=await addCalendarItem({externalId:'synthetic-later',title:'Synthetic later event',startsAt:`${nextDate(from,1)}T08:00:00Z`,endsAt:`${nextDate(from,1)}T09:00:00Z`,targetHousehold:true,generic:true});
  await addCalendarItem({externalId:'synthetic-private',title:'Synthetic private child event',startsAt:`${nextDate(from,1)}T07:00:00Z`,endsAt:`${nextDate(from,1)}T08:00:00Z`,targetHousehold:false,targetPersonId:childId,subjectPersonId:childId});
  const unplacedButReadable=await addCalendarItem({externalId:'synthetic-subject',title:'Synthetic placed by subject',startsAt:`${nextDate(from,3)}T08:00:00Z`,endsAt:`${nextDate(from,3)}T09:00:00Z`,targetHousehold:false,targetPersonId:viewer.personId,subjectPersonId:childId});
  const secondSubject=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic shared activity subject','child') RETURNING id`,[householdId])).rows[0]!;sharedSubjectId=secondSubject.id;
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,firstId,childId]);
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,firstId,secondSubject.id]);
  const sourceId=await attachCalendarSource(firstId,'synthetic-source-first');
  const equalStart=[firstId,laterId].sort();
  const first=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${from}&to=${to}&limit=2`,headers:headers(viewer)});assert.equal(first.statusCode,200,first.body);
  assert.deepEqual(first.json().activities.map((item:any)=>item.id),[overlapId,equalStart[0]]);assert.ok(first.json().nextCursor);
  const second=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${from}&to=${to}&limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,headers:headers(viewer)});assert.equal(second.statusCode,200,second.body);
  assert.deepEqual(second.json().activities.map((item:any)=>item.id),[equalStart[1],unplacedButReadable]);assert.equal(second.json().activities.some((item:any)=>item.title==='Synthetic private child event'),false);const genericRow=[...first.json().activities,...second.json().activities].find((item:any)=>item.id===laterId);assert.deepEqual(genericRow.personIds,[],'generic target-based events remain household-visible without invented calendar subjects');assert.equal(genericRow.personId,null);
  const next=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities/next`,headers:headers(viewer)});assert.equal(next.statusCode,200,next.body);assert.equal(next.json().activity.id,overlapId,'one next activity is returned even if it overlaps today from an earlier start');
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${from}&to=${nextDate(from,7)}`,headers:headers(viewer)})).statusCode,400);
  const unrelated=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic unrelated','UTC','en') RETURNING id`,[installationId])).rows[0]!;
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${from}&to=${to}`,headers:headers(viewer)})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${unrelated.id}/people/${childId}/activities?from=${from}&to=${to}`,headers:headers(viewer)})).statusCode,404);
  const mondayWeek=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${monday(from)}&to=${nextDate(monday(from),6)}`,headers:headers(viewer)});assert.equal(mondayWeek.statusCode,200,`${mondayWeek.body}; the current household week may start before today`);
  const householdWeek=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/activities?from=${from}&to=${to}&personIds=${childId},${secondSubject.id}&limit=20`,headers:headers(viewer)});assert.equal(householdWeek.statusCode,200,householdWeek.body);const householdItems=householdWeek.json().activities;assert.equal(new Set(householdItems.map((item:any)=>item.id)).size,householdItems.length,'household aggregation deduplicates events across selected people');const householdFirst=householdItems.find((item:any)=>item.id===firstId);assert.deepEqual(householdFirst.personIds.sort(),[childId,secondSubject.id].sort(),'shared items carry every mapped person without duplicate rows');
  const sourceWeek=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/activities?from=${from}&to=${to}&personIds=${childId},${secondSubject.id}&sourceIds=${sourceId}`,headers:headers(viewer)});assert.equal(sourceWeek.statusCode,200,sourceWeek.body);assert.deepEqual(sourceWeek.json().activities.map((item:any)=>item.id),[firstId],'source filter resolves actual household calendar source IDs');assert.deepEqual(sourceWeek.json().activities[0].personIds.sort(),[childId,secondSubject.id].sort());
  const selectedNext=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/activities/next?personIds=${childId},${secondSubject.id}`,headers:headers(viewer)});assert.equal(selectedNext.statusCode,200,selectedNext.body);assert.equal(selectedNext.json().activity.id,overlapId);assert.ok(!Array.isArray(selectedNext.json().activity),'the next endpoint returns exactly one ongoing/upcoming item');
});

test('school classification controls card placement, message ACL controls reading and saved expiry stays fixed',async()=>{
  const timezone='Europe/Oslo',today=localDateInTimezone(new Date(),timezone),eventDate=nextDate(today,1);
  const task=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,revision,approved_revision,last_changed_at,last_result)
    VALUES($1,$2,'Synthetic task label','Track a verified synthetic school source.','https://school.test.invalid/source','active',60,0,'08:00','default','routine',3,3,clock_timestamp(),'one event') RETURNING id`,[householdId,owner.membershipId])).rows[0]!;
  const originalTask=(await pool.query<{state:object}>(`SELECT to_jsonb(task)-ARRAY['presentation_kind','school_end_local_time','presentation_revision','presentation_updated_at'] AS state FROM monitor_tasks task WHERE id=$1`,[task.id])).rows[0]!.state;
  await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3),($1,$2,$4)',[householdId,task.id,childId,sharedSubjectId]);
  await pool.query('INSERT INTO monitor_task_person_targets(household_id,task_id,person_id) VALUES($1,$2,$3)',[householdId,task.id,viewer.personId]);
  const notice=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,$2,'Synthetic school notice','normal',false,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '3 days','published','synthetic-school-notice',clock_timestamp()) RETURNING id`,[householdId,owner.membershipId])).rows[0]!;
  await pool.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[householdId,notice.id,viewer.personId]);
  const normal=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,$2,'Synthetic ordinary family message','normal',false,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '3 days','published','synthetic-normal-notice',clock_timestamp()) RETURNING id`,[householdId,owner.membershipId])).rows[0]!;
  await pool.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[householdId,normal.id,viewer.personId]);
  const event=(await pool.query<{id:string}>(`INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_time,event_type,description,actions,applies_to,evidence,confidence,source_fingerprint,message_id)
    VALUES($1,$2,'synthetic-school-event',$3,NULL,'preparation','Synthetic school preparation', '["Bring synthetic item"]','[]',$4,0.95,'synthetic-fingerprint',$5) RETURNING id`,[householdId,task.id,eventDate,JSON.stringify({quote:'Synthetic source evidence'}),notice.id])).rows[0]!;
  const run=(await pool.query<{id:string}>(`INSERT INTO monitor_runs(task_id,task_revision,outcome,fingerprint,checked_at,ai_called,run_kind,result_kind,result,source_url)
    VALUES($1,3,'changed','synthetic-fingerprint',clock_timestamp()-interval '2 days',false,'scheduled','events',$2,'https://school.test.invalid/source') RETURNING id`,[task.id,JSON.stringify({version:1,events:[{date:eventDate,actions:['Bring synthetic item']} ]})])).rows[0]!;
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,fingerprint,checked_at,ai_called,run_kind,result_kind,result,source_url) VALUES($1,3,'changed','unrelated-newer-fingerprint',clock_timestamp(),false,'scheduled','events',$2,'https://unrelated.test.invalid/source')`,[task.id,JSON.stringify({version:1,events:[{date:eventDate,actions:['Unrelated newer run']} ]})]);
  const denied=await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/monitors/${task.id}/presentation`,headers:headers(viewer),payload:{expectedPresentationRevision:1,presentationKind:'school',schoolEndLocalTime:'23:30'}});assert.equal(denied.statusCode,403);
  const configured=await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/monitors/${task.id}/presentation`,headers:headers(owner),payload:{expectedPresentationRevision:1,presentationKind:'school',schoolEndLocalTime:'13:45'}});assert.equal(configured.statusCode,200,configured.body);assert.equal(configured.json().presentationRevision,2);
  assert.deepEqual((await pool.query<{state:object}>(`SELECT to_jsonb(task)-ARRAY['presentation_kind','school_end_local_time','presentation_revision','presentation_updated_at'] AS state FROM monitor_tasks task WHERE id=$1`,[task.id])).rows[0]!.state,originalTask,'presentation changes leave every pre-existing approved task field untouched');
  const taskState=(await pool.query<{revision:number;approved_revision:number;state:string;last_result:string;presentation_revision:number}>('SELECT revision,approved_revision,state,last_result,presentation_revision FROM monitor_tasks WHERE id=$1',[task.id])).rows[0]!;
  assert.deepEqual(taskState,{revision:3,approved_revision:3,state:'active',last_result:'one event',presentation_revision:2});
  const expiry=(await pool.query<{school_expires_at:Date;local:Date}>('SELECT school_expires_at,school_expires_at AT TIME ZONE $2 AS local FROM monitor_events WHERE id=$1',[event.id,timezone])).rows[0]!;assert.equal(new Date(expiry.local).toISOString().slice(11,16),'13:45');
  const ownerHome=(await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:headers(owner)})).json();assert.deepEqual(ownerHome.schoolActivities.map((row:any)=>row.personId).sort(),[childId,sharedSubjectId].sort());assert.ok(!ownerHome.messages.some((message:any)=>message.id===notice.id));assert.ok(ownerHome.messages.some((message:any)=>message.id===normal.id));
  const viewerHome=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:headers(viewer)});assert.equal(viewerHome.statusCode,200);assert.ok(viewerHome.json().schoolActivities.some((row:any)=>row.personId===childId),'the parent reader sees the item on subject child cards without being a task subject or manager');assert.ok(!viewerHome.json().messages.some((message:any)=>message.id===notice.id));assert.ok(viewerHome.json().messages.some((message:any)=>message.id===normal.id));
  const weekly=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${today}&to=${nextDate(today,6)}`,headers:headers(viewer)});assert.equal(weekly.statusCode,200,weekly.body);const saved=weekly.json().activities.find((row:any)=>row.type==='school');assert.equal(saved.id,event.id);assert.equal(saved.actions[0],'Bring synthetic item');assert.equal(saved.evidence.quote,'Synthetic source evidence');assert.equal(saved.sourceUrl,'https://school.test.invalid/source','saved provenance follows the event fingerprint, not the latest unrelated task run');assert.ok(Date.parse(saved.recordedAt)<Date.now()-24*60*60*1000,'recorded time follows the matching saved run');assert.equal(saved.confidence,0.95);assert.equal(saved.uncertainty,null);
  const sharedSchoolWeek=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/activities?from=${today}&to=${nextDate(today,6)}&personIds=${childId},${sharedSubjectId}`,headers:headers(viewer)});assert.equal(sharedSchoolWeek.statusCode,200,sharedSchoolWeek.body);const sharedSchoolRows=sharedSchoolWeek.json().activities.filter((row:any)=>row.type==='school'&&row.id===event.id);assert.equal(sharedSchoolRows.length,1,'one saved school event is not duplicated for multiple subjects');assert.deepEqual(sharedSchoolRows[0].personIds.sort(),[childId,sharedSubjectId].sort());
  const beforeExpiry=(await pool.query<{expires:Date}>('SELECT school_expires_at AS expires FROM monitor_events WHERE id=$1',[event.id])).rows[0]!.expires;
  await pool.query('UPDATE monitor_events SET school_expires_at=clock_timestamp()-interval \'1 second\' WHERE id=$1',[event.id]);
  const changedMetadata=await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/monitors/${task.id}/presentation`,headers:headers(owner),payload:{expectedPresentationRevision:2,presentationKind:'school',schoolEndLocalTime:'23:59'}});assert.equal(changedMetadata.statusCode,200,changedMetadata.body);
  assert.ok((await pool.query<{school_expires_at:Date}>('SELECT school_expires_at FROM monitor_events WHERE id=$1',[event.id])).rows[0]!.school_expires_at<beforeExpiry,'presentation edits cannot extend a saved row expiry');
  const afterExpiry=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/activities?from=${today}&to=${nextDate(today,6)}`,headers:headers(viewer)});assert.equal(afterExpiry.statusCode,200);assert.equal(afterExpiry.json().activities.some((row:any)=>row.id===event.id),false);
  const schoolHistory=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/school-activities/${event.id}`,headers:headers(viewer)});assert.equal(schoolHistory.statusCode,200,schoolHistory.body);assert.equal(schoolHistory.json().actions[0],'Bring synthetic item');
  const outsiderPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic nonrecipient','adult') RETURNING id`,[householdId])).rows[0]!;
  const outsiderAccount=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'round13-home-outsider@test.invalid',$2,'en','light') RETURNING id`,[installationId,await hashPassword('Synthetic-home-outsider-password-42')])).rows[0]!;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'member',$4)`,[householdId,outsiderAccount.id,outsiderPerson.id,JSON.stringify(roleCapabilityPresets.member)]);
  const outsiderLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'round13-home-outsider@test.invalid',password:'Synthetic-home-outsider-password-42'}});assert.equal(outsiderLogin.statusCode,200,outsiderLogin.body);const outsider={cookie:cookie(outsiderLogin),csrf:outsiderLogin.json().csrfToken,personId:outsiderPerson.id,membershipId:'',accountId:outsiderAccount.id};
  const deniedHistory=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people/${childId}/school-activities/${event.id}`,headers:headers(outsider)});assert.equal(deniedHistory.statusCode,404,'expired detail history still follows the linked message reader ACL');
  const unchangedHistory=(await pool.query<{id:string;result:any}>('SELECT id,result FROM monitor_runs WHERE task_id=$1 AND id=$2',[task.id,run.id])).rows[0]!;assert.equal(unchangedHistory.id,run.id);assert.equal(unchangedHistory.result.events[0].date,eventDate);
  const changedByNonManager=await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/monitors/${task.id}/presentation`,headers:headers(viewer),payload:{expectedPresentationRevision:3,presentationKind:null,schoolEndLocalTime:null}});assert.equal(changedByNonManager.statusCode,403);
});
