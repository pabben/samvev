import type { AiModelTier, AiProviderId, MonitorToolName } from '@samvev/contracts';

export type MonitorLatencyClass='cloud_standard'|'local_simple'|'local_complex';
export interface MonitorExecutionPolicy {latencyClass:MonitorLatencyClass;maxRuntimeMs:number;leaseMs:number;expectedDurationSeconds:number;}

const CLOUD_STANDARD_MS=180_000;
const LOCAL_SIMPLE_MS=300_000;
const LOCAL_COMPLEX_MS=600_000;
export const MONITOR_EXECUTION_LEASE_MARGIN_MS=60_000;

/** Provider identity only classifies local versus hosted latency; model names never influence this policy. */
export function monitorExecutionPolicy(input:{provider:AiProviderId;tier:AiModelTier;tools:MonitorToolName[];scheduleLike:boolean}):MonitorExecutionPolicy{
  const local=input.provider==='openai_compatible';
  const complex=new Set(input.tools).size>1||input.tier==='strong'||input.scheduleLike;
  const latencyClass:MonitorLatencyClass=!local?'cloud_standard':complex?'local_complex':'local_simple';
  const maxRuntimeMs=latencyClass==='cloud_standard'?CLOUD_STANDARD_MS:latencyClass==='local_complex'?LOCAL_COMPLEX_MS:LOCAL_SIMPLE_MS;
  const expectedDurationSeconds=latencyClass==='cloud_standard'?60:latencyClass==='local_complex'?300:120;
  return{latencyClass,maxRuntimeMs,leaseMs:maxRuntimeMs+MONITOR_EXECUTION_LEASE_MARGIN_MS,expectedDurationSeconds};
}
