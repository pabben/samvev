import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {displaySetupCards} from '@samvev/contracts';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {localDateInTimezone} from './people/domain.ts';

const origin='https://round13-display-backend.test.invalid';
let app:FastifyInstance,householdId:string,ownerCookie:string,csrf:string,ownerAccountId:string,ownerMembershipId:string,ownerSessionId:string,childId:string,hiddenPersonId:string,setupId:string,displayId:string,displayCookie:string,secondDisplayId:string,secondDisplayCookie:string,schoolTaskId:string,schoolEventId:string,schoolMessageId:string;
let connectionId:string,sourceA:string,sourceB:string,albumId:string,assetId:string,assetRevision:number;
function cookie(response:LightMyRequestResponse){const value=response.headers['set-cookie'];return(Array.isArray(value)?value:value?[value]:[]).map((item)=>item.split(';')[0]).join('; ');}
function adminHeaders(){return{cookie:ownerCookie,'x-csrf-token':csrf,origin};}
function day(value:string,offset:number){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
function hash(value:string){return createHash('sha256').update(value).digest('hex');}
function previewTag(sourceId:string){return Buffer.from(JSON.stringify({cards:displaySetupCards.filter((card)=>card!=='family_layout'),familyLayoutEnabled:false,allSources:false,allSensors:false,personIds:[childId],sourceIds:[connectionId],calendarSourceIds:[sourceId],sensorIds:[],albumIds:[],backgroundId:null})).toString('base64url');}
function profileTag(){return Buffer.from(JSON.stringify({cards:displaySetupCards,familyLayoutEnabled:true,allSources:false,allSensors:false,personIds:[childId],sourceIds:[],calendarSourceIds:[],sensorIds:[],albumIds:[],backgroundId:null})).toString('base64url');}
async function waitForBlockedQuery(fragment:string,count=1){const deadline=Date.now()+4_000;while(Date.now()<deadline){const state=await pool.query<{waiting:number}>(`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1`,[`%${fragment}%`]);if(state.rows[0]!.waiting>=count)return;await new Promise((resolve)=>setTimeout(resolve,20));}assert.fail(`timed out waiting for ${count} blocked queries containing ${fragment}`);}
async function pair(name:string){
  const verifier=`${name}-display-verifier-0123456789`;
  const started=await app.inject({method:'POST',url:'/api/v1/display/pairing/start',headers:{origin},payload:{verifierHash:hash(verifier)}});assert.equal(started.statusCode,201,started.body);
  const approved=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/pairing/approve`,headers:adminHeaders(),payload:{code:started.json().code,name,setupId,locale:'en',theme:'light',privacyMode:false,allowedContent:'household_messages'}});assert.equal(approved.statusCode,201,approved.body);
  const redeemed=await app.inject({method:'POST',url:'/api/v1/display/pairing/redeem',headers:{origin},payload:{pairingId:started.json().pairingId,verifier}});assert.equal(redeemed.statusCode,200,redeemed.body);
  return{id:approved.json().displayId as string,cookie:cookie(redeemed)};
}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Round 13 display backend tests refuse a non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic display manager',email:'round13-display-manager@test.invalid',password:'Synthetic-display-manager-password-42'},household:{name:'Synthetic display household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);ownerCookie=cookie(claim);csrf=claim.json().csrfToken;householdId=claim.json().householdId;
  ownerMembershipId=claim.json().membershipId;ownerAccountId=(await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1',[ownerMembershipId])).rows[0]!.account_id;ownerSessionId=(await pool.query<{id:string}>('SELECT id FROM sessions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1',[ownerAccountId])).rows[0]!.id;
  childId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic selected person','child') RETURNING id`,[householdId])).rows[0]!.id;
  hiddenPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic unselected person','child') RETURNING id`,[householdId])).rows[0]!.id;
  const album=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/media/albums`,headers:adminHeaders(),payload:{name:'Synthetic display album',kind:'photos'}});assert.equal(album.statusCode,201,album.body);albumId=album.json().id;
  const upload=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/media/albums/${albumId}/assets`,headers:adminHeaders(),payload:{title:'Synthetic image',description:'',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='}});assert.equal(upload.statusCode,201,upload.body);assetId=upload.json().asset.id;assetRevision=upload.json().asset.revision;
  const integration=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic calendar connection') RETURNING id`,[householdId])).rows[0]!;connectionId=integration.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state) VALUES($1,$2,$3,'ics','Synthetic calendar','connected') RETURNING id`,[householdId,connectionId,ownerAccountId])).rows[0]!;
  sourceA=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household,subject_household) VALUES($1,$2,'selected-source','Selected synthetic source',true,true,true) RETURNING id`,[householdId,calendar.id])).rows[0]!.id;
  sourceB=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household,subject_household) VALUES($1,$2,'hidden-source','Unselected synthetic source',true,true,true) RETURNING id`,[householdId,calendar.id])).rows[0]!.id;
  const cards=[...displaySetupCards];
  const createdSetup=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/display-setups`,headers:adminHeaders(),payload:{name:'Synthetic selected setup',cards,cardOrder:[...cards].reverse(),familyLayoutEnabled:true,allSources:false,allSensors:false,personIds:[childId],sourceIds:[],calendarSourceIds:[sourceA],sensorIds:[],albumIds:[albumId],backgroundId:null,locale:'nb',theme:'dark'}});assert.equal(createdSetup.statusCode,201,createdSetup.body);setupId=createdSetup.json().id;
  const first=await pair('Synthetic first device');displayId=first.id;displayCookie=first.cookie;
  const second=await pair('Synthetic second device');secondDisplayId=second.id;secondDisplayCookie=second.cookie;
  await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{externalItemsEnabled:true}});
  await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/media/albums/${albumId}/displays/${displayId}`,headers:adminHeaders(),payload:{expectedRevision:null,canRead:true,canUpload:false}});
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[householdId,connectionId,displayId]);
  const timezone=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[householdId])).rows[0]!.timezone;const tomorrow=day(localDateInTimezone(new Date(),timezone),1);
  for(let index=0;index<205;index++){
    const externalId=`round13-visible-${String(index).padStart(3,'0')}`;const startsAt=new Date(`${tomorrow}T08:00:00Z`).getTime()+index*60_000;
    const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,publish_at,expires_at,source,metadata,request_hash)
      VALUES($1,$2,$3,'event',true,$4,'Synthetic chronology detail','normal',$5,$6,clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days',$7,$8,$9) RETURNING id`,[householdId,connectionId,externalId,'Synthetic selected event '+index,new Date(startsAt).toISOString(),new Date(startsAt+30*60_000).toISOString(),JSON.stringify({observedAt:new Date().toISOString(),uncertainty:'low'}),JSON.stringify({calendar:{provider:'ics',sourceId:'selected-source',subjectHousehold:true}}),hash(externalId)])).rows[0]!;
    await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,'instance-1',$4,$3,$5,'active',1)`,[householdId,sourceA,externalId,item.id,hash('fingerprint-'+externalId)]);
    await pool.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[householdId,item.id,displayId]);
  }
  const hiddenId='round13-hidden-calendar-item';
  const hidden=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,publish_at,expires_at,source,metadata,request_hash)
    VALUES($1,$2,$3,'event',true,'Synthetic hidden-source event','Synthetic hidden detail','normal',$4,$5,clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days',$6,$7,$8) RETURNING id`,[householdId,connectionId,hiddenId,new Date(`${tomorrow}T07:00:00Z`).toISOString(),new Date(`${tomorrow}T07:30:00Z`).toISOString(),JSON.stringify({observedAt:new Date().toISOString(),uncertainty:'low'}),JSON.stringify({calendar:{provider:'ics',sourceId:'hidden-source',subjectHousehold:true}}),hash(hiddenId)])).rows[0]!;
  await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,'instance-1',$4,$3,$5,'active',1)`,[householdId,sourceB,hiddenId,hidden.id,hash('fingerprint-'+hiddenId)]);
  await pool.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[householdId,hidden.id,displayId]);
  await pool.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,hidden.id,childId]);
  const calendarStart=new Date(`${day(localDateInTimezone(new Date(),timezone),1)}T08:00:00Z`),schoolDate=localDateInTimezone(calendarStart,timezone),schoolTime=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(calendarStart);
  schoolTaskId=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,revision,approved_revision,last_changed_at,last_result,presentation_kind,school_end_local_time)
    VALUES($1,$2,'Synthetic school task','Synthetic instruction must remain private and is not display content.','https://school.test.invalid/source','active',60,0,'08:00','default','routine',1,1,clock_timestamp(),'synthetic saved result','school','15:00') RETURNING id`,[householdId,ownerMembershipId])).rows[0]!.id;
  await pool.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3),($1,$2,$4)',[householdId,schoolTaskId,childId,hiddenPersonId]);
  schoolMessageId=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,$2,'Synthetic saved school notice','normal',false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '3 days','published','round13-display-school-'||$3::text,clock_timestamp()) RETURNING id`,[householdId,ownerMembershipId,randomUUID()])).rows[0]!.id;
  await pool.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[householdId,schoolMessageId,childId]);
  await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'queued')`,[householdId,schoolMessageId,displayId]);
  schoolEventId=(await pool.query<{id:string}>(`INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_time,event_type,description,actions,applies_to,evidence,confidence,uncertainty,source_fingerprint,message_id,school_expires_at)
    VALUES($1,$2,'synthetic-display-school',$3,$4::time,'preparation','Synthetic saved school event','["Pack synthetic item"]','[]',$5,0.9,NULL,'synthetic-display-school-fingerprint',$6,clock_timestamp()+interval '2 days') RETURNING id`,[householdId,schoolTaskId,schoolDate,schoolTime,JSON.stringify({sourceUrl:'https://school.test.invalid/event',quote:'Synthetic saved evidence'}),schoolMessageId])).rows[0]!.id;
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,fingerprint,checked_at,ai_called,run_kind,result_kind,result,source_url)
    VALUES($1,1,'changed','synthetic-display-school-fingerprint',clock_timestamp()-interval '1 day',false,'scheduled','events',$2,'https://school.test.invalid/source')`,[schoolTaskId,JSON.stringify({version:1,events:[{date:schoolDate,actions:['Pack synthetic item']} ]})]);
  await pool.query(`UPDATE displays SET last_seen_at='2001-01-01T00:00:00Z' WHERE id=$1`,[displayId]);
});
after(async()=>{await app.close();await pool.end();});

test('migration and APIs allow fourteen ordered cards including new_message while action reads stay default-deny',async()=>{
  const setup=(await pool.query<{cards:string[];card_order:string[]}>('SELECT cards,card_order FROM display_setups WHERE id=$1',[setupId])).rows[0]!;
  assert.equal(setup.cards.length,14);assert.equal(setup.cards.includes('new_message'),true);assert.equal(setup.card_order.length,14);
  const policy=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/displays/${displayId}/action-policy`,headers:adminHeaders()});assert.equal(policy.statusCode,200,policy.body);assert.equal(policy.json().revision,1);assert.equal(policy.json().messageCreate,false);assert.deepEqual(policy.json().personIds,[]);assert.deepEqual(policy.json().displayIds,[]);
  const unrelated=(await pool.query<{id:string}>('INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,\'Synthetic unrelated household\',\'UTC\',\'en\' FROM households WHERE id=$1 RETURNING id',[householdId])).rows[0]!;
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${unrelated.id}/displays/${displayId}/action-policy`,headers:adminHeaders()})).statusCode,404);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/displays/${displayId}/action-policy`,headers:{cookie:displayCookie}})).statusCode,401);
});

test('device activity uses bounded chronology and intersects setup sources with per-device external grants',async()=>{
  const timezone=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[householdId])).rows[0]!.timezone;const today=localDateInTimezone(new Date(),timezone),to=day(today,6);
  const list=async(cookieHeader:string)=>{
    const all:any[]=[];let cursor:string|undefined;
    do{const response=await app.inject({method:'GET',url:`/api/v1/display/activities?from=${today}&to=${to}&limit=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,headers:{cookie:cookieHeader}});assert.equal(response.statusCode,200,response.body);all.push(...response.json().activities);cursor=response.json().nextCursor??undefined;}while(cursor);
    return all;
  };
  const first=await list(displayCookie);assert.equal(first.length,206);assert.equal(first.filter((row)=>row.type==='calendar').length,205);assert.ok(first.filter((row)=>row.type==='calendar').every((row)=>row.title.startsWith('Synthetic selected event')));assert.equal(first.some((row)=>row.id==='round13-hidden-calendar-item'),false);assert.ok(first.some((row)=>row.type==='school'&&row.id===schoolEventId));
  const second=await list(secondDisplayCookie);assert.equal(second.length,0,'a second device paired to the same setup inherits no source or item grants');
  const next=await app.inject({method:'GET',url:'/api/v1/display/activities/next',headers:{cookie:displayCookie}});assert.equal(next.statusCode,200,next.body);assert.ok(next.json().activity);
  const personWeek=await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/activities?from=${today}&to=${to}&limit=50`,headers:{cookie:displayCookie}});assert.equal(personWeek.statusCode,200,personWeek.body);assert.equal(personWeek.json().activities.length,50);assert.ok(personWeek.json().nextCursor);
  const personNext=await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/activities/next`,headers:{cookie:displayCookie}});assert.equal(personNext.statusCode,200,personNext.body);assert.ok(personNext.json().activity);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/display/people/${randomUUID()}/activities?from=${today}&to=${to}`,headers:{cookie:displayCookie}})).statusCode,404);
});

test('native school chronology follows message ACL and task authority independently of external opt-in',async()=>{
  const timezone=(await pool.query<{timezone:string}>('SELECT timezone FROM households WHERE id=$1',[householdId])).rows[0]!.timezone;
  const schoolAt=(await pool.query<{event_date:string}>('SELECT event_date::text FROM monitor_events WHERE id=$1',[schoolEventId])).rows[0]!.event_date,from=schoolAt,through=schoolAt;
  const first=await app.inject({method:'GET',url:`/api/v1/display/activities?from=${from}&to=${through}&limit=1`,headers:{cookie:displayCookie}});assert.equal(first.statusCode,200,first.body);
  assert.equal(first.json().activities[0].type,'calendar');assert.ok(first.json().nextCursor);
  const second=await app.inject({method:'GET',url:`/api/v1/display/activities?from=${from}&to=${through}&limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,headers:{cookie:displayCookie}});assert.equal(second.statusCode,200,second.body);assert.equal(second.json().activities[0].type,'school','school event at the same instant follows calendar rank through the merged cursor');assert.equal(second.json().activities[0].id,schoolEventId);
  const person=(await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/activities?from=${from}&to=${through}&limit=50`,headers:{cookie:displayCookie}}));assert.equal(person.statusCode,200,person.body);const saved=person.json().activities.find((row:any)=>row.type==='school');assert.equal(saved.id,schoolEventId);assert.equal(saved.actions[0],'Pack synthetic item');assert.deepEqual(saved.evidence,{sourceUrl:'https://school.test.invalid/event',quote:'Synthetic saved evidence'});assert.equal(saved.sourceUrl,'https://school.test.invalid/event');assert.equal(saved.uncertainty,null);assert.ok(!JSON.stringify(saved).includes('Synthetic instruction must remain private'));
  const detail=await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/school-activities/${schoolEventId}`,headers:{cookie:displayCookie}});assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().actions[0],'Pack synthetic item');
  assert.equal((await app.inject({method:'GET',url:`/api/v1/display/people/${hiddenPersonId}/school-activities/${schoolEventId}`,headers:{cookie:displayCookie}})).statusCode,404,'the task subject list does not override setup person selection');
  assert.equal((await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/school-activities/${schoolEventId}`,headers:{cookie:secondDisplayCookie}})).statusCode,404,'second device has no target-message grant');
  await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{externalItemsEnabled:false}});
  const noExternalOptin=await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/activities?from=${from}&to=${through}&limit=50`,headers:{cookie:displayCookie}});assert.equal(noExternalOptin.statusCode,200,noExternalOptin.body);assert.ok(noExternalOptin.json().activities.some((row:any)=>row.type==='school'&&row.id===schoolEventId));assert.equal(noExternalOptin.json().activities.some((row:any)=>row.type==='calendar'),false,'external opt-out hides calendars but not native saved school events');
  await pool.query("UPDATE memberships SET capabilities=capabilities-'message.schedule' WHERE id=$1",[ownerMembershipId]);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/school-activities/${schoolEventId}`,headers:{cookie:displayCookie}})).statusCode,404,'saved school visibility is withdrawn when the current task owner loses authority');
  await pool.query('UPDATE memberships SET capabilities=capabilities || $2::jsonb WHERE id=$1',[ownerMembershipId,JSON.stringify(['message.schedule'])]);
  await pool.query("UPDATE messages SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[schoolMessageId]);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/display/people/${childId}/school-activities/${schoolEventId}`,headers:{cookie:displayCookie}})).statusCode,404,'expired linked message is no longer readable as school history');
  await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{externalItemsEnabled:true}});
});

test('same manager preview and media grant update lock authority before the device',async()=>{
  // Separate sessions of the same account avoid serializing at session last_seen
  // before either request reaches its actual manager/device transaction.
  const mediaToken=randomUUID(),mediaCsrf=randomUUID();
  const mediaSession=(await pool.query<{id:string}>(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour') RETURNING id`,[ownerAccountId,hash(mediaToken),hash(mediaCsrf)])).rows[0]!;
  const lock=await pool.connect();let locked=false;
  let mediaUpdate:Promise<LightMyRequestResponse>|undefined,preview:Promise<LightMyRequestResponse>|undefined;
  try{
    await lock.query('BEGIN');locked=true;await lock.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[ownerAccountId]);
    // Queue the media mutation first. It will acquire the manager account before
    // the preview after release, then require the target device exclusively.
    mediaUpdate=app.inject({method:'PUT',url:`/api/v1/households/${householdId}/media/albums/${albumId}/displays/${secondDisplayId}`,headers:{cookie:`samvev_session=${mediaToken}`,'x-csrf-token':mediaCsrf,origin},payload:{expectedRevision:null,canRead:true,canUpload:false}}).then(response=>response);
    await waitForBlockedQuery('JOIN accounts account');
    preview=app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${secondDisplayId}/preview`,headers:adminHeaders(),payload:{setupId}}).then(response=>response);
    // In the former order the preview already owns device SHARE here. Once the
    // media mutation obtains manager UPDATE, that forms a real two-request cycle.
    await waitForBlockedQuery('JOIN accounts account',2);
    await lock.query('COMMIT');locked=false;
  }finally{if(locked)await lock.query('ROLLBACK');lock.release();}
  assert.ok(mediaUpdate);assert.ok(preview);
  const [updated,projected]=await Promise.all([mediaUpdate,preview]);
  assert.equal(updated.statusCode,200,updated.body);assert.equal(projected.statusCode,200,projected.body);assert.equal(projected.json().preview,true);
  assert.ok(projected.json().media.assets.some((asset:{id:string})=>asset.id===assetId),'preview sees the independently granted device album after the media transaction commits');
  const revoke=await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/media/albums/${albumId}/displays/${secondDisplayId}`,headers:adminHeaders(),payload:{expectedRevision:updated.json().revision,canRead:false,canUpload:false,revoke:true}});assert.equal(revoke.statusCode,200,revoke.body);
  await pool.query('DELETE FROM sessions WHERE id=$1',[mediaSession.id]);
});

test('admin preview is side-effect-free and image bytes remain device-grant filtered',async()=>{
  const profileUpload=await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/people/${childId}/photo`,headers:adminHeaders(),payload:{imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',expectedPhotoRevision:0}});assert.equal(profileUpload.statusCode,200,profileUpload.body);const profileRevision=profileUpload.json().photoRevision;
  const message=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,(SELECT id FROM memberships WHERE household_id=$1 ORDER BY created_at LIMIT 1),'Synthetic preview message','normal',true,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day','published','round13-preview-'||$2::text,clock_timestamp()) RETURNING id`,[householdId,randomUUID()])).rows[0]!;
  await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'queued')`,[householdId,message.id,displayId]);
  const before=(await pool.query<{last_seen_at:Date|null;delivery_state:string}>('SELECT d.last_seen_at,t.delivery_state FROM displays d JOIN message_display_targets t ON t.display_id=d.id WHERE d.id=$1 AND t.message_id=$2',[displayId,message.id])).rows[0]!;
  const preview=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${displayId}/preview`,headers:adminHeaders(),payload:{setupId}});assert.equal(preview.statusCode,200,preview.body);assert.equal(preview.json().preview,true);assert.ok(preview.json().cards.some((card:{id:string})=>card.id===message.id));assert.equal('credentialHash'in preview.json(),false);assert.equal('cookie'in preview.json(),false);
  const afterPreview=(await pool.query<{last_seen_at:Date|null;delivery_state:string}>('SELECT d.last_seen_at,t.delivery_state FROM displays d JOIN message_display_targets t ON t.display_id=d.id WHERE d.id=$1 AND t.message_id=$2',[displayId,message.id])).rows[0]!;assert.equal(afterPreview.last_seen_at?.toISOString(),before.last_seen_at?.toISOString());assert.equal(afterPreview.delivery_state,'queued');
  assert.equal(preview.json().familyLayout.people.length,0,'setup selection alone does not grant profile visibility');
  const image=preview.json().media.assets.find((asset:{id:string})=>asset.id===assetId);assert.ok(image,'candidate album selection intersects the actual display read grant');
  const bytes=await app.inject({method:'GET',url:image.previewUrl,headers:adminHeaders()});assert.equal(bytes.statusCode,200);assert.match(bytes.headers['content-type']??'',/image\/webp/);
  await app.inject({method:'PUT',url:`/api/v1/households/${householdId}/media/albums/${albumId}/displays/${displayId}`,headers:adminHeaders(),payload:{expectedRevision:1,canRead:false,canUpload:false,revoke:true}});
  const deniedCache=await app.inject({method:'GET',url:image.previewUrl,headers:{...adminHeaders(),'if-none-match':bytes.headers.etag as string}});assert.equal(deniedCache.statusCode,404,'revoked media grant is checked before honoring a conditional request');
  const secondPreview=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${secondDisplayId}/preview`,headers:adminHeaders(),payload:{setupId}});assert.equal(secondPreview.statusCode,200,secondPreview.body);assert.equal(secondPreview.json().media.assets.length,0,'shared setup choices do not copy actual device media grants');
  const draft=(sourceId:string)=>({draft:{name:'Synthetic draft preview',cards:displaySetupCards.filter((card)=>card!=='family_layout'),cardOrder:displaySetupCards.filter((card)=>card!=='family_layout'),familyLayoutEnabled:false,allSources:false,allSensors:false,personIds:[childId],sourceIds:[connectionId],calendarSourceIds:[sourceId],sensorIds:[],albumIds:[],backgroundId:null,locale:'en',theme:'light'}});
  const narrowed=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${displayId}/preview`,headers:adminHeaders(),payload:draft(sourceA)});assert.equal(narrowed.statusCode,200,narrowed.body);assert.equal(narrowed.json().hub.people.some((person:any)=>person.id===childId),false,'preview source selector narrows the stored configuration');
  const forgedVisibility=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/displays/${displayId}/preview/people/${childId}/photo/96?v=${profileRevision}&s=${previewTag(sourceA)}`,headers:adminHeaders()});assert.equal(forgedVisibility.statusCode,404,'photo visibility does not fall back to the saved setup source');
  const selected=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${displayId}/preview`,headers:adminHeaders(),payload:draft(sourceB)});assert.equal(selected.statusCode,200,selected.body);const child=(selected.json().hub.people as Array<any>).find((person)=>person.id===childId);assert.ok(child?.photo,'different authorized draft source makes this selected person visible');
  const selectedPhoto=await app.inject({method:'GET',url:child.photo.url96,headers:adminHeaders()});assert.equal(selectedPhoto.statusCode,200,selectedPhoto.body);
  await pool.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed,birthday_allowed) VALUES($1,$2,$3,true,false)',[householdId,displayId,childId]);
  const profilePreview=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${displayId}/preview`,headers:adminHeaders(),payload:{setupId}});assert.equal(profilePreview.statusCode,200,profilePreview.body);const familyPhoto=profilePreview.json().familyLayout.people.find((person:any)=>person.id===childId)?.photo;assert.ok(familyPhoto);
  const profileLock=await pool.connect();let waitingProfile:Promise<LightMyRequestResponse>|undefined;await profileLock.query('BEGIN');await profileLock.query('LOCK TABLE person_profile_photos IN ACCESS EXCLUSIVE MODE');
  try{
    waitingProfile=app.inject({method:'GET',url:`/api/v1/households/${householdId}/displays/${displayId}/preview/people/${childId}/photo/96?v=${profileRevision}&s=${profileTag()}`,headers:adminHeaders()});
    await waitForBlockedQuery('person_profile_photos');
    await pool.query('DELETE FROM display_person_grants WHERE household_id=$1 AND display_id=$2 AND person_id=$3',[householdId,displayId,childId]);
  }finally{await profileLock.query('ROLLBACK');profileLock.release();}
  const revokedProfile=await waitingProfile!;assert.equal(revokedProfile.statusCode,404,'profile grant revoked during photo read cannot receive bytes or a cached 304');
  await pool.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed,birthday_allowed) VALUES($1,$2,$3,true,false)',[householdId,displayId,childId]);
  const actualLock=await pool.connect();let waitingActual:Promise<LightMyRequestResponse>|undefined;await actualLock.query('BEGIN');await actualLock.query('LOCK TABLE person_profile_photos IN ACCESS EXCLUSIVE MODE');
  try{
    waitingActual=app.inject({method:'GET',url:`/api/v1/display/people/${childId}/photo/96?v=${profileRevision}`,headers:{cookie:displayCookie}});
    await waitForBlockedQuery('person_profile_photos');
    await pool.query('DELETE FROM display_person_grants WHERE household_id=$1 AND display_id=$2 AND person_id=$3',[householdId,displayId,childId]);
  }finally{await actualLock.query('ROLLBACK');actualLock.release();}
  const revokedActual=await waitingActual!;assert.equal(revokedActual.statusCode,404,'actual display profile image is also fenced after a blocked read');
  await pool.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed,birthday_allowed) VALUES($1,$2,$3,true,false)',[householdId,secondDisplayId,childId]);
  const expiryLock=await pool.connect();let waitingExpiry:Promise<LightMyRequestResponse>|undefined;await expiryLock.query('BEGIN');await expiryLock.query('LOCK TABLE person_profile_photos IN ACCESS EXCLUSIVE MODE');
  try{
    waitingExpiry=app.inject({method:'GET',url:`/api/v1/households/${householdId}/displays/${secondDisplayId}/preview/people/${childId}/photo/96?v=${profileRevision}&s=${profileTag()}`,headers:adminHeaders()});
    await waitForBlockedQuery('person_profile_photos');
    await pool.query("UPDATE displays SET credential_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[secondDisplayId]);
  }finally{await expiryLock.query('ROLLBACK');expiryLock.release();}
  const expiredDevice=await waitingExpiry!;assert.equal(expiredDevice.statusCode,404,'device expiry during a blocked preview image read is enforced before bytes or 304');
  const photoLock=await pool.connect();let waitingPhoto:Promise<LightMyRequestResponse>|undefined;await photoLock.query('BEGIN');await photoLock.query('LOCK TABLE person_profile_photos IN ACCESS EXCLUSIVE MODE');
  try{
    waitingPhoto=app.inject({method:'GET',url:`/api/v1/households/${householdId}/displays/${displayId}/preview/people/${childId}/photo/96?v=${profileRevision}&s=${previewTag(sourceB)}`,headers:adminHeaders()});
    await waitForBlockedQuery('person_profile_photos');
    await pool.query('DELETE FROM integration_connection_display_grants WHERE household_id=$1 AND connection_id=$2 AND display_id=$3',[householdId,connectionId,displayId]);
  }finally{await photoLock.query('ROLLBACK');photoLock.release();}
  const revokedDuringRead=await waitingPhoto!;assert.equal(revokedDuringRead.statusCode,404,'current source grant is rechecked after a blocked photo read and before conditional responses');
  const messageLock=await pool.connect();let waitingPrivacy:Promise<LightMyRequestResponse>|undefined;await messageLock.query('BEGIN');await messageLock.query('LOCK TABLE messages IN ACCESS EXCLUSIVE MODE');
  try{
    waitingPrivacy=app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${displayId}/preview`,headers:adminHeaders(),payload:{setupId}});
    await waitForBlockedQuery('FROM messages m');
    const changed=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{privacyMode:true}});assert.equal(changed.statusCode,200,changed.body);
  }finally{await messageLock.query('ROLLBACK');messageLock.release();}
  const stalePrivacy=await waitingPrivacy!;assert.equal(stalePrivacy.statusCode,404,'privacy change during awaited preview work invalidates the completed projection');
  const privacyRestored=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{privacyMode:false}});assert.equal(privacyRestored.statusCode,200,privacyRestored.body);
  const managerLock=await pool.connect();let waitingManager:Promise<LightMyRequestResponse>|undefined;await managerLock.query('BEGIN');await managerLock.query('LOCK TABLE messages IN ACCESS EXCLUSIVE MODE');
  try{
    waitingManager=app.inject({method:'POST',url:`/api/v1/households/${householdId}/displays/${displayId}/preview`,headers:adminHeaders(),payload:{setupId}});
    await waitForBlockedQuery('FROM messages m');
    await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[ownerSessionId]);
  }finally{await managerLock.query('ROLLBACK');managerLock.release();}
  const staleManager=await waitingManager!;assert.equal(staleManager.statusCode,401,'manager session expiry during awaited preview work invalidates the completed projection');
});
