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
await id("INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id",[household,account,person,JSON.stringify(roleCapabilityPresets.household_admin)]);
await db.query("INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[account,hash('synthetic-display-manager'),hash('synthetic-display-csrf')]);
const setup=await id("INSERT INTO display_setups(household_id,name,locale,theme,cards,card_order) VALUES($1,'Synthetic shared setup','nb','dark','[\"today\"]','[\"today\"]') RETURNING id",[household]);
await db.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[household,setup,person]);
const display=await id("INSERT INTO displays(household_id,setup_id,name,locale,theme,credential_hash,credential_expires_at) VALUES($1,$2,'Synthetic wall display','nb',NULL,$3,clock_timestamp()+interval '1 hour') RETURNING id",[household,setup,hash('synthetic-old-display')]);
await db.query('INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed) VALUES($1,$2,$3,true)',[household,display,person]);
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
} finally {shuttingDown=true;releaseRedeem();for(const context of contexts) await context.unrouteAll({behavior:'ignoreErrors'});await browser?.close();await new Promise(resolve=>server.close(resolve));await db.end();}
console.log('PASS real browser re-pair; old 401, replacement 200, same display, setup and grants.');
