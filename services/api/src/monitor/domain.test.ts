import assert from 'node:assert/strict';
import test from 'node:test';
import { answerFromAi, extractionFromAi } from './service.ts';
import { monitorEventKey, orderedMonitorEvents } from './event-identity.ts';

const event=(date:string,description='Trip day')=>({date,time:null,type:'trip',description,actions:['Bring boots'],who:['A'],evidence:{quote:`Trip day ${date} A Bring boots`,sourceUrl:'https://example.com/plan'},confidence:0.9,uncertainty:null});

test('event identity keeps repeated dates distinct and survives date or description corrections',()=>{
  const repeated=orderedMonitorEvents([event('2030-09-20'),event('2030-09-27')]);
  assert.notEqual(monitorEventKey('task',repeated[0]!.eventKeyPart),monitorEventKey('task',repeated[1]!.eventKeyPart));
  const original=orderedMonitorEvents([event('2030-09-20')])[0]!;const corrected=orderedMonitorEvents([event('2030-09-21','Corrected trip day')])[0]!;
  assert.equal(monitorEventKey('task',original.eventKeyPart),monitorEventKey('task',corrected.eventKeyPart));
});

test('validated extraction rejects past and unsupported assertions',()=>{
  const source={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'Trip day 2030-09-20 A Bring boots',fingerprint:'synthetic'};
  assert.equal(extractionFromAi(JSON.stringify({version:1,events:[event('2030-09-20')]}),source,new Date('2026-09-08T00:00:00Z')).events.length,1);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[event('2020-09-20')]}),{...source,text:'Trip day 2020-09-20 A Bring boots'},new Date('2026-09-08T00:00:00Z')));
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...event('2030-09-20'),actions:['Bring invented item']}]}),source,new Date('2026-09-08T00:00:00Z')));
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...event('2030-09-20'),description:'Fabricated school closure',evidence:{quote:'2030-09-20',sourceUrl:source.finalUrl}}]}),source,new Date('2026-09-08T00:00:00Z')));
  const negated={...event('2030-09-20'),type:'school',description:'School is open',actions:[],who:[],evidence:{quote:'School is not open 2030-09-20',sourceUrl:source.finalUrl}};assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[negated]}),{...source,text:negated.evidence.quote},new Date('2026-09-08T00:00:00Z')));
});

test('answer validation rejects fluent claims unsupported by exact evidence',()=>{
  const source={finalUrl:'https://example.com/news',contentType:'text/html' as const,text:'Verified source headline\nOther text',fingerprint:'synthetic'};
  const valid={version:1,answer:'Verified source headline',evidence:{quote:'Verified source headline',sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(valid),source).answer,'Verified source headline');
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,answer:'Invented breaking headline'}),source));
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,evidence:{...valid.evidence,quote:'Other text'}}),source));
});
