import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorExecutionPolicy, MONITOR_EXECUTION_LEASE_MARGIN_MS } from './execution-policy.ts';

test('latency policy gives bounded local complex work several minutes without model-name routing',()=>{
  const cloud=monitorExecutionPolicy({provider:'openai',tier:'routine',tools:['web.open'],scheduleLike:false});
  const localSimple=monitorExecutionPolicy({provider:'openai_compatible',tier:'routine',tools:['weather.forecast'],scheduleLike:false});
  const localComplex=monitorExecutionPolicy({provider:'openai_compatible',tier:'strong',tools:['web.open','weather.forecast'],scheduleLike:true});
  assert.deepEqual([cloud.latencyClass,cloud.maxRuntimeMs],['cloud_standard',180_000]);
  assert.deepEqual([localSimple.latencyClass,localSimple.maxRuntimeMs],['local_simple',300_000]);
  assert.deepEqual([localComplex.latencyClass,localComplex.maxRuntimeMs],['local_complex',600_000]);
  for(const policy of [cloud,localSimple,localComplex])assert.equal(policy.leaseMs,policy.maxRuntimeMs+MONITOR_EXECUTION_LEASE_MARGIN_MS);
});
