// Actual narrow-tablet navigation against the private synthetic R14 runtime.
// Reuses a legitimate session; never logs in, resets limits or calls a provider.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const baseURL=process.env.ROUND14_SHELL_BASE_URL;
const stateFile=process.env.ROUND14_SHELL_STATE_FILE;
const out=process.env.ROUND14_SHELL_OUT;
if(baseURL!=='http://r14-cc38-app:4173'||!stateFile||!out)throw Error('Exact isolated R14 origin, private session state and output directory required.');
const state=JSON.parse(await readFile(stateFile,'utf8'));
const browser=await chromium.launch();
const context=await browser.newContext({baseURL,storageState:state,viewport:{width:768,height:1024},reducedMotion:'reduce',locale:'nb-NO'});
const page=await context.newPage();const checks=[],errors=[],blocked=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==baseURL||(/\/ai\//.test(request.url())&&request.method()!=='GET')){blocked.push('unexpected-origin-or-provider-action');return route.abort();}return route.continue();});
const response=await context.request.get('/api/v1/me');assert.equal(response.status(),200,'private session is already valid; this runner never retries login');
const me=await response.json();assert.equal(me.account.email,'admin@demo.invalid');const headers={'X-CSRF-Token':me.csrfToken};
await mkdir(out,{recursive:true});
try{
 for(const locale of ['nb','en'])for(const theme of ['light','dark']){
  assert.ok((await context.request.patch('/api/v1/me/preferences',{headers,data:{locale,theme}})).ok());
  for(const width of [640,641,768,820,860,861,1001]){
   await page.setViewportSize({width,height:1024});await page.goto('/?tab=people');await page.locator('.person-card').first().waitFor();await page.locator('nav.admin-navigation .nav-count').first().waitFor({state:'attached'});await expect(page.locator('nav.admin-navigation .nav-count').first()).not.toHaveText('');await page.evaluate(()=>document.fonts.ready);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
   const badge=page.locator('nav.admin-navigation .nav-count').first();const originalBadge=await badge.textContent();
   for(const badgeState of ['actual','99+']){
    if(badgeState==='99+')await badge.evaluate(node=>{node.textContent='99+';});
    const geometry=await page.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const sidebar=document.querySelector('.member-shell .sidebar');const account=document.querySelector(innerWidth<=640?'.member-topbar .mobile-account':'.sidebar .account-button');return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,header:rect(sidebar),nav:rect(sidebar.querySelector('nav')),account:rect(account),controls:[...sidebar.querySelectorAll('nav button')].map(node=>({label:node.textContent.trim(),...rect(node)}))};});
    assert.ok(geometry.scrollWidth<=width+1,`${locale}/${theme}/${width}/${badgeState}: document overflow ${geometry.scrollWidth}`);
    assert.ok(geometry.account.x>=0&&geometry.account.right<=width+1&&geometry.account.width>=44&&geometry.account.height>=44,'whole account control remains visible and touch-sized');
    for(const control of geometry.controls)assert.ok(control.x>=0&&control.right<=width+1&&control.width>=44&&control.height>=44,`${control.label}: whole navigation control fits and remains44px`);
    if(width>=641&&width<=860)assert.ok(geometry.nav.y>=geometry.account.bottom,'tablet navigation occupies a second row');
    if(width>860)assert.ok(geometry.nav.y<geometry.account.bottom,'wide header retains a single row');
    checks.push({locale,theme,width,badgeState,...geometry});
   }
   await badge.evaluate((node,value)=>{node.textContent=value;},originalBadge);
   const account=page.locator(width<=640?'.member-topbar .mobile-account':'.sidebar .account-button');await account.focus();await account.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await expect(account).toBeFocused();
   if(locale==='nb'&&[641,768,861].includes(width))await page.screenshot({path:`${out}/header-${width}-${theme}.png`,fullPage:false,animations:'disabled'});
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await writeFile(`${out}/results.json`,JSON.stringify({kind:'dirty-prototype-browser-regression-not-canonical-capture',checks,errors,blocked},null,2));
 console.log(`PASS: ${checks.length} real header geometry checks, nb/en light/dark, actual and99+ badges, account Enter/Escape focus.`);
}finally{
 await context.request.patch('/api/v1/me/preferences',{headers,data:{locale:me.account.locale,theme:me.account.theme}});await context.close();await browser.close();
}
