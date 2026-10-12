// Round 6 consumes real scoped fixtures in the isolated test server. It never
// seeds/resets data or points at preserved LAN QA. Later injected stress and
// recovery DTOs are explicitly labelled; they are not live account evidence.
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=process.env.ROUND6_TEST_BASE_URL;
if(base!=='http://round6-test-app:4173')throw new Error('ROUND6_TEST_BASE_URL must equal http://round6-test-app:4173');
const out=process.env.ROUND6_ARTIFACT_DIR??'.local/m3/design-round6/browser';
const sourceSha=process.env.ROUND6_SOURCE_SHA;
if(!/^[a-f0-9]{40}$/.test(sourceSha??''))throw new Error('ROUND6_SOURCE_SHA required');
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1920,height:1080},reducedMotion:'reduce',serviceWorkers:'block'});
const page=await context.newPage();
const checks=[],failures=[],screenshots=[],blocked=[],providerRequests=[];
let csrf,originalPrefs,householdId,completed=false;
const record=(name,detail={})=>{checks.push({name,...detail});console.log(`PASS ${name}`)};
const group=async(name,fn)=>{try{await fn();record(name)}catch(error){failures.push({name,error:error.message});console.error(`FAIL ${name}: ${error.message}`);if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');}};
page.on('pageerror',error=>failures.push({name:'pageerror',error:error.message}));
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){blocked.push(route.request().url());return route.abort()}return route.continue()});
await context.route('**/api/v1/households/*/ai/**',route=>{if(route.request().method()!=='GET'||route.request().url().includes('/models')){providerRequests.push(`${route.request().method()} ${route.request().url()}`);return route.abort()}return route.continue()});
const api=async(path,method='GET',data)=>{const response=await context.request.fetch(`${base}/api/v1${path}`,{method,data,headers:method==='GET'?{}:{'X-CSRF-Token':csrf}});if(!response.ok())throw new Error(`${method} ${path}: ${response.status()}`);return response.status()===204?null:response.json()};
const prefs=async(locale,theme)=>api('/me/preferences','PATCH',{locale,theme});
const rect=locator=>locator.evaluate(node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right}});
const clearBottom=()=>page.evaluate(()=>{const nav=document.querySelector('.home-shell .sidebar');return nav&&getComputedStyle(nav).position==='fixed'?nav.getBoundingClientRect().top:innerHeight});
const fullyAbove=async(locator,bottom)=>{const b=await rect(locator);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.bottom).toBeLessThanOrEqual(bottom);return b};
const accessible=async(label)=>{
 const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
 expect(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),`${label} Axe`).toEqual([]);
 const tooSmall=await page.locator('button,a[href],summary').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!n.closest('[inert]')&&!n.closest('dialog:not([open])')).filter(n=>{const r=n.getBoundingClientRect();return r.width<44||r.height<44}).map(n=>n.textContent?.trim()));
 expect(tooSmall,`${label} 44px targets`).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} page overflow`).toBeTruthy();
};
const capture=async(filename,theme,surface,injectedTransport=false)=>{await page.screenshot({path:`${out}/${filename}`});const bytes=await readFile(`${out}/${filename}`);screenshots.push({filename,commitSha:sourceSha,capturedAt:new Date().toISOString(),viewport:page.viewportSize(),theme,surface,fullPage:false,locale:'nb',dataState:injectedTransport?'explicit synthetic DTO injection':'actual isolated synthetic API/database',injectedTransport,sha256:createHash('sha256').update(bytes).digest('hex')})};
const goHome=async(theme,width,height,locale='nb')=>{await prefs(locale,theme);await page.setViewportSize({width,height});await page.goto(base);await page.getByTestId('family-hub').waitFor();await page.evaluate(()=>document.fonts.ready);await page.locator('.hub-identities img,.hub-person img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));};
const navAI=async()=>{await page.locator('nav.admin-navigation').getByRole('button',{name:/^(Mer|More)$/}).click();await page.getByRole('button',{name:/^(AI og forbruk|AI and usage)$/}).click();await page.locator('#ai-usage-panel').waitFor()};
try{
 await page.goto(base);await page.locator('input[name=email]').fill('admin');await page.locator('input[name=password]').fill('admin');await page.getByRole('button',{name:/sign in|logg inn/i}).click();await page.getByTestId('family-hub').waitFor();
 const me=await api('/me');csrf=me.csrfToken;householdId=me.memberships[0].household_id;originalPrefs={locale:me.account.locale,theme:me.account.theme};
 const home=await api(`/households/${householdId}/home`);const usage=await api(`/households/${householdId}/ai/usage?days=30`);const settings=await api(`/households/${householdId}/ai/settings`);
 expect(home.people).toHaveLength(4);expect(home.messages.length).toBeGreaterThan(0);expect(home.items.filter(i=>i.kind==='event').length).toBeGreaterThanOrEqual(3);
 expect(usage.apiEquivalent.unknownPricedAttempts).toBeGreaterThan(0);expect(usage.forecast.apiUsd.monthlyAmount).toBeNull();record('real isolated rich Home and mixed known/unknown usage loaded',{injectedTransport:false});
 for(const theme of ['light','dark'])for(const [name,width,height]of[['desktop-1920',1920,1080],['mobile',390,844],['ipad-portrait',820,1180],['ipad-landscape',1180,820],['shelly-1280',1280,752]]){
  await goHome(theme,width,height);await capture(`${name}-${theme}.png`,theme,'member-home');
  await group(`${name} ${theme} first viewport priority`,async()=>{
   const boundary=await clearBottom();const today=page.locator('.hub-today .hub-timeline>li');
   if(width===390){const rows=await today.all();expect(rows.length).toBe(theme==='dark'?3:1);for(const row of rows)await fullyAbove(row,boundary);await fullyAbove(page.locator('.hub-important .hub-reminder').first(),boundary);if(theme==='light')await fullyAbove(page.locator('.hub-messages .hub-message-meta strong').first(),boundary)}
   if(width===820){await fullyAbove(page.locator('.hub-today'),boundary);await fullyAbove(page.locator('.hub-important .hub-reminder').first(),boundary);await fullyAbove(page.locator('.hub-messages .hub-message-meta strong').first(),boundary)}
   if(width===1180||width===1280){await fullyAbove(page.locator('.hub-important .hub-reminder').first(),boundary);await fullyAbove(page.locator('.hub-messages .hub-message-meta strong').first(),boundary)}
   if(width===1920&&theme==='light'){const left=await rect(page.locator('.hub-important')),middle=await rect(page.locator('.hub-messages')),right=await rect(page.locator('.hub-support'));expect(Math.abs(left.y-middle.y)).toBeLessThan(2);expect(Math.abs(right.y-middle.y)).toBeLessThan(2);expect(middle.x).toBeGreaterThan(left.right);expect(right.x).toBeGreaterThan(middle.right);expect(middle.width/left.width).toBeGreaterThan(1.4);expect(middle.width/left.width).toBeLessThan(1.85);expect(Math.max(left.bottom,middle.bottom,right.bottom)).toBeLessThan(height);}
  });
  await group(`${name} ${theme} accessibility`,()=>accessible(`${name} ${theme}`));
 }
 await goHome('light',390,844);
 await group('counted reminder collection and full human message keyboard access',async()=>{
  const collection=page.locator('[data-hub-detail-kind=collection][data-hub-detail=important]');await collection.click();const dialog=page.getByRole('dialog');expect(await dialog.locator('[data-item-id]').count()).toBe(home.items.filter(i=>i.kind==='reminder'||i.kind==='alert'||['high','urgent'].includes(i.priority)).length);await page.keyboard.press('Escape');await expect(collection).toBeFocused();
  const message=page.locator('.hub-message-open').first();await message.click();await expect(page.locator('.hub-message-full .display-card-body')).toHaveText(home.messages[0].body);await page.keyboard.press('Escape');await expect(message).toBeFocused();
 });
 const person=home.people.find(p=>home.items.filter(item=>!item.targets.household&&item.targets.personIds.includes(p.id)).length>=2);expect(person).toBeTruthy();
 for(const theme of ['light','dark'])for(const [name,width,height]of[['desktop',1920,1080],['mobile',390,844]]){
  await goHome(theme,width,height);const trigger=page.locator(`button[data-hub-detail-kind=person][data-person-id="${person.id}"]`);await trigger.click();
  await capture(`person-${name}-${theme}.png`,theme,'person-details');
  await group(`filled person ${name} ${theme} full content/time/focus`,async()=>{
   const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:person.displayName,exact:true})).toBeVisible();await expect(dialog).toContainText('Felles for husstanden');expect(await dialog.locator('.hub-item-when time').count()).toBeGreaterThan(0);
   for(const item of home.items.filter(i=>!i.targets.household&&i.targets.personIds.includes(person.id))){await expect(dialog.locator(`[data-item-id="${item.id}"]`)).toContainText(item.body);if(item.endsAt&&item.startsAt)expect(await dialog.locator(`[data-item-id="${item.id}"] .hub-item-when`).innerText()).toMatch(/[–—]/);}
   await accessible('person details');const focusables=dialog.locator('button:not([disabled]),a[href],summary');await focusables.first().focus();await page.keyboard.press('Shift+Tab');await expect(focusables.last()).toBeFocused();await page.keyboard.press('Tab');await expect(focusables.first()).toBeFocused();
  });await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  await navAI();await capture(`ai-overview-${name}-${theme}.png`,theme,'ai-usage-overview');
  await group(`AI overview ${name} ${theme} real SQL uncertainty`,async()=>{
   await expect(page.locator('#ai-usage-panel')).toBeVisible();await expect(page.locator('#ai-setup-panel')).toBeHidden();await expect(page.locator('.ai-cost-overview')).toContainText(usage.chatGptCredits.estimatedCredits);await expect(page.locator('.ai-cost-overview')).toContainText(usage.apiEquivalent.amount);await expect(page.getByTestId('ai-forecast-status')).toContainText('uavklarte');await expect(page.locator('.ai-route-banner')).toContainText('Valgt bruksvei');await accessible('AI overview');
  });
 }
 await group('three machine-specific connection steps and private registration recovery',async()=>{
  await page.locator('.ai-section-switch').getByRole('button',{name:'Tilkobling / oppsett'}).click();const guide=page.locator('.ai-connect-steps');await expect(guide).not.toHaveAttribute('open','');await guide.locator(':scope>summary').click();expect(await guide.locator(':scope>ol>li').count()).toBe(3);
  await expect(guide).toContainText('begge maskiner');await expect(guide).toContainText('tokenfrie');for(const link of await guide.locator('.ai-source-links a').all())expect(await link.getAttribute('href')).toMatch(/^https:\/\/raw\.githubusercontent\.com\/pabben\/samvev\/feat\/m3-family-hub\/scripts\/chatgpt-connect/);
  for(const summary of await guide.locator('.ai-operator-command>summary').all())await summary.click();await expect(guide).toContainText('--registration');await expect(guide).toContainText('docker exec samvev-m1-qa-app-1');await accessible('expanded setup');await guide.scrollIntoViewIfNeeded();await capture('ai-connection-mobile-dark.png','dark','connection-guide');
 });
 // Presentation stress only, after every real API/DB screenshot above.
 const homeRoute=`**/api/v1/households/${householdId}/home`;let injected=home;await page.route(homeRoute,route=>route.fulfill({json:injected}));
 for(const count of [1,8])await group(`${count} people and long-text reflow (injected DTO)`,async()=>{injected={...home,people:Array.from({length:count},(_,i)=>({...home.people[i%4],id:`synthetic-r6-person-${i}`,displayName:`Synthetic person ${i+1} with a deliberately long accessible name`}))};await goHome(count===1?'light':'dark',count===1?390:820,count===1?844:1180,'en');expect(await page.locator('button[data-hub-detail-kind=person][data-person-id]').count()).toBe(count);await accessible('long people');});
 for(const count of [0,1,3])await group(`person details ${count} entries and current projection (injected DTO)`,async()=>{const original=home.people[0];const selectedItems=Array.from({length:count},(_,i)=>({...home.items.find(item=>item.kind==='event'),id:`synthetic-detail-${i}`,targets:{household:false,personIds:[original.id]},title:`Synthetic detail ${i}`,expiresAt:new Date(Date.now()+600000).toISOString()}));injected={...home,people:[original],items:selectedItems};await goHome('light',390,844);await page.locator(`button[data-person-id="${original.id}"]`).click();expect(await page.getByRole('dialog').locator('[data-item-id]').count()).toBe(count);if(count===1){injected={...injected,items:[{...selectedItems[0],body:'Synthetic live revision',revision:99}]};await expect(page.getByRole('dialog')).toContainText('Synthetic live revision',{timeout:10000});injected={...injected,items:[]};await expect(page.getByRole('dialog').locator('[data-item-id]')).toHaveCount(0,{timeout:10000});}await page.keyboard.press('Escape')});
 await page.unroute(homeRoute);
 await group('pending validation recovery is explicit and blocks inference (injected DTO)',async()=>{
  await goHome('dark',390,844);const pending={...settings,chatgpt:{...settings.chatgpt,activeRegistrationId:'synthetic-pending',registrations:[{id:'synthetic-pending',label:'Synthetic recovery evidence',status:'pending_validation',revision:1,isOwner:true,canManage:true,errorCode:'refresh_validation_unavailable'}]}};
  const settingsRoute=`**/api/v1/households/${householdId}/ai/settings`;await page.route(settingsRoute,route=>route.fulfill({json:pending}));await navAI();await expect(page.locator('.ai-route-banner')).toContainText('Venter på sikker validering');await page.locator('.ai-section-switch').getByRole('button',{name:'Tilkobling / oppsett'}).click();await expect(page.locator('.ai-registrations')).toContainText('lagret kryptert');await expect(page.locator('.ai-registrations').getByRole('button',{name:'Prøv sikker validering på nytt'})).toBeEnabled();await page.locator('.ai-registrations').scrollIntoViewIfNeeded();await capture('ai-recovery-mobile-dark.png','dark','pending-validation-recovery',true);await page.unroute(settingsRoute);
 });
 expect(blocked).toEqual([]);expect(providerRequests).toEqual([]);completed=failures.length===0;
}finally{
 if(originalPrefs&&csrf){try{await api('/me/preferences','PATCH',originalPrefs);await api('/auth/logout','POST',{})}catch(error){failures.push({name:'cleanup',error:error.message});completed=false}}
 await writeFile(`${out}/manifest.json`,JSON.stringify({sourceSha,capturedAt:new Date().toISOString(),origin:base,synthetic:true,liveChatGptVerified:false,screenshots},null,2)+'\n');
 await writeFile(`${out}/results.json`,JSON.stringify({sourceSha,completed,checks,failures,blocked,providerRequests,baselineInjectedTransport:false,laterStressAndRecoveryInjectedTransport:true,screenshots:screenshots.length},null,2)+'\n');
 await browser.close();
}
if(!completed)throw new Error(`Round 6 browser checks incomplete: ${failures.length} failure(s), see ${out}/results.json`);
