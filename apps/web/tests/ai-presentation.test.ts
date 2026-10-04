import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastPresentation, type UsageForecast, attemptState, purposeKey, registrationIdentity, registrationState } from '../src/ai-presentation';
import { en } from '../src/locales/en';
import { nb } from '../src/locales/nb';
test('plan lifecycle states distinguish local removal from confirmed remote revocation',()=>{
 assert.equal(registrationState('reauthorization_required'),'aiPlanReauth');
 assert.equal(registrationState('revocation_unconfirmed'),'aiRevocationUnconfirmed');
 assert.notEqual(registrationState('revocation_unconfirmed'),registrationState('disconnected'));
 assert.equal(registrationState('usage_limited'),'aiPlanLimited');
 assert.equal(registrationState('not_eligible'),'aiPlanNotEligible');
});
test('same-email registrations keep their separate identity and other owners remain redacted',()=>{
 const a={label:'Synthetic workspace A',email:'owner@example.invalid',subjectSuffix:'12345678',isOwner:true};
 const b={...a,label:'Synthetic workspace B',subjectSuffix:'87654321'};
 assert.notEqual(registrationIdentity(a),registrationIdentity(b));
 assert.ok(registrationIdentity(a)?.includes('12345678'));
 assert.equal(registrationIdentity({...a,isOwner:false}),null);
});
test('attempts distinguish preflight rejection, interruption and unfinished dispatch from a model failure',()=>{
 assert.equal(attemptState({success:false,actualDispatch:false}),'aiAttemptPreflight');
 assert.equal(attemptState({success:false,outcome:'started'}),'aiAttemptPending');
 assert.equal(attemptState({success:false,outcome:'interrupted'}),'aiAttemptInterrupted');
 assert.equal(attemptState({success:false,outcome:'failed'}),'aiFailed');
 assert.equal(attemptState({success:true,outcome:'completed'}),'aiSucceeded');
});
test('registered purposes and lifecycle labels are available in both locales',()=>{
 for(const purpose of ['connection_test','monitor_source_analysis','monitor_interpretation','monitor_format_repair','source_summary']){
  const key=purposeKey(purpose);assert.ok(key);assert.ok(en[key]);assert.ok(nb[key]);
 }
 assert.equal(purposeKey('new_producer_purpose'),undefined);
 assert.deepEqual(Object.keys(nb).sort(),Object.keys(en).sort());
});


test('plan and API forecasts are independent and incomplete measurement never becomes a zero-cost forecast',()=>{
 const api:UsageForecast={status:'available',reason:null,completeCalendarDays:7,from:'2026-09-27',to:'2026-10-03',totalCalls:12,knownCalls:12,monthlyAmount:'1.23456789',unit:'USD'};
 const plan:UsageForecast={...api,status:'preliminary',reason:'insufficient_history',totalCalls:0,knownCalls:0,monthlyAmount:null,unit:'credits'};
 assert.equal(forecastPresentation(api).amount,'1.23456789');
 assert.equal(forecastPresentation(plan).amount,null);
 assert.equal(forecastPresentation(plan).reasonKey,'aiForecastNoUsage');
 assert.equal(forecastPresentation({...api,status:'preliminary',reason:'unknown_pricing',knownCalls:11}).amount,null);
 assert.equal(forecastPresentation({...api,completeCalendarDays:2,reason:'partial_calendar_history'}).reasonKey,'aiForecastPartialHistory');
 assert.equal(forecastPresentation({...api,completeCalendarDays:2}).amount,null);
});
test('unknown legacy dispatch and incomplete streams retain their own outcome',()=>{
 assert.equal(attemptState({success:false,actualDispatch:null,outcome:'legacy_unknown'}),'aiAttemptUnknown');
 assert.equal(attemptState({success:false,actualDispatch:true,outcome:'incomplete'}),'aiAttemptIncomplete');
 assert.equal(attemptState({success:false,actualDispatch:true,outcome:'pending'}),'aiAttemptPending');
});
