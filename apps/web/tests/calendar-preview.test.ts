import assert from 'node:assert/strict';
import test from 'node:test';
import {readCalendarPreview,matchesCalendarPreview} from '../src/calendar-preview';
import type {api} from '../src/api';

test('preview of an edited active calendar reads events without saving people, readers or enabled state',async()=>{
 const saved={revision:4,enabled:true,subjects:['old-subject'],readers:['old-reader'],displays:['old-display']};
 const before=structuredClone(saved);
 const edited=JSON.stringify({subjects:['new-subject'],readers:['whole-household'],displays:[]});
 const requests:{path:string;method:string|undefined;body:unknown}[]=[];
 const request:typeof api=async <T>(path:string,method?:string,body?:unknown)=>{
  requests.push({path,method,body});
  assert.equal(method,'POST');assert.ok(path.endsWith('/preview'));
  assert.deepEqual(body,{expectedSourceRevision:4});
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
