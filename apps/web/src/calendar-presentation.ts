import type {TranslationKey} from './locales/en';
export const calendarStateKey=(state:string):TranslationKey=>({setup:'calendarDraft',draft:'calendarDraft',awaiting_consent:'calendarConsent',connected:'calendarConnected',syncing:'calendarSyncing',error:'calendarFailed',expired:'calendarExpired',reauthorization_required:'calendarExpired',disconnected:'calendarDisconnected'} as Record<string,TranslationKey>)[state]??'calendarFailed';
export const calendarCanReconnect=(state:string)=>['setup','draft','awaiting_consent','expired','reauthorization_required','error'].includes(state);

export const calendarNeedsOperator=(errorCode:string|null)=>errorCode==='CALENDAR_CLIENT_CONFIGURATION_INVALID';
/** A retry cannot repair expired consent or an invalid OAuth client registration. */
export const calendarCanSync=(state:string,errorCode:string|null)=>
  ['connected','error'].includes(state)&&!calendarNeedsOperator(errorCode)&&
  !['CALENDAR_REAUTHORIZATION_REQUIRED','CALENDAR_OAUTH_FAILED'].includes(errorCode??'');
export const calendarSyncBlockedKey=(state:string,errorCode:string|null):TranslationKey=>
  calendarNeedsOperator(errorCode)?'CALENDAR_CLIENT_CONFIGURATION_INVALID':
  state==='syncing'?'calendarSyncing':'calendarReconnectBeforeUpdate';
