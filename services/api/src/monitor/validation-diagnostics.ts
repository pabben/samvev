import { DomainError } from '@samvev/core';

export const monitorValidationStages=['provider_response','final_schema','locale','required_tools','evidence_anchor','composition'] as const;
export const monitorValidationReasons=['invalid_response','invalid_provider_response','invalid_json_body','missing_choices','missing_message','invalid_tool_calls','empty_content','invalid_turn_shape','response_too_large','upstream_http_4xx','upstream_http_5xx','upstream_http_other','upstream_invalid_json','upstream_response_too_large','upstream_context_limit','upstream_rate_limited','upstream_format_unsupported','upstream_tool_unsupported','network_error','invalid_json_or_schema','locale_mismatch','missing_required_tool','source','quote','claim','date','time','source_binding','incomplete_evidence'] as const;
export type MonitorValidationStage=typeof monitorValidationStages[number];
export type MonitorValidationReason=typeof monitorValidationReasons[number];

const stages=new Set<string>(monitorValidationStages);
const reasons=new Set<string>(monitorValidationReasons);

export function validationError(code:string,status:number,stage:MonitorValidationStage,reason:MonitorValidationReason):DomainError{
  return new DomainError(code,status,{validationStage:stage,validationReason:reason});
}

export function withValidationDiagnostic(error:unknown,stage:MonitorValidationStage,reason:MonitorValidationReason):DomainError{
  if(error instanceof DomainError){
    const current=sanitizedValidationDetails(error.details);
    return new DomainError(error.code,error.status,{...(error.details??{}),validationStage:current?.validationStage??stage,validationReason:current?.validationReason??reason});
  }
  return validationError('AI_UPSTREAM_ERROR',502,stage,reason);
}

export function sanitizedValidationDetails(details:Record<string,unknown>|undefined):{validationStage:MonitorValidationStage;validationReason:MonitorValidationReason}|null{
  const stage=details?.validationStage;const reason=details?.validationReason;
  return typeof stage==='string'&&stages.has(stage)&&typeof reason==='string'&&reasons.has(reason)?{validationStage:stage as MonitorValidationStage,validationReason:reason as MonitorValidationReason}:null;
}

export function defaultValidationDiagnostic(error:unknown):{validationStage:MonitorValidationStage;validationReason:MonitorValidationReason}|null{
  if(!(error instanceof DomainError))return null;
  const existing=sanitizedValidationDetails(error.details);if(existing)return existing;
  if(error.code==='AI_RESPONSE_INVALID')return{validationStage:'provider_response',validationReason:'invalid_response'};
  if(error.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID')return{validationStage:'final_schema',validationReason:'invalid_json_or_schema'};
  if(error.code==='AI_COMPOSITION_INVALID')return{validationStage:'composition',validationReason:'source_binding'};
  return null;
}
