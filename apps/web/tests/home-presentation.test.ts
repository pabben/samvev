import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentItems,dayEvents,personItems,importantItems} from '../src/home-presentation';
import {currentHub} from '../src/display-cache';
import type {HubItem} from '../src/home-types';
import type {Projection} from '../src/types';
const now=Date.parse('2026-03-28T23:30:00Z');
const item:HubItem={id:'i',kind:'event',targets:{household:false,personIds:['p']},title:'Synthetic event',body:'',entries:[],priority:'normal',publishAt:null,startsAt:'2026-03-29T00:00:00Z',endsAt:null,expiresAt:null,source:{label:'Synthetic',observedAt:new Date(now).toISOString(),uncertainty:'unknown'},metadata:{},revision:1,updatedAt:new Date(now).toISOString()};
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
