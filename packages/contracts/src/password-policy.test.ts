import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimSchema, invitationAcceptSchema, loginSchema, passwordChangeSchema,
  passwordSchema, personAccountCreateSchema, personCreateSchema
} from './index.ts';

const valid='Abcdefg1';

test('new-password policy rejects weak boundaries and accepts passwords without special characters',()=>{
  assert.equal(passwordSchema.safeParse('Abcdef1').success,false,'seven characters');
  assert.equal(passwordSchema.safeParse('abcdefg1').success,false,'uppercase required');
  assert.equal(passwordSchema.safeParse('Abcdefgh').success,false,'number required');
  assert.equal(passwordSchema.safeParse(valid).success,true,'special characters are optional');
  assert.equal(passwordSchema.safeParse('Æbcdefg1').success,true,'Unicode uppercase is supported');
  assert.equal(passwordSchema.safeParse('A\u030Abcdef1').success,false,'raw length eight can normalize below minimum');
  const composed=passwordSchema.parse('A\u030Abcdefg1');
  assert.equal(composed,'Åbcdefg1','schema output is NFKC normalized');
  assert.equal(passwordSchema.safeParse('A1ﬃﬃ').success,true,'raw input below eight may expand to the valid normalized minimum');
  assert.equal(passwordSchema.safeParse(`${'A\u030A'.repeat(127)}1`).success,false,'raw input above 128 is rejected even if it composes to the normalized maximum');
  assert.equal(passwordSchema.safeParse(`A1${'ﬃ'.repeat(43)}`).success,false,'compatibility expansion beyond normalized maximum is rejected');
});

test('shared policy covers setup, person login, account attachment, invitation and password change',()=>{
  const claim={claimToken:'x'.repeat(32),owner:{displayName:'Synthetic Owner',email:'owner@test.invalid',password:valid},household:{name:'Synthetic',timezone:'UTC'},preferences:{theme:'system'}};
  assert.equal(claimSchema.safeParse(claim).success,true);
  assert.equal(claimSchema.safeParse({...claim,owner:{...claim.owner,password:'abcdefg1'}}).success,false);
  const login={email:'member@test.invalid',loginMethod:'password' as const,password:valid};
  assert.equal(personCreateSchema.safeParse({displayName:'Synthetic Member',rolePreset:'member',displayIds:[],login}).success,true);
  assert.equal(personAccountCreateSchema.safeParse({login,rolePreset:'member',displayIds:[],expectedRevision:1}).success,true);
  assert.equal(personAccountCreateSchema.safeParse({login:{...login,password:'Abcdefgh'},rolePreset:'member',displayIds:[],expectedRevision:1}).success,false);
  assert.equal(invitationAcceptSchema.safeParse({token:'t'.repeat(32),password:valid}).success,true);
  assert.equal(invitationAcceptSchema.safeParse({token:'t'.repeat(32),password:'abcdefg1'}).success,false);
  assert.equal(passwordChangeSchema.safeParse({currentPassword:'legacy',newPassword:valid}).success,true);
  assert.equal(passwordChangeSchema.safeParse({currentPassword:'legacy',newPassword:'Abcdefgh'}).success,false);
});

test('sign-in accepts existing passwords without applying the new-password policy',()=>{
  assert.equal(loginSchema.safeParse({email:'legacy@test.invalid',password:'old'}).success,true);
});
