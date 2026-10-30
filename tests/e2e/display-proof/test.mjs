import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
const setup=await id("INSERT INTO display_setups(household_id,name,locale,theme,cards,card_order,family_layout_enabled) VALUES($1,'Synthetic shared setup','nb','dark','[\"family_layout\",\"today\",\"groceries\"]','[\"family_layout\",\"today\",\"groceries\"]',true) RETURNING id",[household]);
for(const selected of people) await db.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[household,setup,selected]);
const display=await id("INSERT INTO displays(household_id,setup_id,name,locale,theme,credential_hash,credential_expires_at) VALUES($1,$2,'Synthetic wall display','nb',NULL,$3,clock_timestamp()+interval '1 hour') RETURNING id",[household,setup,hash('synthetic-old-display')]);
for(const selected of people) await db.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed) VALUES($1,$2,$3,true)',[household,display,selected]);
await db.query("INSERT INTO household_grocery_items(household_id,label,created_by_actor_type,created_by_actor_id) VALUES($1,'Synthetic unshared grocery','member',$2)",[household,membership]);
const task=await id("INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,revision,approved_revision,presentation_kind) VALUES($1,$2,'Synthetic school task','Synthetic instructions','https://school.test.invalid/source','active',60,0,'08:00','default','routine',1,1,'school') RETURNING id",[household,membership]);
await db.query('INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)',[household,task,people[2]]);
const message=await id("INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic school notice','normal',false,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 days','published','synthetic-proof-school',clock_timestamp()) RETURNING id",[household,membership]);
await db.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[household,message,people[2]]);
await db.query("INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'delivered')",[household,message,display]);
const schoolEvent=await id("INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_type,description,actions,evidence,confidence,source_fingerprint,message_id,school_expires_at) VALUES($1,$2,'synthetic-proof-school',(clock_timestamp() AT TIME ZONE 'Europe/Oslo')::date,'preparation','Synthetic school activity','[\"Pack synthetic item\"]',$3,0.9,'synthetic-proof-fingerprint',$4,clock_timestamp()+interval '2 days') RETURNING id",[household,task,JSON.stringify({sourceUrl:'https://school.test.invalid/event',quote:'Synthetic saved evidence'}),message]);
const snapshot=async()=> (await db.query("SELECT to_jsonb(d)-ARRAY['credential_hash','credential_expires_at','credential_generation','last_seen_at'] AS display,(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.person_id) FROM display_person_grants g WHERE g.display_id=d.id) AS grants FROM displays d WHERE d.id=$1",[display])).rows[0];
const before=await snapshot();
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
   const ctx=await browser.newContext({baseURL:origin,viewport:{width:1280,height:752},reducedMotion:'reduce'});
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
 const adminCtx=await make(),oldCtx=await make(),newCtx=await make();
 await adminCtx.addCookies([{name:'samvev_session',value:'synthetic-display-manager',url:origin},{name:'samvev_csrf',value:'synthetic-display-csrf',url:origin}]);
 await oldCtx.addCookies([{name:'samvev_display',value:'synthetic-old-display',domain:'127.0.0.1',path:'/api/v1/display'}]);
 const admin=await adminCtx.newPage(),old=await oldCtx.newPage(),screen=await newCtx.newPage();
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
 const semantic=value=>({cards:value.setup.cardOrder,selectedPeople:[...value.setup.personIds].sort(),profiles:value.familyLayout.people.map(person=>person.id).sort(),boardReadable:value.householdBoards.readable,boardWritable:value.householdBoards.writable,groceries:value.householdBoards.groceries.length});
 assert.deepEqual(semantic(preview),semantic(live));
 assert.deepEqual(semantic(live),{cards:['family_layout','today','groceries'],selectedPeople:[...people].sort(),profiles:[...people].sort(),boardReadable:{groceries:false,dinners:false},boardWritable:{groceries:false,dinners:false},groceries:0});
 const date=preview.householdBoards.from;
 const liveDay=await screen.evaluate(async date=>{const response=await fetch(`/api/v1/display/activities?from=${date}&to=${date}&limit=50`);return {status:response.status,body:await response.json()};},date);
 assert.equal(liveDay.status,200);
 const previewToday=preview.dayActivities.activities.filter(activity=>activity.date===date);
 assert.equal(liveDay.body.activities.length,1,'one synthetic school activity is visible today');
 assert.deepEqual(previewToday.map(activity=>({id:activity.id,type:activity.type})),liveDay.body.activities.map(activity=>({id:activity.id,type:activity.type})), 'Today preview and live activity counts and identity');
 assert.equal(previewToday[0].id,schoolEvent);
 await screen.locator('.hub-person-section').waitFor();
 await admin.locator('dialog button.button').filter({hasText:'Lukk'}).click();
 await admin.locator('summary').filter({hasText:'Datatilgang'}).click();
 await admin.getByRole('button',{name:'Forhåndsvis denne skjermen'}).click();
 const previewDom=admin.locator('.display-preview');await previewDom.waitFor();
 await admin.getByLabel('Retning for forhåndsvisning').selectOption('portrait');
 assert.equal(await admin.locator('.display-preview-portrait').count(),1);
 for(const name of ['Synthetic adult','Synthetic adult two','Synthetic child one','Synthetic child two','Synthetic child three','Synthetic child four']) {
   assert.equal(await previewDom.getByText(name,{exact:true}).count(),1,`preview renders ${name} once`);
   assert.equal(await screen.getByText(name,{exact:true}).count(),1,`display renders ${name} once`);
 }
 for(const surface of [previewDom,screen.locator('body')]){
   assert.equal(await surface.getByText('Synthetic unshared grocery',{exact:true}).count(),0);
   assert.equal(await surface.getByText('Denne tavlen er ikke delt med skjermen.',{exact:true}).count(),1);
   assert.ok(await surface.getByText('Kalenderinnhold er slått av for denne skjermen. Slå det på under Datatilgang.',{exact:true}).count()<=1,'no duplicate calendar warning');
   assert.equal(await surface.getByText('Synthetic school activity',{exact:true}).count(),1,'Today activity appears once');
   assert.ok(await surface.locator('.hub-hero').count()<=1,'no duplicate welcome');
   assert.ok(await surface.locator('.hub-hero-clock').count()<=1,'no duplicate clock');
   assert.equal(await surface.locator('.board-add-row').count(),0,'no unshared board actions');
 }
 assert.equal(await previewDom.locator('.display-preview-today').count(),1);
 assert.equal(await screen.locator('section[aria-label="I dag"]').count(),1);

} finally {shuttingDown=true;releaseRedeem();for(const context of contexts) await context.unrouteAll({behavior:'ignoreErrors'});await browser?.close();await new Promise(resolve=>server.close(resolve));await db.end();}
console.log('PASS real browser re-pair and six-person preview/live parity; unshared grocery remains hidden.');
