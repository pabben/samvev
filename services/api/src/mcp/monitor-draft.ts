import { createHash } from 'node:crypto';
import { monitorRecipientFreeDraftCreateSchema, type Capability } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { createRecipientFreeMonitorDraft, type MonitorActor } from '../monitor/service.ts';
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
  audit(client:DbClient,taskId:string,revision:number):Promise<void>;
}

const REQUIRED_SCOPES=['mcp:monitors:read','mcp:monitors:draft:write'] as const;
const REQUIRED_CAPABILITIES=['household.manage','message.create.household','message.schedule'] as const satisfies readonly Capability[];

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
