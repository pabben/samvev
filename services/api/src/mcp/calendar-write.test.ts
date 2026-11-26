import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeEventDates } from '../calendar/native-events.ts';
import { calendarCreateInput, calendarDeleteInput, calendarUpdateInput } from './calendar-write.ts';

const sourceId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const otherPerson = 'aaaaaaaa-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const requestKey = 'synthetic-key-01';
const create = { sourceId, title: 'Synthetic appointment', startsAt: '2099-01-01', endsAt: '2099-01-02', personIds: [personId], requestKey };

test('native calendar mutation inputs accept only the scoped event fields', () => {
  for (const field of ['sourceUrl', 'externalId', 'metadata', 'calendar', 'household', 'displayIds', 'recurrence']) {
    assert.equal(calendarCreateInput.safeParse({ ...create, [field]: 'synthetic' }).success, false, field);
    assert.equal(calendarUpdateInput.safeParse({ sourceId, eventId, requestKey, expectedRevision: 1, title: create.title, [field]: 'synthetic' }).success, false, field);
  }
  assert.equal(calendarCreateInput.safeParse({ ...create, personIds: [] }).success, false);
  assert.equal(calendarCreateInput.safeParse({ ...create, personIds: [otherPerson, otherPerson.toUpperCase()] }).success, false);
  assert.deepEqual(calendarCreateInput.parse({ ...create, personIds: [otherPerson, personId] }).personIds, [personId, otherPerson]);
  assert.equal(calendarUpdateInput.safeParse({ sourceId, eventId, requestKey, expectedRevision: 1 }).success, false);
  assert.equal(calendarUpdateInput.safeParse({ sourceId, eventId, requestKey, expectedRevision: 0, title: 'Synthetic' }).success, false);
  assert.equal(calendarDeleteInput.safeParse({ sourceId, eventId, requestKey }).success, false);
});

test('native calendar timing preserves exclusive civil dates and compares offset timestamps by instant', () => {
  const civil = nativeEventDates('2027-03-28', '2027-03-29');
  assert.equal(civil.allDay, true);
  assert.equal(civil.startDate.toISOString(), '2027-03-28T00:00:00.000Z');
  assert.equal(civil.endDate.toISOString(), '2027-03-29T00:00:00.000Z');
  const timed = nativeEventDates('2027-03-28T01:00:00+01:00', '2027-03-28T03:00:00+02:00');
  assert.equal(timed.allDay, false);
  assert.equal(timed.endDate.getTime() - timed.startDate.getTime(), 3_600_000);
  assert.throws(() => nativeEventDates('2027-03-28', '2027-03-29T03:00:00+02:00'), { code: 'VALIDATION_FAILED' });
  assert.throws(() => nativeEventDates('2027-03-28', '2027-03-28'), { code: 'VALIDATION_FAILED' });
  assert.throws(() => nativeEventDates('2027-03-28T10:00:00Z', '2027-03-28T10:30:00+01:00'), { code: 'VALIDATION_FAILED' });
});
