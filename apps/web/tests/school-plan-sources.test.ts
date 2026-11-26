import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSchoolPlanSourceBody, schoolPlanSourceDisplayName } from '../src/school-plan-sources-presentation';
import type { SchoolPlanSource } from '../src/mcp-client-policy';

const valid={connectionId:'synthetic-connection-id',personId:'synthetic-person-id',classKey:'1A.blue_2',sourcePageUrl:'https://school.test.invalid/plan/1a',displayPdfLinksAllowed:false};

test('school source approval posts the explicit person, connection, class, HTTPS page and PDF consent',()=>{
  assert.deepEqual(createSchoolPlanSourceBody(valid),valid);
  assert.deepEqual(createSchoolPlanSourceBody({...valid,sourcePageUrl:'https://school.test.invalid'}),{...valid,sourcePageUrl:'https://school.test.invalid/'});
});

test('school source approval rejects missing ids, invalid class keys, and non-HTTPS pages',()=>{
  assert.throws(()=>createSchoolPlanSourceBody({...valid,connectionId:''}),/school_plan_source_fields_invalid/);
  assert.throws(()=>createSchoolPlanSourceBody({...valid,classKey:'1A / private'}),/school_plan_source_fields_invalid/);
  assert.throws(()=>createSchoolPlanSourceBody({...valid,sourcePageUrl:'http://school.test.invalid/plan'}),/school_plan_source_url_https_required/);
  assert.throws(()=>createSchoolPlanSourceBody({...valid,sourcePageUrl:'not-a-url'}),/school_plan_source_url_invalid/);
});

test('admin source display resolves its associated connection by id without exposing it elsewhere',()=>{
  const source:SchoolPlanSource={id:'synthetic-source-id',personId:'synthetic-person-id',connectionId:'synthetic-connection-id',classKey:'1A',sourcePageUrl:'https://school.test.invalid/plan',displayPdfLinksAllowed:true};
  assert.equal(schoolPlanSourceDisplayName(source,[{id:'synthetic-connection-id',name:'Synthetic school reader'}]),'Synthetic school reader');
  assert.equal(schoolPlanSourceDisplayName(source,[]),null);
});
