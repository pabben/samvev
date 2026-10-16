import { DomainError } from '@samvev/core';
import { z } from 'zod';
import { transaction, type DbClient } from '../db.ts';

export interface MonitorPresentationActor {
  accountId:string;
  sessionId:string;
  installationId:string;
  householdId:string;
  membershipId:string;
}

const localTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const monitorPresentationUpdateSchema=z.object({
  expectedPresentationRevision:z.number().int().positive(),
  presentationKind:z.enum(['school']).nullable(),
  schoolEndLocalTime:localTime.nullable()
}).strict().refine((value)=>value.presentationKind==='school'||value.schoolEndLocalTime===null,{path:['schoolEndLocalTime'],message:'school end time requires school presentation'});
export type MonitorPresentationUpdate=z.infer<typeof monitorPresentationUpdateSchema>;

export async function updateMonitorPresentation(actor:MonitorPresentationActor,taskId:string,input:MonitorPresentationUpdate):Promise<Record<string,unknown>>{
  return transaction(async(client)=>{
    const liveSession=await client.query(`SELECT id FROM sessions WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,[actor.sessionId,actor.accountId]);
    if(!liveSession.rowCount)throw new DomainError('FORBIDDEN',403);
    const authority=await client.query<{capabilities:string[]}>(`SELECT membership.capabilities
      FROM memberships membership JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL
      WHERE membership.id=$1 AND membership.account_id=$2 AND membership.household_id=$3 FOR SHARE OF membership,account`,[actor.membershipId,actor.accountId,actor.householdId]);
    if(!authority.rows[0]?.capabilities.includes('household.manage'))throw new DomainError('FORBIDDEN',403);
    const current=(await client.query<{presentation_revision:number}>(`SELECT presentation_revision FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR UPDATE`,[taskId,actor.householdId])).rows[0];
    if(!current)throw new DomainError('NOT_FOUND',404);
    if(current.presentation_revision!==input.expectedPresentationRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'monitor_presentation'});
    const next=current.presentation_revision+1;
    const updated=await client.query<{presentation_kind:string|null;school_end_local_time:string|null;presentation_revision:number}>(`UPDATE monitor_tasks
      SET presentation_kind=$3,school_end_local_time=$4::time,presentation_revision=$5,presentation_updated_at=clock_timestamp()
      WHERE id=$1 AND household_id=$2 AND presentation_revision=$6
      RETURNING presentation_kind,school_end_local_time::text,presentation_revision`,[taskId,actor.householdId,input.presentationKind,input.schoolEndLocalTime,next,current.presentation_revision]);
    if(!updated.rowCount)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'monitor_presentation'});
    if(input.presentationKind==='school'){
      await client.query(`UPDATE monitor_events event SET school_expires_at=COALESCE(event.school_expires_at,
          ((event.event_date + COALESCE($3::time,TIME '13:00')) AT TIME ZONE household.timezone))
        FROM households household
        WHERE event.task_id=$1 AND event.household_id=$2 AND household.id=event.household_id`,[taskId,actor.householdId,input.schoolEndLocalTime]);
    }
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
      VALUES($1,$2,'account',$3,'monitor.presentation_updated','monitor_task',$4,$5)`,[actor.installationId,actor.householdId,actor.accountId,taskId,JSON.stringify({presentationKind:input.presentationKind,schoolEndLocalTime:input.schoolEndLocalTime,presentationRevision:next})]);
    // Initial SHARE locks keep session/account/membership authority stable, but
    // wall-clock expiry can pass during task, event or audit waits. This final
    // read adds no lock-order inversion and rolls back every write on expiry.
    const finalAuthority=await client.query(`SELECT session.id
      FROM sessions session JOIN accounts account ON account.id=session.account_id
      JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$3
      WHERE session.id=$1 AND session.account_id=$2 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
        AND account.disabled_at IS NULL AND membership.id=$4 AND membership.capabilities ? 'household.manage'`,[actor.sessionId,actor.accountId,actor.householdId,actor.membershipId]);
    if(!finalAuthority.rowCount)throw new DomainError('FORBIDDEN',403);
    return{taskId,presentationKind:updated.rows[0]!.presentation_kind,schoolEndLocalTime:updated.rows[0]!.school_end_local_time?.slice(0,5)??null,presentationRevision:updated.rows[0]!.presentation_revision};
  });
}
