import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import test, {after,before} from 'node:test';
import {roleCapabilityPresets} from '@samvev/contracts';
import {DomainError,tokenHash} from '@samvev/core';
import type {FastifyInstance} from 'fastify';
import type {PoolClient} from 'pg';
import {buildApp} from '../app.ts';
import {pool} from '../db.ts';
import {migrate} from '../db/migrate.ts';
import {MonitorExecutionQueue,runMonitorExecutionBatch} from './execution.ts';
import {MonitorEngine} from './engine.ts';
import {MonitorService,monitorTaskDto,selectMonitorTask} from './service.ts';
import type {MonitorActor} from './service.ts';
import {selectRelevantSource,type MonitorSourceFetcher,type SourceDocument} from './source-fetcher.ts';
import {nextMonitorCheckAt} from './schedule.ts';
import {AiAdminService} from '../ai/admin-service.ts';
import {weatherEvidenceText} from './weather.ts';

const guard=new URL(process.env.DATABASE_URL??'');assert.equal(guard.hostname,'test-db');assert.equal(guard.pathname,'/samvev_test');
let actor:MonitorActor;let taskId:string;let now=Date.parse('2026-09-13T12:00:00Z');let app:FastifyInstance;let sessionToken:string;let csrfToken:string;
const profile={executionProfile:async()=>({provider:'openai_compatible' as const,settingsRevision:1})};

async function fixture():Promise<void>{
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  const installation=(await pool.query<{id:string}>(`INSERT INTO installations(claimed_at,claim_token_hash,setup_step) VALUES(clock_timestamp(),NULL,'complete') RETURNING id`)).rows[0]!.id;
  const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Durable run fixture','Europe/Oslo','nb') RETURNING id`,[installation])).rows[0]!.id;
  const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic owner','adult') RETURNING id`,[household])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'durable-run@test.invalid','unused','nb','system') RETURNING id`,[installation])).rows[0]!.id;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[household,account,person,JSON.stringify(roleCapabilityPresets.household_admin)])).rows[0]!.id;
  sessionToken='durable-http-session-token';csrfToken='durable-http-csrf-token';await pool.query(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')`,[account,tokenHash(sessionToken),tokenHash(csrfToken)]);
  await pool.query(`INSERT INTO ai_settings(household_id,enabled,provider,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort,revision) VALUES($1,true,'openai_compatible','http://provider.test/v1','synthetic-routine','synthetic-strong','none','medium',1)`,[household]);
  taskId=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier) VALUES($1,$2,'Combined fixture','Check example.com schedule and weather tomorrow when conditions matter.','https://example.com/plan','["web.open","weather.forecast"]',60,1,'18:00','local','routine') RETURNING id`,[household,membership])).rows[0]!.id;
  await pool.query('INSERT INTO monitor_task_person_targets(household_id,task_id,person_id) VALUES($1,$2,$3)',[household,taskId,person]);
  actor={accountId:account,installationId:installation,householdId:household,membershipId:membership,capabilities:[...roleCapabilityPresets.household_admin]};
}

before(async()=>{await migrate();app=await buildApp();});after(async()=>{await app.close();await pool.end();});

function auth(){return{cookie:`samvev_session=${sessionToken}`,'x-csrf-token':csrfToken};}

test('task list, single-task DTO and execution polling sanitize stored diagnostics without rewriting legacy history',async()=>{
  await fixture();
  const base=`/api/v1/households/${actor.householdId}/monitors`;
  const raw={validationStage:'final_schema',validationReason:'schema_mismatch',provider:'openai_compatible',prompt:'SYNTHETIC_PRIVATE_PROMPT',rawOutput:'SYNTHETIC_PRIVATE_OUTPUT',stack:'SYNTHETIC_PRIVATE_STACK',url:'https://synthetic-private.test.invalid/',extra:{token:'SYNTHETIC_PRIVATE_TOKEN'}};
  const safe={validationStage:'final_schema',validationReason:'schema_mismatch',provider:'openai_compatible'};
  const execution=(await pool.query<{id:string}>(`INSERT INTO monitor_executions(task_id,household_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,error_details)
    VALUES($1,$2,1,'manual','queued','openai_compatible',1,'local_complex',900000,300,$3) RETURNING id`,[taskId,actor.householdId,JSON.stringify(raw)])).rows[0]!;
  const read=async()=>{
    const listed=await app.inject({method:'GET',url:base,headers:auth()});assert.equal(listed.statusCode,200,listed.body);
    const detail=monitorTaskDto((await pool.query(`${selectMonitorTask} WHERE t.id=$1 AND t.household_id=$2`,[taskId,actor.householdId])).rows[0]!);
    const poll=await app.inject({method:'GET',url:`${base}/${taskId}/runs/${execution.id}`,headers:auth()});assert.equal(poll.statusCode,200,poll.body);
    for(const body of [listed.body,JSON.stringify(detail),poll.body])assert.doesNotMatch(body,/SYNTHETIC_PRIVATE|synthetic-private/);
    return{listed:listed.json().tasks.find((task:any)=>task.id===taskId),detail,poll:poll.json().run};
  };
  const active=await read();
  for(const task of [active.listed,active.detail]){assert.deepEqual(task.activeExecution.errorDetails,safe);assert.deepEqual(task.latestExecution.errorDetails,safe);}
  assert.deepEqual(active.poll.errorDetails,safe);
  await pool.query(`UPDATE monitor_executions SET status='failed',error_code='AI_RESPONSE_INVALID',completed_at=clock_timestamp() WHERE id=$1`,[execution.id]);
  const terminal=await read();for(const task of [terminal.listed,terminal.detail]){assert.equal(task.activeExecution,null);assert.deepEqual(task.latestExecution.errorDetails,safe);}assert.deepEqual(terminal.poll.errorDetails,safe);
  assert.deepEqual((await pool.query<{error_details:object}>('SELECT error_details FROM monitor_executions WHERE id=$1',[execution.id])).rows[0]!.error_details,raw,'read-time filtering never rewrites stored history');
  const unknown={validationStage:'SYNTHETIC_PRIVATE_STAGE',validationReason:'SYNTHETIC_PRIVATE_REASON',rawOutput:'SYNTHETIC_PRIVATE_OUTPUT'};
  await pool.query('UPDATE monitor_executions SET error_details=$2 WHERE id=$1',[execution.id,JSON.stringify(unknown)]);
  const legacy=await read();assert.equal(legacy.listed.latestExecution.errorDetails,null);assert.equal((legacy.detail.latestExecution as any).errorDetails,null);assert.equal(legacy.poll.errorDetails,null,'a legacy error code does not invent a validation cause');assert.equal(legacy.poll.errorCode,'AI_RESPONSE_INVALID');
  assert.deepEqual((await pool.query<{error_details:object}>('SELECT error_details FROM monitor_executions WHERE id=$1',[execution.id])).rows[0]!.error_details,unknown);
});

test('daily 08:00 schedule stays on the Europe/Oslo wall clock across both DST changes',async()=>{
  const interpretedRule={version:1,resultKind:'events',summary:'Synthetic daily weather condition',eventTypes:[],keywords:[],people:[],noticeDaysBefore:0,noticeLocalTime:'08:00',checkIntervalMinutes:1440,conditionalNotification:true,tools:['weather.forecast'],schedule:{kind:'daily',localTime:'08:00',timezone:'Europe/Oslo'},weatherCondition:{operator:'or',conditions:[{kind:'rain'}]}};
  assert.equal((await nextMonitorCheckAt(pool as any,{interpretedRule,checkIntervalMinutes:1440},new Date('2026-03-28T08:00:00Z'))).toISOString(),'2026-03-29T06:00:00.000Z');
  assert.equal((await nextMonitorCheckAt(pool as any,{interpretedRule,checkIntervalMinutes:1440},new Date('2026-10-24T08:00:00Z'))).toISOString(),'2026-10-25T07:00:00.000Z');
  assert.equal((await nextMonitorCheckAt(pool as any,{interpretedRule,checkIntervalMinutes:1440},new Date('2026-09-19T05:00:00Z'))).toISOString(),'2026-09-19T06:00:00.000Z');
});

test('first production event run seeds the linked PDF before model-visible web evidence',async()=>{
  await fixture();
  const rule={version:1,resultKind:'events',summary:'Read synthetic school calendar.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,tool_plan='["web.open"]'::jsonb,state='active',approved_revision=revision WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const pdfText='Synthetic school calendar: 2030-09-20 school event';
  const pdf:SourceDocument={finalUrl:'https://example.com/files/calendar.pdf',contentType:'application/pdf',title:'Synthetic school calendar',headings:[],text:pdfText,fingerprint:'raw-pdf-fingerprint',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:Buffer.byteLength(pdfText),links:[],evidenceComplete:true,evidenceKind:'web'};
  const fetchOptions:Array<{followLinkedPdf?:boolean}> = [];
  const fetcher={fetch:async(_url:string,options:any)=>{fetchOptions.push(options);return pdf;}} as unknown as MonitorSourceFetcher;
  let turn=0;let visibleToolEvidence='';
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(results:any[])=>{
    turn++;
    if(turn===1)return{toolCalls:[{id:'open-calendar',name:'web.open' as const,arguments:{url:'https://example.com/plan'}}],generatedAt:new Date().toISOString()};
    visibleToolEvidence=results[0]?.output??'';
    return{output:JSON.stringify({version:1,outputLocale:'nb',events:[]}),toolCalls:[],generatedAt:new Date().toISOString()};
  }})};
  const engine=new MonitorEngine(fetcher,ai as any);
  const result=await engine.runManual(actor,taskId,1,'manual');
  assert.equal(result.outcome,'changed');
  assert.deepEqual(fetchOptions.map((options)=>options.followLinkedPdf),[true],'the first approved-source events run must follow linked PDFs');
  assert.match(visibleToolEvidence,/Synthetic school calendar: 2030-09-20 school event/,'the model tool result must contain the prefetched PDF text');
  assert.equal((await pool.query<{source_dependency_manifest:any[]}>('SELECT source_dependency_manifest FROM monitor_tasks WHERE id=$1',[taskId])).rows[0]!.source_dependency_manifest[0].fingerprint,'raw-pdf-fingerprint','the raw fetched fingerprint remains the dependency fingerprint');
  assert.deepEqual((await pool.query<{final_url:string;fingerprint:string}>(`SELECT provenance->0->>'finalUrl' AS final_url,provenance->0->>'fingerprint' AS fingerprint FROM monitor_tool_audits WHERE task_id=$1 AND phase='manual'`,[taskId])).rows[0],{final_url:'https://example.com/files/calendar.pdf',fingerprint:'raw-pdf-fingerprint'});
});

test('first approved answer run keeps unrelated linked PDF out of model evidence and uses bounded answer tokens',async()=>{
  await fixture();
  const rule={version:1,resultKind:'answer',summary:'Read synthetic school answer.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,tool_plan='["web.open"]'::jsonb,state='active',approved_revision=revision WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const quote='Synthetic answer heading in the approved HTML page';const unrelated='Unrelated PDF: another school timetable';
  const html:SourceDocument={finalUrl:'https://example.com/plan',contentType:'text/html',title:'Synthetic school page',headings:[quote],text:quote,fingerprint:'synthetic-answer-html',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:Buffer.byteLength(quote),links:[{url:'https://example.com/files/other-school.pdf',label:'Other school timetable'}],evidenceComplete:true,evidenceKind:'web'};
  const pdf:SourceDocument={finalUrl:'https://example.com/files/other-school.pdf',contentType:'application/pdf',title:'Unrelated school timetable',headings:[],text:unrelated,fingerprint:'synthetic-answer-unrelated-pdf',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:Buffer.byteLength(unrelated),links:[],evidenceComplete:true,evidenceKind:'web'};
  const fetchOptions:any[]=[];const fetcher={fetch:async(_url:string,options:any)=>{fetchOptions.push(options);return options.followLinkedPdf?pdf:html;}} as unknown as MonitorSourceFetcher;
  let turn=0;let visible='';let maxOutputTokens=0;let answerPrompt='';let sessionMode:unknown;let exposedTools:string[]=[];
  const ai={createTaskSession:async(_householdId:string,task:any,_policy:unknown,tools:any[],_signal:unknown,mode:unknown)=>{maxOutputTokens=task.maxOutputTokens;answerPrompt=task.input;sessionMode=mode;exposedTools=tools.map((item)=>item.name);return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(results:any[])=>{
    turn++;if(turn===1)return{toolCalls:[{id:'open-school',name:'web.open' as const,arguments:{url:'https://example.com/plan'}}],generatedAt:new Date().toISOString()};
    visible=results[0]?.output??'';return{output:JSON.stringify({version:1,outputLocale:'nb',answer:quote,evidence:{quote,sourceUrl:html.finalUrl,claims:[quote]},confidence:1,uncertainty:null}),toolCalls:[],generatedAt:new Date().toISOString()};
  }};}};
  const result=await new MonitorEngine(fetcher,ai as any).runManual(actor,taskId,1,'manual');
  assert.equal(result.resultKind,'answer');assert.deepEqual(fetchOptions.map((item)=>item.followLinkedPdf),[false]);assert.equal(turn,2);assert.equal(sessionMode,'extractive_answer');assert.deepEqual(exposedTools,['web.open']);
  assert.match(visible,/Synthetic answer heading in the approved HTML page/);assert.doesNotMatch(visible,/Unrelated PDF: another school timetable/);assert.equal(maxOutputTokens,2048);
  const answerInstructions=answerPrompt.split('\nSamvev already opened and validated the explicitly approved root source.')[0]!;
  assert.ok(answerInstructions.length<2_000,`answer instructions stay compact (${answerInstructions.length} chars)`);
  assert.match(answerPrompt,/Set outputLocale exactly/);assert.match(answerPrompt,/exact surfaced same-origin URL/);
  assert.match(answerPrompt,/answer and occur verbatim in evidence\.quote/);assert.match(answerPrompt,/when supplied, each claim must be exact and one claim must equal answer/);assert.match(answerPrompt,/Samvev binds evidence to opened sources/);
  assert.match(answerPrompt,/first editorial heading in document order, excluding title, navigation and section labels/);
  assert.match(answerPrompt,/via Yr.*use weather\.forecast, never scrape Yr/);
  assert.match(answerPrompt,/If web evidence determines a weather date, open it first and request weather only for that exact date/);
  assert.doesNotMatch(answerPrompt,/conditional event|For each relevant conditional event/);
});

test('weather answer uses an exact official sentence and approved weather scope',async()=>{
  await fixture();
  const rule={version:1,resultKind:'answer',summary:'Read the Oslo forecast tomorrow.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['weather.forecast'],location:{query:'Oslo',canonicalName:'Oslo',country:'Norge'},weatherScope:{location:'Oslo',period:'tomorrow',timeWindow:'all'}};
  await pool.query(`UPDATE monitor_tasks SET instruction='Tell me the weather in Oslo tomorrow via Yr.',interpreted_rule=$2,tool_plan='["weather.forecast"]'::jsonb WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const forecast={sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact',attribution:'MET Norway Locationforecast' as const,retrievedAt:'2026-09-13T12:00:00.000Z',updatedAt:null,validFrom:'2030-09-20T00:00:00.000Z',validTo:'2030-09-21T00:00:00.000Z',location:{query:'Oslo',canonicalName:'Oslo',municipality:null,region:null,country:'Norge' as const,latitude:59.9,longitude:10.7,placeId:'synthetic-oslo'},points:[{at:'2030-09-20T12:00:00.000Z',temperatureC:10,precipitationMm:2,windSpeedMps:3,symbolCode:'rain'}],fingerprint:'synthetic-oslo-forecast',httpStatus:200 as const,cacheStatus:'miss' as const};
  const quote=weatherEvidenceText(forecast).split('\n').find((line:string)=>line.startsWith('Norwegian presentation:'))!.replace('Norwegian presentation: ','');
  let answerPrompt='';let maxOutputTokens=0;let turn=0;
  const ai={createTaskSession:async(_householdId:string,task:any)=>{answerPrompt=task.input;maxOutputTokens=task.maxOutputTokens;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{
    turn++;return{output:JSON.stringify({version:1,outputLocale:'nb',answer:quote,evidence:{quote},confidence:1,uncertainty:null}),toolCalls:[],generatedAt:new Date().toISOString()};
  }};}};
  const requests:any[]=[];const weather={forecast:async(request:any)=>{requests.push(request);return forecast;}};
  const result=await new MonitorEngine({fetch:async()=>{throw new Error('weather-only answer must not fetch web');}} as any,ai as any,weather as any).runManual(actor,taskId,1,'test');
  assert.equal(result.resultKind,'answer');assert.equal(maxOutputTokens,2048);assert.equal(turn,1);
  assert.deepEqual(requests,[{location:'Oslo',period:'tomorrow',timeWindow:'all'}]);
  assert.match(answerPrompt,/first editorial heading in document order, excluding title, navigation and section labels/);
  assert.match(answerPrompt,/via Yr.*use weather\.forecast, never scrape Yr/);
  assert.match(answerPrompt,/If web evidence determines a weather date, open it first and request weather only for that exact date/);
  const answerInstructions=answerPrompt.split('\nSamvev already executed the approved weather.forecast call.')[0]!;
  assert.ok(answerInstructions.length<2_000,`weather answer instructions stay compact (${answerInstructions.length} chars)`);
  assert.match((result.result as any).answer,/Vær for Oslo, Norge/);
  assert.deepEqual((await pool.query<{state:string}>('SELECT state FROM monitor_tasks WHERE id=$1',[taskId])).rows[0]!.state,'draft');
});

test('output limit response fails safely without an automatic higher-tier retry',async()=>{
  await fixture();
  const rule={version:1,resultKind:'answer',summary:'Read a synthetic school answer.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,tool_plan='["web.open"]'::jsonb,state='active',approved_revision=revision WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const quote='Synthetic source evidence';const document:SourceDocument={finalUrl:'https://example.com/plan',contentType:'text/html',title:'Synthetic source',headings:[],text:quote,fingerprint:'synthetic-source',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:Buffer.byteLength(quote),links:[],evidenceComplete:true,evidenceKind:'web'};
  let sessions=0;const fetcher={fetch:async()=>document} as unknown as MonitorSourceFetcher;
  const ai={createTaskSession:async()=>{sessions++;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{throw new DomainError('AI_RESPONSE_INVALID',502,{validationStage:'provider_response',validationReason:'output_limit_reached',rawOutput:'SYNTHETIC_PRIVATE_PARTIAL_JSON'});}};}};
  await assert.rejects(new MonitorEngine(fetcher,ai as any).runManual(actor,taskId,1,'manual'),(error:unknown)=>error instanceof DomainError&&error.code==='AI_RESPONSE_INVALID'&&error.details?.validationReason==='output_limit_reached'&&!('rawOutput' in (error.details??{})));
  assert.equal(sessions,1,'a length-finished model response does not trigger an automatic higher-tier retry');
});

test('test preview with a matching prior fingerprint still runs AI analysis',async()=>{
  await fixture();
  const rule={version:1,resultKind:'events',summary:'Preview synthetic school calendar.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  const pdfText='Synthetic school calendar: 2030-09-20 school event';
  const pdf:SourceDocument={finalUrl:'https://example.com/files/calendar.pdf',contentType:'application/pdf',title:'Synthetic school calendar',headings:[],text:pdfText,fingerprint:'raw-pdf-fingerprint',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:Buffer.byteLength(pdfText),links:[],evidenceComplete:true,evidenceKind:'web'};
  const relevantFingerprint=selectRelevantSource(pdf,rule).fingerprint;
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,tool_plan='["web.open"]'::jsonb,last_processed_fingerprint=$3 WHERE id=$1`,[taskId,JSON.stringify(rule),relevantFingerprint]);
  const taskBefore=(await pool.query<{state:string;next_check_at:Date|null;last_processed_fingerprint:string|null;source_dependency_manifest:unknown[]}>(`SELECT state,next_check_at,last_processed_fingerprint,source_dependency_manifest FROM monitor_tasks WHERE id=$1`,[taskId])).rows[0]!;
  const messagesBefore=(await pool.query<{count:number}>('SELECT count(*)::int AS count FROM messages')).rows[0]!.count;
  let fetchCalls=0;const fetcher={fetch:async()=>{fetchCalls++;return pdf;}} as unknown as MonitorSourceFetcher;
  let turn=0;const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{
    turn++;
    if(turn===1)return{toolCalls:[{id:'open-calendar',name:'web.open' as const,arguments:{url:'https://example.com/plan'}}],generatedAt:new Date().toISOString()};
    return{output:JSON.stringify({version:1,outputLocale:'nb',events:[]}),toolCalls:[],generatedAt:new Date().toISOString()};
  }})};
  const result=await new MonitorEngine(fetcher,ai as any).runManual(actor,taskId,1,'test');
  assert.equal(result.outcome,'changed');
  assert.equal(result.resultKind,'events','a matching source fingerprint must not bypass preview analysis');
  assert.equal(fetchCalls,1);
  assert.equal(turn,2);
  assert.deepEqual((await pool.query<{outcome:string;ai_called:boolean}>(`SELECT outcome,ai_called FROM monitor_runs WHERE task_id=$1 AND run_kind='test'`,[taskId])).rows,[{outcome:'changed',ai_called:true}]);
  assert.deepEqual((await pool.query<{state:string;next_check_at:Date|null;last_processed_fingerprint:string|null;source_dependency_manifest:unknown[]}>(`SELECT state,next_check_at,last_processed_fingerprint,source_dependency_manifest FROM monitor_tasks WHERE id=$1`,[taskId])).rows[0],taskBefore);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int AS count FROM messages')).rows[0]!.count,messagesBefore);
});

test('separate monitor tasks receive only their own prefetched PDF evidence',async()=>{
  await fixture();
  const rule={version:1,resultKind:'events',summary:'Read synthetic school calendar.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,tool_plan='["web.open"]'::jsonb WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const secondTaskId=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,interpreted_rule) VALUES($1,$2,'Second synthetic fixture','Read another synthetic calendar.','https://other.example/plan','["web.open"]',60,1,'18:00','local','routine',$3) RETURNING id`,[actor.householdId,actor.membershipId,JSON.stringify(rule)])).rows[0]!.id;
  const sources=[
    {url:'https://example.com/plan',document:{finalUrl:'https://example.com/files/calendar.pdf',contentType:'application/pdf' as const,title:'First synthetic calendar',headings:[],text:'Only evidence for first task',fingerprint:'first-task-fingerprint',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:28,links:[],evidenceComplete:true,evidenceKind:'web' as const}},
    {url:'https://other.example/plan',document:{finalUrl:'https://other.example/files/calendar.pdf',contentType:'application/pdf' as const,title:'Second synthetic calendar',headings:[],text:'Only evidence for second task',fingerprint:'second-task-fingerprint',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:29,links:[],evidenceComplete:true,evidenceKind:'web' as const}}
  ];
  const fetcher={fetch:async(url:string)=>sources.find((item)=>item.url===url)!.document} as unknown as MonitorSourceFetcher;
  let sessionIndex=0;const visibleEvidence:string[]=[];
  const ai={createTaskSession:async()=>{const source=sources[sessionIndex++]!;let turn=0;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(results:any[])=>{
    turn++;
    if(turn===1)return{toolCalls:[{id:'open-calendar',name:'web.open' as const,arguments:{url:source.url}}],generatedAt:new Date().toISOString()};
    visibleEvidence.push(results[0]?.output??'');return{output:JSON.stringify({version:1,outputLocale:'nb',events:[]}),toolCalls:[],generatedAt:new Date().toISOString()};
  }};}};
  const engine=new MonitorEngine(fetcher,ai as any);
  await engine.runManual(actor,taskId,1,'test');await engine.runManual(actor,secondTaskId,1,'test');
  assert.equal(visibleEvidence.length,2);
  assert.match(visibleEvidence[0]!,/Only evidence for first task/);assert.doesNotMatch(visibleEvidence[0]!,/Only evidence for second task/);
  assert.match(visibleEvidence[1]!,/Only evidence for second task/);assert.doesNotMatch(visibleEvidence[1]!,/Only evidence for first task/);
});

test('durable enqueue returns one stable run, survives request completion and keeps a bounded lease',async()=>{
  await fixture();let resolveWork!:()=>void;let capturedDeadline=0;const work=new Promise<void>((resolve)=>{resolveWork=resolve;});
  const monitors={interpret:async(_actor:MonitorActor,_id:string,_revision:number,options:any)=>{capturedDeadline=options.deadlineMs;await options.observer.progress('analyzing');await work;now+=240_000;return{revision:2};}};
  const engine={runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}};
  const queue=new MonitorExecutionQueue(monitors as any,engine as any,profile,()=>now);
  const enqueued=await queue.enqueue(actor,taskId,1,'interpretation');assert.equal(enqueued.status,'queued');assert.equal(enqueued.usesLocalAi,true);assert.equal(enqueued.expectedDurationSeconds,300);
  const normalAudit=(await pool.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM audit_events WHERE subject_type='monitor_execution' AND subject_id=$1`,[enqueued.id])).rows[0]!;assert.equal(Object.hasOwn(normalAudit.metadata,'synthetic'),false,'normal households must not be labelled as live E2E');
  const duplicate=await queue.enqueue(actor,taskId,1,'interpretation');assert.equal(duplicate.id,enqueued.id,'double click must join the active execution');
  const runningPromise=queue.runOne();for(let attempt=0;attempt<100;attempt++){const current=await queue.get(actor,taskId,enqueued.id);if(current.status==='running'&&current.progress.stage==='analyzing')break;await new Promise((resolve)=>setTimeout(resolve,5));}
  const running=await queue.get(actor,taskId,enqueued.id);assert.equal(running.status,'running');assert.equal(running.progress.stage,'analyzing');
  const lease=(await pool.query<{remaining:number;max_runtime_ms:number}>(`SELECT (extract(epoch from (worker_lease_expires_at-started_at))*1000)::int AS remaining,max_runtime_ms FROM monitor_executions WHERE id=$1`,[enqueued.id])).rows[0]!;assert.ok(lease.remaining>=lease.max_runtime_ms+59_000);
  assert.equal((await queue.get(actor,taskId,enqueued.id)).id,enqueued.id,'polling after a page refresh does not enqueue work');resolveWork();assert.equal(await runningPromise,'succeeded');
  const completed=await queue.get(actor,taskId,enqueued.id);assert.equal(completed.status,'succeeded');assert.equal(completed.timing?.totalMs,240_000);assert.equal(capturedDeadline,600_000);
});

test('real interpretation service and agent runner accept a provider result after four synthetic minutes',async(t)=>{
  await fixture();await pool.query(`UPDATE monitor_tasks SET instruction='Read the approved synthetic page.',tool_plan='["web.open"]'::jsonb,model_tier='strong' WHERE id=$1`,[taskId]);
  // A pg idle timeout created before MockTimers is real; mocked clearTimeout
  // cannot cancel it when that client is checked out. It can later terminate a
  // different test's live lock-holder. Drain those timers with the real clock,
  // and keep idle reaping off only while this test exercises fake deadlines.
  const idleTimeoutMillis=pool.options.idleTimeoutMillis;
  const drained:PoolClient[]=[];
  try{
    for(let remaining=pool.totalCount;remaining>0;remaining--)drained.push(await pool.connect());
    pool.options.idleTimeoutMillis=0;
  }finally{for(const client of drained)client.release();}
  try{
    t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-09-13T12:00:00Z')});
    let turn=0;let providerSignal:AbortSignal|undefined;let slowTurnStarted!:()=>void;const slowTurn=new Promise<void>((resolve)=>{slowTurnStarted=resolve;});
    const rule={version:1,resultKind:'answer',summary:'Read the approved synthetic page.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
    const ai={createTaskSession:async(_household:string,_task:unknown,_policy:unknown,_tools:unknown,_signal:AbortSignal)=>{providerSignal=_signal;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{turn++;if(turn===1)return{toolCalls:[{id:'open',name:'web.open' as const,arguments:{url:'https://example.test/plan'}}],generatedAt:new Date().toISOString()};slowTurnStarted();return new Promise((resolve,reject)=>{const abort=()=>reject(new DomainError('AI_TIMEOUT',504));if(_signal.aborted)return abort();_signal.addEventListener('abort',abort,{once:true});setTimeout(()=>{_signal.removeEventListener('abort',abort);resolve({output:JSON.stringify(rule),toolCalls:[],generatedAt:new Date().toISOString()});},240_000);});}};}};
    const document:SourceDocument={finalUrl:'https://example.test/plan',contentType:'text/html',title:'Synthetic page',headings:['Synthetic heading'],text:'Synthetic heading',fingerprint:'synthetic-v1',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:17,links:[]};
    const fetcher={fetch:async()=>document} as unknown as MonitorSourceFetcher;const service=new MonitorService(ai as any,fetcher);const queue=new MonitorExecutionQueue(service,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>Date.now());
    const run=await queue.enqueue(actor,taskId,1,'interpretation');const completion=queue.runOne();await slowTurn;t.mock.timers.tick(240_000);assert.equal(providerSignal?.aborted,false);assert.equal(await completion,'succeeded');
    const stored=await queue.get(actor,taskId,run.id);assert.equal(stored.status,'succeeded');assert.equal(stored.timing?.totalMs,240_000);assert.equal(turn,2);assert.equal((await pool.query<{revision:number;interpreted_rule:unknown}>('SELECT revision,interpreted_rule FROM monitor_tasks WHERE id=$1',[taskId])).rows[0]!.revision,2);
  }finally{
    // Restore real timer operations before any new pg idle timer is created.
    t.mock.timers.reset();
    pool.options.idleTimeoutMillis=idleTimeoutMillis;
  }
});

test('interpretation publication is fenced when the AI route changes after the final provider response',async()=>{
  await fixture();await pool.query(`UPDATE monitor_tasks SET instruction='Read the approved synthetic page.',tool_plan='["web.open"]'::jsonb WHERE id=$1`,[taskId]);
  const rule={version:1,resultKind:'answer',summary:'Read the approved synthetic page.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};let turn=0;
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{turn++;if(turn===1)return{toolCalls:[{id:'open',name:'web.open' as const,arguments:{url:'https://example.test/plan'}}],generatedAt:new Date().toISOString()};await pool.query(`UPDATE ai_settings SET enabled=false,revision=revision+1 WHERE household_id=$1`,[actor.householdId]);return{output:JSON.stringify(rule),toolCalls:[],generatedAt:new Date().toISOString()};}})};
  const document:SourceDocument={finalUrl:'https://example.test/plan',contentType:'text/html',title:'Synthetic page',headings:['Synthetic heading'],text:'Synthetic heading',fingerprint:'synthetic-v1',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:17,links:[]};const service=new MonitorService(ai as any,{fetch:async()=>document} as unknown as MonitorSourceFetcher);
  await assert.rejects(()=>service.interpret(actor,taskId,1),(error:any)=>error.code==='AI_CONFIGURATION_INVALID');const stored=(await pool.query<{revision:number;interpreted_rule:unknown}>('SELECT revision,interpreted_rule FROM monitor_tasks WHERE id=$1',[taskId])).rows[0]!;assert.equal(stored.revision,1);assert.equal(stored.interpreted_rule,null);
});

test('manual publication keeps usage but rejects the result when AI is disabled after the last response',async()=>{
  await fixture();const rule={version:1,resultKind:'answer',summary:'Read synthetic source.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,tool_plan='["web.open"]'::jsonb,state='active',approved_revision=revision WHERE id=$1`,[taskId,JSON.stringify(rule)]);let turn=0;const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{turn++;if(turn===1)return{toolCalls:[{id:'open',name:'web.open' as const,arguments:{url:'https://example.com/plan'}}],generatedAt:new Date().toISOString()};await pool.query(`UPDATE ai_settings SET enabled=false,revision=revision+1 WHERE household_id=$1`,[actor.householdId]);return{output:JSON.stringify({version:1,outputLocale:'nb',answer:'Synthetic heading',evidence:{quote:'Synthetic heading',sourceUrl:'https://example.com/plan',claims:['Synthetic heading']},confidence:1,uncertainty:null}),toolCalls:[],generatedAt:new Date().toISOString()};}})};const document:SourceDocument={finalUrl:'https://example.com/plan',contentType:'text/html',title:'Synthetic page',headings:['Synthetic heading'],text:'Synthetic heading',fingerprint:'synthetic-v1',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:17,links:[],evidenceComplete:true,evidenceKind:'web'};const engine=new MonitorEngine({fetch:async()=>document} as unknown as MonitorSourceFetcher,ai as any);
  await assert.rejects(()=>engine.runManual(actor,taskId,1,'manual'),(error:any)=>error.code==='CONFLICT');assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_runs WHERE task_id=$1 AND outcome='changed'`,[taskId])).rows[0].count,0);assert.equal((await pool.query(`SELECT count(*)::int count FROM messages`,[])).rows[0].count,0);
});

test('production HTTP actions return durable 202 runs and expose the authenticated run projection',async()=>{
  const readyRule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  for(const action of ['interpret','test','smarter','run'] as const){
    await fixture();
    if(action!=='interpret')await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state=$3,approved_revision=CASE WHEN $3='active' THEN revision ELSE NULL END WHERE id=$1`,[taskId,JSON.stringify(readyRule),action==='run'?'active':'draft']);
    const response=await app.inject({method:'POST',url:`/api/v1/households/${actor.householdId}/monitors/${taskId}/${action}`,headers:auth(),payload:{expectedRevision:1}});
    assert.equal(response.statusCode,202,response.body);const run=response.json().run;assert.equal(run.taskId,taskId);assert.equal(run.status,'queued');assert.equal(run.kind,action==='interpret'?'interpretation':action==='run'?'manual':action);
    const duplicate=await app.inject({method:'POST',url:`/api/v1/households/${actor.householdId}/monitors/${taskId}/${action}`,headers:auth(),payload:{expectedRevision:1}});assert.equal(duplicate.statusCode,202,duplicate.body);assert.equal(duplicate.json().run.id,run.id);
    const projected=await app.inject({method:'GET',url:`/api/v1/households/${actor.householdId}/monitors/${taskId}/runs/${run.id}`,headers:{cookie:`samvev_session=${sessionToken}`}});assert.equal(projected.statusCode,200,projected.body);assert.equal(projected.json().run.id,run.id);
    if(action==='interpret'){const other=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Other synthetic household','Europe/Oslo','nb') RETURNING id`,[actor.installationId])).rows[0]!;const isolated=await app.inject({method:'GET',url:`/api/v1/households/${other.id}/monitors/${taskId}/runs/${run.id}`,headers:{cookie:`samvev_session=${sessionToken}`}});assert.equal(isolated.statusCode,404,isolated.body);}
  }
  await fixture();const invalid=await app.inject({method:'POST',url:`/api/v1/households/${actor.householdId}/monitors/${taskId}/smarter`,headers:auth(),payload:{expectedRevision:1}});assert.equal(invalid.statusCode,422,invalid.body);assert.equal(invalid.json().error.code,'MONITOR_SETUP_REQUIRED');assert.equal((await pool.query(`SELECT count(*)::int AS count FROM monitor_executions WHERE task_id=$1`,[taskId])).rows[0].count,0);
});

test('only the bounded server deadline becomes AI_TIMEOUT and stale revisions become superseded',async()=>{
  await fixture();const timingQueue=new MonitorExecutionQueue({interpret:async()=>{now+=600_000;throw new DomainError('AI_TIMEOUT',504);}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);
  const timed=await timingQueue.enqueue(actor,taskId,1,'interpretation');assert.equal(await timingQueue.runOne(),'failed');const timeout=await timingQueue.get(actor,taskId,timed.id);assert.equal(timeout.errorCode,'AI_TIMEOUT');assert.equal(timeout.timeoutReason,'server_deadline');
  await pool.query('UPDATE monitor_tasks SET revision=revision+1 WHERE id=$1',[taskId]);const nextTask=(await pool.query<{revision:number}>('SELECT revision FROM monitor_tasks WHERE id=$1',[taskId])).rows[0]!;
  const staleQueue=new MonitorExecutionQueue({interpret:async()=>{throw new DomainError('REVISION_CONFLICT',409);}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);
  const stale=await staleQueue.enqueue(actor,taskId,nextTask.revision,'interpretation');assert.equal(await staleQueue.runOne(),'superseded');assert.equal((await staleQueue.get(actor,taskId,stale.id)).status,'superseded');
});

test('failed executions retain a sanitized automatic-quality-escalation flag',async()=>{
  await fixture();const monitors={interpret:async(_actor:MonitorActor,_id:string,_revision:number,options:any)=>{await pool.query(`INSERT INTO monitor_quality_audits(task_id,task_revision,phase,reason,from_tier,to_tier,outcome,execution_id) VALUES($1,1,'interpretation','invalid_schema','routine','strong','escalated',$2)`,[taskId,options.executionId]);throw new DomainError('AI_RESPONSE_INVALID',502);}};
  const queue=new MonitorExecutionQueue(monitors as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);const run=await queue.enqueue(actor,taskId,1,'interpretation');assert.equal(await queue.runOne(),'failed');const failed=await queue.get(actor,taskId,run.id);assert.equal(failed.timing?.qualityEscalated,true);assert.equal(failed.errorCode,'AI_RESPONSE_INVALID');
});

test('preview results and safe errors persist for reload without activating or rescheduling the task',async()=>{
  await fixture();
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2 WHERE id=$1`,[taskId,JSON.stringify({version:1,resultKind:'answer',summary:'Synthetic weather check',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['weather.forecast'],location:{query:'Test place',canonicalName:'Test place',country:'Norge'},weatherScope:{location:'Test place',period:'tomorrow',timeWindow:'all'}})]);
  const result={outcome:'changed' as const,resultKind:'answer' as const,result:{version:1,answer:'Synthetic result',evidence:{quote:'Synthetic result',sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation'},confidence:1,uncertainty:null},sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',checkedAt:'2026-09-13T12:00:00.000Z',sources:[]};
  const engine={runManual:async()=>result,runScheduled:async()=>{throw new Error('unused');}};
  const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,engine as any,profile,()=>now);
  const run=await queue.enqueue(actor,taskId,1,'test');assert.equal(await queue.runOne(),'succeeded');
  const completed=await queue.get(actor,taskId,run.id);assert.deepEqual(completed.resultSummary,result);
  const stored=(await pool.query<{state:string;next_check_at:Date|null;result_summary:any}>('SELECT t.state,t.next_check_at,e.result_summary FROM monitor_tasks t JOIN monitor_executions e ON e.task_id=t.id WHERE e.id=$1',[run.id])).rows[0]!;
  assert.equal(stored.state,'draft');assert.equal(stored.next_check_at,null);assert.equal(stored.result_summary.result.answer,'Synthetic result');
  const projected=(await new MonitorService().list(actor)).find((item:any)=>item.id===taskId) as any;
  assert.equal(projected.activeExecution,null);assert.equal(projected.latestExecution.id,run.id);assert.equal(projected.latestExecution.resultSummary.result.answer,'Synthetic result');

  const nextTask=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier) SELECT household_id,owner_membership_id,'Ambiguous fixture','Check weather in Test place','["weather.forecast"]',60,1,'18:00','local','routine' FROM monitor_tasks WHERE id=$1 RETURNING id`,[taskId])).rows[0]!;
  await pool.query(`INSERT INTO monitor_task_person_targets(household_id,task_id,person_id) SELECT household_id,$2,person_id FROM monitor_task_person_targets WHERE task_id=$1`,[taskId,nextTask.id]);
  const failedQueue=new MonitorExecutionQueue({interpret:async()=>{throw new DomainError('MONITOR_LOCATION_AMBIGUOUS',422,{candidates:[{name:'Safe place',municipality:'Test',region:'Region',latitude:1,secret:'hidden'}]});}} as any,engine as any,profile,()=>now);
  const failed=await failedQueue.enqueue(actor,nextTask.id,1,'interpretation');assert.equal(await failedQueue.runOne(),'failed');
  assert.deepEqual((await failedQueue.get(actor,nextTask.id,failed.id)).errorDetails,{candidates:[{name:'Safe place',municipality:'Test',region:'Region'}]});
});

test('scheduled work uses the same durable long-running lane and cannot be queued twice',async()=>{
  await fixture();
  const rule={version:1,resultKind:'events',summary:'Synthetic schedule and weather',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:true,tools:['web.open','weather.forecast'],weatherScope:{location:'Test place',period:'date',timeWindow:'all',dynamicDateFromEvidence:true}};
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision,next_check_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  let resolveWork!:()=>void;const work=new Promise<void>((resolve)=>{resolveWork=resolve;});let options:any;
  const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async(_id:string,_revision:number,value:any)=>{options=value;await work;now+=240_000;return'changed';}} as any,profile,()=>now);
  assert.equal(await queue.enqueueScheduled(),1);assert.equal(await queue.enqueueScheduled(),0);
  const running=queue.runOne();for(let attempt=0;attempt<20&&!options;attempt++)await new Promise((resolve)=>setTimeout(resolve,5));
  assert.equal(options.deadlineMs,600_000);assert.ok(options.leaseMs>options.deadlineMs);assert.equal(await queue.enqueueScheduled(),0);
  resolveWork();assert.equal(await running,'succeeded');
  const execution=(await pool.query<{kind:string;status:string}>(`SELECT kind,status FROM monitor_executions WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1`,[taskId])).rows[0]!;
  assert.deepEqual(execution,{kind:'scheduled',status:'succeeded'});
});

test('durable manual work and scheduled failures retain the execution outcome and safe timeout reason',async()=>{
  await fixture();const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const manualResult={outcome:'unchanged' as const,resultKind:'answer' as const,result:null,sourceUrl:null,checkedAt:'2026-09-13T12:00:00.000Z',sources:[]};
  const manualQueue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>manualResult,runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);
  const manual=await manualQueue.enqueue(actor,taskId,1,'manual');assert.equal(await manualQueue.runOne(),'succeeded');assert.equal((await manualQueue.get(actor,taskId,manual.id)).resultSummary?.outcome,'unchanged');

  await fixture();await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision,next_check_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  let executionId:string|undefined;const scheduledQueue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async(id:string,revision:number,options:any)=>{executionId=options.executionId;await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,error_code,ai_called,ai_call_count,run_kind,execution_id) VALUES($1,$2,'failed','AI_TIMEOUT',true,1,'scheduled',$3)`,[id,revision,options.executionId]);return'failed';}} as any,profile,()=>now);
  assert.equal(await scheduledQueue.enqueueScheduled(),1);assert.equal(await scheduledQueue.runOne(),'failed');const failed=(await pool.query<{id:string}>(`SELECT id FROM monitor_executions WHERE task_id=$1`,[taskId])).rows[0]!;const projection=await scheduledQueue.get(actor,taskId,failed.id);assert.equal(projection.errorCode,'AI_TIMEOUT');assert.equal(projection.timeoutReason,'provider_timeout');assert.equal(executionId,failed.id);
});

test('an expired worker lease becomes a recoverable interrupted execution',async()=>{
  await fixture();const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);const run=await queue.enqueue(actor,taskId,1,'interpretation');
  await pool.query(`UPDATE monitor_executions SET status='running',started_at=clock_timestamp()-interval '12 minutes',worker_lease_token=gen_random_uuid(),worker_lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[run.id]);assert.equal(await queue.runOne(),'idle');const recovered=await queue.get(actor,taskId,run.id);assert.equal(recovered.status,'failed');assert.equal(recovered.errorCode,'MONITOR_WORKER_INTERRUPTED');assert.equal(recovered.timeoutReason,'worker_interrupted');
});

test('scheduler configuration failures are isolated from an already queued user run',async()=>{
  await fixture();const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision WHERE id=$1`,[taskId,JSON.stringify(rule)]);
  const rejectingProfile={executionProfile:async(_householdId:string,policyName:string)=>{if(policyName==='openai')throw new DomainError('AI_PROVIDER_UNAVAILABLE',422);return profile.executionProfile();}};const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>({outcome:'unchanged',resultKind:'answer',result:null,sourceUrl:null,checkedAt:new Date().toISOString(),sources:[]}),runScheduled:async()=>{throw new Error('unused');}} as any,rejectingProfile as any,()=>now);await queue.enqueue(actor,taskId,1,'manual');
  const broken=(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,interpreted_rule,state,approved_revision,next_check_at,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier) SELECT household_id,owner_membership_id,'Broken scheduled fixture',instruction,source_url,tool_plan,$2,'active',1,clock_timestamp()-interval '1 minute',60,1,'18:00','openai','routine' FROM monitor_tasks WHERE id=$1 RETURNING id`,[taskId,JSON.stringify(rule)])).rows[0]!;
  const batch=await runMonitorExecutionBatch(1,queue);assert.equal(batch.claimed,1);assert.equal(batch.succeeded,1);const rejected=(await pool.query<{error_code:string;next_check_at:Date}>(`SELECT error_code,next_check_at FROM monitor_tasks WHERE id=$1`,[broken.id])).rows[0]!;assert.equal(rejected.error_code,'AI_PROVIDER_UNAVAILABLE');assert.ok(rejected.next_check_at.getTime()>Date.now());assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM monitor_runs WHERE task_id=$1 AND outcome='failed'`,[broken.id])).rows[0]!.count,1);
});

test('terminal plan admission failures pause scheduled work without queueing or retrying',async(t)=>{
  const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  for(const code of ['AI_PLAN_USAGE_LIMITED','AI_PLAN_NOT_ELIGIBLE','AI_PLAN_PERMISSION_REQUIRED','AI_REAUTHORIZATION_REQUIRED','MONITOR_OWNER_UNAUTHORIZED'])await t.test(code,async()=>{
    await fixture();await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision,next_check_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,[taskId,JSON.stringify(rule)]);
    let engineCalls=0;const blockedProfile={executionProfile:async()=>{throw new DomainError(code,422);}};const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{engineCalls++;throw new Error('unused');},runScheduled:async()=>{engineCalls++;throw new Error('unused');}} as any,blockedProfile as any,()=>now);
    assert.equal(await queue.enqueueScheduled(),0);assert.equal(engineCalls,0);assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM monitor_executions WHERE task_id=$1`,[taskId])).rows[0]!.count,0);
    const paused=(await pool.query<{state:string;revision:number;next_check_at:Date|null;error_code:string}>(`SELECT state,revision,next_check_at,error_code FROM monitor_tasks WHERE id=$1`,[taskId])).rows[0]!;assert.deepEqual(paused,{state:'paused',revision:2,next_check_at:null,error_code:code});
    const run=(await pool.query<{error_code:string;ai_called:boolean;ai_call_count:number}>(`SELECT error_code,ai_called,ai_call_count FROM monitor_runs WHERE task_id=$1`,[taskId])).rows[0]!;assert.deepEqual(run,{error_code:code,ai_called:false,ai_call_count:0});
    assert.equal(await queue.enqueueScheduled(),0);assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM monitor_runs WHERE task_id=$1`,[taskId])).rows[0]!.count,1,'a paused task must not create a retry run');
  });
});

test('revoked scheduled-task owners are paused and their monitor messages are withdrawn',async(t)=>{
  const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  for(const scenario of ['disabled_account','missing_manage','missing_publish','missing_display_grant','profile_forbidden'] as const)await t.test(scenario,async()=>{
    await fixture();await pool.query(`UPDATE memberships SET capabilities=$2 WHERE id=$1`,[actor.membershipId,JSON.stringify(roleCapabilityPresets.household_admin)]);await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision,next_check_at=clock_timestamp()-interval '1 minute',last_processed_fingerprint='previous-fingerprint',source_dependency_manifest='[{"url":"https://example.com/plan","fingerprint":"previous-fingerprint","contentType":"text/html"}]'::jsonb WHERE id=$1`,[taskId,JSON.stringify(rule)]);
    const display=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic display','nb','light') RETURNING id`,[actor.householdId])).rows[0]!;await pool.query(`INSERT INTO monitor_task_display_targets(household_id,task_id,display_id) VALUES($1,$2,$3)`,[actor.householdId,taskId,display.id]);await pool.query(`INSERT INTO membership_display_grants(household_id,membership_id,display_id) VALUES($1,$2,$3)`,[actor.householdId,actor.membershipId,display.id]);
    for(const [index,state] of (['scheduled','published'] as const).entries()){const message=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,$3,'normal',false,CASE WHEN $4='scheduled' THEN clock_timestamp()+interval '1 hour' ELSE clock_timestamp()-interval '1 hour' END,clock_timestamp()+interval '2 hours',$4,$5,CASE WHEN $4='published' THEN clock_timestamp() END) RETURNING id`,[actor.householdId,actor.membershipId,`Synthetic ${state}`,state,`owner-revocation-${state}`])).rows[0]!;await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id,delivery_state) VALUES($1,$2,$3,'delivered')`,[actor.householdId,message.id,display.id]);await pool.query(`INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_type,description,evidence,confidence,source_fingerprint,message_id) VALUES($1,$2,$3,CURRENT_DATE+$4::int,'synthetic','Synthetic event',$5,1,'previous-fingerprint',$6)`,[actor.householdId,taskId,`event-${state}`,index,JSON.stringify({quote:'Synthetic event'}),message.id]);}
    if(scenario==='disabled_account')await pool.query(`UPDATE accounts SET disabled_at=clock_timestamp() WHERE id=$1`,[actor.accountId]);else if(scenario==='missing_manage')await pool.query(`UPDATE memberships SET capabilities=$2 WHERE id=$1`,[actor.membershipId,JSON.stringify(['household.view'])]);else if(scenario!=='profile_forbidden'){const capabilities=roleCapabilityPresets.household_admin.filter((capability)=>capability!=='display.manage'&&(scenario!=='missing_publish'||capability!=='message.publish.display'));await pool.query(`UPDATE memberships SET capabilities=$2 WHERE id=$1`,[actor.membershipId,JSON.stringify(capabilities)]);if(scenario==='missing_display_grant')await pool.query(`DELETE FROM membership_display_grants WHERE membership_id=$1 AND display_id=$2`,[actor.membershipId,display.id]);}
    let profileCalls=0,engineCalls=0;const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{engineCalls++;throw new Error('unused');},runScheduled:async()=>{engineCalls++;throw new Error('unused');}} as any,{executionProfile:async()=>{profileCalls++;if(scenario==='profile_forbidden')throw new DomainError('FORBIDDEN',403);throw new Error('profile must not be reached for an unauthorized owner');}} as any,()=>now);
    assert.equal(await queue.enqueueScheduled(),0);assert.equal(profileCalls,scenario==='profile_forbidden'?1:0);assert.equal(engineCalls,0);assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int count FROM monitor_executions WHERE task_id=$1`,[taskId])).rows[0]!.count,0);const paused=(await pool.query<{state:string;next_check_at:Date|null;error_code:string;last_processed_fingerprint:string|null;source_dependency_manifest:unknown[]}>(`SELECT state,next_check_at,error_code,last_processed_fingerprint,source_dependency_manifest FROM monitor_tasks WHERE id=$1`,[taskId])).rows[0]!;assert.deepEqual(paused,{state:'paused',next_check_at:null,error_code:'MONITOR_OWNER_UNAUTHORIZED',last_processed_fingerprint:null,source_dependency_manifest:[]});assert.deepEqual((await pool.query<{body:string;state:string}>(`SELECT body,state FROM messages ORDER BY body`)).rows,[{body:'Synthetic published',state:'withdrawn'},{body:'Synthetic scheduled',state:'cancelled'}]);assert.deepEqual((await pool.query<{delivery_state:string}>(`SELECT delivery_state FROM message_display_targets ORDER BY message_id`)).rows,[{delivery_state:'cancelled'},{delivery_state:'cancelled'}]);assert.equal(await queue.enqueueScheduled(),0);
  });
  await fixture();const manualQueue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,{executionProfile:async()=>{throw new DomainError('FORBIDDEN',403);}} as any,()=>now);await assert.rejects(manualQueue.enqueue(actor,taskId,1,'interpretation'),(error:any)=>error.code==='FORBIDDEN');assert.equal((await pool.query<{count:number}>('SELECT count(*)::int count FROM monitor_executions WHERE task_id=$1',[taskId])).rows[0]!.count,0);
});

test('queued interpretation, manual and scheduled work recheck the real AI binding at dispatch',async(t)=>{
  const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  for(const kind of ['interpretation','manual','scheduled'] as const)await t.test(kind,async()=>{
    await fixture();const keyDir=resolve(process.cwd(),`.local/execution-binding-${kind}`);await fs.rm(keyDir,{recursive:true,force:true});let wireCalls=0;const ai=new AiAdminService({keyFile:resolve(keyDir,'master-key'),transport:async()=>{wireCalls++;return new Response('',{status:500});}});await ai.updateSettings(actor.householdId,{enabled:true,provider:'openai_compatible',apiKey:'synthetic-api-key-with-enough-entropy',baseUrl:'http://127.0.0.1:11434/v1',defaultModel:'synthetic-routine',strongModel:'synthetic-strong',defaultReasoningEffort:'none',strongReasoningEffort:'medium',expectedRevision:1});
    if(kind!=='interpretation')await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2,state='active',approved_revision=revision,next_check_at=CASE WHEN $3='scheduled' THEN clock_timestamp()-interval '1 minute' ELSE NULL END WHERE id=$1`,[taskId,JSON.stringify(rule),kind]);
    const fetcher={fetch:async()=>({finalUrl:'https://example.com/plan',contentType:'text/html',title:'Synthetic',headings:['Synthetic answer'],text:'Synthetic answer',fingerprint:'synthetic',fetchedAt:new Date().toISOString(),links:[],evidenceComplete:true,evidenceKind:'web'})} as any;const service=new MonitorService(ai,fetcher);const engine=new MonitorEngine(fetcher,ai);const queue=new MonitorExecutionQueue(service,engine,ai,()=>now);
    if(kind==='scheduled')assert.equal(await queue.enqueueScheduled(),1);else await queue.enqueue(actor,taskId,1,kind);
    const blocker=await pool.connect();let running:Promise<'idle'|'succeeded'|'failed'|'superseded'>|undefined;let blockerFinalized=false;
    try{
      await blocker.query('BEGIN');
      const blockerIdentity=(await blocker.query<{pid:number;database_name:string}>('SELECT pg_backend_pid() pid,current_database() database_name')).rows[0]!;
      assert.equal(blockerIdentity.database_name,'samvev_test');
      const held=await blocker.query('SELECT household_id FROM ai_settings WHERE household_id=$1 FOR UPDATE',[actor.householdId]);
      assert.equal(held.rowCount,1,'the test must hold the exact current AI settings row');
      running=queue.runOne();
      let waiter:{pid:number;query:string}|undefined;const waitDeadline=Date.now()+8_000;
      while(Date.now()<waitDeadline&&wireCalls===0){
        waiter=(await pool.query<{pid:number;query:string}>(`SELECT pid,query FROM pg_stat_activity
          WHERE datname=current_database() AND state='active' AND $1=ANY(pg_blocking_pids(pid))
          AND query ILIKE '%FROM ai_settings WHERE household_id=$1 FOR UPDATE%'
          ORDER BY pid LIMIT 1`,[blockerIdentity.pid])).rows[0];
        if(waiter)break;
        await new Promise((resolve)=>setTimeout(resolve,5));
      }
      const debug=(await pool.query(`SELECT status,error_code,error_details FROM monitor_executions WHERE task_id=$1`,[taskId])).rows;
      const fenceDebug={kind,databaseName:blockerIdentity.database_name,blockerPid:blockerIdentity.pid,heldRows:held.rowCount,waiterPid:waiter?.pid??null,waiterQuery:waiter?.query??null,wireCalls,debug};
      assert.equal(wireCalls,0,`provider transport was reached before the final AI settings fence: ${JSON.stringify(fenceDebug)}`);
      assert.ok(waiter,`real AiAdmin settings authorization did not reach the held FOR UPDATE reservation fence: ${JSON.stringify(fenceDebug)}`);
      assert.notEqual(waiter.pid,blockerIdentity.pid);
      await blocker.query('UPDATE ai_settings SET enabled=false,revision=revision+1 WHERE household_id=$1',[actor.householdId]);
      await blocker.query('COMMIT');blockerFinalized=true;
      assert.equal(await running,'failed');
      assert.equal(wireCalls,0,'provider transport must remain untouched after the fenced configuration change');
    }finally{
      if(!blockerFinalized){
        try{await blocker.query('UPDATE ai_settings SET enabled=false,revision=revision+1 WHERE household_id=$1',[actor.householdId]);await blocker.query('COMMIT');blockerFinalized=true;}
        catch{try{await blocker.query('ROLLBACK');}catch{}}
      }
      blocker.release();
      if(running)await running.catch(()=>undefined);
      await fs.rm(keyDir,{recursive:true,force:true});
    }
    assert.equal(wireCalls,0);const attempts=(await pool.query<{actual_dispatch:boolean;outcome:string}>(`SELECT actual_dispatch,outcome FROM ai_usage_events WHERE household_id=$1`,[actor.householdId])).rows;assert.deepEqual(attempts,[{actual_dispatch:false,outcome:'preflight_rejected'}]);
  });
});

test('lease recovery reconciles a committed terminal run instead of reporting worker interruption',async()=>{
  await fixture();const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2 WHERE id=$1`,[taskId,JSON.stringify(rule)]);const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);const run=await queue.enqueue(actor,taskId,1,'test');await pool.query(`UPDATE monitor_executions SET status='running',started_at=clock_timestamp()-interval '4 minutes',worker_lease_token=gen_random_uuid(),worker_lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[run.id]);const provenance=[{tool:'web.open',requestedUrl:'https://example.com/plan',finalUrl:'https://example.com/plan',contentType:'text/html',fingerprint:'synthetic-fingerprint',fetchedAt:'2026-09-13T12:00:00.000Z',label:'example.com'}];await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,ai_called,ai_call_count,run_kind,result_kind,result,source_url,tool_provenance,execution_id) VALUES($1,1,'changed',true,1,'test','answer',$2,'https://example.com/plan',$3,$4)`,[taskId,JSON.stringify({version:1,answer:'Recovered synthetic result',evidence:{quote:'Recovered synthetic result',sourceUrl:'https://example.com/plan'},confidence:1,uncertainty:null}),JSON.stringify(provenance),run.id]);assert.equal(await queue.runOne(),'idle');const recovered=await queue.get(actor,taskId,run.id);assert.equal(recovered.status,'succeeded');assert.equal((recovered.resultSummary?.result as any).answer,'Recovered synthetic result');assert.equal((recovered.resultSummary?.sources as any[])[0].sourceUrl,'https://example.com/plan');assert.equal(recovered.errorCode,null);
});
