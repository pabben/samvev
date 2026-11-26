import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://home-mcp.test.invalid',callback='https://home-client.test.invalid/oauth/callback';
const scopes='mcp:home:read mcp:people:read';
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-home-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
let app:FastifyInstance,householdId='',ownerCookie='',ownerCsrf='',clientId='',personId='',grantId='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
async function authorize(serial:number){
  const verifier=`synthetic-home-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`home-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:scopes,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:ownerCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:ownerCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:ownerCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code');assert.ok(code);
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);
  return exchanged.json().access_token as string;
}
async function callHome(token:string,id:number){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'household.home.get'},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.home.get',arguments:{sections:['people']},_meta:meta}}});}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();
  const reset=await pool.connect();
  try { await reset.query('BEGIN');await reset.query("SET LOCAL statement_timeout='60s'");await reset.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');await reset.query('COMMIT'); }
  catch(error){await reset.query('ROLLBACK');throw error;}
  finally { reset.release(); }
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic home owner',email:'home-owner@test.invalid',password:'Synthetic-home-owner-pass-42'},household:{name:'Synthetic home household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;ownerCookie=cookies(claim);ownerCsrf=claim.json().csrfToken;
  personId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic selected person','child') RETURNING id`,[householdId])).rows[0]!.id;
  await pool.query(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic unselected person','adult')`,[householdId]);
  const client=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic home MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(client.statusCode,201,client.body);clientId=client.json().client_id;
});
after(async()=>{if(app)await app.close();await pool.end();});

test('home MCP follows OAuth and exact live grants and returns only requested bounded sections',async()=>{
  await authorize(1);
  const authorization=(await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations`,headers:{cookie:ownerCookie}})).json().authorizations[0];
  grantId=authorization.id;
  const selected=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:authorization.revision,scopes:authorization.scopes,personIds:[personId],displayIds:[],resources:[]}});
  assert.equal(selected.statusCode,200,selected.body);
  const token=await authorize(2);
  const response=await callHome(token,1);assert.equal(response.statusCode,200,response.body);
  const result=response.json().result;assert.notEqual(result.isError,true,response.body);
  const home=result.structuredContent as Record<string,any>;
  assert.equal(home.householdId,householdId);assert.equal(home.timezone,'Europe/Oslo');assert.equal(home.locale,'en');
  assert.deepEqual(home.people,[{id:personId,displayName:'Synthetic selected person',revision:1}]);
  assert.deepEqual(Object.keys(home).sort(),['householdId','locale','people','serverNow','timezone','today','tomorrow','truncated'].sort());
  assert.deepEqual(home.truncated,{people:false});
  assert.doesNotMatch(JSON.stringify(home),/unselected|birth|photo|avatar|school|evidence|sourceUrl|metadata|"displayId"/i);
  const audit=(await pool.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM audit_events WHERE household_id=$1 AND action='mcp.home_read' ORDER BY occurred_at DESC LIMIT 1`,[householdId])).rows[0]!;
  assert.deepEqual(audit.metadata,{sections:['people'],counts:{people:1},truncated:{people:false}});

  await pool.query(`UPDATE mcp_oauth_grants SET scopes=scopes-'mcp:people:read' WHERE id=$1`,[grantId]);
  const narrowed=await callHome(token,2);assert.equal(narrowed.statusCode,200,narrowed.body);assert.equal(narrowed.json().result.isError,true);
  assert.doesNotMatch(narrowed.body,/Synthetic selected person/);
});
