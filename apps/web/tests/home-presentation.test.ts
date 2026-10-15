import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptivePeopleLayout,currentItems,dayEvents,messageAvatarKey,personItems,importantItems,importantPreviewLimit,hubSectionOrder,splitBriefs,resolveHubDetail,collectionItems,hiddenPersonalCount,personalPreviewItems} from '../src/home-presentation';
import {currentHub} from '../src/display-cache';
import type {HubItem} from '../src/home-types';
import type {Projection} from '../src/types';
const now=Date.parse('2026-03-28T23:30:00Z');
const item:HubItem={contentLocale:'en',id:'i',kind:'event',targets:{household:false,personIds:['p']},title:'Synthetic event',body:'',entries:[],priority:'normal',publishAt:null,startsAt:'2026-03-29T00:00:00Z',endsAt:null,expiresAt:null,source:{label:'Synthetic',observedAt:new Date(now).toISOString(),uncertainty:'unknown'},metadata:{},revision:1,updatedAt:new Date(now).toISOString()};
test('larger rosters balance within the actual people panel without a lone tall fifth card',()=>{
 for(const count of [0,1,4])assert.equal(adaptivePeopleLayout(count,1100,14),null);
 assert.equal(adaptivePeopleLayout(5,0,14),null);
 for(const width of [776,844,1100]){
  const five=adaptivePeopleLayout(5,width,14)!;
  assert.equal(five.rows,1);
  assert.ok((width-(five.columns-1)*14)/five.columns>=144);
 }
 for(const count of [5,6,8])for(const width of [310,620,776,1100]){
  const {columns,rows}=adaptivePeopleLayout(count,width,14)!;
  assert.equal(rows,Math.ceil(count/columns));
  assert.ok(columns*rows>=count);
  if(width>=620)assert.ok(count-(rows-1)*columns>1,'no isolated last identity when space supports a balanced row');
  assert.ok((width-(columns-1)*14)/columns>=144);
 }
 assert.deepEqual(adaptivePeopleLayout(5,143,14),{columns:1,rows:5});
});
test('reminder previews use available composition without losing the current collection',()=>{
 const reminders=Array.from({length:7},(_,i)=>({...item,id:`r${i}`,kind:'reminder' as const,title:`Synthetic long reminder ${i}`}));
 for(const dark of [false,true])for(const compact of [false,true])for(const lowHeight of [false,true]){
  const limit=importantPreviewLimit({dark,compact,lowHeight});
  assert.equal(limit,dark&&!compact?(lowHeight?2:3):1);
  for(const count of [0,1,2,7]){
   const current=reminders.slice(0,count);
   assert.equal(current.slice(0,limit).length,Math.min(count,limit));
   assert.deepEqual(collectionItems('important',current,now,'UTC'),current);
  }
 }
});
test('today and tomorrow use household day across DST; events use startsAt, not publication',()=>{
 const tomorrow={...item,id:'tomorrow',startsAt:'2026-03-29T22:10:00Z'};
 assert.deepEqual(dayEvents([item,tomorrow],now,'Europe/Oslo').map(i=>i.id),['i']);
 assert.deepEqual(dayEvents([item,tomorrow],now,'Europe/Oslo',1).map(i=>i.id),['tomorrow']);
 assert.deepEqual(dayEvents([{...item,kind:'reminder'}],now,'Europe/Oslo'),[]);
});
test('recipient grouping never substitutes author or household membership',()=>{
 assert.equal(personItems([item], 'other').length,0);assert.equal(personItems([item],'p').length,1);
 assert.equal(personItems([{...item,targets:{household:true,personIds:[]}}],'p').length,0);
 assert.equal(importantItems([item,{...item,id:'alert',kind:'alert'}]).length,1);
});
test('current items respect publish and expiry; null expiry remains current',()=>{
 assert.equal(currentItems([item],now).length,1);
 assert.equal(currentItems([{...item,publishAt:new Date(now+1).toISOString()}],now).length,0);
 assert.equal(currentItems([{...item,expiresAt:new Date(now).toISOString()}],now).length,0);
});
test('external offline cache removes expired items and associated people before global deadline; supports old projections',()=>{
 const projection={hub:{items:[{...item,expiresAt:new Date(now+1000).toISOString()}],people:[{id:'p',displayName:'Synthetic'}]}} as Projection;
 const clock={serverAt:now,monotonicAt:50,deadline:now+900000};
 assert.equal(currentHub(projection,clock,50)?.items.length,1);
 assert.deepEqual(currentHub(projection,clock,1050),{items:[],people:[]});
 assert.equal(currentHub(projection,clock,900050),undefined);
 assert.equal(currentHub({} as Projection,clock,50),undefined);
 projection.hub!.items[0]!.expiresAt=null;
 assert.equal(currentHub(projection,clock,899050)?.items.length,1);
 assert.equal(currentHub(projection,clock,900050),undefined);
});

test('published past events remain personal information without being presented as upcoming',()=>{
 const past={...item,startsAt:'2026-03-27T12:00:00Z'};
 assert.equal(personItems(currentItems([past],now),'p')[0],past);
 assert.deepEqual(dayEvents([past],now,'Europe/Oslo'),[]);
});


test('responsive compositions preserve each content entry once and mobile uses direct identities instead of person-card stacks',()=>{
 for(const dark of [false,true])for(const compact of [false,true])for(const mobile of [false,true]){
  const order=hubSectionOrder(dark,compact,mobile);
  assert.equal(new Set(order).size,order.length);
  for(const key of ['important','messages','support'])assert.equal(order.filter(value=>value===key).length,1);
  assert.equal(order.includes('people'),!mobile);
  assert.equal(order.includes('dayPlan'),!dark&&!mobile);
  assert.ok(order.indexOf('messages')<order.indexOf('support'));
 }
 assert.deepEqual(hubSectionOrder(false,false).slice(0,4),['people','dayPlan','important','messages']);
 assert.deepEqual(hubSectionOrder(true,false).slice(0,4),['today','tomorrow','people','important']);
 assert.deepEqual(hubSectionOrder(false,true,true).slice(0,2),['important','messages']);
 assert.deepEqual(hubSectionOrder(true,true,true).slice(0,3),['important','quickActions','today']);
});

test('the message companion uses a real observation once and preserves remaining source order',()=>{
 const summary={...item,id:'summary',kind:'summary' as const};
 const list={...item,id:'list',kind:'list' as const};
 const observation={...item,id:'observation',kind:'observation' as const};
 const input=[summary,list,observation];
 const result=splitBriefs(input);
 assert.equal(result.companion,observation);
 assert.deepEqual(result.remaining,[summary,list]);
 assert.deepEqual(input,[summary,list,observation]);
 assert.equal(new Set([result.companion,...result.remaining].map(i=>i.id)).size,input.length);
});
test('no observation falls back to a real support item; an empty feed creates no companion',()=>{
 const summary={...item,id:'summary',kind:'summary' as const};
 const list={...item,id:'list',kind:'list' as const};
 assert.deepEqual(splitBriefs([summary,list]),{agendaCompanion:undefined,companion:summary,remaining:[list]});
 assert.deepEqual(splitBriefs([summary]),{agendaCompanion:undefined,companion:summary,remaining:[]});
 assert.deepEqual(splitBriefs([]),{agendaCompanion:undefined,companion:undefined,remaining:[]});
});


test('stacked agenda redistributes existing support without duplication, fabrication or mutation',()=>{
 const observation={...item,id:'observation',kind:'observation' as const};
 const summary={...item,id:'summary',kind:'summary' as const};
 const list={...item,id:'list',kind:'list' as const};
 const input=[list,summary,observation];
 assert.deepEqual(splitBriefs(input,true),{agendaCompanion:observation,companion:summary,remaining:[list]});
 assert.deepEqual(input,[list,summary,observation]);
 assert.deepEqual(splitBriefs([observation],true),{agendaCompanion:observation,companion:undefined,remaining:[]});
 assert.deepEqual(splitBriefs([],true),{agendaCompanion:undefined,companion:undefined,remaining:[]});
 assert.deepEqual(splitBriefs([list,summary],true),{agendaCompanion:list,companion:summary,remaining:[]});
});

test('personal disclosure count describes only entries beyond the current preview',()=>{
 assert.equal(hiddenPersonalCount(2,1),1);
 assert.equal(hiddenPersonalCount(2,3),0);
 assert.equal(hiddenPersonalCount(4,3),1);
 assert.equal(hiddenPersonalCount(8,1),7);
 assert.equal(hiddenPersonalCount(0,3),0);
 const summary={...item,id:'summary',kind:'summary' as const};
 const household={...item,id:'household',targets:{household:true,personIds:[]}};
 assert.deepEqual(personalPreviewItems([item,summary,household],'p',now,'Europe/Oslo'),[item]);
});

test('personal lists and summaries count as current content even without an activity preview',()=>{
 const list={...item,id:'personal-list',kind:'list' as const};
 const summary={...item,id:'personal-summary',kind:'summary' as const};
 const unrelated={...item,id:'unrelated',targets:{household:false,personIds:['other']}};
 for(const entries of [[list],[summary],[list,summary],[item,list,summary]]){
  const active=currentItems([...entries,unrelated],now);
  const all=personItems(active,'p');
  const preview=personalPreviewItems(active,'p',now,'Europe/Oslo');
  assert.equal(all.length,entries.length);
  for(const limit of [0,1,3]){
   const visible=preview.slice(0,limit);
   assert.equal(hiddenPersonalCount(all.length,visible.length),all.length-visible.length);
   const detail=resolveHubDetail({kind:'person',id:'p'},[{id:'p',displayName:'Synthetic'}],active);
   assert.deepEqual(detail?.kind==='person'?detail.items:[],entries);
  }
 }
 assert.equal(personItems(currentItems([{...list,expiresAt:new Date(now).toISOString()}],now),'p').length,0);
});

test('detail identities resolve current revisions and discard withdrawn, expired or unavailable items',()=>{
 const selected={kind:'item' as const,id:item.id};
 const revised={...item,title:'Updated permitted detail',revision:2};
 assert.deepEqual(resolveHubDetail(selected,[],[revised]),{kind:'item',item:revised});
 assert.equal(resolveHubDetail(selected,[],[]),undefined);
 assert.equal(resolveHubDetail(selected,[],currentItems([{...revised,expiresAt:new Date(now).toISOString()}],now)),undefined);
 assert.equal(resolveHubDetail(null,[],[item]),undefined);
});

test('person detail resolves only current targeted entries and disappears with that projected person',()=>{
 const person={id:'p',displayName:'Synthetic person'};
 const selected={kind:'person' as const,id:person.id};
 const unrelated={...item,id:'other',targets:{household:false,personIds:['other']}};
 assert.deepEqual(resolveHubDetail(selected,[person],[item,unrelated]),{kind:'person',person,items:[item]});
 assert.deepEqual(resolveHubDetail(selected,[person],[]),{kind:'person',person,items:[]});
 assert.equal(resolveHubDetail(selected,[],[item]),undefined);
});


test('person details remain available with zero, one and many entries, including personal lists and current avatar choice',()=>{
 const person={id:'p',displayName:'Synthetic person',avatarKey:'avatar-03'};
 const selection={kind:'person' as const,id:'p'};
 const list={...item,id:'list',kind:'list' as const,entries:[{label:'Synthetic list entry'}]};
 for(const entries of [[],[item],[item,list]]){
  const resolved=resolveHubDetail(selection,[person],entries);
  assert.equal(resolved?.kind,'person');
  if(resolved?.kind==='person'){assert.deepEqual(resolved.items,entries);assert.equal(resolved.person.avatarKey,'avatar-03');}
 }
 assert.equal(resolveHubDetail(selection,[{...person,avatarKey:'avatar-06'}],[item])?.kind,'person');
});


test('a permitted display author illustration does not require expanding the targeted person roster',()=>{
 const message={authorPersonId:'author',authorAvatarKey:'avatar-04'};
 const unrelated=[{id:'targeted-person',displayName:'Same synthetic name',avatarKey:'avatar-02'}];
 assert.equal(messageAvatarKey(message,unrelated),'avatar-04');
 assert.equal(messageAvatarKey({...message,authorPersonId:null},unrelated),null);
 assert.equal(messageAvatarKey({authorAvatarKey:'avatar-04'},unrelated),null);
 assert.equal(messageAvatarKey({authorPersonId:'unknown'},unrelated),null);
 assert.equal(messageAvatarKey(message,[{id:'author',displayName:'Synthetic author',avatarKey:'avatar-06'}]),'avatar-06');
 assert.equal(messageAvatarKey(message,[{id:'author',displayName:'Synthetic author',avatarKey:null}]),null);
 assert.equal(unrelated.length,1);
});

test('counted collection details resolve current permitted content and message updates, never stale previews',()=>{
 const reminder={...item,id:'reminder',kind:'reminder' as const};
 const brief={...item,id:'brief',kind:'summary' as const};
 const message={id:'message',body:'Full synthetic message',importance:'normal' as const,authorName:'Synthetic',publishAt:new Date(now-1).toISOString(),expiresAt:new Date(now+1).toISOString(),revision:1};
 assert.deepEqual(collectionItems('important',[item,reminder,brief],now,'Europe/Oslo'),[reminder]);
 assert.deepEqual(collectionItems('briefs',[item,reminder,brief],now,'Europe/Oslo'),[brief]);
 assert.deepEqual(collectionItems('today',[item,reminder,brief],now,'Europe/Oslo'),[item]);
 const selected={kind:'message' as const,id:'message'};
 assert.equal(resolveHubDetail(selected,[],[],[],now),undefined);
 assert.deepEqual(resolveHubDetail(selected,[],[],[{...message,body:'Updated full message',revision:2}],now),{kind:'message',message:{...message,body:'Updated full message',revision:2}});
 assert.deepEqual(resolveHubDetail({kind:'collection',id:'messages'},[],[],[message],now),{kind:'collection',id:'messages',items:[],messages:[message]});
 assert.deepEqual(resolveHubDetail({kind:'collection',id:'important'},[],[],[],now),{kind:'collection',id:'important',items:[],messages:[]});
});

test('long six-person identities use balanced readable columns while short names keep existing layout',async()=>{
 const {peopleCardMinWidth}=await import('../src/home-presentation');
 const long=Array.from({length:6},(_,i)=>({displayName:`Synthetic person ${i} with a deliberately long calendar name`}));
 assert.equal(peopleCardMinWidth(long),240);
 assert.deepEqual(adaptivePeopleLayout(6,950,14,peopleCardMinWidth(long)),{columns:3,rows:2});
 const normal=['Ada','Bo','Celine','David','Eva','Finn'].map(displayName=>({displayName}));
 assert.equal(peopleCardMinWidth(normal),144);
 assert.deepEqual(adaptivePeopleLayout(6,950,14,peopleCardMinWidth(normal)),{columns:6,rows:1});
});
test('calendar all-day agenda membership follows civil dates and excludes the exclusive final day',()=>{
 const calendar={...item,startsAt:'2026-10-22T00:00:00Z',endsAt:'2026-10-24T00:00:00Z',metadata:{allDay:true,calendar:{provider:'google',sourceId:'synthetic',bridgeKind:'direct',subjectHousehold:false}}};
 for(const zone of ['Europe/Oslo','America/Los_Angeles']){
  assert.equal(dayEvents([calendar],Date.parse('2026-10-21T12:00:00Z'),zone).length,0);
  assert.equal(dayEvents([calendar],Date.parse('2026-10-22T12:00:00Z'),zone).length,1);
  assert.equal(dayEvents([calendar],Date.parse('2026-10-23T12:00:00Z'),zone).length,1);
  assert.equal(dayEvents([calendar],Date.parse('2026-10-24T12:00:00Z'),zone).length,0);
 }
});
