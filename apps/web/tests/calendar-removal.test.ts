import assert from 'node:assert/strict';
import test from 'node:test';
import {removeCalendarConnectionsInChunks,reconcileCalendarRemovalSnapshot} from '../src/calendar-removal';
import {en} from '../src/locales/en';
import {nb} from '../src/locales/nb';

test('bulk calendar removal chunks 13 confirmed entries and preserves a reactivated connection',async()=>{
 const snapshot=Array.from({length:13},(_,index)=>({
  id:`connection-${index+1}`,
  expectedRevision:4,
  name:`Synthetic connection ${index+1}`,
 }));
 const calls:Array<Array<{id:string;expectedRevision:number}>>=[];
 const removed:string[]=[];
 let refreshes=0;
 await assert.rejects(()=>removeCalendarConnectionsInChunks(
  snapshot,
  async chunk=>{
   calls.push(chunk);
   if(chunk.some(item=>item.id==='connection-13')){
    // The server sees the confirmation-time revision. Its revision fence
    // rejects this entry after it has been reactivated at revision 5.
    assert.deepEqual(chunk,[{id:'connection-13',expectedRevision:4}]);
    throw new Error('REVISION_CONFLICT');
   }
  },
  async ids=>{removed.push(...ids)},
  async()=>{refreshes++},
 ),/REVISION_CONFLICT/);
 assert.deepEqual(calls.map(chunk=>chunk.length),[12,1]);
 assert.deepEqual(removed,snapshot.slice(0,12).map(item=>item.id));
 assert.equal(refreshes,2,'refreshes after the successful chunk and the failed chunk');
 assert.equal(snapshot[12]?.name,'Synthetic connection 13','the dialog retains the failed connection name');
});

test('snapshot reconciliation drops changed or active entries without adopting new revisions',()=>{
 const snapshot=[
  {id:'unchanged',expectedRevision:4,name:'Still disconnected'},
  {id:'reactivated',expectedRevision:4,name:'Now active'},
  {id:'changed',expectedRevision:4,name:'Revision changed'},
 ];
 const current=[
  {id:'unchanged',revision:4,disconnectedAt:'2026-11-01T00:00:00Z'},
  {id:'reactivated',revision:5,disconnectedAt:null},
  {id:'changed',revision:5,disconnectedAt:'2026-11-01T00:00:00Z'},
 ];
 assert.deepEqual(reconcileCalendarRemovalSnapshot(snapshot,current),[snapshot[0]]);
 assert.match(en.calendarRemoveBatchPartial,/Removed \{removed\} connection/);
 assert.match(nb.calendarRemoveBatchPartial,/fjernet/);
});
