import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { roleCapabilityPresets } from '@samvev/contracts';
import { hashPassword } from '@samvev/core';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import { liveE2eCapabilities, provisionLiveE2e } from './e2e/live-e2e.ts';
import { MonitorExecutionQueue } from './monitor/execution.ts';

let app:FastifyInstance;let disabledApp:FastifyInstance;let directory:string;let credentialPath:string;
const sessionCookie=(response:{headers:Record<string,unknown>})=>String(response.headers['set-cookie']).match(/samvev_session=([^;]+)/)?.[1]??'';
const auth=(cookie:string,csrf:string)=>({cookie:`samvev_session=${cookie}; samvev_csrf=${csrf}`,'x-csrf-token':csrf});

before(async()=>{await migrate();app=await buildApp({liveE2eEnabled:true});disabledApp=await buildApp({liveE2eEnabled:false});directory=await mkdtemp(join(tmpdir(),'samvev-live-e2e-'));credentialPath=join(directory,'credentials.json');});
after(async()=>{await app.close();await disabledApp.close();await pool.end();await rm(directory,{recursive:true,force:true});});

async function freshInstallation():Promise<void>{
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO installations(default_locale,claimed_at,claim_token_hash,setup_step,demo_mode) VALUES('nb',clock_timestamp(),NULL,'complete',false)`);
  await rm(credentialPath,{force:true});
}

test('operator provisioning is idempotent, isolated and uses normal login without creating a session',async()=>{
  await freshInstallation();const first=await provisionLiveE2e(credentialPath);assert.equal(first.idempotent,false);
  const metadata=await stat(credentialPath);assert.equal(metadata.mode&0o077,0);const originalFile=await readFile(credentialPath,'utf8');const credentials=JSON.parse(originalFile);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count,0);
  const second=await provisionLiveE2e(credentialPath);assert.equal(second.idempotent,true);assert.deepEqual(second,{...first,idempotent:true});assert.equal(await readFile(credentialPath,'utf8'),originalFile);
  const identity=(await pool.query(`SELECT h.data_kind,m.role_preset,m.capabilities,(SELECT count(*)::int FROM memberships WHERE account_id=a.id) AS membership_count,(SELECT count(*)::int FROM memberships WHERE household_id=h.id) AS household_membership_count FROM live_e2e_registrations r JOIN households h ON h.id=r.household_id JOIN memberships m ON m.id=r.membership_id JOIN accounts a ON a.id=r.account_id`)).rows[0];
  assert.equal(identity.data_kind,'synthetic');assert.equal(identity.role_preset,'household_admin');assert.deepEqual(identity.capabilities,liveE2eCapabilities);assert.equal(identity.capabilities.includes('installation.manage'),false);assert.equal(identity.membership_count,1);assert.equal(identity.household_membership_count,1);
  const audit=JSON.stringify((await pool.query(`SELECT metadata FROM audit_events WHERE action='live_e2e.provisioned'`)).rows);assert.equal(audit.includes(credentials.password),false);assert.equal(audit.includes(credentials.marker),false);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:credentials.email,password:credentials.password}});assert.equal(login.statusCode,200,login.body);const cookie=sessionCookie(login);assert.ok(cookie);const me=await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:`samvev_session=${cookie}`}});assert.equal(me.statusCode,200);assert.equal(me.json().memberships.length,1);assert.equal(me.json().memberships[0].household_id,first.householdId);
  const attestation=await app.inject({method:'GET',url:'/api/v1/e2e/attestation',headers:{cookie:`samvev_session=${cookie}`}});assert.equal(attestation.statusCode,200,attestation.body);assert.equal(attestation.headers['cache-control'],'no-store');assert.deepEqual({...attestation.json().attestation,markerProof:undefined},{registrationId:first.registrationId,householdId:first.householdId,personId:credentials.personId,accountId:first.accountId,membershipId:first.membershipId,purpose:'synthetic_live_e2e_v1',dataKind:'synthetic',markerProof:undefined});assert.equal(attestation.json().attestation.markerProof,`sha256:${await import('node:crypto').then(({createHash})=>createHash('sha256').update(credentials.marker).digest('hex'))}`);
  for(let attempt=1;attempt<60;attempt++){const allowed=await app.inject({method:'GET',url:'/api/v1/e2e/attestation',headers:{cookie:`samvev_session=${cookie}`}});assert.equal(allowed.statusCode,200);}
  const limited=await app.inject({method:'GET',url:'/api/v1/e2e/attestation',headers:{cookie:`samvev_session=${cookie}`}});assert.equal(limited.statusCode,429);assert.equal(limited.json().error.code,'RATE_LIMITED');
  const disabled=await disabledApp.inject({method:'GET',url:'/api/v1/e2e/attestation',headers:{cookie:`samvev_session=${cookie}`}});assert.equal(disabled.statusCode,404);
});

test('provisioning idempotently reduces the legacy synthetic admin preset and audits the change',async()=>{
  await freshInstallation();const registration=await provisionLiveE2e(credentialPath);
  const before=(await pool.query<{revision:number}>('SELECT revision FROM memberships WHERE id=$1',[registration.membershipId])).rows[0]!.revision;
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[registration.membershipId,JSON.stringify(roleCapabilityPresets.household_admin)]);
  const result=await provisionLiveE2e(credentialPath);assert.equal(result.idempotent,true);
  const membership=(await pool.query<{capabilities:string[];revision:number}>('SELECT capabilities,revision FROM memberships WHERE id=$1',[registration.membershipId])).rows[0]!;
  assert.deepEqual(membership.capabilities,liveE2eCapabilities);assert.equal(membership.revision,before+1);
  const audit=(await pool.query<{metadata:{synthetic:boolean;purpose:string}}>(`SELECT metadata FROM audit_events WHERE action='live_e2e.capabilities_reduced' AND subject_id=$1`,[registration.registrationId])).rows;
  assert.deepEqual(audit,[{metadata:{synthetic:true,purpose:'synthetic_live_e2e_v1'}}]);
});

test('attestation fails closed when the synthetic identity gains an unapproved capability',async()=>{
  await freshInstallation();const registration=await provisionLiveE2e(credentialPath);const credentials=JSON.parse(await readFile(credentialPath,'utf8'));
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:credentials.email,password:credentials.password}});const cookie=sessionCookie(login);
  await pool.query('UPDATE memberships SET capabilities=capabilities || $2::jsonb WHERE id=$1',[registration.membershipId,JSON.stringify(['display.manage'])]);
  const attestation=await app.inject({method:'GET',url:'/api/v1/e2e/attestation',headers:{cookie:`samvev_session=${cookie}`}});
  assert.equal(attestation.statusCode,404);assert.equal(attestation.json().error.code,'NOT_FOUND');
});

test('credential provisioning rejects a symlink escape before writing credential material',async()=>{
  await freshInstallation();const outside=await mkdtemp(join(tmpdir(),'samvev-live-e2e-outside-'));const link=join(directory,'linked-parent');await symlink(outside,link);
  const escaped=join(link,'credentials.json');await assert.rejects(provisionLiveE2e(escaped),/must not traverse symbolic links/);
  await assert.rejects(readFile(join(outside,'credentials.json'),'utf8'),(error:any)=>error.code==='ENOENT');await rm(link);await rm(outside,{recursive:true,force:true});
});

test('provisioning refuses missing credentials, non-synthetic binding and cross-membership drift',async()=>{
  await freshInstallation();const registration=await provisionLiveE2e(credentialPath);const credentials=JSON.parse(await readFile(credentialPath,'utf8'));
  await rm(credentialPath);await assert.rejects(provisionLiveE2e(credentialPath),(error:any)=>error.code==='CONFLICT'&&error.details?.reason==='live_e2e_credentials_missing');
  await (await import('node:fs/promises')).writeFile(credentialPath,`${JSON.stringify(credentials)}\n`,{mode:0o600,flag:'wx'});await chmod(credentialPath,0o600);
  await pool.query(`UPDATE households SET data_kind='live' WHERE id=$1`,[registration.householdId]);await assert.rejects(provisionLiveE2e(credentialPath),(error:any)=>error.details?.reason==='live_e2e_identity_not_isolated');await pool.query(`UPDATE households SET data_kind='synthetic' WHERE id=$1`,[registration.householdId]);
  const installation=(await pool.query('SELECT installation_id FROM households WHERE id=$1',[registration.householdId])).rows[0].installation_id;const other=(await pool.query(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Other synthetic boundary','Europe/Oslo','nb','synthetic') RETURNING id`,[installation])).rows[0].id;const person=(await pool.query(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Cross membership probe','adult') RETURNING id`,[other])).rows[0].id;await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4)`,[other,registration.accountId,person,JSON.stringify(roleCapabilityPresets.household_admin)]);
  await assert.rejects(provisionLiveE2e(credentialPath),(error:any)=>error.details?.reason==='live_e2e_identity_not_isolated');
});

test('fixture is flag gated, dynamic, bounded by IP and does not reflect arbitrary input',async()=>{
  await freshInstallation();const missing=await disabledApp.inject({method:'GET',url:'/api/v1/e2e/fixtures/weekly-plan?input=secret-probe'});assert.equal(missing.statusCode,404);
  const fixture=await app.inject({method:'GET',url:'/api/v1/e2e/fixtures/weekly-plan?input=secret-probe'});assert.equal(fixture.statusCode,200);assert.match(fixture.headers['content-type']??'',/^text\/html/);assert.match(fixture.body,/Syntetisk ukeplan/);assert.doesNotMatch(fixture.body,/secret-probe/);assert.match(fixture.body,/\d{4}-\d{2}-\d{2}/);
  for(let attempt=1;attempt<60;attempt++){const allowed=await app.inject({method:'GET',url:'/api/v1/e2e/fixtures/weekly-plan'});assert.equal(allowed.statusCode,200);}
  const limited=await app.inject({method:'GET',url:'/api/v1/e2e/fixtures/weekly-plan'});assert.equal(limited.statusCode,429);assert.equal(limited.json().error.code,'RATE_LIMITED');
});

test('execution evidence is exact, sanitized, household scoped, and cleanup uses normal monitor delete',async()=>{
  await freshInstallation();const registration=await provisionLiveE2e(credentialPath);const credentials=JSON.parse(await readFile(credentialPath,'utf8'));const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:credentials.email,password:credentials.password}});const cookie=sessionCookie(login);const csrf=login.json().csrfToken;
  const created=await app.inject({method:'POST',url:`/api/v1/households/${registration.householdId}/monitors`,headers:auth(cookie,csrf),payload:{name:'Synthetic evidence task',instruction:'Check weather in Test place tomorrow.',checkIntervalMinutes:60,noticeDaysBefore:1,noticeLocalTime:'18:00',targets:{personIds:[credentials.personId],displayIds:[]}}});assert.equal(created.statusCode,201,created.body);const task=created.json();
  await pool.query(`UPDATE monitor_tasks SET tool_plan='["weather.forecast"]'::jsonb,interpreted_rule=$2 WHERE id=$1`,[task.id,JSON.stringify({version:1,resultKind:'answer',summary:'Synthetic weather',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['weather.forecast'],weatherScope:{location:'Test place',period:'tomorrow',timeWindow:'all'}})]);
  const installation=(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[registration.householdId])).rows[0]!.installation_id;
  const queue=new MonitorExecutionQueue({interpret:async()=>{throw new Error('unused');}} as any,{runManual:async()=>{throw new Error('unused');},runScheduled:async()=>{throw new Error('unused');}} as any,{executionProfile:async()=>({provider:'openai_compatible' as const,settingsRevision:1})} as any);
  const execution=await queue.enqueue({installationId:installation,householdId:registration.householdId,accountId:registration.accountId,membershipId:registration.membershipId,capabilities:[...roleCapabilityPresets.household_admin]},task.id,1,'test');
  await pool.query(`UPDATE monitor_executions SET status='succeeded',progress_stage='finalizing',completed_at=clock_timestamp(),timing=$2 WHERE id=$1`,[execution.id,JSON.stringify({queueWaitMs:2,providerTurns:2,toolCalls:1,webOpenMs:0,locationMs:5,weatherMs:7,providerMs:10,totalMs:24,qualityEscalated:false,secret:'timing-secret',unknownTiming:44,nested:{token:'hidden'}})]);
  const enqueueAudit=(await pool.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM audit_events WHERE subject_type='monitor_execution' AND subject_id=$1`,[execution.id])).rows[0]!;assert.equal(enqueueAudit.metadata.synthetic,true);
  const provenance=[{tool:'weather.forecast',requestedUrl:'weather.forecast',finalUrl:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',contentType:'application/vnd.met.no.locationforecast+json',fingerprint:'safe-fingerprint',fetchedAt:new Date().toISOString(),httpStatus:200,cacheStatus:'revalidated',attribution:'MET Norway Locationforecast',canonicalLocation:'Test place',requestedLocation:'private probe',latitude:99,rawContent:'must never leave server'}];
  await pool.query(`INSERT INTO monitor_tool_audits(task_id,task_revision,phase,outcome,ai_call_count,attempted_tool_count,tool_count,provenance,attempts,execution_id) VALUES($1,1,'test','success',2,1,1,$2,$3,$4)`,[task.id,JSON.stringify(provenance),JSON.stringify([{tool:'weather.forecast',requestedUrl:'weather.forecast',outcome:'success',errorCode:null,raw:'hidden'}]),execution.id]);
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,ai_called,ai_call_count,provider,model,run_kind,result_kind,result,source_url,tool_provenance,dependency_manifest,execution_id) VALUES($1,1,'changed',true,2,'openai_compatible','private-model','test','answer',$2,'https://api.met.no/weatherapi/locationforecast/2.0/documentation',$3,$4,$5)`,[task.id,JSON.stringify({answer:'raw result must not be in evidence endpoint'}),JSON.stringify(provenance),JSON.stringify([{tool:'weather.forecast',url:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',fingerprint:'safe-fingerprint'}]),execution.id]);
  await pool.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key) VALUES($1,$2,'Unrelated synthetic message','normal',true,clock_timestamp(),clock_timestamp()+interval '10 minutes','scheduled','unrelated-evidence-message')`,[registration.householdId,registration.membershipId]);
  const evidenceResponse=await app.inject({method:'GET',url:`/api/v1/e2e/households/${registration.householdId}/monitors/${task.id}/executions/${execution.id}/evidence`,headers:{cookie:`samvev_session=${cookie}`}});assert.equal(evidenceResponse.statusCode,200,evidenceResponse.body);assert.equal(evidenceResponse.headers['cache-control'],'no-store');const evidence=evidenceResponse.json().evidence;assert.deepEqual(evidence.requiredTools,['weather.forecast']);assert.deepEqual(evidence.actualTools,['weather.forecast']);assert.equal(evidence.provenance[0].cacheStatus,'revalidated');assert.equal(evidence.messageCount,0);assert.equal(evidence.notificationEligible,false);assert.deepEqual(evidence.execution.timing,{queueWaitMs:2,providerTurns:2,toolCalls:1,webOpenMs:0,locationMs:5,weatherMs:7,providerMs:10,totalMs:24,qualityEscalated:false});
  for(const forbidden of ['private-model','raw result must not','rawContent','private probe','latitude','reasoning','endpoint','timing-secret','unknownTiming','nested'])assert.equal(evidenceResponse.body.includes(forbidden),false,forbidden);assert.equal(Object.hasOwn(evidence.execution,'provider'),false);assert.equal(Object.hasOwn(evidence.run??{},'model'),false);
  const wrongHousehold=await app.inject({method:'GET',url:`/api/v1/e2e/households/${randomUUID()}/monitors/${task.id}/executions/${execution.id}/evidence`,headers:{cookie:`samvev_session=${cookie}`}});assert.equal(wrongHousehold.statusCode,404);
  const outsiderHousehold=(await pool.query(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic outsider','Europe/Oslo','nb','synthetic') RETURNING id`,[installation])).rows[0].id;const outsiderPerson=(await pool.query(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic outsider','adult') RETURNING id`,[outsiderHousehold])).rows[0].id;const outsiderAccount=(await pool.query(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'synthetic-outsider@test.invalid',$2,'nb','system') RETURNING id`,[installation,await hashPassword('Synthetic-outsider-42')])).rows[0].id;await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4)`,[outsiderHousehold,outsiderAccount,outsiderPerson,JSON.stringify(roleCapabilityPresets.household_admin)]);const outsiderLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'synthetic-outsider@test.invalid',password:'Synthetic-outsider-42'}});const outsiderEvidence=await app.inject({method:'GET',url:`/api/v1/e2e/households/${registration.householdId}/monitors/${task.id}/executions/${execution.id}/evidence`,headers:{cookie:`samvev_session=${sessionCookie(outsiderLogin)}`}});assert.equal(outsiderEvidence.statusCode,404);
  const deleted=await app.inject({method:'DELETE',url:`/api/v1/households/${registration.householdId}/monitors/${task.id}`,headers:auth(cookie,csrf),payload:{expectedRevision:task.revision}});assert.equal(deleted.statusCode,204,deleted.body);assert.equal((await pool.query('SELECT count(*)::int AS count FROM monitor_tasks WHERE id=$1',[task.id])).rows[0].count,0);
});
