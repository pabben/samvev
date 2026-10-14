import type {TranslationKey} from './locales/en';
import type {PersonTaskSummary} from './person-tasks';
export const personTaskStatusKey=(status:PersonTaskSummary['status']):TranslationKey=>({running:'personTaskRunning',not_run:'personTaskNotRun',no_findings:'personTaskNoFindings',no_change:'personTaskNoChange',failed:'personTaskFailed',findings:'personTaskFindings',superseded:'personTaskSuperseded'} as const)[status];
