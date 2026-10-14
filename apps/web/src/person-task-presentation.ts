import type {TranslationKey} from './locales/en';
import type {PersonTaskSummary} from './person-tasks';
import {taskErrorKey} from './monitor-presentation';
export const personTaskStatusKey=(status:PersonTaskSummary['status']):TranslationKey=>({running:'personTaskRunning',not_run:'personTaskNotRun',no_findings:'personTaskNoFindings',no_change:'personTaskNoChange',failed:'personTaskFailed',findings:'personTaskFindings',superseded:'personTaskSuperseded'} as const)[status];
export const personTaskAttemptKey=(task:Pick<PersonTaskSummary,'status'|'latestAttempt'>):TranslationKey=>
  task.status==='running'&&task.latestAttempt.outcome==='queued'?'personTaskQueued':personTaskStatusKey(task.status);
export const personTaskResultKey=(task:Pick<PersonTaskSummary,'status'|'result'>):TranslationKey=>
  task.result?.historical||['failed','running','superseded'].includes(task.status)?'personTaskOlderResult':'monitorLastResult';
export const personTaskErrorKey=(code:string):TranslationKey=>
  code==='MONITOR_WORKER_INTERRUPTED'?'personTaskInterrupted':code==='MONITOR_EXECUTION_FAILED'?'personTaskExecutionFailed':taskErrorKey(code);
