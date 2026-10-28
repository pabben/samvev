import assert from 'node:assert/strict';
import test from 'node:test';
import {displayDisconnectSchema,displayReconnectApproveSchema,displayUpdateSchema} from './index.ts';

test('reconnect and disconnect contracts cannot select or alter another registration',()=>{
  assert.deepEqual(displayReconnectApproveSchema.parse({code:'123456',expectedCredentialGeneration:1}),{code:'123456',expectedCredentialGeneration:1});
  for(const value of [{code:'123456'},{code:'123456',expectedCredentialGeneration:0},{code:'123456',expectedCredentialGeneration:1,name:'replacement'},{code:'123456',expectedCredentialGeneration:1,setupId:'00000000-0000-4000-8000-000000000001'}])assert.equal(displayReconnectApproveSchema.safeParse(value).success,false);
  assert.deepEqual(displayDisconnectSchema.parse({}),{});assert.equal(displayDisconnectSchema.safeParse({displayId:'00000000-0000-4000-8000-000000000001'}).success,false);
});

test('display policy distinguishes inheritance, empty selection and explicit birthday consent',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  assert.deepEqual(displayUpdateSchema.parse({personIdsOverride:null}),{personIdsOverride:null});
  assert.deepEqual(displayUpdateSchema.parse({personIdsOverride:[]}),{personIdsOverride:[]});
  assert.deepEqual(displayUpdateSchema.parse({personIdsOverride:[id],birthdayMode:'all'}),{personIdsOverride:[id],birthdayMode:'all'});
  for(const value of [{personIdsOverride:[id,id]},{birthdayMode:'legacy_selected'},{birthdayMode:'off',birthdayPersonIds:[]},{personIdsOverride:Array.from({length:101},()=>id)}])assert.equal(displayUpdateSchema.safeParse(value).success,false);
});
