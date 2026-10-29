import { DomainError } from '@samvev/core';

export const monitorValidationStages=['provider_response','final_schema','locale','required_tools','evidence_anchor','composition'] as const;
export const monitorValidationReasons=['invalid_response','invalid_provider_response','invalid_json_body','missing_choices','missing_message','invalid_tool_calls','empty_content','invalid_turn_shape','response_too_large','upstream_http_4xx','upstream_http_5xx','upstream_http_other','upstream_invalid_json','upstream_response_too_large','upstream_context_limit','upstream_rate_limited','upstream_format_unsupported','upstream_tool_unsupported','network_error','invalid_json_or_schema','invalid_json','schema_mismatch','locale_mismatch','missing_required_tool','source','quote','claim','date','time','source_binding','incomplete_evidence'] as const;
export type MonitorValidationStage=typeof monitorValidationStages[number];
export type MonitorValidationReason=typeof monitorValidationReasons[number];
export type MonitorValidationIssue={path:string;code:string};

const stages=new Set<string>(monitorValidationStages);
const reasons=new Set<string>(monitorValidationReasons);
const issueCodes=new Set(['invalid_type','too_small','too_big','invalid_format','unrecognized_keys','invalid_value','invalid_union','custom','not_multiple_of']);
// Only schema property names used by monitor response contracts may appear in
// diagnostics. Model supplied object keys and values are never copied through.
const issueFields=new Set(['version','resultKind','summary','eventTypes','keywords','people','noticeDaysBefore','noticeLocalTime','checkIntervalMinutes','conditionalNotification','tools','schedule','weatherCondition','outputLocale','answer','evidence','quote','sourceUrl','claims','confidence','uncertainty','events','date','time','type','description','actions','who','sources','activityQuote','weatherQuote','kind','value','minimum','maximum','location','query','canonicalName','municipality','region','country','period','timeWindow']);

export function sanitizedValidationIssues(value:unknown):MonitorValidationIssue[]{
  if(!Array.isArray(value))return[];
  const result:MonitorValidationIssue[]=[];const seen=new Set<string>();
  for(const candidate of value.slice(0,16)){
    if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))continue;
    const row=candidate as Record<string,unknown>;if(typeof row.code!=='string'||!issueCodes.has(row.code))continue;
    let path:string;
    if(Array.isArray(row.path)){
      if(row.path.length>8)continue;const parts:string[]=[];let valid=true;
      for(const segment of row.path){if(typeof segment==='number'&&Number.isInteger(segment)&&segment>=0){parts.push('[]');continue;}if(typeof segment==='string'&&issueFields.has(segment)){parts.push(segment);continue;}valid=false;break;}
      if(!valid)continue;path=parts.join('.').replaceAll('.[]','[]')||'$';
    }else if(typeof row.path==='string'&&row.path.length<=160){
      if(row.path==='$')path='$';
      else{
        const segments=row.path.split('.');if(segments.length>8)continue;
        const valid=segments.every((segment)=>{if(!/^[A-Za-z][A-Za-z0-9]*(?:\[\])?$/.test(segment))return false;const field=segment.endsWith('[]')?segment.slice(0,-2):segment;return issueFields.has(field);});
        if(!valid)continue;path=row.path;
      }
    }else continue;
    const item={path,code:row.code};const key=`${item.path}:${item.code}`;if(seen.has(key))continue;seen.add(key);result.push(item);if(result.length>=8)break;
  }
  return result;
}

export function validationError(code:string,status:number,stage:MonitorValidationStage,reason:MonitorValidationReason,issues?:unknown):DomainError{
  const safeIssues=sanitizedValidationIssues(issues);
  return new DomainError(code,status,{validationStage:stage,validationReason:reason,...(safeIssues.length?{validationIssues:safeIssues}:{})});
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

export function defaultValidationDiagnostic(error:unknown):({validationStage:MonitorValidationStage;validationReason:MonitorValidationReason;validationIssues?:MonitorValidationIssue[]})|null{
  if(!(error instanceof DomainError))return null;
  const withIssues=(base:{validationStage:MonitorValidationStage;validationReason:MonitorValidationReason})=>{const issues=sanitizedValidationIssues(error.details?.validationIssues);return{...base,...(issues.length?{validationIssues:issues}:{})};};
  const existing=sanitizedValidationDetails(error.details);if(existing)return withIssues(existing);
  if(error.code==='AI_RESPONSE_INVALID')return withIssues({validationStage:'provider_response',validationReason:'invalid_response'});
  if(error.code==='MONITOR_INTERPRETATION_SCHEMA_INVALID')return withIssues({validationStage:'final_schema',validationReason:'invalid_json_or_schema'});
  if(error.code==='AI_COMPOSITION_INVALID')return withIssues({validationStage:'composition',validationReason:'source_binding'});
  return null;
}
