import { randomUUID } from 'node:crypto';
import {
  monitorAnswerSchema, monitorExtractionSchema, monitorInterpretationSchema,
  monitorTaskActions, monitorTaskCreateSchema, monitorTaskUpdateSchema, type AiModelTier, type Capability,
  type MonitorActionBlockReason, type MonitorProviderPolicy, type MonitorTaskAction, type MonitorTaskLifecycle, type MonitorToolName
} from '@samvev/contracts';
import { DomainError, requireCapability } from '@samvev/core';
import type pg from 'pg';
import { z, type ZodType } from 'zod';
import { pool, transaction, type DbClient } from '../db.ts';
import { AiAdminService } from '../ai/admin-service.ts';
import { MONITOR_AGENT_DEADLINE_MS, MONITOR_LEASE_MS, MonitorAgentRunner, type MonitorAgentResult, type MonitorToolAttempt, type MonitorToolProvenance } from './agent-runner.ts';
import { MonitorSourceFetcher, normalizeMonitorUrl, sourceUrlFromInstruction, type SourceDocument } from './source-fetcher.ts';
import { MetWeatherClient } from './weather.ts';
import { isConditionalInstruction, remainingEscalationBudget, routeMonitorInterpretationQuality, type MonitorQualityReason } from './quality-router.ts';

export interface MonitorActor { accountId:string; installationId:string; householdId:string; membershipId:string; capabilities:Capability[]; }
type Targets={personIds:string[];displayIds:string[]};

export function monitorJsonObject(text:string,invalidCode='MONITOR_INTERPRETATION_INVALID'):unknown {
  const trimmed=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(trimmed);}catch{throw new DomainError(invalidCode,502);}
}
const MAX_MONITOR_OUTPUT_CHARS=32_000;
const MAX_JSON_CANDIDATES=512;
function balancedObjectCandidates(text:string):string[]{
  const starts:number[]=[];for(let index=0;index<text.length;index++)if(text[index]==='{')starts.push(index);
  const candidates:Array<{start:number;end:number;text:string}>=[];
  for(const start of starts.slice(-MAX_JSON_CANDIDATES)){
    let depth=0;let inString=false;let escaped=false;
    for(let index=start;index<text.length;index++){
      const char=text[index]!;
      if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;continue;}
      if(char==='"'){inString=true;continue;}if(char==='{')depth++;else if(char==='}'&&--depth===0){candidates.push({start,end:index,text:text.slice(start,index+1)});break;}
    }
  }
  return candidates.sort((left,right)=>right.end-left.end||left.start-right.start).map((candidate)=>candidate.text);
}
function schemaMonitorJsonDetailed<T>(text:string,schema:ZodType<T>,invalidCode:string):{data:T;raw:unknown}{
  if(text.length>MAX_MONITOR_OUTPUT_CHARS)throw new DomainError(invalidCode,502);
  const trimmed=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{const raw=JSON.parse(trimmed);const exact=schema.safeParse(raw);if(exact.success)return{data:exact.data,raw};}catch{/* bounded candidate recovery below */}
  for(const candidate of balancedObjectCandidates(text)){
    try{const raw=JSON.parse(candidate);const parsed=schema.safeParse(raw);if(parsed.success)return{data:parsed.data,raw};}catch{/* try the next balanced object */}
  }
  throw new DomainError(invalidCode,502);
}
function schemaMonitorJson<T>(text:string,schema:ZodType<T>,invalidCode:string):T{return schemaMonitorJsonDetailed(text,schema,invalidCode).data;}
export function interpretationRefusesSourceAccess(summary:string):boolean{
  const value=summary.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
  return /\b(?:i (?:cannot|can't|can not|am unable to|do not have|don't have) (?:access|browse|open|fetch|visit)|without (?:direct )?(?:web|internet|browser|network) access.{0,48}(?:cannot|can't|can not|unable))\b/.test(value)
    || /\b(?:jeg|ki(?:-en)?) (?:kan ikke|klarer ikke|har ikke|mangler).{0,48}(?:hente|åpne|besøke|lese|surfe|nett|internett|nettilgang)\b/.test(value)
    || /\b(?:uten (?:direkte )?(?:tilgang|nettilgang|internettilgang).{0,48}(?:kan (?:jeg|ki(?:-en)?)? ikke|umulig)|mangler nettilgang)\b/.test(value);
}
interface InterpretationAuditMeta{aiCalls:number;attemptedTools:number;provenance:MonitorToolProvenance[];attempts:MonitorToolAttempt[];}
const emptyInterpretationAudit=():InterpretationAuditMeta=>({aiCalls:0,attemptedTools:0,provenance:[],attempts:[]});
function interpretationAuditFromResult(result:{aiCalls:number;attemptedToolCount:number;provenance:MonitorToolProvenance[];attempts:MonitorToolAttempt[]}):InterpretationAuditMeta{return{aiCalls:result.aiCalls,attemptedTools:result.attemptedToolCount,provenance:result.provenance,attempts:result.attempts};}
function interpretationAuditFromError(error:unknown):InterpretationAuditMeta{const details=error instanceof DomainError?error.details:undefined;return{aiCalls:Number.isInteger(details?.aiCalls)?Number(details!.aiCalls):0,attemptedTools:Number.isInteger(details?.attemptedToolCount)?Number(details!.attemptedToolCount):0,provenance:Array.isArray(details?.provenance)?details.provenance as MonitorToolProvenance[]:[],attempts:Array.isArray(details?.attempts)?details.attempts as MonitorToolAttempt[]:[]};}
function mergeInterpretationAudit(left:InterpretationAuditMeta,right:InterpretationAuditMeta):InterpretationAuditMeta{return{aiCalls:left.aiCalls+right.aiCalls,attemptedTools:left.attemptedTools+right.attemptedTools,provenance:[...left.provenance,...right.provenance],attempts:[...left.attempts,...right.attempts]};}
function safeInterpretationError(error:unknown):string{const code=error instanceof DomainError?error.code:'AI_UPSTREAM_ERROR';return/^[A-Z][A-Z0-9_]{1,63}$/.test(code)?code:'AI_UPSTREAM_ERROR';}
function publicInterpretationError(error:unknown):unknown{
  if(!(error instanceof DomainError))return error;
  if(error.code!=='MONITOR_LOCATION_AMBIGUOUS'||!Array.isArray(error.details?.candidates))return new DomainError(error.code,error.status);
  const candidates=error.details.candidates.slice(0,5).flatMap((candidate)=>{if(!candidate||typeof candidate!=='object')return[];const value=candidate as Record<string,unknown>;if(typeof value.name!=='string')return[];return[{name:value.name.slice(0,200),municipality:typeof value.municipality==='string'?value.municipality.slice(0,120):null,region:typeof value.region==='string'?value.region.slice(0,120):null}];});
  return new DomainError(error.code,error.status,candidates.length?{candidates}:undefined);
}

export function monitorSourcePlan(instruction:string,manualSource?:string|null):{sourceUrl:string|null;tools:MonitorToolName[]}{
  const weatherIntent=/\b(?:vær(?:et|melding|varsel)?|weather|forecast|temperatur(?:en)?|temperature|nedbør|regn|snø|vind|kaldt|kulde|frost|minusgrader?|yr(?:\.no)?)\b/i.test(instruction.normalize('NFKC'));
  let normalizedManual=manualSource?.trim()?normalizeMonitorUrl(manualSource.trim()):undefined;if(weatherIntent&&normalizedManual&&/(?:^|\.)yr\.no$/i.test(new URL(normalizedManual).hostname))normalizedManual=undefined;
  const webInstruction=weatherIntent?instruction.replace(/https?:\/\/(?:www\.)?yr\.no\/[^\s<>'"]*|\b(?:www\.)?yr\.no(?:\/[^\s<>'"]*)?/gi,' '):instruction;let sourceUrl:string|null=null;
  try{sourceUrl=sourceUrlFromInstruction(webInstruction,normalizedManual);}catch(error){if(!(error instanceof DomainError)||error.code!=='MONITOR_SOURCE_REQUIRED')throw error;}
  const tools:MonitorToolName[]=[];if(sourceUrl)tools.push('web.open');if(weatherIntent)tools.push('weather.forecast');
  if(!tools.length)throw new DomainError('MONITOR_SOURCE_REQUIRED',422);
  return{sourceUrl,tools};
}
async function writeInterpretationAudit(taskId:string,taskRevision:number,outcome:'success'|'failed',meta:InterpretationAuditMeta,error:unknown=null):Promise<void>{const persistedProvenance=outcome==='success'?meta.provenance:[];await pool.query(`INSERT INTO monitor_tool_audits(task_id,task_revision,phase,outcome,error_code,ai_call_count,attempted_tool_count,tool_count,provenance,attempts) SELECT $1,$2,'interpretation',$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS(SELECT 1 FROM monitor_tasks WHERE id=$1)`,[taskId,taskRevision,outcome,outcome==='failed'?safeInterpretationError(error):null,meta.aiCalls,meta.attemptedTools,persistedProvenance.length,JSON.stringify(persistedProvenance),JSON.stringify(meta.attempts)]);}
async function writeInterpretationQualityAudit(taskId:string,taskRevision:number,reason:MonitorQualityReason,fromTier:AiModelTier,toTier:AiModelTier,outcome:'selected'|'escalated'|'succeeded'|'failed'):Promise<void>{await pool.query(`INSERT INTO monitor_quality_audits(task_id,task_revision,phase,reason,from_tier,to_tier,outcome) SELECT $1,$2,'interpretation',$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM monitor_tasks WHERE id=$1)`,[taskId,taskRevision,reason,fromTier,toTier,outcome]);}

export function interpretationFromAi(output:string){
  let rule;
  try{rule=schemaMonitorJson(output,monitorInterpretationSchema,'MONITOR_INTERPRETATION_SCHEMA_INVALID');}
  catch(error){if(error instanceof DomainError&&error.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID')throw error;throw new DomainError('MONITOR_INTERPRETATION_SCHEMA_INVALID',502);}
  if(interpretationRefusesSourceAccess(rule.summary))throw new DomainError('MONITOR_INTERPRETATION_SOURCE_REFUSAL',502);
  return rule;
}
const modelAnswerSchema=monitorAnswerSchema.extend({
  evidence:monitorAnswerSchema.shape.evidence.extend({sourceUrl:z.string().url().max(2048).optional()}),
  confidence:z.number().min(0).max(1).default(0),uncertainty:z.string().trim().max(500).nullable().default(null)
});
const modelEvidenceSourceSchema=z.object({quote:z.string().trim().min(1).max(1000),sourceUrl:z.string().url().max(2048).optional(),claims:z.array(z.string().trim().min(1).max(500)).min(1).max(20)}).strict();
const modelEventSchema=monitorExtractionSchema.shape.events.element.extend({
  evidence:z.object({quote:z.string().trim().min(1).max(500),sourceUrl:z.string().url().max(2048).optional(),claims:z.array(z.string().trim().min(1).max(500)).min(1).max(20).optional(),sources:z.array(modelEvidenceSourceSchema).min(1).max(6).optional()}).strict(),
  confidence:z.number().min(0).max(1).default(0),uncertainty:z.string().trim().max(500).nullable().default(null)
});
const modelExtractionSchema=monitorExtractionSchema.extend({events:z.array(modelEventSchema).max(200)});
const analysisQuality=new WeakMap<object,{explicitConfidence:boolean;confidence:number|null}>();
export function monitorAnalysisQuality(value:object):{explicitConfidence:boolean;confidence:number|null}{return analysisQuality.get(value)??{explicitConfidence:false,confidence:null};}
export async function validateMonitorTargets(client:DbClient,actor:MonitorActor,targets:Targets):Promise<void>{
  if(!targets.personIds.length&&!targets.displayIds.length)throw new DomainError('VALIDATION_FAILED',400);
  requireCapability(actor.capabilities,'message.create.household');requireCapability(actor.capabilities,'message.schedule');
  const [people,displays]=await Promise.all([
    client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[actor.householdId,targets.personIds]),
    client.query('SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL',[actor.householdId,targets.displayIds])
  ]);
  if(people.rowCount!==new Set(targets.personIds).size||displays.rowCount!==new Set(targets.displayIds).size)throw new DomainError('NOT_FOUND',404);
  if(targets.displayIds.length){requireCapability(actor.capabilities,'message.publish.display');if(!actor.capabilities.includes('display.manage')){const permitted=await client.query('SELECT display_id FROM membership_display_grants WHERE household_id=$1 AND membership_id=$2 AND display_id=ANY($3::uuid[])',[actor.householdId,actor.membershipId,targets.displayIds]);if(permitted.rowCount!==new Set(targets.displayIds).size)throw new DomainError('FORBIDDEN',403);}}
}
export async function validateExistingMonitorTargets(client:DbClient,actor:MonitorActor,taskId:string):Promise<void>{
  const [people,displays]=await Promise.all([
    client.query<{person_id:string}>('SELECT person_id FROM monitor_task_person_targets WHERE task_id=$1',[taskId]),
    client.query<{display_id:string}>('SELECT display_id FROM monitor_task_display_targets WHERE task_id=$1',[taskId])
  ]);
  try{await validateMonitorTargets(client,actor,{personIds:people.rows.map((item)=>item.person_id),displayIds:displays.rows.map((item)=>item.display_id)});}
  catch(error){if(error instanceof DomainError&&(error.code==='NOT_FOUND'||error.code==='VALIDATION_FAILED'))throw new DomainError('MONITOR_TARGET_INVALID',422);throw error;}
}
async function setTargets(client:DbClient,actor:MonitorActor,taskId:string,targets:Targets):Promise<void>{
  await validateMonitorTargets(client,actor,targets);
  await client.query('DELETE FROM monitor_task_person_targets WHERE task_id=$1',[taskId]);
  await client.query('DELETE FROM monitor_task_display_targets WHERE task_id=$1',[taskId]);
  for(const id of targets.personIds)await client.query('INSERT INTO monitor_task_person_targets(household_id,task_id,person_id) VALUES($1,$2,$3)',[actor.householdId,taskId,id]);
  for(const id of targets.displayIds)await client.query('INSERT INTO monitor_task_display_targets(household_id,task_id,display_id) VALUES($1,$2,$3)',[actor.householdId,taskId,id]);
}
export async function withdrawMonitorMessages(client:DbClient,taskId:string):Promise<void>{
  const rows=await client.query<{id:string;state:string;revision:number}>(`SELECT m.id,m.state,m.revision FROM monitor_events e JOIN messages m ON m.id=e.message_id WHERE e.task_id=$1 AND m.state IN ('scheduled','published') FOR UPDATE OF m`,[taskId]);
  for(const row of rows.rows){const next=row.state==='scheduled'?'cancelled':'withdrawn';await client.query(`UPDATE messages SET state=$2,revision=revision+1,ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,[row.id,next]);await client.query(`UPDATE message_display_targets SET delivery_state='cancelled' WHERE message_id=$1`,[row.id]);await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,idempotency_key) VALUES($1,$2,$3,$4,'system',$5) ON CONFLICT DO NOTHING`,[row.id,row.state,next,row.revision+1,`monitor-stop:${taskId}:${row.id}:${row.revision}`]);}
}

export const selectMonitorTask=`SELECT t.*,
 COALESCE((SELECT json_agg(person_id) FROM monitor_task_person_targets WHERE task_id=t.id),'[]') AS person_ids,
 COALESCE((SELECT json_agg(display_id) FROM monitor_task_display_targets WHERE task_id=t.id),'[]') AS display_ids,
 COALESCE((SELECT json_agg(json_build_object('date',event_date,'time',event_time,'type',event_type,'description',description,'actions',actions,'who',applies_to,'evidence',evidence,'confidence',confidence,'uncertainty',uncertainty) ORDER BY event_date,event_time) FROM monitor_events WHERE task_id=t.id AND active=true),'[]') AS events,
 (SELECT json_build_object('resultKind',r.result_kind,'result',r.result,'sourceUrl',CASE WHEN r.source_url LIKE 'https://api.met.no/weatherapi/locationforecast/%' THEN 'https://api.met.no/weatherapi/locationforecast/2.0/documentation' ELSE r.source_url END,'checkedAt',r.checked_at,'sources',COALESCE((SELECT jsonb_agg(DISTINCT jsonb_strip_nulls(jsonb_build_object('sourceUrl',CASE WHEN item.value->>'tool'='weather.forecast' THEN 'https://api.met.no/weatherapi/locationforecast/2.0/documentation' ELSE item.value->>'finalUrl' END,'fetchedAt',item.value->>'fetchedAt','kind',CASE WHEN item.value->>'tool'='weather.forecast' THEN 'weather' ELSE 'web' END,'label',COALESCE(item.value->>'label',item.value->>'canonicalLocation'),'attribution',item.value->>'attribution','canonicalLocation',item.value->>'canonicalLocation','validFrom',item.value->>'validFrom','validTo',item.value->>'validTo','forecastUpdatedAt',item.value->>'forecastUpdatedAt'))) FROM jsonb_array_elements(r.tool_provenance) AS item(value)),'[]'::jsonb)) FROM monitor_runs r WHERE t.last_changed_at IS NOT NULL AND r.task_id=t.id AND r.run_kind IN ('scheduled','manual') AND r.outcome='changed' AND r.result IS NOT NULL ORDER BY r.checked_at DESC,r.id DESC LIMIT 1) AS latest_result,
 (t.lease_token IS NOT NULL AND t.lease_expires_at>clock_timestamp()) AS lease_active,
 (((SELECT count(*) FROM monitor_task_person_targets WHERE task_id=t.id)+(SELECT count(*) FROM monitor_task_display_targets WHERE task_id=t.id))>0
   AND NOT EXISTS(SELECT 1 FROM monitor_task_display_targets target JOIN displays d ON d.id=target.display_id WHERE target.task_id=t.id AND d.revoked_at IS NOT NULL)) AS targets_valid
 FROM monitor_tasks t`;

type MonitorQuery=(text:string,values?:unknown[])=>Promise<{rowCount:number|null;rows:unknown[]}>;
function hasValidRule(value:unknown):boolean{return monitorInterpretationSchema.safeParse(value).success;}
function blockedActions(reason:MonitorActionBlockReason):MonitorTaskLifecycle['actions']{
  return Object.fromEntries(monitorTaskActions.map((action)=>[action,{enabled:false,reason}])) as MonitorTaskLifecycle['actions'];
}
export function monitorTaskLifecycle(row:Record<string,unknown>,targetAuthorized=true):MonitorTaskLifecycle{
  const setupComplete=hasValidRule(row.interpreted_rule)&&row.targets_valid===true;
  const liveLease=row.lease_active===true;
  const rawState=String(row.state);
  const setupReason:MonitorActionBlockReason=row.targets_valid===false?'targets_invalid':row.error_code?'setup_failed':'setup_required';
  const status:MonitorTaskLifecycle['status']=liveLease?'running':rawState==='active'?'active':rawState==='paused'?'paused':setupComplete?'ready_for_approval':row.error_code?'setup_failed':'incomplete';
  const actions=blockedActions(liveLease?'running':setupReason);
  const enable=(action:MonitorTaskAction)=>{actions[action]={enabled:true,reason:null};};
  const block=(action:MonitorTaskAction,reason:MonitorActionBlockReason)=>{actions[action]={enabled:false,reason};};
  if(liveLease){enable('refresh');return{status,setupComplete,actions};}
  enable('delete');enable('edit');
  if(rawState==='draft')enable('interpret');
  if(setupComplete){
    if(rawState==='draft'){enable('test');enable('smarter');if(targetAuthorized)enable('approve');else block('approve','permission_denied');}
    if(rawState==='active'){if(targetAuthorized)enable('run');else block('run','permission_denied');enable('pause');enable('smarter');enable('quality');}
    if(rawState==='paused'){enable('test');enable('smarter');enable('quality');if(row.approved_revision&&targetAuthorized)enable('resume');else block('resume',row.approved_revision?'permission_denied':'setup_required');}
  }
  for(const action of monitorTaskActions)if(!actions[action].enabled&&actions[action].reason===setupReason&&setupComplete)block(action,'state_not_allowed');
  return{status,setupComplete,actions};
}
async function actorCanUseTargets(query:MonitorQuery,actor:MonitorActor,row:Record<string,unknown>):Promise<boolean>{
  if(!actor.capabilities.includes('message.create.household')||!actor.capabilities.includes('message.schedule'))return false;
  const displayIds=row.display_ids as string[];
  if(!displayIds.length)return true;
  if(!actor.capabilities.includes('message.publish.display'))return false;
  if(actor.capabilities.includes('display.manage'))return true;
  const grants=await query('SELECT display_id FROM membership_display_grants WHERE household_id=$1 AND membership_id=$2 AND display_id=ANY($3::uuid[])',[actor.householdId,actor.membershipId,displayIds]);
  return grants.rowCount===new Set(displayIds).size;
}
async function presentMonitorTask(query:MonitorQuery,row:Record<string,unknown>,actor:MonitorActor):Promise<Record<string,unknown>>{
  return monitorTaskDto(row,await actorCanUseTargets(query,actor,row));
}
function monitorQuery(client:{query:unknown}):MonitorQuery{return (client.query as MonitorQuery).bind(client);}
function assertNotRunning(row:Record<string,unknown>):void{if(row.lease_active===true)throw new DomainError('MONITOR_RUNNING',409);}
async function validateStoredTargets(client:DbClient,actor:MonitorActor,row:Record<string,unknown>):Promise<void>{
  if(row.targets_valid!==true)throw new DomainError('MONITOR_TARGET_INVALID',422);
  await validateExistingMonitorTargets(client,actor,String(row.id));
}
export function monitorTaskDto(row:Record<string,unknown>,targetAuthorized=true):Record<string,unknown>{
  const time=(row.notice_local_time as string|undefined)?.slice(0,5);
  const sourceUrl=row.source_url?normalizeMonitorUrl(String(row.source_url)):null;
  const interpreted=row.interpreted_rule&&typeof row.interpreted_rule==='object'?row.interpreted_rule as Record<string,unknown>:null;
  const publicRule=interpreted?Object.fromEntries(Object.entries({...interpreted,...(interpreted.location&&typeof interpreted.location==='object'?{location:Object.fromEntries(Object.entries(interpreted.location as Record<string,unknown>).filter(([key])=>key!=='latitude'&&key!=='longitude'))}:{})}).filter(([key])=>!['tools','weatherScope','conditionalNotification'].includes(key))):null;
  const sourceKinds=(Array.isArray(row.tool_plan)?row.tool_plan:[]).flatMap((tool)=>tool==='web.open'?['web']:tool==='weather.forecast'?['weather']:[]);
  const storedFinalUrl=typeof row.source_final_url==='string'?row.source_final_url:null;const publicFinalUrl=storedFinalUrl&&row.source_content_type==='application/vnd.met.no.locationforecast+json'?'https://api.met.no/weatherapi/locationforecast/2.0/documentation':storedFinalUrl;
  return {id:row.id,name:row.name,instruction:row.instruction,sourceUrl,state:row.state,
    checkIntervalMinutes:row.check_interval_minutes,targets:{personIds:row.person_ids,displayIds:row.display_ids},noticeDaysBefore:row.notice_days_before,noticeLocalTime:time,
    sourceKinds,usesSmarterAi:row.model_tier==='strong',interpretedRule:publicRule,revision:row.revision,approvedRevision:row.approved_revision,
    lastCheckedAt:(row.last_checked_at as Date|null)?.toISOString()??null,nextCheckAt:(row.next_check_at as Date|null)?.toISOString()??null,lastResult:row.last_result,
    lastChangedAt:(row.last_changed_at as Date|null)?.toISOString()??null,errorCode:row.error_code,
    source:{finalUrl:publicFinalUrl,contentType:row.source_content_type,etag:row.source_etag,lastModified:row.source_last_modified,fingerprint:row.last_processed_fingerprint},
    latestResult:row.latest_result??null,events:row.events,stats:{checks:row.check_count,aiCalls:row.ai_call_count,unchanged:row.unchanged_count},lifecycle:monitorTaskLifecycle(row,targetAuthorized),createdAt:(row.created_at as Date).toISOString(),updatedAt:(row.updated_at as Date).toISOString()};
}
function derivedName(instruction:string,sourceUrl:string|null):string {const fallback=sourceUrl?`Følg med på ${new URL(sourceUrl).hostname.replace(/^www\./,'')}`:'Følg med på været';const first=instruction.split(/[.!?\n]/)[0]?.trim();return (first&&first.length<=80?first:fallback).slice(0,80);}

export class MonitorService{
  private readonly agent:MonitorAgentRunner;
  constructor(private readonly ai=new AiAdminService(),fetcher=new MonitorSourceFetcher(),weather=new MetWeatherClient()){this.agent=new MonitorAgentRunner(ai,fetcher,MONITOR_AGENT_DEADLINE_MS,weather);}
  async list(actor:MonitorActor){const rows=await pool.query(`${selectMonitorTask} WHERE t.household_id=$1 ORDER BY t.created_at DESC`,[actor.householdId]);return Promise.all(rows.rows.map((row)=>presentMonitorTask(monitorQuery(pool),row,actor)));}
  async create(actor:MonitorActor,input:unknown){const body=monitorTaskCreateSchema.parse(input);const plan=monitorSourcePlan(body.instruction,body.sourceUrl);const name=body.name??derivedName(body.instruction,plan.sourceUrl);return transaction(async(client)=>{await validateMonitorTargets(client,actor,body.targets);const inserted=await client.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[actor.householdId,actor.membershipId,name,body.instruction,plan.sourceUrl,JSON.stringify(plan.tools),body.checkIntervalMinutes,body.noticeDaysBefore,body.noticeLocalTime,body.providerPolicy,body.modelTier]);const id=inserted.rows[0]!.id;await setTargets(client,actor,id,body.targets);await this.audit(client,actor,'monitor.created',id);return presentMonitorTask(monitorQuery(client),(await client.query(`${selectMonitorTask} WHERE t.id=$1`,[id])).rows[0],actor);});}
  async update(actor:MonitorActor,id:string,input:unknown){const body=monitorTaskUpdateSchema.parse(input);return transaction(async(client)=>{const current=(await client.query<Record<string,unknown>>(`${selectMonitorTask} WHERE t.id=$1 AND t.household_id=$2 FOR UPDATE OF t`,[id,actor.householdId])).rows[0];if(!current)throw new DomainError('NOT_FOUND',404);if(current.revision!==body.expectedRevision)throw new DomainError('REVISION_CONFLICT',409);assertNotRunning(current);const nextTargets=body.targets??{personIds:current.person_ids as string[],displayIds:current.display_ids as string[]};await validateMonitorTargets(client,actor,nextTargets);const nextInstruction=body.instruction??String(current.instruction);const plan=monitorSourcePlan(nextInstruction,body.sourceUrl===undefined?(current.source_url?String(current.source_url):null):body.sourceUrl);await withdrawMonitorMessages(client,id);await client.query(`UPDATE monitor_events SET active=false,updated_at=clock_timestamp() WHERE task_id=$1`,[id]);const updated=await client.query(`UPDATE monitor_tasks SET name=$3,instruction=$4,source_url=$5,tool_plan=$6,check_interval_minutes=$7,notice_days_before=$8,notice_local_time=$9,provider_policy=$10,model_tier=$11,state='draft',interpreted_rule=NULL,approved_revision=NULL,last_checked_at=NULL,next_check_at=NULL,last_result=NULL,last_changed_at=NULL,error_code=NULL,source_final_url=NULL,source_content_type=NULL,source_etag=NULL,source_last_modified=NULL,last_processed_fingerprint=NULL,source_dependency_manifest='[]'::jsonb,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 RETURNING id`,[id,actor.householdId,body.name??current.name,nextInstruction,plan.sourceUrl,JSON.stringify(plan.tools),body.checkIntervalMinutes??current.check_interval_minutes,body.noticeDaysBefore??current.notice_days_before,body.noticeLocalTime??String(current.notice_local_time).slice(0,5),body.providerPolicy??current.provider_policy,body.modelTier??current.model_tier]);if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409);if(body.targets)await setTargets(client,actor,id,body.targets);await this.audit(client,actor,'monitor.updated',id);return presentMonitorTask(monitorQuery(client),(await client.query(`${selectMonitorTask} WHERE t.id=$1`,[id])).rows[0],actor);});}
  async interpret(actor:MonitorActor,id:string,expectedRevision:number){
    const token=randomUUID();
    const claimed=await pool.query(`UPDATE monitor_tasks SET lease_token=$4,lease_expires_at=clock_timestamp()+($5::int*interval '1 millisecond'),error_code=NULL WHERE id=$1 AND household_id=$2 AND revision=$3 AND state='draft' AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) RETURNING id`,[id,actor.householdId,expectedRevision,token,MONITOR_LEASE_MS]);
    if(!claimed.rowCount){const current=(await pool.query<{revision:number;state:string;lease_active:boolean}>(`SELECT revision,state,(lease_token IS NOT NULL AND lease_expires_at>clock_timestamp()) AS lease_active FROM monitor_tasks WHERE id=$1 AND household_id=$2`,[id,actor.householdId])).rows[0];if(!current)throw new DomainError('NOT_FOUND',404);if(current.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);if(current.lease_active)throw new DomainError('MONITOR_RUNNING',409);throw new DomainError('CONFLICT',409);}
    let audit:InterpretationAuditMeta=emptyInterpretationAudit();const interpretationStarted=Date.now();const interpretationController=new AbortController();const interpretationDeadline=setTimeout(()=>interpretationController.abort(),MONITOR_AGENT_DEADLINE_MS);
    try{
      const row=(await pool.query<Record<string,unknown>>(`${selectMonitorTask} WHERE t.id=$1 AND t.household_id=$2 AND t.lease_token=$3`,[id,actor.householdId,token])).rows[0];if(!row)throw new DomainError('CONFLICT',409);
      const approvedSourceUrl=row.source_url?normalizeMonitorUrl(String(row.source_url)):undefined;const toolPlan=(Array.isArray(row.tool_plan)?row.tool_plan:['web.open']) as MonitorToolName[];
      const route=routeMonitorInterpretationQuality({savedTier:row.model_tier as AiModelTier,tools:toolPlan,instruction:String(row.instruction)});
      const sourceDescription=approvedSourceUrl?`The approved root source is ${approvedSourceUrl}.`:'This task has no web URL; use the approved domain tool.';
      const prompt=`You configure a durable Samvev task. ${sourceDescription} Approved tools: ${toolPlan.join(', ')}. Samvev performs all external access through these tools. Use weather.forecast for weather intent, including wording such as "via Yr"; never scrape Yr. Use web.open only for an approved web source, and never construct or guess links. Never claim that you lack source access. Return only JSON matching {"version":1,"resultKind":"answer","summary":string,"eventTypes":string[],"keywords":string[],"people":string[],"noticeDaysBefore":integer,"noticeLocalTime":"HH:MM","checkIntervalMinutes":integer,"conditionalNotification":boolean,"tools":["web.open"],"location":{"query":string,"canonicalName":string,"municipality":string,"region":string,"country":string}}; resultKind must be exactly "events" or "answer". Set conditionalNotification=true only when a notification should be created only if a stated condition is met. The tools array must contain exactly the approved tools. For weather tasks include the location object using verified tool output; omit location for non-weather tasks. Use "events" only for dated events/reminders and "answer" for a requested current fact, headline, summary or forecast. Do not invent facts. Instruction: ${JSON.stringify(row.instruction)}. Current defaults: notice ${row.notice_days_before} day(s) before at ${String(row.notice_local_time).slice(0,5)}, check every ${row.check_interval_minutes} minutes.`;
      const runInterpretation=async(inputPrompt:string,tier:AiModelTier,requireTool:boolean,seedDocuments:SourceDocument[]=[],limits:Partial<{maxTurns:number;maxToolExecutions:number}>={},expectedProvider?:MonitorAgentResult['provider'])=>{
        try{const outcome=await this.agent.run({householdId:actor.householdId,task:{operation:'plan',purpose:'monitor_interpretation',input:inputPrompt,modelTier:tier,maxOutputTokens:1200,sources:approvedSourceUrl?[{url:approvedSourceUrl,observedAt:new Date().toISOString(),uncertainty:'unknown'}]:[]},policy:row.provider_policy as MonitorProviderPolicy,rootUrl:approvedSourceUrl,toolNames:toolPlan,requiredTools:requireTool?toolPlan:[],expectedProvider,seedDocuments,signal:interpretationController.signal,...limits});audit=mergeInterpretationAudit(audit,interpretationAuditFromResult(outcome));return outcome;}
        catch(error){audit=mergeInterpretationAudit(audit,interpretationAuditFromError(error));throw error;}
      };
      let outcome=await runInterpretation(prompt,route.tier,toolPlan.includes('weather.forecast'));if(route.reason)await writeInterpretationQualityAudit(id,expectedRevision,route.reason,row.model_tier as AiModelTier,route.tier,'selected');
      let rule;
      try{rule=interpretationFromAi(outcome.output);}
      catch(error){
        let finalError=error;
        if(error instanceof DomainError&&['MONITOR_INTERPRETATION_SCHEMA_INVALID','MONITOR_INTERPRETATION_SOURCE_REFUSAL'].includes(error.code)&&outcome.attemptedToolCount===0&&toolPlan.includes('web.open')){
          const retryPrompt=`${prompt} The previous response was not usable. You MUST call web.open on the approved root before returning the strict setup JSON. Base the summary on the user's requested action and the fetched source capability; do not answer the task itself and do not mention access limitations.`;
          try{outcome=await runInterpretation(retryPrompt,route.tier,true,outcome.documents,{maxTurns:6,maxToolExecutions:6},outcome.provider);rule=interpretationFromAi(outcome.output);finalError=undefined;}catch(retryError){finalError=retryError;}
        }
        if(finalError&&route.tier==='routine'&&finalError instanceof DomainError&&finalError.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID'){
          const budget=remainingEscalationBudget(audit.aiCalls,audit.attemptedTools,MONITOR_AGENT_DEADLINE_MS-(Date.now()-interpretationStarted));
          if(budget){await writeInterpretationQualityAudit(id,expectedRevision,'invalid_schema','routine','strong','escalated');try{outcome=await runInterpretation(prompt,'strong',toolPlan.includes('weather.forecast'),outcome.documents,budget,outcome.provider);rule=interpretationFromAi(outcome.output);await writeInterpretationQualityAudit(id,expectedRevision,'invalid_schema','routine','strong','succeeded');finalError=undefined;}catch(strongError){await writeInterpretationQualityAudit(id,expectedRevision,'invalid_schema','routine','strong','failed');finalError=strongError;}}
        }
        if(finalError)throw finalError;
      }
      if(!rule)throw new DomainError('MONITOR_INTERPRETATION_SCHEMA_INVALID',502);
      const weatherEvidence=outcome.provenance.find((item)=>item.tool==='weather.forecast');
      const weatherRequests=[...new Map(outcome.dependencies.filter((item)=>item.tool==='weather.forecast'&&item.weatherRequest).map((item)=>[JSON.stringify(item.weatherRequest),item.weatherRequest!])).values()];
      if(toolPlan.includes('weather.forecast')&&(weatherRequests.length!==1||!weatherEvidence))throw new DomainError('MONITOR_INTERPRETATION_SCHEMA_INVALID',502);
      const weatherRequest=weatherRequests[0];const weatherScope=weatherRequest?(toolPlan.includes('web.open')?{location:weatherRequest.location,period:'date' as const,timeWindow:weatherRequest.timeWindow,dynamicDateFromEvidence:true}:{...weatherRequest}):undefined;
      const {location:_modelLocation,...ruleWithoutModelLocation}=rule;const conditionalNotification=rule.resultKind==='events'&&(rule.conditionalNotification||isConditionalInstruction(String(row.instruction)));
      rule={...ruleWithoutModelLocation,conditionalNotification,tools:toolPlan,...(weatherEvidence&&weatherScope?{location:{query:weatherScope.location,canonicalName:weatherEvidence.canonicalLocation!,...(weatherEvidence.municipality?{municipality:weatherEvidence.municipality}:{}),...(weatherEvidence.region?{region:weatherEvidence.region}:{}),country:weatherEvidence.country!},weatherScope}:{})};
      await transaction(async(client)=>{const changed=await client.query(`UPDATE monitor_tasks SET interpreted_rule=$3,notice_days_before=$4,notice_local_time=$5,check_interval_minutes=$6,revision=revision+1,approved_revision=NULL,state='draft',error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$7 AND lease_token=$8 RETURNING revision`,[id,actor.householdId,JSON.stringify(rule),rule.noticeDaysBefore,rule.noticeLocalTime,rule.checkIntervalMinutes,expectedRevision,token]);if(!changed.rowCount)throw new DomainError('REVISION_CONFLICT',409);await client.query(`INSERT INTO monitor_tool_audits(task_id,task_revision,phase,outcome,error_code,ai_call_count,attempted_tool_count,tool_count,provenance,attempts) VALUES($1,$2,'interpretation','success',NULL,$3,$4,$5,$6,$7)`,[id,expectedRevision,audit.aiCalls,audit.attemptedTools,audit.provenance.length,JSON.stringify(audit.provenance),JSON.stringify(audit.attempts)]);});
      return presentMonitorTask(monitorQuery(pool),(await pool.query(`${selectMonitorTask} WHERE t.id=$1`,[id])).rows[0],actor);
    }catch(error){
      await pool.query('UPDATE monitor_tasks SET error_code=$4,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND lease_token=$3',[id,actor.householdId,token,safeInterpretationError(error)]);
      await writeInterpretationAudit(id,expectedRevision,'failed',audit,error);
      throw publicInterpretationError(error);
    }finally{clearTimeout(interpretationDeadline);interpretationController.abort();}
  }
  async setState(actor:MonitorActor,id:string,expectedRevision:number,action:'approve'|'pause'|'resume'){return transaction(async(client)=>{const row=(await client.query<Record<string,unknown>>(`${selectMonitorTask} WHERE t.id=$1 AND t.household_id=$2 FOR UPDATE OF t`,[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);assertNotRunning(row);if((action==='approve'&&row.state!=='draft')||(action==='pause'&&row.state!=='active')||(action==='resume'&&row.state!=='paused'))throw new DomainError('CONFLICT',409);if((action==='approve'||action==='resume')&&!hasValidRule(row.interpreted_rule))throw new DomainError('MONITOR_SETUP_REQUIRED',422);if(action==='resume'&&!row.approved_revision)throw new DomainError('MONITOR_SETUP_REQUIRED',422);if(action==='approve'||action==='resume')await validateStoredTargets(client,actor,row);const revision=expectedRevision+1;const state=action==='pause'?'paused':'active';if(action==='pause')await withdrawMonitorMessages(client,id);await client.query(`UPDATE monitor_tasks SET state=$3,owner_membership_id=CASE WHEN $5='approve' THEN $6 ELSE owner_membership_id END,revision=$4,approved_revision=CASE WHEN $5 IN ('approve','resume') THEN $4 ELSE approved_revision END,next_check_at=CASE WHEN $3='active' THEN clock_timestamp() ELSE NULL END,last_processed_fingerprint=CASE WHEN $5='pause' THEN NULL ELSE last_processed_fingerprint END,source_dependency_manifest=CASE WHEN $5='pause' THEN '[]'::jsonb ELSE source_dependency_manifest END,error_code=CASE WHEN $5 IN ('approve','resume') THEN NULL ELSE error_code END,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2`,[id,actor.householdId,state,revision,action,actor.membershipId]);await this.audit(client,actor,`monitor.${action}`,id);return presentMonitorTask(monitorQuery(client),(await client.query(`${selectMonitorTask} WHERE t.id=$1`,[id])).rows[0],actor);});}
  async setQuality(actor:MonitorActor,id:string,expectedRevision:number,quality:'standard'|'smarter'){return transaction(async(client)=>{const row=(await client.query<Record<string,unknown>>(`${selectMonitorTask} WHERE t.id=$1 AND t.household_id=$2 FOR UPDATE OF t`,[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);assertNotRunning(row);if(row.state==='draft')throw new DomainError('CONFLICT',409);await client.query(`UPDATE monitor_tasks SET model_tier=$3,revision=revision+1,approved_revision=CASE WHEN state='active' THEN revision+1 ELSE approved_revision END,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2`,[id,actor.householdId,quality==='smarter'?'strong':'routine']);await this.audit(client,actor,'monitor.quality_changed',id);return presentMonitorTask(monitorQuery(client),(await client.query(`${selectMonitorTask} WHERE t.id=$1`,[id])).rows[0],actor);});}
  async remove(actor:MonitorActor,id:string,expectedRevision:number){await transaction(async(client)=>{const row=(await client.query<Record<string,unknown>>(`${selectMonitorTask} WHERE t.id=$1 AND t.household_id=$2 FOR UPDATE OF t`,[id,actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409);assertNotRunning(row);await withdrawMonitorMessages(client,id);await this.audit(client,actor,'monitor.deleted',id);await client.query('DELETE FROM monitor_tasks WHERE id=$1',[id]);});}
  private async audit(client:pg.PoolClient,actor:MonitorActor,action:string,id:string){await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id) VALUES($1,$2,'account',$3,$4,'monitor_task',$5)`,[actor.installationId,actor.householdId,actor.accountId,action,id]);}
}

function normalizedClaim(value:string):string{return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();}
function supportedByEvidence(value:string,evidence:string):boolean{return normalizedClaim(evidence).includes(normalizedClaim(value));}
const claimStopWords=new Set(['a','an','and','at','av','den','det','en','et','for','fra','i','is','med','og','om','on','på','som','the','til','to','ved','with']);
function substantiveTerms(value:string):string[]{return normalizedClaim(value).match(/[\p{L}\p{N}]+/gu)?.filter((term)=>term.length>1&&!claimStopWords.has(term))??[];}
function sourceEvidenceFields(source:SourceDocument):string[]{
  return[source.text,source.title??'',...(source.headings??[]),...(source.links??[]).map((link)=>link.label)].map(normalizedClaim).filter(Boolean);
}
function sourceContainsEvidence(source:SourceDocument,value:string):boolean{
  const normalized=normalizedClaim(value);return Boolean(normalized)&&sourceEvidenceFields(source).some((field)=>field.includes(normalized));
}
function evidenceSource(sources:SourceDocument|SourceDocument[],url:string|undefined):SourceDocument|undefined{
  if(url===undefined)return undefined;
  let evidenceUrl:string;try{evidenceUrl=normalizeMonitorUrl(url);}catch{return undefined;}
  return(Array.isArray(sources)?sources:[sources]).find((source)=>{for(const candidate of [source.finalUrl,...(source.evidenceUrlAliases??[])])try{if(normalizeMonitorUrl(candidate)===evidenceUrl)return true;}catch{/* invalid server evidence cannot authorize a model URL */}return false;});
}
interface ModelEvidenceRef{quote:string;sourceUrl?:string;claims?:string[];}
interface AnchoredEvidenceRef{quote:string;sourceUrl:string;claims:string[];source:SourceDocument;}
function anchorEvidence(ref:ModelEvidenceRef,opened:SourceDocument[]):AnchoredEvidenceRef{
  const candidates=ref.sourceUrl?[evidenceSource(opened,ref.sourceUrl)].filter((value):value is SourceDocument=>Boolean(value)):opened;
  const source=candidates.find((candidate)=>sourceContainsEvidence(candidate,ref.quote));
  if(!source)throw new DomainError('AI_RESPONSE_INVALID',502);
  const claims=ref.claims??[];if(claims.some((claim)=>!supportedByEvidence(claim,ref.quote)))throw new DomainError('AI_RESPONSE_INVALID',502);
  return{quote:ref.quote,sourceUrl:source.publicEvidenceUrl??source.finalUrl,claims,source};
}
function compositeClaimSupported(value:string,refs:AnchoredEvidenceRef[]):boolean{
  if(refs.some((ref)=>supportedByEvidence(value,ref.quote)))return true;
  if(refs.length<2)return false;
  const supported=new Set(refs.flatMap((ref)=>ref.claims).flatMap(substantiveTerms));const terms=substantiveTerms(value);
  return terms.length>0&&terms.every((term)=>supported.has(term));
}
export function extractionFromAi(output:string,sources:SourceDocument|SourceDocument[],now=new Date()){
  const detailed=schemaMonitorJsonDetailed(output,modelExtractionSchema,'AI_RESPONSE_INVALID');const parsed=detailed.data;const today=now.toISOString().slice(0,10);
  const opened=Array.isArray(sources)?sources:[sources];
  const events=parsed.events.map((event)=>{
    try{
    if(event.date<today)throw new DomainError('AI_RESPONSE_INVALID',502);
    const primary=anchorEvidence(event.evidence,opened);const supporting=(event.evidence.sources??[]).map((ref)=>anchorEvidence(ref,opened));const refs=[primary,...supporting];if(supporting.length&&!primary.claims.length)throw new DomainError('AI_RESPONSE_INVALID',502);
    const [year,month,day]=event.date.split('-');const dateForms=[event.date,`${day}.${month}.${year}`,`${day}/${month}/${year}`];
    const dated=refs.filter((ref)=>dateForms.some((value)=>normalizedClaim(ref.quote).includes(normalizedClaim(value))));if(!dated.length)throw new DomainError('AI_RESPONSE_INVALID',502);
    if(event.time!==null&&!refs.some((ref)=>normalizedClaim(ref.quote).includes(event.time!)))throw new DomainError('AI_RESPONSE_INVALID',502);
    for(const claim of [event.type,event.description,...event.actions,...event.who])if(!compositeClaimSupported(claim,refs))throw new DomainError('AI_RESPONSE_INVALID',502);
    const weatherRefs=refs.filter((ref)=>ref.source.evidenceKind==='weather'||ref.source.contentType==='application/vnd.met.no.locationforecast+json');
    if(weatherRefs.length&&weatherRefs.some((ref)=>!ref.source.evidenceDates?.includes(event.date)))throw new DomainError('AI_RESPONSE_INVALID',502);
    if(weatherRefs.length&&refs.some((ref)=>ref.source.evidenceKind==='web')&&!dated.some((ref)=>ref.source.evidenceKind==='web'))throw new DomainError('AI_RESPONSE_INVALID',502);
    return{...event,evidence:{quote:primary.quote,sourceUrl:primary.sourceUrl,...(primary.claims.length?{claims:primary.claims}:{}),...(supporting.length?{sources:supporting.map(({quote,sourceUrl,claims})=>({quote,sourceUrl,claims}))}:{})}};
    }catch(error){if(event.evidence.sources?.length&&error instanceof DomainError&&error.code==='AI_RESPONSE_INVALID')throw new DomainError('AI_COMPOSITION_INVALID',502);throw error;}
  });
  const result=monitorExtractionSchema.parse({...parsed,events});const rawEvents=detailed.raw&&typeof detailed.raw==='object'&&Array.isArray((detailed.raw as any).events)?(detailed.raw as any).events:[];const explicitValues=rawEvents.filter((item:unknown)=>item&&typeof item==='object'&&Object.hasOwn(item,'confidence')).map((item:any)=>item.confidence).filter((value:unknown):value is number=>typeof value==='number');analysisQuality.set(result,{explicitConfidence:explicitValues.length>0,confidence:explicitValues.length?Math.min(...explicitValues):null});return result;
}
export function answerFromAi(output:string,sources:SourceDocument|SourceDocument[]){const detailed=schemaMonitorJsonDetailed(output,modelAnswerSchema,'AI_RESPONSE_INVALID');const parsed=detailed.data;const opened=Array.isArray(sources)?sources:[sources];const candidates=parsed.evidence.sourceUrl?[evidenceSource(opened,parsed.evidence.sourceUrl)].filter((value):value is SourceDocument=>Boolean(value)):opened;const source=candidates.find((candidate)=>sourceContainsEvidence(candidate,parsed.evidence.quote)&&sourceContainsEvidence(candidate,parsed.answer)&&supportedByEvidence(parsed.answer,parsed.evidence.quote));if(!source)throw new DomainError('AI_RESPONSE_INVALID',502);const result=monitorAnswerSchema.parse({...parsed,evidence:{...parsed.evidence,sourceUrl:source.publicEvidenceUrl??source.finalUrl}});const raw=detailed.raw&&typeof detailed.raw==='object'?detailed.raw as Record<string,unknown>:{};analysisQuality.set(result,{explicitConfidence:Object.hasOwn(raw,'confidence'),confidence:typeof raw.confidence==='number'?raw.confidence:null});return result;}
