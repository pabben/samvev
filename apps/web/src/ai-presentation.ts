import type { TranslationKey } from './locales/en';
export function registrationState(status:string):TranslationKey {
 return ({connected:'aiPlanConnected',usage_limited:'aiPlanLimited',not_eligible:'aiPlanNotEligible',reauthorization_required:'aiPlanReauth',revocation_unconfirmed:'aiRevocationUnconfirmed',disconnected:'aiPlanDisconnected'} as Record<string,TranslationKey>)[status]??'aiStatusNotConfigured';
}
export function purposeKey(purpose:string):TranslationKey|undefined {
 return ({connection_test:'aiConnectionTestPurpose',monitor_source_analysis:'aiPurposeMonitor',monitor_analysis:'aiPurposeMonitor',monitor_interpretation:'aiPurposeInterpretation',monitor_format_repair:'aiPurposeRepair',source_summary:'aiPurposeSummary'} as Record<string,TranslationKey>)[purpose];
}
export function attemptState(attempt:{success:boolean;outcome?:string;actualDispatch?:boolean|null}):TranslationKey {
 if(attempt.outcome==='started'||attempt.outcome==='pending')return 'aiAttemptPending';
 if(attempt.outcome==='preflight_rejected'||attempt.actualDispatch===false)return 'aiAttemptPreflight';
 if(attempt.outcome==='interrupted')return 'aiAttemptInterrupted';
 if(attempt.outcome==='incomplete')return 'aiAttemptIncomplete';
 if(attempt.actualDispatch===null||attempt.outcome==='legacy_unknown'||attempt.outcome==='unknown')return 'aiAttemptUnknown';
 return attempt.success?'aiSucceeded':'aiFailed';
}
export function registrationIdentity(registration:{label:string;email?:string|null;subjectSuffix?:string;isOwner:boolean}):string|null {
 if(!registration.isOwner)return null;
 return [...new Set([registration.label,registration.email,registration.subjectSuffix?`…${registration.subjectSuffix}`:null].filter(Boolean))].join(' · ');
}

export interface UsageForecast {
 status:string;reason:string|null;completeCalendarDays:number;from:string|null;to:string|null;
 totalCalls:number;knownCalls:number;monthlyAmount:string|null;unit:'credits'|'USD';
}
export function forecastPresentation(forecast:UsageForecast):{amount:string|null;reasonKey:TranslationKey} {
 const complete=forecast.status==='available'&&forecast.completeCalendarDays>=7&&forecast.totalCalls>0&&forecast.knownCalls===forecast.totalCalls;
 return {amount:complete?forecast.monthlyAmount:null,reasonKey:forecast.reason==='partial_calendar_history'?'aiForecastPartialHistory':forecast.reason==='insufficient_history'?'aiForecastNoUsage':forecast.reason==='unknown_pricing'?'aiForecastUnknownPricing':'aiForecastPreliminary'};
}
