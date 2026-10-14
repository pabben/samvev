import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyVisibleImage, protectedPhotoEvidence } from './design-review-assets.mjs';

const base = 'http://192.168.0.220:4173';
const household = '11111111-1111-4111-8111-111111111111';
const person = '22222222-2222-4222-8222-222222222222';
const photo = `/api/v1/households/${household}/people/${person}/photo/96?v=3`;

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
