import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolProjectionMetadata, type SchoolProvenanceRow } from './school-projection.ts';
import { generatedClothingAdvice, schoolPresentationActions } from './practical-actions.ts';
import { interpretationFromAi, sanitizedMonitorErrorDetails, sanitizedStoredMonitorErrorDetails } from './service.ts';
import { monitorOutputDiagnostic, sanitizedSourceFetchDiagnostic } from './validation-diagnostics.ts';
import { DomainError } from '@samvev/core';

test('known generated school advice is hidden only when absent from the saved school quote',()=>{
  for(const advice of generatedClothingAdvice){
    assert.deepEqual(schoolPresentationActions([advice,'Bring boots'],{quote:'Bring boots'}),['Bring boots']);
    assert.deepEqual(schoolPresentationActions([advice],{quote:`School instruction: ${advice}`}),[advice]);
  }
  assert.deepEqual(schoolPresentationActions([],{quote:'An activity without preparation.'}),[]);
});

test('school freshness separates recorded, verified and latest attempt time without extending expiry',()=>{
  const recorded=new Date('2030-09-20T08:00:00Z'),verified=new Date('2030-09-20T09:00:00Z');
  const row:SchoolProvenanceRow={producing_run_id:'synthetic',recorded_at:recorded,verified_at:verified,
    school_expires_at:new Date('2030-09-20T16:00:00Z'),latest_attempt_outcome:'unchanged',latest_attempt_at:verified,
    latest_attempt_error_code:null,actions:['Bring boots'],evidence:{quote:'Bring boots'}};
  const beforeLateActivity=new Date('2030-09-20T13:00:00Z');
  assert.equal(schoolProjectionMetadata(row,beforeLateActivity).freshness.state,'verified','a captured 18:00 Oslo activity remains before its actual deadline');
  for(const outcome of ['queued','running','failed','superseded']){
    const projected=schoolProjectionMetadata({...row,latest_attempt_outcome:outcome,latest_attempt_at:new Date('2030-09-20T10:00:00Z')},beforeLateActivity);
    assert.equal(projected.freshness.state,'retained');assert.equal(projected.recordedAt,recorded.toISOString());assert.equal(projected.freshness.verifiedAt,verified.toISOString());
  }
  assert.equal(schoolProjectionMetadata({...row,verified_at:null},beforeLateActivity).freshness.state,'retained');
  assert.equal(schoolProjectionMetadata({...row,producing_run_id:null,recorded_at:null,verified_at:null},beforeLateActivity).freshness.state,'unknown');
  assert.equal(schoolProjectionMetadata(row,row.school_expires_at!).freshness.state,'retained','expiry is exclusive even after an unchanged verification');
});

test('bounded final-schema diagnostics distinguish invalid JSON, schema mismatch and oversize without raw output',()=>{
  for(const [output,reason] of [['<html>synthetic unexpected response</html>','invalid_json'],['{"summary":"missing required fields"}','schema_mismatch'],['x'.repeat(32_001),'response_too_large']]){
    assert.throws(()=>interpretationFromAi(output!),(error:any)=>{
      assert.equal(error.details.validationStage,'final_schema');assert.equal(error.details.validationReason,reason);
      assert.ok(['empty','object','array','string','number','boolean','null','markdown','html','other'].includes(error.details.outputShape));
      assert.ok(['empty','1_256','257_2k','2k_8k','8k_32k','over_limit'].includes(error.details.outputSizeBucket));
      assert.ok(['likely_truncated','not_indicated','unknown'].includes(error.details.outputTruncation));
      if(reason==='schema_mismatch'){assert.ok(Array.isArray(error.details.validationIssues));assert.ok(error.details.validationIssues.length>0);assert.ok(error.details.validationIssues.every((issue:any)=>typeof issue.path==='string'&&typeof issue.code==='string'));}
      assert.equal('rawOutput' in error.details,false);assert.equal('output' in error.details,false);return true;
    });
  }
});

test('failed model output telemetry contains only bounded shape, size and truncation categories',()=>{
  assert.deepEqual(monitorOutputDiagnostic('{"events":[{"date":"secret'),{outputShape:'object',outputSizeBucket:'1_256',outputTruncation:'likely_truncated'});
  assert.deepEqual(monitorOutputDiagnostic('<html>private prompt text</html>'),{outputShape:'html',outputSizeBucket:'1_256',outputTruncation:'not_indicated'});
  assert.deepEqual(monitorOutputDiagnostic('x'.repeat(32_001)),{outputShape:'other',outputSizeBucket:'over_limit',outputTruncation:'unknown'});
  const safe=sanitizedSourceFetchDiagnostic({sourceFetchCause:'caller_abort',sourceFetchPhase:'pdf',url:'https://private.example/?token=secret',body:'private body',prompt:'private prompt'});
  assert.deepEqual(safe,{sourceFetchCause:'caller_abort',sourceFetchPhase:'pdf'});
  assert.equal(sanitizedSourceFetchDiagnostic({sourceFetchCause:'secret',sourceFetchPhase:'https://private.example/'}),null);
  const publicSource=sanitizedMonitorErrorDetails(new DomainError('MONITOR_SOURCE_TIMEOUT',504,{sourceFetchCause:'caller_abort',sourceFetchPhase:'pdf',url:'https://private.example/?token=secret',body:'private body'}));
  assert.deepEqual(publicSource,{sourceFetchCause:'caller_abort',sourceFetchPhase:'pdf'});
  assert.deepEqual(sanitizedStoredMonitorErrorDetails('MONITOR_SOURCE_TIMEOUT',{sourceFetchCause:'source_deadline',sourceFetchPhase:'dns',url:'https://private.example/?token=secret'}),{sourceFetchCause:'source_deadline',sourceFetchPhase:'dns'});
  const publicModel=sanitizedMonitorErrorDetails(new DomainError('AI_RESPONSE_INVALID',502,{validationStage:'final_schema',validationReason:'invalid_json',outputShape:'object',outputSizeBucket:'1_256',outputTruncation:'likely_truncated',rawOutput:'secret payload',hash:'secret hash',snippet:'secret snippet',sourceUrl:'https://private.example'}));
  assert.deepEqual(publicModel,{validationStage:'final_schema',validationReason:'invalid_json',outputShape:'object',outputSizeBucket:'1_256',outputTruncation:'likely_truncated'});
});
