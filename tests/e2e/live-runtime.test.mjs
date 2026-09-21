import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { confirmedOrigin, validateBinding, safeCode, sanitizedTiming, cleanupTasks, validateEvidence, startObservedExecution, approvedPublicSource, selectedScenarios, successfulRunLabel, sanitizedValidationDiagnostic, liveE2eCapabilities } from './live-runtime-support.mjs';
const credentials = {version:1,accountId:'account-fixture',householdId:'household-fixture',membershipId:'member-fixture',personId:'person-fixture',registrationId:'registration-fixture',marker:'synthetic-test-marker-value-32-characters'};
const me = {account:{id:credentials.accountId},memberships:[{id:credentials.membershipId,household_id:credentials.householdId,person_id:credentials.personId,role_preset:'household_admin',capabilities:[...liveE2eCapabilities]}]};
const attestation = {...credentials,purpose:'synthetic_live_e2e_v1',dataKind:'synthetic',markerProof:`sha256:${createHash('sha256').update(credentials.marker).digest('hex')}`};
test('origin requires exact explicit confirmation; credentials and unsafe URLs rejected',()=>{
  assert.equal(confirmedOrigin('https://synthetic.example/', 'https://synthetic.example'),'https://synthetic.example');
  for(const [url,confirm] of [['https://synthetic.example/','https://other.example'],['https://user:secret@synthetic.example/','https://synthetic.example'],['http://synthetic.example/','http://synthetic.example'],['https://synthetic.example/path','https://synthetic.example']])assert.throws(()=>confirmedOrigin(url,confirm));
});
test('wrong tenant, second membership, privileged identity and marker mismatch fail closed',()=>{
  validateBinding(credentials,me,attestation);
  for(const altered of [{...me,account:{id:'other'}},{...me,memberships:[...me.memberships,...me.memberships]},{...me,memberships:[{...me.memberships[0],household_id:'other'}]},{...me,memberships:[{...me.memberships[0],capabilities:['installation.manage']}]},{...me,memberships:[{...me.memberships[0],capabilities:liveE2eCapabilities.filter((capability)=>capability!=='message.schedule')}]},{...me,memberships:[{...me.memberships[0],capabilities:[...liveE2eCapabilities,'display.manage']}]}])assert.throws(()=>validateBinding(credentials,altered,attestation));
  assert.throws(()=>validateBinding(credentials,me,{...attestation,dataKind:'live'}));
  assert.throws(()=>validateBinding(credentials,me,{...attestation,markerProof:'invented'}));
});
test('raw errors and timing payloads never enter report',()=>{
  const secret='private-password https://private-endpoint/ raw source';
  assert.equal(safeCode(new Error(secret)),'HARNESS_CHECK_FAILED');
  assert.equal(safeCode(new Error('AI_TIMEOUT')),'AI_TIMEOUT');
  assert.deepEqual(sanitizedTiming({totalMs:12,providerMs:8,qualityEscalated:false,reasoning:secret,model:secret,queueWaitMs:-1}),{providerMs:8,totalMs:12,qualityEscalated:false});
});
test('cleanup continues after partial failure and reports only unresolved opaque IDs',async()=>{
  const called=[];
  const residue=await cleanupTasks(['one','two','three'],async(id)=>{called.push(id);if(id==='two')throw new Error('secret payload');});
  assert.deepEqual(called,['one','two','three']);assert.deepEqual(residue,['two']);
});
const task={id:'task',state:'draft',approvedRevision:null,nextCheckAt:null,errorCode:null};
const run={id:'run',taskRevision:1};
const evidence={synthetic:true,registrationId:credentials.registrationId,householdId:credentials.householdId,taskId:task.id,execution:{id:run.id,taskRevision:1,status:'succeeded',errorCode:null,queuedAt:'2030-01-01T12:00:00Z',completedAt:'2030-01-01T12:00:30Z',timing:{totalMs:30000}},messageCount:0,notificationEligible:false,requiredTools:['weather.forecast'],actualTools:['weather.forecast'],attempts:[{tool:'weather.forecast',outcome:'success'}],provenance:[{tool:'weather.forecast',sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',fetchedAt:'2030-01-01T12:00:10Z',fingerprint:'fixture-fingerprint',cacheStatus:'miss'}]};
test('execution evidence must match exact run, tools, no messages and fresh or attested cached provenance',()=>{
  validateEvidence(evidence,credentials,task,run,['weather.forecast']);
  for(const altered of [{...evidence,execution:{...evidence.execution,id:'previous-run'}},{...evidence,messageCount:1},{...evidence,actualTools:[]},{...evidence,actualTools:['weather.forecast','web.open']},{...evidence,requiredTools:['weather.forecast','web.open']},{...evidence,provenance:[{...evidence.provenance[0],fetchedAt:'2029-01-01T12:00:00Z'}]},{...evidence,provenance:[{...evidence.provenance[0],sourceUrl:'https://www.yr.no/'}]}])assert.throws(()=>validateEvidence(altered,credentials,task,run,['weather.forecast']));
  validateEvidence({...evidence,provenance:[{...evidence.provenance[0],cacheStatus:'hit',fetchedAt:'2030-01-01T11:00:00Z'}]},credentials,task,run,['weather.forecast']);
});

test('ordinary repeatability actions enqueue once; representative duplicate requires persisted active run',async()=>{
  let posts=0, reads=0;
  const enqueue=async()=>({run:{id:`run-${++posts}`,status:'queued'}});
  const read=async()=>{reads++;return{id:'ui-run',status:'running'};};
  assert.equal((await startObservedExecution(enqueue,read)).id,'run-1');
  assert.equal((await startObservedExecution(enqueue,read)).id,'run-2');
  assert.equal(posts,2);assert.equal(reads,0);
  const initial={id:'ui-run',status:'queued'};
  const order=[];
  await startObservedExecution(async()=>{order.push('duplicate');return{run:initial};},async()=>{order.push('observed-active');return{...initial,status:'running'};},initial);
  assert.deepEqual(order,['observed-active','duplicate']);
  await assert.rejects(startObservedExecution(async()=>{throw new Error('must not post');},async()=>({...initial,status:'succeeded'}),initial),/DUPLICATE_PROBE_NOT_ACTIVE/);
  await assert.rejects(startObservedExecution(async()=>({run:{id:'different'}}),async()=>initial,initial),/DUPLICATE_EXECUTION/);
});

test('operator provision and run resolve the same mounted secret paths despite npm workspace cwd',async()=>{
  const script=await readFile(new URL('../../scripts/live-e2e.sh',import.meta.url),'utf8');
  const compose=await readFile(new URL('../../compose.yaml',import.meta.url),'utf8');
  const keys=['CREDENTIALS_REL','AI_SETTINGS_REL','CONTAINER_ROOT','CONTAINER_CREDENTIALS_FILE','CONTAINER_AI_SETTINGS_FILE'];
  const declarations=keys.map((key)=>{const match=script.match(new RegExp(`^${key}="[^"\\n]+"$`,'m'));assert.ok(match,`Missing ${key}`);return match[0];}).join('\n');
  // Only static path declarations are executed; no operator command, Docker,
  // database, registration or credential file is touched.
  const output=execFileSync('bash',['-c',`${declarations}\nprintf '%s\\n' "$CONTAINER_CREDENTIALS_FILE" "$CONTAINER_AI_SETTINGS_FILE"`],{encoding:'utf8'}).trim().split('\n');
  assert.deepEqual(output,['/workspace/.local/live-e2e/credentials/credentials.json','/workspace/.local/live-e2e/ai-settings.json']);
  for(const cwd of ['/workspace','/workspace/services/api'])for(const path of output)assert.equal(posix.resolve(cwd,path),path);
  assert.match(script,/--workspace @samvev\/api -- "\$CONTAINER_CREDENTIALS_FILE"/);
  assert.match(script,/SAMVEV_E2E_CREDENTIALS_FILE="\$CONTAINER_CREDENTIALS_FILE"/);
  assert.match(script,/SAMVEV_E2E_AI_FILE="\$CONTAINER_AI_SETTINGS_FILE"/);
  const browser=compose.split('  live-e2e:')[1].split('  live-e2e-provisioner:')[0];
  const provisioner=compose.split('  live-e2e-provisioner:')[1].split('  qa-db:')[0];
  for(const path of output)assert.ok(browser.includes(`target: ${path}\n        read_only: true`));
  assert.ok(provisioner.includes(`target: ${posix.dirname(output[0])}`));
  assert.match(browser,/source: \.local\/live-e2e\/reports\n        target: \/workspace\/\.local\/live-e2e/);
  assert.ok(script.includes('Report files on host: %s/<invocation>/report.json'));
  assert.ok(script.includes('REPORTS_DIR="$LOCAL_DIR/reports"'));
  assert.ok(!script.includes('--workspace @samvev/api -- "$CREDENTIALS_REL"'));
});

test('optional public QA source fails closed without logging query; default remains synthetic fixture',()=>{
  assert.deepEqual(approvedPublicSource('https://synthetic.example',undefined),{url:'https://synthetic.example/api/v1/e2e/fixtures/weekly-plan',mode:'synthetic_weekly_plan'});
  const source=approvedPublicSource('http://localhost:4173','https://example.com/reference?public=fixture');
  assert.equal(source.mode,'public_supplement');assert.equal(source.url,'https://example.com/reference?public=fixture');
  for(const value of ['http://example.com/', 'https://user:fixture@example.com/', 'https://@example.com/', 'https://example.com/#', 'https://localhost/', 'https://thing.local/', 'https://metadata.google.internal/', 'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/', 'https://2130706433/', `https://${[10,0,0,1].join('.')}/`, `https://${[169,254,169,254].join('.')}/`, 'https://example.com/has space']){
    assert.throws(()=>approvedPublicSource('https://synthetic.example',value),(error)=>{assert.match(error.message,/^PUBLIC_SOURCE_(INVALID|BLOCKED)$/);assert.equal(error.message.includes(value),false);return true;});
  }
});

test('scenario selection is strict, defaults to the full matrix and cannot call partial success a full PASS',()=>{
  const full={names:['weather','via-yr','web+weather','negative','lillesand','lillesand-daily'],completeMatrix:true};
  assert.deepEqual(selectedScenarios(undefined),full);assert.deepEqual(selectedScenarios(''),full);
  assert.deepEqual(selectedScenarios('lillesand-daily,negative,web+weather,lillesand,via-yr,weather'),full);
  for(const value of ['weather,weather','all','web+weather,',' weather','weather, via-yr','unknown','WEATHER',',',[],42])assert.throws(()=>selectedScenarios(value),/SCENARIOS_INVALID/);
  const partial=selectedScenarios('web+weather');assert.deepEqual(partial,{names:['web+weather'],completeMatrix:false});
  assert.equal(successfulRunLabel(full.completeMatrix,'synthetic_weekly_plan'),'LIVE E2E PASS');
  for(const [complete,mode] of [[false,'synthetic_weekly_plan'],[false,'public_supplement'],[true,'public_supplement']]){
    const label=successfulRunLabel(complete,mode);assert.match(label,/DIAGNOSTIC/);assert.equal(label.includes('LIVE E2E PASS'),false);
  }
});
test('terminal diagnostic report preserves only allowlisted stage and reason',()=>{
  const diagnostic=sanitizedValidationDiagnostic({validationStage:'evidence_anchor',validationReason:'claim',prompt:'synthetic raw probe',reasoning:'never log',apiKey:'never log',sourceUrl:'https://example.com/?probe=never-log'});
  assert.deepEqual(diagnostic,{validationStage:'evidence_anchor',validationReason:'claim'});
  assert.deepEqual(sanitizedValidationDiagnostic({validationStage:'evidence_anchor',validationReason:'raw output'}),{});
  assert.deepEqual(sanitizedValidationDiagnostic({validationStage:'secret',validationReason:'claim'}),{});
  assert.deepEqual(sanitizedValidationDiagnostic(undefined),{});
  for(const validationReason of ['invalid_json_body','missing_choices','missing_message','invalid_tool_calls','empty_content','invalid_turn_shape','response_too_large']){
    assert.deepEqual(sanitizedValidationDiagnostic({validationStage:'provider_response',validationReason,raw:'must not escape'}),{validationStage:'provider_response',validationReason});
  }
  for(const validationReason of ['upstream_http_4xx','upstream_http_5xx','upstream_http_other','upstream_invalid_json','upstream_response_too_large','upstream_context_limit','upstream_rate_limited','upstream_format_unsupported','upstream_tool_unsupported','network_error']){
    assert.deepEqual(sanitizedValidationDiagnostic({validationStage:'provider_response',validationReason,body:'must not escape'}),{validationStage:'provider_response',validationReason});
  }
  assert.deepEqual(sanitizedValidationDiagnostic({validationStage:'provider_response',validationReason:'provider supplied secret'}),{});
});
