import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {AiAdminService} from './ai/admin-service.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {roleCapabilityPresets,type AiTask} from '@samvev/contracts';
import {DomainError} from '@samvev/core';
import {MonitorService,sanitizedMonitorErrorDetails} from './monitor/service.ts';
import {MonitorAgentRunner} from './monitor/agent-runner.ts';
import {MonitorExecutionQueue} from './monitor/execution.ts';

const guard=new URL(process.env.DATABASE_URL??'');assert.equal(guard.hostname,'test-db');assert.equal(guard.pathname,'/samvev_test');
const keyDir=resolve('.local/r14-fallback-test');
const task:AiTask={operation:'generate',purpose:'synthetic_r14',input:'Synthetic only',modelTier:'routine',sources:[]};
let ai:AiAdminService;let calls:Array<{url:string;body:any}>=[];let handler:(url:string,body:any)=>Promise<Response>;
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status});}
function success(url:string,body:any){return url.includes('anthropic')?json({model:body.model,stop_reason:'end_turn',content:[{type:'text',text:'OK'}],usage:{input_tokens:3,output_tokens:1}}):json({status:'completed',model:body.model,service_tier:'standard',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:3,output_tokens:1}});}
before(async()=>{await migrate();ai=new AiAdminService({keyFile:resolve(keyDir,'key'),transport:async(url,init)=>{const body=JSON.parse(String(init.body));calls.push({url,body});return handler(url,body);}});});
after(async()=>{await pool.end();await fs.rm(keyDir,{recursive:true,force:true});});
async function fixture(){
 await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');calls=[];handler=async(url,body)=>success(url,body);
 const installation=(await pool.query<{id:string}>("INSERT INTO installations(claimed_at,setup_step) VALUES(clock_timestamp(),'complete') RETURNING id")).rows[0]!.id;
 const household=(await pool.query<{id:string}>("INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic fallback household','Europe/Oslo','en') RETURNING id",[installation])).rows[0]!.id;
 await ai.updateSettings(household,{provider:'anthropic',apiKey:'synthetic-reserve-key',defaultModel:'claude-haiku-5-5',strongModel:'claude-haiku-5-5',expectedRevision:0});
 await ai.updateSettings(household,{provider:'openai',enabled:true,apiKey:'synthetic-primary-api-key-not-real',defaultModel:'synthetic-primary',strongModel:'synthetic-strong',expectedRevision:1});
 return household;
}
async function policy(h:string,patch:any){const rev=(await ai.settings(h)).revision as number;return ai.updateSettings(h,{...patch,expectedRevision:rev});}
async function next(h:string,context:any={}){const session=await ai.createTaskSession(h,task,'default',[],undefined,'analysis',context);try{return await session.next();}finally{session.close();}}

test('migration defaults off; explicit distinct configured reserve and revision-safe settings preserve secrets',async()=>{
 const h=await fixture();let settings=await ai.settings(h);assert.equal(settings.fallbackProvider,null);assert.equal(settings.dailyDispatchLimit,null);
 assert.equal(JSON.stringify(settings).includes('synthetic-reserve-key'),false);
 await assert.rejects(policy(h,{fallbackProvider:'openai'}),(e:any)=>e.code==='AI_CONFIGURATION_INVALID');
 await assert.rejects(policy(h,{fallbackProvider:'openai_compatible'}),(e:any)=>e.code==='AI_CONFIGURATION_INVALID');
 settings=await policy(h,{fallbackProvider:'anthropic',dailyDispatchLimit:10});assert.equal(settings.fallbackConfigurationRevision,1);
 await assert.rejects(ai.updateSettings(h,{dailyDispatchLimit:20,expectedRevision:1}),(e:any)=>e.code==='REVISION_CONFLICT');
 await assert.rejects(policy(h,{provider:'anthropic'}),(e:any)=>e.code==='AI_CONFIGURATION_INVALID');
 await policy(h,{provider:'anthropic',fallbackProvider:null});assert.equal((await ai.settings(h)).hasApiKey,true);
});

test('fallback defaults off and explicit transient first attempt records both actual providers and reason',async()=>{
 const h=await fixture();handler=async(url,body)=>url.includes('openai.com')?json({error:{type:'server_error'}},503):success(url,body);
 await assert.rejects(next(h),(e:any)=>e.code==='AI_UPSTREAM_ERROR');assert.equal(calls.length,1);
 await policy(h,{fallbackProvider:'anthropic'});const s=await ai.createTaskSession(h,task);assert.equal((await s.next()).output,'OK');assert.equal(s.provider,'anthropic');assert.equal(s.physicalAttempts,2);assert.equal(s.usedFallback,true);s.close();
 const rows=(await pool.query('SELECT provider,requested_model,actual_model,fallback_from_provider,fallback_reason,actual_dispatch FROM ai_usage_events WHERE household_id=$1 ORDER BY occurred_at,id',[h])).rows;
 assert.equal(rows.length,3);assert.equal(rows[1].provider,'openai');assert.equal(rows[2].provider,'anthropic');assert.equal(rows[2].fallback_from_provider,'openai');assert.equal(rows[2].fallback_reason,'transient');assert.equal(rows[2].actual_model,'claude-haiku-5-5');assert.ok(rows.every(r=>r.actual_dispatch));
 const usage=await ai.usage(h);assert.equal((usage.recent as any[])[0].fallbackReason,'transient');
});

test('auth billing model unknown rate malformed replies and caller abort never dispatch reserve',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});
 const cases:Array<()=>Promise<Response>>=[()=>Promise.resolve(json({error:{type:'authentication_error'}},401)),()=>Promise.resolve(json({error:{code:'insufficient_quota'}},429)),()=>Promise.resolve(json({error:{code:'model_not_found'}},404)),()=>Promise.resolve(json({error:{type:'unrecognized'}},429)),()=>Promise.resolve(new Response('malformed',{status:503})),()=>Promise.resolve(json({status:'completed',output:[]})),()=>Promise.reject(new Error('unclassified local failure'))];
 for(const failure of cases){calls=[];handler=async()=>failure();await assert.rejects(next(h));assert.equal(calls.length,1);}
 const controller=new AbortController();handler=async()=>{controller.abort();throw new TypeError('synthetic network after caller abort');};calls=[];
 const s=await ai.createTaskSession(h,task,'default',[],controller.signal);await assert.rejects(s.next());s.close();assert.equal(calls.length,1);
});

test('only proven rate or transport errors can fallback, fixed task policies never broaden',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});
 for(const rate of [false,true]){calls=[];handler=async(url,body)=>url.includes('openai.com')?(rate?json({error:{code:'rate_limit_exceeded'}},429):Promise.reject(new TypeError('synthetic transport'))):success(url,body);assert.equal((await next(h)).output,'OK');assert.equal(calls.length,2);}
 calls=[];const fixed=await ai.createTaskSession(h,task,'openai');await assert.rejects(fixed.next());fixed.close();assert.equal(calls.length,1);
});

test('fallback never starts after a successful tool turn, and fresh reserve starts with no transplanted history',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});
 let step=0;handler=async(url,body)=>{step++;if(step===1)return json({error:{type:'server_error'}},503);assert.equal(body.messages.length,1);return json({model:body.model,stop_reason:'tool_use',content:[{type:'tool_use',id:'call_synthetic',name:body.tools[0].name,input:{}}]});};
 const s=await ai.createTaskSession(h,task,'default',[{name:'synthetic.tool',description:'Synthetic',inputSchema:{type:'object',properties:{},additionalProperties:false}}]);
 const first=await s.next();assert.equal(first.toolCalls[0]?.name,'synthetic.tool');assert.equal(s.provider,'anthropic');handler=async()=>json({error:{type:'overloaded_error'}},529);await assert.rejects(s.next([{callId:'call_synthetic',name:'synthetic.tool',output:'Synthetic'}]));assert.equal(calls.length,3);s.close();
 calls=[];handler=async(_url,body)=>json({status:'completed',model:body.model,output:[{type:'function_call',call_id:'first',name:body.tools[0].name,arguments:'{}'}]});
 const primary=await ai.createTaskSession(h,task,'default',[{name:'synthetic.tool',description:'Synthetic',inputSchema:{type:'object',properties:{},additionalProperties:false}}]);await primary.next();handler=async()=>json({error:{type:'server_error'}},503);await assert.rejects(primary.next([{callId:'first',name:'synthetic.tool',output:'Synthetic'}]));assert.equal(primary.usedFallback,false);assert.equal(calls.length,2);primary.close();
});

test('daily cap atomically reserves concurrent calls, counts tests and reserve second dispatch',async()=>{
 const h=await fixture();await policy(h,{dailyDispatchLimit:1});const results=await Promise.allSettled([next(h),next(h),next(h)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls.length,1);assert.ok(results.filter(r=>r.status==='rejected').every(r=>(r as PromiseRejectedResult).reason.code==='AI_DAILY_DISPATCH_LIMIT'));
 const settings=await ai.settings(h);assert.equal((settings.dailyDispatchUsage as any).reservedDispatches,1);assert.equal((settings.dailyDispatchUsage as any).remainingDispatches,0);
 assert.equal((await ai.testConnection(h,'routine')).errorCode,'AI_DAILY_DISPATCH_LIMIT');assert.equal(calls.length,1);
 await pool.query('DELETE FROM ai_usage_events WHERE household_id=$1',[h]);await policy(h,{fallbackProvider:'anthropic'});handler=async()=>json({error:{type:'server_error'}},503);calls=[];const limited=await ai.createTaskSession(h,task);await assert.rejects(limited.next(),(e:any)=>e.code==='AI_DAILY_DISPATCH_LIMIT');assert.equal(limited.physicalAttempts,1);limited.close();assert.equal(calls.length,1);const reservePreflight=(await pool.query("SELECT provider,actual_dispatch,outcome,fallback_reason FROM ai_usage_events WHERE household_id=$1 AND provider='anthropic'",[h])).rows;assert.deepEqual(reservePreflight,[{provider:'anthropic',actual_dispatch:false,outcome:'preflight_rejected',fallback_reason:'transient'}]);assert.equal((await ai.settings(h)).dailyDispatchLimit,1);
});

test('unfinished and legacy unknown dispatches consume cap; previous UTC day does not',async()=>{
 const h=await fixture();await policy(h,{dailyDispatchLimit:1});
 await pool.query("INSERT INTO ai_usage_events(household_id,provider,operation,purpose,success,actual_dispatch,outcome) VALUES($1,'openai','generate','synthetic_pending',false,NULL,'started')",[h]);await assert.rejects(next(h),(e:any)=>e.code==='AI_DAILY_DISPATCH_LIMIT');assert.equal(calls.length,0);
 await pool.query("UPDATE ai_usage_events SET outcome=NULL WHERE purpose='synthetic_pending'");await assert.rejects(next(h),(e:any)=>e.code==='AI_DAILY_DISPATCH_LIMIT');
 await pool.query("UPDATE ai_usage_events SET occurred_at=(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second' WHERE purpose='synthetic_pending'");assert.equal((await next(h)).output,'OK');
});

test('proven prewire abort releases reservation; missing stale task or worker leases reject without transport',async()=>{
 const h=await fixture();await policy(h,{dailyDispatchLimit:1});const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT 1 FROM ai_settings WHERE household_id=$1 FOR UPDATE',[h]);
 const c=new AbortController();const s=await ai.createTaskSession(h,task,'default',[],c.signal);const promise=s.next();await new Promise(r=>setTimeout(r,25));c.abort();await lock.query('ROLLBACK');lock.release();await assert.rejects(promise);s.close();assert.equal(calls.length,0);assert.equal((await next(h)).output,'OK');
 await pool.query('DELETE FROM ai_usage_events WHERE household_id=$1',[h]);
 const account=(await pool.query<{id:string}>("INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,'lease@test.invalid','synthetic','en','system' FROM households WHERE id=$1 RETURNING id",[h])).rows[0]!.id;
 const person=(await pool.query<{id:string}>("INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic owner','adult') RETURNING id",[h])).rows[0]!.id;
 const m=(await pool.query<{id:string}>("INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin','[\"household.manage\"]') RETURNING id",[h,account,person])).rows[0]!.id;
 const lease=randomUUID();const t=(await pool.query<{id:string}>("INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,lease_token,lease_expires_at) VALUES($1,$2,'Synthetic lease','Synthetic instruction','https://example.invalid','[\"web.open\"]',60,1,'18:00','default','routine',$3,clock_timestamp()+interval '1 minute') RETURNING id",[h,m,lease])).rows[0]!.id;
 for(const context of [{taskId:t,taskRevision:1,category:'setup'},{taskId:t,taskRevision:1,category:'setup',taskLeaseToken:randomUUID()},{taskId:t,taskRevision:1,category:'setup',taskLeaseToken:lease,executionId:randomUUID()}])await assert.rejects(next(h,context),(e:any)=>e.code==='AI_CONFIGURATION_INVALID');assert.equal(calls.length,1);
 await pool.query("UPDATE monitor_tasks SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[t]);await assert.rejects(next(h,{taskId:t,taskRevision:1,category:'setup',taskLeaseToken:lease}));assert.equal(calls.length,1);
});

test('queue snapshots pin reserve revision, edits supersede before dispatch, old queue snapshot disables fallback',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});const profile=await ai.executionProfile(h);
 const person=(await pool.query<{id:string}>("INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic queue owner','adult') RETURNING id",[h])).rows[0]!.id;
 const account=(await pool.query<{id:string}>("INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,'queue@test.invalid','synthetic','en','system' FROM households WHERE id=$1 RETURNING id",[h])).rows[0]!.id;
 const membership=(await pool.query<{id:string}>("INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin','[\"household.manage\"]') RETURNING id",[h,account,person])).rows[0]!.id;
 const t=(await pool.query<{id:string}>("INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier) VALUES($1,$2,'Synthetic queue pin','Synthetic instruction','https://example.invalid','[\"web.open\"]',60,1,'18:00','default','routine') RETURNING id",[h,membership])).rows[0]!.id;
 const unchanged=(await pool.query('SELECT instruction,check_interval_minutes,next_check_at,revision,approved_revision FROM monitor_tasks WHERE id=$1',[t])).rows[0];
 const installation=(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[h])).rows[0]!.installation_id;
 const queue=new MonitorExecutionQueue(undefined,undefined,ai);const enqueued=await queue.enqueue({householdId:h,installationId:installation,accountId:account,membershipId:membership,capabilities:['household.manage']},t,1,'interpretation');
 assert.deepEqual((await pool.query('SELECT provider_snapshot,ai_provider_configuration_revision,fallback_provider_snapshot,fallback_configuration_revision FROM monitor_executions WHERE id=$1',[enqueued.id])).rows[0],{provider_snapshot:'openai',ai_provider_configuration_revision:profile.configurationRevision,fallback_provider_snapshot:'anthropic',fallback_configuration_revision:1});
assert.equal(profile.fallbackProvider,'anthropic');assert.equal(profile.fallbackConfigurationRevision,1);
 const bound=await ai.createTaskSession(h,task,'default',[],undefined,'analysis',{expectedProvider:profile.provider,expectedSettingsRevision:profile.settingsRevision,expectedConfigurationRevision:profile.configurationRevision,expectedFallbackProvider:profile.fallbackProvider,expectedFallbackConfigurationRevision:profile.fallbackConfigurationRevision});
 await pool.query("UPDATE ai_provider_configurations SET revision=revision+1 WHERE household_id=$1 AND provider='anthropic'",[h]);handler=async()=>json({error:{type:'server_error'}},503);await assert.rejects(bound.next(),(e:any)=>e.code==='AI_CONFIGURATION_INVALID');bound.close();assert.equal(calls.length,0,'reserve change blocks the pinned execution before either paid dispatch');
 assert.deepEqual((await pool.query('SELECT instruction,check_interval_minutes,next_check_at,revision,approved_revision FROM monitor_tasks WHERE id=$1',[t])).rows[0],unchanged);
 await assert.rejects(ai.createTaskSession(h,task,'default',[],undefined,'analysis',{expectedFallbackProvider:null}),(e:any)=>e.code==='AI_CONFIGURATION_INVALID');
});

 test('agent counts both physical attempts while returning the actual reserve route',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});handler=async(url,body)=>url.includes('openai.com')?json({error:{type:'server_error'}},503):success(url,body);
 const agent=new MonitorAgentRunner(ai);const result=await agent.run({householdId:h,task,policy:'default',toolNames:['web.open'],rootUrl:'https://example.invalid/source',requiredTools:[]});assert.equal(result.aiCalls,2);assert.equal(result.provider,'anthropic');assert.equal(result.model,'claude-haiku-5-5');
 calls=[];const repair=await ai.createTaskSession(h,task,'default',[],undefined,'format_repair');await assert.rejects(repair.next());assert.equal(calls.length,1,'format repair never starts a new fallback cycle');repair.close();
 await policy(h,{dailyDispatchLimit:1});calls=[];await assert.rejects(agent.run({householdId:h,task,policy:'default',toolNames:['web.open'],rootUrl:'https://example.invalid/source',requiredTools:[]}),(error:any)=>error.code==='AI_DAILY_DISPATCH_LIMIT'&&error.details.aiCalls===0);assert.equal(calls.length,0,'a prewire local-cap rejection records zero physical AI calls');
 });

test('reserve open failure records unwired reserve preflight and safe selected-route metadata',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});await pool.query("UPDATE ai_provider_configurations SET api_key_ciphertext='synthetic-invalid-ciphertext' WHERE household_id=$1 AND provider='anthropic'",[h]);
 handler=async()=>json({error:{type:'server_error'}},503);const session=await ai.createTaskSession(h,task);
 await assert.rejects(session.next(),(error:any)=>{assert.equal(error.code,'AI_CONFIGURATION_INVALID');assert.deepEqual(sanitizedMonitorErrorDetails(error),{provider:'anthropic',fallbackFromProvider:'openai',fallbackReason:'transient',actualDispatch:false});return true;});assert.equal(session.physicalAttempts,1);assert.equal(calls.length,1);session.close();
 assert.deepEqual((await pool.query('SELECT provider,actual_dispatch,outcome,fallback_reason FROM ai_usage_events WHERE household_id=$1 ORDER BY occurred_at,id',[h])).rows,[{provider:'openai',actual_dispatch:true,outcome:'failed',fallback_reason:null},{provider:'anthropic',actual_dispatch:false,outcome:'preflight_rejected',fallback_reason:'transient'}]);
 const safe=sanitizedMonitorErrorDetails(new DomainError('AI_UPSTREAM_ERROR',502,{provider:'malicious-private-provider',fallbackFromProvider:'secret',fallbackReason:'raw-secret',actualDispatch:'unknown',apiKey:'synthetic-private-key',message:'raw upstream detail'}));assert.equal(safe,null);
});

test('real reserve malformed interpretation stops before fresh repair and leaves draft instructions unapproved',async()=>{
 const h=await fixture();await policy(h,{fallbackProvider:'anthropic'});
 const installation=(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[h])).rows[0]!.installation_id;
 const person=(await pool.query<{id:string}>("INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic repair owner','adult') RETURNING id",[h])).rows[0]!.id;
 const account=(await pool.query<{id:string}>("INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'repair@test.invalid','synthetic','en','system') RETURNING id",[installation])).rows[0]!.id;
 const membership=(await pool.query<{id:string}>("INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id",[h,account,person,JSON.stringify(roleCapabilityPresets.household_admin)])).rows[0]!.id;
 const actor={householdId:h,installationId:installation,accountId:account,membershipId:membership,capabilities:[...roleCapabilityPresets.household_admin]};
 let sourceCalls=0;const fetcher={fetch:async()=>{sourceCalls++;throw new Error('unexpected source fetch');}} as any;const service=new MonitorService(ai,fetcher);
 const instruction='Read the synthetic source at https://example.invalid/source and summarize updates.';const created=await service.create(actor,{instruction,checkIntervalMinutes:60,noticeDaysBefore:0,noticeLocalTime:'18:00',targets:{personIds:[person],displayIds:[]}}) as any;
 const before=(await pool.query('SELECT instruction,check_interval_minutes,revision,approved_revision,next_check_at FROM monitor_tasks WHERE id=$1',[created.id])).rows[0];
 handler=async(url,body)=>url.includes('openai.com')?json({error:{type:'server_error'}},503):json({model:body.model,stop_reason:'end_turn',content:[{type:'text',text:'{"version":'}],usage:{input_tokens:3,output_tokens:2}});
 await assert.rejects(service.interpret(actor,created.id,created.revision),(error:any)=>error.code==='AI_RESPONSE_INVALID'&&error.details.provider==='anthropic');
 assert.equal(calls.length,2,'reserve malformed output cannot restart primary or create a fresh repair session');assert.deepEqual(calls.map(c=>c.url),['https://api.openai.com/v1/responses','https://api.anthropic.com/v1/messages']);assert.equal(sourceCalls,0);
 const persisted=(await pool.query('SELECT instruction,check_interval_minutes,revision,approved_revision,next_check_at,state,interpreted_rule FROM monitor_tasks WHERE id=$1',[created.id])).rows[0];assert.deepEqual(persisted,{...before,state:'draft',interpreted_rule:null});assert.equal((await pool.query('SELECT count(*)::int count FROM messages WHERE household_id=$1',[h])).rows[0].count,0);assert.equal((await pool.query('SELECT count(*)::int count FROM monitor_quality_audits WHERE task_id=$1',[created.id])).rows[0].count,0);
});
