import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test,{after,before} from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY,CLIENT_INFO_META_KEY,PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance,LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { MonitorService } from '../monitor/service.ts';

const origin='https://samvev.test.invalid',callback='https://monitor-pause.test.invalid/callback';
const scopes='mcp:monitors:read mcp:monitors:pause mcp:messages:read mcp:messages:write';
let app:FastifyInstance,householdId='',membershipId='',personId='',accountId='',installationId='',cookie='',csrf='';
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-monitor-pause',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(value:string){return createHash('sha256').update(value).digest('base64url');}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function register(name:string){const response=await inject({method:'POST',url:'/oauth/register',payload:{client_name:name,redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(response.statusCode,201,response.body);return response.json().client_id as string;}
async function authorize(clientId:string,requestedScopes=scopes,targetHousehold=householdId){
  const verifier=`synthetic-pause-verifier-${randomUUID()}`,state=`pause-${randomUUID()}`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:requestedScopes,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:csrf,household_id:targetHousehold,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);
  const token=exchanged.json().access_token as string;
  const grant=(await pool.query<{grant_id:string;token_set_id:string;client_database_id:string}>(`SELECT grant_row.id grant_id,token_set.id token_set_id,client.id client_database_id FROM mcp_oauth_token_sets token_set JOIN mcp_oauth_grants grant_row ON grant_row.id=token_set.grant_id JOIN mcp_oauth_clients client ON client.id=grant_row.client_id WHERE client.client_id=$1 AND token_set.revoked_at IS NULL ORDER BY token_set.created_at DESC LIMIT 1`,[clientId])).rows[0]!;
  return{token,...grant};
}
async function call(token:string,taskId:string,expectedRevision:number,id=1){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'samvev_monitor_pause'},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'samvev_monitor_pause',arguments:{taskId,expectedRevision},_meta:meta}}});}

const rule={version:1,resultKind:'events',summary:'Synthetic active monitor',eventTypes:[],keywords:[],people:[],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,conditionalNotification:false,tools:['web.open']};
async function activeTask(household=householdId,owner=membershipId){return(await pool.query<{id:string}>(`INSERT INTO monitor_tasks(household_id,owner_membership_id,name,instruction,source_url,tool_plan,state,check_interval_minutes,notice_days_before,notice_local_time,provider_policy,model_tier,interpreted_rule,revision,approved_revision,next_check_at) VALUES($1,$2,'Synthetic pause task','Check a synthetic source without network access.','https://example.test.invalid/pause','["web.open"]','active',60,1,'18:00','default','routine',$3,1,1,clock_timestamp()+interval '1 hour') RETURNING id`,[household,owner,JSON.stringify(rule)])).rows[0]!.id;}
async function notice(taskId:string,input:{personIds?:string[];displayIds?:string[];household?:boolean;state?:'scheduled'|'published';duplicateEvent?:boolean}={}){
  const state=input.state??'scheduled';
  const message=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,'Synthetic generated notice','normal',$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',$4,$5,CASE WHEN $4='published' THEN clock_timestamp() END) RETURNING id`,[householdId,membershipId,input.household??false,state,randomUUID()])).rows[0]!;
  for(const id of input.personIds??[])await pool.query(`INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)`,[householdId,message.id,id]);
  for(const id of input.displayIds??[])await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id) VALUES($1,$2,$3)`,[householdId,message.id,id]);
  const insertEvent=()=>pool.query(`INSERT INTO monitor_events(household_id,task_id,event_key,event_date,event_type,description,evidence,confidence,source_fingerprint,message_id) VALUES($1,$2,$3,current_date,'Synthetic','Synthetic event','{"quote":"Synthetic","sourceUrl":"https://example.test.invalid/pause"}',1,$4,$5)`,[householdId,taskId,randomUUID(),randomUUID(),message.id]);
  await insertEvent();if(input.duplicateEvent)await insertEvent();return message.id;
}
async function grantRecipients(grantId:string,people:string[],displays:string[]){for(const id of people)await pool.query(`INSERT INTO mcp_oauth_grant_people(household_id,grant_id,person_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[householdId,grantId,id]);for(const id of displays)await pool.query(`INSERT INTO mcp_oauth_grant_displays(household_id,grant_id,display_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[householdId,grantId,id]);}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');
  assert.equal(database.hostname,'test-db');assert.equal(database.pathname,'/samvev_test');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic pause owner',email:'pause-owner@test.invalid',password:'Synthetic-pause-owner-pass-42'},household:{name:'Synthetic pause household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;cookie=cookies(claim);csrf=claim.json().csrfToken;
  const owner=(await pool.query<{membership_id:string;person_id:string;account_id:string;installation_id:string}>(`SELECT membership.id membership_id,membership.person_id,membership.account_id,household.installation_id FROM memberships membership JOIN households household ON household.id=membership.household_id WHERE membership.household_id=$1`,[householdId])).rows[0]!;
  membershipId=owner.membership_id;personId=owner.person_id;accountId=owner.account_id;installationId=owner.installation_id;
});
after(async()=>{await app.close();await pool.end();});

test('pause requires fresh consent and atomically withdraws only fully granted synthetic notices',async()=>{
  const readClient=await register('Synthetic read-only pause client');const read=await authorize(readClient,'mcp:monitors:read');
  const untouched=await activeTask();const deniedScope=await call(read.token,untouched,1);assert.equal(deniedScope.statusCode,403,deniedScope.body);assert.match(String(deniedScope.headers['www-authenticate']),/insufficient_scope/);

  const display=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic pause display','en','system') RETURNING id`,[householdId])).rows[0]!;
  const clientId=await register('Synthetic exact pause client');const auth=await authorize(clientId);await grantRecipients(auth.grant_id,[personId],[display.id]);
  const taskId=await activeTask();const scheduled=await notice(taskId,{personIds:[personId],duplicateEvent:true});const published=await notice(taskId,{displayIds:[display.id],state:'published'});
  const aiBefore=(await pool.query<{count:number}>('SELECT count(*)::int count FROM ai_usage_events')).rows[0]!.count;
  const response=await call(auth.token,taskId,1,2);assert.equal(response.statusCode,200,response.body);const result=rpc(response).result.structuredContent;
  assert.deepEqual(result,{taskId,state:'paused',revision:2});assert.deepEqual(Object.keys(result).sort(),['revision','state','taskId']);
  const messages=await pool.query<{id:string;state:string;revision:number}>(`SELECT id,state,revision FROM messages WHERE id=ANY($1::uuid[]) ORDER BY id`,[[scheduled,published]]);
  assert.deepEqual(messages.rows.map(row=>[row.state,row.revision]).sort(),[['cancelled',2],['withdrawn',2]],'duplicate event links withdraw a message only once');
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int count FROM ai_usage_events')).rows[0]!.count,aiBefore,'pause makes no model call');
  const audits=await pool.query<{actor_type:string;actor_id:string;action:string;metadata:Record<string,unknown>}>(`SELECT actor_type,actor_id,action,metadata FROM audit_events WHERE subject_id=$1 ORDER BY id`,[taskId]);
  assert.deepEqual(audits.rows,[{actor_type:'mcp',actor_id:auth.grant_id,action:'mcp.monitor_paused',metadata:{revision:2,clientId:auth.client_database_id}}]);

  const stale=await activeTask();const staleResponse=await call(auth.token,stale,2,3);assert.equal(rpc(staleResponse).result.isError,true);assert.match(rpc(staleResponse).result.content[0].text,/REVISION_CONFLICT/);assert.equal((await pool.query(`SELECT state FROM monitor_tasks WHERE id=$1`,[stale])).rows[0].state,'active');
  const queued=await activeTask();await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds) VALUES($1,$2,1,'manual','queued','openai',0,'cloud_standard',60000,60)`,[householdId,queued]);const running=await call(auth.token,queued,1,4);assert.equal(rpc(running).result.isError,true);assert.match(rpc(running).result.content[0].text,/MONITOR_RUNNING/);
  const runningTask=await activeTask();await pool.query(`INSERT INTO monitor_executions(household_id,task_id,task_revision,kind,status,provider_snapshot,ai_settings_revision,latency_class,max_runtime_ms,expected_duration_seconds,started_at,worker_lease_token,worker_lease_expires_at) VALUES($1,$2,1,'manual','running','openai',0,'cloud_standard',60000,60,clock_timestamp(),$3,clock_timestamp()+interval '2 minutes')`,[householdId,runningTask,randomUUID()]);const runningDenied=await call(auth.token,runningTask,1,5);assert.equal(rpc(runningDenied).result.isError,true);assert.match(rpc(runningDenied).result.content[0].text,/MONITOR_RUNNING/);
});

test('pause denies cross-household, broadcast, ungranted recipients, expired/revoked authority, and rolls back on audit failure',async()=>{
  const otherPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic ungranted recipient','adult') RETURNING id`,[householdId])).rows[0]!;
  const ungrantedDisplay=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic ungranted display','en','system') RETURNING id`,[householdId])).rows[0]!;
  const clientId=await register('Synthetic denial pause client');const auth=await authorize(clientId);await grantRecipients(auth.grant_id,[personId],[]);
  for(const audience of [{personIds:[otherPerson.id]},{displayIds:[ungrantedDisplay.id]},{household:true}]){const task=await activeTask();const message=await notice(task,audience);const denied=await call(auth.token,task,1);assert.equal(rpc(denied).result.isError,true,denied.body);assert.match(rpc(denied).result.content[0].text,/NOT_FOUND|FORBIDDEN/);assert.equal((await pool.query(`SELECT state FROM monitor_tasks WHERE id=$1`,[task])).rows[0].state,'active');assert.equal((await pool.query(`SELECT state FROM messages WHERE id=$1`,[message])).rows[0].state,'scheduled');}

  const foreignHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic foreign pause household','UTC','en','synthetic') RETURNING id`,[installationId])).rows[0]!;
  const foreignPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic foreign adult','adult') RETURNING id`,[foreignHousehold.id])).rows[0]!;
  const foreignMembership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin','["household.manage"]') RETURNING id`,[foreignHousehold.id,accountId,foreignPerson.id])).rows[0]!;
  const foreignTask=await activeTask(foreignHousehold.id,foreignMembership.id);const cross=await call(auth.token,foreignTask,1);assert.equal(rpc(cross).result.isError,true);assert.match(rpc(cross).result.content[0].text,/NOT_FOUND/);

  const expiredTask=await activeTask();await pool.query(`UPDATE mcp_oauth_token_sets SET access_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[auth.token_set_id]);const expired=await call(auth.token,expiredTask,1);assert.equal(expired.statusCode,401,expired.body);assert.equal((await pool.query(`SELECT state FROM monitor_tasks WHERE id=$1`,[expiredTask])).rows[0].state,'active');
  const revokedAuth=await authorize(await register('Synthetic revoked pause client'));const revokedTask=await activeTask();await pool.query(`UPDATE mcp_oauth_grants SET revoked_at=clock_timestamp() WHERE id=$1`,[revokedAuth.grant_id]);const revoked=await call(revokedAuth.token,revokedTask,1);assert.equal(revoked.statusCode,401,revoked.body);
  const revokedClientAuth=await authorize(await register('Synthetic revoked-client pause client'));const clientTask=await activeTask();await pool.query(`UPDATE mcp_oauth_clients SET revoked_at=clock_timestamp() WHERE id=$1`,[revokedClientAuth.client_database_id]);const revokedClient=await call(revokedClientAuth.token,clientTask,1);assert.equal(revokedClient.statusCode,401,revokedClient.body);

  const rollbackTask=await activeTask();const rollbackMessage=await notice(rollbackTask,{personIds:[personId]});const actor={accountId,installationId,householdId,membershipId,capabilities:['household.manage','message.manage.household'] as any};
  await assert.rejects(()=>new MonitorService().setState(actor,rollbackTask,1,'pause',{audit:async()=>{throw new Error('synthetic audit failure');}}),/synthetic audit failure/);
  assert.equal((await pool.query(`SELECT state FROM monitor_tasks WHERE id=$1`,[rollbackTask])).rows[0].state,'active');assert.equal((await pool.query(`SELECT state FROM messages WHERE id=$1`,[rollbackMessage])).rows[0].state,'scheduled');

  const browserTask=await activeTask();const browser=await inject({method:'POST',url:`/api/v1/households/${householdId}/monitors/${browserTask}/pause`,headers:{cookie,origin,'x-csrf-token':csrf},payload:{expectedRevision:1}});assert.equal(browser.statusCode,200,browser.body);assert.equal(browser.json().state,'paused');assert.equal((await pool.query(`SELECT count(*)::int count FROM audit_events WHERE subject_id=$1 AND actor_type='account' AND action='monitor.pause'`,[browserTask])).rows[0].count,1);
  const catalog=(await pool.query(`SELECT introduced_version,risk FROM mcp_oauth_scope_catalog WHERE scope='mcp:monitors:pause'`)).rows[0];assert.deepEqual(catalog,{introduced_version:18,risk:'write'});
});
