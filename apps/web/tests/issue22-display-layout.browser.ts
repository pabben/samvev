// Browser presentation proof: actual React markup/styles, synthetic data only.
// No API or database; this supplements the paired-display end-to-end proof.
// Run from apps/web: npx tsx tests/issue22-display-layout.browser.ts
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { closureTitle, displayFixture, fixtureBrand } from './issue22-display-fixture';

process.chdir(fileURLToPath(new URL('../../../',import.meta.url)));
const output=resolve(process.env.ISSUE22_ARTIFACT_DIR??'.local/issue22');
await mkdir(output,{recursive:true});
const styles=(await Promise.all(['packages/design-tokens/tokens.css','apps/web/src/style.css','apps/web/src/home.css','apps/web/src/home-assistant-controls.css','apps/web/src/member-shell.css','apps/web/src/round9.css','apps/web/src/display-board.css'].map(file=>readFile(file,'utf8')))).join('\n');
const photo=await readFile('apps/web/src/assets/nordic-dusk-v2.png');
const browser=await chromium.launch({headless:true});
const results=[];
try {
  const page=await browser.newPage({viewport:{width:1280,height:752},deviceScaleFactor:1,reducedMotion:'reduce'});
  await page.route('http://synthetic.invalid/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.startsWith('/fonts/'))return route.fulfill({body:await readFile(`apps/web/public${path}`)});
    if(path.startsWith('/avatars/'))return route.fulfill({contentType:'image/webp',body:await readFile(`apps/web/src/assets${path}`)});
    if(path.endsWith('.png'))return route.fulfill({contentType:'image/png',body:photo});
    return route.abort();
  });
  for(const theme of ['dark','light'] as const)for(const empty of [false,true]) {
    await page.setContent(`<html data-theme="${theme}"><head><base href="http://synthetic.invalid/"><style>${styles}</style></head><body><div id="root"><div class="display-page family-display-page"><header class="display-header"><div>${fixtureBrand()}</div></header><main class="display-main">${displayFixture({theme,empty})}</main></div></div></body></html>`);
    await page.evaluate('globalThis.__name = fn => fn');
    await page.evaluate(()=>document.fonts.ready);
    const dimensions=await page.evaluate(()=>{
      const box=(selector:string)=>{const rect=document.querySelector(selector)!.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:rect.height}};
      const title=document.querySelector<HTMLElement>('.hub-all-day .hub-item-title strong');
      const identities=Array.from(document.querySelectorAll<HTMLElement>('.hub-person-identity')).map(node=>{const rect=node.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:rect.height}});
      return {message:box('.hub-messages'),photo:box('.hub-display-photo'),today:box('.hub-today'),people:box('.hub-person-section'),identities,title:title?{text:title.textContent,bottom:title.getBoundingClientRect().bottom,clientHeight:title.clientHeight,scrollHeight:title.scrollHeight,clientWidth:title.clientWidth,scrollWidth:title.scrollWidth}:null};
    });
    assert.ok(dimensions.message.bottom<=736,`${theme}/${empty}: message fits with 16px bottom margin: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.photo.bottom<=736,`${theme}/${empty}: photo fits`);
    assert.ok(Math.abs(dimensions.message.bottom-dimensions.photo.bottom)<1,'message and photo share a bottom edge');
    assert.ok(dimensions.identities.every(rect=>rect.height>=44),'all six person targets remain at least 44px high');
    assert.ok(dimensions.identities.every(rect=>rect.top>=dimensions.people.top&&rect.bottom<=dimensions.people.bottom),'all six complete person targets fit inside their card');
    if(!empty){
      assert.equal(dimensions.title!.text,closureTitle);
      assert.ok(dimensions.title!.clientHeight>=dimensions.title!.scrollHeight,'full all-day title height is visible');
      assert.ok(dimensions.title!.clientWidth>=dimensions.title!.scrollWidth,'full all-day title width is visible');
      assert.ok(dimensions.title!.bottom<=dimensions.today.bottom,'full all-day title remains within the day card');
    }else assert.ok(dimensions.today.height<260,'empty cards no longer consume the main display height');
    const file=`landscape-${theme}-${empty?'empty':'six-busy'}.png`;
    await page.screenshot({path:resolve(output,file)});
    results.push({file,viewport:{width:1280,height:752},...dimensions});
  }
  await writeFile(resolve(output,'results.json'),JSON.stringify({fixture:'SSR presentation only; no live API, authorization or physical panel test',results},null,2));
  console.log(JSON.stringify(results));
}finally {await browser.close();}
