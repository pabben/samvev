import assert from 'node:assert/strict';
import test from 'node:test';
import {passwordMeetsPolicy} from '../src/password-policy.ts';

test('client new-password policy mirrors server boundaries',()=>{
  assert.equal(passwordMeetsPolicy('Abcdef1'),false);
  assert.equal(passwordMeetsPolicy('abcdefg1'),false);
  assert.equal(passwordMeetsPolicy('Abcdefgh'),false);
  assert.equal(passwordMeetsPolicy('Abcdefg1'),true);
  assert.equal(passwordMeetsPolicy('Æbcdefg1'),true);
  assert.equal(passwordMeetsPolicy('A\u030Abcdef1'),false);
  assert.equal(passwordMeetsPolicy('A\u030Abcdefg1'),true);
  assert.equal(passwordMeetsPolicy('A1ﬃﬃ'),true);
  assert.equal(passwordMeetsPolicy(`${'A\u030A'.repeat(127)}1`),false);
  assert.equal(passwordMeetsPolicy(`A1${'ﬃ'.repeat(43)}`),false);
});
