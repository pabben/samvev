import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { personColorTokens } from '@samvev/contracts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://people-update.test.invalid',callback='https://people-update-client.test.invalid/oauth/callback';
let app:FastifyInstance,householdId='',installationId='',ownerMembershipId='',ownerPersonId='',ownerCookie='',ownerCsrf='',clientId='',targetPersonId='',ungrantedPersonId='',foreignPersonId='';
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-people-update-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
function mcpHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function authorize(serial:number,scope='mcp:people:read mcp:people:write mcp:context'){
  const verifier=`synthetic-people-update-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`people-update-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:ownerCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:ownerCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:ownerCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}
async function callUpdate(token:string,id:number,args:Record<string,unknown>){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...mcpHeaders('household.people.update')},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.people.update',arguments:args,_meta:meta}}});}
async function callPeopleList(token:string,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...mcpHeaders('household.people.list')},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.people.list',arguments:{},_meta:meta}}});}
async function selectPerson(grantId:string,revision:number,personIds:string[],scopes=['mcp:people:read','mcp:people:write','mcp:context']){
  const response=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:revision,scopes,personIds,displayIds:[],resources:[]}});
  assert.equal(response.statusCode,200,response.body);return response.json() as {revision:number};
}

before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');if(url.hostname!=='test-db'||url.pathname!=='/samvev_test')throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic profile owner',email:'profile-owner@test.invalid',password:'Synthetic-profile-owner-pass-42'},household:{name:'Synthetic profile household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;ownerCookie=cookies(claim);ownerCsrf=claim.json().csrfToken;
  const owner=(await pool.query<{installation_id:string;membership_id:string;person_id:string}>('SELECT h.installation_id,m.id membership_id,m.person_id FROM households h JOIN memberships m ON m.household_id=h.id WHERE h.id=$1',[householdId])).rows[0]!;
  installationId=owner.installation_id;ownerMembershipId=owner.membership_id;ownerPersonId=owner.person_id;
  const made=await inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{displayName:'Synthetic profile target',birthDate:'2015-01-01',rolePreset:'limited',displayIds:[]}});assert.equal(made.statusCode,201,made.body);targetPersonId=made.json().personId;
  ungrantedPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic ungranted profile','child') RETURNING id`,[householdId])).rows[0]!.id;
  const foreignHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic foreign profile household','UTC','en','synthetic') RETURNING id`,[installationId])).rows[0]!.id;
  foreignPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic foreign profile','child') RETURNING id`,[foreignHousehold])).rows[0]!.id;
  const client=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic profile MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(client.statusCode,201,client.body);clientId=client.json().client_id;
});
after(async()=>{if(app)await app.close();await pool.end();});

test('MCP profile updates share member PATCH behavior and enforce grant, capability, revision, and scope boundaries',async()=>{
  let token=await authorize(1);
  const grant=(await pool.query<{id:string;revision:number}>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  let policy=await selectPerson(grant.id,grant.revision,[targetPersonId]);
  token=await authorize(2);
  const accountBefore=(await pool.query<{revision:number}>('SELECT revision FROM accounts WHERE id=(SELECT account_id FROM memberships WHERE id=$1)',[ownerMembershipId])).rows[0]!.revision;
  const fields={displayName:'Synthetic shared profile',avatarKey:'avatar-03',colorToken:personColorTokens[1]};
  const routeUpdate=await inject({method:'PATCH',url:`/api/v1/households/${householdId}/people/${targetPersonId}`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{...fields,expectedRevision:1}});assert.equal(routeUpdate.statusCode,200,routeUpdate.body);
  const routeProfile=routeUpdate.json();assert.equal(routeProfile.birth_date,'2015-01-01');assert.equal(routeProfile.age_group,'child');
  const peopleRead=await callPeopleList(token,1);assert.equal(peopleRead.statusCode,200,peopleRead.body);assert.equal(rpc(peopleRead).result.isError,undefined,peopleRead.body);
  const listedPeople=rpc(peopleRead).result.structuredContent.people as Array<Record<string,unknown>>;
  assert.deepEqual(listedPeople,[{id:targetPersonId,displayName:routeProfile.display_name,ageGroup:'child',revision:routeProfile.revision}], 'grant-scoped list provides the current revision with only the existing profile fields');
  const listedRevision=listedPeople[0]!.revision as number;
  const mcpUpdate=await callUpdate(token,2,{personId:targetPersonId,...fields,expectedRevision:listedRevision});assert.equal(mcpUpdate.statusCode,200,mcpUpdate.body);
  const mcpResult=rpc(mcpUpdate).result;assert.equal(mcpResult.isError,undefined,mcpUpdate.body);
  const mcpProfile=mcpResult.structuredContent as {id:string;revision:number};
  assert.deepEqual(mcpProfile,{id:targetPersonId,revision:routeProfile.revision+1});
  assert.doesNotMatch(mcpUpdate.body,/2015-01-01|birth_date|age_group|avatarKey|colorToken|displayName/,'MCP mutation response contains no profile data');
  const persisted=(await pool.query<{id:string;display_name:string;avatar_key:string|null;color_token:string;birth_date:string|null;age_group:string;revision:number}>('SELECT id,display_name,avatar_key,color_token,birth_date::text,age_group,revision FROM persons WHERE id=$1',[targetPersonId])).rows[0]!;
  assert.deepEqual({id:persisted.id,displayName:persisted.display_name,avatarKey:persisted.avatar_key,colorToken:persisted.color_token},{id:routeProfile.id,displayName:routeProfile.display_name,avatarKey:routeProfile.avatarKey,colorToken:routeProfile.colorToken},'MCP and member PATCH use the same profile field updates');
  assert.equal(persisted.birth_date,'2015-01-01','MCP cannot modify birth date');assert.equal(persisted.age_group,'child','MCP cannot modify age group');assert.equal(mcpProfile.revision,persisted.revision);
  assert.equal((await pool.query<{revision:number}>('SELECT revision FROM accounts WHERE id=(SELECT account_id FROM memberships WHERE id=$1)',[ownerMembershipId])).rows[0]!.revision,accountBefore,'profile changes never mutate login/account state');
  const auditRows=await pool.query<{actor_type:string;action:string}>(`SELECT actor_type,action FROM audit_events WHERE household_id=$1 AND subject_type='person' AND subject_id=$2 AND action='person.updated' ORDER BY occurred_at`,[householdId,targetPersonId]);
  assert.deepEqual(auditRows.rows.map(row=>row.actor_type),['account','mcp']);

  const ungranted=await callUpdate(token,3,{personId:ungrantedPersonId,displayName:'Should not change',expectedRevision:1});assert.equal(ungranted.statusCode,200,ungranted.body);assert.equal(rpc(ungranted).result.isError,true);
  const foreign=await callUpdate(token,4,{personId:foreignPersonId,displayName:'Should not change',expectedRevision:1});assert.equal(foreign.statusCode,200,foreign.body);assert.equal(rpc(foreign).result.isError,true);
  const untouched=(await pool.query<{display_name:string}>(`SELECT display_name FROM persons WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],id)`,[[ungrantedPersonId,foreignPersonId]])).rows.map(row=>row.display_name);
  assert.deepEqual(untouched,['Synthetic ungranted profile','Synthetic foreign profile']);
  const stale=await callUpdate(token,5,{personId:targetPersonId,displayName:'Stale profile write',expectedRevision:listedRevision});assert.equal(stale.statusCode,200,stale.body);assert.equal(rpc(stale).result.isError,true);
  assert.equal((await pool.query<{display_name:string}>('SELECT display_name FROM persons WHERE id=$1',[targetPersonId])).rows[0]!.display_name,fields.displayName);

  let currentGrant=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grant.id])).rows[0]!;
  policy=await selectPerson(grant.id,currentGrant.revision,[targetPersonId],['mcp:people:write','mcp:context']);
  assert.deepEqual(policy.personIds,[targetPersonId],'narrowing away read access retains the existing exact-person grant');
  assert.deepEqual((await pool.query<{person_id:string}>('SELECT person_id FROM mcp_oauth_grant_people WHERE grant_id=$1',[grant.id])).rows.map(row=>row.person_id),[targetPersonId]);
  const addedPersonWithoutRead=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grant.id}/policy`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:policy.revision,scopes:['mcp:people:write','mcp:context'],personIds:[targetPersonId,ungrantedPersonId],displayIds:[],resources:[]}});
  assert.equal(addedPersonWithoutRead.statusCode,400,addedPersonWithoutRead.body);assert.match(addedPersonWithoutRead.body,/resource_scope_required/,'write-only policy cannot select another person');
  const writeOnly=await authorize(3,'mcp:people:write mcp:context');
  const writeOnlyList=await callPeopleList(writeOnly,6);assert.equal(rpc(writeOnlyList).result.isError,true,'write-only consent cannot read person data or its revision');
  const writeOnlyUpdate=await callUpdate(writeOnly,7,{personId:targetPersonId,displayName:'Write-only profile update',expectedRevision:mcpProfile.revision});assert.equal(rpc(writeOnlyUpdate).result.isError,true,'write-only consent cannot update without read permission');
  assert.match(rpc(writeOnlyUpdate).result.content[0].text,/FORBIDDEN/);
  currentGrant=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grant.id])).rows[0]!;
  policy=await selectPerson(grant.id,currentGrant.revision,[],['mcp:context']);
  const revoked=await callUpdate(token,5,{personId:targetPersonId,displayName:'Narrowed scope denied',expectedRevision:mcpProfile.revision});assert.equal(revoked.statusCode,401,revoked.body);
  const contextOnly=await authorize(4,'mcp:context');
  const noWrite=await callUpdate(contextOnly,8,{personId:targetPersonId,displayName:'Narrowed scope denied',expectedRevision:mcpProfile.revision});assert.equal(noWrite.statusCode,403,noWrite.body);assert.match(String(noWrite.headers['www-authenticate']),/mcp%3Apeople%3Awrite|mcp:people:write/);
  assert.equal((await pool.query<{display_name:string}>('SELECT display_name FROM persons WHERE id=$1',[targetPersonId])).rows[0]!.display_name,fields.displayName);
});
