import {en,type TranslationKey} from './locales/en';
import type {CalendarConnection} from './calendar-connection-types';
export function calendarConnectionUiGroups(connections:CalendarConnection[]){
 const removableProviders:CalendarConnection['provider'][]=['google','microsoft','ics'];
 return{
  main:connections.filter(connection=>!connection.disconnectedAt||connection.provider==='home_assistant'),
  removable:connections.filter(connection=>Boolean(connection.disconnectedAt)&&removableProviders.includes(connection.provider)),
 };
}
export const calendarStateKey=(state:string):TranslationKey=>({setup:'calendarDraft',draft:'calendarDraft',awaiting_consent:'calendarConsent',connected:'calendarConnected',syncing:'calendarSyncing',error:'calendarFailed',expired:'calendarExpired',reauthorization_required:'calendarExpired',disconnected:'calendarDisconnected'} as Record<string,TranslationKey>)[state]??'calendarFailed';
export const calendarCanReconnect=(state:string,errorCode?:string|null,replacementRequired=false)=>!replacementRequired&&!['CALENDAR_CLIENT_CONFIGURATION_INVALID','CALENDAR_PARTIAL_SYNC_FAILED'].includes(errorCode??'')&&['setup','draft','awaiting_consent','expired','reauthorization_required','error'].includes(state);

export const calendarNeedsOperator=(errorCode:string|null)=>errorCode==='CALENDAR_CLIENT_CONFIGURATION_INVALID';
/** A retry cannot repair expired consent or an invalid OAuth client registration. */
export const calendarCanSync=(state:string,errorCode:string|null)=>
  ['connected','error'].includes(state)&&!calendarNeedsOperator(errorCode)&&
  !['CALENDAR_REAUTHORIZATION_REQUIRED','CALENDAR_OAUTH_FAILED'].includes(errorCode??'');
export const calendarSyncBlockedKey=(state:string,errorCode:string|null):TranslationKey=>
  calendarNeedsOperator(errorCode)?'CALENDAR_CLIENT_CONFIGURATION_INVALID':
  state==='syncing'?'calendarSyncing':'calendarReconnectBeforeUpdate';

/** A household subject never implies household visibility. Reader choices are separate. */
export function calendarSubjectsForPurpose(purpose:'calendar'|'waste',subjects:{household:boolean;personIds:string[]}){return purpose==='waste'?{household:true,personIds:[]}:subjects;}
export function calendarSourceBlockedKey(state:string,errorCode:string|null,available:boolean):TranslationKey{return !calendarCanSync(state,errorCode)?calendarSyncBlockedKey(state,errorCode):!available?'calendarSourceUnavailable':'calendarPreview';}

export function calendarConnectionErrorKey(code:string,details?:Record<string,unknown>):TranslationKey{
  if(code==='AI_ENDPOINT_BLOCKED')return'calendarIcsUrlBlocked';
  if(code==='VALIDATION_FAILED'){
    const fields=Array.isArray(details?.fields)?details.fields as Array<{path?:unknown}>:[];
    if(fields.some((field)=>field?.path==='icsUrl'))return'calendarIcsUrlInvalid';
    if(fields.some((field)=>field?.path==='name'))return'calendarNameRequired';
    return'calendarIcsFormInvalid';
  }
  const reason=typeof details?.reason==='string'&&details.reason in en?details.reason:undefined;
  return(reason??(code in en?code:'INTERNAL_ERROR')) as TranslationKey;
}
