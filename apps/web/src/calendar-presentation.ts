import type {TranslationKey} from './locales/en';
export const calendarStateKey=(state:string):TranslationKey=>({setup:'calendarDraft',draft:'calendarDraft',awaiting_consent:'calendarConsent',connected:'calendarConnected',syncing:'calendarSyncing',error:'calendarFailed',expired:'calendarExpired',reauthorization_required:'calendarExpired',disconnected:'calendarDisconnected'} as Record<string,TranslationKey>)[state]??'calendarFailed';
export const calendarCanReconnect=(state:string)=>['setup','draft','awaiting_consent','expired','reauthorization_required','error'].includes(state);
