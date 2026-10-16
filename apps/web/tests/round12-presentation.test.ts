import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';
import {dayEvents,personalPreviewItems,personalWindowItems,upcomingEvents,eventDateGroups,wasteEvents,temperatureItems,temperatureReading,temperatureIsStale,dayKey} from '../src/home-presentation';
import type {HubItem} from '../src/home-types';
registerHooks({load(url,context,nextLoad){return url.endsWith('.webp')?{format:'module',source:'export default "synthetic-avatar.webp"',shortCircuit:true}:nextLoad(url,context)}});
const {FamilyHub,UpcomingActivities}=await import('../src/family-hub');
const {HomeEnvironment}=await import('../src/home-environment');
const {LocaleProvider}=await import('../src/ui');
const zone='Europe/Oslo',now=Date.parse('2026-10-15T10:00:00Z');
const event=(id:string,start:string,end:string|null=null,extra:Partial<HubItem>={}):HubItem=>({id,kind:'event',contentLocale:'en',subjects:{personIds:['p']},targets:{household:false,personIds:['p']},title:`Synthetic ${id}`,body:'',entries:[],priority:'normal',publishAt:null,expiresAt:null,startsAt:start,endsAt:end,source:{label:'Synthetic calendar',observedAt:'2026-10-15T10:00:00Z',uncertainty:'low'},metadata:{calendar:{provider:'home_assistant',sourceId:'synthetic-source',bridgeKind:'direct',subjectHousehold:false}},revision:1,updatedAt:'2026-10-15T10:00:00Z',...extra});
const render=(children:ReturnType<typeof createElement>,locale:'nb'|'en'='en')=>renderToStaticMarkup(createElement(LocaleProvider,{locale,children}));
const setup=(dark=false,width=1920,height=1080)=>{Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset:{theme:dark?'dark':'light'}}}});Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:(query:string)=>({matches:query.includes('max-width: 1000')?width<=1000:query.includes('max-width: 640')?width<=640:width>=1001&&height<=850})});};
test('October 24 activity is upcoming on 15, tomorrow on 23 and today on 24 without replacing other person content',()=>{
 const remote=event('oct24','2026-10-24T08:00:00Z','2026-10-24T09:00:00Z');const reminder=event('remember','2026-10-30T08:00:00Z',null,{kind:'reminder'});const summary={...reminder,id:'summary',kind:'summary' as const};
 assert.deepEqual(personalPreviewItems([remote,reminder,summary],'p',now,zone).map(item=>item.id),['remember']);
 assert.deepEqual(personalWindowItems([remote,reminder,summary],'p',now,zone).map(item=>item.id),['remember','summary']);
 assert.equal(upcomingEvents([remote],now,zone)[0],remote);
 const oct23=Date.parse('2026-10-23T12:00:00Z'),oct24=Date.parse('2026-10-24T06:00:00Z');
 assert.deepEqual(dayEvents([remote],oct23,zone),[]);assert.equal(dayEvents([remote],oct23,zone,1)[0],remote);assert.equal(dayEvents([remote],oct24,zone)[0],remote);
 assert.equal(personalPreviewItems([remote],'p',oct23,zone)[0],remote);assert.equal(personalPreviewItems([remote],'p',oct24,zone)[0],remote);
 // Same data, a new clock tick across household midnight changes membership immediately.
 assert.equal(dayKey(Date.parse('2026-10-22T21:59:59Z'),zone),'2026-10-22');
 assert.equal(personalPreviewItems([remote],'p',Date.parse('2026-10-22T21:59:59Z'),zone).length,0);
 assert.equal(personalPreviewItems([remote],'p',Date.parse('2026-10-22T22:00:00Z'),zone).length,1);
});
test('timed overlaps honor exclusive midnight and both Oslo DST transitions',()=>{
 for(const [clock,start,end] of [['2026-03-29T11:00:00Z','2026-03-28T22:00:00Z','2026-03-29T02:00:00Z'],['2026-10-25T11:00:00Z','2026-10-24T21:00:00Z','2026-10-25T03:00:00Z']])assert.equal(dayEvents([event('overlap',start!,end!)],Date.parse(clock!),zone).length,1);
 const atMidnight=event('exclusive','2026-10-14T20:00:00Z','2026-10-14T22:00:00Z');assert.equal(dayEvents([atMidnight],now,zone).length,0);
 const ongoing=event('ongoing','2026-10-14T20:00:00Z','2026-10-16T08:00:00Z');assert.equal(dayEvents([ongoing],now,zone).length,1);assert.equal(dayEvents([ongoing],now,zone,1).length,1);assert.equal(upcomingEvents([ongoing],now,zone)[0],ongoing);
});
test('full upcoming list is chronological and date grouped, excluding ended and cancelled events',()=>{
 const later=event('later','2026-10-24T08:00:00Z','2026-10-24T09:00:00Z'),today=event('today','2026-10-15T13:00:00Z','2026-10-15T14:00:00Z'),ended=event('ended','2026-10-15T07:00:00Z','2026-10-15T08:00:00Z'),cancelled={...later,id:'cancelled',metadata:{calendar:{...later.metadata.calendar!,status:'cancelled'}}};
 const upcoming=upcomingEvents([later,cancelled,ended,today],now,zone);assert.deepEqual(upcoming.map(item=>item.id),['today','later']);assert.deepEqual(eventDateGroups(upcoming,zone).map(group=>group.day),['2026-10-15','2026-10-24']);assert.equal(dayEvents([cancelled],Date.parse('2026-10-24T06:00:00Z'),zone).length,0);
 const window={from:'2026-10-14T00:00:00Z',to:'2027-04-15T00:00:00Z'};later.metadata.calendar!.lastCompleteWindow=window;
 const html=render(createElement(UpcomingActivities,{items:[later,today],people:[],zone,now}));assert.ok(html.indexOf('Synthetic today')<html.indexOf('Synthetic later'));assert.ok(html.includes('Requested time window'));assert.ok(html.includes('Synthetic calendar'));
});
test('household waste is dated separately, retains same-day types and never fills person cards',()=>{
 const a=event('paper','2026-10-24T00:00:00Z','2026-10-25T00:00:00Z');a.metadata={allDay:true,calendar:{...a.metadata.calendar!,subjectHousehold:true,purpose:'waste'}};const b={...a,id:'plastic',title:'Synthetic plastic'};
 assert.equal(personalPreviewItems([a,b],'p',Date.parse('2026-10-24T08:00:00Z'),zone).length,0);assert.equal(dayEvents([a,b],now,zone).length,0);assert.equal(wasteEvents([a,b],now,zone).length,2);assert.equal(dayEvents([a],Date.parse('2026-10-25T08:00:00Z'),zone).length,0);
 const html=render(createElement(HomeEnvironment,{waste:[a,b],temperatures:[],zone,onWaste:()=>{}}));assert.ok(html.includes('Next collection'));assert.ok(html.includes('Synthetic paper'));assert.ok(html.includes('Synthetic plastic'));assert.ok(html.includes('October 24'));assert.ok(html.includes('data-item-id="paper"'));
});
const temperature=(value:number|null,unit:string|null,status='current',freshness='current'):HubItem=>event('temperature','2026-10-15T00:00:00Z',null,{kind:'observation',metadata:{temperature:{sensorId:'synthetic-sensor',displayName:'Synthetic outside',value,unit,status,freshness,lastReportedAt:'2026-10-15T08:00:00Z',lastUpdatedAt:'2026-10-15T07:00:00Z',lastFetchedAt:'2026-10-15T10:00:00Z',measuredAt:null,lastValidValue:value,lastValidUnit:unit,lastValidAt:'2026-10-15T08:00:00Z'}}});
test('temperature formatting preserves native negative/decimal values and valid zero, rejecting missing or wrong units',()=>{
 assert.equal(temperatureReading(temperature(-3.5,'°C'),'en'),'-3.5 °C');assert.equal(temperatureReading(temperature(0,'°F'),'en'),'0 °F');assert.equal(temperatureReading(temperature(32,'°F'),'en'),'32 °F');
 for(const item of [temperature(null,'°C'),temperature(NaN,'°C'),temperature(3,'K'),temperature(3,null)])assert.equal(temperatureReading(item,'nb'),null);
 const first=temperature(1,'°C'),second={...temperature(2,'°C'),id:'second',metadata:{temperature:{...temperature(2,'°C').metadata.temperature!,order:2}}};assert.deepEqual(temperatureItems([second,first]).map(item=>item.id),[first.id,second.id]);
});
test('temperature stale/unavailable output distinguishes source time, fetching and no reading in both locales',()=>{
 for(const locale of ['nb','en'] as const){const html=render(createElement(HomeEnvironment,{waste:[],temperatures:[temperature(-3.5,'°C','unavailable','stale'),{...temperature(null,'°C','unavailable','stale'),id:'none'}],zone,onWaste:()=>{}}),locale);assert.ok(html.includes(locale==='nb'?'Siste kjente verdi':'Last known value'));assert.ok(html.includes(locale==='nb'?'Ingen måling':'No reading'));assert.ok(html.includes(locale==='nb'?'Rapportert av Home Assistant':'Reported by Home Assistant'));assert.ok(html.includes(locale==='nb'?'Hentet av Samvev':'Fetched by Samvev'));assert.ok(html.includes('data-temperature-freshness="stale"'));assert.ok(!html.includes('0 °C'));}
});
test('actual six-person Home hides remote calendar previews/counts while keeping the upcoming entrance and reminders',()=>{
 const people=Array.from({length:6},(_,i)=>({id:i===0?'p':`p${i}`,displayName:`Synthetic ${i}`,ageGroup:i<2?'adult':'child'}));const remote=event('remote24','2026-10-24T08:00:00Z');const reminder=event('remember','2026-10-30T08:00:00Z',null,{kind:'reminder'});
 for(const [width,height,dark] of [[1920,1080,false],[1280,752,true],[820,1180,false],[390,844,true]] as const){setup(dark,width,height);const html=render(createElement(FamilyHub,{people,items:[remote,reminder],messages:[],zone,householdName:'Synthetic',now}));assert.ok(!html.includes('Synthetic remote24'));assert.ok(html.includes('Synthetic remember'));assert.ok(!html.includes('2 activities'));assert.ok(html.includes('This week'));}
});

test('a repeated fetch cannot refresh an old HA value and a current unchanged reading is valid',()=>{
 const item=temperature(4,'°C');const reported=Date.parse(item.metadata.temperature!.lastReportedAt!);
 assert.equal(temperatureIsStale(item,reported+30*60_000),false);assert.equal(temperatureIsStale(item,reported+30*60_000+1),true);
 item.metadata.temperature!.lastFetchedAt=new Date(reported+31*60_000).toISOString();assert.equal(temperatureIsStale(item,reported+31*60_000),true);
 item.metadata.temperature!.lastReportedAt=new Date(reported+31*60_000).toISOString();assert.equal(temperatureIsStale(item,reported+31*60_000),false);
 item.metadata.temperature!.lastReportedAt=null;item.metadata.temperature!.lastUpdatedAt=null;assert.equal(temperatureIsStale(item,reported),true);
});

test('an active unavailable sensor can be stopped or have sharing edited without requiring a successful read',async()=>{
 const {TemperatureEditor}=await import('../src/temperature-settings');
 const sensor={id:'sensor',externalId:'synthetic',entityId:'sensor.synthetic',identityKind:'registry' as const,name:'Synthetic',displayName:'Synthetic outside',enabled:true,order:1,available:false,validatedAt:'2026-10-15T08:00:00Z',value:3,unit:'°C',status:'unavailable',freshness:'stale',lastReportedAt:null,lastUpdatedAt:null,lastFetchedAt:null,lastSuccessfulPollAt:null,errorCode:null,visibility:{household:false,personIds:['p'],displayIds:[]},revision:1};
 const connection={ownerAccountId:'account',canShare:true,id:'connection',provider:'home_assistant' as const,name:'Synthetic HA',bridgeKind:'direct' as const,state:'expired',accountLabel:null,revision:1,lastSyncStartedAt:null,lastSyncSucceededAt:null,nextSyncAt:null,errorCode:null,disconnectedAt:null,sources:[],temperatureSensors:[sensor]};
 const member:import('../src/types').Membership={id:'membership',role_preset:'member',revision:1,household_name:'Synthetic',household_locale:'en',display_name:'Synthetic',household_id:'household',person_id:'p',timezone:zone,capabilities:[],display_ids:[]};
 const html=render(createElement(TemperatureEditor,{sensor,connection,path:'/synthetic',member,people:[],displays:[],onClose:()=>{},onSaved:async()=>{}}));
 assert.match(html,/<button class="button">Pause sensor<\/button>/);assert.match(html,/<button class="button primary">Save changes<\/button>/);assert.match(html,/<button class="button" disabled="">Preview measurement<\/button>/);
 const inactive=render(createElement(TemperatureEditor,{sensor:{...sensor,enabled:false},connection,path:'/synthetic',member,people:[],displays:[],onClose:()=>{},onSaved:async()=>{}}));assert.match(inactive,/<button class="button primary" disabled="">Activate/);
});

test('future-only people keep a truthful count-free details label on desktop, mobile and compact display',()=>{
 const remote=event('remote24','2026-10-24T08:00:00Z');const people=Array.from({length:6},(_,i)=>({id:i===0?'p':`p${i}`,displayName:i===0?'Synthetic Future':`Synthetic ${i}`}));
 for(const [width,height,dark] of [[1920,1080,false],[1280,752,true],[390,844,false]] as const)for(const display of [false,true]){setup(dark,width,height);const html=render(createElement(FamilyHub,{people,items:[remote],messages:[],zone,householdName:'Synthetic',now,display}));assert.ok(html.includes('aria-label="Open activities for Synthetic Future"'));assert.ok(!html.includes('Open all 0'));assert.ok(!html.includes('Synthetic remote24'));}
});
test('waste stays in its own collection even with a malformed legacy personal subject, without changing readers',async()=>{
 const {calendarSubjectsForPurpose}=await import('../src/calendar-presentation');const source={appliesTo:{household:false,personIds:['p']},visibility:{household:false,personIds:['reader'],displayIds:['display']}};const before=JSON.stringify(source);
 assert.deepEqual(calendarSubjectsForPurpose('waste',source.appliesTo),{household:true,personIds:[]});assert.equal(JSON.stringify(source),before);
 const waste=event('waste-private','2026-10-15T14:00:00Z');waste.metadata.calendar!.purpose='waste';
 assert.deepEqual(personalPreviewItems([waste],'p',now,zone),[]);assert.deepEqual(personalWindowItems([waste],'p',now,zone),[]);assert.equal(wasteEvents([waste],now,zone).length,1);
 assert.ok(!render(createElement(UpcomingActivities,{items:[waste],people:[],zone,now})).includes('Synthetic waste-private'));
});
test('same-client repair and partial calendar failure use ordinary retry, not another consent loop',async()=>{
 const {calendarCanReconnect,calendarCanSync,calendarSourceBlockedKey}=await import('../src/calendar-presentation');
 assert.equal(calendarCanReconnect('error','CALENDAR_CLIENT_CONFIGURATION_INVALID'),false);assert.equal(calendarCanSync('error','CALENDAR_CLIENT_CONFIGURATION_INVALID'),false);
 assert.equal(calendarCanSync('error',null),true);assert.equal(calendarCanSync('error','CALENDAR_PARTIAL_SYNC_FAILED'),true);assert.equal(calendarCanReconnect('error','CALENDAR_PARTIAL_SYNC_FAILED'),false);
 assert.equal(calendarCanReconnect('expired',null,true),false);assert.equal(calendarCanReconnect('expired',null),true);
 assert.equal(calendarSourceBlockedKey('connected',null,false),'calendarSourceUnavailable');assert.equal(calendarSourceBlockedKey('expired',null,false),'calendarReconnectBeforeUpdate');
 const {en}=await import('../src/locales/en');const {nb}=await import('../src/locales/nb');for(const messages of [en,nb]){assert.equal(messages.CALENDAR_CLIENT_CONFIGURATION_INVALID,messages.calendar_client_configuration_invalid);assert.ok(messages.calendarClientRepairHint);assert.ok(messages.CALENDAR_PARTIAL_SYNC_FAILED);}
 assert.match(en.CALENDAR_CLIENT_CONFIGURATION_INVALID,/without signing in again/);assert.match(nb.CALENDAR_CLIENT_CONFIGURATION_INVALID,/uten ny innlogging/);
});
test('source health reports each successful source independently during a partial failure',async()=>{
 const {CalendarSourceHealth}=await import('../src/calendar-connections');
 const source:import('../src/calendar-connection-types').CalendarSource={id:'synthetic-source',externalId:'synthetic',name:'Synthetic',displayName:null,enabled:true,revision:1,bridgeKind:'direct',purpose:'calendar',available:true,sourceIdentityKind:'registry',lastCompleteWindow:null,syncWindowDays:{past:1,future:30},appliesTo:{household:true,personIds:[]},visibility:{household:false,personIds:['p'],displayIds:[]},freshness:'current',lastSyncSucceededAt:'2026-10-15T08:00:00Z',errorCode:null};
 const healthy=render(createElement(CalendarSourceHealth,{source,zone}));const stale=render(createElement(CalendarSourceHealth,{source:{...source,freshness:'stale',errorCode:'CALENDAR_SOURCE_SYNC_FAILED'},zone}));assert.ok(healthy.includes('Calendar up to date'));assert.ok(stale.includes('Calendar may be outdated'));assert.ok(healthy.includes('Last successful update'));assert.ok(stale.includes('Last successful update'));assert.ok(!stale.includes('CALENDAR_SOURCE_SYNC_FAILED'));
});
test('sensor editor uses measurement-specific sharing and activation copy in both locales',async()=>{
 const {en}=await import('../src/locales/en');const {nb}=await import('../src/locales/nb');
 for(const messages of [en,nb]){assert.notEqual(messages.temperatureReaders,messages.calendarReaders);assert.notEqual(messages.temperatureActivate,messages.calendarActivate);assert.ok(messages.temperatureReadersHint);}
});
