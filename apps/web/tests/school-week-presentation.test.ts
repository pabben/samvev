import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentSchoolWeekPlans, requestSchoolWeekPdf, schoolWeekActivityAlreadyShown, schoolWeekDateAtNoon, schoolWeekDay, schoolWeekHomework, schoolWeekIdentity, schoolWeekPdfAvailable, schoolWeekPlansPath, schoolWeekPreviewPlans, schoolWeekRequirementKey, schoolWeekTimeLabel, schoolWeekTomorrow, schoolWeekUncertaintyKey, schoolWeekVisibleActivities, type SchoolWeekPlan } from '../src/school-week-presentation';

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

test('current school plan selection uses ISO week identity across calendar year boundaries', () => {
  assert.deepEqual(schoolWeekIdentity('2026-12-31'), { isoYear: 2026, isoWeek: 53 });
  assert.deepEqual(schoolWeekIdentity('2027-01-01'), { isoYear: 2026, isoWeek: 53 });
  assert.deepEqual(schoolWeekIdentity('2027-01-04'), { isoYear: 2027, isoWeek: 1 });
});

test('school plan requests constrain the server list to the local ISO week with a bounded page size', () => {
  assert.equal(schoolWeekPlansPath('2027-01-01', { display: true }), '/display/school-plans?isoYear=2026&isoWeek=53&limit=20');
  assert.equal(schoolWeekPlansPath('2027-01-01', { display: false, householdId: 'synthetic-household-id' }), '/households/synthetic-household-id/school-plans?isoYear=2026&isoWeek=53&limit=20');
});

test('display preview uses only its server-filtered plan snapshot and never requests a live projection fallback', () => {
  assert.deepEqual(schoolWeekPreviewPlans(true), []);
  assert.equal(schoolWeekPreviewPlans(true, [plan])?.[0], plan);
  assert.equal(schoolWeekPreviewPlans(false), undefined);
});

test('current week filtering ignores historical and future plans while keeping visible household members', () => {
  const historical = { ...plan, id: 'synthetic-historical', isoYear: 2026, isoWeek: 47, startsOn: '2026-11-16', endsOn: '2026-11-22' };
  const future = { ...plan, id: 'synthetic-future', isoYear: 2026, isoWeek: 49, startsOn: '2026-11-30', endsOn: '2026-12-06' };
  const current = { ...plan, id: 'synthetic-current', isoYear: 2026, isoWeek: 48, startsOn: '2026-11-23', endsOn: '2026-11-29' };
  const hiddenPerson = { ...current, id: 'synthetic-hidden-person', personId: 'synthetic-private-person' };
  assert.deepEqual(currentSchoolWeekPlans([historical, future, current, hiddenPerson], '2026-11-25', ['synthetic-person-id']).map(item => item.id), ['synthetic-current']);
});

test('school week card omits an activity already visible in the existing household school monitor', () => {
  const existing = [{ date: '2026-11-25', personId: 'synthetic-person-id', title: 'Synthetic library visit' }];
  assert.equal(schoolWeekActivityAlreadyShown('2026-11-25', 'Synthetic library visit', 'synthetic-person-id', existing), true);
  assert.equal(schoolWeekActivityAlreadyShown('2026-11-25', 'Synthetic library visit', 'another-person', existing), false);
  assert.equal(schoolWeekActivityAlreadyShown('2026-11-26', 'Synthetic library visit', 'synthetic-person-id', existing), false);
  assert.deepEqual(schoolWeekVisibleActivities(plan.days[0]!, 'synthetic-person-id', existing, false), []);
  assert.deepEqual(schoolWeekVisibleActivities(plan.days[0]!, 'synthetic-person-id', existing, true), plan.days[0]!.activities,
    'full week retains the source activity and its practical requirements');
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
