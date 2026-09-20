import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@samvev/core';
import { answerFromAi, compositeDecisionFromAi, conditionalWeatherExtraction, extractionFromAi, interpretationFromAi, monitorScheduleFromInstruction, monitorSetupSummary, monitorSourcePlan, monitorTaskLifecycle, weatherConditionFromInstruction, weatherScopeFromInstruction } from './service.ts';
import { monitorEventKey, orderedMonitorEvents } from './event-identity.ts';
import { sanitizedMonitorErrorDetails } from './service.ts';

const event=(date:string,description='Trip day')=>({date,time:null,type:'trip',description,actions:['Bring boots'],who:['A'],evidence:{quote:`Trip day ${date} A Bring boots`,sourceUrl:'https://example.com/plan'},confidence:0.9,uncertainty:null});
const rule={version:1 as const,resultKind:'answer' as const,summary:'Read the current headline.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60};

test('validation diagnostics expose only bounded reason tokens and safe ambiguity fields',()=>{
  const safe=sanitizedMonitorErrorDetails(new DomainError('AI_RESPONSE_INVALID',502,{validationStage:'evidence_anchor',validationReason:'claim',prompt:'secret',model:'private',provenance:[{raw:'not public'}]}));
  assert.deepEqual(safe,{validationStage:'evidence_anchor',validationReason:'claim'});
  assert.deepEqual(sanitizedMonitorErrorDetails(new DomainError('AI_RESPONSE_INVALID',502,{validationStage:'made_up',validationReason:'raw secret'})),{validationStage:'provider_response',validationReason:'invalid_response'});
  assert.equal(sanitizedMonitorErrorDetails(new Error('raw provider detail')),null);
});

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

test('weather scope is pinned to the reviewed instruction instead of model-selected text',()=>{
  assert.deepEqual(weatherScopeFromInstruction('Sjekk været på Birkeland i morgen'),{location:'Birkeland',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Sjekk været på Birkeland i Birkenes i morgen via yr'),{location:'Birkeland, Birkenes',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Sted for værvarselet: Birkeland, Birkenes, Agder.\nSjekk været på Birkeland i morgen'),{location:'Birkeland, Birkenes, Agder',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Forecast location: Birkeland, Birkenes, Agder.\nCheck the weather in Birkeland tomorrow'),{location:'Birkeland, Birkenes, Agder',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Sjekk været i morgen i Birkeland'),{location:'Birkeland',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Check the weather tomorrow in Oslo'),{location:'Oslo',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Varsle ved regn i morgen på Tromsø.'),{location:'Tromsø',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Hvor kaldt blir det i Oslo i morgen tidlig?'),{location:'Oslo',period:'tomorrow',timeWindow:'morning'});
  assert.deepEqual(weatherScopeFromInstruction('Check the weather in Tromsø today'),{location:'Tromsø',period:'today',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Sjekk ukeplanen og været i Oslo i morgen.',true),{location:'Oslo',period:'tomorrow',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Check the plan and weather in Oslo today.',true),{location:'Oslo',period:'today',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction('Sjekk ukeplanen og været i Oslo. Aktiviteten er 2030-09-20.',true),{location:'Oslo',period:'date',timeWindow:'all',dynamicDateFromEvidence:true});
  assert.deepEqual(weatherScopeFromInstruction('Sjekk været i Bergen 20. september 2030'),{location:'Bergen',period:'date',date:'2030-09-20',timeWindow:'all'});
  assert.equal(weatherScopeFromInstruction('Sjekk været i morgen tidlig'),undefined);
  const recurring='Sjekk været i Lillesand og gi beskjed hver dag 08:00 dersom det er meldt regn eller vind over 10m/s i løpet av dagen';
  assert.deepEqual(weatherScopeFromInstruction(recurring),{location:'Lillesand',period:'today',timeWindow:'all'});
  assert.deepEqual(weatherScopeFromInstruction(recurring.replace('Lillesand','Lillesand, Agder')),{location:'Lillesand, Agder',period:'today',timeWindow:'all'});
  assert.deepEqual(monitorScheduleFromInstruction(recurring),{kind:'daily',localTime:'08:00',timezone:'Europe/Oslo'});
  assert.deepEqual(weatherConditionFromInstruction(recurring),{operator:'or',conditions:[{kind:'rain'},{kind:'max_wind_speed',comparison:'gt',thresholdMps:10}]});
});

test('server evaluates rain OR strict maximum forecast mean-wind thresholds',()=>{
  const condition={operator:'or' as const,conditions:[{kind:'rain' as const},{kind:'max_wind_speed' as const,comparison:'gt' as const,thresholdMps:10}]};const source=(precipitation:number,wind:number,conditions:string)=>({finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',publicEvidenceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',contentType:'application/vnd.met.no.locationforecast+json' as const,evidenceKind:'weather' as const,text:`Forecast summary 2030-09-20: location Synthetic place, Norge; minimum temperature 5 C; maximum temperature 9 C; total precipitation ${precipitation} mm; maximum wind ${wind} m/s; conditions ${conditions}\nForecast 2030-09-20T08:00:00Z: temperature 5 C; precipitation ${precipitation} mm; wind ${wind} m/s; symbol ${conditions}`,fingerprint:`${precipitation}-${wind}-${conditions}`,evidenceDates:['2030-09-20'],evidenceComplete:true});
  assert.equal(conditionalWeatherExtraction(source(0,10,'fair_day'),condition).events.length,0,'exactly 10.0 is not greater than 10');
  assert.equal(conditionalWeatherExtraction(source(1,10,'rain'),condition).events.length,1,'rain alone triggers');
  assert.equal(conditionalWeatherExtraction(source(0,10.1,'fair_day'),condition).events.length,1,'wind above threshold alone triggers');
  const both=conditionalWeatherExtraction(source(1,10.1,'rain'),condition);assert.equal(both.events.length,1);assert.match(both.events[0]!.description,/regn og vind/);assert.equal(both.events[0]!.evidence.sourceUrl,'https://api.met.no/weatherapi/locationforecast/2.0/documentation');
  assert.equal(conditionalWeatherExtraction(source(2,5,'snow'),condition).events.length,0,'snow precipitation is not rain');
  const rainOnly={operator:'or' as const,conditions:[{kind:'rain' as const}]};const rainWithoutWind={...source(1,0,'rain'),text:source(1,0,'rain').text.replace('maximum wind 0 m/s','maximum wind unknown m/s').replace('wind 0 m/s','wind unknown m/s')};assert.equal(conditionalWeatherExtraction(rainWithoutWind,rainOnly).events.length,1,'rain-only rules do not require an unrelated wind value');
  const splitEvidence={...source(2,5,'snow'),text:`Forecast summary 2030-09-20: location Synthetic place, Norge; minimum temperature 5 C; maximum temperature 9 C; total precipitation 2 mm; maximum wind 5 m/s; conditions snow, rain\nForecast 2030-09-20T08:00:00Z: temperature 5 C; precipitation 2 mm; wind 5 m/s; symbol snow\nForecast 2030-09-20T09:00:00Z: temperature 6 C; precipitation 0 mm; wind 5 m/s; symbol rain`};
  assert.equal(conditionalWeatherExtraction(splitEvidence,condition).events.length,0,'rain requires precipitation and a rain symbol in the same forecast interval');
  const repeated=Array.from({length:3},()=>conditionalWeatherExtraction(source(0,10.1,'fair_day'),condition));assert.ok(repeated.every((item)=>JSON.stringify(item)===JSON.stringify(repeated[0])),'three executions are deterministic and execution-local');
});

test('verified weather setup summaries are deterministic in the requested locale',()=>{
  assert.equal(monitorSetupSummary('nb',['weather.forecast'],'Synthetic place'),'Sjekker været for Synthetic place.');
  assert.equal(monitorSetupSummary('en',['weather.forecast'],'Synthetic place'),'Checks the weather for Synthetic place.');
  assert.equal(monitorSetupSummary('nb',['web.open','weather.forecast'],'Synthetic place'),'Sammenstiller kilden og været for Synthetic place.');
  assert.equal(monitorSetupSummary('en',['web.open','weather.forecast'],'Synthetic place'),'Combines the source and weather for Synthetic place.');
});

test('setup normalizes a single model classification label into the strict stored list shape',()=>{
  const value=interpretationFromAi(JSON.stringify({...rule,eventTypes:'weather',keywords:'rain',people:'Synthetic member'}));assert.deepEqual(value.eventTypes,['weather']);assert.deepEqual(value.keywords,['rain']);assert.deepEqual(value.people,['Synthetic member']);
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
  assert.equal(extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[event('2030-09-20')]}),source,new Date('2026-09-08T00:00:00Z')).events.length,1);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[event('2020-09-20')]}),{...source,text:'Trip day 2020-09-20 A Bring boots'},new Date('2026-09-08T00:00:00Z')));
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...event('2030-09-20'),actions:['Bring invented item']}]}),source,new Date('2026-09-08T00:00:00Z')));
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...event('2030-09-20'),description:'Fabricated school closure',evidence:{quote:'2030-09-20',sourceUrl:source.finalUrl}}]}),source,new Date('2026-09-08T00:00:00Z')));
  const negated={...event('2030-09-20'),type:'school',description:'School is open',actions:[],who:[],evidence:{quote:'School is not open 2030-09-20',sourceUrl:source.finalUrl}};assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[negated]}),{...source,text:negated.evidence.quote},new Date('2026-09-08T00:00:00Z')));
  const splitDate={...event('2030-09-20'),evidence:{quote:'Trip day A Bring boots',sourceUrl:source.finalUrl}};assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[splitDate]}),source,new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('answer validation rejects fluent claims unsupported by exact evidence',()=>{
  const source={finalUrl:'https://example.com/news',contentType:'text/html' as const,text:'Verified source headline\nOther text',fingerprint:'synthetic'};
  const valid={version:1,outputLocale:'nb',answer:'Verified source headline',evidence:{quote:'Verified source headline',sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(valid),source).answer,'Verified source headline');
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,answer:'Invented breaking headline'}),source));
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,evidence:{...valid.evidence,quote:'Other text'}}),source));
});

test('general answers stay extractive even when a fabricated presentation claims the requested locale',()=>{
  const nbSource={finalUrl:'https://example.com/nb',contentType:'text/html' as const,text:'Biblioteket stenger klokken 18.',fingerprint:'nb'};const nbClaim='Biblioteket stenger klokken 18.';
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,outputLocale:'en',answer:'The library closes at 6 PM.',evidence:{quote:nbClaim,claims:[nbClaim]},confidence:0.9,uncertainty:'The source does not specify exceptions.'}),nbSource,{locale:'en'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  const enExtractive=answerFromAi(JSON.stringify({version:1,outputLocale:'en',answer:nbClaim,evidence:{quote:nbClaim,claims:[nbClaim]},confidence:0.9,uncertainty:'Invented caveat'}),nbSource,{locale:'en'});assert.equal(enExtractive.answer,nbClaim);assert.equal(enExtractive.uncertainty,null);assert.equal(enExtractive.evidence.sourceUrl,nbSource.finalUrl);
  const enSource={finalUrl:'https://example.com/en',contentType:'text/html' as const,text:'The library closes at 6 PM.',fingerprint:'en'};const enClaim='The library closes at 6 PM.';
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,outputLocale:'nb',answer:'Biblioteket er stengt hele dagen.',evidence:{quote:enClaim,claims:[enClaim]},confidence:0.9,uncertainty:null}),enSource,{locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  const nbExtractive=answerFromAi(JSON.stringify({version:1,outputLocale:'nb',answer:enClaim,evidence:{quote:enClaim,claims:[enClaim]},confidence:0.9,uncertainty:null}),enSource,{locale:'nb'});assert.equal(nbExtractive.answer,enClaim);assert.equal(nbExtractive.evidence.sourceUrl,enSource.finalUrl);
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,outputLocale:'en',answer:'The library is closed all day.',evidence:{quote:enClaim,claims:[enClaim]},confidence:0.9,uncertainty:null}),enSource,{locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,outputLocale:'nb',answer:'The library is closed all day.',evidence:{quote:enClaim,claims:['closed all day']},confidence:0.9,uncertainty:null}),enSource,{locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,answer:'Biblioteket stenger klokken 18.',evidence:{quote:enClaim,claims:[enClaim]},confidence:0.9,uncertainty:null}),enSource,{locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('a single structured weather source falls back to its server-generated verified summary',()=>{
  const summary='Forecast summary 2030-09-20: location Synthetic place, Test region, Norge; minimum temperature 5 C; maximum temperature 9 C; total precipitation 3 mm; maximum wind 4 m/s; conditions rain';
  const nbPresentation='Vær for Synthetic place, Test region, Norge 20. september 2030: 5–9 °C, 3 mm nedbør, vind opptil 4 m/s.';const enPresentation='Weather for Synthetic place, Test region, Norge on 20 September 2030: 5–9 °C, 3 mm precipitation, wind up to 4 m/s.';
  const source={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',publicEvidenceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',contentType:'application/vnd.met.no.locationforecast+json' as const,evidenceKind:'weather' as const,text:`${summary}\nNorwegian presentation: ${nbPresentation}\nEnglish presentation: ${enPresentation}\nForecast 2030-09-20T08:00:00Z: temperature 5 C; precipitation 3 mm; wind 4 m/s; symbol rain`,fingerprint:'weather'};
  const validNb={version:1,outputLocale:'nb',answer:nbPresentation,evidence:{quote:nbPresentation},confidence:0.9,uncertainty:null};assert.equal(answerFromAi(JSON.stringify(validNb),source).answer,nbPresentation);
  const validEn={version:1,outputLocale:'en',answer:enPresentation,evidence:{quote:enPresentation},confidence:0.9,uncertainty:null};assert.equal(answerFromAi(JSON.stringify(validEn),source,{locale:'en'}).answer,enPresentation);
  assert.equal(answerFromAi(JSON.stringify({...validNb,answer:enPresentation,evidence:{quote:enPresentation}}),source,{locale:'nb'}).answer,nbPresentation,'an English sentence copied from bilingual weather evidence is normalized to NB');
  assert.equal(answerFromAi(JSON.stringify({...validEn,answer:nbPresentation,evidence:{quote:nbPresentation}}),source,{locale:'en'}).answer,enPresentation,'an NB sentence copied from bilingual weather evidence is normalized to English');
  assert.throws(()=>answerFromAi(JSON.stringify({...validEn,answer:nbPresentation,evidence:{quote:nbPresentation}}),source,{locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID','single-source weather still rejects a wrong declared locale');
  const model={version:1,outputLocale:'nb',answer:'Det blir regn og kjølig.',evidence:{quote:'En naturlig parafrase modellen laget.',sourceUrl:source.finalUrl},confidence:0.7,uncertainty:'Oppsummert'};const result=answerFromAi(JSON.stringify(model),source);
  assert.equal(result.answer,nbPresentation);assert.equal(result.evidence.quote,summary);assert.equal(result.evidence.sourceUrl,source.finalUrl);assert.deepEqual(result.confidence,1);
  assert.equal(answerFromAi('formatteringsstøy fra modellen',source,{locale:'en'}).answer,enPresentation);
  assert.equal(answerFromAi(JSON.stringify({...model,answer:summary,evidence:{quote:summary}}),source).answer,nbPresentation,'raw machine evidence is normalized before ordinary presentation');
  const second={...source,finalUrl:'https://example.com/other',publicEvidenceUrl:'https://example.com/other'};assert.throws(()=>answerFromAi(JSON.stringify(model),[source,second]),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('conditional multi-source output is never inferred from malformed model output',()=>{
  const web={finalUrl:'https://example.com/plan',contentType:'text/html' as const,evidenceKind:'web' as const,text:'2030-09-20: Outdoor activity.',headings:['Outdoor activity'],fingerprint:'web',evidenceDates:['2030-09-20']};const summary='Forecast summary 2030-09-20: location Synthetic place, Norge; minimum temperature 5 C; maximum temperature 9 C; total precipitation 3 mm; maximum wind 4 m/s; conditions rain';const weather={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',publicEvidenceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',contentType:'application/vnd.met.no.locationforecast+json' as const,evidenceKind:'weather' as const,text:summary,fingerprint:'weather',evidenceDates:['2030-09-20']};const now=new Date('2030-09-19T08:00:00Z');
  assert.throws(()=>extractionFromAi('not json',[web,weather],now,{instruction:'Gi bare beskjed dersom temperaturen er under 6 grader.',locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  assert.throws(()=>extractionFromAi('not json',[web,{...weather,text:'Forecast data was truncated',evidenceDates:[]}],now,{instruction:'Gi bare beskjed dersom temperaturen er under 4 grader.'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  assert.throws(()=>extractionFromAi('not json',[web,weather],now,{instruction:'Gi bare beskjed dersom forholdene er spesielle.'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('generic special-weather conditions use server-anchored facts and localized presentation',()=>{
  const web={finalUrl:'https://example.com/plan',contentType:'text/html' as const,evidenceKind:'web' as const,text:'2030-09-20: Outdoor activity.',headings:['Outdoor activity'],fingerprint:'web',evidenceDates:['2030-09-20'],evidenceComplete:true};
  const rainySummary='Forecast summary 2030-09-20: location Synthetic place, Norge; minimum temperature 5 C; maximum temperature 9 C; total precipitation 3 mm; maximum wind 4 m/s; conditions rain';
  const weather={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',publicEvidenceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',contentType:'application/vnd.met.no.locationforecast+json' as const,evidenceKind:'weather' as const,text:rainySummary,fingerprint:'weather',evidenceDates:['2030-09-20'],evidenceComplete:true};const now=new Date('2030-09-19T08:00:00Z');
  const modelEvent={date:'2030-09-20',time:null,type:'Uteaktivitet i regn',description:'Det er planlagt uteaktivitet, og det er meldt regn.',actions:['Ta med regntøy.'],who:[],evidence:{quote:web.text,claims:['Outdoor activity'],sources:[{quote:rainySummary,claims:['total precipitation 3 mm']}]},confidence:0.9,uncertainty:'Tidspunktet er ikke oppgitt.'};const output=JSON.stringify({version:1,outputLocale:'nb',events:[modelEvent]});
  const nb=extractionFromAi(output,[web,weather],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'});assert.equal(nb.events.length,1);assert.equal(nb.events[0]!.type,'Plan og vær');assert.equal(nb.events[0]!.description,'Aktivitet fra planen: «Outdoor activity». Vær for Synthetic place, Norge 20. september 2030: 5–9 °C, 3 mm nedbør, vind opptil 4 m/s.');assert.deepEqual(nb.events[0]!.actions,['Sjekk klær og utstyr som passer til aktiviteten og været.']);assert.equal(nb.events[0]!.uncertainty,'Samvev er usikker på deler av tolkningen. Kontroller kildene.');assert.equal(nb.events[0]!.uncertainty?.includes(modelEvent.uncertainty!),false);assert.equal(nb.events[0]!.description.includes(modelEvent.description),false);assert.equal(nb.events[0]!.evidence.quote,web.text);assert.equal(nb.events[0]!.evidence.sources?.[0]?.quote,rainySummary);
  const wrongLocale=JSON.stringify({version:1,outputLocale:'en',events:[modelEvent]});assert.throws(()=>extractionFromAi(wrongLocale,[web,weather],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  const missingLocale=JSON.stringify({version:1,events:[modelEvent]});assert.throws(()=>extractionFromAi(missingLocale,[web,weather],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'}),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  const enEvent={...modelEvent,type:'Outdoor activity in rain',description:'An outdoor activity is planned, and rain is forecast.',actions:['Bring rainwear.'],uncertainty:'Fabricated school closure.'};const enOutput=JSON.stringify({version:1,outputLocale:'en',events:[enEvent]});const en=extractionFromAi(enOutput,[web,weather],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'});assert.equal(en.events[0]!.type,'Schedule and weather');assert.equal(en.events[0]!.description,'Activity from the schedule: “Outdoor activity”. Weather for Synthetic place, Norge on 20 September 2030: 5–9 °C, 3 mm precipitation, wind up to 4 m/s.');assert.deepEqual(en.events[0]!.actions,['Check clothing and equipment appropriate for the activity and weather.']);assert.equal(en.events[0]!.uncertainty,'Samvev is uncertain about parts of the interpretation. Check the sources.');assert.equal(en.events[0]!.uncertainty?.includes('closure'),false);
  const ordinaryWeb={...web,text:'2030-09-20: Ordinary indoor lessons.',headings:['Ordinary indoor lessons'],fingerprint:'ordinary'};const normalSummary='Forecast summary 2030-09-20: location Synthetic place, Norge; minimum temperature 8 C; maximum temperature 14 C; total precipitation 0 mm; maximum wind 3 m/s; conditions fair_day';const fabricatedPresentation={...modelEvent,type:'Skolen er stengt',description:'Skolen er stengt hele dagen.',actions:['Hold barnet hjemme.'],evidence:{quote:ordinaryWeb.text,claims:['Ordinary indoor lessons'],sources:[{quote:normalSummary,claims:['total precipitation 0 mm']}]}};const sanitized=extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[fabricatedPresentation]}),[ordinaryWeb,{...weather,text:normalSummary,fingerprint:'normal'}],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'});assert.equal(sanitized.events[0]!.description.includes('stengt'),false);assert.equal(sanitized.events[0]!.actions.includes('Hold barnet hjemme.'),false);assert.match(sanitized.events[0]!.description,/Ordinary indoor lessons/);
  const root={finalUrl:'https://example.com/',contentType:'text/html' as const,evidenceKind:'web' as const,text:'Weekly plan index',fingerprint:'root',evidenceComplete:true};const linked=extractionFromAi(enOutput,[root,web,weather],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'});assert.equal(linked.events[0]!.evidence.sourceUrl,web.finalUrl,'the exact followed document remains the primary evidence');
  const pdf={...web,finalUrl:'https://example.com/plan.pdf',contentType:'application/pdf' as const,fingerprint:'pdf'};const linkedPdf=extractionFromAi(enOutput,[root,pdf,weather],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'});assert.equal(linkedPdf.events[0]!.evidence.sourceUrl,pdf.finalUrl);
  const normal=extractionFromAi('{"version":1,"outputLocale":"nb","events":[]}',[web,{...weather,text:normalSummary,fingerprint:'normal'}],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'});assert.deepEqual(normal.events,[]);
  assert.deepEqual(extractionFromAi('{"version":1,"outputLocale":"en","events":[]}',[root,web,{...weather,text:normalSummary,fingerprint:'normal'}],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'}).events,[]);
  assert.throws(()=>extractionFromAi('{"version":1,"outputLocale":"en","events":[]}',[{...root,text:'2030-09-20: Index',evidenceDates:['2030-09-20']},{...web,evidenceComplete:false},{...weather,text:normalSummary,fingerprint:'normal'}],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'}),(error:any)=>error.code==='AI_COMPOSITION_INVALID','a complete root cannot hide a truncated followed plan during an all-clear decision');
  assert.throws(()=>extractionFromAi('{"version":1,"outputLocale":"nb","events":[]}',[web,{...weather,text:'Forecast summary 2030-09-20: location Synthetic place; minimum temperature unknown C; maximum temperature unknown C; total precipitation unknown mm; maximum wind unknown m/s; conditions unknown'}],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'}),(error:any)=>error.code==='AI_COMPOSITION_INVALID','truncated evidence cannot become a false all-clear');
  assert.throws(()=>extractionFromAi(output,[{...web,text:'Outdoor activity without a date',evidenceDates:[]},weather],now,{instruction:'Gi meg bare beskjed dersom det er noe spesielt jeg må huske på grunn av været.',locale:'nb'}),(error:any)=>['AI_RESPONSE_INVALID','AI_COMPOSITION_INVALID'].includes(error.code));
  assert.throws(()=>extractionFromAi(output,[web,{...weather,text:'Forecast data was truncated',evidenceDates:[]}],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'}),(error:any)=>['AI_RESPONSE_INVALID','AI_COMPOSITION_INVALID'].includes(error.code));
  const fabricated=JSON.stringify({version:1,outputLocale:'en',events:[{...enEvent,evidence:{...enEvent.evidence,sources:[{quote:rainySummary,claims:['snow 20 cm']}]}}]});assert.throws(()=>extractionFromAi(fabricated,[web,weather],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'}),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  const unseen=JSON.stringify({version:1,outputLocale:'en',events:[{...enEvent,evidence:{...enEvent.evidence,sourceUrl:'https://example.com/unopened'}}]});assert.throws(()=>extractionFromAi(unseen,[root,web,weather],now,{instruction:'Notify me only if there is something special because of the weather.',locale:'en'}),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
});

test('compact composite decisions bind exact excerpts to server-owned provenance',()=>{
  const date='2030-09-20';const activity=`${date}: Outdoor activity.`;const web={finalUrl:'https://example.com/plan',contentType:'text/html' as const,evidenceKind:'web' as const,text:activity,headings:['Outdoor activity'],fingerprint:'web',evidenceDates:[date],evidenceComplete:true};
  const summary=`Forecast summary ${date}: location Synthetic place, Norge; minimum temperature 5 C; maximum temperature 9 C; total precipitation 3 mm; maximum wind 4 m/s; conditions rain`;const weather={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',publicEvidenceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',contentType:'application/vnd.met.no.locationforecast+json' as const,evidenceKind:'weather' as const,text:`${summary}\nForecast ${date}T08:00:00Z: temperature 5 C; precipitation 3 mm; wind 4 m/s; symbol rain`,fingerprint:'weather',evidenceDates:[date],evidenceComplete:true};const now=new Date('2030-09-19T08:00:00Z');
  const output=JSON.stringify({version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:activity,weatherQuote:summary,confidence:0.9,uncertainty:null}]});const result=compositeDecisionFromAi(output,[web,weather],now,'nb');
  assert.equal(result.events[0]!.description,'Aktivitet fra planen: «2030-09-20: Outdoor activity.». Vær for Synthetic place, Norge 20. september 2030: 5–9 °C, 3 mm nedbør, vind opptil 4 m/s.');assert.equal(result.events[0]!.evidence.sourceUrl,web.finalUrl);assert.equal(result.events[0]!.evidence.sources?.[0]?.sourceUrl,weather.finalUrl);assert.deepEqual(result.events[0]!.who,[]);
  const none=compositeDecisionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[]}),[web,weather],now,'nb');assert.deepEqual(none.events,[]);
  const undated={...web,text:'Outdoor activity.',headings:['Outdoor activity'],evidenceDates:[]};const explicitPeriod=compositeDecisionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:'Outdoor activity.',weatherQuote:summary,confidence:0.9,uncertainty:null}]}),[undated,weather],now,'nb',{allowUndatedWebDate:true});assert.equal(explicitPeriod.events.length,1);assert.deepEqual(compositeDecisionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[]}),[undated,weather],now,'nb',{allowUndatedWebDate:true}).events,[]);
  for(const localizedActivity of ['20.09.2030: Outdoor activity.','20/09/2030: Outdoor activity.','20. september 2030: Outdoor activity.','20 September 2030: Outdoor activity.','September 20, 2030: Outdoor activity.']){
    const localizedWeb={...web,text:localizedActivity,evidenceDates:[date]};const localizedOutput=JSON.stringify({version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:localizedActivity,weatherQuote:summary,confidence:0.9,uncertainty:null}]});
    assert.equal(compositeDecisionFromAi(localizedOutput,[localizedWeb,weather],now,'nb').events.length,1);
  }
  for(const conflictingActivity of ['2030-09-21: Outdoor activity.','21.09.2030: Outdoor activity.','21. september 2030: Outdoor activity.','21 September 2030: Outdoor activity.','September 21, 2030: Outdoor activity.']){
    const conflictingWeb={...web,text:conflictingActivity,evidenceDates:['2030-09-21']};const conflictingOutput=JSON.stringify({version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:conflictingActivity,weatherQuote:summary,confidence:0.9,uncertainty:null}]});
    assert.throws(()=>compositeDecisionFromAi(conflictingOutput,[conflictingWeb,weather],now,'nb',{allowUndatedWebDate:true}),(error:any)=>error.code==='AI_COMPOSITION_INVALID'&&error.details?.validationReason==='date');
  }
  assert.throws(()=>compositeDecisionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:'Outdoor activity.',weatherQuote:summary,confidence:0.9,uncertainty:null}]}),[undated,weather],now,'nb'),(error:any)=>error.code==='AI_COMPOSITION_INVALID'&&error.details?.validationReason==='date','dynamic dates still require exact web grounding');
  for(const invalid of [
    {version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:'Fabricated activity',weatherQuote:summary,confidence:0.9,uncertainty:null}]},
    {version:1,outputLocale:'nb',events:[{date,time:null,activityQuote:activity,weatherQuote:'Fabricated forecast',confidence:0.9,uncertainty:null}]}
  ])assert.throws(()=>compositeDecisionFromAi(JSON.stringify(invalid),[web,weather],now,'nb'),(error:any)=>['AI_RESPONSE_INVALID','AI_COMPOSITION_INVALID'].includes(error.code));
});

test('server anchors omitted evidence URLs only to an opened document supporting the exact claim',()=>{
  const first={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'First editorial headline\nOther text',fingerprint:'root'};
  const second={finalUrl:'https://example.com/story',contentType:'text/html' as const,text:'Story detail',fingerprint:'story'};
  const withoutInternalId={version:1,outputLocale:'nb',answer:'First editorial headline',evidence:{quote:'First editorial headline'},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(withoutInternalId),[first,second]).evidence.sourceUrl,first.finalUrl);
  const fabricated={...withoutInternalId,evidence:{...withoutInternalId.evidence,sourceUrl:'https://example.com/not-opened'}};
  assert.throws(()=>answerFromAi(JSON.stringify(fabricated),[first,second]),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  const irrelevant={...withoutInternalId,answer:'Invented headline',evidence:{quote:'Invented headline'}};
  assert.throws(()=>answerFromAi(JSON.stringify(irrelevant),[first,second]),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('missing model confidence metadata is conservatively normalized without weakening strict values',()=>{
  const source={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'Verified headline\nTrip day 2030-09-20 A Bring boots',fingerprint:'source'};
  const answer=answerFromAi(JSON.stringify({version:1,outputLocale:'nb',answer:'Verified headline',evidence:{quote:'Verified headline'}}),source);assert.equal(answer.confidence,0);assert.equal(answer.uncertainty,null);assert.equal(answer.evidence.sourceUrl,source.finalUrl);
  const missingEvent={date:'2030-09-20',time:null,type:'trip',description:'Trip day',actions:['Bring boots'],who:['A'],evidence:{quote:'Trip day 2030-09-20 A Bring boots'}};
  const extracted=extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[missingEvent]}),source,new Date('2026-09-08T00:00:00Z'));assert.equal(extracted.events[0]!.confidence,0);assert.equal(extracted.events[0]!.uncertainty,null);assert.equal(extracted.events[0]!.evidence.sourceUrl,source.finalUrl);
  for(const confidence of [-0.1,1.1,'high'])assert.throws(()=>answerFromAi(JSON.stringify({version:1,outputLocale:'nb',answer:'Verified headline',evidence:{quote:'Verified headline'},confidence,uncertainty:null}),source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  for(const uncertainty of [42,{value:'unknown'}])assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...missingEvent,confidence:0.5,uncertainty}]}),source,new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_RESPONSE_INVALID');
  assert.throws(()=>answerFromAi(JSON.stringify({version:1,outputLocale:'nb',answer:'Verified headline',evidence:{quote:'Verified headline'},unexpected:true}),source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('server anchors event evidence without weakening date and claim validation',()=>{
  const source={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'Trip day 2030-09-20 A Bring boots',fingerprint:'plan'};
  const withoutUrl={...event('2030-09-20'),evidence:{quote:'Trip day 2030-09-20 A Bring boots'}};
  const result=extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[withoutUrl]}),source,new Date('2026-09-08T00:00:00Z'));
  assert.equal(result.events[0]!.evidence.sourceUrl,source.finalUrl);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...withoutUrl,description:'Invented closure'}]}),source,new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('a verified conditional rule can return no relevant events without creating unsupported evidence',()=>{
  const source={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=60&lon=10',contentType:'application/vnd.met.no.locationforecast+json' as const,text:'Forecast: no precipitation',fingerprint:'weather'};
  assert.deepEqual(extractionFromAi('{"version":1,"outputLocale":"nb","events":[]}',source,new Date('2026-09-12T00:00:00Z')).events,[]);
});

test('composite events are anchored to dated web and weather evidence',()=>{
  const web={finalUrl:'https://example.com/plan',contentType:'text/html' as const,text:'Trip day 2030-09-20 A',fingerprint:'web',evidenceKind:'web' as const};
  const weather={finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=60&lon=10',contentType:'application/vnd.met.no.locationforecast+json' as const,text:'Forecast 2030-09-20T08:00:00Z: symbol rain',fingerprint:'weather',evidenceKind:'weather' as const,evidenceDates:['2030-09-20']};
  const combined={date:'2030-09-20',time:null,type:'Trip day',description:'Trip day rain',actions:[],who:['A'],evidence:{quote:web.text,sourceUrl:web.finalUrl,claims:['Trip day','A'],sources:[{quote:weather.text,claims:['rain']}]},confidence:0.9,uncertainty:null};
  const result=extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[combined]}),[web,weather],new Date('2026-09-08T00:00:00Z'));
  assert.equal(result.events[0]!.evidence.sourceUrl,web.finalUrl);assert.equal(result.events[0]!.evidence.sources?.[0]?.sourceUrl,weather.finalUrl);
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...combined,evidence:{...combined.evidence,sources:[{quote:weather.text,sourceUrl:'https://api.met.no/unopened',claims:['rain']}]}}]}),[web,weather],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...combined,evidence:{...combined.evidence,sources:[{quote:weather.text,claims:['snow']}]}}]}),[web,weather],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  const {claims:_claims,...unmappedPrimary}=combined.evidence;assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[{...combined,evidence:unmappedPrimary}]}),[web,weather],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
  assert.throws(()=>extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[combined]}),[web,{...weather,evidenceDates:['2030-09-21']}],new Date('2026-09-08T00:00:00Z')),(error:any)=>error.code==='AI_COMPOSITION_INVALID');
});

test('interpretation validation exposes only sanitized schema and source-refusal stages',()=>{
  assert.throws(()=>interpretationFromAi('{"summary":"missing fields"}'),(error:any)=>error.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID'&&error.details?.validationStage==='final_schema'&&error.details?.validationReason==='invalid_json_or_schema');
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
    const answer={version:1,outputLocale:'nb',answer:value,evidence:{quote:value,sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
    assert.equal(answerFromAi(JSON.stringify(answer),source).answer,value);
  }
  const headingEvent={...event('2030-09-20'),evidence:{...event('2030-09-20').evidence,sourceUrl:source.finalUrl}};
  const extracted=extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[headingEvent]}),source,new Date('2026-09-08T00:00:00Z'));
  assert.equal(extracted.events[0]!.evidence.sourceUrl,source.finalUrl);
  const invented={version:1,outputLocale:'nb',answer:'Invented article title',evidence:{quote:'Invented article title',sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null};
  assert.throws(()=>answerFromAi(JSON.stringify(invented),source),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('displayed link labels cite the opened page and unopened child URLs remain invalid',()=>{
  const root={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'Displayed editorial headline',fingerprint:'synthetic',links:[{url:'https://example.com/story',label:'Displayed editorial headline'}]};
  const valid={version:1,outputLocale:'nb',answer:'Displayed editorial headline',evidence:{quote:'Displayed editorial headline',sourceUrl:root.finalUrl},confidence:0.9,uncertainty:null};assert.equal(answerFromAi(JSON.stringify(valid),root).answer,'Displayed editorial headline');
  assert.throws(()=>answerFromAi(JSON.stringify({...valid,evidence:{...valid.evidence,sourceUrl:'https://example.com/story'}}),root),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('evidence URLs accept only safe canonical equivalence and are rewritten to exact final URLs',()=>{
  const root={finalUrl:'https://example.com/',contentType:'text/html' as const,text:'Canonical headline\nTrip day 2030-09-20 A Bring boots',fingerprint:'synthetic'};
  const answer={version:1,outputLocale:'nb',answer:'Canonical headline',evidence:{quote:'Canonical headline',sourceUrl:'https://example.com'},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(answer),root).evidence.sourceUrl,root.finalUrl);
  assert.equal(answerFromAi(JSON.stringify({...answer,evidence:{...answer.evidence,sourceUrl:'https://example.com:443/#section'}}),root).evidence.sourceUrl,root.finalUrl);
  const canonicalEvent={...event('2030-09-20'),evidence:{...event('2030-09-20').evidence,sourceUrl:'https://example.com'}};const extracted=extractionFromAi(JSON.stringify({version:1,outputLocale:'nb',events:[canonicalEvent]}),root,new Date('2026-09-08T00:00:00Z'));assert.equal(extracted.events[0]!.evidence.sourceUrl,root.finalUrl);
  for(const sourceUrl of ['https://example.com/other','https://example.com/?day=1','https://other.example/','http://127.0.0.1/','https://example.com/?api%5Fkey=hidden']){
    assert.throws(()=>answerFromAi(JSON.stringify({...answer,evidence:{...answer.evidence,sourceUrl}}),root),(error:any)=>error.code==='AI_RESPONSE_INVALID',sourceUrl);
  }
});

test('only server-recorded successful request aliases authorize redirected evidence URLs',()=>{
  const redirected={finalUrl:'https://www.example.com/',contentType:'text/html' as const,text:'Redirected headline',fingerprint:'redirect',evidenceUrlAliases:['https://example.com/']};
  const answer={version:1,outputLocale:'nb',answer:'Redirected headline',evidence:{quote:'Redirected headline',sourceUrl:'https://example.com/'},confidence:0.9,uncertainty:null};
  assert.equal(answerFromAi(JSON.stringify(answer),redirected).evidence.sourceUrl,redirected.finalUrl);
  assert.throws(()=>answerFromAi(JSON.stringify({...answer,evidence:{...answer.evidence,sourceUrl:'https://example.com/unopened'}}),redirected),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('monitor answer parsing recovers the final strict object from bounded model noise',()=>{
  const source={finalUrl:'https://example.com/news',contentType:'text/html' as const,text:'First valid headline\nFinal valid headline',fingerprint:'synthetic'};
  const answer=(value:string)=>({version:1,outputLocale:'nb',answer:value,evidence:{quote:value,sourceUrl:source.finalUrl},confidence:0.9,uncertainty:null});
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
