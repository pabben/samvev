import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '@samvev/core';
import type { DbClient } from '../db.ts';
import { deriveAgeGroup, localDateInTimezone } from './domain.ts';
import { updatePersonProfile } from './profile-service.ts';

const householdId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',personId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fakeClient(options:{personExists?:boolean;updateSucceeds?:boolean}={}){
  const calls:Array<{sql:string;values?:unknown[]}> = [];
  const client={async query(sql:string,values?:unknown[]){
    calls.push({sql,values});
    if(sql.includes('SELECT timezone FROM households'))return{rows:[{timezone:'Europe/Oslo'}],rowCount:1};
    if(sql.includes('SELECT birth_date::text,age_group FROM persons'))return options.personExists===false?{rows:[],rowCount:0}:{rows:[{birth_date:'2015-01-01',age_group:'child'}],rowCount:1};
    if(sql.includes('UPDATE persons SET display_name='))return options.updateSucceeds===false?{rows:[],rowCount:0}:{rows:[{id:personId,displayName:'Synthetic updated person',avatarKey:'avatar-02',colorToken:'blue',birth_date:'2008-11-24',age_group:'adult',revision:2}],rowCount:1};
    throw new Error(`Unexpected profile SQL: ${sql}`);
  }} as unknown as DbClient;
  return{client,calls};
}

test('shared profile service preserves the profile field map, local age derivation, CAS and actor audit hook',async()=>{
  const fake=fakeClient(),auditCalls:Array<{personId:string;fields:string[]}> = [];
  const result=await updatePersonProfile(fake.client,householdId,personId,{displayName:'Synthetic updated person',avatarKey:'avatar-02',colorToken:'blue',birthDate:'2008-11-24',expectedRevision:1},async(_client,id,fields)=>{auditCalls.push({personId:id,fields});});
  assert.equal(result.displayName,'Synthetic updated person');
  assert.equal(fake.calls[0]!.values?.[0],householdId);
  assert.match(fake.calls[1]!.sql,/household_id=\$2 FOR UPDATE/);
  assert.match(fake.calls[2]!.sql,/revision=\$9/);
  assert.deepEqual(fake.calls[2]!.values,[personId,householdId,'Synthetic updated person',true,'avatar-02','blue','2008-11-24',deriveAgeGroup('2008-11-24',localDateInTimezone(new Date(),'Europe/Oslo')),1]);
  assert.equal(fake.calls[2]!.values?.[7],'adult');
  assert.deepEqual(auditCalls,[{personId,fields:['displayName','avatarKey','colorToken','birthDate']}]);
});

test('profile update cannot cross households and stale revision never emits update audit',async()=>{
  const missing=fakeClient({personExists:false});
  await assert.rejects(updatePersonProfile(missing.client,householdId,personId,{displayName:'Should not change',expectedRevision:1},async()=>{}),(error:unknown)=>error instanceof DomainError&&error.status===404);
  assert.equal(missing.calls.filter(call=>call.sql.includes('UPDATE persons')).length,0);
  const stale=fakeClient({updateSucceeds:false}),auditCalls:string[]=[];
  await assert.rejects(updatePersonProfile(stale.client,householdId,personId,{displayName:'Stale change',expectedRevision:1},async()=>{auditCalls.push('audit');}),(error:unknown)=>error instanceof DomainError&&error.status===409);
  assert.deepEqual(auditCalls,[]);
});
