import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { tokenHash } from '@samvev/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool, transaction } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { assertMcpMonitorDraftWriteAuthority } from './monitor-draft.ts';
import type { McpPrincipal } from './service.ts';

const origin='https://samvev.test.invalid';
const callback='https://monitor-draft-client.test.invalid/oauth/callback';
let app:FastifyInstance,householdId='',membershipId='',personId='',adminCookie='',adminCsrf='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-monitor-draft-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function callTool(token:string,name:string,args:Record<string,unknown>,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}}});}
async function call(token:string,args:Record<string,unknown>,id:number){return callTool(token,'samvev_monitor_draft_create',args,id);}

async function client(name:string){
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:name,redirect_uris:[callback],token_endpoint_auth_method:'none'}});
  assert.equal(registered.statusCode,201,registered.body);return registered.json().client_id as string;
}

async function authorize(clientId:string,scope:string){
  const verifier='synthetic-monitor-draft-verifier-abcdefghijklmnopqrstuvwxyz',state='monitor-draft-state-0123456789';
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});
  assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}

function validInput(requestKey='monitor-draft-request-0001'){
  return{requestKey,name:'Synthetic source draft',instruction:'Check the synthetic public source for useful updates.',sourceUrl:'https://example.test.invalid/monitor',checkIntervalMinutes:60,noticeDaysBefore:1,noticeLocalTime:'18:00',providerPolicy:'default',modelTier:'routine'};
}

before(async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic draft owner',email:'monitor-draft-owner@test.invalid',password:'Synthetic-monitor-draft-owner-pass-42'},household:{name:'Synthetic draft household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});
  assert.equal(claim.statusCode,200,claim.body);householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  const owner=(await pool.query<{membership_id:string;person_id:string}>(`SELECT id membership_id,person_id FROM memberships WHERE household_id=$1`,[householdId])).rows[0]!;
  membershipId=owner.membership_id;personId=owner.person_id;
});
after(async()=>{await app.close();await pool.end();});

test('monitor draft write requires both exact scopes and stores one inert, replay-safe draft that the browser can finish',async()=>{
  const readOnly=await authorize(await client('Synthetic read-only monitor client'),'mcp:monitors:read');
  const readDenied=await call(readOnly,validInput('read-only-request-0001'),1);assert.equal(readDenied.statusCode,403,readDenied.body);assert.match(String(readDenied.headers['www-authenticate']),/insufficient_scope/);
  const writeOnly=await authorize(await client('Synthetic write-only monitor client'),'mcp:monitors:draft:write');
  const writeDenied=await call(writeOnly,validInput('write-only-request-0001'),2);assert.equal(writeDenied.statusCode,403,writeDenied.body);assert.match(String(writeDenied.headers['www-authenticate']),/insufficient_scope/);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_tasks`)).rows[0].count,0);

  const clientId=await client('Synthetic monitor draft writer');
  const token=await authorize(clientId,'mcp:monitors:read mcp:monitors:draft:write');
  const authority=(await pool.query<{token_set_id:string;grant_id:string;client_database_id:string;account_id:string;membership_id:string;household_id:string;installation_id:string}>(`SELECT token_set.id token_set_id,oauth_grant.id grant_id,oauth_client.id client_database_id,
      oauth_grant.account_id,oauth_grant.membership_id,oauth_grant.household_id,oauth_grant.installation_id
    FROM mcp_oauth_token_sets token_set JOIN mcp_oauth_grants oauth_grant ON oauth_grant.id=token_set.grant_id
    JOIN mcp_oauth_clients oauth_client ON oauth_client.id=oauth_grant.client_id WHERE token_set.access_token_hash=$1`,[tokenHash(token)])).rows[0]!;
  const forgedPrincipal:McpPrincipal={token,clientId,tokenSetId:authority.token_set_id,grantId:authority.grant_id,clientDatabaseId:authority.client_database_id,
    accountId:authority.account_id,membershipId:authority.membership_id,householdId:authority.household_id,installationId:authority.installation_id,
    scopes:['mcp:monitors:read','mcp:monitors:draft:write'],expiresAt:new Date(Date.now()+60_000)};
  await assert.rejects(()=>transaction(client=>assertMcpMonitorDraftWriteAuthority(client,{...forgedPrincipal,installationId:'77777777-7777-4777-8777-777777777777'})),(error:any)=>error.code==='FORBIDDEN');
  const invalidInputs=[
    {...validInput('missing-source-request-0001'),sourceUrl:undefined,instruction:'Remember to check for useful updates later.'},
    {...validInput('blocked-source-request-0001'),sourceUrl:'https://example.test.invalid/monitor?api%2Dkey=must-not-survive'},
    {...validInput('recipient-injection-request-0001'),targets:{personIds:[personId],displayIds:[]}}
  ];
  for(const [index,input] of invalidInputs.entries()){
    const response=await call(token,input,10+index);assert.equal(rpc(response).result.isError,true,response.body);
    if(index===0)assert.match(rpc(response).result.content[0].text,/MONITOR_SOURCE_REQUIRED/);
    if(index===1)assert.match(rpc(response).result.content[0].text,/AI_ENDPOINT_BLOCKED/);
  }
  assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_tasks`)).rows[0].count,0);

  const originalCapabilities=(await pool.query<{capabilities:string[]}>(`SELECT capabilities FROM memberships WHERE id=$1`,[membershipId])).rows[0]!.capabilities;
  await pool.query(`UPDATE memberships SET capabilities=capabilities-'message.schedule' WHERE id=$1`,[membershipId]);
  const narrowed=await call(token,validInput('missing-capability-request-0001'),19);
  await pool.query(`UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1`,[membershipId,JSON.stringify(originalCapabilities)]);
  assert.equal(rpc(narrowed).result.isError,true,narrowed.body);assert.match(rpc(narrowed).result.content[0].text,/FORBIDDEN/);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_tasks`)).rows[0].count,0);

  const created=await call(token,validInput(),20);assert.equal(created.statusCode,200,created.body);
  const creation=rpc(created).result.structuredContent.creation;
  assert.deepEqual(creation,{taskId:creation.taskId,createdRevision:1,createdAs:'draft',recipientCountAtCreation:0,requiresBrowserCompletion:true});
  const stored=(await pool.query<any>(`SELECT task.state,task.revision,task.approved_revision,task.next_check_at,task.last_checked_at,task.interpreted_rule,
      task.source_url,task.tool_plan,task.lease_token,task.lease_expires_at,
      (SELECT count(*)::int FROM monitor_task_person_targets WHERE task_id=task.id) person_targets,
      (SELECT count(*)::int FROM monitor_task_display_targets WHERE task_id=task.id) display_targets,
      (SELECT count(*)::int FROM monitor_runs WHERE task_id=task.id) runs,
      (SELECT count(*)::int FROM monitor_executions WHERE task_id=task.id) executions,
      (SELECT count(*)::int FROM monitor_events WHERE task_id=task.id) events
    FROM monitor_tasks task WHERE task.id=$1`,[creation.taskId])).rows[0]!;
  assert.deepEqual({state:stored.state,revision:stored.revision,approved:stored.approved_revision,next:stored.next_check_at,checked:stored.last_checked_at,rule:stored.interpreted_rule,lease:stored.lease_token,leaseExpiry:stored.lease_expires_at,people:stored.person_targets,displays:stored.display_targets,runs:stored.runs,executions:stored.executions,events:stored.events},
    {state:'draft',revision:1,approved:null,next:null,checked:null,rule:null,lease:null,leaseExpiry:null,people:0,displays:0,runs:0,executions:0,events:0});
  assert.equal(stored.source_url,'https://example.test.invalid/monitor');assert.deepEqual(stored.tool_plan,['web.open']);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM messages`)).rows[0].count,0);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM ai_usage_events`)).rows[0].count,0);

  const replay=await call(token,validInput(),21);assert.deepEqual(rpc(replay).result.structuredContent.creation,creation);
  const mismatch=await call(token,{...validInput(),instruction:'Check the synthetic public source for different updates.'},22);
  assert.equal(rpc(mismatch).result.isError,true,mismatch.body);assert.match(rpc(mismatch).result.content[0].text,/CONFLICT/);
  const concurrentKey='monitor-draft-concurrent-0001';
  const concurrent=await Promise.all([call(token,validInput(concurrentKey),23),call(token,validInput(concurrentKey),24)]);
  assert.equal(new Set(concurrent.map(response=>rpc(response).result.structuredContent.creation.taskId)).size,1);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_tasks`)).rows[0].count,2);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM audit_events WHERE action='mcp.monitor_draft_created'`)).rows[0].count,2);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM mcp_monitor_draft_requests`)).rows[0].count,2);

  const listed=await inject({method:'GET',url:`/api/v1/households/${householdId}/monitors`,headers:{cookie:adminCookie}});
  assert.equal(listed.statusCode,200,listed.body);const browserDraft=listed.json().tasks.find((task:any)=>task.id===creation.taskId);
  assert.equal(browserDraft.lifecycle.status,'incomplete');assert.equal(browserDraft.lifecycle.actions.edit.enabled,true);assert.deepEqual(browserDraft.targets,{personIds:[],displayIds:[]});
  const edited=await inject({method:'PATCH',url:`/api/v1/households/${householdId}/monitors/${creation.taskId}`,headers:{cookie:adminCookie,origin,'x-csrf-token':adminCsrf},payload:{expectedRevision:1,targets:{personIds:[personId],displayIds:[]}}});
  assert.equal(edited.statusCode,200,edited.body);assert.deepEqual(edited.json().targets,{personIds:[personId],displayIds:[]});assert.equal(edited.json().state,'draft');assert.equal(edited.json().approvedRevision,null);assert.equal(edited.json().nextCheckAt,null);
  const current=await callTool(token,'samvev_monitor_get',{taskId:creation.taskId},25);
  assert.equal(rpc(current).result.structuredContent.task.revision,2,current.body);
  assert.equal(rpc(current).result.structuredContent.task.state,'draft');
  assert.equal('createdRevision' in rpc(current).result.structuredContent.task,false,'monitor_get, not the creation receipt, is the current-status contract');
  const removed=await inject({method:'DELETE',url:`/api/v1/households/${householdId}/monitors/${creation.taskId}`,headers:{cookie:adminCookie,origin,'x-csrf-token':adminCsrf},payload:{expectedRevision:2}});
  assert.equal(removed.statusCode,204,removed.body);
  const missing=await callTool(token,'samvev_monitor_get',{taskId:creation.taskId},26);
  assert.equal(rpc(missing).result.isError,true,missing.body);assert.match(rpc(missing).result.content[0].text,/NOT_FOUND/);
  const afterDeleteReplay=await call(token,validInput(),27);
  assert.deepEqual(rpc(afterDeleteReplay).result.structuredContent.creation,creation,'replay returns only the historical creation receipt');
  assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_tasks WHERE id=$1`,[creation.taskId])).rows[0].count,0,'replay after browser deletion never recreates the task');
});

test('monitor draft creation waits for and rejects concurrent grant revocation without mutation',async()=>{
  const clientId=await client('Synthetic revoked monitor draft writer');
  const token=await authorize(clientId,'mcp:monitors:read mcp:monitors:draft:write');
  const grant=(await pool.query<{id:string}>(`SELECT oauth_grant.id FROM mcp_oauth_grants oauth_grant JOIN mcp_oauth_clients client ON client.id=oauth_grant.client_id WHERE client.client_id=$1`,[clientId])).rows[0]!;
  const before=(await pool.query(`SELECT count(*)::int count FROM monitor_tasks`)).rows[0].count;
  const revoker=await pool.connect();let open=false;let pending:ReturnType<typeof call>|undefined;
  try{
    await revoker.query('BEGIN');open=true;await revoker.query('UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE id=$1',[grant.id]);
    pending=call(token,validInput('revocation-race-request-0001'),30);
    let blocked=false;
    for(let attempt=0;attempt<500;attempt++){
      const activity=await pool.query<{blocked:boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE 'SELECT membership.capabilities%') blocked`);
      if(activity.rows[0]!.blocked){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(blocked,true,'draft write reached the live authority fence while revocation held the grant row');
    await revoker.query('COMMIT');open=false;const response=await pending;
    assert.equal(rpc(response).result.isError,true,response.body);assert.match(rpc(response).result.content[0].text,/FORBIDDEN/);
  }finally{if(open)await revoker.query('ROLLBACK');revoker.release();await pending;}
  assert.equal((await pool.query(`SELECT count(*)::int count FROM monitor_tasks`)).rows[0].count,before);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM mcp_monitor_draft_requests WHERE grant_id=$1`,[grant.id])).rows[0].count,0);
  assert.equal((await pool.query(`SELECT count(*)::int count FROM audit_events WHERE actor_type='mcp' AND actor_id=$1 AND action='mcp.monitor_draft_created'`,[grant.id])).rows[0].count,0);
});
