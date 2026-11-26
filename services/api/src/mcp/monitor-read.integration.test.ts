import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { MCP_SCOPES } from './service.ts';

const origin='https://samvev.test.invalid',callback='https://monitor-client.test.invalid/oauth/callback';
const privateText='PRIVATE_CHILD_MONITOR_TEXT_MUST_NOT_LEAK';
let app:FastifyInstance,householdId='',foreignHouseholdId='',membershipId='',personId='',accountId='',taskId='',foreignTaskId='',adminCookie='',adminCsrf='',clientId='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-monitor-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function call(token:string,name:string,args:Record<string,unknown>,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...modernHeaders(name)},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}}});}
async function authorize(scope='mcp:monitors:read mcp:monitors:content',authorizationClientId=clientId){
  const verifier='synthetic-monitor-verifier-abcdefghijklmnopqrstuvwxyz0123456789',state='monitor-state-0123456789';
  const query=new URLSearchParams({response_type:'code',client_id:authorizationClientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:authorizationClientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}

async function insertTask(household:string,membership:string,name:string){return(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,last_checked_at,next_check_at,error_code,check_count,ai_call_count,unchanged_count)
  VALUES($1,$2,$3,$4,$5,'paused',60,1,'08:00','default','routine',clock_timestamp()-interval '5 minutes',NULL,'AI_UPSTREAM_ERROR',7,3,4) RETURNING id`,[household,membership,name,`${privateText} instruction with enough length`,`https://private.invalid/${privateText}`])).rows[0]!.id;}

before(async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic monitor owner',email:'monitor-owner@test.invalid',password:'Synthetic-monitor-owner-pass-42'},household:{name:'Synthetic monitor household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  const owner=(await pool.query<{membership_id:string;person_id:string;account_id:string}>(`SELECT membership.id membership_id,membership.person_id,membership.account_id FROM memberships membership WHERE membership.household_id=$1`,[householdId])).rows[0]!;membershipId=owner.membership_id;personId=owner.person_id;accountId=owner.account_id;
  taskId=await insertTask(householdId,membershipId,`${privateText} task name`);
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,fingerprint,ai_called,ai_call_count,provider,model,run_kind,result_kind,result,source_url,tool_provenance,dependency_manifest,checked_at)
    VALUES($1,1,'changed',$2,true,2,'openai','private-model','scheduled','answer',$3,$4,$5,$6,clock_timestamp()-interval '2 minutes')`,[taskId,'a'.repeat(64),JSON.stringify({version:1,answer:privateText,evidence:{quote:privateText,sourceUrl:`https://private.invalid/${privateText}?token=synthetic-secret`},confidence:0.87,uncertainty:'Synthetic uncertainty'}),`https://private.invalid/${privateText}?token=synthetic-secret`,JSON.stringify([{url:`https://private.invalid/${privateText}`}]),JSON.stringify([{label:privateText}])]);
  await pool.query(`UPDATE monitor_tasks SET last_changed_at=(SELECT checked_at FROM monitor_runs WHERE task_id=$1 AND outcome='changed' AND run_kind='scheduled' ORDER BY checked_at DESC,id DESC LIMIT 1) WHERE id=$1`,[taskId]);
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,error_code,error_details,ai_called,ai_call_count,run_kind,checked_at)
    VALUES($1,1,'failed','AI_UPSTREAM_ERROR',$2,false,0,'manual',clock_timestamp()-interval '1 minute')`,[taskId,JSON.stringify({detail:privateText})]);
  await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,progress_stage,result_summary,error_code,error_details,queued_at,completed_at)
    VALUES($1,$2,1,'manual','failed','openai',0,'cloud_standard',60000,60,'finalizing',$3,'AI_UPSTREAM_ERROR',$4,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute')`,[householdId,taskId,JSON.stringify({answer:privateText}),JSON.stringify({detail:privateText})]);
  foreignHouseholdId=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) SELECT id,'Foreign synthetic monitor household','UTC','en','synthetic' FROM installations WHERE singleton RETURNING id`)).rows[0]!.id;
  const foreignPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Foreign synthetic adult','adult') RETURNING id`,[foreignHouseholdId])).rows[0]!.id;
  const foreignMembership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[foreignHouseholdId,accountId,foreignPerson,JSON.stringify(['household.view','household.manage','people.manage','account.manage','capability.manage','message.create.household','message.publish.display','message.schedule','message.manage.household','display.manage'])])).rows[0]!.id;
  foreignTaskId=await insertTask(foreignHouseholdId,foreignMembership,`${privateText} foreign task`);
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic monitor MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;
});
after(async()=>{await app.close();await pool.end();});

test('monitor MCP reviews share the browser revision, stay private, and recheck concurrent revocation',async()=>{
  const tool='samvev_monitor_result_review';
  const register=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic monitor review client',redirect_uris:[callback],token_endpoint_auth_method:'none'}});
  assert.equal(register.statusCode,201,register.body);
  const reviewClient=register.json().client_id as string;
  const runId=(await pool.query<{id:string}>(`SELECT id FROM monitor_runs WHERE task_id=$1 AND outcome='changed'`,[taskId])).rows[0]!.id;
  const failedRunId=(await pool.query<{id:string}>(`SELECT id FROM monitor_runs WHERE task_id=$1 AND outcome='failed'`,[taskId])).rows[0]!.id;
  const foreignRunId=(await pool.query<{id:string}>(`INSERT INTO monitor_runs(task_id,task_revision,outcome,run_kind,result_kind,result)
    VALUES($1,1,'changed','manual','answer',jsonb_build_object('answer',$2::text)) RETURNING id`,[foreignTaskId,privateText])).rows[0]!.id;
  const args={taskId,runId,disposition:'handled',expectedRevision:0};
  const otherAccount=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,locale,theme)
    SELECT id,'unrelated-reviewer@test.invalid','en','system' FROM installations WHERE singleton RETURNING id`)).rows[0]!.id;
  await pool.query(`INSERT INTO monitor_result_reviews(task_id,run_id,account_id,disposition,revision) VALUES($1,$2,$3,'dismissed',4)`,[taskId,runId,otherAccount]);
  for(const scope of ['mcp:monitors:read mcp:monitors:content','mcp:monitors:review']){
    const insufficient=await call(await authorize(scope,reviewClient),tool,args,60);
    assert.equal(insufficient.statusCode,403,insufficient.body);
    assert.match(String(insufficient.headers['www-authenticate']),/insufficient_scope/);
  }

  const token=await authorize('mcp:monitors:read mcp:monitors:review',reviewClient);
  const contentDenied=await call(token,'samvev_monitor_result_get',{taskId},61);
  assert.equal(contentDenied.statusCode,403,contentDenied.body);
  const domainState=async()=>(await pool.query(`SELECT to_jsonb(task) AS task,
    (SELECT jsonb_agg(to_jsonb(run) ORDER BY run.id) FROM monitor_runs run WHERE run.task_id=task.id) AS runs,
    (SELECT jsonb_agg(to_jsonb(execution) ORDER BY execution.id) FROM monitor_executions execution WHERE execution.task_id=task.id) AS executions,
    (SELECT count(*) FROM messages WHERE household_id=task.household_id) AS messages
    FROM monitor_tasks task WHERE task.id=$1`,[taskId])).rows[0];
  const initialDomainState=await domainState();
  const successful=await call(token,tool,args,62);
  assert.equal(successful.statusCode,200,successful.body);
  const result=rpc(successful).result;
  assert.equal(result.isError,undefined,successful.body);
  assert.deepEqual(result.structuredContent,{taskId,runId,disposition:'handled',revision:1});
  assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
  assert.doesNotMatch(successful.body,new RegExp(privateText+'|private\\.invalid|synthetic-secret|sourceUrl|personId|recipient'));
  assert.deepEqual(await domainState(),initialDomainState);

  const stale=await call(token,tool,args,63);
  assert.equal(rpc(stale).result.isError,true,stale.body);
  assert.match(rpc(stale).result.content[0].text,/REVISION_CONFLICT/);
  for(const [requestedTaskId,requestedRunId] of [[taskId,failedRunId],[taskId,foreignRunId],[foreignTaskId,foreignRunId]]){
    const denied=await call(token,tool,{...args,taskId:requestedTaskId,runId:requestedRunId},64);
    assert.equal(rpc(denied).result.isError,true,denied.body);
    assert.match(rpc(denied).result.content[0].text,/NOT_FOUND/);
    assert.doesNotMatch(denied.body,new RegExp(privateText));
  }

  // Browser reviews may use a historical result after a task edit, and both channels share the account's CAS revision.
  await pool.query('UPDATE monitor_tasks SET revision=revision+1 WHERE id=$1',[taskId]);
  try{
    const browser=await inject({method:'PUT',url:`/api/v1/households/${householdId}/monitors/${taskId}/results/${runId}/review`,headers:{cookie:adminCookie,origin,'x-csrf-token':adminCsrf},payload:{disposition:'saved',expectedRevision:1}});
    assert.equal(browser.statusCode,200,browser.body);
    assert.deepEqual(browser.json(),{taskId,runId,disposition:'saved',revision:2});
    const historical=await call(token,tool,{...args,expectedRevision:2},65);
    assert.deepEqual(rpc(historical).result.structuredContent,{taskId,runId,disposition:'handled',revision:3});
  }finally{
    await pool.query('UPDATE monitor_tasks SET revision=revision-1 WHERE id=$1',[taskId]);
  }

  const grant=(await pool.query<{id:string}>(`SELECT g.id FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id=g.client_id WHERE c.client_id=$1`,[reviewClient])).rows[0]!;
  const revoke=await pool.connect();
  let pending:ReturnType<typeof call>|undefined;
  let revocationOpen=false;
  try{
    await revoke.query('BEGIN');
    revocationOpen=true;
    await revoke.query('UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE id=$1',[grant.id]);
    pending=call(token,tool,{...args,expectedRevision:3},66);
    let waitingForAuthority=false;
    for(let attempt=0;attempt<500;attempt++){
      const activity=await pool.query<{blocked:boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM mcp_oauth_grants oauth_grant%') AS blocked`);
      if(activity.rows[0]!.blocked){waitingForAuthority=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waitingForAuthority,true,'review reached the transactional authority check while revocation held the grant lock');
    await revoke.query('COMMIT');
    revocationOpen=false;
    const concurrent=await pending;
    assert.equal(rpc(concurrent).result.isError,true,concurrent.body);
    assert.match(rpc(concurrent).result.content[0].text,/FORBIDDEN/);
  }finally{
    if(revocationOpen)await revoke.query('ROLLBACK');
    revoke.release();
    await pending;
  }
  const revoked=await call(token,tool,{...args,expectedRevision:3},67);
  assert.equal(revoked.statusCode,401,revoked.body);

  const reviews=await pool.query(`SELECT account_id,disposition,revision FROM monitor_result_reviews WHERE task_id=$1 AND run_id=$2`,[taskId,runId]);
  assert.deepEqual(reviews.rows.find(row=>row.account_id===accountId),{account_id:accountId,disposition:'handled',revision:3});
  assert.deepEqual(reviews.rows.find(row=>row.account_id===otherAccount),{account_id:otherAccount,disposition:'dismissed',revision:4});
  const audits=await pool.query(`SELECT actor_type,actor_id,action,metadata FROM audit_events WHERE subject_id=$1
    AND action IN ('mcp.monitor_result_reviewed','monitor.result_reviewed')`,[taskId]);
  assert.deepEqual(audits.rows.filter(row=>row.actor_type==='account').map(row=>[row.actor_id,row.metadata.revision]).sort(),[[accountId,1],[accountId,2],[accountId,3]]);
  assert.deepEqual(audits.rows.filter(row=>row.actor_type==='mcp').map(row=>[row.actor_id,row.metadata.revision]).sort(),[[grant.id,1],[grant.id,3]]);
  assert.doesNotMatch(JSON.stringify(audits.rows),new RegExp(privateText));
});

test('monitor MCP reads expose only bounded status metadata and recheck live authority',async()=>{
  const readOnlyToken=await authorize('mcp:monitors:read');const readOnlyStatus=await call(readOnlyToken,'samvev_monitors_list',{householdId,limit:10},40);assert.equal(readOnlyStatus.statusCode,200,readOnlyStatus.body);const contentDenied=await call(readOnlyToken,'samvev_monitor_result_get',{taskId},41);assert.equal(contentDenied.statusCode,403,contentDenied.body);assert.match(String(contentDenied.headers['www-authenticate']),/insufficient_scope/);
  let token=await authorize(MCP_SCOPES.join(' '));
  const listed=await call(token,'samvev_monitors_list',{householdId,limit:10},1);assert.equal(listed.statusCode,200,listed.body);assert.equal(rpc(listed).result.structuredContent.tasks.length,1);const listedTask=rpc(listed).result.structuredContent.tasks[0];assert.equal(listedTask.id,taskId);assert.deepEqual(Object.keys(listedTask).sort(),['aiCallCount','approvedRevision','checkCount','checkIntervalMinutes','createdAt','errorCode','id','lastCheckedAt','nextCheckAt','noticeDaysBefore','noticeLocalTime','revision','state','unchangedCount','updatedAt'].sort());assert.doesNotMatch(listed.body,new RegExp(privateText));
  const detail=await call(token,'samvev_monitor_get',{taskId},2);assert.equal(detail.statusCode,200,detail.body);const task=rpc(detail).result.structuredContent.task;assert.equal(task.id,taskId);assert.equal(task.latestExecution.status,'failed');assert.equal(task.latestExecution.errorCode,'AI_UPSTREAM_ERROR');assert.deepEqual(Object.keys(task).sort(),['aiCallCount','approvedRevision','checkCount','checkIntervalMinutes','createdAt','errorCode','id','lastCheckedAt','latestExecution','nextCheckAt','noticeDaysBefore','noticeLocalTime','revision','state','unchangedCount','updatedAt'].sort());assert.deepEqual(Object.keys(task.latestExecution).sort(),['completedAt','errorCode','id','kind','progressStage','queuedAt','startedAt','status'].sort());assert.doesNotMatch(detail.body,new RegExp(privateText));
  const history=await call(token,'samvev_monitor_runs_list',{taskId,limit:1},3);assert.equal(history.statusCode,200,history.body);assert.equal(rpc(history).result.structuredContent.runs.length,1);const run=rpc(history).result.structuredContent.runs[0];assert.equal(run.outcome,'failed');assert.equal(run.errorCode,'AI_UPSTREAM_ERROR');assert.deepEqual(Object.keys(run).sort(),['aiCallCount','aiCalled','checkedAt','errorCode','id','outcome','resultKind','runKind','taskRevision'].sort());assert.doesNotMatch(history.body,new RegExp(privateText));
  const result=await call(token,'samvev_monitor_result_get',{taskId},31);assert.equal(result.statusCode,200,result.body);const monitorResult=rpc(result).result.structuredContent.result;assert.equal(monitorResult.latestOutcome,'failed');assert.equal(monitorResult.resultStale,true);assert.equal(monitorResult.content,privateText);assert.equal(monitorResult.confidence,0.87);assert.equal(monitorResult.uncertainty,'Synthetic uncertainty');assert.equal(monitorResult.sourceLinkWithheld,true);assert.ok(monitorResult.resultReference);assert.ok(monitorResult.checkedAt);assert.doesNotMatch(result.body,/private\.invalid|synthetic-secret|sourceUrl|evidence|tool_provenance/i);
  await pool.query(`UPDATE monitor_runs SET result=jsonb_build_object('answer',3000) WHERE task_id=$1 AND outcome='changed'`,[taskId]);const malformed=await call(token,'samvev_monitor_result_get',{taskId},32);assert.equal(rpc(malformed).result.structuredContent.result.content,null);
  await pool.query(`UPDATE monitor_runs SET result=jsonb_build_object('answer',repeat('x',3000),'confidence',0.9,'uncertainty',repeat('u',600)) WHERE task_id=$1 AND outcome='changed'`,[taskId]);const bounded=await call(token,'samvev_monitor_result_get',{taskId},33);const boundedResult=rpc(bounded).result.structuredContent.result;assert.equal(boundedResult.content.length,1000);assert.equal(boundedResult.contentTruncated,true);assert.equal(boundedResult.uncertainty.length,500);assert.equal(boundedResult.uncertaintyTruncated,true);
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,ai_called,ai_call_count,run_kind,checked_at) VALUES($1,1,'unchanged',false,0,'scheduled',clock_timestamp()+interval '1 second')`,[taskId]);const unchanged=await call(token,'samvev_monitor_result_get',{taskId},35);const unchangedResult=rpc(unchanged).result.structuredContent.result;assert.equal(unchangedResult.latestOutcome,'unchanged');assert.equal(unchangedResult.resultStale,false);
  const taskLocker=await pool.connect(),demoter=await pool.connect();let taskLockOpen=false,demotionTransactionOpen=false,demotion:Promise<unknown>|undefined;
  try{
    await taskLocker.query('BEGIN');taskLockOpen=true;await taskLocker.query('SELECT id FROM monitor_tasks WHERE id=$1 FOR UPDATE',[taskId]);
    const heldRead=call(token,'samvev_monitor_result_get',{taskId},36);let authorityCheckedAndWaiting=false;
    for(let attempt=0;attempt<500;attempt++){const activity=await pool.query<{blocked:boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE 'SELECT 1 FROM monitor_tasks%FOR SHARE%') AS blocked`);if(activity.rows[0]!.blocked){authorityCheckedAndWaiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(authorityCheckedAndWaiting,true,'the MCP read should reach its task lock after validating authority');
    await demoter.query('BEGIN');demotionTransactionOpen=true;let demotionCompleted=false;demotion=demoter.query(`UPDATE persons SET age_group='child' WHERE id=$1`,[personId]).then(()=>{demotionCompleted=true;});
    await new Promise(resolve=>setTimeout(resolve,50));assert.equal(demotionCompleted,false,'adult-to-child demotion must wait while result access is in flight');
    await taskLocker.query('COMMIT');taskLockOpen=false;const heldResponse=await heldRead;assert.equal(heldResponse.statusCode,200,heldResponse.body);const heldResult=rpc(heldResponse).result.structuredContent.result;assert.equal(heldResult.content,'x'.repeat(1000));assert.equal(heldResult.resultStale,false);
    await demotion;await demoter.query('COMMIT');demotionTransactionOpen=false;await pool.query(`UPDATE persons SET age_group='adult' WHERE id=$1`,[personId]);
  }finally{
    if(taskLockOpen)await taskLocker.query('ROLLBACK');
    if(demotion)await demotion.catch(()=>undefined);
    if(demotionTransactionOpen)await demoter.query('ROLLBACK');
    taskLocker.release();demoter.release();
  }
  await pool.query(`UPDATE monitor_tasks SET revision=revision+1,instruction='Edited synthetic instruction with adequate length',source_url='https://changed.test.invalid/new',state='draft',last_changed_at=NULL,last_result=NULL,updated_at=clock_timestamp() WHERE id=$1`,[taskId]);const edited=await call(token,'samvev_monitor_result_get',{taskId},37);const editedResult=rpc(edited).result.structuredContent.result;assert.equal(editedResult.content,null);assert.equal(editedResult.taskRevision,2);assert.equal(editedResult.resultRevision,1);assert.equal(editedResult.hasCurrentResult,false);assert.equal(editedResult.resultStale,true);assert.doesNotMatch(edited.body,new RegExp(privateText));
  const cross=await call(token,'samvev_monitor_get',{taskId:foreignTaskId},4);assert.equal(cross.statusCode,200,cross.body);assert.equal(rpc(cross).result.isError,true);assert.match(rpc(cross).result.content[0].text,/NOT_FOUND/);assert.doesNotMatch(cross.body,new RegExp(privateText));
  const crossResult=await call(token,'samvev_monitor_result_get',{taskId:foreignTaskId},34);assert.equal(rpc(crossResult).result.isError,true);assert.match(rpc(crossResult).result.content[0].text,/NOT_FOUND/);
  const grant=(await pool.query<{id:string}>('SELECT g.id FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id=g.client_id WHERE g.household_id=$1 AND c.client_id=$2',[householdId,clientId])).rows[0]!;
  const audits=await pool.query<{action:string;metadata:Record<string,unknown>}>(`SELECT action,metadata FROM audit_events WHERE actor_type='mcp' AND actor_id=$1 ORDER BY occurred_at`,[grant.id]);assert.deepEqual(audits.rows.map(row=>row.action),['mcp.monitors_listed','mcp.monitors_listed','mcp.monitor_read','mcp.monitor_runs_listed','mcp.monitor_result_read','mcp.monitor_result_read','mcp.monitor_result_read','mcp.monitor_result_read','mcp.monitor_result_read','mcp.monitor_result_read']);assert.equal(audits.rows[0]!.metadata.count,1);assert.equal(audits.rows[3]!.metadata.limit,1);assert.doesNotMatch(JSON.stringify(audits.rows),new RegExp(privateText));
  await pool.query(`UPDATE mcp_oauth_grants SET scopes='["mcp:context","mcp:monitors:read"]'::jsonb WHERE id=$1`,[grant.id]);
  const removed=await call(token,'samvev_monitor_result_get',{taskId},5);assert.equal(rpc(removed).result.isError,true);assert.match(rpc(removed).result.content[0].text,/FORBIDDEN/);const statusStillAllowed=await call(token,'samvev_monitor_get',{taskId},6);assert.equal(rpc(statusStillAllowed).result.isError,undefined);
  token=await authorize(MCP_SCOPES.join(' '));await pool.query(`UPDATE memberships SET capabilities='[]'::jsonb WHERE id=$1`,[membershipId]);const demoted=await call(token,'samvev_monitor_result_get',{taskId},7);assert.equal(demoted.statusCode,401,demoted.body);assert.match(String(demoted.headers['www-authenticate']),/invalid_token/);
  await pool.query(`UPDATE memberships SET capabilities='["household.manage"]'::jsonb WHERE id=$1`,[membershipId]);await pool.query(`UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE id=$1`,[grant.id]);const revoked=await call(token,'samvev_monitor_result_get',{taskId},8);assert.equal(revoked.statusCode,401,revoked.body);assert.match(String(revoked.headers['www-authenticate']),/invalid_token/);
});
