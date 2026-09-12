import assert from 'node:assert/strict';
import test from 'node:test';
import { answerFromAi, extractionFromAi, interpretationFromAi, monitorSourcePlan, monitorTaskLifecycle } from './service.ts';
import { monitorEventKey, orderedMonitorEvents } from './event-identity.ts';

const event=(date:string,description='Trip day')=>({date,time:null,type:'trip',description,actions:['Bring boots'],who:['A'],evidence:{quote:`Trip day ${date} A Bring boots`,sourceUrl:'https://example.com/plan'},confidence:0.9,uncertainty:null});
const rule={version:1 as const,resultKind:'answer' as const,summary:'Read the current headline.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60};

test('weather intent uses the domain tool without inventing or scraping a web source',()=>{
  assert.deepEqual(monitorSourcePlan('Sjekk været i Birkeland i morgen'),{sourceUrl:null,tools:['weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Sjekk været på Birkeland via yr.no'),{sourceUrl:null,tools:['weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Sammenlign example.com med været på Birkeland via yr.no'),{sourceUrl:'https://example.com/',tools:['web.open','weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Sammenlign planen på example.com med været i Birkeland'),{sourceUrl:'https://example.com/',tools:['web.open','weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Hvor kaldt blir det i morgen tidlig?'),{sourceUrl:null,tools:['weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Gi meg beskjed hvis det blir regn i morgen'),{sourceUrl:null,tools:['weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Varsle meg dersom temperaturen går under null'),{sourceUrl:null,tools:['weather.forecast']});
  assert.deepEqual(monitorSourcePlan('Sjekk været i Birkeland 20. september 2030'),{sourceUrl:null,tools:['weather.forecast']});
  assert.throws(()=>monitorSourcePlan('Følg med på noe uten noen kilde'),(error:any)=>error.code==='MONITOR_SOURCE_REQUIRED');
});

test('monitor lifecycle always exposes a recovery action and validates the compiled rule',()=>{
  const base={state:'draft',interpreted_rule:null,targets_valid:true,lease_active:false,error_code:null,approved_revision:null};
  const incomplete=monitorTaskLifecycle(base);assert.equal(incomplete.status,'incomplete');assert.equal(incomplete.actions.interpret.enabled,true);assert.equal(incomplete.actions.edit.enabled,true);assert.equal(incomplete.actions.delete.enabled,true);assert.equal(incomplete.actions.test.reason,'setup_required');assert.equal(incomplete.actions.approve.enabled,false);
  const invalidTruthy=monitorTaskLifecycle({...base,interpreted_rule:{}});assert.equal(invalidTruthy.status,'incomplete');assert.equal(invalidTruthy.setupComplete,false);
  const failed=monitorTaskLifecycle({...base,error_code:'AI_DISABLED'});assert.equal(failed.status,'setup_failed');assert.equal(failed.actions.interpret.enabled,true);assert.equal(failed.actions.delete.enabled,true);assert.equal(failed.actions.test.reason,'setup_failed');
  const ready=monitorTaskLifecycle({...base,interpreted_rule:rule});assert.equal(ready.status,'ready_for_approval');assert.equal(ready.actions.test.enabled,true);assert.equal(ready.actions.approve.enabled,true);assert.equal(ready.actions.smarter.enabled,true);
  const unauthorized=monitorTaskLifecycle({...base,interpreted_rule:rule},false);assert.equal(unauthorized.actions.test.enabled,true);assert.equal(unauthorized.actions.approve.reason,'permission_denied');
  const active=monitorTaskLifecycle({...base,state:'active',interpreted_rule:rule,approved_revision:2});assert.equal(active.status,'active');assert.equal(active.actions.run.enabled,true);assert.equal(active.actions.pause.enabled,true);assert.equal(active.actions.delete.enabled,true);
  const paused=monitorTaskLifecycle({...base,state:'paused',interpreted_rule:rule,approved_revision:2});assert.equal(paused.status,'paused');assert.equal(paused.actions.resume.enabled,true);assert.equal(paused.actions.test.enabled,true);
  const running=monitorTaskLifecycle({...base,interpreted_rule:rule,lease_active:true});assert.equal(running.status,'running');assert.equal(running.actions.refresh.enabled,true);for(const [action,value] of Object.entries(running.actions))if(action!=='refresh'){assert.equal(value.enabled,false,action);assert.equal(value.reason,'running',action);}
  for(const lifecycle of [incomplete,invalidTruthy,failed,ready,unauthorized,active,paused,running])assert.ok(Object.values(lifecycle.actions).some((action)=>action.enabled));
});

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
  const splitDate={...event('2030-09-20'),evidence:{quote:'Trip day A Bring boots',sourceUrl:source.finalUrl}};assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[splitDate]}),source,new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('answer validation rejects fluent claims unsupported by exact evidence',()=>{
  const source={finalUrl:'https://example.com/news',contentType:'text/html' as const,text:'Verified source headline\nOther text',fingerprint:'synthetic'};
  const valid={version:1,answer:'Verified source headline',evidence:{quote:'Verified source headline',sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(valid),source).answer,'Verified source headline');
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,answer:'Invented breaking headline'}),source));
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,evidence:{...valid.evidence,quote:'Other text'}}),source));
});

test('server anchors omitted evidence URLs only to an opened document supporting the exact claim',()=>{
  const first={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'First editorial headline\nOther text',fingerprint:'root'};
  const second={finalUrl:'https://example.com/story',contentType:'text/html' as const,text:'Story detail',fingerprint:'story'};
  const withoutInternalId={version:1,answer:'First editorial headline',evidence:{quote:'First editorial headline'},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(withoutInternalId),[first,second]).evidence.sourceUrl,first.finalUrl);
  const fabricated={...withoutInternalId,evidence:{...withoutInternalId.evidence,sourceUrl:'https://example.com/not-opened'}};
  assert.throws(()=>answerFromAi(JSON.stringify(fabricated),[first,second]),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  const irrelevant={...withoutInternalId,answer:'Invented headline',evidence:{quote:'Invented headline'}};
  assert.throws(()=>answerFromAi(JSON.stringify(irrelevant),[first,second]),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('missing model confidence metadata is conservatively normalized without weakening strict values',()=>{
  const source={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'Verified headline\nTrip day 2030-09-20 A Bring boots',fingerprint:'source'};
  const answer=answerFromAi(JSON.stringify({version:1,answer:'Verified headline',evidence:{quote:'Verified headline'}}),source);assert.equal(answer.confidence,0);assert.equal(answer.uncertainty,null);assert.equal(answer.evidence.sourceUrl,source.finalUrl);
  const missingEvent={date:'2030-09-20',time:null,type:'trip',description:'Trip day',actions:['Bring boots'],who:['A'],evidence:{quote:'Trip day 2030-09-20 A Bring boots'}};
  const extracted=extractionFromAi(JSON.stringify({version:1,events:[missingEvent]}),source,new Date('2026-09-08T00:00:00Z'));assert.equal(extracted.events[0]!.confidence,0);assert.equal(extracted.events[0]!.uncertainty,null);assert.equal(extracted.events[0]!.evidence.sourceUrl,source.finalUrl);
  for(const confidence of [-0.1,1.1,'high'])assert.throws(()=>answerFromAi(JSON.stringify({version:1,answer:'Verified headline',evidence:{quote:'Verified headline'},confidence,uncertainty:null}),source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  for(const uncertainty of [42,{value:'unknown'}])assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...missingEvent,confidence:0.5,uncertainty}]}),source,new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,answer:'Verified headline',evidence:{quote:'Verified headline'},unexpected:true}),source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('server anchors event evidence without weakening date and claim validation',()=>{
  const source={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'Trip day 2030-09-20 A Bring boots',fingerprint:'plan'};
  const withoutUrl={...event('2030-09-20'),evidence:{quote:'Trip day 2030-09-20 A Bring boots'}};
  const result=extractionFromAi(JSON.stringify({version:1,events:[withoutUrl]}),source,new Date('2026-09-08T00:00:00Z'));
  assert.equal(result.events[0]!.evidence.sourceUrl,source.finalUrl);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...withoutUrl,description:'Invented closure'}]}),source,new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('a verified conditional rule can return no relevant events without creating unsupported evidence',()=>{
  const source={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=60&lon=10',contentType:'application/vnd.met.no.locationforecast+json' as const,text:'Forecast: no precipitation',fingerprint:'weather'};
  assert.deepEqual(extractionFromAi('{"version":1,"events":[]}',source,new Date('2026-09-12T00:00:00Z')).events,[]);
});

test('composite events are anchored to dated web and weather evidence',()=>{
  const web={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'Trip day 2030-09-20 A',fingerprint:'web',evidenceKind:'web' as const};
  const weather={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=60&lon=10',contentType:'application/vnd.met.no.locationforecast+json' as const,text:'Forecast 2030-09-20T08:00:00Z: symbol rain',fingerprint:'weather',evidenceKind:'weather' as const,evidenceDates:['2030-09-20']};
  const combined={date:'2030-09-20',time:null,type:'Trip day',description:'Trip day rain',actions:[],who:['A'],evidence:{quote:web.text,sourceUrl:web.finalUrl,claims:['Trip day','A'],sources:[{quote:weather.text,claims:['rain']}]},confidence:0.9,uncertainty:null};
  const result=extractionFromAi(JSON.stringify({version:1,events:[combined]}),[web,weather],new Date('2026-09-08T00:00:00Z'));
  assert.equal(result.events[0]!.evidence.sourceUrl,web.finalUrl);assert.equal(result.events[0]!.evidence.sources?.[0]?.sourceUrl,weather.finalUrl);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...combined,evidence:{...combined.evidence,sources:[{quote:weather.text,sourceUrl:'https://api.met.no/unopened',claims:['rain']}]}}]}),[web,weather],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...combined,evidence:{...combined.evidence,sources:[{quote:weather.text,claims:['snow']}]}}]}),[web,weather],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  const {claims:_claims,...unmappedPrimary}=combined.evidence;assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[{...combined,evidence:unmappedPrimary}]}),[web,weather],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,events:[combined]}),[web,{...weather,evidenceDates:['2030-09-21']}],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
});

test('interpretation validation exposes only sanitized schema and source-refusal stages',()=>{
  assert.throws(()=>interpretationFromAi('{"summary":"missing fields"}'),(error:any)=>error.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID'&&!error.details);
  assert.throws(()=>interpretationFromAi(JSON.stringify({...rule,location:{query:'Testvik',latitude:60,longitude:10}})),(error:any)=>error.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID');
  assert.throws(()=>interpretationFromAi(JSON.stringify({...rule,summary:'I cannot access or browse the website.'})),(error:any)=>error.code==='MONITOR_INTERPRETATION_SOURCE_REFUSAL'&&!error.details);
  assert.equal(interpretationFromAi(JSON.stringify(rule)).resultKind,'answer');
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

test('only server-recorded successful request aliases authorize redirected evidence URLs',()=>{
  const redirected={finalUrl:'https://www.example.com/',contentType:'text/html' as const,text:'Redirected headline',fingerprint:'redirect',evidenceUrlAliases:['https://example.com/']};
  const answer={version:1,answer:'Redirected headline',evidence:{quote:'Redirected headline',sourceUrl:'https://example.com/'},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(answer),redirected).evidence.sourceUrl,redirected.finalUrl);
  assert.throws(()=>answerFromAi(JSON.stringify({...answer,evidence:{...answer.evidence,sourceUrl:'https://example.com/unopened'}}),redirected),(error:any)=>error.code==='AI_RESPONSE_INVALID');
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
