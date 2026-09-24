import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { roleCapabilityPresets } from '@samvev/contracts';
import { hashPassword, tokenHash } from '@samvev/core';
import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { migrate } from './db/migrate.ts';

const origin='https://samvev.test';
const password='Synthetic-m3-owner-pass-42';
let app:FastifyInstance;
let householdId:string;
let otherHouseholdId:string;
let ownerPersonId:string;
let childPersonId:string;
let otherPersonId:string;
let ownerMembershipId:string;
let displayId:string;
let secondDisplayId:string;
let ungrantedDisplayId:string;
let displayToken:string;
let adminCookie:string;
let adminCsrf:string;

function cookies(response:LightMyRequestResponse):string{
  const values=response.headers['set-cookie'];const list=Array.isArray(values)?values:values?[values]:[];
  return list.map((value)=>value.split(';')[0]).join('; ');
}
function adminHeaders(){return {cookie:adminCookie,'x-csrf-token':adminCsrf,origin};}
function bearer(token:string,extra:Record<string,string>={}){return {authorization:`Bearer ${token}`,...extra};}
const future=(minutes:number)=>new Date(Date.now()+minutes*60_000).toISOString();

before(async()=>{
  const databaseUrl=new URL(process.env.DATABASE_URL??'');
  if(databaseUrl.hostname!=='test-db'||databaseUrl.pathname!=='/samvev_test')throw new Error('External Intelligence tests refuse non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  const installation=(await pool.query<{id:string}>(`INSERT INTO installations(claimed_at,setup_step,default_locale) VALUES(clock_timestamp(),'complete','nb') RETURNING id`)).rows[0]!;
  householdId=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic M3 household','Europe/Oslo','nb') RETURNING id`,[installation.id])).rows[0]!.id;
  otherHouseholdId=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic other household','UTC','en') RETURNING id`,[installation.id])).rows[0]!.id;
  ownerPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic Owner','adult') RETURNING id`,[householdId])).rows[0]!.id;
  childPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic Child','child') RETURNING id`,[householdId])).rows[0]!.id;
  otherPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic Other','adult') RETURNING id`,[otherHouseholdId])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'m3-owner@test.invalid',$2,'nb','system') RETURNING id`,[installation.id,await hashPassword(password)])).rows[0]!;
  ownerMembershipId=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'installation_admin',$4) RETURNING id`,[householdId,account.id,ownerPersonId,JSON.stringify(roleCapabilityPresets.installation_admin)])).rows[0]!.id;
  displayToken='synthetic-display-token-with-enough-entropy-0001';
  displayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,credential_hash,credential_expires_at) VALUES($1,'Kitchen','nb','system',$2,clock_timestamp()+interval '1 day') RETURNING id`,[householdId,tokenHash(displayToken)])).rows[0]!.id;
  secondDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Hallway','nb','light') RETURNING id`,[householdId])).rows[0]!.id;
  ungrantedDisplayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme) VALUES($1,'Private room','nb','dark') RETURNING id`,[householdId])).rows[0]!.id;
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'m3-owner@test.invalid',password}});
  assert.equal(login.statusCode,200,login.body);adminCookie=cookies(login);adminCsrf=login.json().csrfToken;
});

after(async()=>{await app.close();await pool.end();});

test('scoped integrations provide idempotent CAS items, isolated projections, revocation and audit',async()=>{
  const createdConnection=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/integrations`,headers:adminHeaders(),payload:{
    name:'Synthetic family brief',displayIds:[displayId,secondDisplayId],credential:{name:'Synthetic HA',capabilities:['integration.items.write','integration.items.delete','integration.items.read'],expiresAt:future(120)}
  }});
  assert.equal(createdConnection.statusCode,201,createdConnection.body);assert.equal(createdConnection.headers['cache-control'],'no-store');
  const connectionId=createdConnection.json().connection.id as string;const token=createdConnection.json().credentialToken as string;
  assert.match(token,/^samvev_it_/);assert.equal(createdConnection.json().connection.displayIds.length,2);
  const credentialId=createdConnection.json().connection.credentials[0].id as string;
  const stored=await pool.query<{token_hash:string}>('SELECT token_hash FROM integration_credentials WHERE id=$1',[credentialId]);
  assert.equal(stored.rows[0]!.token_hash,tokenHash(token));assert.equal(stored.rows[0]!.token_hash.includes(token),false);
  const listed=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/integrations`,headers:{cookie:adminCookie}});
  assert.equal(listed.statusCode,200);assert.equal(JSON.stringify(listed.json()).includes(token),false);

  const payload={
    externalId:'family-brief:synthetic:rain',expectedRevision:0,kind:'reminder',
    targets:{household:true,personIds:[childPersonId,ownerPersonId],displayIds:[secondDisplayId,displayId]},
    title:'Synthetic rainwear reminder',body:'Pack synthetic rainwear tomorrow.',entries:[],priority:'high',
    publishAt:new Date(Date.now()-60_000).toISOString(),startsAt:null,endsAt:null,expiresAt:future(120),
    source:{label:'Synthetic family brief',url:'https://example.invalid/weather?day=tomorrow',links:[{label:'Synthetic plan',url:'https://example.invalid/plan?week=39'}],observedAt:new Date().toISOString(),generatedAt:new Date().toISOString(),uncertainty:'low'},
    metadata:{category:'weather',icon:'rain',actionUrl:'https://example.invalid/details?day=tomorrow'}
  };
  assert.equal((await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:{cookie:adminCookie},payload})).statusCode,401,'cookie-only machine request never falls back to browser auth');
  assert.equal((await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:{...bearer('invalid-token-with-enough-entropy-000000000000'),cookie:adminCookie},payload})).statusCode,401,'invalid bearer never falls back to browser cookie');
  assert.equal((await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token,{origin:'https://attacker.invalid'}),payload})).statusCode,403,'foreign Origin remains rejected');
  const created=await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload});
  assert.equal(created.statusCode,201,created.body);assert.equal(created.json().result,'created');assert.equal(created.json().item.revision,1);
  const retry=await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload:{...payload,expectedRevision:999,targets:{...payload.targets,personIds:[ownerPersonId,childPersonId],displayIds:[displayId,secondDisplayId]}}});
  assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().result,'unchanged');assert.equal(retry.json().item.revision,1);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int AS count FROM integration_items WHERE connection_id=$1',[connectionId])).rows[0]!.count,1);

  const competing=await Promise.all(['First concurrent correction','Second concurrent correction'].map((body)=>app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload:{...payload,expectedRevision:1,body}})));
  assert.deepEqual(competing.map((response)=>response.statusCode).sort(),[200,409]);
  const current=await app.inject({method:'GET',url:`/api/v1/integrations/items/${payload.externalId}`,headers:bearer(token)});
  assert.equal(current.statusCode,200,current.body);assert.equal(current.json().item.revision,2);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload:{...payload,externalId:'foreign-person',targets:{household:false,personIds:[otherPersonId],displayIds:[]}}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload:{...payload,externalId:'ungranted-display',targets:{household:true,personIds:[],displayIds:[ungrantedDisplayId]}}})).statusCode,403);

  const readConnection=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/integrations`,headers:adminHeaders(),payload:{name:'Read-only synthetic source',displayIds:[],credential:{name:'Reader',capabilities:['integration.items.read'],expiresAt:null}}});
  const readToken=readConnection.json().credentialToken as string;
  assert.equal((await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(readToken),payload:{...payload,externalId:'forbidden-write'}})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/integrations/items/${payload.externalId}`,headers:bearer(readToken)})).statusCode,404,'read is limited to the stable connection, not the household');

  const home=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:{cookie:adminCookie}});
  assert.equal(home.statusCode,200,home.body);assert.equal(home.json().items.length,1);assert.equal(home.json().items[0].title,payload.title);
  assert.equal('externalId' in home.json().items[0],false);assert.equal('displayIds' in home.json().items[0].targets,false);
  const displayCookie=`samvev_display=${displayToken}`;
  const defaultProjection=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}});
  assert.equal(defaultProjection.statusCode,200,defaultProjection.body);assert.equal(defaultProjection.json().display.externalItemsEnabled,false);assert.equal('hub' in defaultProjection.json(),false);
  const optIn=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{externalItemsEnabled:true}});
  assert.equal(optIn.statusCode,200,optIn.body);assert.equal(optIn.json().external_items_enabled,true);
  const projection=await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}});
  assert.equal(projection.json().hub.items.length,1);assert.equal(projection.json().hub.people.length,2);
  assert.equal('url' in projection.json().hub.items[0].source,false);assert.equal('links' in projection.json().hub.items[0].source,false);
  assert.equal('actionUrl' in projection.json().hub.items[0].metadata,false);assert.equal('displayIds' in projection.json().hub.items[0].targets,false);
  await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{privacyMode:true}});
  assert.equal('hub' in (await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}})).json(),false);
  await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/displays/${displayId}`,headers:adminHeaders(),payload:{privacyMode:false}});

  const address=await app.listen({host:'127.0.0.1',port:0});const controller=new AbortController();
  const stream=await fetch(`${address}/api/v1/households/${householdId}/events`,{headers:{cookie:adminCookie},signal:controller.signal});
  assert.equal(stream.status,200);const reader=stream.body!.getReader();const decoder=new TextDecoder();
  const ready=decoder.decode((await reader.read()).value);assert.match(ready,/event: ready/);
  const nextPayload={...payload,expectedRevision:2,body:'SSE synthetic correction'};
  const updated=await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload:nextPayload});assert.equal(updated.statusCode,200,updated.body);
  let events='';
  for(let attempt=0;attempt<5&&!events.includes('projection-invalidated');attempt++){
    const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('member SSE timeout')),2000))]);events+=decoder.decode(chunk.value);
  }
  assert.match(events,/event: projection-invalidated/);controller.abort();

  const withdrawn=await app.inject({method:'DELETE',url:`/api/v1/integrations/items/${payload.externalId}`,headers:bearer(token),payload:{expectedRevision:3}});
  assert.equal(withdrawn.statusCode,200,withdrawn.body);assert.equal(withdrawn.json().item.status,'withdrawn');assert.equal(withdrawn.json().item.revision,4);
  const repeatedWithdrawal=await app.inject({method:'DELETE',url:`/api/v1/integrations/items/${payload.externalId}`,headers:bearer(token),payload:{expectedRevision:3}});
  assert.equal(repeatedWithdrawal.json().result,'unchanged');assert.equal(repeatedWithdrawal.json().item.revision,4);
  const resurrect=await app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload:{...payload,expectedRevision:4}});
  assert.equal(resurrect.statusCode,409);assert.equal(resurrect.json().error.details.reason,'item_permanently_withdrawn');
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/home`,headers:{cookie:adminCookie}})).json().items.length,0);
  assert.equal('hub' in (await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}})).json() ? (await app.inject({method:'GET',url:'/api/v1/display/projection',headers:{cookie:displayCookie}})).json().hub.items.length : 0,0);

  const audit=await pool.query<{actor_type:string;actor_id:string;metadata:string}>('SELECT actor_type,actor_id,metadata::text FROM audit_events WHERE actor_type=\'integration\' ORDER BY id');
  assert.ok(audit.rowCount&&audit.rowCount>=3);assert.ok(audit.rows.every((row)=>row.actor_id===connectionId&&row.metadata.includes(credentialId)&&!row.metadata.includes(token)&&!row.metadata.includes(payload.title)&&!row.metadata.includes(payload.body)&&!row.metadata.includes('example.invalid')));
  const connectionRevision=(await app.inject({method:'GET',url:`/api/v1/households/${householdId}/integrations`,headers:{cookie:adminCookie}})).json().connections.find((connection:{id:string})=>connection.id===connectionId).revision;
  const revoked=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/integrations/${connectionId}/revoke`,headers:adminHeaders(),payload:{expectedRevision:connectionRevision}});
  assert.equal(revoked.statusCode,200,revoked.body);assert.equal((await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer(token)})).statusCode,401);
});

test('invalid bearer attempts are durably bounded and a revocation that wins the connection lock prevents commit',async()=>{
  await pool.query("DELETE FROM rate_limits WHERE bucket IN ('integration_auth_ip','integration_auth_invalid')");
  for(let attempt=0;attempt<20;attempt++){
    const response=await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer(`invalid-token-with-enough-entropy-${String(attempt).padStart(4,'0')}`)});
    assert.equal(response.statusCode,401,`${attempt}: ${response.body}`);
  }
  assert.equal((await app.inject({method:'GET',url:'/api/v1/integrations/items',headers:bearer('invalid-token-with-enough-entropy-over-limit')})).statusCode,429);
  await pool.query("DELETE FROM rate_limits WHERE bucket IN ('integration_auth_ip','integration_auth_invalid')");

  const connection=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/integrations`,headers:adminHeaders(),payload:{name:'Revocation race source',displayIds:[],credential:{name:'Race writer',capabilities:['integration.items.write'],expiresAt:future(30)}}});
  const connectionId=connection.json().connection.id as string;const token=connection.json().credentialToken as string;
  const payload={externalId:'race:item',expectedRevision:0,kind:'observation',targets:{household:true,personIds:[],displayIds:[]},title:'Synthetic race',body:'Must not commit after revocation.',entries:[],priority:'normal',publishAt:null,startsAt:null,endsAt:null,expiresAt:future(30),source:{label:'Synthetic race',links:[],observedAt:new Date().toISOString(),uncertainty:'unknown'},metadata:{}};
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM integration_connections WHERE id=$1 FOR UPDATE',[connectionId]);
  const pending=app.inject({method:'POST',url:'/api/v1/integrations/items',headers:bearer(token),payload});
  await new Promise((resolve)=>setTimeout(resolve,100));
  await blocker.query('UPDATE integration_connections SET revoked_at=clock_timestamp(),revision=revision+1 WHERE id=$1',[connectionId]);await blocker.query('COMMIT');blocker.release();
  const response=await pending;assert.equal(response.statusCode,401,response.body);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int AS count FROM integration_items WHERE connection_id=$1',[connectionId])).rows[0]!.count,0);
});

test('migration chain reruns idempotently',async()=>{await migrate();await migrate();});
