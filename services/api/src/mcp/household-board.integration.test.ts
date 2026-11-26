import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { HouseholdBoardService, type IntegrationBoardActor } from '../household-board/service.ts';

const origin='https://samvev.test.invalid',callback='https://board-client.test.invalid/oauth/callback';
const allScopes='mcp:groceries:read mcp:groceries:write mcp:dinners:read mcp:dinners:write';
let app:FastifyInstance,householdId='',foreignHouseholdId='',membershipId='',adminCookie='',adminCsrf='',clientId='',dinnerOptionId='',foreignGroceryId='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-board-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function call(token:string,name:string,args:Record<string,unknown>,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...modernHeaders(name)},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}}});}
async function authorize(scopes:string,serial:number){
  const verifier=`synthetic-board-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`board-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:scopes,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}

before(async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic board owner',email:'board-owner@test.invalid',password:'Synthetic-board-owner-pass-42'},household:{name:'Synthetic board household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  membershipId=(await pool.query<{id:string}>('SELECT id FROM memberships WHERE household_id=$1',[householdId])).rows[0]!.id;
  dinnerOptionId=(await pool.query<{id:string}>(`INSERT INTO household_dinner_options(household_id,title,emoji,created_by_actor_type,created_by_actor_id) VALUES($1,'Synthetic soup','🍲','member',$2) RETURNING id`,[householdId,membershipId])).rows[0]!.id;
  foreignHouseholdId=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) SELECT id,'Foreign synthetic board household','UTC','en','synthetic' FROM installations WHERE singleton RETURNING id`)).rows[0]!.id;
  foreignGroceryId=(await pool.query<{id:string}>(`INSERT INTO household_grocery_items(household_id,label,checked,created_by_actor_type,created_by_actor_id) VALUES($1,'Foreign private grocery',false,'member',gen_random_uuid()) RETURNING id`,[foreignHouseholdId])).rows[0]!.id;
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic board MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;
});
after(async()=>{await app.close();await pool.end();});

test('MCP board writes use live delegated authority, revisions and durable request keys',async()=>{
  const writeOnly=await authorize('mcp:groceries:write',1);
  const missingRead=await call(writeOnly,'household.groceries.add',{label:'Must not be added',checked:false,requestKey:'write-only-add-0001'},1);assert.equal(missingRead.statusCode,403,missingRead.body);assert.match(String(missingRead.headers['www-authenticate']),/mcp%3Agroceries%3Aread|mcp:groceries:read/);

  const token=await authorize(allScopes,2);
  const added=await call(token,'household.groceries.add',{label:'Synthetic apples',checked:false,requestKey:'grocery-add-0001'},2);assert.equal(added.statusCode,200,added.body);const item=rpc(added).result.structuredContent.item;assert.equal(item.revision,1);
  const replay=await call(token,'household.groceries.add',{label:'Synthetic apples',checked:false,requestKey:'grocery-add-0001'},3);assert.equal(replay.statusCode,200,replay.body);assert.equal(rpc(replay).result.structuredContent.item.id,item.id);assert.equal(rpc(replay).result.structuredContent.item.revision,1);
  const mismatch=await call(token,'household.groceries.add',{label:'Changed retry',checked:false,requestKey:'grocery-add-0001'},4);assert.equal(mismatch.statusCode,200,mismatch.body);assert.equal(rpc(mismatch).result.isError,true);assert.match(rpc(mismatch).result.content[0].text,/CONFLICT/);
  const checked=await call(token,'household.groceries.update',{id:item.id,checked:true,expectedRevision:1,requestKey:'grocery-check-0001'},5);assert.equal(checked.statusCode,200,checked.body);assert.equal(rpc(checked).result.structuredContent.item.checked,true);assert.equal(rpc(checked).result.structuredContent.item.revision,2);
  const unchecked=await call(token,'household.groceries.update',{id:item.id,checked:false,expectedRevision:2,requestKey:'grocery-uncheck-0001'},6);assert.equal(unchecked.statusCode,200,unchecked.body);assert.equal(rpc(unchecked).result.structuredContent.item.checked,false);assert.equal(rpc(unchecked).result.structuredContent.item.revision,3);
  const stale=await call(token,'household.groceries.update',{id:item.id,checked:true,expectedRevision:1,requestKey:'grocery-stale-0001'},7);assert.equal(stale.statusCode,200,stale.body);assert.equal(rpc(stale).result.isError,true);assert.match(rpc(stale).result.content[0].text,/REVISION_CONFLICT/);
  const cross=await call(token,'household.groceries.update',{id:foreignGroceryId,checked:true,expectedRevision:1,requestKey:'grocery-cross-0001'},8);assert.equal(cross.statusCode,200,cross.body);assert.equal(rpc(cross).result.isError,true);assert.doesNotMatch(cross.body,/Foreign private grocery/);

  const options=await call(token,'household.dinners.options.list',{},9);assert.equal(options.statusCode,200,options.body);assert.deepEqual(rpc(options).result.structuredContent.options.map((option:{id:string})=>option.id),[dinnerOptionId]);
  const createdOption=await call(token,'household.dinners.options.create',{title:'Synthetic rice',emoji:'🍚',requestKey:'dinner-option-create-0001'},90);assert.equal(createdOption.statusCode,200,createdOption.body);assert.notEqual(rpc(createdOption).result.isError,true,createdOption.body);const optionId=rpc(createdOption).result.structuredContent.option.id as string;
  const optionAudit=await pool.query<{subject_type:string;subject_id:string;action:string}>(`SELECT subject_type,subject_id,action FROM audit_events WHERE household_id=$1 AND action='mcp.dinner_option_created' ORDER BY id DESC LIMIT 1`,[householdId]);assert.deepEqual(optionAudit.rows[0],{subject_type:'dinner_option',subject_id:optionId,action:'mcp.dinner_option_created'});
  const createdReplay=await call(token,'household.dinners.options.create',{title:'Synthetic rice',emoji:'🍚',requestKey:'dinner-option-create-0001'},93);assert.equal(createdReplay.statusCode,200,createdReplay.body);assert.equal((await pool.query(`SELECT 1 FROM audit_events WHERE household_id=$1 AND action='mcp.dinner_option_created' AND subject_id=$2`,[householdId,optionId])).rowCount,1,'create replay does not duplicate the option audit');
  const editedOption=await call(token,'household.dinners.options.update',{id:optionId,title:'Synthetic rice bowl',expectedRevision:1,requestKey:'dinner-option-update-0001'},91);assert.equal(editedOption.statusCode,200,editedOption.body);
  const updateAudit=await pool.query<{subject_type:string;subject_id:string;action:string}>(`SELECT subject_type,subject_id,action FROM audit_events WHERE household_id=$1 AND action='mcp.dinner_option_updated' ORDER BY id DESC LIMIT 1`,[householdId]);assert.deepEqual(updateAudit.rows[0],{subject_type:'dinner_option',subject_id:optionId,action:'mcp.dinner_option_updated'});
  const updatedReplay=await call(token,'household.dinners.options.update',{id:optionId,title:'Synthetic rice bowl',expectedRevision:1,requestKey:'dinner-option-update-0001'},94);assert.equal(updatedReplay.statusCode,200,updatedReplay.body);assert.equal((await pool.query(`SELECT 1 FROM audit_events WHERE household_id=$1 AND action='mcp.dinner_option_updated' AND subject_id=$2`,[householdId,optionId])).rowCount,1,'update replay does not duplicate the option audit');
  const removedOption=await call(token,'household.dinners.options.delete',{id:optionId,expectedRevision:2,requestKey:'dinner-option-delete-0001'},92);assert.equal(removedOption.statusCode,200,removedOption.body);
  const deleteAudit=await pool.query<{subject_type:string;subject_id:string;action:string}>(`SELECT subject_type,subject_id,action FROM audit_events WHERE household_id=$1 AND action='mcp.dinner_option_deleted' ORDER BY id DESC LIMIT 1`,[householdId]);assert.deepEqual(deleteAudit.rows[0],{subject_type:'dinner_option',subject_id:optionId,action:'mcp.dinner_option_deleted'});
  const deletedReplay=await call(token,'household.dinners.options.delete',{id:optionId,expectedRevision:2,requestKey:'dinner-option-delete-0001'},95);assert.equal(deletedReplay.statusCode,200,deletedReplay.body);assert.equal((await pool.query(`SELECT 1 FROM audit_events WHERE household_id=$1 AND action='mcp.dinner_option_deleted' AND subject_id=$2`,[householdId,optionId])).rowCount,1,'delete replay does not duplicate the option audit');

  const integrationActor:IntegrationBoardActor={kind:'integration',id:'00000000-0000-4000-8000-000000000099',householdId,installationId:(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[householdId])).rows[0]!.installation_id,credentialId:'00000000-0000-4000-8000-000000000099',credentialRevision:0,capabilities:[]};
  const directBoard=new HouseholdBoardService(async()=>{},async()=>{});
  const optionCountBefore=(await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM household_dinner_options WHERE household_id=$1`,[householdId])).rows[0]!.count;
  await assert.rejects(directBoard.createDinnerOption(integrationActor,{title:'Synthetic rolled back',emoji:'🥣',requestKey:'dinner-audit-failure-0001'},async()=>{throw new Error('synthetic audit insert failure');}),/synthetic audit insert failure/);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM household_dinner_options WHERE household_id=$1`,[householdId])).rows[0]!.count,optionCountBefore,'audit failure rolls back option write');
  let auditCalls=0,targetId='';
  const committedOption=await directBoard.createDinnerOption(integrationActor,{title:'Synthetic audit replay',emoji:'🍜',requestKey:'dinner-audit-replay-0001'},async(_client,result)=>{auditCalls++;targetId=result.option.id;});
  const replayedOption=await directBoard.createDinnerOption(integrationActor,{title:'Synthetic audit replay',emoji:'🍜',requestKey:'dinner-audit-replay-0001'},async()=>{auditCalls++;});
  assert.equal(committedOption.option.id,targetId);assert.equal(replayedOption.option.id,targetId);assert.equal(auditCalls,1,'idempotent replay does not write a duplicate audit');
  const assigned=await call(token,'household.dinners.assign',{localDate:'2027-03-20',optionId:dinnerOptionId,expectedRevision:0,requestKey:'dinner-assign-0001'},10);assert.equal(assigned.statusCode,200,assigned.body);assert.equal(rpc(assigned).result.structuredContent.assignment.title,'Synthetic soup');assert.equal(rpc(assigned).result.structuredContent.assignment.revision,1);
  const assignedReplay=await call(token,'household.dinners.assign',{localDate:'2027-03-20',optionId:dinnerOptionId,expectedRevision:0,requestKey:'dinner-assign-0001'},11);assert.equal(assignedReplay.statusCode,200,assignedReplay.body);assert.equal(rpc(assignedReplay).result.structuredContent.assignment.revision,1);
  const cleared=await call(token,'household.dinners.assign',{localDate:'2027-03-20',optionId:null,expectedRevision:1,requestKey:'dinner-clear-0001'},12);assert.equal(cleared.statusCode,200,cleared.body);assert.equal(rpc(cleared).result.structuredContent.assignment.cleared,true);assert.equal(rpc(cleared).result.structuredContent.assignment.revision,2);

  const grant=(await pool.query<{id:string}>('SELECT id FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  await pool.query(`UPDATE mcp_oauth_grants SET scopes=scopes-'mcp:groceries:write' WHERE id=$1`,[grant.id]);
  const liveDenied=await call(token,'household.groceries.add',{label:'Denied after live narrowing',checked:false,requestKey:'grocery-live-deny-0001'},13);assert.equal(liveDenied.statusCode,200,liveDenied.body);assert.equal(rpc(liveDenied).result.isError,true);assert.match(rpc(liveDenied).result.content[0].text,/FORBIDDEN/);
  assert.equal((await pool.query(`SELECT 1 FROM household_grocery_items WHERE household_id=$1 AND label='Denied after live narrowing'`,[householdId])).rowCount,0);

  const actor=(await pool.query<{created_by_actor_type:string;created_by_actor_id:string}>(`SELECT created_by_actor_type,created_by_actor_id FROM household_grocery_items WHERE id=$1`,[item.id])).rows[0]!;assert.deepEqual(actor,{created_by_actor_type:'integration',created_by_actor_id:grant.id});
  assert.equal((await pool.query('SELECT 1 FROM integration_credentials WHERE id=$1',[grant.id])).rowCount,0,'MCP writes never create or reuse a legacy integration credential');
  const dinnerActor=(await pool.query<{updated_by_actor_type:string;updated_by_actor_id:string}>(`SELECT updated_by_actor_type,updated_by_actor_id FROM household_dinner_assignments WHERE household_id=$1 AND local_date='2027-03-20'`,[householdId])).rows[0]!;assert.deepEqual(dinnerActor,{updated_by_actor_type:'integration',updated_by_actor_id:grant.id});
  await pool.query(`UPDATE persons SET age_group='child' WHERE id=(SELECT person_id FROM memberships WHERE id=$1)`,[membershipId]);
  const demoted=await call(token,'household.dinners.list',{from:'2027-03-20',to:'2027-03-20'},14);
  assert.ok(demoted.statusCode===401 || (demoted.statusCode===200 && rpc(demoted).result.isError===true), 'a demoted child account cannot keep MCP board access');
  assert.doesNotMatch(demoted.body,/Synthetic soup/);
});
