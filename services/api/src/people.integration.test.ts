import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {roleCapabilityPresets} from '@samvev/contracts';
import {hashPassword} from '@samvev/core';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {runLocalBootstrap} from './people/local-bootstrap.ts';

let app:FastifyInstance;
const password='Synthetic-owner-password-42';
function cookies(response:LightMyRequestResponse):string{const values=response.headers['set-cookie'];const list=Array.isArray(values)?values:values?[values]:[];return list.map((value)=>value.split(';')[0]).join('; ');}
function auth(cookie:string,csrf:string){return{cookie,'x-csrf-token':csrf};}

before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  if(url.hostname!=='test-db'||url.pathname!=='/samvev_test')throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();await pool.query(`TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE`);app=await buildApp();
});
after(async()=>{await app.close();await pool.end();});

test('fresh locale defaults to nb while explicit account preference is retained',async()=>{
  const fresh=(await pool.query<{id:string;default_locale:string}>(`INSERT INTO installations(claim_token_hash,claim_expires_at) VALUES('synthetic-hash',clock_timestamp()+interval '1 hour') RETURNING id,default_locale`)).rows[0]!;
  assert.equal(fresh.default_locale,'nb');
  await pool.query(`UPDATE installations SET default_locale='en' WHERE id=$1`,[fresh.id]);
  await migrate();
  assert.equal((await pool.query<{default_locale:string}>('SELECT default_locale FROM installations WHERE id=$1',[fresh.id])).rows[0]!.default_locale,'en');
  await pool.query('DELETE FROM installations WHERE id=$1',[fresh.id]);
});

test('owner creates administrators, invitations and people while role and birthday privacy remain enforced',async()=>{
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin'});
  const weakClaim=await app.inject({method:'POST',url:'/api/v1/setup/claim',payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic Owner',email:'owner@people.test.invalid',password:'abcdefg1'},household:{name:'Synthetic household',timezone:'UTC',locale:'nb'},preferences:{locale:'nb',theme:'system'}}});
  assert.equal(weakClaim.statusCode,400);
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic Owner',email:'owner@people.test.invalid',password},household:{name:'Synthetic household',timezone:'UTC',locale:'nb'},preferences:{locale:'nb',theme:'system'}}});
  assert.equal(claim.statusCode,200,claim.body);
  const ownerCookie=cookies(claim),ownerCsrf=claim.json().csrfToken as string,householdId=claim.json().householdId as string;
  await app.inject({method:'PATCH',url:'/api/v1/me/preferences',headers:auth(ownerCookie,ownerCsrf),payload:{locale:'en'}});
  await pool.query(`UPDATE households SET default_locale='en' WHERE id=$1`,[householdId]);await migrate();
  assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:ownerCookie}})).json().account.locale,'en');
  assert.equal((await pool.query<{default_locale:string}>('SELECT default_locale FROM households WHERE id=$1',[householdId])).rows[0]!.default_locale,'en');
  await app.inject({method:'PATCH',url:'/api/v1/me/preferences',headers:auth(ownerCookie,ownerCsrf),payload:{locale:'nb'}});
  await pool.query(`UPDATE households SET default_locale='nb' WHERE id=$1`,[householdId]);

  const personOnly=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(ownerCookie,ownerCsrf),payload:{displayName:'Synthetic Person Only',birthDate:'2014-09-10',rolePreset:'limited',displayIds:[]}});
  assert.equal(personOnly.statusCode,201,personOnly.body);assert.equal(personOnly.json().hasLogin,false);

  const adminCreate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(ownerCookie,ownerCsrf),payload:{displayName:'Synthetic Household Admin',birthDate:null,rolePreset:'household_admin',displayIds:[],login:{email:'house-admin@people.test.invalid',loginMethod:'invitation',locale:'en',theme:'light'}}});
  assert.equal(adminCreate.statusCode,201,adminCreate.body);assert.match(adminCreate.json().invitationToken,/^[A-Za-z0-9_-]{40,}$/);
  const pendingAdmin=(await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:ownerCookie}})).json().people.find((person:{email:string|null})=>person.email==='house-admin@people.test.invalid');
  assert.equal(pendingAdmin.account_status,'pending');
  const reissued=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/accounts/${pendingAdmin.account_id}/invitation`,headers:auth(ownerCookie,ownerCsrf),payload:{expectedRevision:pendingAdmin.account_revision}});
  assert.equal(reissued.statusCode,201,reissued.body);assert.match(reissued.json().invitationToken,/^[A-Za-z0-9_-]{40,}$/);
  const revokedInvite=await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:adminCreate.json().invitationToken,password:'Synthetic-admin-password-42'}});
  assert.equal(revokedInvite.statusCode,410);assert.equal(revokedInvite.json().error.code,'INVITATION_INVALID');
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:reissued.json().invitationToken,password:'abcdefgh1'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:reissued.json().invitationToken,password:'Synthetic-admin-password-42'}})).statusCode,200);
  const inviteAgain=await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:reissued.json().invitationToken,password:'Synthetic-admin-password-42'}});
  assert.equal(inviteAgain.statusCode,410);assert.equal(inviteAgain.json().error.code,'INVITATION_INVALID');
  const adminLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'house-admin@people.test.invalid',password:'Synthetic-admin-password-42'}});
  const adminCookie=cookies(adminLogin),adminCsrf=adminLogin.json().csrfToken as string;
  const adminMe=await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:adminCookie}});
  assert.deepEqual(adminMe.json().memberships[0].capabilities,roleCapabilityPresets.household_admin);

  const ordinary=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(ownerCookie,ownerCsrf),payload:{displayName:'Synthetic Ordinary',rolePreset:'member',displayIds:[],login:{email:'member@people.test.invalid',password:'Memberpass1',locale:'nb',theme:'system'}}});
  assert.equal(ordinary.statusCode,201,ordinary.body);
  const memberLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'member@people.test.invalid',password:'Memberpass1'}});
  const memberCookie=cookies(memberLogin),memberCsrf=memberLogin.json().csrfToken as string;
  const escalate=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ordinary.json().membershipId}`,headers:auth(memberCookie,memberCsrf),payload:{rolePreset:'household_admin',capabilities:roleCapabilityPresets.household_admin,displayIds:[],expectedRevision:1}});
  assert.equal(escalate.statusCode,403);
  const restrictedCreate=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(memberCookie,memberCsrf),payload:{displayName:'Must fail',rolePreset:'limited',displayIds:[]}});
  assert.equal(restrictedCreate.statusCode,403);
  const restricted=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(ownerCookie,ownerCsrf),payload:{displayName:'Synthetic Restricted',rolePreset:'limited',displayIds:[],login:{email:'restricted@people.test.invalid',password:'Synthetic-restricted-pass-42'}}});
  assert.equal(restricted.statusCode,201,restricted.body);
  const restrictedLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'restricted@people.test.invalid',password:'Synthetic-restricted-pass-42'}});
  const restrictedAdmin=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(cookies(restrictedLogin),restrictedLogin.json().csrfToken),payload:{displayName:'Still must fail',rolePreset:'limited',displayIds:[]}});
  assert.equal(restrictedAdmin.statusCode,403);

  const ownerPeople=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:ownerCookie}});
  const ownerRow=ownerPeople.json().people.find((person:{display_name:string})=>person.display_name==='Synthetic Owner');
  const personRow=ownerPeople.json().people.find((person:{display_name:string})=>person.display_name==='Synthetic Person Only');
  assert.equal(personRow.birth_date,'2014-09-10');assert.equal(typeof personRow.calculated_age,'number');
  const edited=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/people/${personOnly.json().personId}`,headers:auth(ownerCookie,ownerCsrf),payload:{birthDate:'2014-09-11',expectedRevision:personRow.person_revision}});
  assert.equal(edited.statusCode,200,edited.body);assert.equal(edited.json().birth_date,'2014-09-11');
  const promotedProfile=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/memberships/${personOnly.json().membershipId}/account`,headers:auth(ownerCookie,ownerCsrf),payload:{rolePreset:'household_admin',capabilities:roleCapabilityPresets.household_admin,displayIds:[],expectedRevision:personRow.revision,login:{email:'promoted-admin@people.test.invalid',loginMethod:'invitation',locale:'nb',theme:'system'}}});
  assert.equal(promotedProfile.statusCode,201,promotedProfile.body);assert.match(promotedProfile.json().invitationToken,/^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:promotedProfile.json().invitationToken,password:'Synthetic-promoted-admin-42'}})).statusCode,200);
  const promotedLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'promoted-admin@people.test.invalid',password:'Synthetic-promoted-admin-42'}});
  assert.deepEqual((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:cookies(promotedLogin)}})).json().memberships[0].capabilities,roleCapabilityPresets.household_admin);
  const memberPeople=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/people`,headers:{cookie:memberCookie}});
  assert.ok(memberPeople.json().people.every((person:Record<string,unknown>)=>!('birth_date' in person) && person.email===null));

  const lastOwnerDemote=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerRow.membership_id}`,headers:auth(ownerCookie,ownerCsrf),payload:{rolePreset:'household_admin',capabilities:roleCapabilityPresets.household_admin,displayIds:[],expectedRevision:ownerRow.revision}});
  assert.equal(lastOwnerDemote.statusCode,409);assert.equal(lastOwnerDemote.json().error.details.reason,'last_installation_owner');
  const lastOwnerDisable=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/accounts/${ownerRow.account_id}`,headers:auth(ownerCookie,ownerCsrf),payload:{disabled:true,expectedRevision:ownerRow.account_revision}});
  assert.equal(lastOwnerDisable.statusCode,409);assert.equal(lastOwnerDisable.json().error.details.reason,'last_installation_owner');

  const otherOwnerHousehold=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,'Synthetic owner boundary','UTC','nb' FROM households WHERE id=$1 RETURNING id`,[householdId])).rows[0]!;
  const otherOwnerPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic cross-household owner','adult') RETURNING id`,[otherOwnerHousehold.id])).rows[0]!;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'installation_admin',$4)`,[otherOwnerHousehold.id,ownerRow.account_id,otherOwnerPerson.id,JSON.stringify(roleCapabilityPresets.installation_admin)]);
  const demotedHere=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/memberships/${ownerRow.membership_id}`,headers:auth(ownerCookie,ownerCsrf),payload:{rolePreset:'household_admin',capabilities:roleCapabilityPresets.household_admin,displayIds:[],expectedRevision:ownerRow.revision}});
  assert.equal(demotedHere.statusCode,200,demotedHere.body);
  const crossHouseholdDisable=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/accounts/${ownerRow.account_id}`,headers:auth(ownerCookie,ownerCsrf),payload:{disabled:true,expectedRevision:ownerRow.account_revision}});
  assert.equal(crossHouseholdDisable.statusCode,403);
  await pool.query(`UPDATE memberships SET role_preset='installation_admin',capabilities=$2,revision=revision+1 WHERE id=$1`,[ownerRow.membership_id,JSON.stringify(roleCapabilityPresets.installation_admin)]);
  await pool.query('DELETE FROM households WHERE id=$1',[otherOwnerHousehold.id]);

  const loneManagerHousehold=(await pool.query<{id:string;installation_id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,'Synthetic lone manager','UTC','nb' FROM households WHERE id=$1 RETURNING id,installation_id`,[householdId])).rows[0]!;
  const loneManagerPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic lone manager','adult') RETURNING id`,[loneManagerHousehold.id])).rows[0]!;
  const loneManagerHash=await hashPassword('Synthetic-lone-manager-42');
  const loneManagerAccount=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'lone-manager@people.test.invalid',$2,'nb','system') RETURNING id`,[loneManagerHousehold.installation_id,loneManagerHash])).rows[0]!;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4)`,[loneManagerHousehold.id,loneManagerAccount.id,loneManagerPerson.id,JSON.stringify(roleCapabilityPresets.household_admin)]);
  const loneManagerLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'lone-manager@people.test.invalid',password:'Synthetic-lone-manager-42'}});
  const loneManagerMe=await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:cookies(loneManagerLogin)}});
  const loneManagerDisable=await app.inject({method:'PATCH',url:`/api/v1/households/${loneManagerHousehold.id}/accounts/${loneManagerAccount.id}`,headers:auth(cookies(loneManagerLogin),loneManagerLogin.json().csrfToken),payload:{disabled:true,expectedRevision:1}});
  assert.equal(loneManagerDisable.statusCode,409);assert.equal(loneManagerDisable.json().error.details.reason,'last_household_manager');assert.equal(loneManagerMe.statusCode,200);

  const hidden=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/dashboard`,headers:{cookie:memberCookie}});assert.equal(hidden.json().upcomingBirthday,null);
  const settings=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/settings`,headers:{cookie:ownerCookie}});
  const enabled=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/settings`,headers:auth(ownerCookie,ownerCsrf),payload:{showUpcomingBirthday:true,expectedRevision:settings.json().revision}});assert.equal(enabled.statusCode,200,enabled.body);
  const birthday=await app.inject({method:'GET',url:`/api/v1/households/${householdId}/dashboard`,headers:{cookie:memberCookie}});
  assert.equal(typeof birthday.json().upcomingBirthday.displayName,'string');assert.equal('birthDate' in birthday.json().upcomingBirthday,false);
  const disabledBirthday=await app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/settings`,headers:auth(ownerCookie,ownerCsrf),payload:{showUpcomingBirthday:false,expectedRevision:enabled.json().revision}});assert.equal(disabledBirthday.statusCode,200,disabledBirthday.body);
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${householdId}/dashboard`,headers:{cookie:memberCookie}})).json().upcomingBirthday,null);

  const other=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,'Other synthetic','UTC','nb' FROM households WHERE id=$1 RETURNING id`,[householdId])).rows[0]!;
  assert.equal((await app.inject({method:'GET',url:`/api/v1/households/${other.id}/people`,headers:{cookie:ownerCookie}})).statusCode,404);

  const legacyHash=await hashPassword('old');
  await pool.query(`UPDATE accounts SET password_hash=$2 WHERE email_normalized=$1`,['restricted@people.test.invalid',legacyHash]);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'restricted@people.test.invalid',password:'old'}})).statusCode,200,'legacy short passwords remain valid at sign-in');

  const secondSession=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'owner@people.test.invalid',password}});
  assert.equal((await app.inject({method:'POST',url:'/api/v1/me/password',headers:auth(ownerCookie,ownerCsrf),payload:{currentPassword:password,newPassword:'NoNumberHere'}})).statusCode,400);
  const competingPasswords=['ConcurrentWinner1','ConcurrentWinner2'];
  const changes=await Promise.all(competingPasswords.map((newPassword)=>app.inject({method:'POST',url:'/api/v1/me/password',headers:auth(ownerCookie,ownerCsrf),payload:{currentPassword:password,newPassword}})));
  assert.deepEqual(changes.map((response)=>response.statusCode).sort(),[200,401]);
  const winnerIndex=changes.findIndex((response)=>response.statusCode===200);const loserIndex=winnerIndex===0?1:0;
  assert.ok(changes[winnerIndex]!.json().sessionsRevoked>=1);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/me',headers:{cookie:cookies(secondSession)}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'owner@people.test.invalid',password}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'owner@people.test.invalid',password:competingPasswords[winnerIndex]}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'owner@people.test.invalid',password:competingPasswords[loserIndex]}})).statusCode,401);

  // Household admins can manage people but cannot assign installation owner.
  const forbiddenOwner=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/people`,headers:auth(adminCookie,adminCsrf),payload:{displayName:'Forbidden owner',rolePreset:'installation_admin',confirmInstallationOwner:true,displayIds:[],login:{email:'forbidden-owner@people.test.invalid',loginMethod:'invitation'}}});
  assert.equal(forbiddenOwner.statusCode,403);
});

test('local bootstrap prepares a separate live household and disables source accounts only after verified owner acceptance',async()=>{
  const source=(await pool.query<{household_id:string}>(`SELECT m.household_id FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE a.email_normalized='owner@people.test.invalid'`)).rows[0]!;
  await assert.rejects(()=>runLocalBootstrap({phase:'prepare',operationKey:'reject-live-source-001',sourceHouseholdId:source.household_id,household:{name:'Must not replace live',timezone:'UTC',locale:'nb'},people:[{displayName:'Synthetic rejected owner',rolePreset:'installation_admin',email:'rejected-owner@people.test.invalid'}]}),(error:unknown)=>error instanceof Error && error.message==='CONFLICT');
  await pool.query(`UPDATE households SET data_kind='synthetic' WHERE id=$1`,[source.household_id]);
  const prepared=await runLocalBootstrap({phase:'prepare',operationKey:'synthetic-transition-001',sourceHouseholdId:source.household_id,household:{name:'Synthetic live household',timezone:'Europe/Oslo',locale:'nb',showUpcomingBirthday:true},people:[
    {displayName:'Synthetic New Owner',birthDate:'1988-02-29',rolePreset:'installation_admin',email:'new-owner@people.test.invalid'},
    {displayName:'Synthetic Child',birthDate:null,rolePreset:'limited'}
  ]}) as {status:string;liveHouseholdId:string;invitations:Array<{email:string;token:string;invitePath:string}>};
  assert.equal(prepared.status,'prepared');assert.equal(prepared.invitations.length,1);assert.match(prepared.invitations[0]!.invitePath,/^\/invitation#token=/);
  assert.equal((await pool.query<{data_kind:string}>('SELECT data_kind FROM households WHERE id=$1',[source.household_id])).rows[0]!.data_kind,'synthetic');
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM accounts a JOIN memberships m ON m.account_id=a.id WHERE m.household_id=$1 AND a.disabled_at IS NULL`,[source.household_id])).rows[0]!.count>0,true);
  const repeated=await runLocalBootstrap({phase:'prepare',operationKey:'synthetic-transition-001',sourceHouseholdId:source.household_id,household:{name:'Ignored repeat',timezone:'UTC',locale:'en'},people:[{displayName:'Ignored',rolePreset:'installation_admin',email:'ignored@people.test.invalid'}]}) as {idempotent:boolean;invitations:unknown[]};
  assert.equal(repeated.idempotent,true);assert.deepEqual(repeated.invitations,[]);
  await assert.rejects(()=>runLocalBootstrap({phase:'finalize',operationKey:'synthetic-transition-001',confirmDisableSourceAccounts:true}),(error:unknown)=>error instanceof Error && error.message==='CONFLICT');
  const rotated=await runLocalBootstrap({phase:'rotate',operationKey:'synthetic-transition-001',confirmRotateInvitations:true}) as {invitations:Array<{email:string;token:string;invitePath:string}>};
  assert.equal(rotated.invitations.length,1);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:prepared.invitations[0]!.token,password:'Synthetic-bootstrap-owner-42'}})).statusCode,410);
  const accepted=await app.inject({method:'POST',url:'/api/v1/auth/invitations/accept',payload:{token:rotated.invitations[0]!.token,password:'Synthetic-bootstrap-owner-42'}});assert.equal(accepted.statusCode,200,accepted.body);
  const newOwnerMembership=(await pool.query<{id:string;revision:number}>(`SELECT m.id,m.revision FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.household_id=$1 AND a.email_normalized='new-owner@people.test.invalid'`,[prepared.liveHouseholdId])).rows[0]!;
  const demoted=await app.inject({method:'PATCH',url:`/api/v1/households/${prepared.liveHouseholdId}/memberships/${newOwnerMembership.id}`,headers:auth(cookies(accepted),accepted.json().csrfToken),payload:{rolePreset:'household_admin',capabilities:roleCapabilityPresets.household_admin,displayIds:[],expectedRevision:newOwnerMembership.revision}});
  assert.equal(demoted.statusCode,200,demoted.body);
  await assert.rejects(()=>runLocalBootstrap({phase:'finalize',operationKey:'synthetic-transition-001',confirmDisableSourceAccounts:true}),(error:unknown)=>error instanceof Error && error.message==='CONFLICT');
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM accounts a JOIN memberships m ON m.account_id=a.id WHERE m.household_id=$1 AND a.disabled_at IS NULL`,[source.household_id])).rows[0]!.count>0,true);
  await pool.query(`UPDATE memberships SET role_preset='installation_admin',capabilities=$2,revision=revision+1 WHERE id=$1`,[newOwnerMembership.id,JSON.stringify(roleCapabilityPresets.installation_admin)]);
  const finalized=await runLocalBootstrap({phase:'finalize',operationKey:'synthetic-transition-001',confirmDisableSourceAccounts:true}) as {status:string;disabledSourceAccounts:number};
  assert.equal(finalized.status,'finalized');assert.ok(finalized.disabledSourceAccounts>0);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM accounts a JOIN memberships m ON m.account_id=a.id WHERE m.household_id=$1 AND a.disabled_at IS NULL`,[source.household_id])).rows[0]!.count,0);
  assert.equal((await pool.query<{data_kind:string;default_locale:string;show_upcoming_birthday:boolean}>('SELECT data_kind,default_locale,show_upcoming_birthday FROM households WHERE id=$1',[prepared.liveHouseholdId])).rows[0]!.data_kind,'live');
  const audit=await pool.query<{metadata:string}>(`SELECT metadata::text FROM audit_events WHERE action LIKE 'local_bootstrap.%'`);
  assert.ok(audit.rows.every((row)=>!row.metadata.includes(prepared.invitations[0]!.token)&&!row.metadata.includes(rotated.invitations[0]!.token)));
});
