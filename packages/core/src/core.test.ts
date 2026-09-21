import assert from 'node:assert/strict';
import test from 'node:test';
import { DUMMY_LOGIN_PASSWORD_HASH, DomainError, hashPassword, initialMessageState, lifecycleAction, requireCapability, verifyLoginPassword, verifyPassword } from './index.ts';

test('scrypt passwords verify without accepting a different password', async () => {
  const encoded = await hashPassword('Synthetic-passphrase-42');
  assert.equal(await verifyPassword('Synthetic-passphrase-42', encoded), true);
  assert.equal(await verifyPassword('wrong-passphrase', encoded), false);
  assert.match(encoded, /^scrypt\$32768\$/);
});

test('unknown and disabled login candidates use the fixed valid scrypt path and fail closed', async () => {
  assert.equal(await verifyPassword('Samvev fixed dummy login password',DUMMY_LOGIN_PASSWORD_HASH),true);
  assert.equal(await verifyLoginPassword('any password',undefined,true),false);
  const valid=await hashPassword('Synthetic-valid-login-42');
  assert.equal(await verifyLoginPassword('Synthetic-valid-login-42',valid,false),false);
  assert.equal(await verifyLoginPassword('Synthetic-valid-login-42',valid,true),true);
});

test('permission and lifecycle rules are explicit', () => {
  assert.throws(() => requireCapability(['household.view'], 'display.manage'), (error) => error instanceof DomainError && error.code === 'FORBIDDEN');
  const now = new Date('2026-09-06T07:00:00Z');
  assert.equal(initialMessageState(new Date('2026-09-06T08:00:00Z'), new Date('2026-09-06T09:00:00Z'), now), 'scheduled');
  assert.equal(lifecycleAction('scheduled', new Date('2026-09-06T06:00:00Z'), new Date('2026-09-06T06:30:00Z'), now), 'expire');
});
