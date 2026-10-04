import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentItems,dayEvents,messageAvatarKey,personItems,importantItems,hubSectionOrder,splitBriefs,resolveHubDetail,hiddenPersonalCount,personalPreviewItems} from '../src/home-presentation';
import {currentHub} from '../src/display-cache';
import type {HubItem} from '../src/home-types';
import type {Projection} from '../src/types';
const now=Date.parse('2026-03-28T23:30:00Z');
const item:HubItem={contentLocale:'en',id:'i',kind:'event',targets:{household:false,personIds:['p']},title:'Synthetic event',body:'',entries:[],priority:'normal',publishAt:null,startsAt:'2026-03-29T00:00:00Z',endsAt:null,expiresAt:null,source:{label:'Synthetic',observedAt:new Date(now).toISOString(),uncertainty:'unknown'},metadata:{},revision:1,updatedAt:new Date(now).toISOString()};
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
  for(const key of ['important','messages','companion','briefs'])assert.equal(order.filter(value=>value===key).length,1);
  assert.equal(order.includes('people'),!mobile);
  assert.equal(order.includes('dayPlan'),!dark&&!mobile);
  assert.ok(order.indexOf('messages')<order.indexOf('briefs'));
 }
 assert.deepEqual(hubSectionOrder(false,false).slice(0,4),['people','dayPlan','messages','important']);
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
 assert.deepEqual(personalPreviewItems([item,summary,household],'p'),[item]);
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
