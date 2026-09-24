// Real local API E2E. All content and identities are synthetic; no external service is contacted.
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
const baseURL=process.env.BASE_URL??'http://qa-app:4173';
if(!['qa-app','127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw Error('M3 harness requires isolated local QA origin');
const out=process.env.M3_ARTIFACT_DIR??'docs/implementation/artifacts/m3';await mkdir(out,{recursive:true});
const browser=await chromium.launch();const context=await browser.newContext({baseURL,reducedMotion:'reduce',viewport:{width:1440,height:1000}});const screenContext=await browser.newContext({baseURL,reducedMotion:'reduce',viewport:{width:1920,height:1080}});
const checks=[];const errors=[];const record=t=>{checks.push(t);console.log(`PASS ${t}`)};
const req=async(ctx,path,method='GET',data,headers={})=>{const r=await ctx.request.fetch(`/api/v1${path}`,{method,data,headers});expect(r.ok(),`${method} ${path}: ${await r.text()}`).toBeTruthy();return r.status()===204?null:r.json()};
try {
 const login=await req(context,'/auth/login','POST',{email:'admin@demo.invalid',password:'Synthetic-demo-pass-42'});
 const me=await req(context,'/me');const member=me.memberships[0];const base=`/households/${member.household_id}`;const csrf={'X-CSRF-Token':me.csrfToken};
 const admin=(path,method='GET',data)=>req(context,path,method,data,csrf);
 await admin('/me/preferences','PATCH',{locale:'nb',theme:'light'});
 await admin('/setup/progress','PATCH',{setupStep:'complete'});
 let people=(await admin(`${base}/people`)).people;
 for(let i=people.length;i<4;i++)await admin(`${base}/people`,'POST',{displayName:['Ari','Mio','Liv','Noa'][i]+' · eksempel',ageGroup:'unspecified',rolePreset:'limited',capabilities:['household.view'],displayIds:[]});
 people=(await admin(`${base}/people`)).people;
 // Independently browser-bound pairing credential; neither session nor integration token substitutes for it.
 const verifier=randomBytes(32).toString('base64url');const pairing=await req(screenContext,'/display/pairing/start','POST',{verifierHash:createHash('sha256').update(verifier).digest('hex')});
 await admin(`${base}/displays/pairing/approve`,'POST',{code:pairing.code,name:'Familietavle · syntetisk',locale:'nb',theme:'light',privacyMode:false,allowedContent:'household_messages'});
 await req(screenContext,'/display/pairing/redeem','POST',{pairingId:pairing.pairingId,verifier});
 const initial=await req(screenContext,'/display/projection');const displayId=initial.display.id;
 await admin(`${base}/displays/${displayId}`,'PATCH',{externalItemsEnabled:true});
 const connection=await admin(`${base}/integrations`,'POST',{name:`Syntetisk familiebrief ${Date.now()}`,displayIds:[displayId],credential:{name:'Lokal QA',capabilities:['integration.items.write','integration.items.read','integration.items.delete'],expiresAt:null}});
 const bearer={Authorization:`Bearer ${connection.credentialToken}`};const machine=(path,method='GET',data)=>req(context,path,method,data,bearer);
 const now=new Date();const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);const tomorrow=new Date(Date.parse(`${today}T12:00:00Z`)+86400000).toISOString().slice(0,10);
 const expire=new Date(Date.now()+3*86400000).toISOString();const source={label:'Familiebrief · syntetisk',url:'https://example.invalid/plan',links:[],observedAt:now.toISOString(),generatedAt:now.toISOString(),uncertainty:'low'};
 const oldMessages=(await admin(`${base}/messages`)).messages;
 for(const message of oldMessages)if(message.body.startsWith('Syntetisk familiehilsen:')&&['published','scheduled'].includes(message.state))await admin(`${base}/messages/${message.id}/withdraw`,'POST',{expectedRevision:message.revision});
 await admin(`${base}/messages`,'POST',{body:'Syntetisk familiehilsen: Gleder meg til middag sammen. Det er plass til en liten pause i dag. ♡',importance:'normal',audience:{household:true,personIds:[],displayIds:[displayId]},expiresAt:expire,idempotencyKey:randomBytes(24).toString('hex')});
 const payload=(id,kind,title,body,personIds=[],extras={})=>({externalId:id,expectedRevision:0,contentLocale:'nb',kind,title,body,entries:[],priority:'normal',publishAt:new Date(Date.now()-60000).toISOString(),startsAt:null,endsAt:null,expiresAt:expire,targets:{household:!personIds.length,personIds,displayIds:[displayId]},source,metadata:{},...extras});
 // Revoke prior harness connections so repeat runs have a deterministic family board.
 const listed=await admin(`${base}/integrations`);for(const c of listed.connections)if(c.id!==connection.connection.id&&c.name.startsWith('Syntetisk familiebrief')&&!c.revokedAt)await admin(`${base}/integrations/${c.id}/revoke`,'POST',{expectedRevision:c.revision});
 const fixtures=[
 payload('rain','reminder','Regntøy i sekken','En liten påminnelse før morgendagen.',[people[1].id],{priority:'high'}),
 payload('meeting','alert','Foreldremøte i morgen','Sett av en rolig time sammen med skolen.',[],{priority:'high'}),
 payload('brief','summary','Klar for en ny dag','Litt regn, en hyggelig avtale og god tid til å spise sammen. Her er det viktigste for morgendagen.'),
 payload('list','list','Før vi går ut døren','Små ting som gjør morgenen enklere.',[],{entries:[{label:'Matboks og drikkeflaske'},{label:'Regnjakke',detail:'Legg den klar ved døren.'}]}),
 payload('observation','observation','En roligere ettermiddag','Ingen overlapp mellom dagens avtaler.'),
 payload('school','event','Skole og barnehage','Sekken er klar ved døren.',[people[1].id,people[2].id],{startsAt:`${today}T06:15:00Z`,metadata:{category:'school'}}),
 payload('dance','event','Dans på kulturhuset','Husk vannflasken.',[people[2].id],{startsAt:`${today}T14:30:00Z`,metadata:{category:'activity'}}),
 payload('dinner','event','Middag sammen','En liten pause rundt bordet.',[people[0].id],{startsAt:`${today}T16:00:00Z`,metadata:{category:'meal'}}),
 payload('tomorrow','event','Ut på tur','Ta med gode sko.',[people[3].id],{startsAt:`${tomorrow}T08:00:00Z`,metadata:{category:'activity'}})
 ];
 for(const item of fixtures)await machine('/integrations/items','POST',item);
 const page=await context.newPage();const screen=await screenContext.newPage();for(const p of [page,screen])p.on('pageerror',e=>errors.push(e.message));
 let navigations=0;page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())navigations++});
 const events=[];await page.addInitScript(()=>{window.__m3Events=[];const Native=window.EventSource;window.EventSource=class extends Native{constructor(...args){super(...args);this.addEventListener('projection-invalidated',e=>window.__m3Events.push(e.data));}}});
 await page.goto('/');await screen.goto('/display');await expect(page.locator('.hub-hero h1')).toBeVisible();await expect(screen.locator('.hub-hero h1')).toBeVisible();
 await expect.poll(async()=>{const messages=(await admin(`${base}/messages`)).messages;return messages.some(message=>message.body.startsWith('Syntetisk familiehilsen:')&&message.deliveries.some(delivery=>delivery.displayId===displayId&&delivery.state==='displayed'))}).toBe(true);record('visible family-hub message retains actual display render acknowledgment');
 await expect(page.locator('.hub-important h3').first()).toHaveAttribute('lang','nb');
 await expect(screen.locator('.hub-important h3').first()).toHaveAttribute('lang','nb');
 const english=payload('locale-proof','summary','An English family brief','The source language stays English.',[],{contentLocale:'en'});
 await machine('/integrations/items','POST',english);
 await expect(page.getByRole('heading',{name:english.title,exact:true})).toHaveAttribute('lang','en');
 await expect(page.locator('html')).toHaveAttribute('lang','nb');
 await expect(screen.getByRole('heading',{name:english.title,exact:true})).toHaveAttribute('lang','en');
 await machine('/integrations/items/locale-proof','DELETE',{expectedRevision:1});
 await expect(page.getByRole('heading',{name:english.title,exact:true})).toHaveCount(0);
 record('producer NB/EN content language is declared independently of viewer locale without translation');
 const before=navigations;const live=payload('live-proof','reminder','Direkte fra familiebriefen','Denne kom uten å laste siden på nytt.',[people[0].id]);await machine('/integrations/items','POST',live);
 await expect(page.locator('.hub-important').getByText(live.title,{exact:true})).toBeVisible();await expect(screen.locator('.hub-important').getByText(live.title,{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__m3Events.length)).toBeGreaterThan(0);expect(navigations).toBe(before);
 await machine('/integrations/items/live-proof','DELETE',{expectedRevision:1});await expect(page.getByText(live.title,{exact:true})).toHaveCount(0);await expect(screen.getByText(live.title,{exact:true})).toHaveCount(0);record('real bearer POST → PostgreSQL → member/display SSE → DOM and withdrawal without reload');
 expect((await machine('/integrations/items','POST',fixtures[0])).result).toBe('unchanged');record('canonical repeat is idempotent');
 await expect(page.locator('.hub-person')).toHaveCount(people.length);await expect(page.locator('.hub-day').nth(1)).toContainText('Ut på tur');
 await page.locator('.hub-agenda .hub-item-title').first().click();await page.getByRole('dialog').locator('summary').click();await expect(page.getByRole('dialog')).toContainText('Usikkerhet: Lav');await expect(page.getByRole('dialog').locator('h2')).toHaveAttribute('lang','nb');await page.getByRole('dialog').getByRole('button',{name:'Lukk',exact:true}).click();record('target-person columns, event-time Today/Tomorrow, structured lists and expandable provenance');
 const axe=async(p,label)=>{const result=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,data:n.any.map(a=>a.data)}))})),label).toEqual([])};
 const shot=async(p,name,width,height)=>{await expect(p.locator('.family-hub')).toBeVisible();await p.setViewportSize({width,height});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:`${out}/${name}.png`,fullPage:false});if(name.startsWith('mobile-')||name.startsWith('tv-'))await p.screenshot({path:`${out}/${name}-full.png`,fullPage:true});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow`).toBe(true);await axe(p,name)};
 for(const theme of ['light','dark']){
   await admin('/me/preferences','PATCH',{locale:'nb',theme});await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
   await shot(page,`mobile-${theme}`,390,844);await shot(page,`ipad-portrait-${theme}`,820,1180);await shot(page,`ipad-landscape-${theme}`,1180,820);
   await admin(`${base}/displays/${displayId}`,'PATCH',{theme});await expect(screen.locator('html')).toHaveAttribute('data-theme',theme,{timeout:12000});
   await shot(screen,`tv-1920-${theme}`,1920,1080);await shot(screen,`shelly-1280-${theme}`,1280,752);expect(await screen.locator('.hub-person-items .hub-item-title strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 }
 record('10 requested mobile/iPad/TV/Shelly light/dark screenshots; no horizontal overflow; Axe WCAG A/AA');
 await admin('/me/preferences','PATCH',{locale:'en',theme:'system'});await page.emulateMedia({colorScheme:'dark'});await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.getByRole('heading',{name:/Good morning, everyone.|Hello, everyone.|Good evening, everyone./})).toBeVisible();await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await axe(page,'English system');
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#main')).toBeFocused();
 expect(await page.locator('.button').first().evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');record('NB/EN, system color changes, keyboard skip/focus and reduced motion');
 // Controlled presentation stress only: real API scenarios above remain unmocked.
 const homeSnapshot=await admin(`${base}/home`);
 for(const count of [1,4,8]){
   const stressPeople=Array.from({length:count},(_,index)=>({id:`stress-${index}`,displayName:index===0?'Alexandria · et langt syntetisk familienavn':`Person ${index+1} · syntetisk`}));
   const stressItems=homeSnapshot.items.map((item,index)=>({...item,id:`stress-item-${index}`,targets:{household:false,personIds:[stressPeople[index%count].id]},...(index===0?{title:'En lengre syntetisk huskelapp som skal brytes pent på små skjermer',body:'Lesbarhet må bevares også når innholdet trenger litt mer plass. '.repeat(5)}:{})}));
   await page.route(`**/api/v1${base}/home`,route=>route.fulfill({json:{...homeSnapshot,people:stressPeople,items:stressItems}}));
   await page.reload();await expect(page.locator('.hub-person')).toHaveCount(count);
   for(const width of [390,1280]){await page.setViewportSize({width,height:width===390?844:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
   if(count===8){await page.screenshot({path:`${out}/stress-eight-people.png`,fullPage:true});await axe(page,'Eight people long content')}
   await page.unroute(`**/api/v1${base}/home`);
 }
 await page.reload();await expect(page.locator('.hub-person')).toHaveCount(people.length);record('1/4/8 dynamic people, long names/content, mobile/desktop overflow and stress Axe');
 const uiName=`Synthetic UI credential ${Date.now()}`;
 // Admin UI: token shown once, never stored; revoke through confirmation dialog.
 await page.getByRole('button',{name:'More',exact:true}).click();await page.locator('.hub-more-card').filter({has:page.getByRole('heading',{name:'Integrations',exact:true})}).click();await page.getByRole('button',{name:'Add connection',exact:true}).click();await page.getByLabel('Connection name',{exact:true}).fill(uiName);await page.getByLabel('Credential name',{exact:true}).fill('Synthetic UI writer');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('dialog',{name:'Save your access token'})).toBeVisible();const clear=await page.getByLabel('Access token',{exact:true}).inputValue();expect(clear).toMatch(/^samvev_it_/);expect(await page.evaluate(t=>JSON.stringify(localStorage).includes(t)||JSON.stringify(sessionStorage).includes(t),clear)).toBe(false);await page.getByRole('button',{name:'I have saved the token'}).click();await expect(page.getByLabel('Access token',{exact:true})).toHaveCount(0);await axe(page,'Integration administration');
 const card=page.locator('.integration-card').filter({has:page.getByRole('heading',{name:uiName,exact:true})});await card.getByRole('button',{name:'Revoke connection',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Revoke access',exact:true}).click();await expect(card).toContainText('Access revoked');record('integration UI scoped credential creation, one-time reveal, no local token persistence and revoke');
 // Expiring item must leave the offline projection before the 15-minute cache expires.
 await machine('/integrations/items','POST',payload('offline-expiry','reminder','Kortlevd syntetisk huskelapp','Forsvinner også uten nett.',[],{expiresAt:new Date(Date.now()+8000).toISOString()}));await expect(screen.getByText('Kortlevd syntetisk huskelapp',{exact:true})).toBeVisible();await screenContext.setOffline(true);await expect(screen.getByText('Kortlevd syntetisk huskelapp',{exact:true})).toHaveCount(0,{timeout:15000});await screenContext.setOffline(false);record('external item expires while offline before authorization-cache deadline');
 expect(errors).toEqual([]);await writeFile(`${out}/results.json`,JSON.stringify({executedAt:new Date().toISOString(),checks,errors,screenshots:15},null,2));
} finally {await context.close();await screenContext.close();await browser.close()}
