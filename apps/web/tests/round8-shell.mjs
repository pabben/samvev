// Actual isolated app navigation and safe UI journeys. Never targets LAN or a
// public deployment, never requests provider inference or captures active codes.
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const base=process.env.ROUND8_TEST_BASE_URL,sourceSha=process.env.ROUND8_SOURCE_SHA;
if(base!=='http://round8-test-app:4173'||!/^[a-f0-9]{40}$/.test(sourceSha??''))throw Error('Exact isolated origin and source SHA required');
const out=process.env.ROUND8_SHELL_ARTIFACT_DIR??'.local/m3/design-round8/shell';await mkdir(out,{recursive:true});
const browser=await chromium.launch(),context=await browser.newContext({baseURL:base,viewport:{width:1920,height:1080},reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage();
let csrf,original,householdId,created,finished=false,peopleVerified=false;const checks=[],failures=[],screenshots=[],blocked=[],providerRequests=[];
page.on('pageerror',error=>failures.push({name:'pageerror',error:error.message}));
await context.route('**/*',route=>{if(![base,'http://round8-setup-app:4173'].includes(new URL(route.request().url()).origin)){blocked.push(route.request().url());return route.abort()}return route.continue()});
await context.route('**/api/v1/households/*/ai/**',route=>{if(route.request().method()!=='GET'||route.request().url().includes('/models')){providerRequests.push(route.request().method()+' '+route.request().url());return route.abort()}return route.continue()});
const api=async(path,method='GET',data)=>{const response=await context.request.fetch('/api/v1'+path,{method,data,headers:csrf?{'X-CSRF-Token':csrf}:{}});expect(response.ok(),`${method} ${path}: ${response.status()}`).toBeTruthy();return response.status()===204?null:response.json()};
const cleanupCreated=async()=>{
 if(!created)return;
 if(!csrf)throw Error('Synthetic message cleanup requires the active authenticated session');
 const current=(await api(`/households/${householdId}/messages`)).messages.find(message=>message.id===created.id);
 expect(current,'created message remains visible to its creator for cleanup').toBeTruthy();
 if(['scheduled','published'].includes(current.state))await api(`/households/${householdId}/messages/${current.id}/withdraw`,'POST',{expectedRevision:current.revision});
 const after=(await api(`/households/${householdId}/messages`)).messages.find(message=>message.id===created.id);
 expect(['cancelled','withdrawn','expired']).toContain(after?.state);created=null;
};
const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.complete?undefined:image.decode().catch(()=>{})));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
const capture=async(filename,theme,surface)=>{await settle();await page.screenshot({path:`${out}/${filename}`});screenshots.push({filename,commitSha:sourceSha,capturedAt:new Date().toISOString(),viewport:page.viewportSize(),theme,surface,locale:'nb',fullPage:false,origin:new URL(page.url()).origin,personCount:new URL(page.url()).origin===base?6:0,dataState:'actual isolated synthetic API/database',injectedTransport:false,sha256:createHash('sha256').update(await readFile(`${out}/${filename}`)).digest('hex')})};
const group=async(name,fn)=>{try{await fn();checks.push({name});console.log('PASS '+name)}catch(error){failures.push({name,error:error.message});console.error('FAIL '+name+': '+error.message);if(await page.getByRole('dialog').count())await page.keyboard.press('Escape')}};
const accessible=async()=>{
 const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;expect(violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal main overflow').toBeTruthy();
 const tooSmall=await page.locator('button,a[href],summary,select').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()&&!node.closest('[inert]')&&!node.closest('dialog:not([open])')).filter(node=>{const b=node.getBoundingClientRect();return b.width<44||b.height<44}).map(node=>({text:node.textContent?.trim().slice(0,80),class:node.className})));expect(tooSmall,'whole controls at least 44px').toEqual([]);
};
const pages=[['messages','Beskjeder'],['people','Personer'],['more','Mer'],['displays','Skjermer'],['integrations','Integrasjoner'],['monitors','Oppdrag'],['ai','AI og forbruk']];
const nav=async(key,label)=>{
 const primary=['messages','people','more'].includes(key);
 if(!primary){await page.locator('nav.admin-navigation').getByRole('button',{name:'Mer',exact:true}).click();await page.locator('.hub-more-grid').getByRole('button',{name:new RegExp('^'+label)}).click();}
 else await page.locator('nav.admin-navigation').getByRole('button',{name:label,exact:true}).click();
 await expect(page.locator('.member-shell')).toHaveAttribute('data-member-tab',key);await page.locator('#main h1').waitFor();await settle();
};
const closeWithFocus=async(trigger)=>{await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused()};
try{
 await page.goto('/');await page.locator('input[name=email]').fill('admin');await page.locator('input[name=password]').fill('admin');await page.getByRole('button',{name:/^(Logg inn|Sign in)$/}).click();await page.getByTestId('family-hub').waitFor();
 const me=await api('/me');csrf=me.csrfToken;original={locale:me.account.locale,theme:me.account.theme};householdId=me.memberships[0].household_id;
 // Repair only the exact known synthetic orphan body from earlier harness
 // attempts, through authorized withdrawal in this exact isolated origin.
 const oldBody='Syntetisk runde 8: Planlagt hilsen bare til valgt testperson.';
 for(const message of (await api(`/households/${householdId}/messages`)).messages.filter(message=>message.body===oldBody&&['scheduled','published'].includes(message.state)))await api(`/households/${householdId}/messages/${message.id}/withdraw`,'POST',{expectedRevision:message.revision});
 const peopleBefore=(await api(`/households/${householdId}/people`)).people;expect(peopleBefore).toHaveLength(6);
 for(const theme of ['light','dark'])for(const [surface,width,height]of[['desktop',1920,1080],['mobile',390,844],['ipad-portrait',820,1180],['ipad-landscape',1180,820],['shelly',1280,752]]){
  await api('/me/preferences','PATCH',{locale:'nb',theme});await page.setViewportSize({width,height});await page.goto('/');await page.getByTestId('family-hub').waitFor();await settle();
  const homeFrame=await page.locator('.sidebar').boundingBox();
  for(const [key,label]of pages){
   await nav(key,label);
   if(key==='ai')await page.locator('#ai-usage-panel').waitFor();
   if(key==='people')await expect(page.locator('.person-card')).toHaveCount(6);
   if(key==='integrations')await page.locator('.integration-card').first().waitFor();
   if(['desktop','mobile'].includes(surface)||(surface==='ipad-portrait'&&['messages','people','ai'].includes(key)))await capture(`${key}-${surface}-${theme}.png`,theme,key);
   await group(`${key} ${surface} ${theme}: persistent navigation, orientation and accessibility`,async()=>{
    const frame=await page.locator('.sidebar').boundingBox();expect(frame.x).toBe(homeFrame.x);expect(frame.width).toBe(homeFrame.width);expect(frame.height).toBe(homeFrame.height);
    const active=page.locator('nav.admin-navigation [aria-current=page]');await expect(active).toHaveCount(1);await expect(active).toHaveAccessibleName(['messages','people'].includes(key)?label:'Mer');
    await expect(page.locator('#main h1')).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBe(0);
    const brand=page.locator(width<=640?'.member-topbar .brand':'.sidebar .brand');await expect(brand).toBeVisible();
    await accessible();
   });
   if(['desktop','mobile'].includes(surface)){
    if(key==='messages'){
     for(const [lane,name]of[['Planlagt','planned'],['Historikk','history']]){await page.getByRole('tab',{name:new RegExp('^'+lane)}).click();await expect(page.getByRole('tab',{name:new RegExp('^'+lane)})).toHaveAttribute('aria-selected','true');await capture(`messages-${name}-${surface}-${theme}.png`,theme,`messages-${name}`)}
     await page.getByRole('tab',{name:/^Nå/}).click();
     await group(`composer ${surface} ${theme}: recipients, schedule, cancel and keyboard focus`,async()=>{
      const trigger=page.getByRole('button',{name:'Ny beskjed',exact:true}).first();await trigger.click();const dialog=page.getByRole('dialog');await dialog.locator('textarea').fill('Syntetisk designrunde: En liten hilsen til familien.');await capture(`compose-${surface}-${theme}.png`,theme,'composer');
      await dialog.locator('.audience-details summary').click();for(const person of peopleBefore)await expect(dialog.getByLabel(person.display_name,{exact:true})).toBeVisible();
      await dialog.getByRole('button',{name:'Planlegg',exact:true}).click();await expect(dialog.locator('input[type=datetime-local]')).toHaveCount(2);await accessible();
      await dialog.getByRole('button',{name:'Avbryt',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();await trigger.click();await closeWithFocus(trigger);
     });
    }
    if(key==='people')await group(`person editor ${surface} ${theme}: choice and cancellation preserve data`,async()=>{
     const person=peopleBefore[5];const card=page.locator(`.person-card[data-person-id="${person.id}"]`);const trigger=card.getByRole('button',{name:'Rediger person',exact:true});await trigger.click();const dialog=page.getByRole('dialog');
     await expect(dialog.locator('input[name=person-avatar]:checked')).toHaveCount(1);await capture(`person-edit-${surface}-${theme}.png`,theme,'person-editor');await accessible();
     const close=dialog.getByRole('button',{name:'Lukk',exact:true});const b=await close.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);await closeWithFocus(trigger);
    });
    if(key==='ai'){await page.getByRole('button',{name:'Tilkobling / oppsett',exact:true}).click();await page.locator('#ai-setup-panel').waitFor();await capture(`ai-setup-${surface}-${theme}.png`,theme,'ai-setup');await group(`AI setup ${surface} ${theme} without provider actions`,accessible);}
   }
   if(!['messages','people','more'].includes(key))await group(`${key} ${surface} ${theme}: return to More`,async()=>{await page.getByRole('button',{name:'Tilbake til Mer',exact:true}).click();await expect(page.locator('.member-shell')).toHaveAttribute('data-member-tab','more');await expect(page.locator('nav.admin-navigation [aria-current=page]')).toHaveAccessibleName('Mer');await expect(page.locator('#main h1')).toBeFocused()});
  }
  if(['desktop','mobile'].includes(surface))await group(`preferences ${surface} ${theme}: shared dialog and focus`,async()=>{const trigger=page.getByRole('button',{name:'Dine innstillinger',exact:true});await trigger.click();await page.getByRole('dialog').waitFor();await capture(`preferences-${surface}-${theme}.png`,theme,'preferences');await accessible();await closeWithFocus(trigger)});
 }
 await api('/me/preferences','PATCH',{locale:'nb',theme:'light'});await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByTestId('family-hub').waitFor();await nav('messages','Beskjeder');
 await group('actual planned recipient message, edit, withdrawal confirmation and cleanup',async()=>{
  const body=`Syntetisk runde 8: Planlagt hilsen bare til valgt testperson. Test ${randomUUID()}`;await page.getByRole('button',{name:'Ny beskjed',exact:true}).first().click();let dialog=page.getByRole('dialog');await dialog.locator('textarea').fill(body);
  await dialog.getByLabel('Alle i husstanden',{exact:true}).uncheck();await dialog.locator('.audience-details summary').click();await dialog.getByLabel(peopleBefore[5].display_name,{exact:true}).check();
  await dialog.getByRole('button',{name:'Planlegg',exact:true}).click();await dialog.getByRole('button',{name:'I morgen kl. 07:00',exact:true}).click();
  const savedPromise=page.waitForResponse(response=>response.url()===`${base}/api/v1/households/${householdId}/messages`&&response.request().method()==='POST');await dialog.locator('button[type=submit]').click();const response=await savedPromise;expect(response.ok()).toBeTruthy();const result=await response.json();created=result.message??result;
  expect(created.state).toBe('scheduled');expect(created.body).toBe(body);expect(created.audience_household).toBe(false);
  // POST returns the message row; recipient joins are part of GET /messages.
  const stored=(await api(`/households/${householdId}/messages`)).messages.find(message=>message.id===created.id);
  expect(stored).toBeTruthy();expect(stored.state).toBe('scheduled');expect(stored.body).toBe(body);expect(stored.audience_household).toBe(false);expect(stored.person_ids).toEqual([peopleBefore[5].id]);expect(stored.display_ids).toEqual([]);await expect(dialog).toHaveCount(0);
  await page.getByRole('tab',{name:/^Planlagt/}).click();const card=page.locator('.message-card').filter({has:page.locator('.message-text',{hasText:body})});await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Endre',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.locator('textarea')).toHaveValue(body);await page.keyboard.press('Escape');
  const withdraw=card.getByRole('button',{name:'Trekk tilbake',exact:true});await withdraw.click();dialog=page.getByRole('dialog');await expect(dialog).toHaveAccessibleName('Trekke tilbake beskjeden?');await expect(dialog.locator('blockquote')).toHaveText(body);await capture('message-withdraw-mobile-light.png','light','message-withdraw-confirmation');await accessible();
  await dialog.getByRole('button',{name:'Avbryt',exact:true}).click();await expect(withdraw).toBeFocused();await withdraw.click();
  const withdrawPromise=page.waitForResponse(response=>response.url().endsWith(`/messages/${created.id}/withdraw`)&&response.request().method()==='POST');await page.getByRole('dialog').getByRole('button',{name:'Trekk tilbake beskjed',exact:true}).click();expect((await withdrawPromise).ok()).toBeTruthy();await expect(page.getByRole('dialog')).toHaveCount(0);await cleanupCreated();
 });
 for(const theme of ['light','dark']){
  await api('/me/preferences','PATCH',{locale:'nb',theme});await page.goto('/');await page.getByTestId('family-hub').waitFor();await nav('displays','Skjermer');
  await group(`safe display pairing form ${theme}`,async()=>{const trigger=page.getByRole('button',{name:'Koble til skjerm',exact:true});await trigger.click();await capture(`display-pair-mobile-${theme}.png`,theme,'display-pair-empty-form');await accessible();await closeWithFocus(trigger)});
  await nav('integrations','Integrasjoner');await group(`safe integration setup ${theme}`,async()=>{const trigger=page.getByRole('button',{name:'Legg til tilkobling',exact:true});await trigger.click();await capture(`integration-create-mobile-${theme}.png`,theme,'integration-create-empty-form');await accessible();await closeWithFocus(trigger)});
 }
 expect((await api(`/households/${householdId}/people`)).people).toEqual(peopleBefore);peopleVerified=true;
 await cleanupCreated();await api('/me/preferences','PATCH',original);await api('/auth/logout','POST',{});csrf=null;
 for(const theme of ['light','dark']){
  await page.goto('/');await page.locator('input[name=password]').waitFor();await page.getByRole('combobox',{name:/Utseende|Appearance/}).selectOption(theme);await page.getByRole('combobox',{name:/Språk|Language/}).selectOption('nb');
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await capture(`login-mobile-${theme}.png`,theme,'signed-out-login');await group(`signed out login ${theme}`,accessible);
  await page.goto('/invitation');await page.getByRole('alert').waitFor();await capture(`invitation-mobile-${theme}.png`,theme,'inactive-invitation-no-token');await group(`inactive invitation ${theme}`,accessible);
 }
 const setupOrigin='http://round8-setup-app:4173';
 const status=await context.request.get(setupOrigin+'/api/v1/setup/status');expect(status.ok()).toBeTruthy();expect((await status.json()).claimed).toBe(false);
 for(const theme of ['light','dark']){
  await page.goto(setupOrigin);await page.getByRole('combobox',{name:/Utseende|Appearance/}).selectOption(theme);await page.getByRole('combobox',{name:/Språk|Language/}).selectOption('nb');
  await capture(`setup-welcome-mobile-${theme}.png`,theme,'actual-unclaimed-welcome');await group(`actual unclaimed welcome ${theme}`,accessible);
  await page.getByRole('button',{name:'Sett opp husstanden',exact:true}).click();await page.locator('input[name=household]').waitFor();await capture(`setup-owner-mobile-${theme}.png`,theme,'actual-unclaimed-owner-form');await group(`actual unclaimed setup form ${theme}`,accessible);
 }
 expect((await (await context.request.get(setupOrigin+'/api/v1/setup/status')).json()).claimed).toBe(false);
 expect(blocked).toEqual([]);expect(providerRequests).toEqual([]);finished=true;
}finally{
 try{await cleanupCreated()}catch(error){failures.push({name:'created message cleanup',error:error.message})}
 if(csrf&&original){try{await api('/me/preferences','PATCH',original);await api('/auth/logout','POST',{});csrf=null}catch(error){failures.push({name:'preferences/logout cleanup',error:error.message})}}
 await writeFile(`${out}/manifest.json`,JSON.stringify({sourceSha,capturedAt:new Date().toISOString(),origin:base,personCount:6,synthetic:true,screenshots},null,2)+'\n');
 await writeFile(`${out}/results.json`,JSON.stringify({sourceSha,completed:finished&&failures.length===0,checks,failures,blocked,providerRequests,actualApiDatabase:true,peopleUnmodified:peopleVerified},null,2)+'\n');await browser.close();
}
if(failures.length)throw Error(`Round8 shell checks: ${failures.length} failures`);
