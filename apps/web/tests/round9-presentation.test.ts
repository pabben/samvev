import {calendarStateKey,calendarCanReconnect} from '../src/calendar-presentation';
import {currentHub} from '../src/display-cache';
import type {Projection} from '../src/types';
import assert from 'node:assert/strict';
import test from 'node:test';
import {squareCrop} from '../src/photo-presentation';
import {initialMemberTab,memberTabUrl} from '../src/member-navigation';
import {itemHousehold,itemSubjectIds,personItems} from '../src/home-presentation';
import {personTaskStatusKey} from '../src/person-task-presentation';
import type {HubItem} from '../src/home-types';
import {en} from '../src/locales/en';
import {nb} from '../src/locales/nb';

test('photo crops stay square in oriented pixels and within image bounds at every position',()=>{
 for(const [width,height] of [[1200,800],[800,1200],[512,512],[1379,913]])for(const zoom of [1,1.05,2,4])for(const x of [0,.3,.5,1])for(const y of [0,.3,.5,1]){
  const crop=squareCrop(width!,height!,zoom,x,y);
  assert.ok(crop.x>=0&&crop.y>=0&&crop.x+crop.width<=1&&crop.y+crop.height<=1);
  assert.ok(Math.abs(crop.width*width!-crop.height*height!)<1e-9);
 }
});
test('validated deep links preserve intended pages and calendar callback without arbitrary redirects',()=>{
 for(const tab of ['calendar','people','integrations','monitors','ai','messages'] as const)assert.equal(initialMemberTab(`/?tab=${tab}`),tab);
 assert.equal(initialMemberTab('/integrations#calendar-oauth=opaque'),'integrations');
 assert.equal(initialMemberTab('/?tab=javascript:alert(1)'),'home');
 assert.equal(initialMemberTab('/?redirect=https://example.org/'),'home');
 assert.equal(initialMemberTab('/?tab=people#calendar-oauth=opaque'),'integrations');
});
test('calendar subjects are independent of readers while legacy targeted items retain their person links',()=>{
 const legacy={id:'fixture',metadata:{},subjects:{personIds:[]},targets:{household:false,personIds:['reader']}} as unknown as HubItem;
 assert.deepEqual(itemSubjectIds(legacy),['reader']);
 const calendar={...legacy,subjects:{personIds:['subject']},targets:{household:true,personIds:['reader']},metadata:{calendar:{provider:'google',sourceId:'synthetic',bridgeKind:'direct',subjectHousehold:false}}};
 assert.deepEqual(personItems([calendar],'reader'),[]);
 assert.deepEqual(personItems([calendar],'subject'),[calendar]);
 assert.equal(itemHousehold(calendar),false);
 const shared={...calendar,subjects:{personIds:[]},metadata:{calendar:{...calendar.metadata.calendar,subjectHousehold:true}}};
 assert.equal(itemHousehold(shared),true);
 assert.deepEqual(itemSubjectIds(shared),[]);
});
test('never run, running, failed, no findings and older results have distinct localized labels',()=>{
 const states=['running','not_run','no_findings','no_change','failed','findings','superseded'] as const;
 assert.equal(new Set(states.map(personTaskStatusKey)).size,states.length);
 for(const state of states){const key=personTaskStatusKey(state);assert.ok(en[key]);assert.ok(nb[key]);}
 assert.notEqual(en.personTaskOlderResult,en.personTaskFailed);
 assert.notEqual(nb.personTaskOlderResult,nb.personTaskNoFindings);
});

test('actual provider setup and expired states offer reconnect after denied consent or reload',()=>{
 for(const state of ['setup','awaiting_consent','expired','error'])assert.equal(calendarCanReconnect(state),true);
 for(const state of ['connected','syncing','disconnected'])assert.equal(calendarCanReconnect(state),false);
 assert.equal(calendarStateKey('setup'),'calendarDraft');
 assert.equal(calendarStateKey('expired'),'calendarExpired');
});
test('offline display preserves only already-authorized active calendar subjects and removes them on expiry',()=>{
 const now=Date.parse('2026-10-14T12:00:00Z');
 const item={id:'synthetic-calendar',targets:{household:false,personIds:['reader']},subjects:{personIds:['subject']},publishAt:null,expiresAt:new Date(now+1000).toISOString()} as HubItem;
 const projection={hub:{items:[item],people:[{id:'subject',displayName:'Synthetic subject'},{id:'unrelated',displayName:'Synthetic unrelated'}]}} as Projection;
 const clock={serverAt:now,monotonicAt:0,deadline:now+2000};
 assert.deepEqual(currentHub(projection,clock,500)?.people.map(p=>p.id),['subject']);
 assert.deepEqual(currentHub(projection,clock,1000)?.people,[]);
 assert.equal(currentHub(projection,clock,2000),undefined);
});

test('Home canonicalizes to root while member deep links and pending calendar completion survive navigation',()=>{
 assert.equal(initialMemberTab('/?tab=home'),'home');
 for(const url of ['/','/?tab=home','/?tab=people','/integrations?tab=integrations'])assert.equal(memberTabUrl(url,'home'),'/');
 for(const tab of ['calendar','people','integrations','monitors','ai'] as const){
  const url=memberTabUrl('/',tab);
  assert.equal(url,`/?tab=${tab}`);
  assert.equal(initialMemberTab(url),tab);
 }
 assert.equal(memberTabUrl('/integrations#calendar-oauth=synthetic-token','integrations'),'/?tab=integrations#calendar-oauth=synthetic-token');
 assert.equal(memberTabUrl('/integrations?calendar=consent_denied','integrations'),'/?calendar=consent_denied&tab=integrations');
});
