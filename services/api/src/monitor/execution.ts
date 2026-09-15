import { randomUUID } from 'node:crypto';
import { monitorInterpretationSchema, type AiModelTier, type AiProviderId, type MonitorExecutionKind, type MonitorExecutionProgressStage, type MonitorToolName } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import { pool, transaction, type DbClient } from '../db.ts';
import { AiAdminService } from '../ai/admin-service.ts';
import { MonitorEngine, type MonitorEngineExecutionOptions, type MonitorRunResult } from './engine.ts';
import { monitorExecutionPolicy, MONITOR_EXECUTION_LEASE_MARGIN_MS } from './execution-policy.ts';
import { isScheduleLikeInstruction, routeMonitorInterpretationQuality, routeMonitorQuality } from './quality-router.ts';
import { MonitorService, sanitizedMonitorErrorDetails, type MonitorActor } from './service.ts';
import type { MonitorExecutionObserver, MonitorToolProvenance } from './agent-runner.ts';
import { MET_PUBLIC_FORECAST_URL } from './weather.ts';

interface ExecutionRow {
  id:string;household_id:string;task_id:string;task_revision:number;kind:MonitorExecutionKind;status:'queued'|'running'|'succeeded'|'failed'|'superseded';requested_by_membership_id:string|null;
  provider_snapshot:AiProviderId;ai_settings_revision:number;latency_class:'cloud_standard'|'local_simple'|'local_complex';max_runtime_ms:number;expected_duration_seconds:number;
  progress_stage:MonitorExecutionProgressStage;progress_updated_at:Date;worker_lease_token:string|null;worker_lease_expires_at:Date|null;attempt_count:number;result_summary:Record<string,unknown>|null;error_code:string|null;timeout_reason:string|null;timing:ExecutionTiming;queued_at:Date;started_at:Date|null;completed_at:Date|null;
  error_details:Record<string,unknown>|null;
  required_tools:MonitorToolName[];
}
interface QueueTaskRow {id:string;household_id:string;revision:number;state:'draft'|'active'|'paused';approved_revision:number|null;provider_policy:'default'|'local'|'openai';model_tier:AiModelTier;instruction:string;tool_plan:MonitorToolName[];interpreted_rule:unknown;check_interval_minutes:number;}
export interface ExecutionTiming {queueWaitMs:number;providerTurns:number;toolCalls:number;webOpenMs:number;locationMs:number;weatherMs:number;providerMs:number;totalMs:number;qualityEscalated:boolean;}
export interface MonitorExecutionDto {id:string;taskId:string;taskRevision:number;kind:MonitorExecutionKind;status:ExecutionRow['status'];progress:{stage:MonitorExecutionProgressStage;updatedAt:string};usesLocalAi:boolean;expectedDurationSeconds:number;queuedAt:string;startedAt:string|null;completedAt:string|null;resultSummary:Record<string,unknown>|null;errorCode:string|null;errorDetails:Record<string,unknown>|null;timeoutReason:string|null;timing:ExecutionTiming|null;}

const activeStatuses=`('queued','running')`;
function baseTiming():ExecutionTiming{return{queueWaitMs:0,providerTurns:0,toolCalls:0,webOpenMs:0,locationMs:0,weatherMs:0,providerMs:0,totalMs:0,qualityEscalated:false};}
function dto(row:ExecutionRow):MonitorExecutionDto{return{id:row.id,taskId:row.task_id,taskRevision:row.task_revision,kind:row.kind,status:row.status,progress:{stage:row.progress_stage,updatedAt:row.progress_updated_at.toISOString()},usesLocalAi:row.provider_snapshot==='openai_compatible',expectedDurationSeconds:row.expected_duration_seconds,queuedAt:row.queued_at.toISOString(),startedAt:row.started_at?.toISOString()??null,completedAt:row.completed_at?.toISOString()??null,resultSummary:row.result_summary,errorCode:row.error_code,errorDetails:row.error_details,timeoutReason:row.timeout_reason,timing:['succeeded','failed','superseded'].includes(row.status)?row.timing:null};}
function safeDetails(error:unknown):Record<string,unknown>|null{return sanitizedMonitorErrorDetails(error);}
function safeCode(error:unknown):string{const value=error instanceof DomainError?error.code:'AI_UPSTREAM_ERROR';return/^[A-Z][A-Z0-9_]{1,63}$/.test(value)?value:'AI_UPSTREAM_ERROR';}
function recoveredPublicSources(value:unknown):Array<Record<string,unknown>>{if(!Array.isArray(value))return[];const seen=new Set<string>();return value.flatMap((raw)=>{if(!raw||typeof raw!=='object')return[];const item=raw as MonitorToolProvenance;if(!['web.open','weather.forecast'].includes(item.tool)||typeof item.finalUrl!=='string'||typeof item.fetchedAt!=='string')return[];const sourceUrl=item.tool==='weather.forecast'?MET_PUBLIC_FORECAST_URL:item.finalUrl;try{const normalized=new URL(sourceUrl).toString();if(seen.has(normalized))return[];seen.add(normalized);return[{sourceUrl:normalized,fetchedAt:item.fetchedAt,kind:item.tool==='weather.forecast'?'weather':'web',...(typeof item.label==='string'?{label:item.label}:{}),...(typeof item.attribution==='string'?{attribution:item.attribution}:{}),...(typeof item.canonicalLocation==='string'?{canonicalLocation:item.canonicalLocation}:{}),...(typeof item.validFrom==='string'?{validFrom:item.validFrom}:{}),...(typeof item.validTo==='string'?{validTo:item.validTo}:{}),...(typeof item.forecastUpdatedAt==='string'?{forecastUpdatedAt:item.forecastUpdatedAt}:{})}];}catch{return[];}});}
function stateAllowed(task:QueueTaskRow,kind:MonitorExecutionKind):boolean{return kind==='interpretation'?task.state==='draft':kind==='manual'||kind==='scheduled'?task.state==='active'&&task.approved_revision===task.revision:kind==='test'?task.state==='draft'||task.state==='paused':kind==='smarter'?['draft','active','paused'].includes(task.state):false;}
function qualityFor(task:QueueTaskRow,kind:MonitorExecutionKind):{tier:AiModelTier;scheduleLike:boolean}{
  const tools=task.tool_plan;const scheduleLike=isScheduleLikeInstruction(task.instruction);
  if(kind==='interpretation')return{tier:routeMonitorInterpretationQuality({savedTier:task.model_tier,tools,instruction:task.instruction}).tier,scheduleLike};
  const rule=monitorInterpretationSchema.safeParse(task.interpreted_rule);if(!rule.success)throw new DomainError('MONITOR_SETUP_REQUIRED',422);
  if(kind==='smarter')return{tier:'strong',scheduleLike};
  return{tier:routeMonitorQuality({savedTier:task.model_tier,tools,people:rule.data.people,resultKind:rule.data.resultKind,scheduleLike,conditionalNotification:rule.data.conditionalNotification}).tier,scheduleLike};
}
async function actorForExecution(row:ExecutionRow):Promise<MonitorActor>{
  if(!row.requested_by_membership_id)throw new DomainError('FORBIDDEN',403);
  const actor=(await pool.query<{account_id:string;installation_id:string;capabilities:any}>(`SELECT m.account_id,h.installation_id,m.capabilities FROM memberships m JOIN households h ON h.id=m.household_id JOIN accounts a ON a.id=m.account_id AND a.disabled_at IS NULL WHERE m.id=$1 AND m.household_id=$2`,[row.requested_by_membership_id,row.household_id])).rows[0];
  if(!actor||!Array.isArray(actor.capabilities)||!actor.capabilities.includes('household.manage'))throw new DomainError('FORBIDDEN',403);
  return{accountId:actor.account_id,installationId:actor.installation_id,householdId:row.household_id,membershipId:row.requested_by_membership_id,capabilities:actor.capabilities};
}

export class MonitorExecutionQueue {
  constructor(private readonly monitors:Pick<MonitorService,'interpret'>=new MonitorService(),private readonly engine:Pick<MonitorEngine,'runManual'|'runScheduled'>=new MonitorEngine(),private readonly ai:Pick<AiAdminService,'executionProfile'>=new AiAdminService(),private readonly now=()=>Date.now()){}

  async enqueue(actor:MonitorActor,taskId:string,expectedRevision:number,kind:Exclude<MonitorExecutionKind,'scheduled'>):Promise<MonitorExecutionDto>{return this.enqueueTask(taskId,expectedRevision,kind,actor);}

  private async enqueueTask(taskId:string,expectedRevision:number,kind:MonitorExecutionKind,actor?:MonitorActor):Promise<MonitorExecutionDto>{
    const task=(await pool.query<QueueTaskRow>('SELECT id,household_id,revision,state,approved_revision,provider_policy,model_tier,instruction,tool_plan,interpreted_rule,check_interval_minutes FROM monitor_tasks WHERE id=$1'+(actor?' AND household_id=$2':''),actor?[taskId,actor.householdId]:[taskId])).rows[0];
    if(!task)throw new DomainError('NOT_FOUND',404);if(task.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);if(!stateAllowed(task,kind))throw new DomainError(kind==='interpretation'?'CONFLICT':'MONITOR_SETUP_REQUIRED',kind==='interpretation'?409:422);
    const existing=(await pool.query<ExecutionRow>(`SELECT * FROM monitor_executions WHERE task_id=$1 AND status IN ${activeStatuses} ORDER BY created_at DESC LIMIT 1`,[taskId])).rows[0];if(existing){if(existing.task_revision===expectedRevision&&existing.kind===kind)return dto(existing);throw new DomainError('MONITOR_RUNNING',409);}
    const {tier,scheduleLike}=qualityFor(task,kind);const profile=await this.ai.executionProfile(task.household_id,task.provider_policy);const policy=monitorExecutionPolicy({provider:profile.provider,tier,tools:task.tool_plan,scheduleLike});
    return transaction(async(client)=>{
      const locked=(await client.query<QueueTaskRow>('SELECT id,household_id,revision,state,approved_revision,provider_policy,model_tier,instruction,tool_plan,interpreted_rule,check_interval_minutes FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR UPDATE',[taskId,task.household_id])).rows[0];if(!locked)throw new DomainError('NOT_FOUND',404);if(locked.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);if(!stateAllowed(locked,kind))throw new DomainError('CONFLICT',409);
      const active=(await client.query<ExecutionRow>(`SELECT * FROM monitor_executions WHERE task_id=$1 AND status IN ${activeStatuses} ORDER BY created_at DESC LIMIT 1`,[taskId])).rows[0];if(active){if(active.task_revision===expectedRevision&&active.kind===kind)return dto(active);throw new DomainError('MONITOR_RUNNING',409);}
      const inserted=(await client.query<ExecutionRow>(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,requested_by_membership_id,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,required_tools) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[task.household_id,taskId,expectedRevision,kind,actor?.membershipId??null,profile.provider,profile.settingsRevision,policy.latencyClass,policy.maxRuntimeMs,policy.expectedDurationSeconds,JSON.stringify(task.tool_plan)])).rows[0]!;
      if(actor){
        const synthetic=Boolean((await client.query(`SELECT 1 FROM live_e2e_registrations r JOIN households h ON h.id=r.household_id AND h.data_kind='synthetic' WHERE r.household_id=$1 AND r.account_id=$2 AND r.membership_id=$3`,[actor.householdId,actor.accountId,actor.membershipId])).rowCount);
        await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,$4,'monitor_execution',$5,$6)`,[actor.installationId,actor.householdId,actor.accountId,`monitor.${kind}_queued`,inserted.id,JSON.stringify({taskId,taskRevision:expectedRevision,...(synthetic?{synthetic:true}:{})})]);
      }
      return dto(inserted);
    });
  }

  async get(actor:MonitorActor,taskId:string,executionId:string):Promise<MonitorExecutionDto>{const row=(await pool.query<ExecutionRow>('SELECT * FROM monitor_executions WHERE id=$1 AND task_id=$2 AND household_id=$3',[executionId,taskId,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);return dto(row);}

  async enqueueScheduled(limit=5):Promise<number>{const due=await pool.query<QueueTaskRow>(`SELECT id,household_id,revision,state,approved_revision,provider_policy,model_tier,instruction,tool_plan,interpreted_rule,check_interval_minutes FROM monitor_tasks t WHERE state='active' AND approved_revision=revision AND next_check_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM monitor_executions e WHERE e.task_id=t.id AND e.status IN ${activeStatuses}) ORDER BY next_check_at,id LIMIT $1`,[limit]);let queued=0;for(const task of due.rows){try{await this.enqueueTask(task.id,task.revision,'scheduled');queued++;}catch(error){if(error instanceof DomainError&&['MONITOR_RUNNING','REVISION_CONFLICT'].includes(error.code))continue;if(error instanceof DomainError){await transaction(async(client)=>{const updated=await client.query(`UPDATE monitor_tasks SET check_count=check_count+1,last_checked_at=clock_timestamp(),next_check_at=clock_timestamp()+($4::int*interval '1 minute'),last_result='failed',error_code=$3,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 AND state='active' AND approved_revision=revision AND next_check_at<=clock_timestamp() RETURNING id`,[task.id,task.revision,safeCode(error),task.check_interval_minutes]);if(updated.rowCount)await client.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,error_code,ai_called,ai_call_count,run_kind) VALUES($1,$2,'failed',$3,false,0,'scheduled')`,[task.id,task.revision,safeCode(error)]);});continue;}throw error;}}return queued;}

  async runOne():Promise<'idle'|'succeeded'|'failed'|'superseded'>{
    await this.failInterrupted();const workerToken=randomUUID();const row=await transaction(async(client)=>{
      const selected=(await client.query<ExecutionRow>(`SELECT e.* FROM monitor_executions e WHERE e.status='queued' ORDER BY COALESCE((SELECT max(previous.started_at) FROM monitor_executions previous WHERE previous.household_id=e.household_id AND previous.started_at IS NOT NULL),'-infinity'::timestamptz),e.queued_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1`)).rows[0];if(!selected)return undefined;
      return (await client.query<ExecutionRow>(`UPDATE monitor_executions SET status='running',progress_stage='preparing',progress_updated_at=clock_timestamp(),started_at=COALESCE(started_at,clock_timestamp()),worker_lease_token=$2,worker_lease_expires_at=clock_timestamp()+(($3::int+$4::int)*interval '1 millisecond'),attempt_count=attempt_count+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[selected.id,workerToken,selected.max_runtime_ms,MONITOR_EXECUTION_LEASE_MARGIN_MS])).rows[0];
    });if(!row)return'idle';
    const started=this.now();const timing=baseTiming();timing.queueWaitMs=Math.max(0,started-row.queued_at.getTime());
    let lastProgress:MonitorExecutionProgressStage='preparing';const observer:MonitorExecutionObserver={
      progress:async(stage)=>{if(stage===lastProgress)return;lastProgress=stage;await pool.query(`UPDATE monitor_executions SET progress_stage=$3,progress_updated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status='running' AND worker_lease_token=$2`,[row.id,workerToken,stage]);},
      providerTurn:(duration)=>{timing.providerTurns++;timing.providerMs+=Math.max(0,duration);},
      tool:(name,duration,details)=>{timing.toolCalls++;if(name==='web.open')timing.webOpenMs+=Math.max(0,duration);else{timing.weatherMs+=Math.max(0,details?.weatherMs??duration);timing.locationMs+=Math.max(0,details?.locationMs??0);}}
    };
    try{
      const settings=await this.ai.executionProfile(row.household_id,(await pool.query<{provider_policy:'default'|'local'|'openai'}>('SELECT provider_policy FROM monitor_tasks WHERE id=$1',[row.task_id])).rows[0]?.provider_policy??'default');
      if(settings.provider!==row.provider_snapshot||settings.settingsRevision!==row.ai_settings_revision)throw new DomainError('AI_CONFIGURATION_INVALID',422);
      const options:MonitorEngineExecutionOptions={deadlineMs:row.max_runtime_ms,leaseMs:row.max_runtime_ms+MONITOR_EXECUTION_LEASE_MARGIN_MS,expectedProvider:row.provider_snapshot,observer,executionId:row.id};let result:Record<string,unknown>|MonitorRunResult|string;
      if(row.kind==='interpretation')result=await this.monitors.interpret(await actorForExecution(row),row.task_id,row.task_revision,options);
      else if(row.kind==='scheduled')result=await this.engine.runScheduled(row.task_id,row.task_revision,options);
      else result=await this.engine.runManual(await actorForExecution(row),row.task_id,row.task_revision,row.kind,options);
      await observer.progress('finalizing');timing.totalMs=Math.max(0,this.now()-started);timing.qualityEscalated=Boolean((await pool.query(`SELECT 1 FROM monitor_quality_audits WHERE execution_id=$1 AND outcome='escalated' LIMIT 1`,[row.id])).rowCount);
      const outcome=typeof result==='string'?result:(result as any).outcome??'changed';
      if(outcome==='failed'){
        const linked=(await pool.query<{error_code:string|null;error_details:Record<string,unknown>|null}>(`SELECT error_code,error_details FROM monitor_runs WHERE execution_id=$1 ORDER BY checked_at DESC,id DESC LIMIT 1`,[row.id])).rows[0];
        const code=linked?.error_code&&/^[A-Z][A-Z0-9_]{1,63}$/.test(linked.error_code)?linked.error_code:'AI_UPSTREAM_ERROR';
        const timeoutReason=code==='AI_TIMEOUT'?(timing.totalMs>=row.max_runtime_ms-1000?'server_deadline':'provider_timeout'):null;
        await this.finish(row,workerToken,'failed',null,code,linked?.error_details??null,timing,timeoutReason);await this.linkTerminalRun(row);return'failed';
      }
      const terminal=outcome==='superseded'?'superseded':'succeeded';const summary=typeof result==='object'&&result!==null&&'outcome' in result?result as Record<string,unknown>:{outcome};await this.finish(row,workerToken,terminal,summary,null,null,timing,null);await this.linkTerminalRun(row);return terminal;
    }catch(error){timing.totalMs=Math.max(0,this.now()-started);timing.qualityEscalated=Boolean((await pool.query(`SELECT 1 FROM monitor_quality_audits WHERE execution_id=$1 AND outcome='escalated' LIMIT 1`,[row.id])).rowCount);const code=safeCode(error);const timeoutReason=code==='AI_TIMEOUT'?(timing.totalMs>=row.max_runtime_ms-1000?'server_deadline':'provider_timeout'):null;const terminal=['REVISION_CONFLICT','CONFLICT'].includes(code)?'superseded':'failed';await this.finish(row,workerToken,terminal,null,code,safeDetails(error),timing,timeoutReason);await this.linkTerminalRun(row);return terminal;}
  }

  private async finish(row:ExecutionRow,token:string,status:'succeeded'|'failed'|'superseded',summary:Record<string,unknown>|null,errorCode:string|null,errorDetails:Record<string,unknown>|null,timing:ExecutionTiming,timeoutReason:string|null):Promise<void>{await pool.query(`UPDATE monitor_executions SET status=$3,progress_stage='finalizing',progress_updated_at=clock_timestamp(),result_summary=$4,error_code=$5,error_details=$6,timeout_reason=$7,timing=$8,completed_at=clock_timestamp(),worker_lease_token=NULL,worker_lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status='running' AND worker_lease_token=$2`,[row.id,token,status,summary,errorCode,errorDetails,timeoutReason,JSON.stringify(timing)]);}
  private async linkTerminalRun(row:ExecutionRow):Promise<void>{if(row.kind==='interpretation')return;await pool.query(`UPDATE monitor_runs SET execution_id=$1 WHERE id=(SELECT id FROM monitor_runs WHERE task_id=$2 AND task_revision=$3 AND run_kind=$4 AND execution_id IS NULL AND checked_at>=$5 ORDER BY checked_at DESC,id DESC LIMIT 1)`,[row.id,row.task_id,row.task_revision,row.kind,row.started_at??row.queued_at]);}
  private async failInterrupted():Promise<void>{await transaction(async(client)=>{
    const expired=await client.query<ExecutionRow>(`SELECT * FROM monitor_executions WHERE status='running' AND worker_lease_expires_at<clock_timestamp() FOR UPDATE`);
    for(const item of expired.rows){
      const expectedRunKind=item.kind==='manual'?'manual':item.kind;
      const run=item.kind==='interpretation'?undefined:(await client.query<{outcome:'changed'|'unchanged'|'failed'|'superseded';error_code:string|null;error_details:Record<string,unknown>|null;result_kind:'answer'|'events'|null;result:Record<string,unknown>|null;source_url:string|null;tool_provenance:unknown;checked_at:Date}>(`SELECT outcome,error_code,error_details,result_kind,result,source_url,tool_provenance,checked_at FROM monitor_runs WHERE execution_id=$1 AND task_id=$2 AND task_revision=$3 AND run_kind=$4 ORDER BY checked_at DESC,id DESC LIMIT 1`,[item.id,item.task_id,item.task_revision,expectedRunKind])).rows[0];
      const interpretation=item.kind==='interpretation'?(await client.query<{outcome:'success'|'failed';error_code:string|null;error_details:Record<string,unknown>|null;created_at:Date}>(`SELECT outcome,error_code,error_details,created_at FROM monitor_tool_audits WHERE execution_id=$1 AND task_id=$2 AND task_revision=$3 AND phase='interpretation' ORDER BY created_at DESC,id DESC LIMIT 1`,[item.id,item.task_id,item.task_revision])).rows[0]:undefined;
      if(run){const status=run.outcome==='failed'?'failed':run.outcome==='superseded'?'superseded':'succeeded';const summary=status==='succeeded'?{outcome:run.outcome,resultKind:run.result_kind,result:run.result,sourceUrl:run.source_url,checkedAt:run.checked_at.toISOString(),sources:recoveredPublicSources(run.tool_provenance)}:null;const totalMs=Math.max(0,run.checked_at.getTime()-(item.started_at?.getTime()??run.checked_at.getTime()));const timeoutReason=run.error_code==='AI_TIMEOUT'?(totalMs>=item.max_runtime_ms-1000?'server_deadline':'provider_timeout'):null;await client.query(`UPDATE monitor_executions SET status=$2,result_summary=$3,error_code=$4,error_details=$5,timeout_reason=$6,timing=$7,completed_at=$8,worker_lease_token=NULL,worker_lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,[item.id,status,summary,run.error_code,run.error_details,timeoutReason,JSON.stringify({...item.timing,totalMs}),run.checked_at]);}
      else if(interpretation){const status=interpretation.outcome==='success'?'succeeded':'failed';const code=status==='failed'?(interpretation.error_code??'AI_UPSTREAM_ERROR'):null;const totalMs=Math.max(0,interpretation.created_at.getTime()-(item.started_at?.getTime()??interpretation.created_at.getTime()));const timeoutReason=code==='AI_TIMEOUT'?(totalMs>=item.max_runtime_ms-1000?'server_deadline':'provider_timeout'):null;await client.query(`UPDATE monitor_executions SET status=$2,result_summary=$3,error_code=$4,error_details=$5,timeout_reason=$6,timing=$7,completed_at=$8,worker_lease_token=NULL,worker_lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,[item.id,status,status==='succeeded'?{outcome:'changed'}:null,code,status==='failed'?interpretation.error_details:null,timeoutReason,JSON.stringify({...item.timing,totalMs}),interpretation.created_at]);}
      else await client.query(`UPDATE monitor_executions SET status='failed',error_code='MONITOR_WORKER_INTERRUPTED',timeout_reason='worker_interrupted',timing=jsonb_set(timing,'{totalMs}',to_jsonb(GREATEST(0,(extract(epoch from (clock_timestamp()-started_at))*1000)::int))),completed_at=clock_timestamp(),worker_lease_token=NULL,worker_lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,[item.id]);
      await client.query('UPDATE monitor_tasks SET lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_expires_at<clock_timestamp()',[item.task_id]);
    }
  });}
}

export interface MonitorExecutionBatchResult {scheduledQueued:number;claimed:number;succeeded:number;failed:number;superseded:number;}
export async function runMonitorExecutionBatch(limit=1,queue=new MonitorExecutionQueue()):Promise<MonitorExecutionBatchResult>{const result={scheduledQueued:await queue.enqueueScheduled(Math.max(5,limit)),claimed:0,succeeded:0,failed:0,superseded:0};for(let i=0;i<limit;i++){const outcome=await queue.runOne();if(outcome==='idle')break;result.claimed++;result[outcome]++;}return result;}
