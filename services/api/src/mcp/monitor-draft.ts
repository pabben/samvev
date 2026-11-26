import { createHash } from 'node:crypto';
import { monitorRecipientFreeDraftCreateSchema, type Capability } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { createRecipientFreeMonitorDraft, monitorSourcePlan, type MonitorActor } from '../monitor/service.ts';
import type { McpPrincipal } from './service.ts';

export const monitorDraftCreateInputSchema=monitorRecipientFreeDraftCreateSchema.extend({
  requestKey:z.uuid()
}).strict();

export const monitorDraftCreateOutputSchema=z.strictObject({
  creation:z.strictObject({
    taskId:z.uuid(),createdRevision:z.number().int().positive(),createdAs:z.literal('draft'),
    recipientCountAtCreation:z.literal(0),requiresBrowserCompletion:z.literal(true)
  })
});

type DraftInput=z.output<typeof monitorDraftCreateInputSchema>;
type DraftOutput=z.output<typeof monitorDraftCreateOutputSchema>;

interface Dependencies{
  transaction<T>(run:(client:DbClient)=>Promise<T>):Promise<T>;
  audit(client:DbClient,taskId:string,revision:number,fields?:string[]):Promise<void>;
}

const REQUIRED_SCOPES=['mcp:monitors:read','mcp:monitors:draft:write'] as const;
const REQUIRED_MANAGE_SCOPES=['mcp:monitors:read','mcp:monitors:draft:write','mcp:monitors:draft:manage'] as const;
const REQUIRED_CONTENT_SCOPES=['mcp:monitors:read','mcp:monitors:draft:write','mcp:monitors:draft:content'] as const;
const REQUIRED_CAPABILITIES=['household.manage','message.create.household','message.schedule'] as const satisfies readonly Capability[];

export const monitorDraftUpdateInputSchema=z.strictObject({
  taskId:z.uuid(),expectedRevision:z.number().int().positive(),
  name:z.string().trim().min(1).max(80).optional(),
  instruction:z.string().trim().min(10).max(2000).optional(),
  sourceUrl:z.string().trim().max(2048).optional(),
  checkIntervalMinutes:z.number().int().min(15).max(10080).optional(),
  noticeDaysBefore:z.number().int().min(0).max(30).optional(),
  noticeLocalTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  providerPolicy:z.enum(['default','local','openai']).optional(),
  modelTier:z.enum(['routine','strong']).optional(),
}).refine(value=>Object.entries(value).some(([key,field])=>key!=='taskId'&&key!=='expectedRevision'&&field!==undefined),{message:'at_least_one_proposal_field_required'});

export const monitorDraftUpdateOutputSchema=z.strictObject({taskId:z.uuid(),revision:z.number().int().positive()});
export const monitorDraftDeleteInputSchema=z.strictObject({taskId:z.uuid(),expectedRevision:z.number().int().positive()});
export const monitorDraftDeleteOutputSchema=z.strictObject({taskId:z.uuid(),revision:z.number().int().positive(),deleted:z.literal(true)});

export async function assertMcpMonitorDraftWriteAuthority(client:DbClient,principal:McpPrincipal):Promise<MonitorActor>{
  if(REQUIRED_SCOPES.some(scope=>!principal.scopes.includes(scope)))throw new DomainError('FORBIDDEN',403,{reason:'mcp_scope_required'});
  const row=(await client.query<{capabilities:Capability[]}>(`SELECT membership.capabilities
    FROM mcp_oauth_grants oauth_grant
    JOIN mcp_oauth_token_sets token_set ON token_set.grant_id=oauth_grant.id AND token_set.id=$5
    JOIN memberships membership ON membership.id=oauth_grant.membership_id
      AND membership.household_id=oauth_grant.household_id AND membership.account_id=oauth_grant.account_id
    JOIN accounts account ON account.id=oauth_grant.account_id AND account.installation_id=$8 AND account.disabled_at IS NULL
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
    JOIN households household ON household.id=oauth_grant.household_id AND household.installation_id=oauth_grant.installation_id
    JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
      AND oauth_client.installation_id=oauth_grant.installation_id AND oauth_client.revoked_at IS NULL
    WHERE oauth_grant.id=$1 AND oauth_grant.household_id=$2 AND oauth_grant.account_id=$3 AND oauth_grant.membership_id=$4
      AND oauth_grant.installation_id=$8
      AND oauth_grant.revoked_at IS NULL AND oauth_grant.scopes ?& $6::text[]
      AND token_set.revoked_at IS NULL AND token_set.access_expires_at>clock_timestamp() AND token_set.scopes ?& $6::text[]
      AND membership.capabilities ?& $7::text[]
    FOR SHARE OF oauth_grant,token_set,membership,account,person,household,oauth_client`,[
    principal.grantId,principal.householdId,principal.accountId,principal.membershipId,principal.tokenSetId,
    REQUIRED_SCOPES,REQUIRED_CAPABILITIES,principal.installationId
  ])).rows[0];
  if(!row)throw new DomainError('FORBIDDEN',403,{reason:'mcp_monitor_draft_authority_required'});
  return{accountId:principal.accountId,installationId:principal.installationId,householdId:principal.householdId,membershipId:principal.membershipId,capabilities:row.capabilities};
}

export async function assertMcpMonitorDraftManageAuthority(client:DbClient,principal:McpPrincipal):Promise<MonitorActor>{
  if(REQUIRED_MANAGE_SCOPES.some(scope=>!principal.scopes.includes(scope)))throw new DomainError('FORBIDDEN',403,{reason:'mcp_scope_required'});
  const row=(await client.query<{capabilities:Capability[]}>(`SELECT membership.capabilities
    FROM mcp_oauth_grants oauth_grant
    JOIN mcp_oauth_token_sets token_set ON token_set.grant_id=oauth_grant.id AND token_set.id=$5
    JOIN memberships membership ON membership.id=oauth_grant.membership_id
      AND membership.household_id=oauth_grant.household_id AND membership.account_id=oauth_grant.account_id
    JOIN accounts account ON account.id=oauth_grant.account_id AND account.installation_id=$8 AND account.disabled_at IS NULL
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
    JOIN households household ON household.id=oauth_grant.household_id AND household.installation_id=oauth_grant.installation_id
    JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id
      AND oauth_client.installation_id=oauth_grant.installation_id AND oauth_client.revoked_at IS NULL
    WHERE oauth_grant.id=$1 AND oauth_grant.household_id=$2 AND oauth_grant.account_id=$3 AND oauth_grant.membership_id=$4
      AND oauth_grant.installation_id=$8
      AND oauth_grant.revoked_at IS NULL AND oauth_grant.scopes ?& $6::text[]
      AND token_set.revoked_at IS NULL AND token_set.access_expires_at>clock_timestamp() AND token_set.scopes ?& $6::text[]
      AND membership.capabilities ?& $7::text[]
    FOR SHARE OF oauth_grant,token_set,membership,account,person,household,oauth_client`,[
    principal.grantId,principal.householdId,principal.accountId,principal.membershipId,principal.tokenSetId,
    REQUIRED_MANAGE_SCOPES,REQUIRED_CAPABILITIES,principal.installationId
  ])).rows[0];
  if(!row)throw new DomainError('FORBIDDEN',403,{reason:'mcp_monitor_draft_manage_authority_required'});
  return{accountId:principal.accountId,installationId:principal.installationId,householdId:principal.householdId,membershipId:principal.membershipId,capabilities:row.capabilities};
}

const DRAFT_ELIGIBILITY_SQL=`
  SELECT task.id,task.revision,task.name,task.instruction,task.source_url,task.check_interval_minutes,
    task.notice_days_before,to_char(task.notice_local_time,'HH24:MI') AS notice_local_time,task.provider_policy,task.model_tier
  FROM monitor_tasks task
  WHERE task.id=$1 AND task.household_id=$2 AND task.owner_membership_id=$3 AND task.state='draft'
    AND task.approved_revision IS NULL AND task.approved_ai_provider IS NULL
    AND task.approved_ai_registration_id IS NULL AND task.approved_ai_registration_generation IS NULL
    AND task.interpreted_rule IS NULL AND task.subjects_revision=1 AND task.subjects_updated_at IS NULL
    AND task.last_checked_at IS NULL AND task.next_check_at IS NULL AND task.last_result IS NULL AND task.last_changed_at IS NULL
    AND task.check_count=0 AND task.ai_call_count=0 AND task.unchanged_count=0
    AND task.source_final_url IS NULL AND task.source_content_type IS NULL AND task.source_etag IS NULL
    AND task.source_last_modified IS NULL AND task.last_processed_fingerprint IS NULL AND task.error_code IS NULL
    AND task.lease_token IS NULL AND task.lease_expires_at IS NULL
    AND EXISTS(SELECT 1 FROM mcp_monitor_draft_requests receipt
      WHERE receipt.household_id=task.household_id AND receipt.grant_id=$4 AND receipt.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_task_person_targets target WHERE target.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_task_display_targets target WHERE target.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_runs run WHERE run.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_executions execution WHERE execution.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_events event WHERE event.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_tool_audits tool_audit WHERE tool_audit.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_quality_audits quality_audit WHERE quality_audit.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_task_subjects subject WHERE subject.task_id=task.id)
    AND NOT EXISTS(SELECT 1 FROM monitor_task_subject_audits subject_audit WHERE subject_audit.task_id=task.id)`;

export const monitorDraftGetInputSchema=z.strictObject({taskId:z.uuid()});
export const monitorDraftGetOutputSchema=z.strictObject({
  taskId:z.uuid(),revision:z.number().int().positive(),name:z.string().max(80),instruction:z.string().max(2000),sourceUrl:z.string().max(2048).nullable(),
  checkIntervalMinutes:z.number().int().min(15).max(10080),noticeDaysBefore:z.number().int().min(0).max(30),noticeLocalTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  providerPolicy:z.enum(['default','local','openai']),modelTier:z.enum(['routine','strong'])
});

export async function getMcpMonitorDraft(principal:McpPrincipal,raw:unknown,deps:Pick<Dependencies,'transaction'|'audit'>):Promise<z.output<typeof monitorDraftGetOutputSchema>>{
  const input=monitorDraftGetInputSchema.parse(raw);
  if(REQUIRED_CONTENT_SCOPES.some(scope=>!principal.scopes.includes(scope)))throw new DomainError('FORBIDDEN',403,{reason:'mcp_scope_required'});
  return deps.transaction(async client=>{
    await assertDraftContentAuthority(client,principal);
    await assertMcpDraftReceipt(client,principal,input.taskId);
    await client.query('SELECT id FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR SHARE',[input.taskId,principal.householdId]);
    const current=(await client.query<Record<string,unknown>>(DRAFT_ELIGIBILITY_SQL,[input.taskId,principal.householdId,principal.membershipId,principal.grantId])).rows[0];
    if(!current)throw new DomainError('NOT_FOUND',404);
    await assertDraftContentAuthority(client,principal);
    const result=monitorDraftGetOutputSchema.parse({taskId:input.taskId,revision:Number(current.revision),name:current.name,instruction:current.instruction,
      sourceUrl:current.source_url??null,checkIntervalMinutes:Number(current.check_interval_minutes),noticeDaysBefore:Number(current.notice_days_before),
      noticeLocalTime:current.notice_local_time,providerPolicy:current.provider_policy,modelTier:current.model_tier});
    await deps.audit(client,input.taskId,result.revision);
    return result;
  });
}

async function assertDraftContentAuthority(client:DbClient,principal:McpPrincipal):Promise<void>{
  const row=await client.query(`SELECT 1 FROM mcp_oauth_grants oauth_grant
    JOIN mcp_oauth_token_sets token_set ON token_set.grant_id=oauth_grant.id AND token_set.id=$5
    JOIN memberships membership ON membership.id=oauth_grant.membership_id AND membership.household_id=oauth_grant.household_id AND membership.account_id=oauth_grant.account_id
    JOIN accounts account ON account.id=oauth_grant.account_id AND account.installation_id=$8 AND account.disabled_at IS NULL
    JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult'
    JOIN households household ON household.id=oauth_grant.household_id AND household.installation_id=oauth_grant.installation_id
    JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id AND oauth_client.installation_id=oauth_grant.installation_id AND oauth_client.revoked_at IS NULL
    WHERE oauth_grant.id=$1 AND oauth_grant.household_id=$2 AND oauth_grant.account_id=$3 AND oauth_grant.membership_id=$4 AND oauth_grant.installation_id=$8
      AND oauth_grant.revoked_at IS NULL AND oauth_grant.scopes ?& $6::text[] AND token_set.revoked_at IS NULL
      AND token_set.access_expires_at>clock_timestamp() AND token_set.scopes ?& $6::text[] AND membership.capabilities ?& $7::text[]
    FOR SHARE OF oauth_grant,token_set,membership,account,person,household,oauth_client`,[
    principal.grantId,principal.householdId,principal.accountId,principal.membershipId,principal.tokenSetId,REQUIRED_CONTENT_SCOPES,REQUIRED_CAPABILITIES,principal.installationId
  ]);
  if(!row.rowCount)throw new DomainError('FORBIDDEN',403,{reason:'mcp_monitor_draft_content_authority_required'});
}

async function assertMcpDraftReceipt(client:DbClient,principal:McpPrincipal,taskId:string):Promise<void>{
  const receipt=await client.query(`SELECT 1 FROM mcp_monitor_draft_requests
    WHERE household_id=$1 AND grant_id=$2 AND task_id=$3 LIMIT 1`,[principal.householdId,principal.grantId,taskId]);
  if(!receipt.rowCount)throw new DomainError('NOT_FOUND',404);
}

export async function updateMcpMonitorDraft(principal:McpPrincipal,raw:unknown,deps:Dependencies):Promise<z.output<typeof monitorDraftUpdateOutputSchema>>{
  const input=monitorDraftUpdateInputSchema.parse(raw);
  const fields=Object.entries(input).filter(([key,value])=>key!=='taskId'&&key!=='expectedRevision'&&value!==undefined).map(([key])=>key).sort();
  return deps.transaction(async client=>{
    await assertMcpMonitorDraftManageAuthority(client,principal);
    await assertMcpDraftReceipt(client,principal,input.taskId);
    const locked=(await client.query<{revision:number}>(`SELECT revision FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR UPDATE`,[input.taskId,principal.householdId])).rows[0];
    if(!locked)throw new DomainError('NOT_FOUND',404);
    // This eligibility read intentionally follows both row-lock waits above.
    const current=(await client.query<Record<string,unknown>>(DRAFT_ELIGIBILITY_SQL,[input.taskId,principal.householdId,principal.membershipId,principal.grantId])).rows[0];
    if(!current)throw new DomainError('NOT_FOUND',404);
    if(Number(current.revision)!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409);
    const instruction=input.instruction!==undefined?input.instruction:String(current.instruction);
    const sourceUrl=input.sourceUrl!==undefined?input.sourceUrl:current.source_url as string|undefined;
    const plan=monitorSourcePlan(instruction,sourceUrl);
    const updated=(await client.query<{revision:number}>(`UPDATE monitor_tasks SET
      name=$4,instruction=$5,source_url=$6,tool_plan=$7,check_interval_minutes=$8,notice_days_before=$9,
      notice_local_time=$10,provider_policy=$11,model_tier=$12,revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND household_id=$2 AND owner_membership_id=$3 AND state='draft' AND revision=$13
      RETURNING revision`,[
      input.taskId,principal.householdId,principal.membershipId,
      input.name!==undefined?input.name:current.name,instruction,plan.sourceUrl,JSON.stringify(plan.tools),
      input.checkIntervalMinutes!==undefined?input.checkIntervalMinutes:current.check_interval_minutes,
      input.noticeDaysBefore!==undefined?input.noticeDaysBefore:current.notice_days_before,
      input.noticeLocalTime!==undefined?input.noticeLocalTime:current.notice_local_time,
      input.providerPolicy!==undefined?input.providerPolicy:current.provider_policy,
      input.modelTier!==undefined?input.modelTier:current.model_tier,input.expectedRevision
    ])).rows[0];
    if(!updated)throw new DomainError('REVISION_CONFLICT',409);
    await deps.audit(client,input.taskId,updated.revision,fields);
    await assertMcpMonitorDraftManageAuthority(client,principal);
    return{taskId:input.taskId,revision:updated.revision};
  });
}

export async function deleteMcpMonitorDraft(principal:McpPrincipal,raw:unknown,deps:Dependencies):Promise<z.output<typeof monitorDraftDeleteOutputSchema>>{
  const input=monitorDraftDeleteInputSchema.parse(raw);
  return deps.transaction(async client=>{
    await assertMcpMonitorDraftManageAuthority(client,principal);
    await assertMcpDraftReceipt(client,principal,input.taskId);
    const locked=(await client.query<{revision:number}>(`SELECT revision FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR UPDATE`,[input.taskId,principal.householdId])).rows[0];
    if(!locked)throw new DomainError('NOT_FOUND',404);
    // Keep browser-created, completed, targeted, or historical tasks outside this lifecycle.
    const current=(await client.query<Record<string,unknown>>(DRAFT_ELIGIBILITY_SQL,[input.taskId,principal.householdId,principal.membershipId,principal.grantId])).rows[0];
    if(!current)throw new DomainError('NOT_FOUND',404);
    if(Number(current.revision)!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409);
    const deleted=(await client.query<{revision:number}>(`DELETE FROM monitor_tasks
      WHERE id=$1 AND household_id=$2 AND owner_membership_id=$3 AND state='draft' AND revision=$4 RETURNING revision`,
      [input.taskId,principal.householdId,principal.membershipId,input.expectedRevision])).rows[0];
    if(!deleted)throw new DomainError('REVISION_CONFLICT',409);
    await deps.audit(client,input.taskId,deleted.revision,['deleted']);
    await assertMcpMonitorDraftManageAuthority(client,principal);
    return{taskId:input.taskId,revision:deleted.revision,deleted:true};
  });
}

function canonicalPayload(input:DraftInput){
  return{name:input.name??null,instruction:input.instruction,sourceUrl:input.sourceUrl??null,
    checkIntervalMinutes:input.checkIntervalMinutes,noticeDaysBefore:input.noticeDaysBefore,
    noticeLocalTime:input.noticeLocalTime,providerPolicy:input.providerPolicy,modelTier:input.modelTier};
}

export async function createMcpMonitorDraft(principal:McpPrincipal,raw:unknown,deps:Dependencies):Promise<DraftOutput>{
  const input=monitorDraftCreateInputSchema.parse(raw);
  const {requestKey,...draftInput}=input;
  // The legacy request_key column stores only this digest, never the client UUID.
  const requestKeyHash=createHash('sha256').update(requestKey).digest('hex');
  const requestHash=createHash('sha256').update(JSON.stringify(canonicalPayload(input))).digest('hex');
  return deps.transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`monitor-draft-grant:${principal.grantId}`]);
    const actor=await assertMcpMonitorDraftWriteAuthority(client,principal);
    const receipt=(await client.query<{request_hash:string;task_id:string;task_revision:number}>(`SELECT request_hash,task_id,task_revision
      FROM mcp_monitor_draft_requests WHERE household_id=$1 AND grant_id=$2 AND request_key=$3`,[
      principal.householdId,principal.grantId,requestKeyHash
    ])).rows[0];
    if(receipt){
      if(receipt.request_hash!==requestHash)throw new DomainError('CONFLICT',409,{reason:'idempotency_payload_mismatch'});
      await assertMcpMonitorDraftWriteAuthority(client,principal);
      return{creation:{taskId:receipt.task_id,createdRevision:receipt.task_revision,createdAs:'draft',recipientCountAtCreation:0,requiresBrowserCompletion:true}};
    }
    const recentReceipts=(await client.query<{count:number}>(`SELECT count(*)::int AS count FROM mcp_monitor_draft_requests
      WHERE grant_id=$1 AND created_at>=clock_timestamp()-interval '24 hours'`,[principal.grantId])).rows[0]?.count??0;
    if(recentReceipts>=50)throw new DomainError('RATE_LIMITED',429,{reason:'mcp_monitor_draft_daily_limit'});
    const draft=await createRecipientFreeMonitorDraft(client,actor,draftInput);
    await deps.audit(client,draft.id,draft.revision);
    await client.query(`INSERT INTO mcp_monitor_draft_requests(household_id,grant_id,request_key,request_hash,task_id,task_revision)
      VALUES($1,$2,$3,$4,$5,$6)`,[principal.householdId,principal.grantId,requestKeyHash,requestHash,draft.id,draft.revision]);
    await assertMcpMonitorDraftWriteAuthority(client,principal);
    return{creation:{taskId:draft.id,createdRevision:draft.revision,createdAs:'draft',recipientCountAtCreation:0,requiresBrowserCompletion:true}};
  });
}
