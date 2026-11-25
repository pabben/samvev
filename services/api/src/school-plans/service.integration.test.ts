import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import { roleCapabilityPresets } from '@samvev/contracts';
import { DomainError, tokenHash } from '@samvev/core';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { isoWeekRange, parseSchoolPlan, schoolPlanUpsertSchema, validateSchoolPlanContent } from './contracts.ts';
import {
  approveSchoolPlanSource, getDisplaySchoolPlanPdfLink, getSchoolPlan, listDisplaySchoolPlans, listSchoolPlans,
  listSchoolPlanSources, recordSchoolPlanSourceFailure, revokeSchoolPlanSource, upsertSchoolPlan,
} from './service.ts';
import type { SchoolPlanActor, SchoolPlanDisplay, SchoolPlanMember } from './service.ts';

const name = 'Synthetic school plan';
const sourcePageUrl = 'https://school.example.invalid/classes/synthetic-1a/';
const pdfUrl = 'https://school.example.invalid/files/week%2053.pdf?v=1%2B2';
const week = { isoYear: 2020, isoWeek: 53 };
let installationId: string;
let householdId: string;
let otherHouseholdId: string;
let connectionId: string;
let otherConnectionId: string;
let personId: string;
let foreignPersonId: string;
let sourceId: string;
let actor: SchoolPlanActor;
let limited: SchoolPlanMember;
let foreignManager: SchoolPlanMember;
let display: SchoolPlanDisplay;
let unselectedDisplay: SchoolPlanDisplay;
let secondDisplay: SchoolPlanDisplay;
let planId: string;

async function insertId(sql: string, values: readonly unknown[] = []): Promise<string> {
  return (await pool.query<{ id: string }>(sql, [...values])).rows[0]!.id;
}

async function createPerson(id: string, age: 'adult' | 'child') {
  return insertId(`INSERT INTO persons(household_id,display_name,avatar_key,age_group)
    VALUES($1,$2,'avatar-01',$3) RETURNING id`, [id, name, age]);
}

async function createMember(id: string, role: 'household_admin' | 'limited'): Promise<SchoolPlanMember> {
  const person = await createPerson(id, role === 'limited' ? 'child' : 'adult');
  const accountId = await insertId(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme)
    VALUES($1,$2,'synthetic-non-login-fixture','en','system') RETURNING id`, [installationId, `${randomUUID()}@example.invalid`]);
  const membershipId = await insertId(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities)
    VALUES($1,$2,$3,$4,$5) RETURNING id`, [id, accountId, person, role, JSON.stringify(roleCapabilityPresets[role])]);
  return { householdId: id, accountId, membershipId };
}

async function createDisplay(id: string): Promise<SchoolPlanDisplay> {
  const credentialHash = tokenHash(randomUUID());
  const { rows } = await pool.query<{ id: string; credential_generation: number }>(
    `INSERT INTO displays(household_id,name,locale,theme,credential_hash,credential_expires_at,external_items_enabled)
     VALUES($1,$2,'en','light',$3,clock_timestamp()+interval '1 hour',true) RETURNING id,credential_generation`,
    [id, name, credentialHash]);
  return { id: rows[0]!.id, householdId: id, credentialHash, credentialGeneration: rows[0]!.credential_generation };
}

const checkTime = (minute: number) => `2026-11-20T10:${String(minute).padStart(2, '0')}:00.000Z`;
function input(overrides: Record<string, unknown> = {}) {
  return {
    sourceId, personId, sourcePageUrl, classKey: 'synthetic-1a', ...week,
    expectedRevision: 0, contentLocale: 'nb',
    startsOn: '2020-12-28', endsOn: '2021-01-03',
    days: [
      { date: '2021-01-01', kind: 'school_free' },
      { date: '2020-12-28', kind: 'school', activities: [{ title: 'Synthetic lesson', startsAt: '09:00', endsAt: '10:00' }],
        practicalRequirements: [{ kind: 'bring', text: 'Synthetic bag' }],
        reminders: [{ kind: 'after_school_standard', time: '15:30', text: 'Synthetic pickup window' }] },
    ],
    pdfUrl, sourceRevision: 'synthetic-document-v1', observedAt: checkTime(0), interpretedAt: checkTime(1),
    uncertainty: 'low', displayIds: [display?.id],
    ...overrides,
  };
}
function key() { return { sourceId, ...week }; }
function sourceApproval(overrides: Record<string, unknown> = {}) {
  return { connectionId, personId, classKey: 'synthetic-1a', sourcePageUrl, ...overrides };
}
const isError = (status: number, reason?: string) => (error: unknown) =>
  error instanceof DomainError && error.status === status && (reason === undefined || error.details?.reason === reason);

before(async () => {
  await migrate();
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  installationId = await insertId(`INSERT INTO installations(claimed_at,setup_step,default_locale) VALUES(clock_timestamp(),'complete','en') RETURNING id`);
  const addHousehold = () => insertId(`INSERT INTO households(installation_id,name,timezone,default_locale,data_kind)
    VALUES($1,$2,'UTC','en','synthetic') RETURNING id`, [installationId, name]);
  householdId = await addHousehold();
  otherHouseholdId = await addHousehold();
  const manager = await createMember(householdId, 'household_admin');
  limited = await createMember(householdId, 'limited');
  foreignManager = await createMember(otherHouseholdId, 'household_admin');
  personId = await createPerson(householdId, 'child');
  foreignPersonId = await createPerson(otherHouseholdId, 'child');
  const addConnection = (id: string) => insertId(`INSERT INTO integration_connections(household_id,name) VALUES($1,$2) RETURNING id`, [id, name]);
  connectionId = await addConnection(householdId);
  otherConnectionId = await addConnection(otherHouseholdId);
  display = await createDisplay(householdId);
  secondDisplay = await createDisplay(householdId);
  unselectedDisplay = await createDisplay(householdId);
  for (const screen of [display, secondDisplay, unselectedDisplay]) {
    await pool.query(`INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id)
      VALUES($1,$2,$3)`, [householdId, connectionId, screen.id]);
  }
  await pool.query(`UPDATE display_setups SET all_sources=true WHERE household_id=$1`, [householdId]);
  await pool.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed)
    VALUES($1,$2,$3,true)`, [householdId, display.id, personId]);
  await pool.query('UPDATE displays SET person_ids_override=$2 WHERE id=$1', [unselectedDisplay.id, []]);
  const source = await approveSchoolPlanSource(manager, sourceApproval());
  sourceId = source.id;
  actor = { ...manager, connectionId, personIds: [personId], sourceIds: [sourceId], displayIds: [display.id, unselectedDisplay.id],
    scopes: ['mcp:school-plans:read', 'mcp:school-plans:write'] };
});

after(async () => {
  await pool.end();
});

test('real ISO week ranges and structured school content are validated without raw error values', () => {
  assert.deepEqual(isoWeekRange(2020, 53), { startsOn: '2020-12-28', endsOn: '2021-01-03' });
  assert.throws(() => isoWeekRange(2021, 53), isError(400, 'invalid_week'));
  const verify = (patch: Record<string, unknown>) => validateSchoolPlanContent(parseSchoolPlan(schoolPlanUpsertSchema, input(patch)));
  assert.throws(() => verify({ endsOn: '2021-01-04' }), isError(400, 'invalid_week'));
  assert.throws(() => verify({ days: [{ date: '2020-12-28', kind: 'unknown' }] }), isError(400, 'empty_plan'));
  assert.throws(() => verify({ days: [{ date: '2021-01-04', kind: 'school_free' }] }), isError(400, 'invalid_day'));
  assert.throws(() => verify({ sourceRevision: 'unsafe\u0000source' }), isError(400, 'invalid_input'));
  assert.throws(() => verify({ displayIds: [display.id, display.id] }), isError(400, 'duplicate_display'));
  assert.throws(() => verify({ pdfUrl: 'https://other.example.invalid/source.pdf' }), isError(400, 'invalid_pdf_origin'));
  for (const value of ['https://127.0.0.1/plan.pdf', 'https://u:p@school.example.invalid/plan.pdf',
    'https://school.example.invalid/plan.pdf?AccessToken=private', 'https://', 'http://school.example.invalid/plan.pdf']) {
    assert.throws(() => verify({ pdfUrl: value }), isError(400, 'invalid_input'));
  }
});

test('approval requires a manager and writes require scoped person, source, exact class and display grants', async () => {
  await assert.rejects(approveSchoolPlanSource(limited, sourceApproval()), isError(403));
  await assert.rejects(approveSchoolPlanSource(actor, sourceApproval({ personId: foreignPersonId })), isError(404));
  await assert.rejects(upsertSchoolPlan({ ...actor, scopes: ['mcp:school-plans:read'] }, input()), isError(403));
  await assert.rejects(upsertSchoolPlan({ ...actor, ...limited }, input()), isError(403));
  await assert.rejects(upsertSchoolPlan({ ...actor, ...foreignManager, connectionId: otherConnectionId }, input()), isError(404));
  await assert.rejects(upsertSchoolPlan({ ...actor, personIds: [] }, input()), isError(404));
  await assert.rejects(upsertSchoolPlan({ ...actor, sourceIds: [] }, input()), isError(404));
  await assert.rejects(upsertSchoolPlan(actor, input({ personId: foreignPersonId })), isError(404));
  await assert.rejects(upsertSchoolPlan(actor, input({ classKey: 'synthetic-1b' })), isError(404));
  await assert.rejects(upsertSchoolPlan(actor, input({ sourcePageUrl: sourcePageUrl.replace('1a', '1b') })), isError(404));
  await assert.rejects(upsertSchoolPlan(actor, input({ displayIds: [secondDisplay.id] })), isError(403));
  const sources = await listSchoolPlanSources(actor);
  assert.deepEqual(sources.map(({ id }) => id), [sourceId]);
  assert.deepEqual(await listSchoolPlanSources({ ...actor, sourceIds: [] }), []);
});

test('stable week identity supports concurrent creation, unchanged checks, corrected PDF and stale CAS', async () => {
  const first = await Promise.all([upsertSchoolPlan(actor, input()), upsertSchoolPlan(actor, input())]);
  assert.deepEqual(first.map(({ result }) => result).sort(), ['created', 'unchanged']);
  planId = first[0]!.id;
  assert.ok(first.every((item) => item.id === planId && item.revision === 1 && item.contentRevision === 1));
  assert.equal((await pool.query('SELECT id FROM school_plans WHERE source_id=$1', [sourceId])).rowCount, 1);
  const created = await getSchoolPlan(actor, key());
  assert.deepEqual(created.days.map(({ date }) => date), ['2020-12-28', '2021-01-01']);
  assert.deepEqual(created.pdf, { status: 'unverified_link', url: pdfUrl });
  const unchanged = await upsertSchoolPlan(actor, input({ expectedRevision: 1, observedAt: checkTime(2), interpretedAt: checkTime(3) }));
  assert.equal(unchanged.result, 'unchanged');
  assert.equal(unchanged.revision, 1);
  const refreshed = await getSchoolPlan(actor, key());
  assert.equal(refreshed.observedAt, checkTime(0));
  assert.equal(refreshed.interpretedAt, checkTime(1));
  assert.equal(refreshed.lastSourceObservedAt, checkTime(2));
  assert.equal(refreshed.lastCheckedAt, checkTime(2));
  await assert.rejects(upsertSchoolPlan(actor, input({ expectedRevision: 1, pdfUrl: pdfUrl.replace('.pdf', '-late.pdf') })),
    isError(409, 'source_observation_outdated'));
  const fixes = await Promise.allSettled(['A', 'B'].map((version) =>
    upsertSchoolPlan(actor, input({ expectedRevision: 1, pdfUrl: pdfUrl.replace('.pdf', `-corrected-${version}.pdf`),
      sourceRevision: `synthetic-document-v${version}`, observedAt: checkTime(4), interpretedAt: checkTime(5) }))));
  const fix = fixes.find((item) => item.status === 'fulfilled');
  const rejected = fixes.find((item) => item.status === 'rejected');
  assert.equal(fix?.value.result, 'updated');
  assert.equal(fix?.value.id, planId);
  assert.equal(fix?.value.revision, 2);
  assert.equal(fix?.value.contentRevision, 2);
  assert.ok(rejected && isError(409, 'revision_conflict')(rejected.reason));
  assert.deepEqual((await listSchoolPlans(actor, week)).map(({ id }) => id), [planId]);
  assert.deepEqual(await listSchoolPlans({ ...actor, personIds: [] }), []);
  await assert.rejects(getSchoolPlan({ ...actor, sourceIds: [] }, key()), isError(404));
  await assert.rejects(getSchoolPlan({ ...actor, scopes: ['mcp:school-plans:write'] }, key()), isError(403));
});

test('failed checks retain the last plan and PDF byte-for-byte and cannot overwrite newer checks', async () => {
  const prior = await getSchoolPlan(actor, key());
  const failure = { ...key(), personId, classKey: 'synthetic-1a', sourcePageUrl, expectedRevision: 2, checkedAt: checkTime(6), reason: 'timeout' };
  await assert.rejects(recordSchoolPlanSourceFailure(actor, { ...failure, isoYear: 2021, isoWeek: 1, expectedRevision: 0 }), isError(404));
  const marked = await recordSchoolPlanSourceFailure(actor, failure);
  assert.deepEqual(marked, { result: 'updated', id: planId, revision: 3, contentRevision: 2, sourceStatus: 'stale' });
  assert.equal((await recordSchoolPlanSourceFailure(actor, failure)).result, 'unchanged');
  await assert.rejects(recordSchoolPlanSourceFailure(actor, { ...failure, expectedRevision: 3, checkedAt: checkTime(4) }),
    isError(409, 'source_observation_outdated'));
  const stale = await getSchoolPlan(actor, key());
  assert.deepEqual(stale, { ...prior, lastCheckedAt: checkTime(6), sourceStatus: 'stale', sourceError: 'timeout', revision: 3 });
  const recovery = input({ expectedRevision: 3, pdfUrl: prior.pdf.url, sourceRevision: prior.sourceRevision,
    observedAt: checkTime(7), interpretedAt: checkTime(8) });
  assert.equal((await upsertSchoolPlan(actor, recovery)).sourceStatus, 'current');
  const recovered = await getSchoolPlan(actor, key());
  assert.equal(recovered.revision, 4);
  assert.equal(recovered.contentRevision, 2);
  assert.equal(recovered.observedAt, checkTime(4));
  assert.equal(recovered.lastSourceObservedAt, checkTime(7));
  assert.equal(recovered.sourceError, null);
});

test('display scope checks pairing, privacy, person/source selection, explicit target and PDF consent', async () => {
  const projection = await listDisplaySchoolPlans(display, week);
  assert.equal(projection.length, 1);
  assert.equal(projection[0]!.id, planId);
  assert.equal(projection[0]!.pdfLinkAvailable, false);
  assert.ok(!Object.hasOwn(projection[0]!, 'sourcePageUrl') && !Object.hasOwn(projection[0]!, 'displayIds'));
  assert.deepEqual(await listDisplaySchoolPlans(secondDisplay), [], 'connection access does not confer plan targeting');
  assert.deepEqual(await listDisplaySchoolPlans({ ...display, householdId: otherHouseholdId }), []);
  assert.deepEqual(await listDisplaySchoolPlans({ ...display, credentialGeneration: display.credentialGeneration + 1 }), []);
  await assert.rejects(getDisplaySchoolPlanPdfLink(display, planId), isError(404));
  assert.equal((await approveSchoolPlanSource(actor, sourceApproval({ displayPdfLinksAllowed: true }))).id, sourceId);
  assert.equal((await listDisplaySchoolPlans(display, week))[0]!.pdfLinkAvailable, true);
  assert.deepEqual(await getDisplaySchoolPlanPdfLink(display, planId), (await getSchoolPlan(actor, key())).pdf);
  await pool.query('UPDATE displays SET privacy_mode=true WHERE id=$1', [display.id]);
  await assert.rejects(getDisplaySchoolPlanPdfLink(display, planId), isError(404));
  assert.deepEqual(await listDisplaySchoolPlans(display), []);
  await pool.query('UPDATE displays SET privacy_mode=false, person_ids_override=ARRAY[]::uuid[] WHERE id=$1', [display.id]);
  assert.deepEqual(await listDisplaySchoolPlans(display), [], 'an excluded person cannot project through an explicit plan target');
  await pool.query('UPDATE displays SET person_ids_override=NULL WHERE id=$1', [display.id]);
  await pool.query('DELETE FROM display_person_grants WHERE display_id=$1 AND person_id=$2', [display.id, personId]);
  assert.deepEqual(await listDisplaySchoolPlans(display), [], 'a selected person without a profile grant stays private');
  await assert.rejects(getDisplaySchoolPlanPdfLink(display, planId), isError(404));
  await pool.query(`INSERT INTO display_person_grants(household_id,display_id,person_id,profile_allowed)
    VALUES($1,$2,$3,true)`, [householdId, display.id, personId]);
  await pool.query('DELETE FROM integration_connection_display_grants WHERE connection_id=$1 AND display_id=$2', [connectionId, display.id]);
  await assert.rejects(getDisplaySchoolPlanPdfLink(display, planId), isError(404));
  assert.deepEqual(await listDisplaySchoolPlans(display), []);
  assert.deepEqual((await getSchoolPlan(actor, key())).displayIds, []);
  await pool.query(`INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id)
    VALUES($1,$2,$3)`, [householdId, connectionId, display.id]);
});

test('database constraints reject a duplicate week, invalid ISO dates and a cross-household target; revocation hides history', async () => {
  const duplicate = `INSERT INTO school_plans(household_id,connection_id,person_id,source_id,iso_year,iso_week,week_starts_on,
    week_ends_on,content_locale,days,source_revision,uncertainty,observed_at,interpreted_at,last_source_observed_at,last_checked_at,content_hash)
    SELECT household_id,connection_id,person_id,source_id,iso_year,iso_week,week_starts_on,week_ends_on,
      content_locale,days,source_revision,uncertainty,observed_at,interpreted_at,last_source_observed_at,last_checked_at,content_hash
    FROM school_plans WHERE id=$1`;
  await assert.rejects(pool.query(duplicate, [planId]), { code: '23505' });
  await assert.rejects(pool.query('UPDATE school_plans SET iso_year=2021 WHERE id=$1', [planId]), { code: '23514' });
  const foreignDisplay = await createDisplay(otherHouseholdId);
  await assert.rejects(pool.query('INSERT INTO school_plan_display_targets(household_id,plan_id,display_id) VALUES($1,$2,$3)',
    [householdId, planId, foreignDisplay.id]), { code: '23503' });
  await revokeSchoolPlanSource(actor, sourceId);
  assert.deepEqual(await listSchoolPlanSources(actor), []);
  assert.deepEqual(await listSchoolPlans(actor), []);
  assert.deepEqual(await listDisplaySchoolPlans(display), []);
  await assert.rejects(getDisplaySchoolPlanPdfLink(display, planId), isError(404));
  await assert.rejects(getSchoolPlan(actor, key()), isError(404));
  await assert.rejects(upsertSchoolPlan(actor, input({ displayIds: [] })), isError(404));
  assert.equal((await pool.query('SELECT id FROM school_plans WHERE id=$1', [planId])).rowCount, 1);
  const reapproved = await approveSchoolPlanSource(actor, sourceApproval());
  assert.equal(reapproved.id, sourceId);
  assert.equal((await getSchoolPlan(actor, key())).id, planId);
  assert.equal((await listDisplaySchoolPlans(display))[0]!.pdfLinkAvailable, false);
  const audits = await pool.query<{ metadata: string; action: string; actor_type: string }>(`SELECT metadata::text,action,actor_type FROM audit_events
    WHERE household_id=$1 AND subject_type IN ('school_plan','school_plan_source')`, [householdId]);
  assert.ok(audits.rows.some(({ action }) => action === 'school_plan.source_failed'));
  assert.ok(audits.rows.some(({ action }) => action === 'school_plan_source.revoked'));
  assert.ok(audits.rows.filter(({ action }) => action === 'school_plan_source.approved').every(({ actor_type }) => actor_type === 'account'));
  assert.ok(audits.rows.every(({ metadata }) => /^\{(?:"revision": \d+)?\}$/.test(metadata)));
});
