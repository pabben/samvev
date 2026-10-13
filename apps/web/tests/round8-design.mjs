// Round 8 consumes real scoped fixtures in the isolated test server. It never
// seeds/resets LAN QA. A new message is submitted and withdrawn only through
// the isolated application. Later injected stress/permission DTOs are labelled;
// no live account or provider transport is exercised.
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=process.env.ROUND8_TEST_BASE_URL;
if(base!=='http://round8-test-app:4173')throw new Error('ROUND8_TEST_BASE_URL must equal http://round8-test-app:4173');
const out=process.env.ROUND8_ARTIFACT_DIR??'.local/m3/design-round8/browser';
const sourceSha=process.env.ROUND8_SOURCE_SHA;
if(!/^[a-f0-9]{40}$/.test(sourceSha??''))throw new Error('ROUND8_SOURCE_SHA required');
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce',serviceWorkers:'block'});
const page=await context.newPage();
const checks=[],failures=[],screenshots=[],blocked=[],providerRequests=[];
let csrf,originalPrefs,householdId,createdMessage,completed=false;
const record=(name,detail={})=>{checks.push({name,...detail});console.log(`PASS ${name}`)};
const group=async(name,fn)=>{try{await fn();record(name)}catch(error){failures.push({name,error:error.message});console.error(`FAIL ${name}: ${error.message}`);if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');}};
page.on('pageerror',error=>failures.push({name:'pageerror',error:error.message}));
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){blocked.push(route.request().url());return route.abort()}return route.continue()});
await context.route('**/api/v1/households/*/ai/**',route=>{if(route.request().method()!=='GET'||route.request().url().includes('/models')){providerRequests.push(`${route.request().method()} ${route.request().url()}`);return route.abort()}return route.continue()});
const api=async(path,method='GET',data)=>{const response=await context.request.fetch(`${base}/api/v1${path}`,{method,data,headers:method==='GET'?{}:{'X-CSRF-Token':csrf}});if(!response.ok())throw new Error(`${method} ${path}: ${response.status()}`);return response.status()===204?null:response.json()};
const prefs=async(locale,theme)=>api('/me/preferences','PATCH',{locale,theme});
const rect=locator=>locator.evaluate(node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right}});
const clearBottom=()=>page.evaluate(()=>{const nav=document.querySelector('.sidebar');if(!nav||getComputedStyle(nav).position!=='fixed')return innerHeight;const bounds=nav.getBoundingClientRect();const bottomBar=bounds.top>0&&bounds.left<=0&&bounds.right>=innerWidth&&bounds.bottom>=innerHeight;return bottomBar?bounds.top:innerHeight});
const fullyAbove=async(locator,bottom)=>{const b=await rect(locator);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.bottom).toBeLessThanOrEqual(bottom);return b};
const accessible=async(label)=>{
 const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
 expect(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),`${label} Axe`).toEqual([]);
 const tooSmall=await page.locator('button,a[href],summary').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!n.closest('[inert]')&&!n.closest('dialog:not([open])')).filter(n=>{const r=n.getBoundingClientRect();return r.width<44||r.height<44}).map(n=>n.textContent?.trim()));
 expect(tooSmall,`${label} 44px targets`).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} page overflow`).toBeTruthy();
};
const capture=async(filename,theme,surface,injectedTransport=false,fullPage=false)=>{await page.screenshot({fullPage,path:`${out}/${filename}`});const bytes=await readFile(`${out}/${filename}`);screenshots.push({filename,commitSha:sourceSha,capturedAt:new Date().toISOString(),viewport:page.viewportSize(),theme,surface,fullPage,locale:'nb',dataState:injectedTransport?'explicit synthetic DTO injection':'actual isolated synthetic API/database',injectedTransport,sha256:createHash('sha256').update(bytes).digest('hex')})};
const goHome=async(theme,width,height,locale='nb')=>{await prefs(locale,theme);await page.setViewportSize({width,height});await page.goto(base);await page.getByTestId('family-hub').waitFor();await page.locator('.hub-live-status').waitFor();await page.evaluate(()=>document.fonts.ready);await page.locator('.hub-identities img,.hub-person img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
const fixture=JSON.parse(await readFile('.local/m3/design-round8/rich/fixture.json','utf8'));
const navAI=async()=>{await page.locator('nav.admin-navigation').getByRole('button',{name:/^(Mer|More)$/}).click();await page.getByRole('button',{name:/^(AI og forbruk|AI and usage)$/}).click();await page.locator('#ai-usage-panel').waitFor()};
try{
 await page.goto(base);await page.locator('input[name=email]').fill('admin');await page.locator('input[name=password]').fill('admin');await page.getByRole('button',{name:/sign in|logg inn/i}).click();await page.getByTestId('family-hub').waitFor();
 const me=await api('/me');csrf=me.csrfToken;householdId=me.memberships[0].household_id;originalPrefs={locale:me.account.locale,theme:me.account.theme};
 const home=await api(`/households/${householdId}/home`);
 expect(home.people).toHaveLength(5);expect(home.messages).toHaveLength(1);expect(home.items).toHaveLength(9);expect(householdId).toBe(fixture.householdId);
 const fifth=home.people.find(person=>person.id===fixture.fifthPersonId);expect(fifth).toBeTruthy();
 const fifthItems=home.items.filter(item=>!item.targets.household&&item.targets.personIds.includes(fifth.id));expect(fifthItems.length).toBeGreaterThan(0);
 record('real isolated five-person Home with fifth-person content and human message',{injectedTransport:false});
 for(const theme of ['light','dark'])for(const [name,width,height]of[['desktop-1920',1920,1080],['mobile',390,844],['ipad-portrait',820,1180],['ipad-landscape',1180,820],['shelly-1280',1280,752]]){
  await goHome(theme,width,height);await capture(`five-${name}-${theme}.png`,theme,'five-person-member-home');
  if(name==='desktop-1920'&&theme==='light')await capture('five-desktop-1920-light-full.png',theme,'five-person-member-home',false,true);
  await group(`five people ${name} ${theme}: identities, priority content and whole controls`,async()=>{
   const identities=page.locator('button[data-hub-detail-kind=person][data-person-id]');await expect(identities).toHaveCount(5);
   for(const person of home.people){const identity=identities.filter({hasText:person.displayName});await expect(identity).toContainText(person.displayName);expect((await rect(identity)).height).toBeGreaterThanOrEqual(44);}
   if(width>1000){
    const boundary=await clearBottom();for(const identity of await identities.all())await fullyAbove(identity,boundary-8);
    const today=page.locator('.hub-today .hub-timeline>li');await expect(today).toHaveCount(3);for(const row of await today.all())await fullyAbove(row,boundary-8);
    await fullyAbove(page.locator('.hub-important .hub-reminder').first(),boundary-8);
    await fullyAbove(page.locator('.hub-messages .hub-message-open'),boundary-8);await expect(page.locator('.hub-message-meta strong')).toHaveText(home.messages[0].authorName);
    for(const control of await page.locator('.hub-important button,.hub-support button,.hub-messages button').all()){await fullyAbove(control,boundary-8);const bounds=await rect(control);expect(bounds.width).toBeGreaterThanOrEqual(44);expect(bounds.height).toBeGreaterThanOrEqual(44);}
    if(theme==='light'){
     const cards=await page.locator('.hub-person').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{top:b.top,bottom:b.bottom,width:b.width}}));
     expect(Math.max(...cards.map(c=>c.top))-Math.min(...cards.map(c=>c.top)),'bounded five-person fixture fits a shared row').toBeLessThan(2);
     expect(Math.max(...cards.map(c=>c.bottom))).toBeLessThan(boundary-8);
    }else{
     const reminders=page.locator('.hub-important .hub-reminder');await expect(reminders).toHaveCount(2);for(const reminder of await reminders.all())await fullyAbove(reminder,boundary-8);
    }
   }
  });
  await group(`five people ${name} ${theme}: actual fifth details and focus`,async()=>{
   const trigger=page.locator(`button[data-hub-detail-kind=person][data-person-id="${fifth.id}"]`);
   await expect(trigger).toHaveAccessibleName(`Åpne alle ${fifthItems.length} punkter for ${fifth.displayName}`);
   if(width>640){const card=page.locator(`.hub-person[data-person-id="${fifth.id}"]`);await expect(card).not.toContainText('Ingenting ekstra å huske');await expect(card.locator('.hub-person-name>span')).toContainText(String(fifthItems.length));await expect(card.locator('.hub-person-name>span')).toBeVisible();}
   await trigger.click();const dialog=page.getByRole('dialog');
   await expect(dialog).toHaveAccessibleName(fifth.displayName);
   for(const item of fifthItems){const card=dialog.locator(`[data-item-id="${item.id}"]`);await expect(card).toContainText(item.body);for(const entry of item.entries){await expect(card).toContainText(entry.label);if(entry.detail)await expect(card).toContainText(entry.detail)}}
   await accessible('fifth person details');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  });
  await page.evaluate(()=>scrollTo(0,0));await group(`five people ${name} ${theme}: accessibility`,()=>accessible(`${name} ${theme}`));
 }
 await group('actual fifth person persists through resize and system-theme changes with focus return',async()=>{
  await page.emulateMedia({colorScheme:'light'});await goHome('system',1920,1080);
  const identity=page.locator(`button[data-hub-detail-kind=person][data-person-id="${fifth.id}"]`);await identity.click();
  const dialog=page.getByRole('dialog');await dialog.locator('button').first().focus();
  for(const [width,height,scheme]of[[1180,820,'dark'],[820,1180,'light'],[390,844,'dark'],[1920,1080,'light']]){
   await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:scheme});await expect(page.locator('html')).toHaveAttribute('data-theme',scheme);
   await expect(dialog).toHaveAccessibleName(fifth.displayName);await expect(dialog.locator('button').first()).toBeFocused();await expect(dialog).toContainText(fifthItems[0].body);
  }
  await page.keyboard.press('Escape');await expect(identity).toBeFocused();
 });
 await goHome('light',390,844);
 await group('counted reminders and full human message retain access and focus',async()=>{
  const collection=page.locator('[data-hub-detail-kind=collection][data-hub-detail=important]');await collection.click();const dialog=page.getByRole('dialog');expect(await dialog.locator('[data-item-id]').count()).toBe(2);await page.keyboard.press('Escape');await expect(collection).toBeFocused();
  const message=page.locator('.hub-message-open').first();await message.click();await expect(page.locator('.hub-message-full .display-card-body')).toHaveText(home.messages[0].body);await page.keyboard.press('Escape');await expect(message).toBeFocused();
 });
 await group('light mobile compose opens, cancels with focus and submits through the actual isolated API',async()=>{
  await goHome('light',390,844);const trigger=page.locator('.hub-feed-compose');await trigger.click();
  const dialog=page.getByRole('dialog');await expect(dialog).toHaveAccessibleName('Noe du vil dele?');await expect(dialog.locator('textarea')).toBeVisible();
  await dialog.getByRole('button',{name:'Avbryt',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  await trigger.click();const body=`Syntetisk runde 8: En liten familiehilsen fra isolert testmiljø.`;await dialog.locator('textarea').fill(body);await accessible('message composer');
  const responsePromise=page.waitForResponse(response=>response.url()===`${base}/api/v1/households/${householdId}/messages`&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Publiser beskjed',exact:true}).click();const response=await responsePromise;expect(response.ok()).toBeTruthy();const saved=await response.json();createdMessage=saved.message??saved;expect(createdMessage.id).toBeTruthy();
  await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();await expect.poll(async()=>{const current=await api(`/households/${householdId}/home`);return current.messages.find(message=>message.id===createdMessage.id)?.body}).toBe(body);
  await expect(page.locator('.hub-messages .hub-count')).toHaveText(String(home.messages.length+1),{timeout:10000});
  const inline=page.locator(`.hub-messages .hub-message[data-card-id="${createdMessage.id}"]`);
  if(await inline.isVisible())await expect(inline.locator('.display-card-body')).toHaveText(body);
  else{
   // Compact Home intentionally previews one message. Follow its real counted
   // collection to verify the newly stored message rather than assuming order.
   const collection=page.locator('.hub-messages [data-hub-detail-kind=collection][data-hub-detail=messages]');
   await expect(collection).toContainText(String(home.messages.length+1));await collection.click();
   await expect(dialog.locator('[data-collection=messages] .hub-message')).toHaveCount(home.messages.length+1);
   await expect(dialog.locator(`.hub-message[data-card-id="${createdMessage.id}"] .display-card-body`)).toHaveText(body);
   await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(collection).toBeFocused();
  }
  await api(`/households/${householdId}/messages/${createdMessage.id}/withdraw`,'POST',{expectedRevision:createdMessage.revision});createdMessage=null;
  await expect.poll(async()=>(await api(`/households/${householdId}/home`)).messages.map(message=>message.id).sort()).toEqual(home.messages.map(message=>message.id).sort());
  await expect(page.locator('.hub-messages .hub-count')).toHaveText(String(home.messages.length),{timeout:10000});
 });
 for(const theme of ['light','dark'])await group(`unchanged AI overview ${theme} remains accessible`,async()=>{
  await goHome(theme,390,844);await navAI();await expect(page.locator('#ai-usage-panel')).toBeVisible();await expect(page.locator('#ai-setup-panel')).toBeHidden();await expect(page.locator('.ai-cost-overview h3').first()).toHaveText('Kjent kredittanslag');await expect(page.locator('.ai-overview-caveat')).toContainText('alle bruksveier');await accessible('unchanged AI overview');
 });
 // Additional transport stress begins only after actual five-person screenshots.
 // Four-person baseline screenshots come separately from a real four-person DB.
 const homeRoute=`**/api/v1/households/${householdId}/home`;let injected=home;await page.route(homeRoute,route=>route.fulfill({json:injected}));
 for(const theme of ['light','dark'])for(const [width,height]of[[390,844],[820,1180]])await group(`four-person ${theme} ${width} priority regression (injected DTO)`,async()=>{
  injected={...home,people:home.people.slice(0,4)};await goHome(theme,width,height);const boundary=await clearBottom();
  if(width===390){
   const today=page.locator('.hub-today .hub-timeline>li');await expect(today).toHaveCount(theme==='dark'?3:1);for(const row of await today.all())await fullyAbove(row,boundary);
   if(theme==='light')await fullyAbove(page.locator('.hub-feed-compose'),boundary);
  }else{
   await fullyAbove(page.locator('.hub-important .hub-reminder').first(),boundary);await fullyAbove(page.locator('.hub-messages .hub-message-meta strong').first(),boundary);
   if(theme==='dark'){const preview=page.locator('.hub-important .hub-reminder').first();const grid=await rect(page.locator('.hub-important-grid'));expect((await rect(preview)).width/grid.width).toBeGreaterThan(.98);}
  }
  await accessible('four-person compact regression');
 });
 for(const count of [4,5,6,8])for(const theme of ['light','dark'])for(const [width,height]of[[1920,1080],[1180,820],[1280,752]])await group(`${count} long identities ${theme} ${width} preserve access (injected DTO)`,async()=>{
  const people=Array.from({length:count},(_,i)=>({...home.people[i%5],id:`synthetic-r8-person-${i}`,displayName:`Synthetic person ${i+1} with a deliberately long accessible name`}));
  const items=people.map((person,i)=>({...home.items.find(item=>item.kind==='event'),id:`synthetic-r8-item-${i}`,targets:{household:false,personIds:[person.id]},title:`Synthetic detailed personal event ${i+1}`,body:`Complete synthetic content for person ${i+1}, retained across responsive transitions.`,expiresAt:new Date(Date.now()+600000).toISOString()}));
  injected={...home,people,items};await goHome(theme,width,height,'en');const identities=page.locator('button[data-hub-detail-kind=person][data-person-id]');await expect(identities).toHaveCount(count);
  expect(await identities.evaluateAll(nodes=>nodes.map(n=>n.dataset.personId))).toEqual(people.map(person=>person.id));
  for(const [i,person]of people.entries()){
   const trigger=page.locator(`button[data-hub-detail-kind=person][data-person-id="${person.id}"]`);await trigger.click();await expect(page.getByRole('dialog')).toHaveAccessibleName(person.displayName);await expect(page.getByRole('dialog')).toContainText(items[i].body);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  }
  await accessible('long roster');
 });
 await group('4 to 5 to 6 to 8 live roster keeps keyed identities and selected person (injected DTO)',async()=>{
  const selected=home.people[0];const rosters=[4,5,6,8].map(count=>Array.from({length:count},(_,i)=>i<5?home.people[i]:{...home.people[0],id:`synthetic-live-person-${i}`,displayName:`Synthetic extra ${i+1}`}));
  injected={...home,people:rosters[0]};await goHome('light',1180,820);
  const trigger=page.locator(`button[data-hub-detail-kind=person][data-person-id="${selected.id}"]`);await trigger.evaluate(node=>{window.round8Identity=node});await trigger.click();
  for(const people of rosters.slice(1)){
   injected={...home,people};await expect(page.locator('.hub-person')).toHaveCount(people.length,{timeout:10000});await expect(page.getByRole('dialog')).toHaveAccessibleName(selected.displayName);
   expect(await trigger.evaluate(node=>window.round8Identity===node),'same keyed identity node after roster change').toBeTruthy();
  }
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
 });
 await page.unroute(homeRoute);
 await group('read-only capability projection retains no compose action (injected session DTO)',async()=>{
  const meRoute='**/api/v1/me';const readonly={...me,memberships:me.memberships.map(member=>({...member,capabilities:member.capabilities.filter(capability=>capability!=='message.create.household')}))};await page.route(meRoute,route=>route.fulfill({json:readonly}));
  try{for(const theme of ['light','dark']){readonly.account={...readonly.account,theme,locale:'nb'};await page.setViewportSize({width:390,height:844});await page.goto(base);await page.getByTestId('family-hub').waitFor();await expect(page.locator('.hub-feed-compose,.hub-compose')).toHaveCount(0);await expect(page.locator('.family-hub').getByRole('button',{name:'Ny beskjed',exact:true})).toHaveCount(0);}}finally{await page.unroute(meRoute)}
 });
 expect(blocked).toEqual([]);expect(providerRequests).toEqual([]);completed=failures.length===0;
}finally{
 if(createdMessage&&csrf){try{await api(`/households/${householdId}/messages/${createdMessage.id}/withdraw`,'POST',{expectedRevision:createdMessage.revision})}catch(error){failures.push({name:'synthetic message cleanup',error:error.message});completed=false}}
 if(originalPrefs&&csrf){try{await api('/me/preferences','PATCH',originalPrefs);await api('/auth/logout','POST',{})}catch(error){failures.push({name:'cleanup',error:error.message});completed=false}}
 await writeFile(`${out}/manifest.json`,JSON.stringify({sourceSha,capturedAt:new Date().toISOString(),origin:base,synthetic:true,liveChatGptVerified:false,screenshots},null,2)+'\n');
 await writeFile(`${out}/results.json`,JSON.stringify({sourceSha,completed,checks,failures,blocked,providerRequests,baselineInjectedTransport:false,laterStressAndPermissionsInjectedTransport:true,screenshots:screenshots.length},null,2)+'\n');
 await browser.close();
}
if(!completed)throw new Error(`Round 8 browser checks incomplete: ${failures.length} failure(s), see ${out}/results.json`);
