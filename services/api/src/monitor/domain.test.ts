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

test('opened document title, headings and displayed link labels are valid exact evidence',()=>{
  const source={
    finalUrl:'https://example.com/opened-story',contentType:'text/html' as const,text:'Unrelated compact body excerpt',fingerprint:'synthetic',
    title:'Exact opened article title',headings:['Exact section heading','Trip day 2030-09-20 A Bring boots'],
    links:[{url:'https://example.com/related',label:'Exact displayed related headline'}]
  };
  for(const value of [source.title,source.headings[0]!,source.links[0]!.label]){
    const answer={version:1,answer:value,evidence:{quote:value,sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
    assert.equal(answerFromAi(JSON.stringify(answer),source).answer,value);
  }
  const headingEvent={...event('2030-09-20'),evidence:{...event('2030-09-20').evidence,sourceUrl:source.finalUrl}};
  const extracted=extractionFromAi(JSON.stringify({version:1,events:[headingEvent]}),source,new Date('2026-09-08T00:00:00Z'));
  assert.equal(extracted.events[0]!.evidence.sourceUrl,source.finalUrl);
  const invented={version:1,answer:'Invented article title',evidence:{quote:'Invented article title',sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
  assert.throws(()=>answerFromAi(JSON.stringify(invented),source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('displayed link labels cite the opened page and unopened child URLs remain invalid',()=>{
  const root={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'Displayed editorial headline',fingerprint:'synthetic',links:[{url:'https://example.com/story',label:'Displayed editorial headline'}]};
  const valid={version:1,answer:'Displayed editorial headline',evidence:{quote:'Displayed editorial headline',sourceUrl:root.finalUrl},confidence:0.9,uncertainty:null};assert.equal(answerFromAi(JSON.stringify(valid),root).answer,'Displayed editorial headline');
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,evidence:{...valid.evidence,sourceUrl:'https://example.com/story'}}),root),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('evidence URLs accept only safe canonical equivalence and are rewritten to exact final URLs',()=>{
  const root={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'Canonical headline\nTrip day 2030-09-20 A Bring boots',fingerprint:'synthetic'};
  const answer={version:1,answer:'Canonical headline',evidence:{quote:'Canonical headline',sourceUrl:'https://example.com'},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(answer),root).evidence.sourceUrl,root.finalUrl);
  assert.equal(answerFromAi(JSON.stringify({...answer,evidence:{...answer.evidence,sourceUrl:'https://example.com:443/#section'}}),root).evidence.sourceUrl,root.finalUrl);
  const canonicalEvent={...event('2030-09-20'),evidence:{...event('2030-09-20').evidence,sourceUrl:'https://example.com'}};const extracted=extractionFromAi(JSON.stringify({version:1,events:[canonicalEvent]}),root,new Date('2026-09-08T00:00:00Z'));assert.equal(extracted.events[0]!.evidence.sourceUrl,root.finalUrl);
  for(const sourceUrl of ['https://example.com/other','https://example.com/?day=1','https://other.example/','http://127.0.0.1/','https://example.com/?api%5Fkey=hidden']){
    assert.throws(()=>answerFromAi(JSON.stringify({...answer,evidence:{...answer.evidence,sourceUrl}}),root),(error:any)=>error.code==='AI_RESPONSE_INVALID',sourceUrl);
  }
});

test('monitor answer parsing recovers the final strict object from bounded model noise',()=>{
  const source={finalUrl:'https://example.com/news',contentType:'text/html' as const,text:'First valid headline\nFinal valid headline',fingerprint:'synthetic'};
  const answer=(value:string)=>({version:1,answer:value,evidence:{quote:value,sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null});
  assert.equal(answerFromAi(JSON.stringify(answer('First valid headline')),source).answer,'First valid headline');
  assert.equal(answerFromAi(`\`\`\`json\n${JSON.stringify(answer('First valid headline'))}\n\`\`\``,source).answer,'First valid headline');
  const noisy=`abandoned {"version":1,"answer": "broken" </think> analysis with {escaped:"brace } in noise"}\n${JSON.stringify(answer('Final valid headline'))}`;
  assert.equal(answerFromAi(noisy,source).answer,'Final valid headline');
  const nested=`reasoning {"quote":"nested object is not an answer"}\n${JSON.stringify(answer('Final valid headline'))}`;
  assert.equal(answerFromAi(nested,source).answer,'Final valid headline');
  const multiple=`${JSON.stringify(answer('First valid headline'))}\nnoise\n${JSON.stringify(answer('Final valid headline'))}`;
  assert.equal(answerFromAi(multiple,source).answer,'Final valid headline');
  assert.throws(()=>answerFromAi('reasoning </think> {"answer":"unfinished" trailing noise',source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});
