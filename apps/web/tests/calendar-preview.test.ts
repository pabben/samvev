import assert from 'node:assert/strict';
import test from 'node:test';
import {readCalendarPreview,matchesCalendarPreview,calendarIcsSizeMessage} from '../src/calendar-preview';
import type {api} from '../src/api';
import type {CalendarConnection} from '../src/calendar-connection-types';
import {en} from '../src/locales/en';
import {nb} from '../src/locales/nb';
import {calendarConnectionUiGroups} from '../src/calendar-presentation';

test('preview of an edited active calendar reads events without saving people, readers or enabled state',async()=>{
 const saved={revision:4,enabled:true,subjects:['old-subject'],readers:['old-reader'],displays:['old-display']};
 const before=structuredClone(saved);
 const edited=JSON.stringify({subjects:['new-subject'],readers:['whole-household'],displays:[]});
 const requests:{path:string;method:string|undefined;body:unknown}[]=[];
 const request:typeof api=async <T>(path:string,method?:string,body?:unknown)=>{
  requests.push({path,method,body});
  assert.equal(method,'POST');assert.ok(path.endsWith('/preview'));
  assert.deepEqual(body,{expectedSourceRevision:4,syncWindowDays:{past:28,future:364}});
  return{sourceId:'synthetic-source',sourceRevision:4,totalCount:1,events:[{title:'Synthetic event',start:'2026-10-14T12:00:00Z',end:null,allDay:false}]} as T;
 };
 const preview=await readCalendarPreview('/households/synthetic/calendar-connections/example/sources/source',saved.revision,edited,request);
 assert.equal(requests.length,1);
 assert.deepEqual(saved,before);
 assert.equal(preview.events[0]?.title,'Synthetic event');
 assert.equal(matchesCalendarPreview(preview,4,edited),true);
 // Changing the draft while the request is in flight, or a concurrent source
 // edit, must require another preview before the explicit activation action.
 assert.equal(matchesCalendarPreview(preview,4,JSON.stringify({subjects:['changed-again']})),false);
 assert.equal(matchesCalendarPreview(preview,5,edited),false);
});
test('failed preview does not invoke a write or produce an activatable draft',async()=>{
 let calls=0;
 const request:typeof api=async(path,method)=>{calls++;assert.equal(method,'POST');assert.ok(path.endsWith('/preview'));throw new Error('source unavailable')};
 await assert.rejects(()=>readCalendarPreview('/synthetic/source',2,'unsaved-draft',request),/source unavailable/);
 assert.equal(calls,1);assert.equal(matchesCalendarPreview(undefined,2,'unsaved-draft'),false);
});
test('preview sends the selected window and size errors have readable MiB or a safe fallback',async()=>{
 let sent:unknown;
 const request:typeof api=async <T>(_path:string,method?:string,body?:unknown)=>{assert.equal(method,'POST');sent=body;return{sourceId:'synthetic',sourceRevision:2,totalCount:0,events:[]} as T};
 await readCalendarPreview('/synthetic/source',2,'window-draft',request,{past:14,future:182});
 assert.deepEqual(sent,{expectedSourceRevision:2,syncWindowDays:{past:14,future:182}});
 assert.deepEqual(calendarIcsSizeMessage({observedBytes:6*1048576,maxBytes:5*1048576}),{key:'calendarIcsTooLarge',values:{observedMiB:6,maxMiB:5}});
 assert.deepEqual(calendarIcsSizeMessage({declaredBytes:8*1048576,maxBytes:5*1048576}),{key:'calendarIcsTooLargeDeclared',values:{declaredMiB:8,maxMiB:5}});
 assert.deepEqual(calendarIcsSizeMessage({observedBytes:6*1048576}),{key:'calendarIcsTooLargeFallback',values:{}});
 assert.match(en.calendarIcsTooLarge,/after receiving .* MiB.*not the calendar’s declared total size/);
 assert.match(nb.calendarIcsTooLarge,/mottatt da nedlastingen ble avbrutt/);
 assert.match(en.calendarIcsTooLargeDeclared,/declared a total size of .* MiB.*configured download limit is .* MiB/);
 assert.match(nb.calendarIcsTooLargeDeclared,/oppgir en totalstørrelse på .* MiB.*nedlastingsgrensen er .* MiB/);
 assert.doesNotMatch(en.calendar_ics_response_too_large,/{\w+}/);
 assert.doesNotMatch(nb.calendar_ics_response_too_large,/{\w+}/);
});

test('only disconnected Google, Microsoft, and ICS connections are offered for removal',async()=>{
 const fixture=(id:string,provider:'google'|'microsoft'|'ics'|'home_assistant',disconnectedAt:string|null)=>({id,provider,disconnectedAt}) as unknown as CalendarConnection;
 const groups=calendarConnectionUiGroups([
  fixture('google-old','google','2026-10-30T00:00:00Z'),
  fixture('microsoft-old','microsoft','2026-10-30T00:00:00Z'),
  fixture('ics-old','ics','2026-10-30T00:00:00Z'),
  fixture('ha-old','home_assistant','2026-10-30T00:00:00Z'),
  fixture('ha-active','home_assistant',null),
 ]);
 assert.deepEqual(groups.main.map(connection=>connection.id),['ha-old','ha-active']);
 assert.deepEqual(groups.removable.map(connection=>connection.id),['google-old','microsoft-old','ics-old']);
});
