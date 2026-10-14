import { DomainError } from '@samvev/core';
import { transaction, type DbClient } from '../db.ts';

interface SubjectActor {accountId:string;installationId:string;householdId:string;membershipId:string;}

export async function replaceMonitorSubjects(actor:SubjectActor,taskId:string,input:{expectedSubjectsRevision:number;personIds:string[]}):Promise<{taskId:string;subjectsRevision:number;personIds:string[]}>{
  return transaction(async(client)=>{
    const authority=await client.query<{capabilities:string[]}>(`SELECT m.capabilities FROM memberships m JOIN accounts a ON a.id=m.account_id AND a.disabled_at IS NULL WHERE m.id=$1 AND m.account_id=$2 AND m.household_id=$3 FOR SHARE OF m,a`,[actor.membershipId,actor.accountId,actor.householdId]);
    if(!authority.rows[0]?.capabilities.includes('household.manage'))throw new DomainError('FORBIDDEN',403);
    const task=(await client.query<{subjects_revision:number}>(`SELECT subjects_revision FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR UPDATE`,[taskId,actor.householdId])).rows[0];
    if(!task)throw new DomainError('NOT_FOUND',404);
    if(task.subjects_revision!==input.expectedSubjectsRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'subjects'});
    if(input.personIds.length){
      const people=await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[])',[actor.householdId,input.personIds]);
      if(people.rowCount!==input.personIds.length)throw new DomainError('NOT_FOUND',404,{reason:'person_subject_not_found'});
    }
    const previous=(await client.query<{person_id:string}>('SELECT person_id FROM monitor_task_subjects WHERE task_id=$1 ORDER BY person_id',[taskId])).rows.map((row)=>row.person_id);
    await client.query('DELETE FROM monitor_task_subjects WHERE task_id=$1',[taskId]);
    for(const personId of [...input.personIds].sort())await client.query(`INSERT INTO monitor_task_subjects(household_id,task_id,person_id) VALUES($1,$2,$3)`,[actor.householdId,taskId,personId]);
    const next=input.expectedSubjectsRevision+1;
    await client.query('UPDATE monitor_tasks SET subjects_revision=$3,subjects_updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2',[taskId,actor.householdId,next]);
    await client.query(`INSERT INTO monitor_task_subject_audits(household_id,task_id,subjects_revision,actor_account_id,previous_person_ids,person_ids) VALUES($1,$2,$3,$4,$5,$6)`,[actor.householdId,taskId,next,actor.accountId,previous,input.personIds]);
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,'monitor.subjects_updated','monitor_task',$4,$5)`,[actor.installationId,actor.householdId,actor.accountId,taskId,JSON.stringify({subjectsRevision:next,previousCount:previous.length,subjectCount:input.personIds.length})]);
    return{taskId,subjectsRevision:next,personIds:[...input.personIds].sort()};
  });
}

function resultHasFindings(kind:unknown,value:unknown):boolean{
  if(!value||typeof value!=='object')return false;const result=value as Record<string,unknown>;
  if(kind==='events')return Array.isArray(result.events)&&result.events.length>0;
  return kind==='answer'&&typeof result.answer==='string'&&result.answer.trim().length>0;
}
function taskStatus(row:Record<string,unknown>):'running'|'not_run'|'no_findings'|'no_change'|'failed'|'findings'|'superseded'{
  if(row.active_status==='queued'||row.active_status==='running')return'running';
  if(!row.last_outcome)return'not_run';
  if(row.last_outcome==='failed')return'failed';
  if(row.last_outcome==='unchanged')return resultHasFindings(row.stored_result_kind,row.stored_result)?'findings':'no_change';
  return row.last_outcome==='changed'?(resultHasFindings(row.last_result_kind,row.last_run_result)?'findings':'no_findings'):'superseded';
}
function safeAttemptError(row:Record<string,unknown>):string|null{if(row.last_outcome!=='failed')return null;return typeof row.last_error_code==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(row.last_error_code)?row.last_error_code:'MONITOR_EXECUTION_FAILED';}

export async function personMonitorSummaries(client:DbClient,householdId:string,personId:string,accountId:string):Promise<Record<string,unknown>[]>{
  const rows=await client.query<Record<string,unknown>>(`
    SELECT t.id,t.name,t.state,t.revision,t.subjects_revision,t.last_checked_at,t.next_check_at,
      active.status AS active_status,active.at AS active_at,
      latest.logical_id AS last_logical_id,latest.run_id AS last_result_run_id,latest.outcome AS last_outcome,latest.checked_at AS last_run_at,latest.error_code AS last_error_code,latest.result_kind AS last_result_kind,latest.result AS last_run_result,
      success.id AS result_run_id,success.task_revision AS result_task_revision,success.result AS stored_result,success.result_kind AS stored_result_kind,success.source_url AS result_source_url,success.checked_at AS result_recorded_at,
      review.disposition AS result_disposition,COALESCE(review.revision,0) AS result_review_revision
    FROM monitor_task_subjects s JOIN monitor_tasks t ON t.id=s.task_id AND t.household_id=s.household_id
    LEFT JOIN LATERAL (
      SELECT e.status,COALESCE(e.started_at,e.queued_at) at FROM monitor_executions e
      WHERE e.task_id=t.id AND e.task_revision=t.revision AND e.kind IN ('scheduled','manual') AND e.status IN ('queued','running')
      ORDER BY CASE e.status WHEN 'running' THEN 0 ELSE 1 END,COALESCE(e.started_at,e.queued_at) DESC,e.id DESC LIMIT 1
    ) active ON true
    LEFT JOIN LATERAL (
      SELECT attempt.logical_id,attempt.run_id,attempt.outcome,attempt.checked_at,attempt.error_code,attempt.result_kind,attempt.result
      FROM (
        SELECT e.id::text logical_id,r.id run_id,
          CASE WHEN e.status IN ('failed','superseded') THEN e.status ELSE r.outcome END outcome,
          CASE WHEN e.status IN ('failed','superseded') THEN COALESCE(e.completed_at,e.updated_at) ELSE COALESCE(r.checked_at,e.completed_at,e.updated_at) END checked_at,
          CASE WHEN e.status IN ('failed','superseded') THEN e.error_code ELSE COALESCE(r.error_code,e.error_code) END error_code,r.result_kind,r.result
        FROM monitor_executions e
        LEFT JOIN monitor_runs r ON r.execution_id=e.id AND r.task_id=e.task_id AND r.task_revision=e.task_revision AND r.run_kind=e.kind
        WHERE e.task_id=t.id AND e.task_revision=t.revision AND e.kind IN ('scheduled','manual') AND e.status IN ('succeeded','failed','superseded')
        UNION ALL
        SELECT 'run:'||r.id::text,r.id,r.outcome,r.checked_at,r.error_code,r.result_kind,r.result
        FROM monitor_runs r
        WHERE r.task_id=t.id AND r.task_revision=t.revision AND r.run_kind IN ('scheduled','manual') AND r.execution_id IS NULL
      ) attempt WHERE attempt.outcome IS NOT NULL
      ORDER BY attempt.checked_at DESC,attempt.logical_id DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (SELECT r.id,r.task_revision,r.result,r.result_kind,r.source_url,r.checked_at FROM monitor_runs r WHERE r.task_id=t.id AND r.run_kind IN ('scheduled','manual') AND r.outcome='changed' AND r.result IS NOT NULL ORDER BY r.checked_at DESC,r.id DESC LIMIT 1) success ON true
    LEFT JOIN monitor_result_reviews review ON review.task_id=t.id AND review.run_id=success.id AND review.account_id=$3
    WHERE s.household_id=$1 AND s.person_id=$2
    ORDER BY COALESCE(t.subjects_updated_at,t.updated_at) DESC,t.id`,[householdId,personId,accountId]);
  return rows.rows.map((row)=>({
    id:row.id,name:row.name,state:row.state,status:taskStatus(row),subjectsRevision:row.subjects_revision,
    lastRunAt:row.last_run_at instanceof Date?row.last_run_at.toISOString():null,
    nextRunAt:row.next_check_at instanceof Date?row.next_check_at.toISOString():null,
    lastCheckedAt:row.last_checked_at instanceof Date?row.last_checked_at.toISOString():null,
    result:row.result_run_id&&resultHasFindings(row.stored_result_kind,row.stored_result)?{runId:row.result_run_id,kind:row.stored_result_kind,value:row.stored_result,sourceUrl:row.result_source_url,recordedAt:row.result_recorded_at instanceof Date?row.result_recorded_at.toISOString():null,state:row.result_disposition??'unreviewed',reviewRevision:Number(row.result_review_revision),historical:Number(row.result_task_revision)!==Number(row.revision)||Boolean(row.active_status)||Boolean(row.last_logical_id&&(row.last_result_run_id!==row.result_run_id||row.last_outcome==='failed'||row.last_outcome==='superseded'))}:null,
    latestAttempt:row.active_status?{outcome:row.active_status,at:row.active_at instanceof Date?row.active_at.toISOString():null,errorCode:null}:{outcome:row.last_outcome??null,at:row.last_run_at instanceof Date?row.last_run_at.toISOString():null,errorCode:safeAttemptError(row)},
    errorCode:row.active_status?null:safeAttemptError(row)
  }));
}

export async function reviewMonitorResult(actor:SubjectActor,taskId:string,runId:string,input:{disposition:'saved'|'handled'|'dismissed';expectedRevision:number}):Promise<{taskId:string;runId:string;disposition:string;revision:number}>{
  return transaction(async(client)=>{
    const task=await client.query('SELECT 1 FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR UPDATE',[taskId,actor.householdId]);if(!task.rowCount)throw new DomainError('NOT_FOUND',404);
    const run=await client.query(`SELECT 1 FROM monitor_runs r WHERE r.id=$1 AND r.task_id=$2 AND r.run_kind IN ('scheduled','manual') AND r.outcome='changed' AND r.result IS NOT NULL FOR SHARE`,[runId,taskId]);
    if(!run.rowCount)throw new DomainError('NOT_FOUND',404);
    const current=(await client.query<{revision:number}>('SELECT revision FROM monitor_result_reviews WHERE task_id=$1 AND run_id=$2 AND account_id=$3 FOR UPDATE',[taskId,runId,actor.accountId])).rows[0];
    if((current?.revision??0)!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revisionKind:'result_review'});
    const revision=input.expectedRevision+1;
    await client.query(`INSERT INTO monitor_result_reviews(task_id,run_id,account_id,disposition,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id,run_id,account_id) DO UPDATE SET disposition=EXCLUDED.disposition,revision=EXCLUDED.revision,updated_at=clock_timestamp()`,[taskId,runId,actor.accountId,input.disposition,revision]);
    await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata) VALUES($1,$2,'account',$3,'monitor.result_reviewed','monitor_task',$4,$5)`,[actor.installationId,actor.householdId,actor.accountId,taskId,JSON.stringify({runId,disposition:input.disposition,revision})]);
    return{taskId,runId,disposition:input.disposition,revision};
  });
}
