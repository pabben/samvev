import type { Capability } from '@samvev/contracts';
import { requireCapability } from '@samvev/core';
import { z } from 'zod';
import type { DbClient } from '../db.ts';
import { requireGrantedMessageAudience } from '../messages/service.ts';
import { MonitorService, type MonitorActor } from '../monitor/service.ts';

export const monitorPauseInputSchema=z.strictObject({
  taskId:z.uuid(),
  expectedRevision:z.number().int().positive(),
});

export const monitorPauseOutputSchema=z.strictObject({
  taskId:z.uuid(),
  state:z.literal('paused'),
  revision:z.number().int().positive(),
});

export interface McpMonitorPausePrincipal {
  grantId:string;
  clientDatabaseId:string;
  accountId:string;
  membershipId:string;
  householdId:string;
  installationId:string;
}

export interface McpMonitorPauseDependencies {
  authorize:(client:DbClient)=>Promise<Capability[]>;
  audit:(client:DbClient,input:{taskId:string;revision:number})=>Promise<void>;
  monitors?:MonitorService;
}

/** Pause through the browser domain lifecycle while keeping delegated
 * recipient authorization and the MCP audit in the same transaction. */
export async function pauseMcpMonitor(
  principal:McpMonitorPausePrincipal,
  input:z.infer<typeof monitorPauseInputSchema>,
  dependencies:McpMonitorPauseDependencies,
):Promise<z.infer<typeof monitorPauseOutputSchema>>{
  const body=monitorPauseInputSchema.parse(input);
  const actor:MonitorActor={
    accountId:principal.accountId,
    installationId:principal.installationId,
    householdId:principal.householdId,
    membershipId:principal.membershipId,
    capabilities:[],
  };
  const result=await (dependencies.monitors??new MonitorService()).setState(actor,body.taskId,body.expectedRevision,'pause',{
    authorize:dependencies.authorize,
    authorizeWithdrawal:async(client,message,capabilities)=>{
      await requireGrantedMessageAudience(client,{...actor,mcpGrantId:principal.grantId},capabilities,message.id,message.audience_household,false);
      if(message.author_membership_id!==principal.membershipId)requireCapability(capabilities,'message.manage.household');
    },
    audit:async(client,_actor,_action,taskId,revision)=>dependencies.audit(client,{taskId,revision}),
  });
  return monitorPauseOutputSchema.parse({
    taskId:result.id,
    state:result.state,
    revision:result.revision,
  });
}
