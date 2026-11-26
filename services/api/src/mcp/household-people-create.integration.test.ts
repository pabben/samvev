import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';

const origin='https://people-create.test.invalid',callback='https://people-create-client.test.invalid/oauth/callback';
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-people-create-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
let app:FastifyInstance,householdId='',ownerCookie='',ownerCsrf='',clientId='';
function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
function rpcHeaders(name='household.people.create_profile'){return{'mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name};}
async function authorize(serial:number,scope='mcp:context mcp:people:read mcp:people:write'){
  const verifier=`synthetic-people-create-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`people-create-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:ownerCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:ownerCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:ownerCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code')!;
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);return exchanged.json().access_token as string;
}
async function callTool(token:string,name:string,id:number,args:Record<string,unknown>){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json',...rpcHeaders(name)},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args,_meta:meta}}});}
async function create(token:string,id:number,args:Record<string,unknown>){return callTool(token,'household.people.create_profile',id,args);}
function result(response:LightMyRequestResponse){return response.json().result;}

before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');if(url.hostname!=='test-db'||url.pathname!=='/samvev_test')throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic profile owner',email:'profile-owner@test.invalid',password:'Synthetic-profile-owner-pass-42'},household:{name:'Synthetic profile household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;ownerCookie=cookies(claim);ownerCsrf=claim.json().csrfToken;
  const registered=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic profile creator',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(registered.statusCode,201,registered.body);clientId=registered.json().client_id;
});
after(async()=>{if(app)await app.close();await pool.end();});

test('MCP creates strict accountless profiles with isolated fresh consent and durable idempotent receipts',async()=>{
  const browserCreated=await inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{displayName:'Synthetic browser-created profile',ageGroup:'teen',rolePreset:'limited',displayIds:[]}});
  assert.equal(browserCreated.statusCode,201,browserCreated.body);
  assert.deepEqual({hasLogin:browserCreated.json().hasLogin,invitationToken:browserCreated.json().invitationToken},{hasLogin:false,invitationToken:null});
  const browserPerson=(await pool.query<{age_group:string;display_name:string;color_token:string}>('SELECT age_group,display_name,color_token FROM persons WHERE id=$1',[browserCreated.json().personId])).rows[0]!;
  assert.equal(browserPerson.age_group,'teen');assert.equal(browserPerson.display_name,'Synthetic browser-created profile');
  assert.ok(browserPerson.color_token,'browser creation continues assigning a person color');

  const oldToken=await authorize(1);
  const input={displayName:'Synthetic accountless profile',requestKey:'11111111-1111-4111-8111-111111111111'};
  const noFreshConsent=await create(oldToken,1,input);
  assert.equal(noFreshConsent.statusCode,403,'existing people read/write consent cannot create a profile');
  const token=await authorize(2,'mcp:context mcp:people:read mcp:people:write mcp:people:create');
  const grant=(await pool.query<{id:string;revision:number}>('SELECT id,revision FROM mcp_oauth_grants WHERE household_id=$1',[householdId])).rows[0]!;
  assert.equal((await pool.query('SELECT 1 FROM mcp_oauth_grant_people WHERE grant_id=$1',[grant.id])).rowCount,0,'fresh consent does not add person grants');
  await pool.query("UPDATE mcp_oauth_scope_catalog SET active=false WHERE scope='mcp:people:create'");
  try {
    const disabledScope=await create(token,2,input);
    assert.equal(disabledScope.statusCode,200,disabledScope.body);
    assert.equal(result(disabledScope).isError,true,'an inactive catalog scope fences an already issued grant and token');
    assert.equal((await pool.query('SELECT 1 FROM persons WHERE household_id=$1 AND display_name=$2',[householdId,input.displayName])).rowCount,0);
  } finally {
    await pool.query("UPDATE mcp_oauth_scope_catalog SET active=true WHERE scope='mcp:people:create'");
  }
  await pool.query(`CREATE OR REPLACE FUNCTION fail_synthetic_person_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='mcp.person_profile_created' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER fail_synthetic_person_create_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_synthetic_person_create_audit()`);
  try {
    const failedFirstCreate=await create(token,3,input);assert.equal(result(failedFirstCreate).isError,true);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM mcp_people_create_key_fences WHERE household_id=$1',[householdId])).rows[0]!.count,0,'audit failure rolls back the initial key fence');
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM mcp_people_create_receipts WHERE household_id=$1',[householdId])).rows[0]!.count,0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM persons WHERE household_id=$1 AND display_name=$2',[householdId,input.displayName])).rows[0]!.count,0);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS fail_synthetic_person_create_audit ON audit_events');
    await pool.query('DROP FUNCTION IF EXISTS fail_synthetic_person_create_audit()');
  }
  const [first,concurrent]=await Promise.all([create(token,4,input),create(token,5,input)]);
  assert.equal(result(first).isError,undefined,first.body);assert.equal(result(concurrent).isError,undefined,concurrent.body);
  const original=result(first).structuredContent.creation as {personId:string;createdRevision:number;hadLoginAtCreation:boolean};
  const replay=result(concurrent).structuredContent.creation;
  assert.deepEqual(replay,original);
  assert.deepEqual(original,{personId:original.personId,createdRevision:1,hadLoginAtCreation:false});
  const persisted=(await pool.query<{display_name:string;age_group:string;birth_date:string|null;avatar_key:string|null;account_id:string|null;role_preset:string;capabilities:string[]}>('SELECT person.display_name,person.age_group,person.birth_date::text,person.avatar_key,membership.account_id,membership.role_preset,membership.capabilities FROM persons person JOIN memberships membership ON membership.person_id=person.id WHERE person.id=$1',[original.personId])).rows[0]!;
  assert.deepEqual(persisted,{display_name:input.displayName,age_group:'unspecified',birth_date:null,avatar_key:null,account_id:null,role_preset:'limited',capabilities:['household.view']});
  assert.equal((await pool.query('SELECT 1 FROM account_invitations WHERE account_id IN (SELECT account_id FROM memberships WHERE person_id=$1)',[original.personId])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM membership_display_grants WHERE membership_id IN (SELECT id FROM memberships WHERE person_id=$1)',[original.personId])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM mcp_oauth_grant_people WHERE grant_id=$1 AND person_id=$2',[grant.id,original.personId])).rowCount,0);
  const receipt=(await pool.query<{request_key_hash:string;payload_hash:string}>(`SELECT encode(request_key_hash,'hex') request_key_hash,encode(payload_hash,'hex') payload_hash
    FROM mcp_people_create_receipts WHERE household_id=$1 AND grant_id=$2 AND person_id=$3`,[householdId,grant.id,original.personId])).rows[0]!;
  assert.match(receipt.request_key_hash,/^[a-f0-9]{64}$/);assert.match(receipt.payload_hash,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(receipt).includes(input.displayName),false,'receipt stores only keyed hashes, not the guessable profile name');
  assert.notEqual(receipt.payload_hash,createHash('sha256').update(JSON.stringify({displayName:input.displayName})).digest('hex'));
  const personList=await callTool(token,'household.people.list',5,{});assert.equal(result(personList).isError,undefined,personList.body);
  assert.deepEqual(result(personList).structuredContent.people,[],'the created profile stays unreadable without a separate person selection');
  const personEdit=await callTool(token,'household.people.update',6,{personId:original.personId,displayName:'Synthetic unauthorized edit',expectedRevision:1});
  assert.equal(result(personEdit).isError,true,'the created profile stays uneditable without a separate person selection');

  const changed=await create(token,7,{...input,displayName:'Synthetic changed payload'});assert.equal(result(changed).isError,true);
  const extra=await create(token,8,{...input,ageGroup:'adult'});assert.equal(result(extra).isError,true);
  await pool.query("UPDATE persons SET display_name='Synthetic browser edit',revision=revision+1 WHERE id=$1",[original.personId]);
  await pool.query('DELETE FROM persons WHERE id=$1',[original.personId]);
  const afterDelete=await create(token,9,input);assert.equal(result(afterDelete).isError,undefined,afterDelete.body);
  assert.deepEqual(result(afterDelete).structuredContent.creation,original,'durable replay returns the historical receipt after profile deletion');

  await pool.query(`INSERT INTO mcp_people_create_receipts(household_id,grant_id,request_key_hash,payload_hash,person_id)
    SELECT $1,$2,decode(md5(i::text)||md5('key-'||i::text),'hex'),decode(md5('payload-'||i::text)||md5(i::text),'hex'),gen_random_uuid()
    FROM generate_series(1,19) i`,[householdId,grant.id]);
  const replayAtQuota=await create(token,10,input);assert.equal(result(replayAtQuota).isError,undefined,replayAtQuota.body);
  const overQuota=await create(token,11,{displayName:'Synthetic over quota',requestKey:'22222222-2222-4222-8222-222222222222'});assert.equal(result(overQuota).isError,true);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM mcp_people_create_receipts WHERE household_id=$1',[householdId])).rows[0]!.count,20);

  await pool.query('DELETE FROM mcp_people_create_receipts WHERE household_id=$1 AND person_id<>$2',[householdId,original.personId]);
  await pool.query(`CREATE OR REPLACE FUNCTION fail_synthetic_person_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='mcp.person_profile_created' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER fail_synthetic_person_create_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_synthetic_person_create_audit()`);
  try {
    const failed=await create(token,12,{displayName:'Synthetic audit rollback',requestKey:'33333333-3333-4333-8333-333333333333'});
    assert.equal(result(failed).isError,true);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM persons WHERE household_id=$1 AND display_name=$2',[householdId,'Synthetic audit rollback'])).rows[0]!.count,0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM mcp_people_create_receipts WHERE household_id=$1',[householdId])).rows[0]!.count,1);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS fail_synthetic_person_create_audit ON audit_events');
    await pool.query('DROP FUNCTION IF EXISTS fail_synthetic_person_create_audit()');
  }

  await pool.query(`UPDATE mcp_oauth_grants SET scopes=scopes-'mcp:people:create' WHERE id=$1`,[grant.id]);
  const narrowed=await create(token,13,{displayName:'Synthetic stale-scope denial',requestKey:'44444444-4444-4444-8444-444444444444'});assert.equal(result(narrowed).isError,true);
  await pool.query(`UPDATE mcp_oauth_grants SET scopes=scopes||'"mcp:people:create"'::jsonb WHERE id=$1`,[grant.id]);
  const ownerPerson=(await pool.query<{id:string}>('SELECT person_id AS id FROM memberships WHERE household_id=$1 AND account_id IS NOT NULL LIMIT 1',[householdId])).rows[0]!.id;
  await pool.query(`UPDATE memberships SET capabilities=capabilities-'people.manage' WHERE household_id=$1 AND person_id=$2`,[householdId,ownerPerson]);
  const demoted=await create(token,14,{displayName:'Synthetic demoted denial',requestKey:'55555555-5555-4555-8555-555555555555'});assert.equal(result(demoted).isError,true);

  const catalog=(await pool.query<{introduced_version:number;risk:string}>(`SELECT introduced_version,risk FROM mcp_oauth_scope_catalog WHERE scope='mcp:people:create'`)).rows[0]!;
  assert.deepEqual(catalog,{introduced_version:16,risk:'write'});
  assert.equal((await pool.query('SELECT 1 FROM audit_events WHERE household_id=$1 AND actor_type=$2 AND actor_id=$3 AND action=$4',[householdId,'mcp',grant.id,'mcp.person_profile_created'])).rowCount,1);
  assert.ok(grant.revision>0);
});
