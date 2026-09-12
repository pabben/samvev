import assert from 'node:assert/strict';
import test from 'node:test';
import { escalationReason, remainingEscalationBudget, routeMonitorInterpretationQuality, routeMonitorQuality } from './quality-router.ts';

test('quality routing uses structured complexity and saved preference, not text length',()=>{
  assert.deepEqual(routeMonitorQuality({savedTier:'routine',tools:['web.open'],people:[],resultKind:'answer'}),{tier:'routine',reason:null});
  assert.equal(routeMonitorQuality({savedTier:'routine',tools:['web.open','weather.forecast'],people:[],resultKind:'answer'}).reason,'multi_tool');
  assert.equal(routeMonitorQuality({savedTier:'routine',tools:['weather.forecast'],people:['Synthetic person'],resultKind:'events'}).reason,'person_schedule');
  assert.equal(routeMonitorQuality({savedTier:'routine',tools:['weather.forecast'],people:[],resultKind:'events',conditionalNotification:true}).reason,'conditional_notification');
  assert.equal(routeMonitorQuality({savedTier:'routine',tools:['web.open'],people:[],resultKind:'events',scheduleLike:true}).reason,'schedule_semantics');
  assert.deepEqual(routeMonitorQuality({savedTier:'strong',tools:['web.open'],people:[],resultKind:'answer'}),{tier:'strong',reason:'saved_preference'});
});

test('setup interpretation uses the same structured quality signals',()=>{
  assert.deepEqual(routeMonitorInterpretationQuality({savedTier:'routine',tools:['weather.forecast'],instruction:'Sjekk temperaturen i morgen.'}),{tier:'routine',reason:null});
  assert.equal(routeMonitorInterpretationQuality({savedTier:'routine',tools:['web.open'],instruction:'Sjekk ukeplanen for neste uke.'}).reason,'schedule_semantics');
  assert.equal(routeMonitorInterpretationQuality({savedTier:'routine',tools:['weather.forecast'],instruction:'Varsle dersom det blir frost.'}).reason,'conditional_notification');
  assert.equal(routeMonitorInterpretationQuality({savedTier:'routine',tools:['web.open','weather.forecast'],instruction:'Sammenstill kildene.'}).reason,'multi_tool');
});

test('automatic escalation distinguishes absent confidence and never routes source failures',()=>{
  assert.equal(escalationReason({explicitConfidence:false,confidence:0}),null);
  assert.equal(escalationReason({explicitConfidence:true,confidence:0.3}),'validated_low_confidence');
  assert.equal(escalationReason({explicitConfidence:true,confidence:0.9}),null);
  assert.equal(escalationReason({code:'AI_RESPONSE_INVALID',explicitConfidence:false,confidence:null}),'invalid_schema');
  assert.equal(escalationReason({code:'AI_COMPOSITION_INVALID',explicitConfidence:false,confidence:null}),'composition_failure');
  for(const code of ['AI_TIMEOUT','MONITOR_SOURCE_TIMEOUT','AI_ENDPOINT_BLOCKED','MONITOR_LOCATION_AMBIGUOUS','AI_CONFIGURATION_INVALID'])assert.equal(escalationReason({code,explicitConfidence:false,confidence:null}),null);
  assert.deepEqual(remainingEscalationBudget(2,1,30_000),{maxTurns:5,maxToolExecutions:5});assert.equal(remainingEscalationBudget(7,1,30_000),null);assert.equal(remainingEscalationBudget(2,6,30_000),null);assert.equal(remainingEscalationBudget(2,1,29_999),null);
});
