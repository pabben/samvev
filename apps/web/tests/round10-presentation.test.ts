import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarCanReconnect,calendarCanSync,calendarNeedsOperator,calendarSyncBlockedKey} from '../src/calendar-presentation';
import {personTaskAttemptKey,personTaskErrorKey,personTaskResultKey} from '../src/person-task-presentation';
import type {PersonTaskSummary} from '../src/person-tasks';
import {en} from '../src/locales/en';
import {nb} from '../src/locales/nb';

test('expired or pending calendar consent cannot offer update or source preview as recovery',()=>{
 for(const state of ['setup','draft','awaiting_consent','expired','reauthorization_required']){
  assert.equal(calendarCanSync(state,null),false);
  assert.equal(calendarCanReconnect(state),true);
  assert.equal(calendarSyncBlockedKey(state,null),'calendarReconnectBeforeUpdate');
 }
 for(const state of ['disconnected','syncing','unexpected'])assert.equal(calendarCanSync(state,null),false);
 assert.equal(calendarSyncBlockedKey('syncing',null),'calendarSyncing');
 assert.equal(calendarCanSync('error','CALENDAR_REAUTHORIZATION_REQUIRED'),false);
 assert.equal(calendarCanSync('error','CALENDAR_OAUTH_FAILED'),false);
});

test('transient calendar failures permit retry while OAuth client errors require operator action',()=>{
 assert.equal(calendarCanSync('connected',null),true);
 assert.equal(calendarCanSync('error','CALENDAR_SYNC_FAILED'),true);
 assert.equal(calendarCanSync('error','CALENDAR_CLIENT_CONFIGURATION_INVALID'),false);
 assert.equal(calendarNeedsOperator('CALENDAR_CLIENT_CONFIGURATION_INVALID'),true);
 assert.equal(calendarNeedsOperator('CALENDAR_REAUTHORIZATION_REQUIRED'),false);
 assert.equal(calendarSyncBlockedKey('error','CALENDAR_CLIENT_CONFIGURATION_INVALID'),'CALENDAR_CLIENT_CONFIGURATION_INVALID');
 for(const messages of [en,nb]){
  assert.equal(messages.CALENDAR_CLIENT_CONFIGURATION_INVALID,messages.calendar_client_configuration_invalid,'persisted state and immediate API reason have the same next action');
  assert.notEqual(messages.CALENDAR_CLIENT_CONFIGURATION_INVALID,messages.CALENDAR_REAUTHORIZATION_REQUIRED);
  assert.ok(messages.calendarReconnectAfterSetup);
  assert.ok(messages.calendarReconnectBeforeUpdate);
 }
 assert.match(en.CALENDAR_CLIENT_CONFIGURATION_INVALID,/operator.*correct/i);
 assert.match(nb.CALENDAR_CLIENT_CONFIGURATION_INVALID,/drifter.*rette/i);
});

const summary=(status:PersonTaskSummary['status'],outcome:string|null):Pick<PersonTaskSummary,'status'|'latestAttempt'>=>({status,latestAttempt:{outcome,at:'2030-02-01T12:00:00Z',errorCode:null}});
test('person summaries distinguish never run, early failed, completed and active execution states',()=>{
 for(const [status,outcome,key] of [
  ['not_run',null,'personTaskNotRun'],['failed','failed','personTaskFailed'],
  ['findings','changed','personTaskFindings'],['no_findings','changed','personTaskNoFindings'],
  ['no_change','unchanged','personTaskNoChange'],['superseded','superseded','personTaskSuperseded'],
  ['running','queued','personTaskQueued'],['running','running','personTaskRunning'],
 ] as const){
  const actual=personTaskAttemptKey(summary(status,outcome));
  assert.equal(actual,key);
  assert.ok(en[actual]);assert.ok(nb[actual]);
 }
 assert.notEqual(en.personTaskQueued,en.personTaskRunning);
 assert.notEqual(nb.personTaskQueued,nb.personTaskRunning);
});

test('a retained result stays explicitly older after failure, interruption or a new active attempt',()=>{
 const result={historical:false} as PersonTaskSummary['result'];
 for(const status of ['failed','running','superseded'] as const)assert.equal(personTaskResultKey({status,result}),'personTaskOlderResult');
 assert.equal(personTaskResultKey({status:'findings',result}),'monitorLastResult');
 assert.equal(personTaskResultKey({status:'findings',result:{...result!,historical:true}}),'personTaskOlderResult');
 // A task whose current revision has never run can retain a result from an old revision.
 assert.equal(personTaskResultKey({status:'not_run',result:{...result!,historical:true}}),'personTaskOlderResult');
});

test('early and interrupted failures show localized safe explanations, never raw error text',()=>{
 assert.equal(personTaskErrorKey('MONITOR_EXECUTION_FAILED'),'personTaskExecutionFailed');
 assert.equal(personTaskErrorKey('MONITOR_WORKER_INTERRUPTED'),'personTaskInterrupted');
 assert.equal(personTaskErrorKey('MONITOR_OWNER_UNAUTHORIZED'),'monitorErrorPermission');
 assert.equal(personTaskErrorKey('unexpected private diagnostic text'),'monitorErrorGeneric');
 for(const messages of [en,nb]){
  assert.ok(messages.personTaskExecutionFailed);assert.ok(messages.personTaskInterrupted);
  assert.notEqual(messages.personTaskExecutionFailed,messages.personTaskInterrupted);
  assert.ok(messages.personTaskQueuedAt);assert.ok(messages.personTaskStartedAt);
 }
});
