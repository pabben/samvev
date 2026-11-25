// Component geometry only: synthetic React markup and repository CSS, no app,
// account, API interception, provider calls or product screenshot claims.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from '@playwright/test';
registerHooks({load(url,context,nextLoad){return url.endsWith('.webp')?{format:'module',source:'export default "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"',shortCircuit:true}:nextLoad(url,context)}});
const [{FamilyHub},{LocaleProvider}]=await Promise.all([import('../src/family-hub.tsx'),import('../src/ui.tsx')]);
const css=(await Promise.all(['../../../packages/design-tokens/tokens.css','../src/style.css','../src/home.css','../src/round9.css'].map(path=>readFile(new URL(path,import.meta.url),'utf8')))).join('\n');
const out='/workspace/.local/m3/round15/ux-column-component';
await mkdir(out,{recursive:true});
const now=Date.parse('2026-10-28T12:00:00Z');
const people=Array.from({length:6},(_,i)=>({id:`synthetic-${i}`,displayName:`Synthetic person ${i+1}`}));
const event=(id,day,hour,personIds)=>({id,kind:'event',contentLocale:'en',title:`Synthetic activity ${id}`,body:'',targets:{household:false,personIds},entries:[],priority:'normal',publishAt:null,startsAt:`2026-10-${day}T${hour}:00:00Z`,endsAt:`2026-10-${day}T${Number(hour)+1}:00:00Z`,expiresAt:'2026-10-30T00:00:00Z',source:{label:'Synthetic source',observedAt:'2026-10-28T11:00:00Z',uncertainty:'low'},metadata:{},revision:1,updatedAt:'2026-10-28T11:00:00Z'});
const items=[...Array.from({length:5},(_,i)=>event(`today-${i}`,28,`${13+i}`,people.map(p=>p.id))),event('tomorrow',29,'14',['synthetic-1'])];
const messages=[1,2].map(i=>({id:`synthetic-message-${i}`,body:'A synthetic family note to keep in view.',importance:'normal',authorName:'Synthetic sender',publishAt:'2026-10-28T11:00:00Z',expiresAt:'2026-10-29T00:00:00Z',revision:1}));
const browser=await chromium.launch();const results=[];
try{
 const page=await browser.newPage();await page.route('**/*',route=>route.abort());
 for(const theme of ['light','dark'])for(const width of [1920,820,390]){
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{theme}}}});
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:query=>({matches:query.includes('max-width: 640px')?width<=640:query.includes('max-width: 1000px')?width<=1000:false})});
  const props={people,items,messages,zone:'UTC',householdName:'Synthetic component fixture',now,displaySections:{week:false},homeSmartHome:createElement('section',{className:'hub-panel'},createElement('h2',null,'Synthetic controls'),createElement('button',{className:'button'},'Synthetic action')),homePhoto:createElement('section',{className:'hub-home-photos hub-panel'},'Synthetic photo module'),homeModules:createElement('section',{className:'hub-panel'},'Synthetic household board')};
  const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(FamilyHub,props)}));
  await page.setViewportSize({width,height:1080});await page.setContent(`<html data-theme="${theme}"><head><style>${css}</style></head><body><main style="max-width:1600px;margin:auto;padding:20px">${markup}</main></body></html>`);
  const geometry=await page.evaluate(()=>{
   const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
   const focus=[...document.querySelectorAll('.family-hub button')].filter(e=>e.getClientRects().length).map(e=>({label:e.textContent.trim(),height:e.getBoundingClientRect().height}));
   const mobileCards=[...document.querySelectorAll('.hub-home-primary-grid>*')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{className:e.className,y:r.y,bottom:r.bottom}});
   const mobileCardGaps=mobileCards.slice(1).map((card,index)=>({before:mobileCards[index].className,after:card.className,gap:card.y-mobileCards[index].bottom}));
   return{mobileCardGaps,gap:parseFloat(getComputedStyle(document.querySelector('.family-hub')).getPropertyValue('--hub-gap')),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,today:rect('.hub-today'),tomorrow:rect('.hub-tomorrow'),messages:rect('.hub-messages'),people:rect('.hub-person-section'),photo:rect('.hub-home-photos'),focus};
  });
  assert.ok(geometry.scrollWidth<=width,`${theme}/${width}: no horizontal overflow`);
  if(width>640){assert.ok(Math.abs(geometry.messages.y-geometry.tomorrow.bottom-geometry.gap)<1,`${theme}/${width}: messages start directly beneath Tomorrow: ${JSON.stringify(geometry)}`);assert.ok(geometry.messages.y<geometry.today.bottom,`${theme}/${width}: tall Today cannot delay messages`);}
  if(width<=640){assert.ok(geometry.mobileCardGaps.length>=3,`${theme}/${width}: populated mobile fixture has multiple adjacent cards`);for(const cards of geometry.mobileCardGaps)assert.ok(cards.gap>=9.5,`${theme}/${width}: ${cards.before} to ${cards.after} retains at least 10px separation, got ${cards.gap}`);}
  for(const target of geometry.focus)assert.ok(target.height>=43.5,`${theme}/${width}: ${target.label} keeps a 44px target`);
  await page.screenshot({path:`${out}/synthetic-component-${theme}-${width}.png`,fullPage:true});results.push({theme,...geometry});
 }
 await writeFile(`${out}/results.json`,JSON.stringify({kind:'synthetic component geometry only',results},null,2));
 console.log('PASS: six light/dark component cases at 1920/820/390, independent message stacking, mobile card gaps ≥10px, no horizontal overflow, 44px targets.');
}finally{await browser.close()}
