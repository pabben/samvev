import assert from 'node:assert/strict';
import test from 'node:test';
import { extractionFromAi } from './service.ts';
import { monitorEventKey, orderedMonitorEvents } from './event-identity.ts';

const event=(date:string,description='Trip day')=>({date,time:null,type:'trip',description,actions:['Bring boots'],who:['A'],evidence:{quote:`${date} A Bring boots`,sourceUrl:'https://example.com/plan'},confidence:0.9,uncertainty:null});

test('event identity keeps repeated dates distinct and survives date or description corrections',()=>{
  const repeated=orderedMonitorEvents([event('2030-09-20'),event('2030-09-27')]);
  assert.notEqual(monitorEventKey('task',repeated[0]!.eventKeyPart),monitorEventKey('task',repeated[1]!.eventKeyPart));
  const original=orderedMonitorEvents([event('2030-09-20')])[0]!;const corrected=orderedMonitorEvents([event('2030-09-21','Corrected trip day')])[0]!;
  assert.equal(monitorEventKey('task',original.eventKeyPart),monitorEventKey('task',corrected.eventKeyPart));
});

test('validated extraction rejects past and unsupported assertions',()=>{
  const source={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'2030-09-20 A Bring boots',fingerprint:'synthetic'};
  assert.equal(extractionFromAi(JSON.stringify({version:1,events:[event('2030-09-20')]}),source,new Date('2026-09-08T00:00:00Z')).events.length,1);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[event('2020-09-20')]}),{...source,text:'2020-09-20 A Bring boots'},new Date('2026-09-08T00:00:00Z')));
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...event('2030-09-20'),actions:['Bring invented item']}]}),source,new Date('2026-09-08T00:00:00Z')));
});
