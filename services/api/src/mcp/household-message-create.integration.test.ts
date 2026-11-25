import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { tokenHash } from '@samvev/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://samvev.test.invalid',callback='https://message-writer.test.invalid/oauth/callback';
let app:FastifyInstance,householdId='',installationId='',membershipId='',accountId='',adminCookie='',adminCsrf='',clientId='',personId='',grantedPersonId='',deniedPersonId='',grantedDisplayId='',deniedDisplayId='',foreignPersonId='',foreignDisplayId='';
function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-message-writer',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function call(token:string,input:Record<string,unknown>,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...modernHeaders('household.messages.create')},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.messages.create',arguments:input,_meta:meta}}});}
async function authorize(scopes:string,serial:number){
  const verifier=`synthetic-message-create-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`message-create-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:scopes,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}
async function policy(grantId:string,expectedRevision:number,scopes:string[],personIds:string[],displayIds:string[]){
  return inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{expectedRevision,scopes,personIds,displayIds,resources:[]}});
}
function input(body:string,idempotencyKey:string,audience:{household:boolean;personIds:string[];displayIds:string[]},publishAt?:string){return {body,importance:'normal',audience,...(publishAt?{publishAt}:{}),expiresAt:'2099-01-01T00:00:00.000Z',idempotencyKey};}
async function createThroughMcp(token:string,value:Record<string,unknown>,id:number){const response=await call(token,value,id);assert.equal(response.statusCode,200,response.body);return response;}

before(async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic message writer',email:'message-writer@test.invalid',password:'Synthetic-message-writer-pass-42'},household:{name:'Synthetic message writer household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  const actor=(await pool.query<{installation_id:string;membership_id:string;account_id:string;person_id:string}>('SELECT h.installation_id,m.id membership_id,m.account_id,m.person_id FROM households h JOIN memberships m ON m.household_id=h.id WHERE h.id=$1',[householdId])).rows[0]!;
  installationId=actor.installation_id;membershipId=actor.membership_id;accountId=actor.account_id;personId=actor.person_id;
  grantedPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic message recipient granted','adult') RETURNING id`,[householdId])).rows[0]!.id;
  deniedPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic message recipient withheld','adult') RETURNING id`,[householdId])).rows[0]!.id;
  grantedDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic granted display','en','light') RETURNING id`,[householdId])).rows[0]!.id;
  deniedDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic ungranted display','en','light') RETURNING id`,[householdId])).rows[0]!.id;
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic message writer MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;
  const foreignHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic foreign message household','UTC','en','synthetic') RETURNING id`,[installationId])).rows[0]!.id;
  foreignPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic foreign recipient','adult') RETURNING id`,[foreignHousehold])).rows[0]!.id;
  foreignDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic foreign display','en','light') RETURNING id`,[foreignHousehold])).rows[0]!.id;
});
after(async()=>{if(app)await app.close();await pool.end();});

test('MCP message create uses member policy, exact recipients, and the web lifecycle',async()=>{
  const scopes='mcp:context mcp:messages:read mcp:messages:write';
  let token=await authorize(scopes,1);
  const grant=(await pool.query<{id:string;revision:number}>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  const configured=await policy(grant.id,grant.revision,[...scopes.split(' ')],[grantedPersonId],[grantedDisplayId]);assert.equal(configured.statusCode,200,configured.body);
  token=await authorize(scopes,2);
  const capabilities=(await pool.query<{capabilities:string[]}>('SELECT capabilities FROM memberships WHERE id=$1',[membershipId])).rows[0]!.capabilities;
  await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1',[membershipId,JSON.stringify(capabilities.filter((capability)=>capability!=='display.manage'))]);
  await pool.query('DELETE FROM membership_display_grants WHERE membership_id=$1 AND display_id=$2',[membershipId,grantedDisplayId]);

  const emptyAudience=await createThroughMcp(token,{body:'No recipient defaults to nobody',expiresAt:'2099-01-01T00:00:00.000Z',idempotencyKey:'empty-audience-001'},1);
  assert.equal(rpc(emptyAudience).result.isError,true,'an omitted audience cannot silently broaden delivery');

  const householdInput=input('Synthetic person message created through web then retried by MCP','web-message-replay-001',{household:false,personIds:[grantedPersonId],displayIds:[]});
  const webCreated=await inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:householdInput});assert.equal(webCreated.statusCode,201,webCreated.body);
  const webId=webCreated.json().id as string;
  const replay=await createThroughMcp(token,householdInput,2);assert.equal(rpc(replay).result.structuredContent.message.id,webId,'the MCP writer uses the same idempotency record as the web route');
  const mismatch=await createThroughMcp(token,{...householdInput,body:'Different payload for same key'},3);assert.equal(rpc(mismatch).result.isError,true);assert.match(rpc(mismatch).result.content[0].text,/CONFLICT/);

  const broadAudience=await createThroughMcp(token,input('Synthetic message must not widen to the household','mcp-household-broadcast-001',{household:true,personIds:[grantedPersonId],displayIds:[]}),4);
  assert.equal(rpc(broadAudience).result.isError,true);assert.match(rpc(broadAudience).result.content[0].text,/FORBIDDEN/);

  const personInput=input('Synthetic private message for explicitly granted person','mcp-person-message-001',{household:false,personIds:[grantedPersonId],displayIds:[]});
  const personCreated=await createThroughMcp(token,personInput,4);const personMessage=rpc(personCreated).result.structuredContent.message;
  assert.equal((await pool.query('SELECT 1 FROM message_person_audiences WHERE household_id=$1 AND message_id=$2 AND person_id=$3',[householdId,personMessage.id,grantedPersonId])).rowCount,1);
  const provenance=(await pool.query<{author_membership_id:string;actor_id:string;actor_type:string}>(`SELECT message.author_membership_id,event.actor_id,event.actor_type
    FROM messages message JOIN message_lifecycle_events event ON event.message_id=message.id WHERE message.id=$1 AND event.idempotency_key=$2`,[personMessage.id,`create:${personMessage.id}`])).rows[0]!;
  assert.deepEqual(provenance,{author_membership_id:membershipId,actor_id:accountId,actor_type:'account'},'MCP keeps the actual OAuth member as author and lifecycle actor');

  const displayInput=input('Synthetic message for granted display','mcp-display-message-001',{household:false,personIds:[],displayIds:[grantedDisplayId]});
  const missingMemberDisplayGrant=await createThroughMcp(token,displayInput,5);
  assert.equal(rpc(missingMemberDisplayGrant).result.isError,true,'OAuth display grant alone cannot bypass member display authorization');assert.match(rpc(missingMemberDisplayGrant).result.content[0].text,/FORBIDDEN/);
  await pool.query('INSERT INTO membership_display_grants(household_id,membership_id,display_id) VALUES($1,$2,$3)',[householdId,membershipId,grantedDisplayId]);
  const displayCreated=await createThroughMcp(token,displayInput,15);const displayMessage=rpc(displayCreated).result.structuredContent.message;
  assert.equal((await pool.query('SELECT 1 FROM message_display_targets WHERE household_id=$1 AND message_id=$2 AND display_id=$3',[householdId,displayMessage.id,grantedDisplayId])).rowCount,1);

  const deniedPerson=await createThroughMcp(token,input('Synthetic denied person message','mcp-denied-person-001',{household:false,personIds:[deniedPersonId],displayIds:[]}),6);
  assert.equal(rpc(deniedPerson).result.isError,true);assert.match(rpc(deniedPerson).result.content[0].text,/FORBIDDEN/);
  const deniedDisplay=await createThroughMcp(token,input('Synthetic denied display message','mcp-denied-display-001',{household:false,personIds:[],displayIds:[deniedDisplayId]}),7);
  assert.equal(rpc(deniedDisplay).result.isError,true);assert.match(rpc(deniedDisplay).result.content[0].text,/FORBIDDEN/);
  const foreignPerson=await createThroughMcp(token,input('Synthetic cross-household person message','mcp-foreign-person-001',{household:false,personIds:[foreignPersonId],displayIds:[]}),8);
  assert.equal(rpc(foreignPerson).result.isError,true);assert.match(rpc(foreignPerson).result.content[0].text,/NOT_FOUND/);
  const foreignDisplay=await createThroughMcp(token,input('Synthetic cross-household display message','mcp-foreign-display-001',{household:false,personIds:[],displayIds:[foreignDisplayId]}),9);
  assert.equal(rpc(foreignDisplay).result.isError,true);assert.match(rpc(foreignDisplay).result.content[0].text,/NOT_FOUND/);

  await pool.query(`UPDATE memberships SET capabilities=capabilities-'message.publish.display' WHERE id=$1`,[membershipId]);
  const noDisplayCapability=await createThroughMcp(token,input('Synthetic denied by current display capability','mcp-no-display-cap-001',{household:false,personIds:[],displayIds:[grantedDisplayId]}),10);
  assert.equal(rpc(noDisplayCapability).result.isError,true);assert.match(rpc(noDisplayCapability).result.content[0].text,/FORBIDDEN/);
  await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1',[membershipId,JSON.stringify(capabilities)]);
  await pool.query(`UPDATE memberships SET capabilities=capabilities-'message.schedule' WHERE id=$1`,[membershipId]);
  const future='2098-12-31T08:00:00.000Z';
  const noScheduleCapability=await createThroughMcp(token,input('Synthetic denied schedule','mcp-no-schedule-cap-001',{household:false,personIds:[grantedPersonId],displayIds:[]},future),11);
  assert.equal(rpc(noScheduleCapability).result.isError,true);assert.match(rpc(noScheduleCapability).result.content[0].text,/FORBIDDEN/);
  await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1',[membershipId,JSON.stringify(capabilities)]);
  const scheduled=await createThroughMcp(token,input('Synthetic authorized schedule','mcp-scheduled-message-001',{household:false,personIds:[grantedPersonId],displayIds:[]},future),12);
  assert.equal(rpc(scheduled).result.structuredContent.message.state,'scheduled');

  const readOnlyToken=await authorize('mcp:context mcp:messages:read',3);
  const noWriteScope=await call(readOnlyToken,input('Synthetic read-only token cannot create','mcp-read-only-001',{household:true,personIds:[],displayIds:[]}),13);
  assert.equal(noWriteScope.statusCode,403,noWriteScope.body);

  const current=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grant.id])).rows[0]!.revision;
  const narrowed=await policy(grant.id,current,['mcp:context','mcp:messages:read'],[grantedPersonId],[]);assert.equal(narrowed.statusCode,200,narrowed.body);
  const stale=await call(token,personInput,14);assert.equal(stale.statusCode,401,stale.body);
  assert.equal((await pool.query(`SELECT 1 FROM messages WHERE household_id=$1 AND idempotency_key='mcp-denied-person-001'`,[householdId])).rowCount,0);
  const revokedTokenSet=(await pool.query<{id:string}>('SELECT id FROM mcp_oauth_token_sets WHERE grant_id=$1 AND access_token_hash=$2',[grant.id,tokenHash(token)])).rows[0]!;
  assert.ok(revokedTokenSet.id,'the stale token remains tracked as revoked');
});
