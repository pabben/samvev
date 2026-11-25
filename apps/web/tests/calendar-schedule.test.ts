import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api';
import { calendarScheduleConflict, calendarSchedulePath, calendarSchedulePayload, calendarSyncIntervals } from '../src/calendar-schedule';

test('ICS schedule offers only the backend intervals and sends revision guarded updates', () => {
  assert.deepEqual(calendarSyncIntervals, [5, 15, 30]);
  assert.equal(calendarSchedulePath('/households/h/calendar-connections', 'id/with/slash'), '/households/h/calendar-connections/id%2Fwith%2Fslash/sync-schedule');
  assert.deepEqual(calendarSchedulePayload(12, 15), { expectedRevision: 12, syncIntervalMinutes: 15 });
});

test('calendar schedule conflicts explain in-progress sync separately from stale revisions', () => {
  assert.equal(calendarScheduleConflict(new ApiError('conflict', 409, { reason: 'calendar_sync_in_progress' }))?.code, 'calendarScheduleAfterSync');
  assert.equal(calendarScheduleConflict(new ApiError('conflict', 409, { reason: 'stale_revision' }))?.code, 'calendarScheduleConflict');
  assert.equal(calendarScheduleConflict(new ApiError('offline'))?.code, undefined);
});
