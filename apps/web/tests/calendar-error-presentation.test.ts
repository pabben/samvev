import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarConnectionErrorKey} from '../src/calendar-presentation.ts';
import {en} from '../src/locales/en.ts';
import {nb} from '../src/locales/nb.ts';

test('calendar URL failures use calendar-specific copy instead of generic password or recipient validation',()=>{
  assert.equal(calendarConnectionErrorKey('VALIDATION_FAILED',{fields:[{path:'icsUrl',code:'invalid_format'}]}),'calendarIcsUrlInvalid');
  assert.equal(calendarConnectionErrorKey('VALIDATION_FAILED',{fields:[{path:'name',code:'too_small'}]}),'calendarNameRequired');
  assert.equal(calendarConnectionErrorKey('VALIDATION_FAILED',{}),'calendarIcsFormInvalid');
  assert.equal(calendarConnectionErrorKey('AI_ENDPOINT_BLOCKED'),'calendarIcsUrlBlocked');
  for(const key of ['calendarIcsUrlInvalid','calendarIcsUrlBlocked','calendarNameRequired','calendarIcsFormInvalid'] as const){
    assert.ok(en[key]);assert.ok(nb[key]);assert.doesNotMatch(en[key],/password|recipient/i);assert.doesNotMatch(nb[key],/passord|mottaker/i);
  }
});
