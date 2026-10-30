import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import pg from 'pg';
import { chromium } from '@playwright/test';
import { roleCapabilityPresets } from '@samvev/contracts';
const expected='postgresql://display_proof:synthetic-display-proof-only@proof-db:5432/display_proof';
assert.equal(process.env.DATABASE_URL,expected);
const db=new pg.Pool({connectionString:expected});
const identity=await db.query("SELECT current_database() AS db,current_user AS username,(SELECT count(*)::int FROM installations) AS installations");
assert.deepEqual(identity.rows[0],{db:'display_proof',username:'display_proof',installations:0});
const id=async(sql,params=[]) => (await db.query(sql,params)).rows[0].id;
const hash=value=>createHash('sha256').update(value).digest('hex');
const installation=await id("INSERT INTO installations(claimed_at,setup_step) VALUES(clock_timestamp(),'complete') RETURNING id");
const household=await id("INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic household','Europe/Oslo','nb') RETURNING id",[installation]);
const person=await id("INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic adult','adult') RETURNING id",[household]);
const account=await id("INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'display-proof@test.invalid','unused','nb','light') RETURNING id",[installation]);
const membership=await id("INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id",[household,account,person,JSON.stringify(roleCapabilityPresets.household_admin)]);
await db.query("INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[account,hash('synthetic-display-manager'),hash('synthetic-display-csrf')]);
const people=[person];
for(const [name,age] of [['Synthetic adult two','adult'],['Synthetic child one','child'],['Synthetic child two','child'],['Synthetic child three','child'],['Synthetic child four','child']]) people.push(await id('INSERT INTO persons(household_id,display_name,age_group) VALUES($1,$2,$3) RETURNING id',[household,name,age]));
for(let index=0;index<people.length;index++) await db.query('UPDATE persons SET avatar_key=$2 WHERE id=$1',[people[index],`avatar-0${index+1}`]);
const setup=await id("INSERT INTO display_setups(household_id,name,locale,theme,cards,card_order,family_layout_enabled) VALUES($1,'Synthetic shared setup','nb','dark','[\"household_messages\",\"family_layout\",\"today\",\"tomorrow\",\"week\",\"groceries\",\"dinners\",\"photos\"]','[\"household_messages\",\"family_layout\",\"today\",\"tomorrow\",\"week\",\"groceries\",\"dinners\",\"photos\"]',true) RETURNING id",[household]);
for(const selected of people) await db.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[household,setup,selected]);
const display=await id("INSERT INTO displays(household_id,setup_id,name,locale,theme,credential_hash,credential_expires_at) VALUES($1,$2,'Synthetic wall display','nb',NULL,$3,clock_timestamp()+interval '1 hour') RETURNING id",[household,setup,hash('synthetic-old-display')]);
for(const selected of people) await db.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed) VALUES($1,$2,$3,true)',[household,display,selected]);
await db.query('UPDATE display_board_read_grants SET grocery_read=true,dinner_read=true WHERE household_id=$1 AND display_id=$2',[household,display]);
const mainBoardPolicy=(await db.query('SELECT grocery_read,dinner_read,(SELECT grocery_write FROM display_action_policies WHERE household_id=$1 AND display_id=$2) AS grocery_write,(SELECT dinner_write FROM display_action_policies WHERE household_id=$1 AND display_id=$2) AS dinner_write FROM display_board_read_grants WHERE household_id=$1 AND display_id=$2',[household,display])).rows[0];
assert.deepEqual(mainBoardPolicy,{grocery_read:true,dinner_read:true,grocery_write:false,dinner_write:false},'main synthetic display receives board read permission without board write actions');
const photoAlbum=await id("INSERT INTO media_albums(household_id,owner_membership_id,name,album_kind) VALUES($1,$2,'Synthetic family album','photos') RETURNING id",[household,membership]);
await db.query("INSERT INTO media_album_grants(household_id,album_id,household_wide,can_read,can_upload,can_manage) VALUES($1,$2,true,true,true,true)",[household,photoAlbum]);
await db.query('INSERT INTO media_album_display_grants(household_id,album_id,display_id,can_read) VALUES($1,$2,$3,true)',[household,photoAlbum,display]);
const backgroundAlbum=await id("INSERT INTO media_albums(household_id,owner_membership_id,name,album_kind) VALUES($1,$2,'Synthetic wall backgrounds','backgrounds') RETURNING id",[household,membership]);
await db.query("INSERT INTO media_album_grants(household_id,album_id,household_wide,can_read,can_upload,can_manage) VALUES($1,$2,true,true,false,false)",[household,backgroundAlbum]);
await db.query('INSERT INTO media_album_display_grants(household_id,album_id,display_id,can_read) VALUES($1,$2,$3,true)',[household,backgroundAlbum,display]);
assert.equal(process.env.SYNTHETIC_LANDSCAPE_PATH?.startsWith('/visual/.synthetic-landscape-'),true,'landscape fixture must come from the verified visual bind mount');
const landscapeBytes=await readFile(process.env.SYNTHETIC_LANDSCAPE_PATH);
const photoAsset=await id("INSERT INTO media_assets(household_id,album_id,title,description,original_mime,width,height,content_sha256,master_webp,preview_webp,created_by_membership_id) VALUES($1,$2,'Synthetic evening landscape','Repository-bundled landscape, converted locally for synthetic visual evidence.','image/webp',1200,480,$3,$4,$4,$5) RETURNING id",[household,photoAlbum,hash(landscapeBytes),landscapeBytes,membership]);
const backgroundAsset=await id("INSERT INTO media_assets(household_id,album_id,title,description,original_mime,width,height,content_sha256,master_webp,preview_webp,created_by_membership_id) VALUES($1,$2,'Synthetic custom display background','Synthetic landscape selected for paired display and preview evidence.','image/webp',1200,480,$3,$4,$4,$5) RETURNING id",[household,backgroundAlbum,hash(landscapeBytes),landscapeBytes,membership]);
await db.query('UPDATE display_setups SET album_ids=$2 WHERE id=$1',[setup,JSON.stringify([photoAlbum])]);
await db.query("INSERT INTO household_grocery_items(household_id,label,created_by_actor_type,created_by_actor_id) VALUES($1,'Synthetic pantry item','member',$2)",[household,membership]);
const task=await id("INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,revision,approved_revision,presentation_kind) VALUES($1,$2,'Synthetic school task','Synthetic instructions','https://school.test.invalid/source','active',60,0,'08:00','default','routine',1,1,'school') RETURNING id",[household,membership]);
await db.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)',[household,task,people[2]]);
const message=await id("INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic school notice','normal',false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 days','published','synthetic-proof-school',clock_timestamp()) RETURNING id",[household,membership]);
await db.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[household,message,people[2]]);
await db.query("INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'delivered')",[household,message,display]);
const householdMessage=await id("INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic household note','normal',true,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 days','published','synthetic-proof-household-note',clock_timestamp()) RETURNING id",[household,membership]);
await db.query("INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'delivered')",[household,householdMessage,display]);
const schoolEvent=await id("INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_type,description,actions,evidence,confidence,source_fingerprint,message_id,school_expires_at) VALUES($1,$2,'synthetic-proof-school',(clock_timestamp() AT TIME ZONE 'Europe/Oslo')::date,'preparation','Synthetic school activity','[\"Pack synthetic item\"]',$3,0.9,'synthetic-proof-fingerprint',$4,clock_timestamp()+interval '2 days') RETURNING id",[household,task,JSON.stringify({sourceUrl:'https://school.test.invalid/event',quote:'Synthetic saved evidence'}),message]);
const todayAndTomorrow=await db.query("SELECT (clock_timestamp() AT TIME ZONE 'Europe/Oslo')::date AS today,((clock_timestamp() AT TIME ZONE 'Europe/Oslo')::date+1) AS tomorrow");
const today=todayAndTomorrow.rows[0].today.toISOString().slice(0,10),tomorrow=todayAndTomorrow.rows[0].tomorrow.toISOString().slice(0,10);
const expectedCurrentWeekDates=(()=>{const start=new Date(`${today}T00:00:00.000Z`),count=(7-start.getUTCDay())%7+1;return Array.from({length:count},(_,index)=>new Date(start.getTime()+index*86400000).toISOString().slice(0,10))})();
const assertCurrentWeek=async(surface)=>{const days=surface.locator('[data-testid="home-activity-week"] .hub-week-day time[datetime]');await days.first().waitFor({timeout:10000});const dates=await days.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('datetime')));assert.deepEqual(dates,expectedCurrentWeekDates,'current week must show household-local today through Sunday, including empty days');};
const tomorrowEvent=await id("INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_time,event_type,description,actions,evidence,confidence,source_fingerprint,message_id,school_expires_at) VALUES($1,$2,'synthetic-proof-tomorrow',$3,'08:15','preparation','Synthetic class trip tomorrow','[\"Bring synthetic lunch\",\"Wear a rain jacket\"]',$4,0.94,'synthetic-proof-tomorrow-fingerprint',$5,clock_timestamp()+interval '3 days') RETURNING id",[household,task,tomorrow,JSON.stringify({sourceUrl:'https://school.test.invalid/tomorrow',quote:'Synthetic class trip details'}),message]);
const dinnerOption=await id("INSERT INTO household_dinner_options(household_id,title,emoji,created_by_actor_type,created_by_actor_id) VALUES($1,'Synthetic veggie tacos','🌮','member',$2) RETURNING id",[household,membership]);
await db.query("INSERT INTO household_dinner_assignments(household_id,local_date,title_snapshot,emoji_snapshot,updated_by_actor_type,updated_by_actor_id) VALUES($1,$2,'Synthetic veggie tacos','🌮','member',$3),($1,$4,'Synthetic tomato pasta','🍝','member',$3)",[household,today,membership,tomorrow]);
await db.query("INSERT INTO household_grocery_items(household_id,label,created_by_actor_type,created_by_actor_id) VALUES($1,'Synthetic tomatoes','member',$2),($1,'Synthetic tortillas','member',$2)",[household,membership]);
 await db.query('UPDATE display_setups SET cards=$2,card_order=$2 WHERE id=$1',[setup,'["household_messages","family_layout","today","tomorrow","week","groceries","dinners","photos"]']);
const snapshot=async()=> (await db.query("SELECT to_jsonb(d)-ARRAY['credential_hash','credential_expires_at','credential_generation','last_seen_at'] AS display,(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.person_id) FROM display_person_grants g WHERE g.display_id=d.id) AS grants FROM displays d WHERE d.id=$1",[display])).rows[0];
const before=await snapshot();
// Real browser calendar lifecycle proof. No subscription URL or credential is seeded.
async function proveCalendarLifecycle(admin,capture) {
 const base=`/api/v1/households/${household}/calendar-connections`;
 const seed=async(provider,name,{householdId=household,disconnected=true}={})=>{
   const integration=await id('INSERT INTO integration_connections(household_id,name,revoked_at) VALUES($1,$2,CASE WHEN $3 THEN clock_timestamp() ELSE NULL END) RETURNING id',[householdId,name,disconnected]);
   const connection=await id("INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state,disconnected_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN clock_timestamp() ELSE NULL END) RETURNING id",[householdId,integration,account,provider,name,disconnected?'disconnected':'setup',disconnected]);
   const source=await id("INSERT INTO calendar_sources(household_id,connection_id,external_id,name,subject_household,target_household) VALUES($1,$2,$3,$4,true,true) RETURNING id",[householdId,connection,`synthetic-${provider}-source`,`${name} source`]);
   return {id:connection,source,expectedRevision:1,name};
 };
 const removed=[];
 for(const provider of ['google','microsoft','ics'])removed.push(await seed(provider,`Synthetic disconnected ${provider}`));
 const active=await seed('ics','Synthetic setup ICS',{disconnected:false});
 const foreignHousehold=await id("INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic foreign calendar household','Europe/Oslo','nb') RETURNING id",[installation]);
 const foreign=await seed('ics','Synthetic foreign ICS',{householdId:foreignHousehold});
 const request=(method,path,payload)=>admin.evaluate(async({method,path,payload})=>{const response=await fetch(path,{method,headers:{'content-type':'application/json','x-csrf-token':'synthetic-display-csrf'},...(payload?{body:JSON.stringify(payload)}:{})});return{status:response.status,body:await response.json()};},{method,path,payload});
 const activeDelete=await request('DELETE',`${base}/${active.id}`,{expectedRevision:1});
 assert.equal(activeDelete.status,409);assert.equal(activeDelete.body.error.details.reason,'calendar_connection_must_be_disconnected');
 const cross=await request('DELETE',`${base}/${foreign.id}`,{expectedRevision:1});assert.equal(cross.status,404);
 assert.equal((await db.query('SELECT count(*)::int AS count FROM calendar_connections WHERE id=$1 AND removed_at IS NULL',[foreign.id])).rows[0].count,1,'cross-household request preserves foreign calendar');
 const shot=async(id,theme,viewport,verified,scrollSelector,simulation)=>{if(capture)await capture(admin,{id,file:`${id}.png`,surface:'calendar-integrations',theme,viewport,verified,scrollSelector,...(simulation?{simulation}:{})});};
 const desktop={width:1280,height:900},mobile={width:390,height:844};
 await db.query("UPDATE accounts SET theme='light' WHERE id=$1",[account]);
 await admin.setViewportSize(desktop);await admin.goto('/?tab=integrations');
 const group=admin.locator('.calendar-disconnected');await group.waitFor();
 assert.equal(await group.getAttribute('open'),null,'disconnected calendars start compact and closed');
 assert.equal(await group.locator('li:visible').count(),0);
 await shot('calendar-integrations-light-closed','light',desktop,['three disconnected synthetic providers collapsed','setup ICS preserved'],'.calendar-area');
 await group.locator('summary').click();assert.equal(await group.locator('li').count(),3);
 for(const fixture of removed)await group.getByText(`${fixture.name} source`,{exact:true}).waitFor({state:'visible'});
 await shot('calendar-integrations-light-open','light',desktop,['three synthetic source names visible','Google Microsoft ICS removable'],'.calendar-disconnected');
 await group.locator('li').filter({hasText:removed[0].name}).getByRole('button',{name:'Fjern kalender',exact:true}).click();
 const single=admin.getByRole('dialog');await single.getByText(`${removed[0].name} source`,{exact:true}).waitFor();
 await shot('calendar-remove-single-light','light',desktop,['single confirmation names synthetic Google source']);
 const singleResponse=admin.waitForResponse(response=>response.request().method()==='DELETE'&&response.url().endsWith(`/${removed[0].id}`));
 await single.getByRole('button',{name:'Fjern kalender',exact:true}).click();const singleResult=await singleResponse;assert.equal(singleResult.status(),200,await singleResult.text());
 await single.waitFor({state:'hidden'});await admin.reload();await group.waitFor();
 assert.equal(await group.getByText(removed[0].name,{exact:true}).count(),0,'single removal remains gone after reload');
 await db.query("UPDATE accounts SET theme='dark' WHERE id=$1",[account]);
 await admin.setViewportSize(mobile);await admin.reload();await group.waitFor();await group.locator('summary').click();
 await group.getByRole('button',{name:'Fjern alle frakoblede',exact:true}).click();
 const batch=admin.getByRole('dialog');await batch.getByRole('heading',{name:'Tilkoblinger som omfattes (2):',exact:true}).waitFor();
 for(const fixture of removed.slice(1))await batch.getByText(`${fixture.name} source`,{exact:true}).waitFor();
 await shot('calendar-remove-batch-dark-mobile','dark',mobile,['batch confirmation snapshots Microsoft and ICS source names']);
 // A connection added after opening confirmation must not be silently included.
 const late=await seed('google','Synthetic later disconnected google');
 const batchResponse=admin.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/remove-disconnected'));
 await batch.getByRole('button',{name:'Fjern alle frakoblede',exact:true}).click();const response=await batchResponse;assert.equal(response.status(),200,await response.text());
 assert.deepEqual(response.request().postDataJSON().connections,removed.slice(1).map(({id,expectedRevision})=>({id,expectedRevision})),'batch submits the exact visible snapshot');
 await batch.waitFor({state:'hidden'});await admin.reload();await group.waitFor();
 const remaining=await request('GET',base);
 assert.equal(remaining.status,200);assert.deepEqual(remaining.body.connections.map(c=>c.id).sort(),[active.id,late.id].sort(),'all three removed providers stay gone while late and active connections survive');
 for(const fixture of removed){assert.equal((await db.query('SELECT count(*)::int AS count FROM calendar_sources WHERE connection_id=$1',[fixture.id])).rows[0].count,0);assert.equal(await admin.getByText(fixture.name,{exact:true}).count(),0);}
 await admin.locator('.calendar-sources').getByRole('button',{name:'Sett opp kalender',exact:true}).click();
 const editor=admin.getByRole('dialog');await editor.getByRole('heading',{name:'Synthetic setup ICS source',exact:true}).waitFor();
 await editor.getByLabel('Ta med tilbake i tid',{exact:true}).selectOption('28');
 await editor.getByLabel('Ta med frem i tid',{exact:true}).selectOption('364');
 for(const [label,value,text] of [['Ta med tilbake i tid','28','4 uker (28 dager)'],['Ta med frem i tid','364','52 uker (364 dager)']]){
   assert.equal(await editor.getByLabel(label,{exact:true}).inputValue(),value);assert.equal(await editor.getByLabel(label,{exact:true}).locator('option:checked').innerText(),text);
 }
 await editor.getByText('For ICS-kalendere må Samvev laste ned hele abonnementet før hendelser innenfor tidsrommet kan velges. Tidsrommet reduserer ikke nedlastingsstørrelsen.',{exact:true}).waitFor();
 await shot('calendar-window-dark-mobile','dark',mobile,['real setup source editor','28 day past and 364 day future selected','ICS full download explanation']);
 await editor.getByRole('button',{name:'Lukk',exact:true}).last().click();
 await db.query("UPDATE accounts SET theme='light' WHERE id=$1",[account]);await admin.setViewportSize(desktop);await admin.reload();
 await admin.locator('.calendar-sources').getByRole('button',{name:'Sett opp kalender',exact:true}).click();await editor.getByLabel('Ta med frem i tid',{exact:true}).waitFor();
 await editor.getByLabel('Ta med tilbake i tid',{exact:true}).selectOption('28');
 await editor.getByLabel('Ta med frem i tid',{exact:true}).selectOption('364');
 await shot('calendar-window-light-desktop','light',desktop,['real setup source editor','28 day past and 364 day future selected','ICS full download explanation']);
 await editor.getByRole('button',{name:'Lukk',exact:true}).last().click();
 // Two explicitly simulated transport errors exercise the actual error renderer.
 // Temporarily permit Preview in this credential-free fixture; the source stays
 // disabled and every exact preview POST is fulfilled locally, never forwarded.
 const previewUrl=`**${base}/${active.id}/sources/${active.source}/preview`;
 let errorDetails,intercepted=0;
 const interceptPreview=async route=>{
   assert.equal(route.request().method(),'POST');
   assert.equal(route.request().postDataJSON().expectedSourceRevision,1);
   intercepted++;
   await route.fulfill({status:413,contentType:'application/json',body:JSON.stringify({error:{code:'CALENDAR_ICS_TOO_LARGE',details:errorDetails}})});
 };
 await admin.route(previewUrl,interceptPreview);
 await db.query("UPDATE calendar_connections SET state='connected' WHERE id=$1",[active.id]);
 try{
   for(const scenario of [
     {id:'calendar-ics-size-observed-dark-mobile',theme:'dark',viewport:mobile,details:{observedBytes:11010048,maxBytes:8388608},expected:'Nedlastingen ble stoppet etter at 10,5 MiB var mottatt. Den konfigurerte grensen er 8 MiB.'},
     {id:'calendar-ics-size-declared-light-desktop',theme:'light',viewport:desktop,details:{declaredBytes:12582912,maxBytes:8388608},expected:'Kalenderen oppgir en totalstørrelse på 12 MiB. Den konfigurerte nedlastingsgrensen er 8 MiB.'},
   ]){
     errorDetails=scenario.details;
     await db.query('UPDATE accounts SET theme=$2 WHERE id=$1',[account,scenario.theme]);
     await admin.setViewportSize(scenario.viewport);await admin.reload();
     await admin.locator('.calendar-sources').getByRole('button',{name:'Sett opp kalender',exact:true}).click();
     await editor.getByRole('heading',{name:'Synthetic setup ICS source',exact:true}).waitFor();
     const response=admin.waitForResponse(response=>response.url().endsWith(`/${active.source}/preview`)&&response.request().method()==='POST');
     await editor.getByRole('button',{name:'Forhåndsvis avtaler',exact:true}).click();
     assert.equal((await response).status(),413);
     const alert=editor.getByRole('alert');await alert.waitFor({state:'visible'});
     const text=await alert.innerText();assert.ok(text.includes(scenario.expected),text);
     assert.doesNotMatch(text,/\{(?:observedBytes|maxBytes|declaredBytes|observedMiB|maxMiB|declaredMiB)\}/,'localized size errors contain no raw interpolation placeholders');
     await shot(scenario.id,scenario.theme,scenario.viewport,['actual localized error renderer','synthetic intercepted HTTP 413','MiB values interpolated without raw placeholders'],'.calendar-source-editor [role="alert"]',{type:'ui-only-intercepted-preview-error',httpStatus:413,code:'CALENDAR_ICS_TOO_LARGE',details:scenario.details,providerFetchPerformed:false,sourceEnabled:false});
     await editor.getByRole('button',{name:'Lukk',exact:true}).last().click();
   }
   assert.equal(intercepted,2,'only the two intended source preview POSTs are intercepted');
 }finally{
   await admin.unroute(previewUrl,interceptPreview);
   await db.query("UPDATE calendar_connections SET state='setup' WHERE id=$1",[active.id]);
 }
 assert.equal((await db.query('SELECT enabled FROM calendar_sources WHERE id=$1',[active.source])).rows[0].enabled,false,'UI error simulation never enables or saves the source');
 assert.equal((await request('GET',base)).status,200,'manager session and calendar authorization survive removal');
}
async function captureVisualEvidence({admin,old,screen,denied,adminCtx,db,household,display,setup,account,schoolEvent,tomorrowEvent,today,tomorrow,backgroundAlbum,backgroundAsset}) {
 const out=process.env.VISUAL_OUTPUT;
 assert.equal(out,'/visual','visual bind mount must be the verified /visual target');
 assert.match(process.env.SOURCE_HEAD_SHA??'',/^[a-f0-9]{40}$/,'capture must identify the publisher checkout HEAD');
 assert.ok(['true','false'].includes(process.env.SOURCE_DIRTY??''),'capture must record the publisher checkout dirty state');
 await mkdir(out,{recursive:true});
 const viewports=[['desktop',1920,1080],['mobile',390,844],['tablet-portrait',820,1180],['wall-landscape',1280,752],['wall-portrait',752,1280]];
 const manifest=[];
 const previewPage=await adminCtx.newPage();
 await previewPage.clock.install({time:new Date()});
 const waitForSettledHome=page=>page.waitForFunction(()=>!document.body.innerText.includes('Gjør alt klart'));
 const expectedHomePeople=['Synthetic adult','Synthetic adult two','Synthetic child one','Synthetic child two','Synthetic child three','Synthetic child four'].sort();
 const assertHomePeopleExactlySix=async page=>{
   const names=await page.locator('.family-hub .hub-person[data-person-id], .family-hub .hub-identities button[data-person-id]').evaluateAll(elements=>elements.filter(element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden').map(element=>element.querySelector('.hub-person-name > strong, strong')?.textContent?.trim()??'').filter(Boolean));
   assert.deepEqual([...new Set(names)].sort(),expectedHomePeople,'member Home visibly renders exactly the six primary synthetic people at this viewport');
 };
 const assertPairedActivitiesReady=async(page,{preview=false,stableWindowMs=500}={})=>{
   const todayCard=page.locator(preview?'.display-preview-today':'.display-day-card-today'),tomorrowCard=page.locator(preview?'.display-preview-tomorrow':'.display-day-card-tomorrow');
   await todayCard.getByText('Synthetic school activity',{exact:true}).waitFor({state:'visible',timeout:15000});
   await tomorrowCard.getByText('Synthetic class trip tomorrow',{exact:true}).waitFor({state:'visible',timeout:15000});
   const deadline=Date.now()+4000;
   let stableSince=null,last={today:0,tomorrow:0,loading:0,disabled:0};
   while(Date.now()<deadline){
     last={today:await todayCard.getByText('Synthetic school activity',{exact:true}).count(),tomorrow:await tomorrowCard.getByText('Synthetic class trip tomorrow',{exact:true}).count(),loading:await page.getByText('Gjør alt klart',{exact:false}).count(),disabled:await page.getByText('Kalenderinnhold er slått av for denne skjermen. Slå det på under Datatilgang.',{exact:true}).count()};
     const ready=last.today===1&&last.tomorrow===1&&last.loading===0&&last.disabled===0;
     if(ready){stableSince??=Date.now();if(Date.now()-stableSince>=stableWindowMs)break;}else stableSince=null;
     await new Promise(resolve=>setTimeout(resolve,50));
   }
   assert.ok(stableSince!==null&&Date.now()-stableSince>=stableWindowMs,`seeded Today and Tomorrow activities did not remain stable for ${stableWindowMs}ms: ${JSON.stringify(last)}`);
   assert.deepEqual(last,{today:1,tomorrow:1,loading:0,disabled:0},'paired display calendar remains settled without a permission/loading fallback');
 };
 let messageAudit={previewLiveProjectionParity:true,householdNoteMemberHome:true,pairedDisplay:{count:0,visibleCount:0,contexts:[]},adminPreview:{count:0,visibleCount:0,contexts:[]}};
 const auditHouseholdNote=page=>page.getByText('Synthetic household note',{exact:true}).evaluateAll(elements=>elements.map(element=>{
   const style=getComputedStyle(element),visible=element.getClientRects().length>0&&style.display!=='none'&&style.visibility!=='hidden';
   const context=element.closest('.hub-message, .display-preview-card, .display-card');
   return{visible,context:context instanceof HTMLElement?context.className:element.parentElement?.className??element.tagName};
 }));
 const prepareCapture=async(page,{scrollSelector})=>{
   if(scrollSelector) await page.locator(scrollSelector).evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
   else await page.evaluate(()=>window.scrollTo({left:0,top:0,behavior:'instant'}));
   await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
 };
 const capture=async(page,{id,file,surface,theme,viewport,verified,scrollSelector,fullPage=false,background,simulation,prepared=false})=>{
   if(!prepared)await prepareCapture(page,{scrollSelector});
   const path=resolve(out,file);
   await page.screenshot({path,fullPage,animations:'disabled'});
   const bytes=await readFile(path);
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',`${file} is a PNG`);
   const pngDimensions={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
   if(!fullPage) assert.deepEqual(pngDimensions,viewport,`${file} matches its requested viewport`);
   manifest.push({id,file,surface,theme,viewport,pngDimensions,captureMode:fullPage?'full-page-supplement':'viewport',sha256:hash(bytes),source:{headSha:process.env.SOURCE_HEAD_SHA,dirty:process.env.SOURCE_DIRTY==='true'},fixture:{id:'r17-rich-capture-synthetic-household',type:'six-selected-synthetic-people; unselected-child-acl-fixture-added-after-base-captures'},...(background?{background}:{}),...(simulation?{simulation}:{}),messageAudit,verified});
 };
 const captureCalendar=async(page,calendarSurface,options)=>{
   await assertPairedActivitiesReady(calendarSurface,options.readiness);
   await prepareCapture(page,options.capture);
   await assertPairedActivitiesReady(calendarSurface,options.readiness);
   await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
   try{
     await assertPairedActivitiesReady(calendarSurface,options.readiness);
     await capture(page,{...options.capture,prepared:true});
     await assertPairedActivitiesReady(calendarSurface,options.readiness);
   }finally{await page.clock.resume();}
 };
 for(const theme of ['light','dark']) {
   await db.query('UPDATE accounts SET theme=$2 WHERE id=$1',[account,theme]);
   await db.query('UPDATE display_setups SET theme=$2 WHERE id=$1',[setup,theme]);
   await db.query('UPDATE displays SET theme=$2 WHERE id=$1',[display,theme]);
   await admin.setViewportSize({width:1920,height:1080});
   await screen.setViewportSize({width:1920,height:1080});
   await previewPage.setViewportSize({width:1920,height:1080});
   await admin.goto('/?tab=home');
   await admin.locator('.family-hub').waitFor();
   await waitForSettledHome(admin);
   await assertCurrentWeek(admin);
   assert.ok(await admin.getByText('Synthetic school activity',{exact:true}).count()>=1,'member Home has loaded synthetic Today content');
   await assertHomePeopleExactlySix(admin);
   assert.equal(await admin.getByText('Synthetic household note',{exact:true}).count(),1,'member Home shows the synthetic household note');
   assert.ok(await admin.locator('.hub-message .avatar img').count()>=1,'member Home shows the author avatar');
   await screen.goto('/display');
   await screen.locator('.family-hub').waitFor();
   await waitForSettledHome(screen);
   await assertCurrentWeek(screen);
   assert.ok(await screen.getByText('Synthetic adult',{exact:true}).count()>=1,'paired display has loaded synthetic people');
   await previewPage.goto('/?tab=displays');
   await previewPage.getByRole('heading',{name:'Et felles blikk på hjemmet.',exact:true}).waitFor();
   await previewPage.locator('summary').filter({hasText:'Datatilgang'}).click();
   await previewPage.getByRole('button',{name:'Forhåndsvis denne skjermen'}).click();
   const preview=previewPage.locator('.display-preview');
   await preview.waitFor();
   await previewPage.getByLabel('Retning for forhåndsvisning').selectOption('landscape');
   await waitForSettledHome(previewPage);
   await assertCurrentWeek(preview);
   assert.ok(await preview.getByText('Synthetic adult',{exact:true}).count()>=1,'admin preview has loaded synthetic people');
   for(const surface of [preview,screen.locator('body')]) {
     assert.equal(await surface.getByText('Synthetic school notice',{exact:true}).count(),1,'paired display message appears in live UI and preview');
     assert.ok(await surface.locator('.hub-message .avatar img').count()>=1,'authorized message author has a local illustrated avatar');
     assert.equal(await surface.getByText('Synthetic evening landscape',{exact:true}).count(),1,'granted synthetic landscape image is visible');
     assert.equal(await surface.locator('.media-slide img').count(),1,'synthetic album image loaded through the isolated media API');
   }
   await screen.getByText('Synthetic household note',{exact:true}).waitFor({timeout:10000});
   await preview.getByText('Synthetic household note',{exact:true}).waitFor({timeout:10000});
   messageAudit.pairedDisplay=await auditHouseholdNote(screen);
   messageAudit.adminPreview=await auditHouseholdNote(previewPage);
   assert.equal(messageAudit.pairedDisplay.filter(match=>match.visible).length,1,`paired display must show one visible household note: ${JSON.stringify(messageAudit.pairedDisplay)}`);
   assert.equal(messageAudit.adminPreview.filter(match=>match.visible).length,1,`admin preview must show one visible household note: ${JSON.stringify(messageAudit.adminPreview)}`);
   for(const [size,width,height] of viewports) {
     await admin.setViewportSize({width,height});
     await admin.locator('.family-hub').waitFor();
     assert.ok(await admin.getByText('Synthetic school activity',{exact:true}).count()>=1,'member Home screenshot has loaded synthetic Today content');
     await assertHomePeopleExactlySix(admin);
     const homeFile=`member-home-${theme}-${size}.png`;
     await capture(admin,{id:`member-home-${theme}-${size}`,file:homeFile,surface:'member-home',theme,viewport:{width,height},verified:['Synthetic school activity','Synthetic household note','local author avatar']});

     await screen.setViewportSize({width,height});
     await screen.locator('.family-hub').waitFor();
     await assertPairedActivitiesReady(screen);
     if(width>=651) { await screen.locator('.hub-person-section').waitFor();assert.equal(await screen.getByText('Synthetic child four',{exact:true}).count(),1,'paired display screenshot has loaded all synthetic people'); }
     else assert.equal(await screen.locator('.hub-hero').count(),1,'mobile display screenshot has loaded the paired display hub');
     assert.equal((await db.query('SELECT theme FROM display_setups WHERE id=$1',[setup])).rows[0].theme,theme);
     const displayFile=`paired-display-${theme}-${size}.png`;
     await captureCalendar(screen,screen.locator('body'),{capture:{id:`paired-display-${theme}-${size}`,file:displayFile,surface:'paired-display',theme,viewport:{width,height},verified:width>=651?['six synthetic people','person-targeted school notice and author avatar','read-only synthetic grocery and dinner boards','synthetic evening landscape']:['paired display hub','mobile viewport']}});

     await previewPage.setViewportSize({width,height});
     await previewPage.getByLabel('Retning for forhåndsvisning').selectOption(width>height?'landscape':'portrait');
     await preview.waitFor();
     if(width>=651) { await preview.locator('.hub-person-section').waitFor();assert.equal(await preview.getByText('Synthetic child four',{exact:true}).count(),1,'admin preview screenshot has loaded all synthetic people'); }
     else assert.equal(await preview.locator('.hub-hero').count(),1,'mobile admin preview screenshot has loaded its display hub');
     const previewFile=`admin-preview-${theme}-${size}.png`;
     await captureCalendar(previewPage,preview,{readiness:{preview:true},capture:{id:`admin-preview-${theme}-${size}`,file:previewFile,surface:'admin-preview',theme,viewport:{width,height},verified:width>=651?['six synthetic people','household note and child-targeted school notice','read-only synthetic grocery and dinner boards','synthetic evening landscape']:['manager preview hub','mobile viewport'],scrollSelector:'.display-preview'}});
     if(theme==='light'&&size==='wall-landscape') {
       await capture(admin,{id:'member-home-light-wall-landscape-full',file:'member-home-light-wall-landscape-full.png',surface:'member-home',theme,viewport:{width,height},verified:['full Home layout','synthetic household note'],fullPage:true});
       await captureCalendar(screen,screen.locator('body'),{capture:{id:'paired-display-light-wall-landscape-full',file:'paired-display-light-wall-landscape-full.png',surface:'paired-display',theme,viewport:{width,height},verified:['full paired display layout','person-targeted school notice','synthetic evening landscape'],fullPage:true}});
       await captureCalendar(previewPage,preview,{readiness:{preview:true},capture:{id:'admin-preview-light-wall-landscape-full',file:'admin-preview-light-wall-landscape-full.png',surface:'admin-preview',theme,viewport:{width,height},verified:['full manager preview layout','household note and child-targeted school notice','synthetic evening landscape'],scrollSelector:'.display-preview',fullPage:true}});
     }
   }
 }
 await db.query('UPDATE display_setups SET background_id=$2 WHERE id=$1',[setup,backgroundAsset]);
 const selectedBackground=(await db.query(`SELECT setup.background_id,asset.album_id,album.album_kind,
   EXISTS(SELECT 1 FROM media_album_grants household_grant WHERE household_grant.household_id=album.household_id AND household_grant.album_id=album.id AND household_grant.household_wide AND household_grant.can_read) AS household_read_granted,
   COALESCE(display_grant.can_read,false) AS display_read_granted
   FROM display_setups setup JOIN media_assets asset ON asset.household_id=setup.household_id AND asset.id=setup.background_id
   JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id
   LEFT JOIN media_album_display_grants display_grant ON display_grant.household_id=album.household_id AND display_grant.album_id=album.id AND display_grant.display_id=$2
   WHERE setup.id=$1`,[setup,display])).rows[0];
 assert.deepEqual(selectedBackground,{background_id:backgroundAsset,album_id:backgroundAlbum,album_kind:'backgrounds',household_read_granted:true,display_read_granted:true},'custom background is selected and explicitly granted to the household and paired display');
 for(const theme of ['light','dark']) {
   await db.query('UPDATE accounts SET theme=$2 WHERE id=$1',[account,theme]);
   await db.query('UPDATE display_setups SET theme=$2 WHERE id=$1',[setup,theme]);
   await db.query('UPDATE displays SET theme=$2 WHERE id=$1',[display,theme]);
   const viewport={width:1280,height:752};
   await screen.setViewportSize(viewport);
   await screen.goto('/display');
   await screen.locator('.family-hub').waitFor();
   await assertPairedActivitiesReady(screen);
   const liveMedia=await screen.evaluate(async()=>{const response=await fetch('/api/v1/display/media');return{status:response.status,body:await response.json()};});
   assert.equal(liveMedia.status,200);
   assert.equal(liveMedia.body.background?.id,backgroundAsset,'live media API projects the selected background to the explicitly granted paired display');
   const liveBackground=screen.locator('.display-wall-background img');
   await liveBackground.waitFor({state:'visible'});
   assert.ok((await liveBackground.getAttribute('src')).includes(`/api/v1/display/media/assets/${backgroundAsset}/preview`));
   await liveBackground.evaluate(async image=>{if(!image.complete)await new Promise((resolve,reject)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',reject,{once:true});});if(!image.naturalWidth)throw new Error('custom background image failed to load');});
   await captureCalendar(screen,screen.locator('body'),{capture:{id:`paired-display-custom-background-${theme}-wall-landscape`,file:`paired-display-custom-background-${theme}-wall-landscape.png`,surface:'paired-display',theme,viewport,verified:['synthetic selected custom background','six selected synthetic people','Today and Tomorrow activities settled'],background:{assetId:backgroundAsset,albumId:backgroundAlbum,householdReadGranted:true,displayReadGranted:true}}});

   await previewPage.setViewportSize(viewport);
   await previewPage.goto('/?tab=displays');
   await previewPage.getByRole('heading',{name:'Et felles blikk på hjemmet.',exact:true}).waitFor();
   await previewPage.locator('summary').filter({hasText:'Datatilgang'}).click();
   await previewPage.getByRole('button',{name:'Forhåndsvis denne skjermen'}).click();
   const customPreview=previewPage.locator('.display-preview');
   await customPreview.waitFor();
   await previewPage.getByLabel('Retning for forhåndsvisning').selectOption('landscape');
   await assertPairedActivitiesReady(customPreview,{preview:true});
   const managerMedia=await previewPage.evaluate(async({household,display,setup})=>{const response=await fetch(`/api/v1/households/${household}/displays/${display}/preview`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':'synthetic-display-csrf'},body:JSON.stringify({setupId:setup})});return{status:response.status,body:await response.json()};},{household,display,setup});
   assert.equal(managerMedia.status,200);
   assert.equal(managerMedia.body.media.background?.id,backgroundAsset,'manager preview media API projects the same selected and granted background');
   const previewBackground=customPreview.locator('.display-preview-backdrop');
   await previewBackground.waitFor({state:'visible'});
   assert.ok((await previewBackground.getAttribute('src')).includes(`/preview/assets/${backgroundAsset}/preview`));
   await previewBackground.evaluate(async image=>{if(!image.complete)await new Promise((resolve,reject)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',reject,{once:true});});if(!image.naturalWidth)throw new Error('custom preview background image failed to load');});
   await captureCalendar(previewPage,customPreview,{readiness:{preview:true},capture:{id:`admin-preview-custom-background-${theme}-wall-landscape`,file:`admin-preview-custom-background-${theme}-wall-landscape.png`,surface:'admin-preview',theme,viewport,scrollSelector:'.display-preview',verified:['synthetic selected custom background','same selected background as paired display','Today and Tomorrow activities settled'],background:{assetId:backgroundAsset,albumId:backgroundAlbum,householdReadGranted:true,displayReadGranted:true}}});
 }
 await proveCalendarLifecycle(admin,capture);
 await writeFile(resolve(out,'manifest.json'),`${JSON.stringify({source:'isolated synthetic display proof',sourceHeadSha:process.env.SOURCE_HEAD_SHA,sourceDirty:process.env.SOURCE_DIRTY==='true',fixture:{id:'r17-rich-capture-synthetic-household',type:'six-selected-synthetic-people; unselected-child-acl-fixture-added-after-base-captures'},aclNegativeFixture:{unselectedChildAddedAfterCaptures:true,targetedMessageAddedAfterCaptures:true},background:{assetId:backgroundAsset,albumId:backgroundAlbum,selectedForSetup:true,householdReadGranted:true,pairedDisplayReadGranted:true,deniedDisplayReadGranted:false},messageAudit,capturedAt:new Date().toISOString(),timezone:'Europe/Oslo',locale:'nb-NO',screenshots:manifest},null,2)}\n`);
 assert.equal(manifest.length,45,'37 existing display screenshots, six synthetic calendar UI captures and two explicitly simulated size-error UI captures are captured');
}
const root=resolve('apps/web/dist');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1:4174').pathname;
  if(path.startsWith('/api/')) { res.writeHead(500); return res.end('API request escaped proxy'); }
  const filename=path.startsWith('/assets/')?resolve(root,`.${path}`):resolve(root,'index.html');
  if(!filename.startsWith(`${root}/`)) {res.writeHead(400);return res.end();}
  try {const bytes=await readFile(filename);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'})[extname(filename)]??'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(4174,'127.0.0.1',resolve));
let browser;
const contexts=[];
let shuttingDown=false;
let releaseRedeem;
const redeemGate=new Promise(resolve=>{releaseRedeem=resolve;});
try {
 browser=await chromium.launch({headless:true});
 const origin='http://127.0.0.1:4174';
 const make=async()=>{
   const ctx=await browser.newContext({baseURL:origin,viewport:{width:1280,height:752},deviceScaleFactor:1,reducedMotion:'reduce',locale:'nb-NO',timezoneId:'Europe/Oslo'});
   await ctx.route('**/*',async route=>{
     try {
     const request=route.request(), url=new URL(request.url());
     if(url.origin!==origin){await route.abort();throw new Error(`unexpected origin ${url.origin}`);}
     if(!url.pathname.startsWith('/api/')) return route.continue();
     if(url.pathname.endsWith('/events')) return route.abort();
     if(url.pathname==='/api/v1/display/pairing/redeem') await redeemGate;
     const cookies=await ctx.cookies(request.url());
     const headers={...request.headers(),cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; ')};
     const response=await route.fetch({url:`http://proof-api:4173${url.pathname}${url.search}`,headers});
     await route.fulfill({response});
     } catch (error) {
       if (!shuttingDown || !/Route is already handled|Request context disposed|Target.*closed/i.test(String(error))) throw error;
     }
   });
   contexts.push(ctx);
   return ctx;
 };
 const adminCtx=await make(),oldCtx=await make(),newCtx=await make(),deniedCtx=await make();
 await adminCtx.addCookies([{name:'samvev_session',value:'synthetic-display-manager',url:origin},{name:'samvev_csrf',value:'synthetic-display-csrf',url:origin}]);
 await oldCtx.addCookies([{name:'samvev_display',value:'synthetic-old-display',domain:'127.0.0.1',path:'/api/v1/display'}]);
 await deniedCtx.addCookies([{name:'samvev_display',value:'synthetic-denied-display',domain:'127.0.0.1',path:'/api/v1/display'}]);
 const admin=await adminCtx.newPage(),old=await oldCtx.newPage(),screen=await newCtx.newPage(),denied=await deniedCtx.newPage();
 await Promise.all([admin,old,screen,denied].map(page=>page.clock.install({time:new Date()})));
 await screen.setViewportSize({width:752,height:1280});
 const projection=page=>page.evaluate(async()=> (await fetch('/api/v1/display/projection')).status);
 await old.goto('/display');assert.equal(await projection(old),200);
 await admin.goto('/?tab=displays');await admin.getByRole('heading',{name:'Et felles blikk på hjemmet.',exact:true}).waitFor();
 await admin.locator('summary').filter({hasText:'Åpne eller koble til'}).click();
 await admin.getByRole('button',{name:'Koble til denne eksisterende skjermen på nytt'}).click();
 await screen.goto('/display');await screen.getByRole('button',{name:/hent tilkoblingskode|get a pairing code/i}).click();
 const code=await screen.getByTestId('pairing-code').innerText();
 await admin.getByLabel('Sekssifret kode').fill(code);
 const redeem=screen.waitForResponse(response=>response.url().endsWith('/api/v1/display/pairing/redeem')&&response.status()===200,{timeout:15000});
 await admin.getByRole('button',{name:'Godkjenn ny tilkobling'}).click();
 await admin.getByText('Ny tilkobling for denne skjermen er godkjent.').waitFor();
 assert.equal(await projection(old),200,'approval alone preserves old display access');
 releaseRedeem();
 await redeem;
 assert.equal(await projection(old),401);assert.equal(await projection(screen),200);
 assert.deepEqual(await snapshot(),before);
 assert.equal((await db.query('SELECT credential_generation FROM displays WHERE id=$1',[display])).rows[0].credential_generation,2);

 // Compare the persisted setup's authoritative manager preview with the new device.
 const previewResult=await admin.evaluate(async({household,display,setup})=>{
   const response=await fetch(`/api/v1/households/${household}/displays/${display}/preview`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':'synthetic-display-csrf'},body:JSON.stringify({setupId:setup})});
   return {status:response.status,body:await response.json()};
 },{household,display,setup});
 assert.equal(previewResult.status,200);
 const liveResult=await screen.evaluate(async()=>{const response=await fetch('/api/v1/display/projection');return {status:response.status,body:await response.json()};});
 assert.equal(liveResult.status,200);
 const preview=previewResult.body,live=liveResult.body;
 const messageSummary=value=>value.cards.map(card=>({id:card.id,body:card.body,author:card.author})).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(messageSummary(preview),messageSummary(live),'manager preview and paired display expose the same authorized messages');
 assert.deepEqual(messageSummary(preview).map(card=>card.body).sort(),['Synthetic household note','Synthetic school notice']);
 const semantic=value=>({cards:value.setup.cardOrder,selectedPeople:[...value.setup.personIds].sort(),profiles:value.familyLayout.people.map(person=>person.id).sort(),boardReadable:value.householdBoards.readable,boardWritable:value.householdBoards.writable,groceries:value.householdBoards.groceries.map(item=>item.label).sort(),dinners:value.householdBoards.dinners.map(item=>item.title).sort()});
 assert.deepEqual(semantic(preview),semantic(live));
 assert.deepEqual(semantic(live),{cards:['household_messages','family_layout','today','tomorrow','groceries','dinners','photos'],selectedPeople:[...people].sort(),profiles:[...people].sort(),boardReadable:{groceries:true,dinners:true},boardWritable:{groceries:false,dinners:false},groceries:['Synthetic pantry item','Synthetic tomatoes','Synthetic tortillas'],dinners:['Synthetic tomato pasta','Synthetic veggie tacos']});
 const date=preview.householdBoards.from;
 const liveDay=await screen.evaluate(async date=>{const response=await fetch(`/api/v1/display/activities?from=${date}&to=${date}&limit=50`);return {status:response.status,body:await response.json()};},date);
 assert.equal(liveDay.status,200);
 const previewToday=preview.dayActivities.activities.filter(activity=>activity.date===date);
 assert.equal(liveDay.body.activities.length,1,'one synthetic school activity is visible today');
 assert.deepEqual(previewToday.map(activity=>({id:activity.id,type:activity.type})),liveDay.body.activities.map(activity=>({id:activity.id,type:activity.type})), 'Today preview and live activity counts and identity');
 assert.equal(previewToday[0].id,schoolEvent);
 const tomorrowDay=await screen.evaluate(async date=>{const response=await fetch(`/api/v1/display/activities?from=${date}&to=${date}&limit=50`);return {status:response.status,body:await response.json()};},tomorrow);
 assert.equal(tomorrowDay.status,200,JSON.stringify({tomorrow,body:tomorrowDay.body}));assert.ok(tomorrowDay.body.activities.some(activity=>activity.id===tomorrowEvent),'tomorrow contains its synthetic school trip');
 await screen.locator('.hub-person-section').waitFor();
 await admin.locator('dialog button.button').filter({hasText:'Lukk'}).click();
 await admin.locator('summary').filter({hasText:'Datatilgang'}).click();
 await admin.getByRole('button',{name:'Forhåndsvis denne skjermen'}).click();
 const previewDom=admin.locator('.display-preview');await previewDom.waitFor();
 await admin.getByLabel('Retning for forhåndsvisning').selectOption('portrait');
 assert.equal(await admin.locator('.display-preview-portrait').count(),1);
 await screen.getByText('Synthetic pantry item',{exact:true}).waitFor({state:'visible'});
 await screen.getByText('Synthetic tomatoes',{exact:true}).waitFor({state:'visible'});
 await previewDom.getByText('Synthetic pantry item',{exact:true}).waitFor({state:'visible'});
 for(const name of ['Synthetic adult','Synthetic adult two','Synthetic child one','Synthetic child two','Synthetic child three','Synthetic child four']) {
   const expectedCount=name==='Synthetic adult'?2:1;
   assert.equal(await previewDom.getByText(name,{exact:true}).count(),expectedCount,`preview renders ${name} and message author identity`);
   assert.equal(await screen.getByText(name,{exact:true}).count(),expectedCount,`display renders ${name} and message author identity`);
 }
 for(const [surface,tomorrowSelector] of [[previewDom,'.display-preview-tomorrow'],[screen.locator('body'),'.display-day-card-tomorrow']]){
   assert.equal(await surface.getByText('Synthetic pantry item',{exact:true}).count(),1,'authorized paired display reads the synthetic grocery board');
   assert.equal(await surface.getByText('Synthetic tomatoes',{exact:true}).count(),1);
   assert.equal(await surface.getByText('Synthetic tortillas',{exact:true}).count(),1);
   assert.ok(await surface.locator('[data-review-private="dinner-current"]').evaluateAll((elements,title)=>elements.some(element=>element.textContent?.includes(title)),'Synthetic veggie tacos'),'authorized paired display reads today\'s synthetic dinner');
   assert.equal(await surface.locator(tomorrowSelector).evaluate(element=>element.textContent?.includes('Synthetic tomato pasta')??false),true,'authorized paired display reads tomorrow\'s synthetic dinner');
   assert.equal(await surface.getByText('Denne tavlen er ikke delt med skjermen.',{exact:true}).count(),0,'authorized paired display has no board denial fallback');
   assert.ok(await surface.getByText('Kalenderinnhold er slått av for denne skjermen. Slå det på under Datatilgang.',{exact:true}).count()<=1,'no duplicate calendar warning');
   assert.ok(await surface.getByText('Synthetic school activity',{exact:true}).count()>=1,'Today activity appears in the rendered surface');
   assert.equal(await surface.getByText('Synthetic school notice',{exact:true}).count(),1,'synthetic household message appears once');
   assert.ok(await surface.locator('.hub-message .avatar img').count()>=1,'person-targeted notice has an illustrated author avatar');
   assert.equal(await surface.getByText('Synthetic evening landscape',{exact:true}).count(),1,'synthetic album landscape appears once');
   assert.equal(await surface.locator('.media-slide img').count(),1,'synthetic album image is loaded');
   assert.ok(await surface.locator('.hub-hero').count()<=1,'no duplicate welcome');
   assert.ok(await surface.locator('.hub-hero-clock').count()<=1,'no duplicate clock');
   assert.equal(await surface.locator('.board-add-row').count(),0,'no unshared board actions');
 }
 assert.equal(await previewDom.locator('.display-preview-today').count(),1);
 assert.equal(await screen.locator('section[aria-label="I dag"]').count(),1);

 if(process.env.SCREENSHOT_MODE!=='1') await proveCalendarLifecycle(admin);
 if(process.env.SCREENSHOT_MODE==='1') await captureVisualEvidence({admin,old,screen,denied,adminCtx,db,household,display,setup,account,schoolEvent,tomorrowEvent,today,tomorrow,backgroundAlbum,backgroundAsset});

 const hiddenPerson=await id("INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic unselected child','child') RETURNING id",[household]);
 const hiddenPersonMessage=await id("INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic hidden child notice','normal',false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 days','published','synthetic-proof-hidden-child',clock_timestamp()) RETURNING id",[household,membership]);
 await db.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[household,hiddenPersonMessage,hiddenPerson]);
 await db.query("INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'delivered')",[household,hiddenPersonMessage,display]);
 const negativePreview=await admin.evaluate(async({household,display,setup})=>{const response=await fetch(`/api/v1/households/${household}/displays/${display}/preview`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':'synthetic-display-csrf'},body:JSON.stringify({setupId:setup})});return{status:response.status,body:await response.json()};},{household,display,setup});
 const negativeLive=await screen.evaluate(async()=>{const response=await fetch('/api/v1/display/projection');return{status:response.status,body:await response.json()};});
 assert.equal(negativePreview.status,200);
 assert.equal(negativeLive.status,200);
 const hiddenMessageSummary=value=>value.cards.map(card=>({id:card.id,body:card.body}));
 assert.ok(!hiddenMessageSummary(negativePreview.body).some(card=>card.id===hiddenPersonMessage||card.body==='Synthetic hidden child notice'),'unselected-child message is absent from preview API projection');
 assert.ok(!hiddenMessageSummary(negativeLive.body).some(card=>card.id===hiddenPersonMessage||card.body==='Synthetic hidden child notice'),'unselected-child message is absent from live API projection');
 assert.ok(!negativePreview.body.setup.personIds.includes(hiddenPerson),'unselected child is absent from selected preview people');
 assert.ok(!negativePreview.body.familyLayout.people.some(selected=>selected.id===hiddenPerson),'unselected child is absent from preview profile projection');
 assert.ok(!negativeLive.body.setup.personIds.includes(hiddenPerson),'unselected child is absent from live selected people');
 assert.ok(!negativeLive.body.familyLayout.people.some(selected=>selected.id===hiddenPerson),'unselected child is absent from live profile projection');
 await screen.goto('/display');
 await screen.locator('.family-hub').waitFor();
 await screen.getByText('Synthetic school activity',{exact:true}).waitFor({state:'visible'});
 await admin.goto('/?tab=displays');
 await admin.getByRole('heading',{name:'Et felles blikk på hjemmet.',exact:true}).waitFor();
 await admin.locator('summary').filter({hasText:'Datatilgang'}).click();
 await admin.getByRole('button',{name:'Forhåndsvis denne skjermen'}).click();
 const negativePreviewDom=admin.locator('.display-preview');
 await negativePreviewDom.waitFor();
 await negativePreviewDom.getByText('Synthetic household note',{exact:true}).waitFor({state:'visible'});
 for(const surface of [negativePreviewDom,screen.locator('body')]){
   assert.equal(await surface.getByText('Synthetic unselected child',{exact:true}).count(),0,'unselected child stays out of rendered preview and live display');
   assert.equal(await surface.getByText('Synthetic hidden child notice',{exact:true}).count(),0,'targeted unselected-child message stays out of rendered preview and live display');
 }
 const deniedDisplay=await id("INSERT INTO displays(household_id,setup_id,name,locale,theme,credential_hash,credential_expires_at) VALUES($1,$2,'Synthetic denied display','nb',NULL,$3,clock_timestamp()+interval '1 hour') RETURNING id",[household,setup,hash('synthetic-denied-display')]);
 const deniedGrantCount=(await db.query('SELECT count(*)::int AS count FROM media_album_display_grants WHERE household_id=$1 AND album_id=$2 AND display_id=$3',[household,backgroundAlbum,deniedDisplay])).rows[0].count;
 assert.equal(deniedGrantCount,0,'second synthetic display has no custom-background read grant');
 await denied.goto('/display');
 // With no person grants, the denied display renders the ordinary display shell
 // rather than FamilyHub. Wait for its current projection and board fallback.
 await denied.locator('.display-page[data-cache-state="current"]').waitFor({state:'visible'});
 await denied.getByText('Denne tavlen er ikke delt med skjermen.',{exact:true}).waitFor({state:'visible'});
 const deniedProjection=await denied.evaluate(async()=>{const response=await fetch('/api/v1/display/projection');return{status:response.status,body:await response.json()};});
 assert.equal(deniedProjection.status,200);
 assert.deepEqual(deniedProjection.body.householdBoards.readable,{groceries:false,dinners:false},'second synthetic display retains default no-board-read permission');
 assert.deepEqual(deniedProjection.body.householdBoards.writable,{groceries:false,dinners:false});
 assert.equal(deniedProjection.body.householdBoards.groceries.length,0);
 assert.equal(deniedProjection.body.householdBoards.dinners.length,0);
 for(const label of ['Synthetic pantry item','Synthetic tomatoes','Synthetic tortillas']) assert.equal(await denied.getByText(label,{exact:true}).count(),0,`no board item leaks to the second display: ${label}`);
 assert.equal(await denied.locator('[data-review-private="dinner-current"]').evaluateAll(elements=>elements.some(element=>element.textContent?.includes('Synthetic veggie tacos'))),false,'no current dinner title leaks to the second display');
 assert.equal(await denied.locator('.display-day-card-tomorrow').evaluate(element=>element.textContent?.includes('Synthetic tomato pasta')??false),false,'no tomorrow dinner title leaks to the second display');
 assert.equal(await denied.getByText('Denne tavlen er ikke delt med skjermen.',{exact:true}).count(),1,'second synthetic display renders the board privacy fallback');
 const deniedMedia=await denied.evaluate(async()=>{const response=await fetch('/api/v1/display/media');return{status:response.status,body:await response.json()};});
 assert.equal(deniedMedia.status,200);
 assert.equal(deniedMedia.body.background,null,'display without the background album grant cannot read the selected background');
 assert.equal(deniedMedia.body.householdBackground,null);
 assert.ok(!deniedMedia.body.assets.some(asset=>asset.id===backgroundAsset),'denied display media projection contains no selected background asset');
 const revokedMedia=await old.evaluate(async()=>{const response=await fetch('/api/v1/display/media');return{status:response.status,body:await response.json()};});
 assert.equal(revokedMedia.status,401,'re-paired old credential cannot read the custom background');

} finally {shuttingDown=true;releaseRedeem();for(const context of contexts) await context.unrouteAll({behavior:'ignoreErrors'});await browser?.close();await new Promise(resolve=>server.close(resolve));await db.end();}
console.log('PASS real browser re-pair, six-person parity, read-only board access, hidden child/message ACL, denied-display privacy, and synthetic calendar single/batch removal, snapshot isolation, authorization and window UI.');
