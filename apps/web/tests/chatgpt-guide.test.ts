import assert from 'node:assert/strict';
import test from 'node:test';
import {chatGptGuidePresentation as guide} from '../src/chatgpt-guide-presentation';
import {en} from '../src/locales/en';
import {nb} from '../src/locales/nb';

test('manual consent and import progress never implies server-confirmed authentication',()=>{
 assert.equal(guide(undefined,false,0).action,'prepare');
 assert.equal(guide(undefined,true,1).action,'local_consent');
 assert.equal(guide(undefined,true,2).action,'server_import');
 assert.equal(guide(undefined,true,2).ready,'chatConsentReported');
 assert.equal(guide(undefined,true,2).next,'chatMissingImport');
 assert.equal(guide(undefined,true,3).action,'refresh');
 assert.equal(guide(undefined,true,3).ready,'chatImportReported');
 assert.equal(guide(undefined,true,3).next,'chatMissingVerification');
 assert.equal(guide('pending_validation',true,3).ready,'chatPendingImported');
 assert.equal(guide('pending_validation',true,3).showSteps,false);
 assert.equal(guide('connected',true,3).action,'configure');
});
test('usage limits retain authentication and offer status and usage instead of another consent flow',()=>{
 for(const prepared of [false,true])for(const step of [0,1,2,3]){
  const result=guide('usage_limited',prepared,step);
  assert.equal(result.action,'refresh');assert.equal(result.showUsage,true);
  assert.equal(result.showSteps,false);assert.equal(result.ready,'chatReadyLimited');
 }
 assert.equal(guide('reauthorization_required',false,0).action,'prepare');
 assert.equal(guide('reauthorization_required',false,0).next,'chatMissingReauth');
 assert.equal(guide('not_eligible',true,2).action,'refresh');
 assert.equal(guide('not_eligible',true,2).showSteps,false);
});
test('every known server registration state has readable NB/EN next-action guidance',()=>{
 for(const status of ['pending_validation','connected','usage_limited','not_eligible','reauthorization_required','revocation_unconfirmed','disconnected']){
  for(const prepared of [false,true]){
   const view=guide(status,prepared,prepared?1:0);
   assert.ok(en[view.ready]&&nb[view.ready]);assert.ok(en[view.next]&&nb[view.next]);
  }
 }
 assert.equal(guide('revocation_unconfirmed',false,0).next,'chatRevocationNext');
});
