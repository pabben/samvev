// Zero-DB member Home presentation comparison; run from apps/web with tsx.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { displayFixture, fixtureBrand } from './issue22-display-fixture';
process.chdir(fileURLToPath(new URL('../../../',import.meta.url)));
const phase=process.env.HOME_PROOF_PHASE??'after';
const output=resolve('.local/issue22-home',phase);
await mkdir(output,{recursive:true});
const styles=(await Promise.all(['packages/design-tokens/tokens.css','apps/web/src/style.css','apps/web/src/home.css','apps/web/src/home-assistant-controls.css','apps/web/src/member-shell.css','apps/web/src/round9.css','apps/web/src/display-board.css'].map(file=>readFile(file,'utf8')))).join('\n');
const photo=await readFile('apps/web/src/assets/nordic-dusk-v2.png');
const browser=await chromium.launch({headless:true});
const results=[];
try{
 const page=await browser.newPage({deviceScaleFactor:1,reducedMotion:'reduce'});
 await page.route('http://synthetic.invalid/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/fonts/'))return route.fulfill({body:await readFile(`apps/web/public${path}`)});
  if(path.startsWith('/avatars/'))return route.fulfill({contentType:'image/webp',body:await readFile(`apps/web/src/assets${path}`)});
  if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:photo});
  return route.abort();
 });
 for(const theme of ['light','dark'] as const)for(const viewport of [{width:1280,height:752},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.setContent(`<html data-theme="${theme}"><head><base href="http://synthetic.invalid/"><style>${styles}</style></head><body><div id="root"><div class="member-shell"><header class="sidebar">${fixtureBrand()}</header><div class="main-wrap"><main class="member-main">${displayFixture({theme,empty:true,member:true,mobile:viewport.width===390})}</main></div></div></div></body></html>`);
  await page.evaluate('globalThis.__name = fn => fn');
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.evaluate(()=>({days:Array.from(document.querySelectorAll<HTMLElement>('.hub-day')).map(day=>{
   const dinner=day.querySelector<HTMLElement>('.hub-day-dinner');
   const previous=dinner?.previousElementSibling;
   return {day:day.dataset.hubScope,height:day.getBoundingClientRect().height,dinnerGap:dinner&&previous?dinner.getBoundingClientRect().top-previous.getBoundingClientRect().bottom:null};
  }),targets:Array.from(document.querySelectorAll<HTMLElement>('.hub-person-identity,.hub-identities button')).map(node=>node.getBoundingClientRect().height),overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(geometry.overflow,false,'Home stays within viewport width');
  assert.ok(geometry.targets.length===6&&geometry.targets.every(height=>height>=44),'all six identities keep 44px controls');
  if(phase==='after'&&viewport.width===1280)assert.ok(geometry.days.every(day=>(day.dinnerGap??0)<=16),`quiet days keep the meal beside their content: ${JSON.stringify(geometry)}`);
  const file=`home-${theme}-${viewport.width}x${viewport.height}.png`;
  await page.screenshot({path:resolve(output,file)});
  results.push({file,viewport,...geometry});
 }
 await writeFile(resolve(output,'results.json'),JSON.stringify({fixture:'synthetic SSR member Home; no API or physical device',results},null,2));
 console.log(JSON.stringify(results));
}finally{await browser.close();}
