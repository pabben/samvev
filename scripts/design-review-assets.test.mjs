import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyVisibleImage, protectedPhotoEvidence, protectedMediaAssetEvidence, publicProtectedPhotoEvidence, publicProtectedMediaAssetEvidence, validatePublicPhotoEvidence } from './design-review-assets.mjs';

const base = 'http://192.168.0.220:4173';
const household = '11111111-1111-4111-8111-111111111111';
const person = '22222222-2222-4222-8222-222222222222';
const photo = `/api/v1/households/${household}/people/${person}/photo/96?v=3`;
const asset = '33333333-3333-4333-8333-333333333333';
const media = `/api/v1/households/${household}/media/assets/${asset}/preview?v=2`;

test('keeps static assets bound to the hashed dist proof', () => {
  assert.deepEqual(classifyVisibleImage('/assets/avatar-01.svg', base), { kind: 'static', path: '/assets/avatar-01.svg' });
  assert.throws(() => classifyVisibleImage('/assets/avatar-01.svg?cache=1', base), /unexpected query/);
});

test('records only current authorized protected-photo bytes without a credential or secret query', () => {
  const image = classifyVisibleImage(photo, base);
  assert.deepEqual(image, { kind: 'protected-photo', path: photo.split('?')[0], version: 3, key: photo });
  const evidence = protectedPhotoEvidence({ image, status: 200, contentType: 'image/webp; charset=binary', bytes: Buffer.from('synthetic-webp') });
  assert.deepEqual(evidence, { route: '/api/v1/households/:householdId/people/:personId/photo/96', pathSha256: '2d7a5a5d257b9ed815a50dadeea81ea0aece4cbce90b32f6a81941ebe2d48cfc', version: 3, status: 200, contentType: 'image/webp', bytes: 14, sha256: '0ce6f8c398602d6806ab08c83f778eb121339007b91b5c2b4a8ac640c71a175c' });
});

test('rejects unverified, unauthorized or malformed dynamic images', () => {
  const image = classifyVisibleImage(photo, base);
  assert.throws(() => protectedPhotoEvidence({ image, status: 401, contentType: 'application/json', bytes: Buffer.from('{}') }), /HTTP 401/);
  assert.throws(() => protectedPhotoEvidence({ image, status: 200, contentType: 'image/jpeg', bytes: Buffer.from('jpeg') }), /content type/);
  assert.throws(() => classifyVisibleImage(`/api/v1/households/${household}/people/${person}/photo/96?v=3&token=no`, base), /exactly one/);
  assert.throws(() => classifyVisibleImage('https://outside.example/avatar.png', base), /unexpected origin/);
});

test('public manifest excludes photo content/path fingerprints and byte lengths but private proof retains them',()=>{
 const privateEvidence=protectedPhotoEvidence({image:classifyVisibleImage(photo,base),status:200,contentType:'image/webp',bytes:Buffer.from('synthetic-webp')});
 assert.match(privateEvidence.sha256,/^[a-f0-9]{64}$/);assert.match(privateEvidence.pathSha256,/^[a-f0-9]{64}$/);
 const published=publicProtectedPhotoEvidence(privateEvidence);
 assert.deepEqual(published,{route:'/api/v1/households/:householdId/people/:personId/photo/96',version:3,status:200,contentType:'image/webp'});
 assert.doesNotThrow(()=>validatePublicPhotoEvidence([published]));
 assert.throws(()=>validatePublicPhotoEvidence([privateEvidence]),/private or unsupported/);
 for(const key of ['sha256','pathSha256','bytes','personId'])assert.throws(()=>validatePublicPhotoEvidence([{...published,[key]:'forbidden'}]),/private or unsupported/);
});

test('classifies only versioned household media preview/master routes and records private bytes',()=>{
 const image=classifyVisibleImage(media,base);
 assert.deepEqual(image,{kind:'protected-media-asset',path:media.split('?')[0],variant:'preview',version:2,key:media});
 const master=classifyVisibleImage(media.replace('/preview?','/master?'),base);
 assert.equal(master.variant,'master');
 const evidence=protectedMediaAssetEvidence({image,status:200,contentType:'image/webp; charset=binary',bytes:Buffer.from('synthetic-media-webp')});
 assert.equal(evidence.route,'/api/v1/households/:householdId/media/assets/:assetId/:variant');
 assert.equal(evidence.variant,'preview');assert.equal(evidence.version,2);assert.equal(evidence.contentType,'image/webp');
 assert.match(evidence.sha256,/^[a-f0-9]{64}$/);assert.match(evidence.pathSha256,/^[a-f0-9]{64}$/);assert.ok(evidence.bytes>0);
});

test('rejects private media routes with bad IDs, variants, query parameters, MIME or authorization status',()=>{
 for(const path of [
  `/api/v1/households/${household}/media/assets/not-a-uuid/preview?v=1`,
  `/api/v1/households/${household}/media/assets/${asset}/original?v=1`,
  `/api/v1/households/${household}/displays/${person}/preview/assets/${asset}/preview?v=1&s=synthetic`,
  `/api/v1/display/media/assets/${asset}/preview?v=1`,
 ])assert.throws(()=>classifyVisibleImage(path,base),/neither a verified/);
 for(const suffix of ['?v=0','?v=-1','?v=1&token=secret','#fragment','?v=1#fragment'])assert.throws(()=>classifyVisibleImage(`/api/v1/households/${household}/media/assets/${asset}/preview${suffix}`,base),/query parameter|fragment/);
 assert.throws(()=>classifyVisibleImage(`/api/v1/households/${household}/media/assets/${asset}/preview?v=9007199254740992`,base),/safe positive integer/);
 const image=classifyVisibleImage(media,base);
 assert.throws(()=>protectedMediaAssetEvidence({image,status:401,contentType:'application/json',bytes:Buffer.from('{}')}),/HTTP 401/);
 assert.throws(()=>protectedMediaAssetEvidence({image,status:200,contentType:'image/jpeg',bytes:Buffer.from('jpeg')}),/content type/);
 assert.throws(()=>protectedMediaAssetEvidence({image,status:200,contentType:'image/webp',bytes:Buffer.alloc(0)}),/empty/);
 assert.throws(()=>classifyVisibleImage(`https://outside.example${media}`,base),/unexpected origin/);
});

test('public image evidence templates household and asset IDs and rejects private hashes',()=>{
 const privateEvidence=protectedMediaAssetEvidence({image:classifyVisibleImage(media,base),status:200,contentType:'image/webp',bytes:Buffer.from('synthetic-media-webp')});
 const published=publicProtectedMediaAssetEvidence(privateEvidence);
 assert.deepEqual(published,{route:'/api/v1/households/:householdId/media/assets/:assetId/:variant',variant:'preview',version:2,status:200,contentType:'image/webp'});
 assert.doesNotThrow(()=>validatePublicPhotoEvidence([published]));
 assert.throws(()=>validatePublicPhotoEvidence([privateEvidence]),/private or unsupported/);
 for(const key of ['sha256','pathSha256','bytes','householdId','assetId','url'])assert.throws(()=>validatePublicPhotoEvidence([{...published,[key]:'forbidden'}]),/private or unsupported/);
 assert.throws(()=>publicProtectedMediaAssetEvidence({...published,route:`/api/v1/households/${household}/media/assets/${asset}/preview`}),/Invalid protected-media/);
 assert.throws(()=>publicProtectedMediaAssetEvidence({...published,variant:'secret'}),/Invalid protected-media/);
});
