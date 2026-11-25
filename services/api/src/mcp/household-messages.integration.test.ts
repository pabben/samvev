import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { tokenHash } from '@samvev/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://samvev.test.invalid',callback='https://messages-client.test.invalid/oauth/callback';
let app:FastifyInstance,householdId='',installationId='',membershipId='',personId='',adminCookie='',adminCsrf='',clientId='',grantedPersonId='',deniedPersonId='',foreignBody='';
function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-messages-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function call(token:string,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...modernHeaders('household.messages.list')},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.messages.list',arguments:{},_meta:meta}}});}
async function authorize(serial:number){
  const verifier=`synthetic-message-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`messages-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:'mcp:messages:read mcp:context',state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}
async function createMessage(body:string,audience:{household:boolean;personIds:string[]},requestKey:string){
  const response=await inject({method:'POST',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{body,importance:'normal',audience,expiresAt:'2099-01-01T00:00:00.000Z',idempotencyKey:requestKey}});
  assert.equal(response.statusCode,201,response.body);return response.json().id as string;
}

before(async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic message owner',email:'message-owner@test.invalid',password:'Synthetic-message-owner-pass-42'},household:{name:'Synthetic message household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  const actor=(await pool.query<{installation_id:string;membership_id:string;person_id:string}>('SELECT h.installation_id,m.id membership_id,m.person_id FROM households h JOIN memberships m ON m.household_id=h.id WHERE h.id=$1',[householdId])).rows[0]!;
  installationId=actor.installation_id;membershipId=actor.membership_id;personId=actor.person_id;
  grantedPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic granted message recipient','adult') RETURNING id`,[householdId])).rows[0]!.id;
  deniedPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic ungranted message recipient','adult') RETURNING id`,[householdId])).rows[0]!.id;
  const client=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic message MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(client.statusCode,201,client.body);clientId=client.json().client_id;
  const foreignHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic foreign message household','UTC','en','synthetic') RETURNING id`,[installationId])).rows[0]!.id;
  const foreignPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic foreign author','adult') RETURNING id`,[foreignHousehold])).rows[0]!.id;
  const foreignMembership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) SELECT $1,account_id,$3,'limited','[]'::jsonb FROM memberships WHERE id=$2 RETURNING id`,[foreignHousehold,membershipId,foreignPerson])).rows[0]!.id;
  foreignBody='Synthetic foreign household private message';
  await pool.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at) VALUES($1,$2,$3,'normal',true,clock_timestamp(),clock_timestamp()+interval '1 day','published','foreign-message-001',clock_timestamp())`,[foreignHousehold,foreignMembership,foreignBody]);
});
after(async()=>{if(app)await app.close();await pool.end();});

test('MCP message reads preserve household visibility and require explicit grants for private person recipients',async()=>{
  const householdMessage=await createMessage('Synthetic household audience message',{household:true,personIds:[]},'household-message-001');
  const grantedMessage=await createMessage('Synthetic granted recipient message',{household:false,personIds:[grantedPersonId]},'granted-message-001');
  const deniedMessage=await createMessage('Synthetic denied recipient message',{household:false,personIds:[deniedPersonId]},'denied-message-001');
  const displayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Synthetic private display','en','system') RETURNING id`,[householdId])).rows[0]!.id;
  const displayOnlyMessage=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,$2,'Synthetic display-only private message','normal',false,clock_timestamp(),clock_timestamp()+interval '1 day','published','display-only-message-001',clock_timestamp()) RETURNING id`,[householdId,membershipId])).rows[0]!.id;
  await pool.query(`INSERT INTO message_display_targets(household_id,message_id,display_id) VALUES($1,$2,$3)`,[householdId,displayOnlyMessage,displayId]);
  const memberList=await inject({method:'GET',url:`/api/v1/households/${householdId}/messages`,headers:{cookie:adminCookie}});assert.equal(memberList.statusCode,200,memberList.body);
  const routeIds=memberList.json().messages.map((message:{id:string})=>message.id);
  assert.ok(routeIds.includes(householdMessage)&&routeIds.includes(grantedMessage)&&routeIds.includes(deniedMessage)&&routeIds.includes(displayOnlyMessage),'the existing household member route retains its visibility policy');

  let token=await authorize(1);
  const grant=(await pool.query<{id:string;revision:number}>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  const grantPerson=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grant.id}/policy`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:grant.revision,scopes:['mcp:messages:read','mcp:context'],personIds:[grantedPersonId],displayIds:[],resources:[]}});
  assert.equal(grantPerson.statusCode,200,grantPerson.body,'message read scope permits explicit person resource selection');
  token=await authorize(2);
  const listed=await call(token,1);assert.equal(listed.statusCode,200,listed.body);
  const result=rpc(listed).result.structuredContent.messages as Array<{id:string;body:string;person_ids:string[];can_edit:boolean}>;
  assert.ok(result.some(message=>message.id===householdMessage),'household audience remains visible');
  assert.ok(result.some(message=>message.id===grantedMessage),'an explicitly granted person audience is visible');
  assert.ok(!result.some(message=>message.id===deniedMessage),'an ungranted person recipient stays hidden even from the message author');
  assert.ok(!result.some(message=>message.id===displayOnlyMessage),'a display-only message stays hidden without an explicit display grant');
  assert.ok(result.every(message=>!message.person_ids?.includes(deniedPersonId)),'ungranted recipient identifiers are redacted');
  assert.equal(listed.body.includes(foreignBody),false,'a different household is isolated');
  assert.equal(result.find(message=>message.id===grantedMessage)?.can_edit,false,'read-only MCP results never advertise edit authority');

  const afterConsent=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grant.id])).rows[0]!.revision;
  const narrowed=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grant.id}/policy`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:afterConsent,scopes:['mcp:context'],personIds:[],displayIds:[],resources:[]}});
  assert.equal(narrowed.statusCode,200,narrowed.body);
  const oldToken=await call(token,2);assert.equal(oldToken.statusCode,401,oldToken.body);assert.doesNotMatch(oldToken.body,/Synthetic granted recipient message/);

  const staleToken=await authorize(3);
  const afterNarrowing=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grant.id])).rows[0]!.revision;
  const regrant=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grant.id}/policy`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:afterNarrowing,scopes:['mcp:messages:read','mcp:context'],personIds:[grantedPersonId],displayIds:[],resources:[]}});
  assert.equal(regrant.statusCode,200,regrant.body);
  const staleAfterGrant=await call(staleToken,3);assert.equal(staleAfterGrant.statusCode,401,staleAfterGrant.body);
  token=await authorize(4);
  const refreshed=await call(token,4);assert.equal(refreshed.statusCode,200,refreshed.body);assert.ok(rpc(refreshed).result.structuredContent.messages.some((message:{id:string})=>message.id===grantedMessage));
  const tokenSet=(await pool.query<{id:string}>('SELECT id FROM mcp_oauth_token_sets WHERE grant_id=$1 AND access_token_hash=$2',[grant.id,tokenHash(token)])).rows[0]!;
  await pool.query('UPDATE mcp_oauth_token_sets SET revoked_at=clock_timestamp() WHERE id=$1',[tokenSet.id]);
  const revoked=await call(token,4);assert.equal(revoked.statusCode,401,revoked.body);assert.doesNotMatch(revoked.body,/Synthetic household audience message/);
});
