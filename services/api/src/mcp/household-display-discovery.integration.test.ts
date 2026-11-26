import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { MediaService } from '../media/service.ts';

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
  const {setupVersion}=succeeded(setupRead).setup;
  assert.match(setupVersion,/^[a-f0-9]{64}$/);
  assert.deepEqual(succeeded(setupRead),{setup:{setupVersion,name:'Synthetic minimal setup',revision:2,cards:['family_layout','today'],cardOrder:['today','family_layout'],familyLayoutEnabled:false,locale:'nb',theme:'dark'}});
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

const layoutScope = 'mcp:displays:layout:write';
const layoutScopes = [scope, setupScope, layoutScope];
const layoutTool = 'household.displays.layout.update';

async function oneId(sql: string, values: unknown[]) {
  return (await pool.query<{ id: string }>(sql, values)).rows[0]!.id;
}

async function makeLayoutTarget(setupId: string, name: string, credential: string | null = null) {
  return oneId(`INSERT INTO displays(household_id,setup_id,name,locale,theme,external_items_enabled,credential_hash,credential_expires_at)
    VALUES($1,$2,$3,'en','light',true,$4,clock_timestamp()+interval '1 day') RETURNING id`,
  [householdId, setupId, name, credential ? createHash('sha256').update(credential).digest('hex') : null]);
}

async function makeLayoutSetup() {
  return oneId(`INSERT INTO display_setups(household_id,name,locale,theme)
    VALUES($1,'Synthetic layout source','nb','dark') RETURNING id`, [householdId]);
}

async function authorizeLayout(serial: number, displayId: string) {
  await authorize(serial, layoutScopes);
  grantId = (await pool.query<{ id: string }>(`SELECT id FROM mcp_oauth_grants WHERE household_id=$1 AND revoked_at IS NULL`, [householdId])).rows[0]!.id;
  const policy = await setDisplayPolicy(await grantRevision(), [displayId], layoutScopes);
  assert.equal(policy.statusCode, 200, policy.body);
  return authorize(serial + 1, layoutScopes);
}

async function readSetup(token: string, displayId: string) {
  return succeeded(await call(token, 100, 'household.displays.setup.get', { displayId })).setup;
}

function changeLayout(displayId: string, expectedSetupVersion: string) {
  return { displayId, expectedSetupVersion, cards: ['photos', 'people'], cardOrder: ['people', 'photos'], familyLayoutEnabled: false };
}

async function setupCount() {
  return (await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM display_setups WHERE household_id=$1', [householdId])).rows[0]!.total;
}

async function layoutAudit(displayId: string) {
  return (await pool.query(`SELECT actor_type,subject_type,subject_id,metadata
    FROM audit_events WHERE household_id=$1 AND subject_id=$2 AND action='mcp.display_layout_updated' ORDER BY occurred_at,id`, [householdId, displayId])).rows;
}

test('layout write clones private setup selections, preserves device permissions, and isolates a shared default', async () => {
  const sourceId = await makeLayoutSetup();
  const credential = 'synthetic-display-layout-projection';
  const target = await makeLayoutTarget(sourceId, 'Synthetic layout target', credential);
  const sibling = await makeLayoutTarget(sourceId, 'Synthetic layout sibling');
  const actor = (await pool.query<{ id: string; account_id: string; person_id: string }>(
    'SELECT id,account_id,person_id FROM memberships WHERE household_id=$1', [householdId])).rows[0]!;
  const integration = await oneId(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic layout integration') RETURNING id`, [householdId]);
  const connection = await oneId(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name)
    VALUES($1,$2,$3,'ics','Synthetic layout calendar') RETURNING id`, [householdId, integration, actor.account_id]);
  const source = await oneId(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name)
    VALUES($1,$2,'synthetic-layout-schedule','Synthetic layout schedule') RETURNING id`, [householdId, connection]);
  const sensor = await oneId(`INSERT INTO home_assistant_temperature_sensors(household_id,connection_id,external_id,entity_id,identity_kind,name)
    VALUES($1,$2,'synthetic-layout-sensor','sensor.synthetic_layout','entity','Synthetic layout sensor') RETURNING id`, [householdId, connection]);
  const album = await oneId(`INSERT INTO media_albums(household_id,owner_membership_id,name)
    VALUES($1,$2,'Synthetic layout album') RETURNING id`, [householdId, actor.id]);
  const backgroundAlbum = await oneId(`INSERT INTO media_albums(household_id,owner_membership_id,name,album_kind)
    VALUES($1,$2,'Synthetic layout backgrounds','backgrounds') RETURNING id`, [householdId, actor.id]);
  await pool.query('INSERT INTO media_household_usage(household_id) VALUES($1) ON CONFLICT DO NOTHING', [householdId]);
  const background = await oneId(`INSERT INTO media_assets(household_id,album_id,title,original_mime,width,height,content_sha256,master_webp,preview_webp,created_by_membership_id)
    VALUES($1,$2,'Synthetic layout background','image/webp',1,1,repeat('0',64),'abc','abc',$3) RETURNING id`, [householdId, backgroundAlbum, actor.id]);
  await pool.query(`UPDATE display_setups SET is_default=true,all_sources=true,all_sensors=true,album_ids=$2::jsonb,background_id=$3 WHERE id=$1`,
    [sourceId, JSON.stringify([album]), background]);
  const selections = [
    ['display_setup_people', 'person_id', actor.person_id],
    ['display_setup_sources', 'connection_id', integration],
    ['display_setup_calendar_sources', 'source_id', source],
    ['display_setup_sensors', 'sensor_id', sensor]
  ] as const;
  for (const [table, column, value] of selections) {
    await pool.query(`INSERT INTO ${table}(household_id,setup_id,${column}) VALUES($1,$2,$3)`, [householdId, sourceId, value]);
  }
  await pool.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed)
    VALUES($1,$2,$3,true)`, [householdId, target, actor.person_id]);
  await pool.query('UPDATE display_action_policies SET grocery_write=true WHERE display_id=$1', [target]);
  await pool.query('UPDATE display_board_read_grants SET grocery_read=true WHERE display_id=$1', [target]);
  await pool.query('INSERT INTO media_album_display_grants(household_id,album_id,display_id,can_read) VALUES($1,$2,$3,true)', [householdId, album, sibling]);

  const snapshotDevice = async () => (await pool.query(`SELECT to_jsonb(device)-ARRAY['setup_id','setup_assignment_revision','last_seen_at'] AS device,
    to_jsonb(actions) AS actions,to_jsonb(boards) AS boards,
    (SELECT jsonb_agg(to_jsonb(g)) FROM display_person_grants g WHERE g.display_id=device.id) AS people,
    (SELECT jsonb_agg(to_jsonb(g)) FROM media_album_display_grants g WHERE g.display_id=device.id) AS media
    FROM displays device JOIN display_action_policies actions ON actions.display_id=device.id
      JOIN display_board_read_grants boards ON boards.display_id=device.id WHERE device.id=$1`, [target])).rows[0];
  const snapshotSetup = async (setupId: string) => (await pool.query('SELECT * FROM display_setups WHERE id=$1', [setupId])).rows[0];
  const beforeDevice = await snapshotDevice(), beforeSetup = await snapshotSetup(sourceId), beforeCount = await setupCount();

  const readToken = await authorize(30, [scope, setupScope]);
  grantId = (await pool.query<{ id: string }>('SELECT id FROM mcp_oauth_grants WHERE household_id=$1 AND revoked_at IS NULL', [householdId])).rows[0]!.id;
  const broadening = await setDisplayPolicy(await grantRevision(), [target], layoutScopes);
  assert.equal(broadening.statusCode, 400, broadening.body);
  assert.match(broadening.body, /scope_broadening_requires_consent/);
  const noWrite = await call(readToken, 101, layoutTool, changeLayout(target, 'a'.repeat(64)));
  assert.equal(noWrite.statusCode, 403, noWrite.body);
  assert.match(noWrite.body, /insufficient_scope/);

  const noSetupToken = await authorize(31, [scope, layoutScope]);
  const noSetup = await call(noSetupToken, 102, layoutTool, changeLayout(target, 'a'.repeat(64)));
  assert.equal(noSetup.statusCode, 403, noSetup.body);
  assert.match(noSetup.body, /insufficient_scope/);
  const token = await authorizeLayout(32, target);
  const { setupVersion } = await readSetup(token, target);
  const request = changeLayout(target, setupVersion);

  for (const displayId of [sibling, foreignDisplayId]) {
    failed(await call(token, 103, layoutTool, { ...request, displayId }), /NOT_FOUND/);
  }
  for (const overrides of [
    { albumIds: [album] }, { personIds: [actor.person_id] }, { setupId: sourceId }, { privacyMode: false },
    { cards: ['photos', 'photos'] }, { cards: ['synthetic-unknown-card'] }, { cardOrder: ['photos'] }
  ]) {
    const invalid = await call(token, 104, layoutTool, { ...request, ...overrides });
    assert.ok(rpc(invalid).error || rpc(invalid).result?.isError, invalid.body);
  }
  assert.equal(await setupCount(), beforeCount);
  assert.deepEqual(await layoutAudit(target), []);

  const updated = succeeded(await call(token, 105, layoutTool, request)).layout;
  assert.match(updated.setupVersion, /^[a-f0-9]{64}$/);
  assert.notEqual(updated.setupVersion, setupVersion);
  assert.deepEqual(updated, { displayId: target, setupVersion: updated.setupVersion, cards: ['photos', 'people'], cardOrder: ['people', 'photos'], familyLayoutEnabled: false });
  assert.equal((await readSetup(token, target)).setupVersion, updated.setupVersion);
  assert.deepEqual(await snapshotDevice(), beforeDevice);
  assert.deepEqual(await snapshotSetup(sourceId), beforeSetup);
  assert.equal(await setupCount(), beforeCount + 1);
  const devices = (await pool.query<{ id: string; setup_id: string; setup_assignment_revision: string }>(
    'SELECT id,setup_id,setup_assignment_revision FROM displays WHERE id=ANY($1::uuid[])', [[target, sibling]])).rows;
  assert.deepEqual(devices.find(row => row.id === sibling), { id: sibling, setup_id: sourceId, setup_assignment_revision: '1' });
  const cloneId = devices.find(row => row.id === target)!.setup_id;
  assert.notEqual(cloneId, sourceId);
  const clone = await snapshotSetup(cloneId);
  assert.equal(clone.is_default, false);
  for (const field of ['name', 'locale', 'theme', 'all_sources', 'all_sensors', 'album_ids', 'background_id']) {
    assert.deepEqual(clone[field], beforeSetup[field], field);
  }
  for (const [table, column, value] of selections) {
    const copied = await pool.query(`SELECT ${column} FROM ${table} WHERE setup_id=$1`, [cloneId]);
    assert.deepEqual(copied.rows, [{ [column]: value }]);
  }
  const projection = await inject({ method: 'GET', url: '/api/v1/display/projection', headers: { cookie: `samvev_display=${credential}` } });
  assert.equal(projection.statusCode, 200, projection.body);
  assert.deepEqual(projection.json().setup.cardOrder, updated.cardOrder);
  const mediaProjection = await new MediaService().displayProjection({ id: target, householdId, setupId: cloneId, privacyMode: false, credentialHash: createHash('sha256').update(credential).digest('hex') });
  assert.deepEqual(mediaProjection, { albums: [], assets: [], background: null, householdBackground: null });

  const audit = await layoutAudit(target);
  assert.deepEqual(audit, [{ actor_type: 'mcp', subject_type: 'display', subject_id: target, metadata: { revision: clone.revision, setupVersion: updated.setupVersion, clientId: audit[0]?.metadata.clientId } }]);
  assert.match(audit[0]!.metadata.clientId, /^[0-9a-f-]{36}$/);
  failed(await call(token, 106, layoutTool, request), /REVISION_CONFLICT/);
  assert.deepEqual(succeeded(await call(token, 107, layoutTool, {
    ...request, cards: [...request.cards].reverse(), expectedSetupVersion: updated.setupVersion
  })), { layout: updated });
  assert.equal(await setupCount(), beforeCount + 1);
  assert.deepEqual(await layoutAudit(target), audit);
});

test('layout setup version fences browser reassignment, ABA, and concurrent updates', async () => {
  const source = await makeLayoutSetup(), other = await makeLayoutSetup();
  const target = await makeLayoutTarget(source, 'Synthetic reassignment target');
  const token = await authorizeLayout(34, target);
  const original = await readSetup(token, target);
  const assign = async (setupId: string) => {
    const response = await inject({ method: 'PATCH', url: `/api/v1/households/${householdId}/displays/${target}`,
      headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf, origin }, payload: { setupId } });
    assert.equal(response.statusCode, 200, response.body);
    return readSetup(token, target);
  };
  const reassigned = await assign(other);
  assert.equal(reassigned.revision, original.revision);
  assert.notEqual(reassigned.setupVersion, original.setupVersion);
  failed(await call(token, 110, layoutTool, changeLayout(target, original.setupVersion)), /REVISION_CONFLICT/);
  const restored = await assign(source);
  assert.equal(restored.revision, original.revision);
  assert.notEqual(restored.setupVersion, original.setupVersion);
  assert.notEqual(restored.setupVersion, reassigned.setupVersion);
  assert.deepEqual(await assign(source), restored);
  failed(await call(token, 111, layoutTool, changeLayout(target, original.setupVersion)), /REVISION_CONFLICT/);

  const before = await setupCount();
  const request = changeLayout(target, restored.setupVersion);
  const responses = await Promise.all([
    call(token, 112, layoutTool, request),
    call(token, 113, layoutTool, { ...request, cards: ['today'], cardOrder: ['today'] })
  ]);
  const winner = responses.find(response => rpc(response).result?.structuredContent);
  const stale = responses.find(response => rpc(response).result?.isError);
  assert.ok(winner);
  assert.ok(stale);
  failed(stale, /REVISION_CONFLICT/);
  assert.equal(await setupCount(), before + 1);
  assert.equal((await layoutAudit(target)).length, 1);
});

async function assignedSetupId(displayId: string) {
  return (await pool.query<{ setup_id: string }>('SELECT setup_id FROM displays WHERE id=$1', [displayId])).rows[0]!.setup_id;
}

async function setupOwnership(setupId: string) {
  return (await pool.query<{ display_id: string; last_mcp_revision: number }>(
    'SELECT display_id,last_mcp_revision FROM mcp_display_layout_ownership WHERE household_id=$1 AND setup_id=$2',
    [householdId, setupId])).rows[0];
}

test('layout write reuses its private setup, then forks when an ungranted sibling assigns it', async () => {
  const source = await makeLayoutSetup();
  const target = await makeLayoutTarget(source, 'Synthetic layout reuse target');
  const sibling = await makeLayoutTarget(source, 'Synthetic layout sharing sibling');
  const token = await authorizeLayout(44, target);
  const setupVersion = (await readSetup(token, target)).setupVersion;
  const count = await setupCount();
  const first = succeeded(await call(token, 123, layoutTool, changeLayout(target, setupVersion))).layout;
  const owned = await assignedSetupId(target);
  assert.deepEqual(await setupOwnership(owned), { display_id: target, last_mcp_revision: 1 });

  let latest = first;
  for (const cards of [['today'], ['photos', 'people'], ['today']]) {
    const change = { ...changeLayout(target, latest.setupVersion), cards, cardOrder: cards };
    latest = succeeded(await call(token, 124, layoutTool, change)).layout;
    assert.equal(await assignedSetupId(target), owned);
    assert.equal(await setupCount(), count + 1);
  }
  const edits = await layoutAudit(target);
  assert.deepEqual(edits.map(row => row.metadata.revision), [1, 2, 3, 4]);
  assert.equal(new Set(edits.map(row => row.metadata.setupVersion)).size, 4);
  assert.equal(edits.at(-1)?.metadata.setupVersion, latest.setupVersion);
  assert.deepEqual(await setupOwnership(owned), { display_id: target, last_mcp_revision: 4 });

  // The browser assigns a setup with the device locked before taking FOR SHARE
  // on the destination setup. Hold its assignment open while MCP tries to edit.
  const browser = await pool.connect();
  let waiting: Promise<LightMyRequestResponse>;
  try {
    await browser.query('BEGIN');
    await browser.query('SELECT id FROM displays WHERE id=$1 AND household_id=$2 FOR UPDATE', [sibling, householdId]);
    await browser.query('SELECT id FROM display_setups WHERE household_id=$1 AND id=$2 FOR SHARE', [householdId, owned]);
    await browser.query('UPDATE displays SET setup_id=$2 WHERE id=$1', [sibling, owned]);
    waiting = call(token, 125, layoutTool, changeLayout(target, latest.setupVersion));
    await waitForBlockedQuery('FROM display_setups WHERE household_id=$1 AND id=$2 FOR UPDATE');
    await browser.query('COMMIT');
  } finally {
    await browser.query('ROLLBACK');
    browser.release();
  }

  const forked = succeeded(await waiting!).layout;
  const next = await assignedSetupId(target);
  assert.notEqual(next, owned);
  assert.equal(await assignedSetupId(sibling), owned);
  assert.equal(await setupCount(), count + 2);
  const previous = (await pool.query('SELECT cards,revision FROM display_setups WHERE id=$1', [owned])).rows[0];
  assert.deepEqual(previous, { cards: ['today'], revision: 4 });
  assert.deepEqual(await setupOwnership(next), { display_id: target, last_mcp_revision: 1 });
  const forkAudit = (await layoutAudit(target)).at(-1);
  assert.equal(forkAudit?.metadata.setupVersion, forked.setupVersion);
  assert.notEqual(forkAudit?.metadata.setupVersion, first.setupVersion);
  failed(await call(token, 126, layoutTool, changeLayout(sibling, forked.setupVersion)), /NOT_FOUND/);

  await pool.query('UPDATE displays SET setup_id=$2,revoked_at=clock_timestamp() WHERE id=$1', [sibling, next]);
  succeeded(await call(token, 127, layoutTool, { ...changeLayout(target, forked.setupVersion), cards: ['today'], cardOrder: ['today'] }));
  assert.equal(await assignedSetupId(sibling), next);
  assert.notEqual(await assignedSetupId(target), next);
  assert.equal(await setupCount(), count + 3);
  const revokedSetup = (await pool.query('SELECT cards,revision FROM display_setups WHERE id=$1', [next])).rows[0];
  assert.deepEqual(revokedSetup, { cards: ['photos', 'people'], revision: 1 });
});

test('a browser edit saves the MCP-created setup and forces the next delegated edit to fork', async () => {
  const source = await makeLayoutSetup();
  const target = await makeLayoutTarget(source, 'Synthetic browser layout owner target');
  const token = await authorizeLayout(46, target);
  const { setupVersion } = await readSetup(token, target);
  succeeded(await call(token, 128, layoutTool, changeLayout(target, setupVersion)));
  const first = await readSetup(token, target);
  const owned = await assignedSetupId(target);
  const saved = await inject({ method: 'PATCH', url: `/api/v1/households/${householdId}/display-setups/${owned}`,
    headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf, origin },
    payload: { name: 'Synthetic browser-saved setup', locale: first.locale, theme: first.theme, cards: first.cards, cardOrder: first.cardOrder,
      familyLayoutEnabled: first.familyLayoutEnabled, expectedRevision: first.revision } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(await setupOwnership(owned), { display_id: target, last_mcp_revision: first.revision });
  const browserSetup = await readSetup(token, target);
  assert.equal(browserSetup.revision, first.revision + 1);

  const count = await setupCount();
  succeeded(await call(token, 129, layoutTool, {
    ...changeLayout(target, browserSetup.setupVersion), cards: ['today'], cardOrder: ['today']
  }));
  assert.notEqual(await assignedSetupId(target), owned);
  assert.equal(await setupCount(), count + 1);
  const template = (await pool.query('SELECT name,cards,revision FROM display_setups WHERE id=$1', [owned])).rows[0];
  assert.deepEqual(template, { name: 'Synthetic browser-saved setup', cards: first.cards, revision: browserSetup.revision });
});

test('layout write rechecks live capability, scope, token expiry, and exact display revocation', async () => {
  const source = await makeLayoutSetup();
  const target = await makeLayoutTarget(source, 'Synthetic layout revocation target');
  const token = await authorizeLayout(36, target);
  const request = changeLayout(target, (await readSetup(token, target)).setupVersion);
  const update = (id: number) => call(token, id, layoutTool, request);
  const before = await setupCount();
  const member = (await pool.query<{ id: string; capabilities: string[] }>(
    'SELECT id,capabilities FROM memberships WHERE household_id=$1', [householdId])).rows[0]!;
  await pool.query("UPDATE memberships SET capabilities=capabilities-'display.manage' WHERE id=$1", [member.id]);
  try {
    failed(await update(114), /FORBIDDEN/);
  } finally {
    await pool.query('UPDATE memberships SET capabilities=$2::jsonb WHERE id=$1', [member.id, JSON.stringify(member.capabilities)]);
  }
  await pool.query('UPDATE mcp_oauth_scope_catalog SET active=false WHERE scope=$1', [layoutScope]);
  try {
    failed(await update(115), /FORBIDDEN/);
  } finally {
    await pool.query('UPDATE mcp_oauth_scope_catalog SET active=true WHERE scope=$1', [layoutScope]);
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(`UPDATE mcp_oauth_token_sets SET access_expires_at=clock_timestamp()+interval '2 seconds' WHERE access_token_hash=$1`, [tokenHash]);
  const blocker = await pool.connect();
  let waiting: Promise<LightMyRequestResponse>;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM displays WHERE id=$1 FOR UPDATE', [target]);
    waiting = update(116);
    await waitForBlockedQuery('SELECT setup_id,setup_assignment_revision::text FROM displays');
    await delay(2050);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  failed(await waiting!, /FORBIDDEN/);
  const fresh = await authorize(38, layoutScopes);
  await pool.query('UPDATE displays SET revoked_at=clock_timestamp() WHERE id=$1', [target]);
  failed(await call(fresh, 117, layoutTool, request), /NOT_FOUND/);
  const revoked = await inject({ method: 'POST', url: `/api/v1/households/${householdId}/mcp/authorizations/${grantId}/revoke`,
    headers: { cookie: adminCookie, 'x-csrf-token': adminCsrf, origin } });
  assert.equal(revoked.statusCode, 204, revoked.body);
  assert.equal((await call(fresh, 118, layoutTool, request)).statusCode, 401);
  assert.deepEqual(await layoutAudit(target), []);
  assert.equal(await setupCount(), before);
});

test('layout clone waits for media deletion and retries from the setup with its reference cleared', async () => {
  const source = await makeLayoutSetup();
  const target = await makeLayoutTarget(source, 'Synthetic layout media race target');
  const token = await authorizeLayout(40, target);
  const ownerPerson = await oneId(`INSERT INTO persons(household_id,display_name,age_group)
    VALUES($1,'Synthetic layout media owner','adult') RETURNING id`, [householdId]);
  const ownerAccount = await oneId(`INSERT INTO accounts(installation_id,email_normalized,locale,theme)
    VALUES($1,'layout-media-owner@test.invalid','en','system') RETURNING id`, [installationId]);
  const ownerMembership = await oneId(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities)
    VALUES($1,$2,$3,'member','["household.view"]') RETURNING id`, [householdId, ownerAccount, ownerPerson]);
  const ownerSession = await oneId(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at)
    VALUES($1,'synthetic-layout-media-session-hash','synthetic-layout-media-csrf-hash',clock_timestamp()+interval '1 day') RETURNING id`, [ownerAccount]);
  const album = await oneId(`INSERT INTO media_albums(household_id,owner_membership_id,name)
    VALUES($1,$2,'Synthetic layout media race album') RETURNING id`, [householdId, ownerMembership]);
  await pool.query('UPDATE display_setups SET album_ids=$2::jsonb WHERE id=$1', [source, JSON.stringify([album])]);
  const version = (await readSetup(token, target)).setupVersion;
  const original = succeeded(await call(token, 130, layoutTool, changeLayout(target, version))).layout;
  const owned = await assignedSetupId(target);
  const nextLayout = { ...changeLayout(target, original.setupVersion), cards: ['today'], cardOrder: ['today'] };
  const count = await setupCount();
  const blocker = await pool.connect();
  let deletion: Promise<{ deleted: boolean; remainingAssets: number }>;
  let waiting: Promise<LightMyRequestResponse>;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM media_albums WHERE id=$1 FOR UPDATE', [album]);
    deletion = new MediaService().deleteAlbum({ householdId, membershipId: ownerMembership, accountId: ownerAccount, personId: ownerPerson, sessionId: ownerSession }, album, 1);
    await waitForBlockedQuery('FROM media_albums album WHERE album.household_id=$1 AND album.id=$2 FOR UPDATE');
    waiting = call(token, 119, layoutTool, nextLayout);
    await waitForBlockedQuery('SELECT household_id FROM media_household_usage WHERE household_id=$1 FOR UPDATE');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  assert.equal((await deletion!).deleted, true);
  failed(await waiting!, /REVISION_CONFLICT/);
  assert.equal(await setupCount(), count);
  assert.equal((await layoutAudit(target)).length, 1);
  const afterDeletion = await readSetup(token, target);
  assert.notEqual(afterDeletion.setupVersion, original.setupVersion);
  assert.deepEqual(await setupOwnership(owned), { display_id: target, last_mcp_revision: afterDeletion.revision - 1 });
  succeeded(await call(token, 120, layoutTool, { ...nextLayout, expectedSetupVersion: afterDeletion.setupVersion }));
  assert.notEqual(await assignedSetupId(target), owned);
  const assigned = await pool.query(`SELECT setup.album_ids FROM displays display JOIN display_setups setup ON setup.id=display.setup_id WHERE display.id=$1`, [target]);
  assert.deepEqual(assigned.rows, [{ album_ids: [] }]);
  assert.equal(await setupCount(), count + 1);
  assert.equal((await layoutAudit(target)).length, 2);
});

test('layout changes and ownership roll back if the in-transaction audit fails', async () => {
  const source = await makeLayoutSetup();
  const target = await makeLayoutTarget(source, 'Synthetic layout audit target');
  const token = await authorizeLayout(42, target);
  const before = await readSetup(token, target), count = await setupCount();
  const request = changeLayout(target, before.setupVersion);
  await pool.query(`CREATE FUNCTION fail_layout_audit_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic layout audit failure'; END $$`);
  try {
    await pool.query(`CREATE TRIGGER fail_layout_audit_for_test BEFORE INSERT ON audit_events
      FOR EACH ROW WHEN (NEW.action='mcp.display_layout_updated') EXECUTE FUNCTION fail_layout_audit_for_test()`);
    const rejected = await call(token, 121, layoutTool, request);
    assert.equal(rpc(rejected).result?.isError, true, rejected.body);
    assert.equal(await setupCount(), count);
    assert.deepEqual(await readSetup(token, target), before);
    assert.deepEqual(await layoutAudit(target), []);

    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER fail_layout_audit_for_test');
    const retried = succeeded(await call(token, 122, layoutTool, request)).layout;
    assert.notEqual(retried.setupVersion, before.setupVersion);
    assert.equal(await setupCount(), count + 1);
    const owned = await assignedSetupId(target);
    const ownedSetup = await readSetup(token, target);
    const ownedMarker = await setupOwnership(owned);
    const audit = await layoutAudit(target);
    assert.equal(audit.length, 1);

    await pool.query('ALTER TABLE audit_events ENABLE TRIGGER fail_layout_audit_for_test');
    const rejectedInPlace = await call(token, 131, layoutTool, {
      ...changeLayout(target, retried.setupVersion), cards: ['today'], cardOrder: ['today']
    });
    assert.equal(rpc(rejectedInPlace).result?.isError, true, rejectedInPlace.body);
    assert.equal(await setupCount(), count + 1);
    assert.equal(await assignedSetupId(target), owned);
    assert.deepEqual(await readSetup(token, target), ownedSetup);
    assert.deepEqual(await setupOwnership(owned), ownedMarker);
    assert.deepEqual(await layoutAudit(target), audit);
  } finally {
    await pool.query('DROP FUNCTION fail_layout_audit_for_test() CASCADE');
  }
});
