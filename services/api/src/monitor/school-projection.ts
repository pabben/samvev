import { schoolPresentationActions } from './practical-actions.ts';

// Terminal execution state wins over an otherwise successful run. Preview runs
// and prior task revisions must never certify a current school result.
export const schoolProvenanceJoins=`
  LEFT JOIN monitor_runs run ON run.id=event.producing_run_id AND run.task_id=task.id
    AND run.run_kind IN ('scheduled','manual') AND run.outcome='changed' AND run.result_kind='events'
  LEFT JOIN LATERAL (
    SELECT attempt.outcome,attempt.at,attempt.error_code FROM (
      SELECT e.id::text logical_id,
        CASE WHEN e.status='succeeded' THEN COALESCE(r.outcome,'succeeded') ELSE e.status END AS outcome,
        CASE WHEN e.status='succeeded' THEN COALESCE(r.checked_at,e.completed_at,e.updated_at) ELSE COALESCE(e.completed_at,e.started_at,e.queued_at) END AS at,
        CASE WHEN e.status='succeeded' THEN COALESCE(r.error_code,e.error_code) ELSE e.error_code END AS error_code
      FROM monitor_executions e
      LEFT JOIN monitor_runs r ON r.execution_id=e.id AND r.task_id=e.task_id AND r.task_revision=e.task_revision AND r.run_kind=e.kind
      WHERE e.task_id=task.id AND e.task_revision=task.revision AND e.kind IN ('scheduled','manual')
      UNION ALL
      SELECT r.id::text,r.outcome,r.checked_at,r.error_code FROM monitor_runs r
      WHERE r.task_id=task.id AND r.task_revision=task.revision AND r.run_kind IN ('scheduled','manual') AND r.execution_id IS NULL
    ) attempt ORDER BY attempt.at DESC,attempt.logical_id DESC LIMIT 1
  ) latest_school_attempt ON true
  LEFT JOIN LATERAL (
    SELECT verified.checked_at FROM monitor_runs verified
    LEFT JOIN monitor_executions execution ON execution.id=verified.execution_id AND execution.task_id=verified.task_id
      AND execution.task_revision=verified.task_revision AND execution.kind=verified.run_kind
    WHERE run.task_revision=task.revision AND verified.task_id=task.id AND verified.task_revision=task.revision
      AND verified.run_kind IN ('scheduled','manual') AND (verified.execution_id IS NULL OR execution.status='succeeded')
      AND (verified.id=run.id OR (verified.outcome='unchanged' AND verified.fingerprint=run.fingerprint AND verified.checked_at>=run.checked_at
        AND NOT EXISTS(SELECT 1 FROM monitor_runs replacement WHERE replacement.task_id=task.id AND replacement.task_revision=task.revision
          AND replacement.run_kind IN ('scheduled','manual') AND replacement.outcome='changed' AND replacement.id<>run.id
          AND replacement.checked_at>=run.checked_at AND replacement.checked_at<=verified.checked_at)))
    ORDER BY verified.checked_at DESC,verified.id DESC LIMIT 1
  ) school_verification ON true`;

export const schoolProvenanceColumns=`run.id AS producing_run_id,school_verification.checked_at AS verified_at,
  latest_school_attempt.outcome AS latest_attempt_outcome,latest_school_attempt.at AS latest_attempt_at,latest_school_attempt.error_code AS latest_attempt_error_code`;

export interface SchoolProvenanceRow {
  producing_run_id:string|null;recorded_at:Date|null;verified_at:Date|null;school_expires_at:Date|null;
  latest_attempt_outcome:string|null;latest_attempt_at:Date|null;latest_attempt_error_code:string|null;
  actions:string[];evidence:Record<string,unknown>;
}
export function schoolProjectionMetadata(row:SchoolProvenanceRow,now=new Date()){
  const recordedAt=row.recorded_at?.toISOString()??null,verifiedAt=row.verified_at?.toISOString()??null;
  const current=Boolean(row.verified_at&&row.school_expires_at&&row.school_expires_at>now&&
    ['changed','unchanged'].includes(row.latest_attempt_outcome??'')&&row.latest_attempt_at&&row.latest_attempt_at<=row.verified_at);
  return{actions:schoolPresentationActions(row.actions,row.evidence),recordedAt,freshness:{
    state:!row.producing_run_id?'unknown' as const:current?'verified' as const:'retained' as const,
    recordedAt,verifiedAt,latestAttempt:{outcome:row.latest_attempt_outcome??null,at:row.latest_attempt_at?.toISOString()??null,
      errorCode:typeof row.latest_attempt_error_code==='string'&&/^[A-Z][A-Z0-9_]{1,63}$/.test(row.latest_attempt_error_code)?row.latest_attempt_error_code:null}
  }};
}
