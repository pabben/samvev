import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { roleCapabilityPresets } from '@samvev/contracts';
import { DomainError, hashPassword, opaqueToken, verifyLoginPassword } from '@samvev/core';
import { pool, transaction } from '../db.ts';

const PURPOSE='synthetic_live_e2e_v1';
export const liveE2eCapabilities=['household.view','household.manage','message.create.household','message.schedule'] as const;
const credentialsSchema=z.object({
  version:z.literal(1),registrationId:z.string().uuid(),householdId:z.string().uuid(),personId:z.string().uuid(),accountId:z.string().uuid(),membershipId:z.string().uuid(),
  email:z.string().email(),password:z.string().min(12).max(128),marker:z.string().min(32).max(256)
}).strict();
export type LiveE2eCredentials=z.infer<typeof credentialsSchema>;

function markerHash(marker:string):string{return createHash('sha256').update(marker).digest('hex');}
function hasExactCapabilities(value:unknown,expected:readonly string[]):boolean{
  return Array.isArray(value)&&value.length===expected.length&&
    [...value].sort().join('\n')===[...expected].sort().join('\n');
}
function generatedCredentials():LiveE2eCredentials{
  const suffix=opaqueToken(9).replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
  return{version:1,registrationId:randomUUID(),householdId:randomUUID(),personId:randomUUID(),accountId:randomUUID(),membershipId:randomUUID(),email:`live-e2e-${suffix}@test.invalid`,password:`LiveE2E-A1-${opaqueToken(24)}`,marker:opaqueToken(32)};
}

async function safeCredentialOutputPath(outputPath:string):Promise<string>{
  const lexical=resolve(outputPath);const localMarker=`${sep}.local${sep}`;const localIndex=lexical.indexOf(localMarker);
  const root=lexical.startsWith(`${sep}tmp${sep}`)?`${sep}tmp`:localIndex>=0?lexical.slice(0,localIndex+`${sep}.local`.length):null;
  if(!root)throw new Error('Live E2E credential output must be below .local/ or /tmp/');
  const parent=dirname(lexical);if(parent===root)throw new Error('Live E2E credential output requires a private subdirectory');
  const rootMetadata=await lstat(root);if(!rootMetadata.isDirectory()||rootMetadata.isSymbolicLink())throw new Error('Live E2E credential root must be a real directory');
  await mkdir(parent,{recursive:true,mode:0o700});
  const canonicalRoot=await realpath(root);const canonicalParent=await realpath(parent);
  if(canonicalParent!==parent||!(canonicalParent===canonicalRoot||canonicalParent.startsWith(`${canonicalRoot}${sep}`)))throw new Error('Live E2E credential path must not traverse symbolic links');
  const parentMetadata=await lstat(canonicalParent);if(!parentMetadata.isDirectory()||parentMetadata.isSymbolicLink()||(parentMetadata.mode&0o077)!==0)throw new Error('Live E2E credential directory must be private');
  const owner=process.geteuid?.();if(owner!==undefined&&parentMetadata.uid!==owner)throw new Error('Live E2E credential directory must be owned by the current user');
  return join(canonicalParent,basename(lexical));
}

async function loadOrCreateCredentials(outputPath:string):Promise<{credentials:LiveE2eCredentials;created:boolean}>{
  try{
    const metadata=await lstat(outputPath);if(!metadata.isFile()||metadata.isSymbolicLink())throw new Error('Live E2E credential path must be a regular file');if((metadata.mode&0o077)!==0)throw new Error('Live E2E credential file must have mode 0600');
    return{credentials:credentialsSchema.parse(JSON.parse(await readFile(outputPath,'utf8'))),created:false};
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
  const credentials=generatedCredentials();
  const handle=await open(outputPath,'wx',0o600);try{await handle.writeFile(`${JSON.stringify(credentials,null,2)}\n`,{encoding:'utf8'});}finally{await handle.close();}
  await chmod(outputPath,0o600);return{credentials,created:true};
}

async function validateRegistration(credentials:LiveE2eCredentials):Promise<void>{
  const result=await pool.query<{registration_id:string;household_id:string;account_id:string;membership_id:string;marker_hash:string;data_kind:string;role_preset:string;capabilities:unknown;disabled_at:Date|null;password_hash:string|null;membership_count:number;household_membership_count:number;person_count:number}>(`
    SELECT r.id AS registration_id,r.household_id,r.account_id,r.membership_id,r.marker_hash,h.data_kind,m.role_preset,m.capabilities,a.disabled_at,a.password_hash,
      (SELECT count(*)::int FROM memberships WHERE account_id=r.account_id) AS membership_count,
      (SELECT count(*)::int FROM memberships WHERE household_id=r.household_id) AS household_membership_count,
      (SELECT count(*)::int FROM persons WHERE household_id=r.household_id) AS person_count
    FROM live_e2e_registrations r JOIN households h ON h.id=r.household_id
    JOIN accounts a ON a.id=r.account_id JOIN memberships m ON m.id=r.membership_id
    WHERE r.id=$1`,[credentials.registrationId]);
  const row=result.rows[0];
  if(!row||row.household_id!==credentials.householdId||row.account_id!==credentials.accountId||row.membership_id!==credentials.membershipId||row.marker_hash!==markerHash(credentials.marker))throw new DomainError('CONFLICT',409,{reason:'live_e2e_binding_mismatch'});
  if(row.data_kind!=='synthetic'||row.role_preset!=='household_admin'||!hasExactCapabilities(row.capabilities,liveE2eCapabilities)||row.disabled_at||row.membership_count!==1||row.household_membership_count!==1||row.person_count!==1)throw new DomainError('CONFLICT',409,{reason:'live_e2e_identity_not_isolated'});
  if(!await verifyLoginPassword(credentials.password,row.password_hash??undefined,true))throw new DomainError('CONFLICT',409,{reason:'live_e2e_credential_mismatch'});
}

export async function provisionLiveE2e(outputPath:string):Promise<{registrationId:string;householdId:string;accountId:string;membershipId:string;idempotent:boolean}>{
  outputPath=await safeCredentialOutputPath(outputPath);
  const existingRegistration=await pool.query('SELECT 1 FROM live_e2e_registrations LIMIT 1');
  try{await lstat(outputPath);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(existingRegistration.rowCount)throw new DomainError('CONFLICT',409,{reason:'live_e2e_credentials_missing'});}
  const {credentials,created}=await loadOrCreateCredentials(outputPath);
  try{
    const idempotent=await transaction(async(client)=>{
      const installation=(await client.query<{id:string;claimed_at:Date|null;demo_mode:boolean}>(`SELECT id,claimed_at,demo_mode FROM installations WHERE singleton=true FOR UPDATE`)).rows[0];
      if(!installation?.claimed_at||installation.demo_mode)throw new DomainError('CONFLICT',409,{reason:'live_installation_required'});
      const registered=(await client.query<{id:string}>(`SELECT id FROM live_e2e_registrations WHERE installation_id=$1`,[installation.id])).rows[0];
      if(registered){
        if(registered.id!==credentials.registrationId)throw new DomainError('CONFLICT',409,{reason:'live_e2e_registration_collision'});
        const reduced=await client.query(`UPDATE memberships m SET capabilities=$7,revision=m.revision+1 FROM live_e2e_registrations r,households h,accounts a
          WHERE r.id=$1 AND r.household_id=$2 AND r.account_id=$3 AND r.membership_id=$4 AND r.marker_hash=$5
            AND h.id=r.household_id AND h.data_kind='synthetic' AND a.id=r.account_id AND a.disabled_at IS NULL
            AND m.id=r.membership_id AND m.household_id=r.household_id AND m.account_id=r.account_id
            AND m.role_preset='household_admin' AND m.capabilities=$6::jsonb RETURNING m.id`,[
          credentials.registrationId,credentials.householdId,credentials.accountId,credentials.membershipId,markerHash(credentials.marker),JSON.stringify(roleCapabilityPresets.household_admin),JSON.stringify(liveE2eCapabilities)
        ]);
        if(reduced.rowCount)await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,action,subject_type,subject_id,metadata) VALUES($1,$2,'system','live_e2e.capabilities_reduced','live_e2e_registration',$3,$4)`,[installation.id,credentials.householdId,credentials.registrationId,JSON.stringify({synthetic:true,purpose:PURPOSE})]);
        return true;
      }
      const collisions=await client.query(`SELECT 1 FROM households WHERE id=$1 UNION ALL SELECT 1 FROM persons WHERE id=$2 UNION ALL SELECT 1 FROM accounts WHERE id=$3 OR email_normalized=$4 UNION ALL SELECT 1 FROM memberships WHERE id=$5`,[credentials.householdId,credentials.personId,credentials.accountId,credentials.email,credentials.membershipId]);
      if(collisions.rowCount)throw new DomainError('CONFLICT',409,{reason:'live_e2e_identity_collision'});
      const passwordHash=await hashPassword(credentials.password);
      await client.query(`INSERT INTO households(id,installation_id,name,timezone,default_locale,data_kind) VALUES($1,$2,'Synthetic live E2E household','Europe/Oslo','nb','synthetic')`,[credentials.householdId,installation.id]);
      await client.query(`INSERT INTO persons(id,household_id,display_name,age_group) VALUES($1,$2,'Synthetic E2E operator','adult')`,[credentials.personId,credentials.householdId]);
      await client.query(`INSERT INTO accounts(id,installation_id,email_normalized,password_hash,locale,theme,password_changed_at) VALUES($1,$2,$3,$4,'nb','system',clock_timestamp())`,[credentials.accountId,installation.id,credentials.email,passwordHash]);
      await client.query(`INSERT INTO memberships(id,household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,$4,'household_admin',$5)`,[credentials.membershipId,credentials.householdId,credentials.accountId,credentials.personId,JSON.stringify(liveE2eCapabilities)]);
      await client.query(`INSERT INTO live_e2e_registrations(id,installation_id,household_id,account_id,membership_id,marker_hash) VALUES($1,$2,$3,$4,$5,$6)`,[credentials.registrationId,installation.id,credentials.householdId,credentials.accountId,credentials.membershipId,markerHash(credentials.marker)]);
      await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,action,subject_type,subject_id,metadata) VALUES($1,$2,'system','live_e2e.provisioned','live_e2e_registration',$3,$4)`,[installation.id,credentials.householdId,credentials.registrationId,JSON.stringify({synthetic:true,purpose:PURPOSE})]);
      return false;
    });
    await validateRegistration(credentials);
    return{registrationId:credentials.registrationId,householdId:credentials.householdId,accountId:credentials.accountId,membershipId:credentials.membershipId,idempotent};
  }catch(error){
    // Keep a newly created, exclusive credential file: rerunning with the same
    // material is the only safe way to recover after an interrupted DB commit.
    void created;throw error;
  }
}

export interface LiveE2eAttestation {registrationId:string;householdId:string;personId:string;accountId:string;membershipId:string;purpose:typeof PURPOSE;dataKind:'synthetic';markerProof:string;}
export async function liveE2eAttestation(accountId:string):Promise<LiveE2eAttestation>{
  const result=await pool.query<{id:string;household_id:string;person_id:string;account_id:string;membership_id:string;marker_hash:string;data_kind:string;role_preset:string;capabilities:unknown;membership_count:number;household_membership_count:number;person_count:number}>(`
    SELECT r.id,r.household_id,m.person_id,r.account_id,r.membership_id,r.marker_hash,h.data_kind,m.role_preset,m.capabilities,
      (SELECT count(*)::int FROM memberships WHERE account_id=r.account_id) AS membership_count,
      (SELECT count(*)::int FROM memberships WHERE household_id=r.household_id) AS household_membership_count,
      (SELECT count(*)::int FROM persons WHERE household_id=r.household_id) AS person_count
    FROM live_e2e_registrations r JOIN households h ON h.id=r.household_id
    JOIN accounts a ON a.id=r.account_id AND a.disabled_at IS NULL
    JOIN memberships m ON m.id=r.membership_id AND m.household_id=r.household_id AND m.account_id=r.account_id
    WHERE r.account_id=$1`,[accountId]);
  const row=result.rows[0];if(!row||row.data_kind!=='synthetic'||row.role_preset!=='household_admin'||!hasExactCapabilities(row.capabilities,liveE2eCapabilities)||row.membership_count!==1||row.household_membership_count!==1||row.person_count!==1)throw new DomainError('NOT_FOUND',404);
  return{registrationId:row.id,householdId:row.household_id,personId:row.person_id,accountId:row.account_id,membershipId:row.membership_id,purpose:PURPOSE,dataKind:'synthetic',markerProof:`sha256:${row.marker_hash}`};
}

type JsonObject=Record<string,unknown>;
function safeTools(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((item):item is string=>item==='web.open'||item==='weather.forecast'))]:[];}
function safeAttempts(value:unknown):Array<{tool:string;outcome:string;errorCode:string|null}>{
  if(!Array.isArray(value))return[];return value.flatMap((raw)=>{if(!raw||typeof raw!=='object')return[];const item=raw as JsonObject;if(!['web.open','weather.forecast'].includes(String(item.tool))||!['success','failed'].includes(String(item.outcome)))return[];const candidate=typeof item.errorCode==='string'?item.errorCode:typeof item.error_code==='string'?item.error_code:null;return[{tool:String(item.tool),outcome:String(item.outcome),errorCode:candidate&&/^[A-Z][A-Z0-9_]{1,63}$/.test(candidate)?candidate:null}];});
}
function safeSourceUrl(value:unknown):string|null{if(typeof value!=='string')return null;try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return null;url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return null;}}
function safeProvenance(value:unknown):Array<JsonObject>{
  if(!Array.isArray(value))return[];return value.flatMap((raw)=>{if(!raw||typeof raw!=='object')return[];const item=raw as JsonObject;const tool=String(item.tool);if(!['web.open','weather.forecast'].includes(tool))return[];
    const sourceUrl=typeof item.finalUrl==='string'?(tool==='weather.forecast'?'https://api.met.no/weatherapi/locationforecast/2.0/documentation':item.finalUrl):undefined;
    if(!sourceUrl)return[];try{new URL(sourceUrl);}catch{return[];}
    return[{tool,sourceUrl:safeSourceUrl(sourceUrl),fetchedAt:typeof item.fetchedAt==='string'?item.fetchedAt:null,httpStatus:Number.isInteger(item.httpStatus)?item.httpStatus:null,fingerprint:typeof item.fingerprint==='string'?item.fingerprint:null,...(typeof item.cacheStatus==='string'&&['hit','miss','revalidated'].includes(item.cacheStatus)?{cacheStatus:item.cacheStatus}:{}),...(typeof item.attribution==='string'?{attribution:item.attribution}:{}),...(typeof item.canonicalLocation==='string'?{canonicalLocation:item.canonicalLocation}:{}),...(typeof item.validFrom==='string'?{validFrom:item.validFrom}:{}),...(typeof item.validTo==='string'?{validTo:item.validTo}:{})}];});
}
const timingNumberFields=['queueWaitMs','providerTurns','toolCalls','webOpenMs','locationMs','weatherMs','providerMs','totalMs'] as const;
function safeTiming(value:unknown):JsonObject{
  if(!value||typeof value!=='object'||Array.isArray(value))return{};const source=value as JsonObject;const result:JsonObject={};
  for(const field of timingNumberFields){const candidate=source[field];if(typeof candidate==='number'&&Number.isFinite(candidate)&&candidate>=0)result[field]=candidate;}
  if(typeof source.qualityEscalated==='boolean')result.qualityEscalated=source.qualityEscalated;
  return result;
}

export async function liveE2eExecutionEvidence(accountId:string,householdId:string,taskId:string,executionId:string):Promise<JsonObject>{
  const attestation=await liveE2eAttestation(accountId);if(attestation.householdId!==householdId)throw new DomainError('NOT_FOUND',404);
  const execution=(await pool.query<{id:string;task_id:string;task_revision:number;kind:string;status:string;latency_class:string;max_runtime_ms:number;progress_stage:string;queued_at:Date;started_at:Date|null;completed_at:Date|null;error_code:string|null;timeout_reason:string|null;timing:JsonObject;required_tools:unknown}>(`
    SELECT e.id,e.task_id,e.task_revision,e.kind,e.status,e.latency_class,e.max_runtime_ms,e.progress_stage,e.queued_at,e.started_at,e.completed_at,e.error_code,e.timeout_reason,e.timing,e.required_tools
    FROM monitor_executions e JOIN monitor_tasks t ON t.id=e.task_id AND t.household_id=e.household_id
    WHERE e.id=$1 AND e.task_id=$2 AND e.household_id=$3`,[executionId,taskId,householdId])).rows[0];
  if(!execution)throw new DomainError('NOT_FOUND',404);
  const [toolAudits,run,quality,messages]=await Promise.all([
    pool.query<{outcome:string;error_code:string|null;ai_call_count:number;attempted_tool_count:number;tool_count:number;provenance:unknown;attempts:unknown;created_at:Date}>(`SELECT outcome,error_code,ai_call_count,attempted_tool_count,tool_count,provenance,attempts,created_at FROM monitor_tool_audits WHERE execution_id=$1 AND task_id=$2 AND task_revision=$3 ORDER BY created_at,id`,[executionId,taskId,execution.task_revision]),
    pool.query<{outcome:string;result_kind:string|null;source_url:string|null;tool_provenance:unknown;dependency_manifest:unknown;checked_at:Date}>(`SELECT outcome,result_kind,source_url,tool_provenance,dependency_manifest,checked_at FROM monitor_runs WHERE execution_id=$1 AND task_id=$2 AND task_revision=$3 ORDER BY checked_at DESC,id DESC LIMIT 1`,[executionId,taskId,execution.task_revision]),
    pool.query<{reason:string;outcome:string}>(`SELECT reason,outcome FROM monitor_quality_audits WHERE execution_id=$1 AND task_id=$2 AND task_revision=$3 ORDER BY created_at,id`,[executionId,taskId,execution.task_revision]),
    pool.query<{count:number}>(`SELECT count(DISTINCT message_id)::int AS count FROM (
      SELECT message_id FROM message_lifecycle_events WHERE execution_id=$1
      UNION ALL
      SELECT message_id FROM monitor_events WHERE task_id=$2 AND message_id IS NOT NULL
    ) emitted_messages`,[executionId,taskId])
  ]);
  const provenance=toolAudits.rows.flatMap((row)=>safeProvenance(row.provenance));const attempts=toolAudits.rows.flatMap((row)=>safeAttempts(row.attempts));
  return{synthetic:true,registrationId:attestation.registrationId,householdId,taskId,execution:{id:execution.id,taskRevision:execution.task_revision,kind:execution.kind,status:execution.status,latencyClass:execution.latency_class,serverDeadlineMs:execution.max_runtime_ms,progressStage:execution.progress_stage,queuedAt:execution.queued_at.toISOString(),startedAt:execution.started_at?.toISOString()??null,completedAt:execution.completed_at?.toISOString()??null,errorCode:execution.error_code,timeoutReason:execution.timeout_reason,timing:safeTiming(execution.timing)},requiredTools:safeTools(execution.required_tools),actualTools:[...new Set(provenance.map((item)=>String(item.tool)))],attempts,provenance,run:run.rows[0]?{outcome:run.rows[0].outcome,resultKind:run.rows[0].result_kind,sourceUrl:safeSourceUrl(run.rows[0].source_url),checkedAt:run.rows[0].checked_at.toISOString(),dependencyCount:Array.isArray(run.rows[0].dependency_manifest)?run.rows[0].dependency_manifest.length:0}:null,quality:{escalated:quality.rows.some((row)=>row.outcome==='escalated'),audits:quality.rows},messageCount:messages.rows[0]?.count??0,notificationEligible:['manual','scheduled'].includes(execution.kind)};
}
