import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://display-discovery.test.invalid',callback='https://display-discovery-client.test.invalid/oauth/callback';
const scope='mcp:displays:read';
const setupScope='mcp:displays:setup:read';
const writeScope='mcp:displays:appearance:write';
const updateTool='household.displays.appearance.update';
let app:FastifyInstance,householdId='',installationId='',adminCookie='',adminCsrf='',clientId='',grantedDisplayId='',foreignDisplayId='',grantId='';
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-display-discovery-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
function mcpHeaders(name:string){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
function rpc(response:LightMyRequestResponse):any{return response.json();}

async function authorize(serial:number,scopes=[scope]){
  const verifier=`synthetic-display-discovery-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`display-discovery-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:scopes.join(' '),state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:adminCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:adminCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:adminCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}
async function call(token:string,id:number,name='household.displays.list',args:Record<string,unknown>={}){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...mcpHeaders(name)},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}}});}
async function setDisplayPolicy(expectedRevision:number,displayIds:string[],scopes=[scope]){return inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin,'content-type':'application/json'},payload:{expectedRevision,scopes,personIds:[],displayIds,resources:[]}});}
async function grantRevision(){return (await pool.query<{revision:number}>('SELECT revision FROM mcp_oauth_grants WHERE id=$1',[grantId])).rows[0]!.revision;}

function succeeded(response:LightMyRequestResponse){
  assert.equal(response.statusCode,200,response.body);
  const result=rpc(response).result;
  assert.ok(result?.structuredContent,response.body);
  return result.structuredContent;
}

function failed(response:LightMyRequestResponse,error:RegExp){
  assert.equal(response.statusCode,200,response.body);
  assert.equal(rpc(response).result?.isError,true,response.body);
  assert.match(response.body,error);
}

async function waitForBlockedQuery(fragment:string){
  const until=Date.now()+5_000;
  while(Date.now()<until){
    const blocked=await pool.query(`SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid()
      AND query LIKE $1 AND cardinality(pg_blocking_pids(pid))>0`,[`%${fragment}%`]);
    if(blocked.rowCount)return;
    await delay(15);
  }
  assert.fail(`Expected blocked query containing ${fragment}`);
}

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
  assert.deepEqual(displays,[{id:grantedDisplayId,name:'Synthetic authorized display',locale:'en',theme:'light',localeOverride:'en',themeOverride:'light',appearanceRevision:1,privacyMode:true,setupName:'Synthetic MCP setup',createdAt:displays[0]?.createdAt}]);
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

test('appearance update enforces consent, the exact display grant and CAS, preserving device access and policy',async()=>{
  const credential='synthetic-display-appearance-token';
  const credentialHash=createHash('sha256').update(credential).digest('hex');
  const setupId=(await pool.query<{setup_id:string}>('SELECT setup_id FROM displays WHERE id=$1',[grantedDisplayId])).rows[0]!.setup_id;
  const target=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,privacy_mode,setup_id,credential_hash,credential_expires_at,external_items_enabled)
    VALUES($1,'Synthetic appearance display',NULL,'light',true,$2,$3,clock_timestamp()+interval '1 day',true) RETURNING id`,[householdId,setupId,credentialHash])).rows[0]!.id;
  const ungranted=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,setup_id) VALUES($1,'Synthetic ungranted display',$2) RETURNING id`,[householdId,setupId])).rows[0]!.id;
  await pool.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed,birthday_allowed)
    SELECT $1,$2,person_id,true,true FROM memberships WHERE household_id=$1`,[householdId,target]);
  await pool.query('UPDATE display_action_policies SET grocery_write=true WHERE display_id=$1',[target]);
  await pool.query('UPDATE display_board_read_grants SET grocery_read=true WHERE display_id=$1',[target]);
  const snapshot=async()=>(await pool.query(`SELECT to_jsonb(display)-ARRAY['name','locale','theme','appearance_revision','last_seen_at'] AS display,
    to_jsonb(setup) AS setup,to_jsonb(actions) AS actions,to_jsonb(boards) AS boards,
    (SELECT jsonb_agg(to_jsonb(g) ORDER BY g.person_id) FROM display_person_grants g WHERE g.display_id=display.id) AS people
    FROM displays display JOIN display_setups setup ON setup.id=display.setup_id
    JOIN display_action_policies actions ON actions.display_id=display.id JOIN display_board_read_grants boards ON boards.display_id=display.id
    WHERE display.id=$1`,[target])).rows[0];
  const deviceProjection=()=>inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:`samvev_display=${credential}`}});
  const originalProjection=await deviceProjection();
  assert.equal(originalProjection.statusCode,200,originalProjection.body);
  const original=await snapshot();

  const input={displayId:target,expectedAppearanceRevision:1,name:'Synthetic new display name',localeOverride:'nb',themeOverride:null};
  const update=(token:string,id:number,change:Record<string,unknown>={})=>call(token,id,updateTool,{...input,...change});
  const widening=await setDisplayPolicy(await grantRevision(),[target],[scope,writeScope]);
  assert.equal(widening.statusCode,400,widening.body);
  assert.match(widening.body,/scope_broadening_requires_consent/);
  assert.equal((await setDisplayPolicy(await grantRevision(),[target])).statusCode,200);
  const readToken=await authorize(4);
  const noWrite=await update(readToken,5);
  assert.match(noWrite.body,/insufficient_scope/);

  const writeOnlyToken=await authorize(5,[writeScope]);
  assert.match((await update(writeOnlyToken,6)).body,/insufficient_scope/);
  const token=await authorize(6,[scope,writeScope]);
  assert.equal((await update(readToken,7)).statusCode,401);
  const before=succeeded(await call(token,8)).displays;
  assert.deepEqual(before.map(({id,locale,localeOverride,themeOverride,appearanceRevision}:Record<string,unknown>)=>({id,locale,localeOverride,themeOverride,appearanceRevision})),
    [{id:target,locale:'en',localeOverride:null,themeOverride:'light',appearanceRevision:1}]);

  for(const displayId of [ungranted,foreignDisplayId])failed(await update(token,9,{displayId}),/NOT_FOUND/);
  for(const extra of [{privacyMode:false},{credentialHash:'synthetic'},{setupId},{externalItemsEnabled:false},{personIdsOverride:[]}]){
    const invalid=await update(token,10,extra);
    assert.ok(rpc(invalid).error||rpc(invalid).result?.isError,invalid.body);
  }
  const updated=await update(token,11);
  assert.deepEqual(succeeded(updated),{display:{id:target,name:input.name,localeOverride:'nb',themeOverride:null,appearanceRevision:2}});
  assert.doesNotMatch(updated.body,/credential|pairing|privacyMode|people|policy|setup|url/i);
  assert.deepEqual(await snapshot(),original);
  const newProjection=await deviceProjection();
  assert.equal(newProjection.statusCode,200,newProjection.body);
  const oldView=originalProjection.json(),newView=newProjection.json();
  assert.equal(newView.display.name,input.name);
  assert.equal(newView.display.locale,'nb');
  assert.equal(newView.display.theme,'dark');
  for(const key of ['setup','displayGrants','householdBoards','actionAvailability'])assert.deepEqual(newView[key],oldView[key],key);
  assert.deepEqual(succeeded(await update(token,20,{expectedAppearanceRevision:2})),succeeded(updated));

  failed(await update(token,12,{name:'Synthetic stale display name'}),/REVISION_CONFLICT/);
  const patchFromBrowser=(payload:Record<string,unknown>)=>inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${target}`,
    headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin},payload});
  const browserPrivacy=await patchFromBrowser({privacyMode:false,theme:null});
  assert.equal(browserPrivacy.statusCode,200,browserPrivacy.body);
  assert.equal(succeeded(await call(token,21)).displays[0].appearanceRevision,2);
  const browserPatch=await patchFromBrowser({theme:'system'});
  assert.equal(browserPatch.statusCode,200,browserPatch.body);
  failed(await update(token,13,{expectedAppearanceRevision:2}),/REVISION_CONFLICT/);
  assert.equal(succeeded(await call(token,14)).displays[0].appearanceRevision,3);
  const membership=(await pool.query<{id:string;capabilities:string[]}>('SELECT id,capabilities FROM memberships WHERE household_id=$1',[householdId])).rows[0]!;
  await pool.query(`UPDATE memberships SET capabilities=capabilities-'display.manage' WHERE id=$1`,[membership.id]);
  failed(await update(token,15,{expectedAppearanceRevision:3}),/FORBIDDEN/);
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[membership.id,JSON.stringify(membership.capabilities)]);

  const blocker=await pool.connect();
  let revoke:Promise<LightMyRequestResponse>,waiting:Promise<LightMyRequestResponse>;
  try{
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM mcp_oauth_grants WHERE id=$1 FOR UPDATE',[grantId]);
    revoke=inject({method:'POST',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/revoke`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin}});
    await waitForBlockedQuery('SELECT id,client_id FROM mcp_oauth_grants');
    waiting=update(token,16,{expectedAppearanceRevision:3,name:'Synthetic raced display name'});
    await waitForBlockedQuery('FROM mcp_oauth_grants grant_row');
  }finally{
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  const revoked=await revoke!;
  assert.equal(revoked.statusCode,204,revoked.body);
  failed(await waiting!,/FORBIDDEN/);
  assert.equal((await update(token,17,{expectedAppearanceRevision:3})).statusCode,401);

  const fresh=await authorize(7,[scope,writeScope]);
  const deviceRevocation=await patchFromBrowser({revoked:true});
  assert.equal(deviceRevocation.statusCode,200,deviceRevocation.body);
  failed(await update(fresh,18,{expectedAppearanceRevision:3}),/NOT_FOUND/);
  assert.deepEqual(succeeded(await call(fresh,19)).displays,[]);
  const stored=(await pool.query('SELECT name,locale,theme,appearance_revision FROM displays WHERE id=$1',[target])).rows[0];
  assert.deepEqual(stored,{name:input.name,locale:'nb',theme:'system',appearance_revision:3});
  const audits=await pool.query(`SELECT actor_type,metadata->>'revision' AS revision FROM audit_events
    WHERE household_id=$1 AND subject_id=$2 AND action='mcp.display_appearance_updated'`,[householdId,target]);
  assert.deepEqual(audits.rows,[{actor_type:'mcp',revision:'2'}]);
});

test('setup read requires fresh setup consent and returns only configuration for the exact active display grant',async()=>{
  const setupId=(await pool.query<{setup_id:string}>('SELECT setup_id FROM displays WHERE id=$1',[grantedDisplayId])).rows[0]!.setup_id;
  await pool.query(`UPDATE display_setups SET name='Synthetic minimal setup',revision=revision+1,
    cards='["family_layout","today"]'::jsonb,card_order='["today","family_layout"]'::jsonb,
    family_layout_enabled=false,locale='nb',theme='dark',all_sources=true,all_sensors=true,
    album_ids='["11111111-1111-4111-8111-111111111111"]'::jsonb,
    background_id='22222222-2222-4222-8222-222222222222'
    WHERE id=$1`,[setupId]);
  const target=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,setup_id)
    VALUES($1,'Synthetic setup target',$2) RETURNING id`,[householdId,setupId])).rows[0]!.id;
  const ungranted=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,setup_id)
    VALUES($1,'Synthetic sharing but ungranted display',$2) RETURNING id`,[householdId,setupId])).rows[0]!.id;

  let token=await authorize(20,[scope,setupScope]);
  let grant=(await pool.query<{id:string;revision:number}>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  grantId=grant.id;
  const selection=await setDisplayPolicy(grant.revision,[target],[scope,setupScope]);
  assert.equal(selection.statusCode,200,selection.body);
  token=await authorize(21,[scope,setupScope]);

  const setupRead=await call(token,30,'household.displays.setup.get',{displayId:target});
  assert.deepEqual(succeeded(setupRead),{setup:{name:'Synthetic minimal setup',revision:2,cards:['family_layout','today'],cardOrder:['today','family_layout'],familyLayoutEnabled:false,locale:'nb',theme:'dark'}});
  assert.doesNotMatch(setupRead.body,/Synthetic sharing|Synthetic authorized|all_sources|all_sensors|album_ids|background_id|person|source|sensor|photo|credential|permission/i);
  failed(await call(token,31,'household.displays.setup.get',{displayId:ungranted}),/NOT_FOUND/);
  failed(await call(token,32,'household.displays.setup.get',{displayId:foreignDisplayId}),/NOT_FOUND/);
  const audit=await pool.query(`SELECT actor_type,subject_type,subject_id,metadata FROM audit_events
    WHERE household_id=$1 AND action='mcp.display_setup_read' AND subject_id=$2`,[householdId,target]);
  assert.equal(audit.rows.length,1);
  assert.equal(audit.rows[0]!.actor_type,'mcp');assert.equal(audit.rows[0]!.subject_type,'display');assert.equal(audit.rows[0]!.subject_id,target);
  assert.deepEqual(Object.keys(audit.rows[0]!.metadata).sort(),['clientId','revision']);
  assert.equal(audit.rows[0]!.metadata.revision,2);assert.match(audit.rows[0]!.metadata.clientId,/^[0-9a-f-]{36}$/i);

  const readOnlyToken=await authorize(22,[scope]);
  const missingSetupConsent=await call(readOnlyToken,33,'household.displays.setup.get',{displayId:target});
  assert.equal(missingSetupConsent.statusCode,403,missingSetupConsent.body);
  assert.match(missingSetupConsent.body,/insufficient_scope/);

  token=await authorize(23,[scope,setupScope]);
  await pool.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE household_id=$1 AND id=$2',[householdId,target]);
  failed(await call(token,34,'household.displays.setup.get',{displayId:target}),/NOT_FOUND/);
  await pool.query('UPDATE displays SET revoked_at=NULL WHERE household_id=$1 AND id=$2',[householdId,target]);
  const member=(await pool.query<{id:string;capabilities:string[]}>('SELECT membership.id,membership.capabilities FROM memberships membership WHERE membership.household_id=$1',[householdId])).rows[0]!;
  await pool.query(`UPDATE memberships SET capabilities=capabilities-'display.manage' WHERE id=$1`,[member.id]);
  failed(await call(token,35,'household.displays.setup.get',{displayId:target}),/FORBIDDEN/);
  await pool.query('UPDATE memberships SET capabilities=$2 WHERE id=$1',[member.id,JSON.stringify(member.capabilities)]);

  const tokenHash=createHash('sha256').update(token).digest('hex');
  await pool.query('UPDATE mcp_oauth_token_sets SET revoked_at=clock_timestamp() WHERE access_token_hash=$1',[tokenHash]);
  assert.equal((await call(token,36,'household.displays.setup.get',{displayId:target})).statusCode,401);

  token=await authorize(24,[scope,setupScope]);
  const revokedGrant=await inject({method:'POST',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/revoke`,headers:{cookie:adminCookie,'x-csrf-token':adminCsrf,origin}});
  assert.equal(revokedGrant.statusCode,204,revokedGrant.body);
  assert.equal((await call(token,37,'household.displays.setup.get',{displayId:target})).statusCode,401);
});
