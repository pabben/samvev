import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schoolWeekDateAtNoon, schoolWeekDay, schoolWeekHomework, schoolWeekPdfAvailable, schoolWeekTomorrow, type SchoolWeekPlan } from '../src/school-week-presentation';

const plan: SchoolWeekPlan = {
  id: 'synthetic-plan-id', personId: 'synthetic-person-id', isoYear: 2026, isoWeek: 48,
  startsOn: '2026-11-23', endsOn: '2026-11-29', contentLocale: 'nb', revision: 1, contentRevision: 2,
  sourceStatus: 'stale', sourceError: 'synthetic_source_unreachable', uncertainty: 'Synthetic schedule change needs checking.',
  pdf: { status: 'ready' },
  days: [
    { date: '2026-11-25', kind: 'school', activities: [], practicalRequirements: [], homework: [{ text: 'Synthetic reading', dueOn: '2026-11-26' }], deadlines: [{ text: 'Synthetic form', time: '14:00' }], reminders: [], weatherAdvice: null },
    { date: '2026-11-26', kind: 'school', activities: [], practicalRequirements: [], homework: [{ text: 'Synthetic maths' }], deadlines: [], reminders: [{ kind: 'after_school_exception', text: 'Synthetic pickup reminder', time: '15:30' }], weatherAdvice: null },
  ],
};

test('school week selectors find local today and tomorrow without changing the server supplied date range', () => {
  assert.equal(schoolWeekDay(plan, '2026-11-25')?.date, '2026-11-25');
  assert.equal(schoolWeekDay(plan, schoolWeekTomorrow('2026-11-25'))?.date, '2026-11-26');
  assert.equal(schoolWeekTomorrow('2026-11-30'), '2026-12-01');
  assert.equal(plan.startsOn, '2026-11-23');
});

test('calendar date strings retain their household-local day in widely separated time zones', () => {
  for (const zone of ['Pacific/Kiritimati', 'America/Adak', 'Europe/Oslo']) {
    const date = schoolWeekDateAtNoon('2026-11-25', zone);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
    assert.deepEqual([parts.year, parts.month, parts.day], ['2026', '11', '25']);
  }
});

test('homework highlights are ordered by due date and infer a day date when no due date is supplied', () => {
  assert.deepEqual(schoolWeekHomework(plan), [
    { text: 'Synthetic reading', dueOn: '2026-11-26' },
    { text: 'Synthetic maths', dueOn: '2026-11-26' },
  ]);
});

test('PDF action is enabled only for a server-verified document', () => {
  assert.equal(schoolWeekPdfAvailable('server_verified'), true);
  assert.equal(schoolWeekPdfAvailable('ready'), false);
  assert.equal(schoolWeekPdfAvailable('available'), false);
  assert.equal(schoolWeekPdfAvailable('unverified_link'), false);
  assert.equal(schoolWeekPdfAvailable('missing'), false);
  assert.equal(schoolWeekPdfAvailable('pending'), false);
  assert.equal(schoolWeekPdfAvailable('error'), false);
});
