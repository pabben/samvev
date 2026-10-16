import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ApiError} from '../src/api';
import {parseGoogleOAuthConfiguration,GOOGLE_CONFIGURATION_MAX_BYTES,validateCalendarRegistrationPayload,calendarParticipationKey,registrationStateKey,calendarSetupSelection} from '../src/calendar-provider-config';
import {registerHooks} from 'node:module';
// Node's unit runner does not load Vite image modules; substitute only the asset URL.
registerHooks({load(url,context,nextLoad){return url.endsWith('.webp')?{format:'module',source:'export default "synthetic-avatar.webp"',shortCircuit:true}:nextLoad(url,context)}});
const {IntegrationsPanel}=await import('../src/integrations');
const {LocaleProvider}=await import('../src/ui');
import type {Membership} from '../src/types';
import {en} from '../src/locales/en';
import {nb} from '../src/locales/nb';
const callback='https://samvev.invalid/api/v1/calendar/oauth/google/callback';
const configuration=()=>({web:{client_id:'synthetic-client',client_secret:'synthetic-secret',auth_uri:'https://accounts.google.com/o/oauth2/v2/auth',token_uri:'https://oauth2.googleapis.com/token',redirect_uris:[callback,'https://other.invalid/callback'],project_id:'unused-metadata'}});
test('Google import validates web client and exact callback, sending only necessary registration fields',()=>{
 const parsed=parseGoogleOAuthConfiguration(JSON.stringify(configuration()),callback);
 assert.deepEqual(parsed.web.redirect_uris,[callback]);assert.equal(parsed.web.client_id,'synthetic-client');assert.equal(parsed.web.client_secret,'synthetic-secret');assert.equal('project_id' in parsed.web,false);
 assert.equal(Object.keys(parsed.web).length,5);
});
test('Google import rejects malformed files, desktop clients, wrong callback and untrusted OAuth endpoints without disclosing content',()=>{
 for(const value of ['synthetic-private-not-json',JSON.stringify({installed:configuration().web}),JSON.stringify({...configuration(),installed:{}}),JSON.stringify({web:{...configuration().web,redirect_uris:['https://other.invalid/callback']}}),JSON.stringify({web:{...configuration().web,auth_uri:'https://unsafe.invalid/auth'}}),JSON.stringify({web:{...configuration().web,client_secret:''}})]){
  assert.throws(()=>parseGoogleOAuthConfiguration(value,callback),(error:unknown)=>error instanceof ApiError&&!error.message.includes('synthetic-secret')&&!error.message.includes('synthetic-private'));
 }
});
test('configuration size bound counts UTF-8 bytes, before JSON parsing',()=>{
 assert.throws(()=>parseGoogleOAuthConfiguration('x'.repeat(GOOGLE_CONFIGURATION_MAX_BYTES+1),callback),(error:unknown)=>error instanceof ApiError&&error.code==='calendarConfigTooLarge');
 assert.throws(()=>parseGoogleOAuthConfiguration('ø'.repeat(GOOGLE_CONFIGURATION_MAX_BYTES/2+1),callback),(error:unknown)=>error instanceof ApiError&&error.code==='calendarConfigTooLarge');
});
test('participation states remain distinct; unknown HA status is never guessed from symbols',()=>{
 const keys=['confirmed','tentative','declined','unanswered','unknown'].map(calendarParticipationKey);assert.equal(new Set(keys).size,5);
 assert.equal(calendarParticipationKey('✅'),'calendarParticipationUnknown');assert.equal(calendarParticipationKey(undefined),'calendarParticipationUnknown');
 for(const key of keys){assert.ok(en[key]);assert.ok(nb[key])}
 assert.notEqual(registrationStateKey('configured'),'calendarConnected');assert.notEqual(registrationStateKey('configured'),'calendarSyncChecked');
});
test('setup deep links select only supported setup flows',()=>{
 for(const provider of ['google','microsoft','spond'] as const)assert.equal(calendarSetupSelection(`?tab=integrations&setup=${provider}`),provider);
 assert.equal(calendarSetupSelection('?setup=unknown'),undefined);assert.equal(calendarSetupSelection('?tab=integrations'),undefined);
});
const member:Membership={id:'synthetic-membership',household_id:'synthetic-household',person_id:'synthetic-person',role_preset:'member',capabilities:['household.view'],revision:1,household_name:'Synthetic',timezone:'Europe/Oslo',household_locale:'en',display_name:'Synthetic Adult',display_ids:[],age_group:'adult',calendar_access:true};
test('ordinary adult calendar surface omits installation settings and manager credential actions',()=>{
 Object.defineProperty(globalThis,'location',{value:new URL('https://samvev.invalid/?tab=integrations'),configurable:true});
 const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(IntegrationsPanel,{member,displays:[],people:[],installationId:'synthetic-installation',accountId:'synthetic-account'})}));
 assert.ok(markup.includes('Your calendars'));assert.ok(markup.includes('Calendars, waste collection and temperature'));assert.ok(!markup.includes('One-time connection setup'));assert.ok(!markup.includes('Advanced · incoming integrations'));assert.ok(!markup.includes('Client secret'));
});
test('installation admin surface adds registration setup and manager controls without exposing secrets',()=>{
 const manager={...member,capabilities:['household.view','household.manage','installation.manage']};
 Object.defineProperty(globalThis,'location',{value:new URL('https://samvev.invalid/?tab=integrations&setup=google'),configurable:true});
 const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(IntegrationsPanel,{member:manager,displays:[],people:[],installationId:'synthetic-installation',accountId:'synthetic-account'})}));
 assert.ok(markup.includes('One-time connection setup'));assert.ok(markup.includes('Advanced · incoming integrations'));assert.ok(!markup.includes('synthetic-secret'));
});

test('administrator requests are byte bounded below the server limit, including multibyte secrets',()=>{
 const payload={status:'active',clientId:'synthetic',clientSecret:'synthetic-secret'};
 assert.equal(validateCalendarRegistrationPayload(payload),payload);
 assert.throws(()=>validateCalendarRegistrationPayload({...payload,clientSecret:'界'.repeat(6000)}),(error:unknown)=>error instanceof ApiError&&error.code==='calendarConfigPayloadTooLarge');
});

test('documented Google legacy web downloads import without allowing arbitrary OAuth endpoints',()=>{
 const legacy={web:{...configuration().web,auth_uri:'https://accounts.google.com/o/oauth2/auth',token_uri:'https://accounts.google.com/o/oauth2/token'}};
 assert.equal(parseGoogleOAuthConfiguration(JSON.stringify(legacy),callback).web.client_id,'synthetic-client');
 assert.throws(()=>parseGoogleOAuthConfiguration(JSON.stringify({web:{...legacy.web,token_uri:'https://accounts.google.com/unsafe/token'}}),callback));
 assert.throws(()=>parseGoogleOAuthConfiguration(JSON.stringify({installed:legacy.web}),callback));
});

const {calendarMemberAccess,calendarCanDiscoverSources}=await import('../src/calendar-provider-config');
const {CalendarSourcesEmpty,CalendarConnections}=await import('../src/calendar-connections');
test('explicit calendar access denial and child age override elevated capabilities while generic integrations retain their own rights',()=>{
 const elevated={...member,capabilities:['household.view','household.manage','installation.manage']};
 for(const denied of [{...elevated,calendar_access:false},{...elevated,age_group:'child'},{...elevated,age_group:'teen'}]){
  assert.equal(calendarMemberAccess(denied),false);
  const props={member:denied,displays:[],people:[],installationId:'synthetic-installation',accountId:'synthetic-account'};
  assert.equal(renderToStaticMarkup(createElement(CalendarConnections,props)),'');
  const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(IntegrationsPanel,props)}));
  assert.ok(!markup.includes('Your calendars'));assert.ok(!markup.includes('One-time connection setup'));assert.ok(markup.includes('Advanced · incoming integrations'));
 }
 assert.equal(calendarMemberAccess({...member,calendar_access:undefined}),true);
 assert.equal(calendarMemberAccess({...member,calendar_access:undefined,age_group:undefined}),false);
});
test('connected zero-source accounts offer explicit discovery retry, never an automatic provider call or reinstall instruction',()=>{
 for(const provider of ['google','microsoft','home_assistant'] as const){
  assert.equal(calendarCanDiscoverSources(provider,'connected',0),true);
  assert.equal(calendarCanDiscoverSources(provider,'connected',1),false);
  assert.equal(calendarCanDiscoverSources(provider,'disconnected',0),false);
 }
 assert.equal(calendarCanDiscoverSources('ics','connected',0),false);
 let calls=0;
 const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(CalendarSourcesEmpty,{provider:'home_assistant',disabled:true,onRetry:()=>calls++})}));
 assert.equal(calls,0);assert.ok(markup.includes('Account connected, no calendars found'));assert.ok(markup.includes('including Spond Tracker'));assert.ok(markup.includes('Do not reinstall'));assert.ok(markup.includes('Refresh calendar list'));assert.ok(markup.includes('disabled=""'));
});

const {CalendarFreshness}=await import('../src/calendar-freshness');
const {FamilyHub,ItemCard}=await import('../src/family-hub');
import type {HubItem} from '../src/home-types';
const staleItem:HubItem={id:'synthetic-event',kind:'event',contentLocale:'en',subjects:{personIds:['synthetic-person-0']},targets:{household:false,personIds:['synthetic-person-0']},title:'Synthetic practice',body:'',entries:[],priority:'normal',publishAt:'2030-01-01T00:00:00Z',startsAt:'2030-01-02T12:00:00Z',endsAt:'2030-01-02T13:00:00Z',expiresAt:'2030-01-03T00:00:00Z',source:{label:'Synthetic calendar',observedAt:'2030-01-01T10:00:00Z',uncertainty:'low'},metadata:{calendar:{provider:'google',sourceId:'synthetic-source',bridgeKind:'direct',subjectHousehold:false,freshness:'stale',lastSuccessfulSyncAt:'2030-01-01T10:00:00Z',reason:'provider_disabled'}},revision:1,updatedAt:'2030-01-01T10:00:00Z'};
test('safe freshness renderer shows only the server stale flag and last successful time, not operator diagnostics',()=>{
 const render=(item:HubItem,detail=false)=>renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(CalendarFreshness,{item,zone:'Europe/Oslo',detail})}));
 assert.ok(render(staleItem).includes('May be outdated'));
 assert.ok(render(staleItem,true).includes('Showing the last valid information'));
 assert.ok(render(staleItem,true).includes('Last successful update'));
 assert.ok(!render(staleItem,true).includes('provider_disabled'));
 assert.equal(render({...staleItem,metadata:{calendar:{...staleItem.metadata.calendar!,freshness:'current'}}}),'');
 assert.equal(render({...staleItem,metadata:{}}),'');
 for(const display of [false,true]){
  const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'nb',children:createElement(ItemCard,{item:staleItem,people:[],zone:'Europe/Oslo',display})}));
  assert.ok(markup.includes('Viser siste gyldige informasjon'));assert.ok(!markup.includes('provider_disabled'));assert.ok(!markup.includes('client'));
 }
});
test('actual Family Hub member/display timelines and compact person summaries retain stale markers across compositions',()=>{
 const people=Array.from({length:6},(_,i)=>({id:`synthetic-person-${i}`,displayName:`Synthetic ${i}`,ageGroup:i<2?'adult':'child'}));
 for(const [width,height,dark] of [[1920,1080,false],[1920,752,true],[1280,752,false],[390,844,false],[390,844,true]] as const){
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{theme:dark?'dark':'light'}}}});
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:(query:string)=>({matches:query.includes('max-width: 1000')?width<=1000:query.includes('max-width: 640')?width<=640:width>=1001&&height<=850})});
  for(const display of [false,true]){
   const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale:'en',children:createElement(FamilyHub,{people,items:[staleItem],messages:[],zone:'Europe/Oslo',householdName:'Synthetic',now:Date.parse('2030-01-02T10:00:00Z'),display})}));
   assert.ok(markup.includes('data-calendar-freshness="stale"'),`${width}x${height} ${dark} ${display}`);
   assert.match(markup,/data-hub-detail="synthetic-event"[^>]*><strong>Synthetic practice<span class="calendar-stale/);
   if(dark&&width===1920&&height===752)assert.match(markup,/hub-person-activity[\s\S]*?Synthetic practice<span class="calendar-stale/);
  }
 }
});

test('actual shared person previews and detail cards label all-day dates instead of a shifted midnight clock',()=>{
 Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{theme:'light'}}}});
 Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:()=>({matches:false})});
 const allDay={...staleItem,publishAt:'2026-10-21T00:00:00Z',startsAt:'2026-10-22T00:00:00Z',endsAt:'2026-10-23T00:00:00Z',expiresAt:'2026-10-24T00:00:00Z',metadata:{...staleItem.metadata,allDay:true}};
 const people=[{id:'synthetic-person-0',displayName:'Synthetic'}];
 for(const locale of ['nb','en'] as const)for(const display of [false,true]){
  const markup=renderToStaticMarkup(createElement(LocaleProvider,{locale,children:createElement(FamilyHub,{people,items:[allDay],messages:[],zone:'Europe/Oslo',householdName:'Synthetic',now:Date.parse('2026-10-22T12:00:00Z'),display})}));
  const label=locale==='nb'?'Hele dagen':'All day';
  assert.match(markup,new RegExp(`<small>${label} · [^<]*22`));assert.doesNotMatch(markup,/<small>[^<]*02[:.]00/);
  const detail=renderToStaticMarkup(createElement(LocaleProvider,{locale,children:createElement(ItemCard,{item:allDay,people,zone:'America/Los_Angeles',display})}));
  assert.match(detail,new RegExp(`<time[^>]*>${label} · [^<]*22`));assert.doesNotMatch(detail,/<time[^>]*>[^<]*(?:21|23|02:00|17:00)/);
 }
});
