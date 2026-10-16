import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {hashPassword,tokenHash} from '@samvev/core';
import {roleCapabilityPresets} from '@samvev/contracts';
import pg from 'pg';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';

const origin='https://samvev-public-contact.test.invalid';
let app:FastifyInstance,installationId:string,householdId:string,ownerCookie:string,csrf:string,ownerSessionId:string,ownerAccountId:string,childCookie:string;
function cookie(response:LightMyRequestResponse){const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map(value=>value.split(';')[0]).join('; ')}
function ownerHeaders(){return{cookie:ownerCookie,'x-csrf-token':csrf,origin}}
async function waitForBlockedContactQuery(){const deadline=Date.now()+4_000;while(Date.now()<deadline){const rows=await pool.query(`SELECT pid FROM pg_stat_activity WHERE application_name='samvev-api' AND state='active' AND wait_event_type='Lock' AND query ILIKE '%installation_public_contact_configs%'`);if(rows.rowCount)return;await new Promise(resolve=>setTimeout(resolve,20))}assert.fail('public-contact update did not wait on the locked configuration row')}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Public contact integration test refuses a non-isolated DATABASE_URL');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic contact administrator',email:'public-contact-owner@test.invalid',password:'Synthetic-public-contact-owner-password-42'},household:{name:'Synthetic contact household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;ownerCookie=cookie(claim);csrf=claim.json().csrfToken;ownerAccountId=(await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1',[claim.json().membershipId])).rows[0]!.account_id;ownerSessionId=(await pool.query<{id:string}>('SELECT id FROM sessions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1',[ownerAccountId])).rows[0]!.id;installationId=(await pool.query<{id:string}>('SELECT id FROM installations WHERE singleton=true')).rows[0]!.id;
  const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic child account','child') RETURNING id`,[householdId])).rows[0]!;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'public-contact-child@test.invalid',$2,'en','light') RETURNING id`,[installationId,await hashPassword('Synthetic-public-contact-child-password-42')])).rows[0]!;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'member',$4)`,[householdId,account.id,person.id,JSON.stringify(roleCapabilityPresets.member)]);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'public-contact-child@test.invalid',password:'Synthetic-public-contact-child-password-42'}});assert.equal(login.statusCode,200,login.body);childCookie=cookie(login);
});
after(async()=>{await app.close();await pool.end()});

test('anonymous contact exposes only confirmed public fields; admin write uses CAS and child access is denied',async()=>{
  const publicPath='/api/v1/public/contact',adminPath=`/api/v1/installations/${installationId}/public-contact`;
  const empty=await app.inject({method:'GET',url:publicPath});assert.equal(empty.statusCode,200,empty.body);assert.deepEqual(empty.json(),{contact:null});
  assert.equal((await app.inject({method:'GET',url:adminPath,headers:{cookie:childCookie}})).statusCode,403);
  const input={expectedRevision:0,operatorName:'Synthetic public operator',postalAddress:'Synthetic address\nSynthetic town',contactEmail:'contact@synthetic.test.invalid'};
  const saved=await app.inject({method:'PUT',url:adminPath,headers:ownerHeaders(),payload:input});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().contact.revision,1);
  assert.equal((await app.inject({method:'GET',url:adminPath,headers:ownerHeaders()})).json().contact.revision,1);
  const anonymous=await app.inject({method:'GET',url:publicPath});assert.equal(anonymous.statusCode,200);assert.deepEqual(Object.keys(anonymous.json().contact).sort(),['contactEmail','operatorName','postalAddress']);assert.deepEqual(anonymous.json().contact,{operatorName:input.operatorName,postalAddress:input.postalAddress,contactEmail:input.contactEmail});
  const stale=await app.inject({method:'PUT',url:adminPath,headers:ownerHeaders(),payload:input});assert.equal(stale.statusCode,409,stale.body);
  const crossInstallation=await app.inject({method:'GET',url:'/api/v1/installations/00000000-0000-4000-8000-000000000001/public-contact',headers:ownerHeaders()});assert.equal(crossInstallation.statusCode,404);
});

test('contact update rechecks session expiry after a configuration-lock wait and rolls back',async()=>{
  const adminPath=`/api/v1/installations/${installationId}/public-contact`;
  const blocker=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await blocker.connect();await blocker.query('BEGIN');
  await blocker.query('SELECT installation_id FROM installation_public_contact_configs WHERE installation_id=$1 FOR UPDATE',[installationId]);
  await pool.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1`,[ownerSessionId]);
  const update=app.inject({method:'PUT',url:adminPath,headers:ownerHeaders(),payload:{expectedRevision:1,operatorName:'Changed synthetic operator',postalAddress:'Changed synthetic address',contactEmail:'changed@synthetic.test.invalid'}});
  try{await waitForBlockedContactQuery();await new Promise(resolve=>setTimeout(resolve,2_100));}
  finally{await blocker.query('ROLLBACK');await blocker.end()}
  const response=await update;assert.equal(response.statusCode,403,response.body);
  const unchanged=await app.inject({method:'GET',url:`/api/v1/public/contact`});assert.equal(unchanged.statusCode,200);assert.equal(unchanged.json().contact.operatorName,'Synthetic public operator');
});


test('own photo and public contact updates do not invert person and installation audit locks',async()=>{
  // The preceding expiry test intentionally expires this synthetic session.
  await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[ownerSessionId]);
  const person=(await pool.query<{id:string}>('SELECT person_id AS id FROM memberships WHERE household_id=$1 AND account_id=$2',[householdId,ownerAccountId])).rows[0]!;
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
  const photoPath=`/api/v1/households/${householdId}/people/${person.id}/photo`,contactPath=`/api/v1/installations/${installationId}/public-contact`;
  const initialPhoto=await app.inject({method:'PUT',url:photoPath,headers:ownerHeaders(),payload:{imageBase64:image,expectedPhotoRevision:0}});assert.equal(initialPhoto.statusCode,200,initialPhoto.body);
  const current=(await app.inject({method:'GET',url:contactPath,headers:ownerHeaders()})).json().contact;
  const input={expectedRevision:current?.revision??0,operatorName:'Synthetic concurrent public operator',postalAddress:'Synthetic concurrent public address',contactEmail:'concurrent@synthetic.test.invalid'};
  const waitForLock=async(fragment:string)=>{const deadline=Date.now()+4_000;do{const rows=await pool.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1`,[`%${fragment}%`]);if(rows.rowCount)return;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);assert.fail(`expected contact/photo lock barrier ${fragment}`);};
  const blocker=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await blocker.connect();let locked=false;
  let photoUpdate:Promise<LightMyRequestResponse>|undefined,contactUpdate:Promise<LightMyRequestResponse>|undefined;
  try{
    await blocker.query('BEGIN');locked=true;await blocker.query('SELECT person_id FROM person_profile_photos WHERE person_id=$1 FOR UPDATE',[person.id]);
    photoUpdate=app.inject({method:'PUT',url:photoPath,headers:ownerHeaders(),payload:{imageBase64:image,expectedPhotoRevision:initialPhoto.json().photoRevision}}).then(response=>response);
    // The real photo route now owns the person and waits on its image row.
    await waitForLock('INSERT INTO person_profile_photos');
    contactUpdate=app.inject({method:'PUT',url:contactPath,headers:ownerHeaders(),payload:input}).then(response=>response);
    // The contact route owns its installation lock and is waiting for the
    // person. Releasing the image row makes the photo write reach its audit FK.
    await waitForLock('FOR SHARE OF installation,session,account,membership,person');
    await blocker.query('ROLLBACK');locked=false;
  }finally{if(locked)await blocker.query('ROLLBACK');await blocker.end();}
  assert.ok(photoUpdate);assert.ok(contactUpdate);const [photo,contact]=await Promise.all([photoUpdate,contactUpdate]);
  assert.equal(photo.statusCode,200,photo.body);assert.equal(contact.statusCode,200,contact.body);
  assert.equal(photo.json().photoRevision,initialPhoto.json().photoRevision+1);assert.equal(contact.json().contact.revision,input.expectedRevision+1);
  assert.deepEqual(contact.json().contact,{operatorName:input.operatorName,postalAddress:input.postalAddress,contactEmail:input.contactEmail,revision:input.expectedRevision+1});
  const audit=(await pool.query<{n:number}>(`SELECT count(*)::int AS n FROM audit_events WHERE installation_id=$1 AND actor_id=$2 AND (action='person.photo_updated' AND subject_id=$3 OR action='installation.public_contact_updated' AND subject_id=$1 AND metadata->>'revision'=$4)`,[installationId,ownerAccountId,person.id,String(input.expectedRevision+1)])).rows[0]!;assert.equal(audit.n,3,'both photo revisions and the contact revision have durable audit records');
});
