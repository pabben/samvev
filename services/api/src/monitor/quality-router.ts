import type { AiModelTier, MonitorToolName } from '@samvev/contracts';

export type MonitorQualityReason='saved_preference'|'multi_tool'|'person_schedule'|'schedule_semantics'|'conditional_notification'|'validated_low_confidence'|'invalid_schema'|'composition_failure';
export interface MonitorQualityRoute {tier:AiModelTier;reason:MonitorQualityReason|null;}

export function isScheduleLikeInstruction(instruction:string):boolean{return /\b(?:ukeplan(?:en|er)?|timeplan(?:en|er)?|weekly\s+plan|school\s+schedule|calendar)\b/i.test(instruction.normalize('NFKC'));}
export function isConditionalInstruction(instruction:string):boolean{return /\b(?:hvis|dersom|bare\s+(?:når|om)|if|only\s+if|when)\b/i.test(instruction.normalize('NFKC'));}

/** Deterministic routing uses approved structured task properties, never prompt length or provider identity. */
export function routeMonitorQuality(input:{savedTier:AiModelTier;tools:MonitorToolName[];people:string[];resultKind:'answer'|'events';scheduleLike?:boolean;conditionalNotification?:boolean}):MonitorQualityRoute{
  if(input.savedTier==='strong')return{tier:'strong',reason:'saved_preference'};
  if(new Set(input.tools).size>1)return{tier:'strong',reason:'multi_tool'};
  if(input.resultKind==='events'&&input.people.length>0)return{tier:'strong',reason:'person_schedule'};
  if(input.resultKind==='events'&&input.conditionalNotification)return{tier:'strong',reason:'conditional_notification'};
  if(input.resultKind==='events'&&input.scheduleLike)return{tier:'strong',reason:'schedule_semantics'};
  return{tier:'routine',reason:null};
}

/** Setup routing can use only deterministic request/tool-plan signals available before a rule exists. */
export function routeMonitorInterpretationQuality(input:{savedTier:AiModelTier;tools:MonitorToolName[];instruction:string}):MonitorQualityRoute{
  const scheduleLike=isScheduleLikeInstruction(input.instruction);const conditionalNotification=isConditionalInstruction(input.instruction);
  return routeMonitorQuality({savedTier:input.savedTier,tools:input.tools,people:[],resultKind:scheduleLike||conditionalNotification?'events':'answer',scheduleLike,conditionalNotification});
}

export function escalationReason(input:{code?:string;explicitConfidence:boolean;confidence:number|null}):Extract<MonitorQualityReason,'validated_low_confidence'|'invalid_schema'|'composition_failure'>|null{
  if(input.code==='AI_RESPONSE_INVALID')return'invalid_schema';
  if(input.code==='AI_COMPOSITION_INVALID')return'composition_failure';
  if(input.explicitConfidence&&input.confidence!==null&&input.confidence<0.55)return'validated_low_confidence';
  return null;
}

export const MIN_ESCALATION_REMAINING_MS=30_000;
export function remainingEscalationBudget(aiCalls:number,attemptedTools:number,remainingMs:number):{maxTurns:number;maxToolExecutions:number}|null{
  const maxTurns=7-aiCalls;const maxToolExecutions=6-attemptedTools;return maxTurns>=1&&maxToolExecutions>=1&&remainingMs>=MIN_ESCALATION_REMAINING_MS?{maxTurns,maxToolExecutions}:null;
}
