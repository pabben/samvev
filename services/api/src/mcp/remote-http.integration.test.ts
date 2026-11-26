import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://samvev.test.invalid',callback='https://remote-mcp-client.test.invalid/oauth/callback';
let app:FastifyInstance,householdId='',adminCookie='',adminCsrf='',clientId='',accessToken='',baseUrl='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const modernMeta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-remote-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(method:string,name?:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':method,...(name?{'mcp-name':name}:{})};}
async function remoteMcp(token:string,body:Record<string,unknown>,headers:Record<string,string>={}){
  return fetch(`${baseUrl}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify(body)});
}

before(async()=>{
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic remote MCP owner',email:'remote-mcp-owner@test.invalid',password:'Synthetic-remote-mcp-owner-pass-42'},household:{name:'Synthetic remote MCP household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});
  assert.equal(claim.statusCode,200,claim.body);householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic remote MCP client',redirect_uris:[callback],token_endpoint_auth_method:'none'}});
  assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;

  const verifier='synthetic-remote-mcp-verifier-abcdefghijklmnopqrstuvwxyz-0123456789',state='remote-mcp-state-0123456789';
  const authorize=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:'mcp:groceries:read',state});
  const consentPage=await inject({method:'GET',url:`/oauth/authorize?${authorize}`,headers:{cookie:adminCookie}});assert.equal(consentPage.statusCode,200,consentPage.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(authorize),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});
  assert.equal(approved.statusCode,303,approved.body);const code=new URL(String(approved.headers.location)).searchParams.get('code');assert.ok(code);
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code:code!,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});
  assert.equal(exchanged.statusCode,200,exchanged.body);accessToken=exchanged.json().access_token;
  baseUrl=await app.listen({host:'127.0.0.1',port:0});
});

after(async()=>{if(app)await app.close();await pool.end();});

test('remote Streamable HTTP MCP supports initialize, tool discovery, read, and rejects invalid or revoked tokens',async()=>{
  const initialized=await remoteMcp(accessToken,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'synthetic-remote-client',version:'1.0.0'}}});
  assert.equal(initialized.status,200,await initialized.clone().text());assert.match(initialized.headers.get('content-type')??'',/application\/json/);
  const initialization=await initialized.json() as {result:{protocolVersion:string;serverInfo:{name:string}}};
  assert.equal(initialization.result.protocolVersion,'2025-11-25');assert.equal(initialization.result.serverInfo.name,'samvev');

  const listed=await remoteMcp(accessToken,{jsonrpc:'2.0',id:2,method:'tools/list',params:{_meta:modernMeta}},modernHeaders('tools/list'));
  assert.equal(listed.status,200,await listed.clone().text());
  const tools=(await listed.json() as {result:{tools:Array<{name:string}>}}).result.tools;
  assert.ok(tools.some(tool=>tool.name==='household.groceries.list'));

  const read=await remoteMcp(accessToken,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'household.groceries.list',arguments:{},_meta:modernMeta}},modernHeaders('tools/call','household.groceries.list'));
  assert.equal(read.status,200,await read.clone().text());
  const readResult=(await read.json() as {result:{structuredContent:{items:Array<unknown>};isError?:boolean}}).result;
  assert.notEqual(readResult.isError,true);assert.deepEqual(readResult.structuredContent.items,[]);

  const invalid=await remoteMcp('invalid-synthetic-bearer-token',{jsonrpc:'2.0',id:4,method:'ping'});
  assert.equal(invalid.status,401);assert.match(invalid.headers.get('www-authenticate')??'',/invalid_token/);

  const grant=(await pool.query<{id:string}>('SELECT id FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  const revoked=await inject({method:'POST',url:`/api/v1/households/${householdId}/mcp/authorizations/${grant.id}/revoke`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin}});
  assert.equal(revoked.statusCode,204,revoked.body);
  const afterRevocation=await remoteMcp(accessToken,{jsonrpc:'2.0',id:5,method:'ping'});
  assert.equal(afterRevocation.status,401);assert.match(afterRevocation.headers.get('www-authenticate')??'',/invalid_token/);
});
