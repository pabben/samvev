// Actual React layout using an authorized synthetic projection and a disclosed
// presentation-only absence fixture. No CSS injection, login or provider calls.
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const baseURL=process.env.ROUND14_HOME_BASE_URL,stateFile=process.env.ROUND14_HOME_STATE_FILE,out=process.env.ROUND14_HOME_OUT;
if(baseURL!=='http://r14-cc38-app:4173'||!stateFile||!out)throw Error('Exact isolated R14 origin, private session state and output directory required.');
const browser=await chromium.launch(),context=await browser.newContext({baseURL,storageState:JSON.parse(await readFile(stateFile,'utf8')),viewport:{width:1920,height:1080},reducedMotion:'reduce',locale:'nb-NO'}),page=await context.newPage();
const errors=[],blocked=[],checks=[];page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==baseURL||(/\/ai\//.test(request.url())&&request.method()!=='GET')){blocked.push('unexpected-origin-or-provider-action');return route.abort();}return route.continue();});
const meResponse=await context.request.get('/api/v1/me');assert.equal(meResponse.status(),200,'existing private session only; never retries login');const me=await meResponse.json();assert.equal(me.account.email,'admin@demo.invalid');const householdId=me.memberships[0].household_id,headers={'X-CSRF-Token':me.csrfToken};
const homePath=`/api/v1/households/${householdId}/home`,controlsPath=`/api/v1/households/${householdId}/home-assistant/controls`;
const homeResponse=await context.request.get(homePath);assert.equal(homeResponse.status(),200);const authorizedHome=await homeResponse.json();assert.equal(authorizedHome.people.length,6);
await mkdir(out,{recursive:true});
try{
 for(const fixture of ['populated','sparse']){
  await page.unroute('**'+homePath);await page.unroute('**'+controlsPath);
  if(fixture==='sparse'){
   await page.route('**'+homePath,route=>route.fulfill({json:{...authorizedHome,items:authorizedHome.items.filter(item=>!item.metadata.temperature)}}));
   await page.route('**'+controlsPath,route=>route.fulfill({json:{entities:[]}}));
  }
  for(const theme of ['light','dark']){
   assert.ok((await context.request.patch('/api/v1/me/preferences',{headers,data:{locale:'nb',theme}})).ok());
   for(const width of [1920,1280,820,768,390]){
    await page.setViewportSize({width,height:width===390?844:1080});await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await page.locator('.hub-messages .hub-message').first().waitFor();
    const smart=page.locator('.hub-home-primary-grid>.hub-home-smart');
    if(fixture==='sparse')await expect(smart).toBeEmpty();else await page.getByText('Innetemperatur',{exact:true}).first().waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const geometry=await page.evaluate(()=>{const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const grid=document.querySelector('.hub-home-primary-grid'),family=grid.querySelector(':scope>.hub-person-section');return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,columns:getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length,grid:rect(grid),family:family?rect(family):null,visibleChildren:[...grid.children].filter(node=>node.getClientRects().length).map(node=>({class:node.className,...rect(node)}))};});
    assert.ok(geometry.scrollWidth<=width,`${fixture}/${theme}/${width}: no horizontal overflow`);
    if(width>1100){const expected=fixture==='sparse'?3:4;assert.equal(geometry.columns,expected);assert.equal(geometry.visibleChildren.length,expected);const widths=geometry.visibleChildren.map(node=>node.width);assert.ok(Math.max(...widths)-Math.min(...widths)<1,'overview tracks are balanced');}
    if(width>640&&width<=1100){assert.equal(geometry.columns,2);assert.ok(geometry.family);if(fixture==='sparse')assert.ok(Math.abs(geometry.family.width-geometry.grid.width)<1,'last Family card spans the tablet row');else assert.ok(geometry.family.width<geometry.grid.width*.6,'real optional smart card keeps its own tablet column');}
    if(width<=640){await page.getByRole('button',{name:'Ny beskjed',exact:true}).waitFor();const order=geometry.visibleChildren.map(node=>node.class);const message=order.findIndex(name=>name.includes('hub-messages')),today=order.findIndex(name=>name.includes('hub-today'));assert.ok(theme==='light'?message<today:today<message,'established mobile message/Today order is preserved');}
    for(let i=0;i<geometry.visibleChildren.length;i++)for(let j=i+1;j<geometry.visibleChildren.length;j++){const a=geometry.visibleChildren[i],b=geometry.visibleChildren[j];assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<1,'overview cards never overlap');}
    checks.push({fixture,theme,width,...geometry});
    if([1920,820,390].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/home-${fixture}-${width}-${theme}.png`,fullPage:false,animations:'disabled'});}
   }
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await writeFile(`${out}/results.json`,JSON.stringify({kind:'actual UI with real authorized populated API projection; sparse removes only optional temperature/control data at presentation boundary',checks,errors,blocked},null,2));console.log(`PASS: ${checks.length} sparse/populated Home layout checks at1920/1280/820/768/390 in light/dark; balanced tracks, no overlap/overflow and mobile order preserved.`);
}finally{await context.request.patch('/api/v1/me/preferences',{headers,data:{locale:me.account.locale,theme:me.account.theme}});await context.close();await browser.close();}
