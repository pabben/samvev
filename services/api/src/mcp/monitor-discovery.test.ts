import assert from 'node:assert/strict';
import test from 'node:test';
import type { DbClient } from '../db.ts';
import { discoverMonitorNames, monitorDiscoveryInputSchema, safeMonitorName } from './monitor-discovery.ts';

test('discovery validates trimmed bounded filters, cursor, and page size',()=>{
  assert.equal(monitorDiscoveryInputSchema.parse({nameQuery:'  Åse  ',limit:20}).nameQuery,'Åse');
  assert.throws(()=>monitorDiscoveryInputSchema.parse({nameQuery:'   '}));
  assert.throws(()=>monitorDiscoveryInputSchema.parse({nameQuery:'x'.repeat(81)}));
  assert.throws(()=>monitorDiscoveryInputSchema.parse({limit:51}));
  assert.equal(monitorDiscoveryInputSchema.parse({}).limit,20);
});

test('discovery uses an escaped literal filter and returns only bounded safe fields with an id cursor',async()=>{
  let queryText='';let values:unknown[]=[];
  const rows=Array.from({length:3},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+2).padStart(12,'0')}`,name:index===0?'Møte 100%_!':index===1?'Lekser https://school.invalid/?token=synthetic-secret':'Møte 100%_! dupe',state:'paused' as const}));
  const cursor='00000000-0000-4000-8000-000000000001';
  const client={query:async(text:string,params:unknown[])=>{queryText=text;values=params;return{rows,rowCount:rows.length};}} as unknown as DbClient;
  const result=await discoverMonitorNames(client,'00000000-0000-4000-8000-999999999999',monitorDiscoveryInputSchema.parse({nameQuery:" 100%_! 'Å ",afterId:cursor,limit:1}));
  assert.match(queryText,/household_id=\$1/);assert.match(queryText,/id>\$2::uuid/);assert.match(queryText,/ILIKE \$3 ESCAPE/);assert.match(queryText,/ORDER BY id ASC LIMIT \$4/);
  assert.deepEqual(values,['00000000-0000-4000-8000-999999999999',cursor,"%100\\%\\_! 'Å%",2]);
  assert.deepEqual(result,{tasks:[{id:rows[0]!.id,name:rows[0]!.name,state:'paused'}],nextAfterId:rows[0]!.id});
  assert.deepEqual(Object.keys(result.tasks[0]!).sort(),['id','name','state']);
  assert.equal(safeMonitorName('Visit https://school.invalid/a?token=abc or plan'),'Visit [link removed] or plan');
});
