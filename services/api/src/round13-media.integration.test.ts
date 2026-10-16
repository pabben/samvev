import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import sharp from 'sharp';
import pg from 'pg';
import {opaqueToken,hashPassword,tokenHash} from '@samvev/core';
import {roleCapabilityPresets} from '@samvev/contracts';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';
import {normalizeMediaImage} from './media/image.ts';

interface Session{cookie:string;csrf:string;accountId:string;membershipId:string;personId:string;}
const origin='https://samvev-round13-media.test.invalid';
let app:FastifyInstance,householdId:string,owner:Session,child:Session,displayId:string,displayCookie:string,displaySetupId:string;
let normalizationCount=0;
let pauseNext=false,entered!:()=>void,release!:()=>void;
function cookie(response:LightMyRequestResponse):string{const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map((item)=>item.split(';')[0]).join('; ');}
function auth(session:Session){return{cookie:session.cookie,'x-csrf-token':session.csrf,origin};}
async function syntheticImage(){return(await sharp({create:{width:48,height:32,channels:3,background:{r:55,g:115,b:165}}}).png().toBuffer()).toString('base64');}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Round 13 Media refuses a non-isolated test database');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  const mediaImageNormalizer=async(value:string)=>{normalizationCount++;if(pauseNext){pauseNext=false;entered();await new Promise<void>(resolve=>release=resolve);}return normalizeMediaImage(value);};
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false},mediaImageNormalizer});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic media owner',email:'round13-media-owner@test.invalid',password:'Synthetic-media-owner-password-42'},household:{name:'Synthetic media household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;const ownerRow=(await pool.query<{account_id:string;person_id:string}>('SELECT account_id,person_id FROM memberships WHERE id=$1',[claim.json().membershipId])).rows[0]!;
  owner={cookie:cookie(claim),csrf:claim.json().csrfToken,accountId:ownerRow.account_id,membershipId:claim.json().membershipId,personId:ownerRow.person_id};
  const childPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic media child','child') RETURNING id`,[householdId])).rows[0]!;
  const childAccount=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) SELECT installation_id,'round13-media-child@test.invalid',$2,'en','light' FROM households WHERE id=$1 RETURNING id`,[householdId,await hashPassword('Synthetic-media-child-password-42')])).rows[0]!;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'member',$4) RETURNING id`,[householdId,childAccount.id,childPerson.id,JSON.stringify(roleCapabilityPresets.member)])).rows[0]!;
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'round13-media-child@test.invalid',password:'Synthetic-media-child-password-42'}});assert.equal(login.statusCode,200,login.body);
  child={cookie:cookie(login),csrf:login.json().csrfToken,accountId:childAccount.id,membershipId:membership.id,personId:childPerson.id};
  const setup=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,locale,theme,is_default) VALUES($1,'Synthetic media setup','en','light',true) RETURNING id`,[householdId])).rows[0]!;displaySetupId=setup.id;
  const token=opaqueToken();const display=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,locale,theme,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic media display','en','light',$2,$3,clock_timestamp()+interval '90 days') RETURNING id`,[householdId,setup.id,tokenHash(token)])).rows[0]!;displayId=display.id;displayCookie=`samvev_display=${token}`;
});
after(async()=>{await app.close();await pool.end();});

// Poll actual PostgreSQL lock waits rather than relying on a scheduling delay.
async function waitForBlockedQuery(fragment:string,count=1){
  const deadline=Date.now()+4_000;
  do{
    const rows=(await pool.query<{pid:number}>(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND position($1 in query)>0`,[fragment])).rows;
    if(rows.length>=count)return rows;
    await new Promise(resolve=>setTimeout(resolve,10));
  }while(Date.now()<deadline);
  assert.fail(`Expected ${count} blocked media queries containing ${fragment}`);
}
async function blocker(){const client=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:8_000});await client.connect();await client.query('BEGIN');return client;}
async function album(session:Session,name:string){const response=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/media/albums`,headers:auth(session),payload:{name,kind:'photos'}});assert.equal(response.statusCode,201,response.body);return response.json().id as string;}
async function upload(session:Session,albumId:string,title:string){const response=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/media/albums/${albumId}/assets`,headers:auth(session),payload:{title,description:'',imageBase64:await syntheticImage()}});assert.equal(response.statusCode,201,response.body);return response.json().asset as {id:string;revision:number;url:string};}
async function removeAlbum(session:Session,albumId:string){const revision=(await pool.query<{revision:number}>('SELECT revision FROM media_albums WHERE id=$1',[albumId])).rows[0]!.revision;const response=await app.inject({method:'DELETE',url:`/api/v1/households/${householdId}/media/albums/${albumId}`,headers:auth(session),payload:{expectedRevision:revision}});assert.equal(response.statusCode,200,response.body);}

// These actors deliberately differ: one actor's own session row lock must not
// serialize the concurrent operations and conceal the media lock ordering.
test('metadata and deletion obey quota-before-album lock ordering',async()=>{
  const base=`/api/v1/households/${householdId}/media`,albumId=await album(owner,'Synthetic metadata lock order');
  const edited=await upload(owner,albumId,'Synthetic retained asset'),deleted=await upload(owner,albumId,'Synthetic deleted asset');
  const grant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:1,membershipId:child.membershipId,householdWide:false,canRead:true,canUpload:false,canManage:true}});assert.equal(grant.statusCode,200,grant.body);
  const lock=await blocker();await lock.query('SELECT household_id FROM media_household_usage WHERE household_id=$1 FOR UPDATE',[householdId]);
  let deletion!:Promise<LightMyRequestResponse>,metadata!:Promise<LightMyRequestResponse>;
  try{
    deletion=app.inject({method:'DELETE',url:`${base}/assets/${deleted.id}`,headers:auth(child),payload:{expectedRevision:1}}).then(response=>response);
    await waitForBlockedQuery('media_household_usage');
    metadata=app.inject({method:'PATCH',url:`${base}/assets/${edited.id}`,headers:auth(owner),payload:{expectedRevision:1,title:'Synthetic edited title',description:'Synthetic updated description'}}).then(response=>response);
    // The old metadata path waited inside the asset trigger (its outer SQL was
    // UPDATE media_assets); do not require the repaired quota SELECT here.
    await waitForBlockedQuery('media_',2);
  }finally{await lock.query('ROLLBACK');await lock.end();}
  const [removed,updated]=await Promise.all([deletion,metadata]);assert.equal(removed.statusCode,200,removed.body);assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().revision,2);
  assert.equal((await pool.query<{title:string}>('SELECT title FROM media_assets WHERE id=$1',[edited.id])).rows[0]!.title,'Synthetic edited title');
  assert.equal((await pool.query('SELECT id FROM media_assets WHERE id=$1',[deleted.id])).rowCount,0);
  await removeAlbum(owner,albumId);
});

test('display bytes and album deletion lock setup before assets',async()=>{
  const base=`/api/v1/households/${householdId}/media`,albumId=await album(owner,'Synthetic display deletion lock order'),asset=await upload(owner,albumId,'Synthetic display image');
  const grant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:1,membershipId:child.membershipId,householdWide:false,canRead:true,canUpload:false,canManage:true}});assert.equal(grant.statusCode,200,grant.body);
  await pool.query(`UPDATE display_setups SET cards='["photos"]'::jsonb,album_ids=$2::jsonb WHERE id=$1`,[displaySetupId,JSON.stringify([albumId])]);
  const displayGrant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/displays/${displayId}`,headers:auth(owner),payload:{expectedRevision:null,canRead:true,canUpload:false}});assert.equal(displayGrant.statusCode,200,displayGrant.body);
  const lock=await blocker();await lock.query('SELECT id FROM display_setups WHERE id=$1 FOR UPDATE',[displaySetupId]);
  let deletion!:Promise<LightMyRequestResponse>,read!:Promise<LightMyRequestResponse>;
  try{
    deletion=app.inject({method:'DELETE',url:`${base}/albums/${albumId}`,headers:auth(child),payload:{expectedRevision:2}}).then(response=>response);
    await waitForBlockedQuery('UPDATE display_setups SET album_ids');
    read=app.inject({method:'GET',url:`/api/v1/display/media/assets/${asset.id}/master?v=1`,headers:{cookie:displayCookie}}).then(response=>response);
    await waitForBlockedQuery('display_setups',2);
  }finally{await lock.query('ROLLBACK');await lock.end();}
  const [removed,bytes]=await Promise.all([deletion,read]);assert.equal(removed.statusCode,200,removed.body);assert.equal(bytes.statusCode,404,bytes.body);
  assert.equal((await pool.query('SELECT id FROM media_assets WHERE album_id=$1',[albumId])).rowCount,0);
  assert.deepEqual((await pool.query<{album_ids:string[]}>('SELECT album_ids FROM display_setups WHERE id=$1',[displaySetupId])).rows[0]!.album_ids,[]);
});

test('member image responses reject session expiry after album lock waits, including conditional GET',async()=>{
  const albumId=await album(child,'Synthetic expiry images'),asset=await upload(child,albumId,'Synthetic expiry image');
  const initial=await app.inject({method:'GET',url:asset.url,headers:auth(child)});assert.equal(initial.statusCode,200,initial.body);
  for(const conditional of [false,true]){
    const token=opaqueToken(),csrf=opaqueToken();const session=(await pool.query<{id:string}>(`INSERT INTO sessions(account_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1500 milliseconds') RETURNING id`,[child.accountId,tokenHash(token),tokenHash(csrf)])).rows[0]!;
    const lock=await blocker();await lock.query('SELECT id FROM media_albums WHERE id=$1 FOR UPDATE',[albumId]);
    let response!:Promise<LightMyRequestResponse>;
    try{
      response=app.inject({method:'GET',url:asset.url,headers:{cookie:`samvev_session=${token}`,...(conditional?{'if-none-match':String(initial.headers.etag)}:{})}}).then(value=>value);
      await waitForBlockedQuery('FROM media_albums album');
      const deadline=Date.now()+4_000;let expired=false;
      do{expired=(await pool.query<{expired:boolean}>('SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE id=$1',[session.id])).rows[0]!.expired;if(!expired)await new Promise(resolve=>setTimeout(resolve,20));}while(!expired&&Date.now()<deadline);
      assert.equal(expired,true,'session must expire while the asset request is blocked');
    }finally{await lock.query('ROLLBACK');await lock.end();}
    const result=await response;assert.equal(result.statusCode,401,result.body);assert.equal(result.headers.etag,undefined,'expired actors receive no conditional image response');
  }
  await removeAlbum(child,albumId);
});

test('concurrent uploads compete atomically for the last quota slot',async()=>{
  const base=`/api/v1/households/${householdId}/media`,ownerAlbum=await album(owner,'Synthetic owner quota images'),childAlbum=await album(child,'Synthetic child quota images');
  assert.equal((await pool.query<{asset_count:number}>('SELECT asset_count FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0]!.asset_count,0);
  await pool.query('UPDATE media_household_usage SET max_assets=1 WHERE household_id=$1',[householdId]);
  const lock=await blocker();await lock.query('SELECT household_id FROM media_household_usage WHERE household_id=$1 FOR UPDATE',[householdId]);
  let requests!:Promise<LightMyRequestResponse>[];
  try{
    const image=await syntheticImage();requests=[[owner,ownerAlbum],[child,childAlbum]].map(([session,id])=>app.inject({method:'POST',url:`${base}/albums/${id}/assets`,headers:auth(session as Session),payload:{title:'Synthetic final-slot contender',description:'',imageBase64:image}}).then(response=>response));
    await waitForBlockedQuery('media_household_usage',2);
  }finally{await lock.query('ROLLBACK');await lock.end();}
  const results=await Promise.all(requests);assert.deepEqual(results.map(response=>response.statusCode).sort(),[201,413],results.map(response=>response.body).join('\n'));
  const actual=(await pool.query<{count:number;bytes:string}>('SELECT count(*)::int AS count,COALESCE(sum(stored_bytes),0)::text AS bytes FROM media_assets WHERE household_id=$1',[householdId])).rows[0]!;
  const usage=(await pool.query<{asset_count:number;stored_bytes:string}>('SELECT asset_count,stored_bytes::text FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0]!;assert.deepEqual(usage,{asset_count:1,stored_bytes:actual.bytes});assert.equal(actual.count,1);
  await removeAlbum(owner,ownerAlbum);await removeAlbum(child,childAlbum);await pool.query('UPDATE media_household_usage SET max_assets=250 WHERE household_id=$1',[householdId]);
});

test('device credential rotation during normalization prevents upload commit',async()=>{
  const base=`/api/v1/households/${householdId}/media`,albumId=await album(owner,'Synthetic rotated credential images');
  await pool.query(`UPDATE display_setups SET cards='["photos"]'::jsonb,album_ids=$2::jsonb WHERE id=$1`,[displaySetupId,JSON.stringify([albumId])]);
  const grant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/displays/${displayId}`,headers:auth(owner),payload:{expectedRevision:null,canRead:true,canUpload:true}});assert.equal(grant.statusCode,200,grant.body);
  await pool.query('UPDATE display_action_policies SET photo_upload=true WHERE household_id=$1 AND display_id=$2',[householdId,displayId]);
  const enteredPromise=new Promise<void>(resolve=>entered=resolve);pauseNext=true;
  const request=app.inject({method:'POST',url:`/api/v1/display/media/albums/${albumId}/assets`,headers:{cookie:displayCookie,origin},payload:{title:'Synthetic stale credential upload',description:'',imageBase64:await syntheticImage()}}).then(response=>response);
  await enteredPromise;
  const replacementToken=opaqueToken();try{await pool.query('UPDATE displays SET credential_hash=$2 WHERE id=$1',[displayId,tokenHash(replacementToken)]);}finally{release();}
  const result=await request;assert.equal(result.statusCode,401,result.body);assert.equal((await pool.query('SELECT id FROM media_assets WHERE album_id=$1',[albumId])).rowCount,0);
  assert.deepEqual((await pool.query('SELECT asset_count,stored_bytes::text FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0],{asset_count:0,stored_bytes:'0'});
  displayCookie=`samvev_display=${replacementToken}`;await pool.query('UPDATE display_action_policies SET photo_upload=false WHERE household_id=$1 AND display_id=$2',[householdId,displayId]);await removeAlbum(owner,albumId);
});

test('household administrator cannot read, decode replacements or share another creator private album',async()=>{
  const base=`/api/v1/households/${householdId}/media`,albumId=await album(child,'Synthetic creator private images'),asset=await upload(child,albumId,'Synthetic creator private image');
  const albums=await app.inject({method:'GET',url:`${base}/albums`,headers:auth(owner)});assert.ok(!albums.json().albums.some((item:{id:string})=>item.id===albumId));
  assert.equal((await app.inject({method:'GET',url:asset.url,headers:auth(owner)})).statusCode,404);
  const count=normalizationCount;
  const replaced=await app.inject({method:'PUT',url:`${base}/assets/${asset.id}`,headers:auth(owner),payload:{expectedRevision:1,title:'Synthetic unauthorized replacement',description:'',imageBase64:await syntheticImage()}});assert.equal(replaced.statusCode,404,replaced.body);assert.equal(normalizationCount,count,'unauthorized replacement must be rejected before decoder entry');
  const memberGrant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:1,membershipId:owner.membershipId,householdWide:false,canRead:true,canUpload:true,canManage:true}});assert.equal(memberGrant.statusCode,403,memberGrant.body);
  const deviceGrant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/displays/${displayId}`,headers:auth(owner),payload:{expectedRevision:null,canRead:true,canUpload:true}});assert.equal(deviceGrant.statusCode,403,deviceGrant.body);
  assert.equal((await pool.query('SELECT id FROM media_album_grants WHERE album_id=$1',[albumId])).rowCount,0);assert.equal((await pool.query('SELECT display_id FROM media_album_display_grants WHERE album_id=$1',[albumId])).rowCount,0);
  const missing=await app.inject({method:'PUT',url:`${base}/assets/00000000-0000-4000-8000-000000000001`,headers:auth(owner),payload:{expectedRevision:1,title:'Synthetic missing replacement',description:'',imageBase64:await syntheticImage()}});assert.equal(missing.statusCode,404,missing.body);assert.equal(normalizationCount,count,'missing assets must be rejected before decoder entry');
  await removeAlbum(child,albumId);
});

test('private media grants, quota accounting, display scopes, cache rechecks and post-normalization revocation',async()=>{
  const base=`/api/v1/households/${householdId}/media`,image=await syntheticImage();
  const created=await app.inject({method:'POST',url:`${base}/albums`,headers:auth(owner),payload:{name:'Synthetic private photos',kind:'photos'}});assert.equal(created.statusCode,201,created.body);const albumId=created.json().id;
  assert.deepEqual((await app.inject({method:'GET',url:`${base}/albums`,headers:auth(child)})).json().albums,[],'albums default to private');
  const hiddenUpload=await app.inject({method:'POST',url:`${base}/albums/${albumId}/assets`,headers:auth(child),payload:{title:'Synthetic image',description:'',imageBase64:image}});assert.equal(hiddenUpload.statusCode,404);
  const grant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:1,membershipId:child.membershipId,householdWide:false,canRead:true,canUpload:true,canManage:false}});assert.equal(grant.statusCode,200,grant.body);
  assert.equal((await app.inject({method:'GET',url:`${base}/albums`,headers:auth(child)})).json().albums[0].permissions.upload,true);

  let enteredResolve!:()=>void;const enteredPromise=new Promise<void>(resolve=>enteredResolve=resolve);entered=enteredResolve;
  pauseNext=true;
  const inFlight=app.inject({method:'POST',url:`${base}/albums/${albumId}/assets`,headers:auth(child),payload:{title:'Must not survive revoke',description:'',imageBase64:image}});
  await enteredPromise;
  const revoked=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:2,membershipId:child.membershipId,householdWide:false,canRead:false,canUpload:false,canManage:false,revoke:true}});assert.equal(revoked.statusCode,200,revoked.body);
  release();assert.equal((await inFlight).statusCode,404,'authorization is rechecked after image normalization');
  assert.equal((await pool.query<{asset_count:number}>('SELECT asset_count FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0]!.asset_count,0);

  const restored=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:3,membershipId:child.membershipId,householdWide:false,canRead:true,canUpload:true,canManage:false}});assert.equal(restored.statusCode,200,restored.body);
  const uploaded=await app.inject({method:'POST',url:`${base}/albums/${albumId}/assets`,headers:auth(child),payload:{title:'Synthetic family photo',description:'Synthetic image for isolated test',imageBase64:image}});assert.equal(uploaded.statusCode,201,uploaded.body);const asset=uploaded.json().asset;
  const bytesUrl=`${base}/assets/${asset.id}/master?v=${asset.revision}`;
  const bytes=await app.inject({method:'GET',url:bytesUrl,headers:auth(owner)});assert.equal(bytes.statusCode,200);assert.equal(bytes.headers['content-type'],'image/webp');assert.match(String(bytes.headers['cache-control']),/private, no-store/);
  const notModified=await app.inject({method:'GET',url:bytesUrl,headers:{...auth(owner),'if-none-match':String(bytes.headers.etag)}});assert.equal(notModified.statusCode,304);
  assert.equal((await app.inject({method:'GET',url:bytesUrl,headers:auth(child)})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:bytesUrl,headers:{...auth(child),'if-none-match':String(bytes.headers.etag)}})).statusCode,304);
  const memberRevoke=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/grants`,headers:auth(owner),payload:{expectedRevision:4,membershipId:child.membershipId,householdWide:false,canRead:false,canUpload:false,canManage:false,revoke:true}});assert.equal(memberRevoke.statusCode,200,memberRevoke.body);
  assert.equal((await app.inject({method:'GET',url:bytesUrl,headers:{...auth(child),'if-none-match':String(bytes.headers.etag)}})).statusCode,404,'member access is rechecked before conditional responses');
  const storedBefore=(await pool.query<{stored_bytes:string}>('SELECT stored_bytes::text FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0]!.stored_bytes;assert.ok(Number(storedBefore)>0);

  await pool.query(`UPDATE display_setups SET cards='["photos"]'::jsonb,card_order='["photos"]'::jsonb,album_ids=$3::jsonb WHERE household_id=$1 AND id=$2`,[householdId,displaySetupId,JSON.stringify([albumId])]);
  const noImplicitGrant=await app.inject({method:'GET',url:'/api/v1/display/media',headers:{cookie:displayCookie}});assert.equal(noImplicitGrant.statusCode,200);assert.deepEqual(noImplicitGrant.json().assets,[],'setup selection does not grant a device access');
  const displayGrant=await app.inject({method:'PUT',url:`${base}/albums/${albumId}/displays/${displayId}`,headers:auth(owner),payload:{expectedRevision:null,canRead:true,canUpload:true}});assert.equal(displayGrant.statusCode,200,displayGrant.body);
  const projection=await app.inject({method:'GET',url:'/api/v1/display/media',headers:{cookie:displayCookie}});assert.equal(projection.statusCode,200);assert.equal(projection.json().assets.length,1);
  const displayBytes=await app.inject({method:'GET',url:projection.json().assets[0].url,headers:{cookie:displayCookie}});assert.equal(displayBytes.statusCode,200);
  const noAction=await app.inject({method:'POST',url:`/api/v1/display/media/albums/${albumId}/assets`,headers:{cookie:displayCookie,origin},payload:{title:'No policy',description:'',imageBase64:image}});assert.equal(noAction.statusCode,403,noAction.body);
  await pool.query('UPDATE display_action_policies SET photo_upload=true WHERE household_id=$1 AND display_id=$2',[householdId,displayId]);
  const displayUpload=await app.inject({method:'POST',url:`/api/v1/display/media/albums/${albumId}/assets`,headers:{cookie:displayCookie,origin},payload:{title:'Synthetic display upload',description:'',imageBase64:image}});assert.equal(displayUpload.statusCode,201,displayUpload.body);
  await app.inject({method:'PUT',url:`${base}/albums/${albumId}/displays/${displayId}`,headers:auth(owner),payload:{expectedRevision:1,canRead:false,canUpload:false,revoke:true}});
  assert.equal((await app.inject({method:'GET',url:projection.json().assets[0].url,headers:{cookie:displayCookie,'if-none-match':String(displayBytes.headers.etag)}})).statusCode,404,'display ACL is checked before conditional response');

  await pool.query('UPDATE media_household_usage SET max_assets=1 WHERE household_id=$1',[householdId]);
  assert.equal((await app.inject({method:'POST',url:`${base}/albums/${albumId}/assets`,headers:auth(owner),payload:{title:'Quota denied',description:'',imageBase64:image}})).statusCode,413);
  const deleted=await app.inject({method:'DELETE',url:`${base}/assets/${asset.id}`,headers:auth(owner),payload:{expectedRevision:asset.revision}});assert.equal(deleted.statusCode,200,deleted.body);
  const usage=(await pool.query<{asset_count:number;stored_bytes:string}>('SELECT asset_count,stored_bytes::text FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0]!;assert.deepEqual(usage,{asset_count:1,stored_bytes:String(Number(storedBefore))},'trigger accounting covers insert/delete including display-created assets');
  assert.equal((await app.inject({method:'GET',url:bytesUrl,headers:auth(owner)})).statusCode,404);
  const removedAlbum=await app.inject({method:'DELETE',url:`${base}/albums/${albumId}`,headers:auth(owner),payload:{expectedRevision:5}});assert.equal(removedAlbum.statusCode,200,removedAlbum.body);
  assert.deepEqual((await pool.query<{asset_count:number;stored_bytes:string}>('SELECT asset_count,stored_bytes::text FROM media_household_usage WHERE household_id=$1',[householdId])).rows[0],{asset_count:0,stored_bytes:'0'},'asset-delete cascades reconcile usage counters');

  const backgrounds=await app.inject({method:'POST',url:`${base}/albums`,headers:auth(owner),payload:{name:'Synthetic private backgrounds',kind:'backgrounds'}});assert.equal(backgrounds.statusCode,201,backgrounds.body);const backgroundAlbumId=backgrounds.json().id;
  const backgroundUpload=await app.inject({method:'POST',url:`${base}/albums/${backgroundAlbumId}/assets`,headers:auth(owner),payload:{title:'Synthetic backdrop',description:'',imageBase64:image}});assert.equal(backgroundUpload.statusCode,201,backgroundUpload.body);const backgroundAsset=backgroundUpload.json().asset;
  const selected=await app.inject({method:'PUT',url:`${base}/background`,headers:auth(owner),payload:{expectedRevision:1,assetId:backgroundAsset.id}});assert.equal(selected.statusCode,200,selected.body);
  assert.ok((await app.inject({method:'GET',url:`${base}/background`,headers:auth(owner)})).json().background);
  assert.equal((await app.inject({method:'GET',url:`${base}/background`,headers:auth(child)})).json().background,null,'household background selection does not share its private source album');
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/media',headers:{cookie:displayCookie}})).json().householdBackground,null,'household selection alone does not grant the display access');
  const backgroundDisplayGrant=await app.inject({method:'PUT',url:`${base}/albums/${backgroundAlbumId}/displays/${displayId}`,headers:auth(owner),payload:{expectedRevision:null,canRead:true,canUpload:false}});assert.equal(backgroundDisplayGrant.statusCode,200,backgroundDisplayGrant.body);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/media',headers:{cookie:displayCookie}})).json().householdBackground.id,backgroundAsset.id);
  await pool.query(`UPDATE displays SET credential_hash=$2 WHERE id=$1`,[displayId,tokenHash(opaqueToken())]);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/display/media',headers:{cookie:displayCookie}})).statusCode,401,'a stale device credential cannot read a previously valid projection');

  const installationId=(await pool.query<{id:string}>('SELECT installation_id AS id FROM households WHERE id=$1',[householdId])).rows[0]!.id;
  const other=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic other household','UTC','en') RETURNING id`,[installationId])).rows[0]!;
  const otherPerson=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic other person','adult') RETURNING id`,[other.id])).rows[0]!;
  await pool.query(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'member',$4)`,[other.id,child.accountId,otherPerson.id,JSON.stringify(roleCapabilityPresets.member)]);
  const crossHousehold=await app.inject({method:'GET',url:`/api/v1/households/${other.id}/media/assets/${backgroundAsset.id}/master?v=1`,headers:auth(child)});assert.equal(crossHousehold.statusCode,404,'a second household membership cannot expose a foreign household asset');
});
