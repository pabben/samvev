import assert from 'node:assert/strict';
import test, {after,before} from 'node:test';
import {roleCapabilityPresets} from '@samvev/contracts';
import {DomainError,tokenHash} from '@samvev/core';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../app.ts';
import {pool} from '../db.ts';
import {migrate} from '../db/migrate.ts';
import {MonitorExecutionQueue,runMonitorExecutionBatch} from './execution.ts';
import {MonitorService} from './service.ts';
import type {MonitorActor} from './service.ts';
import type {MonitorSourceFetcher,SourceDocument} from './source-fetcher.ts';

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

test('durable enqueue returns one stable run, survives request completion and keeps a bounded lease',async()=>{
  await fixture();let resolveWork!:()=>void;let capturedDeadline=0;const work=new Promise<void>((resolve)=>{resolveWork=resolve;});
  const monitors={interpret:async(_actor:MonitorActor,_id:string,_revision:number,options:any)=>{capturedDeadline=options.deadlineMs;await options.observer.progress('analyzing');await work;now+=240_000;return{revision:2};}};
  const engine={runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}};
  const queue=new MonitorExecutionQueue(monitors as any,engine as any,profile,()=>now);
  const enqueued=await queue.enqueue(actor,taskId,1,'interpretation');assert.equal(enqueued.status,'queued');assert.equal(enqueued.usesLocalAi,true);assert.equal(enqueued.expectedDurationSeconds,300);
  const duplicate=await queue.enqueue(actor,taskId,1,'interpretation');assert.equal(duplicate.id,enqueued.id,'double click must join the active execution');
  const runningPromise=queue.runOne();for(let attempt=0;attempt<100;attempt++){const current=await queue.get(actor,taskId,enqueued.id);if(current.status==='running'&&current.progress.stage==='analyzing')break;await new Promise((resolve)=>setTimeout(resolve,5));}
  const running=await queue.get(actor,taskId,enqueued.id);assert.equal(running.status,'running');assert.equal(running.progress.stage,'analyzing');
  const lease=(await pool.query<{remaining:number;max_runtime_ms:number}>(`SELECT (extract(epoch from (worker_lease_expires_at-started_at))*1000)::int AS remaining,max_runtime_ms FROM monitor_executions WHERE id=$1`,[enqueued.id])).rows[0]!;assert.ok(lease.remaining>=lease.max_runtime_ms+59_000);
  assert.equal((await queue.get(actor,taskId,enqueued.id)).id,enqueued.id,'polling after a page refresh does not enqueue work');resolveWork();assert.equal(await runningPromise,'succeeded');
  const completed=await queue.get(actor,taskId,enqueued.id);assert.equal(completed.status,'succeeded');assert.equal(completed.timing?.totalMs,240_000);assert.equal(capturedDeadline,600_000);
});

test('real interpretation service and agent runner accept a provider result after four synthetic minutes',async(t)=>{
  await fixture();await pool.query(`UPDATE monitor_tasks SET instruction='Read the approved synthetic page.',tool_plan='["web.open"]'::jsonb,model_tier='strong' WHERE id=$1`,[taskId]);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-09-13T12:00:00Z')});
  let turn=0;let providerSignal:AbortSignal|undefined;let slowTurnStarted!:()=>void;const slowTurn=new Promise<void>((resolve)=>{slowTurnStarted=resolve;});
  const rule={version:1,resultKind:'answer',summary:'Read the approved synthetic page.',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
  const ai={createTaskSession:async(_household:string,_task:unknown,_policy:unknown,_tools:unknown,_signal:AbortSignal)=>{providerSignal=_signal;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{turn++;if(turn===1)return{toolCalls:[{id:'open',name:'web.open' as const,arguments:{url:'https://example.test/plan'}}],generatedAt:new Date().toISOString()};slowTurnStarted();return new Promise((resolve,reject)=>{const abort=()=>reject(new DomainError('AI_TIMEOUT',504));if(_signal.aborted)return abort();_signal.addEventListener('abort',abort,{once:true});setTimeout(()=>{_signal.removeEventListener('abort',abort);resolve({output:JSON.stringify(rule),toolCalls:[],generatedAt:new Date().toISOString()});},240_000);});}};}};
  const document:SourceDocument={finalUrl:'https://example.test/plan',contentType:'text/html',title:'Synthetic page',headings:['Synthetic heading'],text:'Synthetic heading',fingerprint:'synthetic-v1',fetchedAt:'2026-09-13T12:00:00.000Z',httpStatus:200,byteSize:17,links:[]};
  const fetcher={fetch:async()=>document} as unknown as MonitorSourceFetcher;const service=new MonitorService(ai as any,fetcher);const queue=new MonitorExecutionQueue(service,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>Date.now());
  const run=await queue.enqueue(actor,taskId,1,'interpretation');const completion=queue.runOne();await slowTurn;t.mock.timers.tick(240_000);assert.equal(providerSignal?.aborted,false);assert.equal(await completion,'succeeded');
  const stored=await queue.get(actor,taskId,run.id);assert.equal(stored.status,'succeeded');assert.equal(stored.timing?.totalMs,240_000);assert.equal(turn,2);assert.equal((await pool.query<{revision:number;interpreted_rule:unknown}>('SELECT revision,interpreted_rule FROM monitor_tasks WHERE id=$1',[taskId])).rows[0]!.revision,2);
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

test('lease recovery reconciles a committed terminal run instead of reporting worker interruption',async()=>{
  await fixture();const rule={version:1,resultKind:'answer',summary:'Synthetic answer',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};await pool.query(`UPDATE monitor_tasks SET interpreted_rule=$2 WHERE id=$1`,[taskId,JSON.stringify(rule)]);const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,profile,()=>now);const run=await queue.enqueue(actor,taskId,1,'test');await pool.query(`UPDATE monitor_executions SET status='running',started_at=clock_timestamp()-interval '4 minutes',worker_lease_token=gen_random_uuid(),worker_lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[run.id]);const provenance=[{tool:'web.open',requestedUrl:'https://example.com/plan',finalUrl:'https://example.com/plan',contentType:'text/html',fingerprint:'synthetic-fingerprint',fetchedAt:'2026-09-13T12:00:00.000Z',label:'example.com'}];await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,ai_called,ai_call_count,run_kind,result_kind,result,source_url,tool_provenance,execution_id) VALUES($1,1,'changed',true,1,'test','answer',$2,'https://example.com/plan',$3,$4)`,[taskId,JSON.stringify({version:1,answer:'Recovered synthetic result',evidence:{quote:'Recovered synthetic result',sourceUrl:'https://example.com/plan'},confidence:1,uncertainty:null}),JSON.stringify(provenance),run.id]);assert.equal(await queue.runOne(),'idle');const recovered=await queue.get(actor,taskId,run.id);assert.equal(recovered.status,'succeeded');assert.equal((recovered.resultSummary?.result as any).answer,'Recovered synthetic result');assert.equal((recovered.resultSummary?.sources as any[])[0].sourceUrl,'https://example.com/plan');assert.equal(recovered.errorCode,null);
});
