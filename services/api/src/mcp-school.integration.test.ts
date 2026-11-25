import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { opaqueToken, tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';
import { assertMcpSchoolAuthority } from './mcp/service.ts';

const origin='https://samvev.test.invalid',callback='https://school-client.test.invalid/oauth/callback';
const page1='https://school.example.invalid/classes/synthetic-1a/',pdf1='https://school.example.invalid/files/week-53.pdf';
const page2='https://second-school.example.invalid/classes/synthetic-2b/',pdf2='https://second-school.example.invalid/files/week-01.pdf';
const pdfBytes=Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
let app:FastifyInstance,householdId='',foreignHouseholdId='',personId='',displayId='',displayToken='',adminCookie='',adminCsrf='',clientId='';
let connection1='',connection2='',source1='',source2='',plan1='';
let pdfFetches=0;

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-school-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
function modernHeaders(method:string,name?:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':method,...(name?{'mcp-name':name}:{})};}
function rpc(response:LightMyRequestResponse):any{return response.json();}
async function mcp(token:string,payload:unknown,headers:Record<string,string>={}){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...headers},payload});}
async function call(token:string,name:string,args:Record<string,unknown>,id:number){return mcp(token,{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}},modernHeaders('tools/call',name));}
async function authorize(scopes:string,serial:number){const verifier=`synthetic-school-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`school-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:scopes,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;}
const adminHeaders=()=>({cookie:adminCookie,'x-csrf-token':adminCsrf,origin});
async function approveSource(connectionId:string,classKey:string,sourcePageUrl:string){const response=await inject({method:'POST',url:`/api/v1/households/${householdId}/school-plan-sources`,headers:adminHeaders(),payload:{connectionId,personId,classKey,sourcePageUrl,displayPdfLinksAllowed:true}});assert.equal(response.statusCode,201,response.body);return response.json().source;}
async function grantPolicy(personIds:string[],displayIds:string[],sourceIds:string[]){const list=await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations`,headers:{cookie:adminCookie}});const authorization=list.json().authorizations[0];const response=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${authorization.id}/policy`,headers:adminHeaders(),payload:{expectedRevision:authorization.revision,personIds,displayIds,resources:sourceIds.map(id=>({kind:'school_source',id}))}});assert.equal(response.statusCode,200,response.body);return authorization.id as string;}
function planInput(sourceId:string,sourcePageUrl:string,pdfUrl:string,person:string,display:string,second=false){return{sourceId,personId:person,classKey:second?'synthetic-2b':'synthetic-1a',sourcePageUrl,isoYear:second?2021:2020,isoWeek:second?1:53,expectedRevision:0,contentLocale:'en',startsOn:second?'2021-01-04':'2020-12-28',endsOn:second?'2021-01-10':'2021-01-03',days:[{date:second?'2021-01-04':'2020-12-28',kind:'school',activities:[{title:second?'Synthetic second lesson':'Synthetic first lesson'}]}],pdfUrl,sourceRevision:second?'synthetic-v2':'synthetic-v1',observedAt:'2026-11-20T10:00:00.000Z',interpretedAt:'2026-11-20T10:01:00.000Z',uncertainty:'low',displayIds:[display]};}

before(async()=>{await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false},schoolPdfFetcher:{fetch:async()=>{pdfFetches+=1;return pdfBytes;}}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic school owner',email:'school-owner@test.invalid',password:'Synthetic-school-owner-pass-42'},household:{name:'Synthetic school household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);householdId=claim.json().householdId;adminCookie=cookies(claim);adminCsrf=claim.json().csrfToken;
  foreignHouseholdId=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind) SELECT id,'Foreign synthetic school household','UTC','en','synthetic' FROM installations WHERE singleton RETURNING id`)).rows[0]!.id;
  personId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,avatar_key,age_group) VALUES($1,'Synthetic learner','avatar-01','child') RETURNING id`,[householdId])).rows[0]!.id;
  connection1=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic school connection one') RETURNING id`,[householdId])).rows[0]!.id;connection2=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic school connection two') RETURNING id`,[householdId])).rows[0]!.id;
  displayToken=opaqueToken();const display=(await pool.query<{id:string;setup_id:string}>(`INSERT INTO displays(household_id,name,locale,theme,credential_hash,credential_expires_at,external_items_enabled) VALUES($1,'Synthetic school display','en','light',$2,clock_timestamp()+interval '1 hour',true) RETURNING id,setup_id`,[householdId,tokenHash(displayToken)])).rows[0]!;displayId=display.id;
  await pool.query(`UPDATE display_setups SET all_sources=true,cards=cards||'["external_items"]'::jsonb WHERE id=$1`,[display.setup_id]);await pool.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed) VALUES($1,$2,$3,true)`,[householdId,displayId,personId]);for(const connection of [connection1,connection2])await pool.query(`INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)`,[householdId,connection,displayId]);
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic school MCP',redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']}});assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;});
after(async()=>{await app.close();await pool.end();});

test('school MCP, browser member and display routes enforce live multi-connection resource policy',async()=>{
  source1=(await approveSource(connection1,'synthetic-1a',page1)).id;const sourceList=await inject({method:'GET',url:`/api/v1/households/${householdId}/school-plan-sources`,headers:{cookie:adminCookie}});assert.equal(sourceList.statusCode,200,sourceList.body);assert.equal(sourceList.json().sources[0].connectionId,connection1);assert.equal(sourceList.json().sources[0].connectionName,'Synthetic school connection one');
  let token=await authorize('mcp:people:read mcp:school-plans:read mcp:school-plans:write',1);const denied=await call(token,'school.sources.list',{},1);assert.equal(denied.statusCode,200,denied.body);assert.equal(rpc(denied).result.isError,true,denied.body);assert.match(rpc(denied).result.content[0].text,/FORBIDDEN/);assert.doesNotMatch(denied.body,/Synthetic learner|school\.example/);
  const grantId=await grantPolicy([personId],[displayId],[source1]);token=await authorize('mcp:people:read mcp:school-plans:read mcp:school-plans:write',2);
  const scoped=(await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations`,headers:{cookie:adminCookie}})).json().authorizations[0];const inconsistent=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:adminHeaders(),payload:{expectedRevision:scoped.revision,scopes:['mcp:people:read'],personIds:[personId],displayIds:[displayId],resources:[{kind:'school_source',id:source1}]}});assert.equal(inconsistent.statusCode,400,inconsistent.body);assert.equal(inconsistent.json().error.details.reason,'resource_scope_required','school grants cannot survive removal of every school scope');
  const sources=await call(token,'school.sources.list',{},2);assert.equal(sources.statusCode,200,sources.body);assert.deepEqual(rpc(sources).result.structuredContent.sources.map((source:{id:string})=>source.id),[source1]);
  const people=await call(token,'household.people.list',{},21);assert.equal(people.statusCode,200,people.body);assert.deepEqual(rpc(people).result.structuredContent.people.map((person:{id:string})=>person.id),[personId]);
  const created=await call(token,'school.plans.upsert',planInput(source1,page1,pdf1,personId,displayId),3);assert.equal(created.statusCode,200,created.body);plan1=rpc(created).result.structuredContent.result.id;
  const verified=await call(token,'school.plans.verify_pdf',{sourceId:source1,isoYear:2020,isoWeek:53,expectedRevision:1},4);assert.equal(verified.statusCode,200,verified.body);assert.equal(rpc(verified).result.structuredContent.result.result,'verified');
  assert.equal(pdfFetches,1);await pool.query(`UPDATE rate_limits SET attempts=6 WHERE bucket='mcp_school_pdf_verify' AND key_hash=$1`,[tokenHash(`${grantId}:${source1}`)]);
  const throttled=await call(token,'school.plans.verify_pdf',{sourceId:source1,isoYear:2020,isoWeek:53,expectedRevision:2},22);assert.equal(throttled.statusCode,200,throttled.body);assert.equal(rpc(throttled).result.isError,true,throttled.body);assert.match(rpc(throttled).result.content[0].text,/RATE_LIMITED/);assert.equal(pdfFetches,1,'the per-grant/source limiter rejects before another external fetch');
  source2=(await approveSource(connection2,'synthetic-2b',page2)).id;await grantPolicy([personId],[displayId],[source1,source2]);token=await authorize('mcp:school-plans:read mcp:school-plans:write',3);
  const second=await call(token,'school.plans.upsert',planInput(source2,page2,pdf2,personId,displayId,true),5);assert.equal(second.statusCode,200,second.body);
  const listed=await call(token,'school.plans.list',{limit:10},6);assert.equal(listed.statusCode,200,listed.body);assert.equal(rpc(listed).result.structuredContent.plans.length,2,'one grant can safely aggregate two source connections');
  const member=await inject({method:'GET',url:`/api/v1/households/${householdId}/school-plans`,headers:{cookie:adminCookie}});assert.equal(member.statusCode,200,member.body);assert.equal(member.json().plans.length,2);assert.doesNotMatch(member.body,/sourcePageUrl|pdfUrl|school\.example/);assert.deepEqual(new Set(member.json().plans.map((plan:any)=>plan.pdfStatus)),new Set(['server_verified','unverified_link']));assert.ok(member.json().plans.every((plan:any)=>plan.pdfLinkAvailable=== (plan.pdfStatus==='server_verified')));
  const one=await inject({method:'GET',url:`/api/v1/households/${householdId}/school-plans/${plan1}`,headers:{cookie:adminCookie}});assert.equal(one.statusCode,200,one.body);assert.equal(one.json().plan.id,plan1);assert.doesNotMatch(one.body,/sourcePageUrl|pdfUrl/);
  const memberPdf=await inject({method:'GET',url:`/api/v1/households/${householdId}/school-plans/${plan1}/pdf`,headers:{cookie:adminCookie}});assert.equal(memberPdf.statusCode,200,memberPdf.body);assert.equal(memberPdf.headers['content-type'],'application/pdf');assert.deepEqual(memberPdf.rawPayload,pdfBytes);
  const display=await inject({method:'GET',url:'/api/v1/display/school-plans',headers:{cookie:`samvev_display=${displayToken}`}});assert.equal(display.statusCode,200,display.body);assert.equal(display.json().plans.length,2);assert.doesNotMatch(display.body,/sourcePageUrl|pdfUrl|school\.example/);
  const displayPdf=await inject({method:'GET',url:`/api/v1/display/school-plans/${plan1}/pdf`,headers:{cookie:`samvev_display=${displayToken}`}});assert.equal(displayPdf.statusCode,200,displayPdf.body);assert.deepEqual(displayPdf.rawPayload,pdfBytes);
  const activity=await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/activity`,headers:{cookie:adminCookie}});assert.equal(activity.statusCode,200,activity.body);assert.ok(activity.json().activity.some((entry:any)=>entry.action==='mcp.school_plan_upserted'));assert.ok(activity.json().activity.some((entry:any)=>entry.action==='mcp.people_listed'));assert.doesNotMatch(activity.body,/sourcePageUrl|pdfUrl|metadata|school\.example/);
  assert.equal((await inject({method:'GET',url:`/api/v1/households/${foreignHouseholdId}/mcp/authorizations/${grantId}/activity`,headers:{cookie:adminCookie}})).statusCode,404);
  let release!:()=>void,entered!:()=>void;
  const hold=new Promise<void>((resolve)=>{release=resolve;}),selected=new Promise<void>((resolve)=>{entered=resolve;});
  const query=pool.query;
  (pool as any).query=async(...args:any[])=>{
    const result=await (query as any).apply(pool,args);
    if(typeof args[0]==='string'&&args[0].includes('SELECT snapshot.bytes')){entered();await hold;}
    return result;
  };
  let revoked;
  try{
    const inFlight=inject({method:'GET',url:`/api/v1/display/school-plans/${plan1}/pdf`,headers:{cookie:`samvev_display=${displayToken}`}});
    await Promise.race([selected,new Promise((_,reject)=>setTimeout(()=>reject(new Error('PDF SELECT barrier not reached')),4_000))]);
    revoked=await inject({method:'DELETE',url:`/api/v1/households/${householdId}/school-plan-sources/${source1}`,headers:adminHeaders()});
    release();
    const fenced=await inFlight;assert.equal(fenced.statusCode,409,'a source revoked after SELECT must not send child PDF bytes');assert.doesNotMatch(fenced.body,/^%PDF/);
  }finally{release();(pool as any).query=query;}
  assert.equal(revoked?.statusCode,204,revoked?.body);
  assert.equal((await pool.query(`SELECT 1 FROM school_plan_pdf_snapshots WHERE plan_id=$1`,[plan1])).rowCount,0,'revocation purges the retained child PDF bytes');
  const staleGrant=(await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations`,headers:{cookie:adminCookie}})).json().authorizations[0];const preserveRevoked=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:adminHeaders(),payload:{expectedRevision:staleGrant.revision,scopes:staleGrant.scopes,personIds:[personId],displayIds:[displayId],resources:[{kind:'school_source',id:source1},{kind:'school_source',id:source2}]}});assert.equal(preserveRevoked.statusCode,400,preserveRevoked.body);assert.equal(preserveRevoked.json().error.details.reason,'revoked_source_remove_first');
  assert.equal((await inject({method:'GET',url:`/api/v1/display/school-plans/${plan1}/pdf`,headers:{cookie:`samvev_display=${displayToken}`}})).statusCode,404);const after=await inject({method:'GET',url:'/api/v1/display/school-plans',headers:{cookie:`samvev_display=${displayToken}`}});assert.equal(after.statusCode,200,after.body);assert.equal(after.json().plans.length,1);
  const active=(await pool.query<{id:string;account_id:string;membership_id:string;installation_id:string;client_id:string;token_set_id:string}>(`
    SELECT grant_row.id,grant_row.account_id,grant_row.membership_id,grant_row.installation_id,grant_row.client_id,token_set.id token_set_id
    FROM mcp_oauth_token_sets token_set JOIN mcp_oauth_grants grant_row ON grant_row.id=token_set.grant_id
    WHERE token_set.access_token_hash=$1`,[tokenHash(token)])).rows[0]!;
  const current=(await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations`,headers:{cookie:adminCookie}})).json().authorizations[0];
  const narrowed=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:adminHeaders(),payload:{expectedRevision:current.revision,scopes:['mcp:school-plans:read'],personIds:[personId],displayIds:[displayId],resources:[{kind:'school_source',id:source2}]}});assert.equal(narrowed.statusCode,200,narrowed.body);
  const stalePrincipal={token,tokenSetId:active.token_set_id,grantId,clientDatabaseId:active.client_id,clientId,accountId:active.account_id,membershipId:active.membership_id,householdId,installationId:active.installation_id,scopes:['mcp:school-plans:read','mcp:school-plans:write'] as any,expiresAt:new Date(Date.now()+60_000)};
  const client=await pool.connect();try{
    await assert.rejects(assertMcpSchoolAuthority(client,stalePrincipal,{write:true,personIds:[personId],sourceIds:[source2],displayIds:[displayId]}),{code:'FORBIDDEN'});
  }finally{client.release();}
});
