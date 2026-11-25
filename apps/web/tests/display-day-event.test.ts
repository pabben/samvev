import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {HouseholdTimelineActivity,HubPerson} from '../src/home-types';
registerHooks({load(url,context,nextLoad){return /\.(webp|png|svg)$/.test(url)?{format:'module',source:'export default "synthetic-asset"',shortCircuit:true}:nextLoad(url,context)}});
const [{DisplayDayCalendarEvent},{LocaleProvider}]=await Promise.all([import('../src/display'),import('../src/ui')]);
const people:HubPerson[]=[{id:'allowed-person',displayName:'Synthetic visible person'}];
function event():Extract<HouseholdTimelineActivity,{type:'calendar'}>{return{
 type:'calendar',id:'synthetic-event',kind:'event',title:'Synthetic practice',body:'Bring a water bottle',
 personIds:['allowed-person','not-projected-person'],subjects:{personIds:['allowed-person','not-projected-person']},targets:{household:false,personIds:['allowed-person']},
 startsAt:'2026-11-08T16:00:00Z',endsAt:'2026-11-08T17:00:00Z',expiresAt:null,publishAt:null,
 contentLocale:null,entries:[],priority:'normal',revision:1,updatedAt:'2026-11-08T08:00:00Z',
 source:{label:'Synthetic source',observedAt:'2026-11-08T08:00:00Z',uncertainty:'low'},
 metadata:{allDay:false,calendar:{provider:'ics',sourceId:'synthetic-source',bridgeKind:'direct',subjectHousehold:false}},
}}
function markup(activity=event(),locale:'en'|'nb'='nb',zone='Europe/Oslo',now=Date.parse('2026-11-08T16:30:00Z')){
 return renderToStaticMarkup(createElement(LocaleProvider,{locale,children:createElement(DisplayDayCalendarEvent,{activity,people,zone,now})}));
}
test('populated standalone day event renders local time range, authorized names, title and body',()=>{
 const html=markup();assert.match(html,/Synthetic practice/);assert.match(html,/Bring a water bottle/);assert.match(html,/<time /);assert.match(html,/17[:.]00/);assert.match(html,/18[:.]00/);assert.match(html,/Synthetic visible person/);assert.doesNotMatch(html,/not-projected-person|Hele husstanden|Avsluttet/);
});
test('unprojected person IDs do not become names or an invented household audience',()=>{
 const activity=event();activity.personIds=['not-projected-person'];const html=markup(activity);assert.doesNotMatch(html,/Synthetic visible person|not-projected-person|Hele husstanden|field-hint/);
});
test('household subject label is localized without requiring or exposing a profile',()=>{
 const activity=event();activity.personIds=[];activity.metadata.calendar!.subjectHousehold=true;
 assert.match(markup(activity,'nb'),/Hele husstanden/);assert.match(markup(activity,'en'),/The whole household/);
});
test('all-day event shows localized all-day label and civil date across timezone offsets',()=>{
 const activity=event();activity.metadata.allDay=true;activity.startsAt='2026-11-08T00:00:00Z';activity.endsAt='2026-11-09T00:00:00Z';
 const html=markup(activity,'en','Pacific/Honolulu',Date.parse('2026-11-08T22:00:00Z'));const visible=html.replace(/<[^>]*>/g,'');assert.match(visible,/All day/);assert.match(visible,/Nov 8/);assert.doesNotMatch(visible,/Nov 7|Nov 9|\d{1,2}:\d{2}|Ended/);
});
test('exclusive ended marker is retained at the event end',()=>{
 const html=markup(event(),'nb','Europe/Oslo',Date.parse('2026-11-08T17:00:00Z'));assert.match(html,/hub-ended-label/);assert.match(html,/Avsluttet/);assert.match(html,/Synthetic visible person/);assert.match(html,/17[:.]00/);
});
