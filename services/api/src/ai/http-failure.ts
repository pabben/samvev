import { AiProviderFailure, type AiProviderResponseReason } from './provider.ts';

/** Safe allowlist only. Raw provider messages never become routing or UI data. */
export function classifiedHttpFailure(status:number,payload:unknown,reason?:AiProviderResponseReason):AiProviderFailure {
  const body=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:undefined;
  const error=body?.error&&typeof body.error==='object'&&!Array.isArray(body.error)?body.error as Record<string,unknown>:undefined;
  const code=typeof error?.code==='string'?error.code:undefined;
  const type=typeof error?.type==='string'?error.type:undefined;
  const diagnostic=reason??(status>=500?'upstream_http_5xx':status>=400?'upstream_http_4xx':'upstream_http_other');
  if(['insufficient_quota','billing_hard_limit_reached','billing_not_active','usage_limit_reached'].includes(code??'')||type==='billing_error'||status===402)return new AiProviderFailure('AI_BILLING_REQUIRED',undefined,diagnostic);
  if(status===401||code==='invalid_api_key'||type==='authentication_error')return new AiProviderFailure('AI_KEY_INVALID',undefined,diagnostic);
  if(status===403||type==='permission_error')return new AiProviderFailure('AI_PERMISSION_DENIED',undefined,diagnostic);
  if(status===404||code==='model_not_found'||type==='not_found_error')return new AiProviderFailure('AI_MODEL_UNAVAILABLE',undefined,diagnostic);
  if(status===429)return new AiProviderFailure('AI_PROVIDER_RATE_LIMITED',undefined,'upstream_rate_limited',undefined,undefined,code==='rate_limit_exceeded'?'provider_rate_limited':undefined);
  const transient=Boolean(error)&&[500,502,503,504,529].includes(status)&&['server_error','api_error','overloaded_error','timeout_error'].includes(type??'');
  return new AiProviderFailure('AI_UPSTREAM_ERROR',undefined,diagnostic,undefined,undefined,transient?'transient':undefined);
}
