import type {Membership} from './types';
import {ApiError} from './api';
import type {TranslationKey} from './locales/en';
export type RegisteredCalendarProvider='google'|'microsoft'|'home_assistant';
export type CalendarProvider=RegisteredCalendarProvider|'ics';
export interface CalendarProviderRegistration {
 state:'missing'|'configured'|'disabled';configured:boolean;source:'database'|'legacy_environment'|'none';revision:number;
 redirectUri:string;clientIdHint:string|null;scopes:string[];tenant?:string|null;origin?:string|null;
}
export const calendarProviderKey=(provider:CalendarProvider):TranslationKey=>provider==='google'?'calendarGoogle':provider==='microsoft'?'calendarMicrosoft':provider==='home_assistant'?'calendarHomeAssistant':'calendarIcs';
export const registrationStateKey=(state:string):TranslationKey=>state==='configured'?'calendarAppConfigured':state==='disabled'?'calendarAppDisabled':'calendarMissingRegistration';
export const calendarParticipationKey=(status?:string):TranslationKey=>({confirmed:'calendarParticipationConfirmed',tentative:'calendarParticipationTentative',declined:'calendarParticipationDeclined',unanswered:'calendarParticipationUnanswered',cancelled:'calendarParticipationCancelled'} as Record<string,TranslationKey>)[status??'']??'calendarParticipationUnknown';
export const GOOGLE_CONFIGURATION_MAX_BYTES=48*1024;
/** Local validation never includes the uploaded content in an error. The server revalidates every field. */
export function parseGoogleOAuthConfiguration(text:string,redirectUri:string):{web:Record<string,unknown>}{
 if(new TextEncoder().encode(text).length>GOOGLE_CONFIGURATION_MAX_BYTES)throw new ApiError('calendarConfigTooLarge');
 let root:unknown;try{root=JSON.parse(text)}catch{throw new ApiError('calendarConfigInvalid')}
 if(!root||typeof root!=='object'||Array.isArray(root)||!('web' in root)||'installed' in root||!root.web||typeof root.web!=='object'||Array.isArray(root.web))throw new ApiError('google_oauth_web_configuration_required');
 const web=root.web as Record<string,unknown>;
 if(!['https://accounts.google.com/o/oauth2/v2/auth','https://accounts.google.com/o/oauth2/auth'].includes(String(web.auth_uri))||!['https://oauth2.googleapis.com/token','https://accounts.google.com/o/oauth2/token'].includes(String(web.token_uri))||typeof web.client_id!=='string'||!web.client_id.trim()||web.client_id.length>1000||typeof web.client_secret!=='string'||!web.client_secret.trim()||web.client_secret.length>4000||!Array.isArray(web.redirect_uris)||!web.redirect_uris.every(uri=>typeof uri==='string')||!web.redirect_uris.includes(redirectUri))throw new ApiError('google_oauth_configuration_mismatch');
 // Send only the fields the server needs; ignore arbitrary metadata in a downloaded file.
 return{web:{client_id:web.client_id,client_secret:web.client_secret,auth_uri:web.auth_uri,token_uri:web.token_uri,redirect_uris:[redirectUri]}};
}
export function calendarSetupSelection(search:string):'google'|'microsoft'|'spond'|undefined{
 const value=new URLSearchParams(search).get('setup');return value==='google'||value==='microsoft'||value==='spond'?value:undefined;
}
export function clearCalendarSetupSelection(){const url=new URL(location.href);url.searchParams.delete('setup');history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`)}

export function validateCalendarRegistrationPayload(payload:Record<string,unknown>){
 if(new TextEncoder().encode(JSON.stringify(payload)).length>15*1024)throw new ApiError('calendarConfigPayloadTooLarge');
 return payload;
}

/** A server denial always wins, including elevated capabilities on a child profile. */
export function calendarMemberAccess(member:Pick<Membership,'calendar_access'|'age_group'|'capabilities'>){
 if(member.age_group!==undefined&&member.age_group!=='adult')return false;
 if(member.calendar_access!==undefined)return member.calendar_access===true;
 return member.age_group==='adult'&&member.capabilities.includes('household.view');
}
export const calendarCanDiscoverSources=(provider:CalendarProvider,state:string,sourceCount:number)=>provider!=='ics'&&state==='connected'&&sourceCount===0;
