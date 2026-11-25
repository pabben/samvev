import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestSchoolWeekPdf, schoolWeekDateAtNoon, schoolWeekDay, schoolWeekHomework, schoolWeekPdfAvailable, schoolWeekRequirementKey, schoolWeekTimeLabel, schoolWeekTomorrow, schoolWeekUncertaintyKey, type SchoolWeekPlan } from '../src/school-week-presentation';

const plan: SchoolWeekPlan = {
  id: 'synthetic-plan-id', personId: 'synthetic-person-id', isoYear: 2026, isoWeek: 48,
  startsOn: '2026-11-23', endsOn: '2026-11-29', contentLocale: 'nb', revision: 1, contentRevision: 2,
  sourceStatus: 'stale', sourceError: 'synthetic_source_unreachable', uncertainty: 'high',
  pdfLinkAvailable: true, pdfStatus: 'server_verified',
  days: [
    { date: '2026-11-25', kind: 'school', activities: [{title:'Synthetic library visit',startsAt:'08:30',practicalRequirements:[{kind:'bring',text:'Synthetic library book'}]}], practicalRequirements: [{kind:'clothing',text:'Synthetic rain jacket'}], homework: [{ text: 'Synthetic reading', dueOn: '2026-11-26' }], deadlines: [{ text: 'Synthetic form', time: '14:00' }], reminders: [], weatherAdvice: null },
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

test('PDF action requires the safe server-verified projection and explicit link availability', () => {
  assert.equal(schoolWeekPdfAvailable(true, 'server_verified'), true);
  assert.equal(schoolWeekPdfAvailable(false, 'server_verified'), false);
  assert.equal(schoolWeekPdfAvailable(true, 'unverified_link'), false);
  assert.equal(schoolWeekPdfAvailable(true, null), false);
});

test('practical requirements retain their service category for localized presentation', () => {
  assert.equal(schoolWeekRequirementKey('bring'), 'schoolWeekRequirementBring');
  assert.equal(schoolWeekRequirementKey('clothing'), 'schoolWeekRequirementClothing');
  assert.equal(schoolWeekRequirementKey('prepare'), 'schoolWeekRequirementPrepare');
  assert.equal(schoolWeekRequirementKey('other'), 'schoolWeekRequirementOther');
});

test('activity startsAt is rendered as validated local HH:mm, not parsed as a timestamp', () => {
  assert.equal(schoolWeekTimeLabel('08:30'), '08:30');
  assert.equal(schoolWeekTimeLabel('23:59'), '23:59');
  assert.equal(schoolWeekTimeLabel('2026-11-25T08:30:00Z'), null);
  assert.equal(schoolWeekTimeLabel('25:30'), null);
});

test('uncertainty values map to localized phrases rather than displaying enum strings', () => {
  assert.equal(schoolWeekUncertaintyKey('low'), 'schoolWeekUncertaintyLow');
  assert.equal(schoolWeekUncertaintyKey('medium'), 'schoolWeekUncertaintyMedium');
  assert.equal(schoolWeekUncertaintyKey('high'), 'schoolWeekUncertaintyHigh');
  assert.equal(schoolWeekUncertaintyKey('unknown'), 'schoolWeekUncertaintyUnknown');
});

test('PDF action callback receives the server plan id and no external URL', () => {
  let opened: string | undefined;
  requestSchoolWeekPdf(plan.id, planId => { opened = planId; });
  assert.equal(opened, 'synthetic-plan-id');
});
