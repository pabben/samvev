import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://display-discovery.test.invalid',callback='https://display-discovery-client.test.invalid/oauth/callback';
const scope='mcp:displays:read';
let app:FastifyInstance,householdId='',installationId='',adminCookie='',adminCsrf='',clientId='',grantedDisplayId='',foreignDisplayId='',grantId='';
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-display-discovery-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
function mcpHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}

async function authorize(serial:number){
  const verifier=`synthetic-display-discovery-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`display-discovery-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}
async function call(token:string,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...mcpHeaders('household.displays.list')},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.displays.list',arguments:{},_meta:meta}}});}
async function setDisplayPolicy(expectedRevision:number,displayIds:string[]){return inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{expectedRevision,scopes:[scope],personIds:[],displayIds,resources:[]}});}

before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  if(url.hostname!=='test-db'||url.pathname!=='/samvev_test'||url.username!=='samvev_test'||url.password!=='synthetic-test-data-only')throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic display owner',email:'display-owner@test.invalid',password:'Synthetic-display-owner-pass-42'},household:{name:'Synthetic display household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  installationId=(await pool.query<{installation_id:string}>('SELECT installation_id FROM households WHERE id=$1',[householdId])).rows[0]!.installation_id;
  const setupId=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,locale,theme) VALUES($1,'Synthetic MCP setup','en','dark') RETURNING id`,[householdId])).rows[0]!.id;
  grantedDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,privacy_mode,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic authorized display','en','light',true,$2,repeat('a',64),clock_timestamp()+interval '1 day') RETURNING id`,[householdId,setupId])).rows[0]!.id;
  const foreignHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) VALUES($1,'Synthetic foreign display household','UTC','en','synthetic') RETURNING id`,[installationId])).rows[0]!.id;
  const foreignSetup=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,locale,theme) VALUES($1,'Synthetic foreign setup','en','light') RETURNING id`,[foreignHousehold])).rows[0]!.id;
  foreignDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,setup_id) VALUES($1,'Synthetic foreign private display','en','light',$2) RETURNING id`,[foreignHousehold,foreignSetup])).rows[0]!.id;
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic display discovery client',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;
});
after(async()=>{if(app)await app.close();await pool.end();});

test('display discovery requires consent, supports exact policy selection, and drops revoked or removed displays',async()=>{
  let token=await authorize(1);
  const grant=(await pool.query<{id:string;revision:number}>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;grantId=grant.id;
  const selected=await setDisplayPolicy(grant.revision,[grantedDisplayId]);assert.equal(selected.statusCode,200,selected.body);assert.deepEqual(selected.json().displayIds,[grantedDisplayId]);
  token=await authorize(2);

  const listed=await call(token,1);assert.equal(listed.statusCode,200,listed.body);
  const displays=rpc(listed).result.structuredContent.displays as Array<Record<string,unknown>>;
  assert.deepEqual(displays,[{id:grantedDisplayId,name:'Synthetic authorized display',locale:'en',theme:'light',privacyMode:true,setupName:'Synthetic MCP setup',createdAt:displays[0]?.createdAt}]);
  assert.doesNotMatch(listed.body,/Synthetic foreign private display|credential|pairing|background|asset|url|repeat|aaaaaaaa/i);
  assert.equal(displays.some(display=>display.id===foreignDisplayId),false);

  await pool.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE household_id=$1 AND id=$2',[householdId,grantedDisplayId]);
  const revoked=await call(token,2);assert.equal(revoked.statusCode,200,revoked.body);assert.deepEqual(rpc(revoked).result.structuredContent.displays,[]);

  const current=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grantId])).rows[0]!;
  const removed=await setDisplayPolicy(current.revision,[]);assert.equal(removed.statusCode,200,removed.body);assert.deepEqual(removed.json().displayIds,[]);
  const oldToken=await call(token,3);assert.equal(oldToken.statusCode,401,oldToken.body);assert.doesNotMatch(oldToken.body,/Synthetic authorized display/);
  const freshToken=await authorize(3);const fresh=await call(freshToken,4);assert.equal(fresh.statusCode,200,fresh.body);assert.deepEqual(rpc(fresh).result.structuredContent.displays,[]);

  const currentAgain=(await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grantId])).rows[0]!;
  const crossHousehold=await setDisplayPolicy(currentAgain.revision,[foreignDisplayId]);assert.equal(crossHousehold.statusCode,400,crossHousehold.body);assert.doesNotMatch(crossHousehold.body,/Synthetic foreign private display/);
});
