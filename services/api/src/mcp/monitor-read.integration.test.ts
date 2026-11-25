import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://samvev.test.invalid',callback='https://monitor-client.test.invalid/oauth/callback';
const privateText='PRIVATE_CHILD_MONITOR_TEXT_MUST_NOT_LEAK';
let app:FastifyInstance,householdId='',foreignHouseholdId='',membershipId='',accountId='',taskId='',foreignTaskId='',adminCookie='',adminCsrf='',clientId='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-monitor-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function call(token:string,name:string,args:Record<string,unknown>,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...modernHeaders(name)},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}}});}
async function authorize(){
  const verifier='synthetic-monitor-verifier-abcdefghijklmnopqrstuvwxyz0123456789',state='monitor-state-0123456789';
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:'mcp:monitors:read',state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}

async function insertTask(household:string,membership:string,name:string){return(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,last_checked_at,next_check_at,error_code,check_count,ai_call_count,unchanged_count)
  VALUES($1,$2,$3,$4,$5,'paused',60,1,'08:00','default','routine',clock_timestamp()-interval '5 minutes',NULL,'AI_UPSTREAM_ERROR',7,3,4) RETURNING id`,[household,membership,name,`${privateText} instruction with enough length`,`https://private.invalid/${privateText}`])).rows[0]!.id;}

before(async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic monitor owner',email:'monitor-owner@test.invalid',password:'Synthetic-monitor-owner-pass-42'},household:{name:'Synthetic monitor household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  const owner=(await pool.query<{membership_id:string;account_id:string}>(`SELECT membership.id membership_id,membership.account_id FROM memberships membership WHERE membership.household_id=$1`,[householdId])).rows[0]!;membershipId=owner.membership_id;accountId=owner.account_id;
  taskId=await insertTask(householdId,membershipId,`${privateText} task name`);
  await pool.query(`INSERT INTO monitor_runs(task_id,task_revision,outcome,fingerprint,ai_called,ai_call_count,provider,model,run_kind,result_kind,result,source_url,tool_provenance,dependency_manifest,checked_at)
    VALUES($1,1,'changed',$2,true,2,'openai','private-model','scheduled','answer',$3,$4,$5,$6,clock_timestamp()-interval '2 minutes')`,[taskId,'a'.repeat(64),JSON.stringify({answer:privateText}),`https://private.invalid/${privateText}`,JSON.stringify([{url:`https://private.invalid/${privateText}`}]),JSON.stringify([{label:privateText}])]);
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

test('monitor MCP reads expose only bounded status metadata and recheck live authority',async()=>{
  const token=await authorize();
  const listed=await call(token,'samvev_monitors_list',{householdId,limit:10},1);assert.equal(listed.statusCode,200,listed.body);assert.equal(rpc(listed).result.structuredContent.tasks.length,1);const listedTask=rpc(listed).result.structuredContent.tasks[0];assert.equal(listedTask.id,taskId);assert.deepEqual(Object.keys(listedTask).sort(),['aiCallCount','approvedRevision','checkCount','checkIntervalMinutes','createdAt','errorCode','id','lastCheckedAt','nextCheckAt','noticeDaysBefore','noticeLocalTime','revision','state','unchangedCount','updatedAt'].sort());assert.doesNotMatch(listed.body,new RegExp(privateText));
  const detail=await call(token,'samvev_monitor_get',{taskId},2);assert.equal(detail.statusCode,200,detail.body);const task=rpc(detail).result.structuredContent.task;assert.equal(task.id,taskId);assert.equal(task.latestExecution.status,'failed');assert.equal(task.latestExecution.errorCode,'AI_UPSTREAM_ERROR');assert.deepEqual(Object.keys(task).sort(),['aiCallCount','approvedRevision','checkCount','checkIntervalMinutes','createdAt','errorCode','id','lastCheckedAt','latestExecution','nextCheckAt','noticeDaysBefore','noticeLocalTime','revision','state','unchangedCount','updatedAt'].sort());assert.deepEqual(Object.keys(task.latestExecution).sort(),['completedAt','errorCode','id','kind','progressStage','queuedAt','startedAt','status'].sort());assert.doesNotMatch(detail.body,new RegExp(privateText));
  const history=await call(token,'samvev_monitor_runs_list',{taskId,limit:1},3);assert.equal(history.statusCode,200,history.body);assert.equal(rpc(history).result.structuredContent.runs.length,1);const run=rpc(history).result.structuredContent.runs[0];assert.equal(run.outcome,'failed');assert.equal(run.errorCode,'AI_UPSTREAM_ERROR');assert.deepEqual(Object.keys(run).sort(),['aiCallCount','aiCalled','checkedAt','errorCode','id','outcome','resultKind','runKind','taskRevision'].sort());assert.doesNotMatch(history.body,new RegExp(privateText));
  const cross=await call(token,'samvev_monitor_get',{taskId:foreignTaskId},4);assert.equal(cross.statusCode,200,cross.body);assert.equal(rpc(cross).result.isError,true);assert.match(rpc(cross).result.content[0].text,/NOT_FOUND/);assert.doesNotMatch(cross.body,new RegExp(privateText));
  const grant=(await pool.query<{id:string}>('SELECT id FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  const audits=await pool.query<{action:string;metadata:Record<string,unknown>}>(`SELECT action,metadata FROM audit_events WHERE actor_type='mcp' AND actor_id=$1 ORDER BY occurred_at`,[grant.id]);assert.deepEqual(audits.rows.map(row=>row.action),['mcp.monitors_listed','mcp.monitor_read','mcp.monitor_runs_listed']);assert.equal(audits.rows[0]!.metadata.count,1);assert.equal(audits.rows[2]!.metadata.limit,1);assert.doesNotMatch(JSON.stringify(audits.rows),new RegExp(privateText));
  await pool.query(`UPDATE mcp_oauth_grants SET scopes='["mcp:context"]'::jsonb WHERE id=$1`,[grant.id]);
  const removed=await call(token,'samvev_monitor_get',{taskId},5);assert.equal(removed.statusCode,200,removed.body);assert.equal(rpc(removed).result.isError,true);assert.match(rpc(removed).result.content[0].text,/FORBIDDEN/);assert.doesNotMatch(removed.body,new RegExp(privateText));
});
