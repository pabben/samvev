import { createHash } from 'node:crypto';
import { uuidSchema } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import type { PoolClient } from 'pg';
import { pool, transaction } from '../db.ts';
import {
  isoWeekRange, parseSchoolPlan, schoolPlanDisplayListSchema, schoolPlanKeySchema, schoolPlanListSchema,
  schoolPlanSourceApprovalSchema, schoolPlanSourceFailureSchema, schoolPlanUpsertSchema, schoolPlanVerifyPdfSchema,
  validateCheckTime, validateSchoolPlanContent,
} from './contracts.ts';
import type { SchoolPlanDay, SchoolPlanList, SchoolPlanSourceFailure, SchoolPlanUpsert } from './contracts.ts';
import { MAX_SCHOOL_PDF_BYTES, schoolPdfFetcher, validatePdfBytes } from './pdf-fetcher.ts';
import type { SchoolPdfFetcher } from './pdf-fetcher.ts';

export type SchoolPlanMember = { householdId: string; accountId: string; membershipId: string };

export type SchoolPlanAuthorityRequest = {
  write: boolean;
  personIds: readonly string[];
  displayIds: readonly string[];
  sourceIds: readonly string[];
};

/** Constructed from the authenticated grant by the transport, never from tool input. */
export type SchoolPlanActor = SchoolPlanMember & {
  connectionId: string;
  scopes: readonly string[];
  personIds: readonly string[];
  sourceIds: readonly string[];
  displayIds: readonly string[];
  authorizeInTransaction?: (client: PoolClient, request: SchoolPlanAuthorityRequest) => Promise<void>;
};

/** Constructed by the paired-display authentication path. */
export type SchoolPlanDisplay = {
  householdId: string;
  id: string;
  credentialHash: string;
  credentialGeneration: number;
};

type Membership = { person_id: string; capabilities: string[]; installation_id: string };
type SourceRow = {
  id: string; household_id: string; connection_id: string; person_id: string; class_key: string;
  source_page_url: string; display_pdf_links_allowed: boolean; connection_name?: string;
};
type PlanRow = {
  id: string; source_id: string; person_id: string; iso_year: number; iso_week: number;
  starts_on: string; ends_on: string; content_locale: SchoolPlanUpsert['contentLocale']; days: SchoolPlanDay[];
  source_page_url: string; class_key: string; pdf_url: string | null;
  pdf_status: 'missing' | 'unverified_link';
  pdf_sha256: string | null; pdf_verified_at: Date | null;
  uncertainty: SchoolPlanUpsert['uncertainty']; source_revision: string;
  observed_at: Date; interpreted_at: Date; last_source_observed_at: Date; last_checked_at: Date;
  source_error: SchoolPlanSourceFailure['reason'] | null;
  revision: number; content_revision: number; content_hash: string; display_ids: string[]; active_display_ids: string[];
};

const readScope = 'mcp:school-plans:read';
const writeScope = 'mcp:school-plans:write';
const maxHouseholdPdfBytes = 100 * 1024 * 1024;
const notFound = () => new DomainError('NOT_FOUND', 404);
const forbidden = () => new DomainError('FORBIDDEN', 403);
const conflict = (reason: 'revision_conflict' | 'source_observation_outdated' | 'source_already_bound' | 'pdf_snapshot_conflict', revision?: number) =>
  new DomainError('CONFLICT', 409, revision === undefined ? { reason } : { reason, revision });

const sourceColumns = 'id,household_id,connection_id,person_id,class_key,source_page_url,display_pdf_links_allowed';
const presentationColumns = `p.id,p.person_id,p.iso_year,p.iso_week,
  to_char(p.week_starts_on,'YYYY-MM-DD') AS starts_on,to_char(p.week_ends_on,'YYYY-MM-DD') AS ends_on,
  p.content_locale,p.days,p.uncertainty,p.last_source_observed_at,p.source_error,p.revision,p.content_revision`;
const planColumns = `${presentationColumns},p.source_id,p.pdf_url,p.pdf_status,s.source_page_url,s.class_key,
  snapshot.sha256 AS pdf_sha256,snapshot.verified_at AS pdf_verified_at,
  p.source_revision,p.observed_at,p.interpreted_at,p.last_checked_at,p.content_hash,
  ARRAY(SELECT t.display_id FROM school_plan_display_targets t WHERE t.plan_id=p.id ORDER BY t.display_id) AS display_ids,
  ARRAY(SELECT t.display_id FROM school_plan_display_targets t
    JOIN integration_connection_display_grants g ON g.household_id=t.household_id AND g.display_id=t.display_id AND g.connection_id=p.connection_id
    JOIN displays d ON d.household_id=t.household_id AND d.id=t.display_id AND d.revoked_at IS NULL
    WHERE t.plan_id=p.id ORDER BY t.display_id) AS active_display_ids`;
const snapshotMatch = `snapshot.household_id=p.household_id AND snapshot.plan_id=p.id
  AND snapshot.plan_content_revision=p.content_revision AND snapshot.pdf_url=p.pdf_url`;
const planFrom = `FROM school_plans p JOIN school_plan_sources s
  ON s.id=p.source_id AND s.household_id=p.household_id AND s.revoked_at IS NULL
  JOIN integration_connections c ON c.household_id=p.household_id AND c.id=p.connection_id AND c.revoked_at IS NULL
  LEFT JOIN school_plan_pdf_snapshots snapshot ON ${snapshotMatch}`;

function sourceResponse(source: SourceRow) {
  return {
    id: source.id,
    connectionId: source.connection_id,
    ...(source.connection_name ? { connectionName: source.connection_name } : {}),
    personId: source.person_id,
    classKey: source.class_key,
    sourcePageUrl: source.source_page_url,
    displayPdfLinksAllowed: source.display_pdf_links_allowed,
  };
}

type PresentationRow = Pick<PlanRow, 'id' | 'person_id' | 'iso_year' | 'iso_week' | 'starts_on' | 'ends_on' |
  'content_locale' | 'days' | 'revision' | 'content_revision' | 'source_error' | 'last_source_observed_at' | 'uncertainty'>;

function planDetails(row: PresentationRow) {
  return {
    id: row.id,
    personId: row.person_id,
    isoYear: row.iso_year,
    isoWeek: row.iso_week,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    contentLocale: row.content_locale,
    days: row.days,
    revision: row.revision,
    contentRevision: row.content_revision,
  };
}

function actorPlan(row: PlanRow, actor: SchoolPlanActor) {
  return {
    ...planDetails(row),
    sourceId: row.source_id,
    classKey: row.class_key,
    sourcePageUrl: row.source_page_url,
    sourceRevision: row.source_revision,
    observedAt: row.observed_at.toISOString(),
    interpretedAt: row.interpreted_at.toISOString(),
    lastSourceObservedAt: row.last_source_observed_at.toISOString(),
    lastCheckedAt: row.last_checked_at.toISOString(),
    sourceStatus: row.source_error ? 'stale' as const : 'current' as const,
    sourceError: row.source_error,
    uncertainty: row.uncertainty,
    pdf: row.pdf_verified_at ? {
      status: 'server_verified' as const, url: row.pdf_url, sha256: row.pdf_sha256, verifiedAt: row.pdf_verified_at.toISOString(),
    } : { status: row.pdf_status, url: row.pdf_url },
    displayIds: row.active_display_ids.filter((displayId) => actor.displayIds.includes(displayId)),
  };
}

function mutationResult(result: 'created' | 'updated' | 'unchanged', row: PlanRow) {
  return {
    result,
    id: row.id,
    revision: row.revision,
    contentRevision: row.content_revision,
    sourceStatus: row.source_error ? 'stale' as const : 'current' as const,
  };
}

async function requireMember(client: PoolClient, actor: SchoolPlanMember): Promise<Membership> {
  const result = await client.query<Membership>(`
    SELECT m.person_id,m.capabilities,h.installation_id
    FROM memberships m
    JOIN households h ON h.id=m.household_id
    JOIN accounts a ON a.id=m.account_id AND a.installation_id=h.installation_id AND a.disabled_at IS NULL AND a.password_hash IS NOT NULL
    JOIN persons p ON p.id=m.person_id AND p.household_id=m.household_id AND p.age_group='adult'
    WHERE m.household_id=$1 AND m.id=$2 AND a.id=$3 AND m.capabilities ? 'household.view'
    FOR SHARE OF m,a,p`, [actor.householdId, actor.membershipId, actor.accountId]);
  if (!result.rows[0]) throw forbidden();
  return result.rows[0];
}

async function requireConnection(client: PoolClient, householdId: string, connectionId: string): Promise<void> {
  const result = await client.query(`
    SELECT id FROM integration_connections WHERE household_id=$1 AND id=$2 AND revoked_at IS NULL FOR SHARE`,
  [householdId, connectionId]);
  if (result.rowCount !== 1) throw notFound();
}

async function requireActor(client: PoolClient, actor: SchoolPlanActor, scope: string): Promise<Membership> {
  if (!actor.scopes.includes(scope)) throw forbidden();
  const member = await requireMember(client, actor);
  await requireConnection(client, actor.householdId, actor.connectionId);
  return member;
}

function permittedPeople(actor: SchoolPlanActor, member: Membership): readonly string[] {
  if (member.capabilities.includes('household.manage')) return actor.personIds;
  return actor.personIds.filter((id) => id === member.person_id);
}

function constrainId(ids: readonly string[], requestedId?: string): readonly string[] {
  if (!requestedId) return ids;
  return ids.includes(requestedId) ? [requestedId] : [];
}

async function audit(client: PoolClient, actor: SchoolPlanMember, member: Membership, action: string,
  subjectType: 'school_plan_source' | 'school_plan', subjectId: string,
  integration?: { connectionId: string; revision: number }): Promise<void> {
  await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
  [member.installation_id, actor.householdId, integration ? 'integration' : 'account',
    integration?.connectionId ?? actor.accountId, action, subjectType, subjectId,
    JSON.stringify(integration ? { revision: integration.revision } : {})]);
}

export async function approveSchoolPlanSource(manager: SchoolPlanMember, raw: unknown) {
  const input = parseSchoolPlan(schoolPlanSourceApprovalSchema, raw);
  return transaction(async (client) => {
    const member = await requireMember(client, manager);
    if (!member.capabilities.includes('household.manage')) throw forbidden();
    await requireConnection(client, manager.householdId, input.connectionId);
    const person = await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=$2 FOR KEY SHARE',
      [manager.householdId, input.personId]);
    if (person.rowCount !== 1) throw notFound();
    const result = await client.query<SourceRow>(`
      INSERT INTO school_plan_sources(household_id,connection_id,person_id,class_key,source_page_url,display_pdf_links_allowed)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(household_id,person_id,class_key,source_page_url) DO UPDATE
      SET display_pdf_links_allowed=EXCLUDED.display_pdf_links_allowed,revoked_at=NULL
      WHERE school_plan_sources.connection_id=EXCLUDED.connection_id
      RETURNING ${sourceColumns}`,
    [manager.householdId, input.connectionId, input.personId, input.classKey, input.sourcePageUrl, input.displayPdfLinksAllowed]);
    const source = result.rows[0];
    if (!source) throw conflict('source_already_bound');
    await audit(client, manager, member, 'school_plan_source.approved', 'school_plan_source', source.id);
    return sourceResponse(source);
  });
}

export async function revokeSchoolPlanSource(manager: SchoolPlanMember, sourceId: string): Promise<void> {
  const id = parseSchoolPlan(uuidSchema, sourceId);
  await transaction(async (client) => {
    const member = await requireMember(client, manager);
    if (!member.capabilities.includes('household.manage')) throw forbidden();
    const result = await client.query(`UPDATE school_plan_sources SET revoked_at=clock_timestamp()
      WHERE household_id=$1 AND id=$2 AND revoked_at IS NULL`, [manager.householdId, id]);
    if (result.rowCount === 1) {
      // The last verified text plan remains as history, but the original PDF
      // can contain more child data and is no longer needed after revocation.
      await client.query(`DELETE FROM school_plan_pdf_snapshots snapshot USING school_plans plan
        WHERE snapshot.plan_id=plan.id AND snapshot.household_id=$1 AND plan.household_id=$1 AND plan.source_id=$2`,
      [manager.householdId, id]);
      await audit(client, manager, member, 'school_plan_source.revoked', 'school_plan_source', id);
    }
  });
}

export async function listSchoolPlanSourcesForManager(manager: SchoolPlanMember, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new DomainError('VALIDATION_FAILED', 400);
  return transaction(async (client) => {
    const member = await requireMember(client, manager);
    if (!member.capabilities.includes('household.manage')) throw forbidden();
    const result = await client.query<SourceRow>(`SELECT source.id,source.household_id,source.connection_id,source.person_id,source.class_key,
      source.source_page_url,source.display_pdf_links_allowed,connection.name connection_name
      FROM school_plan_sources source JOIN integration_connections connection
        ON connection.id=source.connection_id AND connection.household_id=source.household_id AND connection.revoked_at IS NULL
      WHERE source.household_id=$1 AND source.revoked_at IS NULL ORDER BY source.person_id,source.class_key,source.id LIMIT $2`, [manager.householdId, limit]);
    return result.rows.map(sourceResponse);
  });
}

export async function listSchoolPlanSources(actor: SchoolPlanActor, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new DomainError('VALIDATION_FAILED', 400);
  return transaction(async (client) => {
    const member = await requireActor(client, actor, readScope);
    const people = permittedPeople(actor, member);
    await actor.authorizeInTransaction?.(client, {
      write: false, personIds: people, sourceIds: actor.sourceIds, displayIds: [],
    });
    const result = await client.query<SourceRow>(`SELECT ${sourceColumns} FROM school_plan_sources
      WHERE household_id=$1 AND connection_id=$2 AND person_id=ANY($3::uuid[]) AND id=ANY($4::uuid[]) AND revoked_at IS NULL
      ORDER BY id LIMIT $5`, [actor.householdId, actor.connectionId, people, actor.sourceIds, limit]);
    return result.rows.map(sourceResponse);
  });
}

async function lockApprovedSource(client: PoolClient, actor: SchoolPlanActor, member: Membership,
  input: Pick<SchoolPlanUpsert, 'personId' | 'sourceId' | 'classKey' | 'sourcePageUrl'>): Promise<void> {
  if (!permittedPeople(actor, member).includes(input.personId) || !actor.sourceIds.includes(input.sourceId)) throw notFound();
  // Source-level serialization also covers concurrent initial writes when no week row exists yet.
  const result = await client.query(`
    SELECT id FROM school_plan_sources WHERE household_id=$1 AND connection_id=$2 AND id=$3 AND person_id=$4
      AND class_key=$5 AND source_page_url=$6 AND revoked_at IS NULL FOR UPDATE`,
  [actor.householdId, actor.connectionId, input.sourceId, input.personId, input.classKey, input.sourcePageUrl]);
  if (result.rowCount !== 1) throw notFound();
}

async function requireDisplayTargets(client: PoolClient, actor: SchoolPlanActor, member: Membership, input: SchoolPlanUpsert) {
  if (!input.displayIds.length) return;
  if (!member.capabilities.includes('message.publish.display') ||
      input.displayIds.some((id) => !actor.displayIds.includes(id))) throw forbidden();
  const result = await client.query(`
    SELECT d.id FROM displays d
    JOIN integration_connection_display_grants g ON g.household_id=d.household_id AND g.display_id=d.id AND g.connection_id=$2
    WHERE d.household_id=$1 AND d.id=ANY($3::uuid[]) AND d.revoked_at IS NULL
      AND ($4::boolean OR EXISTS(SELECT 1 FROM membership_display_grants mg
        WHERE mg.household_id=d.household_id AND mg.membership_id=$5 AND mg.display_id=d.id))
    ORDER BY d.id FOR SHARE OF d,g`,
  [actor.householdId, actor.connectionId, input.displayIds, member.capabilities.includes('display.manage'), actor.membershipId]);
  if (result.rowCount !== input.displayIds.length) throw forbidden();
}

type PlanKey = { sourceId: string; isoYear: number; isoWeek: number };
async function findPlan(client: PoolClient, actor: SchoolPlanActor, personIds: readonly string[], key: PlanKey) {
  if (!actor.sourceIds.includes(key.sourceId)) return undefined;
  return (await client.query<PlanRow>(`SELECT ${planColumns} ${planFrom}
    WHERE p.household_id=$1 AND p.connection_id=$2 AND p.person_id=ANY($3::uuid[])
      AND p.source_id=$4 AND p.iso_year=$5 AND p.iso_week=$6`,
  [actor.householdId, actor.connectionId, personIds, key.sourceId, key.isoYear, key.isoWeek])).rows[0];
}

async function readWrittenPlan(client: PoolClient, actor: SchoolPlanActor, input: SchoolPlanUpsert | SchoolPlanSourceFailure) {
  const row = await findPlan(client, actor, [input.personId], input);
  if (!row) throw new DomainError('INTERNAL_ERROR', 500);
  return row;
}

export async function upsertSchoolPlan(actor: SchoolPlanActor, raw: unknown) {
  const input = parseSchoolPlan(schoolPlanUpsertSchema, raw);
  validateSchoolPlanContent(input);
  const displayIds = [...input.displayIds].sort();
  const days = [...input.days].sort((left, right) => left.date.localeCompare(right.date));
  const contentHash = createHash('sha256').update(JSON.stringify({
    days, contentLocale: input.contentLocale, pdfUrl: input.pdfUrl, sourceRevision: input.sourceRevision,
    uncertainty: input.uncertainty,
  })).digest('hex');
  const observed = new Date(input.observedAt);
  const interpreted = new Date(input.interpretedAt);
  return transaction(async (client) => {
    const member = await requireActor(client, actor, writeScope);
    await actor.authorizeInTransaction?.(client, {
      write: true, personIds: [input.personId], sourceIds: [input.sourceId], displayIds,
    });
    await lockApprovedSource(client, actor, member, input);
    await requireDisplayTargets(client, actor, member, input);
    const existing = await findPlan(client, actor, [input.personId], input);
    const sameContent = existing?.content_hash === contentHash;
    const sameTargets = existing?.display_ids.join() === displayIds.join();
    if (existing && sameContent && sameTargets && observed <= existing.last_checked_at) {
      return mutationResult('unchanged', existing);
    }
    const revision = existing?.revision ?? 0;
    if (revision !== input.expectedRevision) throw conflict('revision_conflict', revision);
    if (existing && (observed < existing.last_checked_at || (existing.source_error && observed <= existing.last_checked_at))) {
      throw conflict('source_observation_outdated', revision);
    }

    if (existing && sameContent && sameTargets && !existing.source_error) {
      await client.query(`UPDATE school_plans SET last_source_observed_at=$2,last_checked_at=$2 WHERE id=$1`,
        [existing.id, observed]);
      return mutationResult('unchanged', existing);
    }

    let planId: string;
    if (existing) {
      planId = existing.id;
      await client.query(`UPDATE school_plans SET content_locale=$2,days=$3,pdf_url=$4,source_revision=$5,uncertainty=$6,
        observed_at=CASE WHEN $10::int=0 THEN observed_at ELSE $7 END,
        interpreted_at=CASE WHEN $10::int=0 THEN interpreted_at ELSE $8 END,
        last_source_observed_at=$7,last_checked_at=$7,source_error=NULL,content_hash=$9,
        content_revision=content_revision+$10,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
      [planId, input.contentLocale, JSON.stringify(days), input.pdfUrl, input.sourceRevision, input.uncertainty,
        observed, interpreted, contentHash, sameContent ? 0 : 1]);
    } else {
      const created = await client.query<{ id: string }>(`
        INSERT INTO school_plans(household_id,connection_id,person_id,source_id,iso_year,iso_week,week_starts_on,week_ends_on,
          content_locale,days,pdf_url,source_revision,uncertainty,observed_at,interpreted_at,last_source_observed_at,last_checked_at,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$14,$16) RETURNING id`,
      [actor.householdId, actor.connectionId, input.personId, input.sourceId, input.isoYear, input.isoWeek, input.startsOn, input.endsOn,
        input.contentLocale, JSON.stringify(days), input.pdfUrl, input.sourceRevision, input.uncertainty, observed, interpreted, contentHash]);
      planId = created.rows[0]!.id;
    }
    if (!sameTargets) {
      if (existing) await client.query('DELETE FROM school_plan_display_targets WHERE plan_id=$1', [planId]);
      if (displayIds.length) await client.query(`INSERT INTO school_plan_display_targets(household_id,plan_id,display_id)
        SELECT $1,$2,display_id FROM unnest($3::uuid[]) AS display_id`, [actor.householdId, planId, displayIds]);
    }
    const updated = await readWrittenPlan(client, actor, input);
    const result = existing ? 'updated' as const : 'created' as const;
    await audit(client, actor, member, `school_plan.${result}`, 'school_plan', planId,
      { connectionId: actor.connectionId, revision: updated.revision });
    return mutationResult(result, updated);
  });
}

export async function recordSchoolPlanSourceFailure(actor: SchoolPlanActor, raw: unknown) {
  const input = parseSchoolPlan(schoolPlanSourceFailureSchema, raw);
  isoWeekRange(input.isoYear, input.isoWeek);
  validateCheckTime(input.checkedAt);
  const checked = new Date(input.checkedAt);
  return transaction(async (client) => {
    const member = await requireActor(client, actor, writeScope);
    await actor.authorizeInTransaction?.(client, {
      write: true, personIds: [input.personId], sourceIds: [input.sourceId], displayIds: [],
    });
    await lockApprovedSource(client, actor, member, input);
    const row = await findPlan(client, actor, [input.personId], input);
    // A caller can report against the latest verified week during rollover.
    // A failed check for a week with no verified plan cannot create one.
    if (!row) throw notFound();
    if (checked.getTime() === row.last_checked_at.getTime() && input.reason === row.source_error) {
      return mutationResult('unchanged', row);
    }
    if (row.revision !== input.expectedRevision) throw conflict('revision_conflict', row.revision);
    if (checked <= row.last_checked_at) throw conflict('source_observation_outdated', row.revision);
    await client.query(`UPDATE school_plans SET source_error=$2,last_checked_at=$3,revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1`, [row.id, input.reason, checked]);
    const updated = await readWrittenPlan(client, actor, input);
    await audit(client, actor, member, 'school_plan.source_failed', 'school_plan', row.id,
      { connectionId: actor.connectionId, revision: updated.revision });
    return mutationResult('updated', updated);
  });
}

export async function getSchoolPlan(actor: SchoolPlanActor, raw: unknown) {
  const key = parseSchoolPlan(schoolPlanKeySchema, raw);
  isoWeekRange(key.isoYear, key.isoWeek);
  return transaction(async (client) => {
    const member = await requireActor(client, actor, readScope);
    const people = permittedPeople(actor, member);
    await actor.authorizeInTransaction?.(client, {
      write: false, personIds: people, sourceIds: [key.sourceId], displayIds: actor.displayIds,
    });
    const row = await findPlan(client, actor, people, key);
    if (!row) throw notFound();
    return actorPlan(row, actor);
  });
}

function validateFilterWeek(filter: SchoolPlanList): void {
  if (filter.isoYear !== undefined && filter.isoWeek !== undefined) isoWeekRange(filter.isoYear, filter.isoWeek);
}

export async function listSchoolPlans(actor: SchoolPlanActor, raw: unknown = {}) {
  const filter = parseSchoolPlan(schoolPlanListSchema, raw);
  validateFilterWeek(filter);
  return transaction(async (client) => {
    const member = await requireActor(client, actor, readScope);
    const people = constrainId(permittedPeople(actor, member), filter.personId);
    const sources = constrainId(actor.sourceIds, filter.sourceId);
    await actor.authorizeInTransaction?.(client, {
      write: false, personIds: people, sourceIds: sources, displayIds: actor.displayIds,
    });
    const result = await client.query<PlanRow>(`SELECT ${planColumns} ${planFrom}
      WHERE p.household_id=$1 AND p.connection_id=$2 AND p.person_id=ANY($3::uuid[])
        AND ($4::int IS NULL OR p.iso_year=$4) AND ($5::int IS NULL OR p.iso_week=$5) AND p.source_id=ANY($6::uuid[])
      ORDER BY p.week_starts_on DESC,p.id LIMIT $7`,
    [actor.householdId, actor.connectionId, people, filter.isoYear ?? null, filter.isoWeek ?? null, sources, filter.limit]);
    return result.rows.map((row) => actorPlan(row, actor));
  });
}

/** Recheck live grants and the plan revision both before and after the network call. */
export async function verifySchoolPlanPdf(actor: SchoolPlanActor, raw: unknown,
  fetcher: Pick<SchoolPdfFetcher, 'fetch'> = schoolPdfFetcher) {
  const key = parseSchoolPlan(schoolPlanVerifyPdfSchema, raw);
  isoWeekRange(key.isoYear, key.isoWeek);
  const candidate = await transaction(async (client) => {
    const member = await requireActor(client, actor, writeScope);
    const people = permittedPeople(actor, member);
    await actor.authorizeInTransaction?.(client, {
      write: true, personIds: people, sourceIds: [key.sourceId], displayIds: [],
    });
    const row = await findPlan(client, actor, people, key);
    if (!row?.pdf_url) throw notFound();
    if (row.revision !== key.expectedRevision) throw conflict('revision_conflict', row.revision);
    return { sourcePageUrl: row.source_page_url, pdfUrl: row.pdf_url, classKey: row.class_key,
      personId: row.person_id, priorSha: row.pdf_sha256 };
  });
  const bytes = await fetcher.fetch(candidate.sourcePageUrl, candidate.pdfUrl);
  if (bytes.length > MAX_SCHOOL_PDF_BYTES) throw new DomainError('SCHOOL_PDF_VERIFICATION_FAILED', 413, { reason: 'too_large' });
  validatePdfBytes(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return transaction(async (client) => {
    const member = await requireActor(client, actor, writeScope);
    await actor.authorizeInTransaction?.(client, {
      write: true, personIds: [candidate.personId], sourceIds: [key.sourceId], displayIds: [],
    });
    await lockApprovedSource(client, actor, member, { ...candidate, sourceId: key.sourceId });
    const row = await findPlan(client, actor, [candidate.personId], key);
    if (!row?.pdf_url) throw notFound();
    if (row.revision !== key.expectedRevision || row.pdf_url !== candidate.pdfUrl) {
      throw conflict('revision_conflict', row.revision);
    }
    if (row.pdf_sha256 === sha256 && row.pdf_verified_at) {
      return { result: 'unchanged' as const, sha256, verifiedAt: row.pdf_verified_at.toISOString() };
    }
    if (row.pdf_sha256 !== candidate.priorSha) throw conflict('pdf_snapshot_conflict', row.revision);

    // Different sources in the same household share the quota. No I/O is held under this lock.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('school-plan-pdf:'||$1::text,0))`, [actor.householdId]);
    const quota = await client.query<{ used: string }>(`SELECT COALESCE(sum(byte_size),0) AS used
      FROM school_plan_pdf_snapshots WHERE household_id=$1 AND plan_id<>$2`, [actor.householdId, row.id]);
    if (Number(quota.rows[0]!.used) + bytes.length > maxHouseholdPdfBytes) {
      throw new DomainError('SCHOOL_PDF_VERIFICATION_FAILED', 413, { reason: 'household_storage_quota' });
    }
    const stored = await client.query<{ verified_at: Date }>(`
      INSERT INTO school_plan_pdf_snapshots(household_id,plan_id,plan_content_revision,pdf_url,bytes,sha256)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(plan_id) DO UPDATE
      SET plan_content_revision=EXCLUDED.plan_content_revision,pdf_url=EXCLUDED.pdf_url,
        bytes=EXCLUDED.bytes,sha256=EXCLUDED.sha256,verified_at=clock_timestamp()
      RETURNING verified_at`, [actor.householdId, row.id, row.content_revision, row.pdf_url, bytes, sha256]);
    await audit(client, actor, member, 'school_plan.pdf_verified', 'school_plan', row.id,
      { connectionId: actor.connectionId, revision: row.revision });
    return { result: 'verified' as const, sha256, verifiedAt: stored.rows[0]!.verified_at.toISOString() };
  });
}

const displayPlanFrom = `${planFrom}
  JOIN school_plan_display_targets t ON t.plan_id=p.id AND t.household_id=p.household_id
  JOIN displays d ON d.id=t.display_id AND d.household_id=p.household_id
  JOIN integration_connection_display_grants g ON g.display_id=d.id AND g.household_id=d.household_id AND g.connection_id=p.connection_id
  JOIN display_setups setup ON setup.household_id=d.household_id AND setup.id=d.setup_id`;
const displayWhere = `d.household_id=$1 AND d.id=$2 AND d.credential_hash=$3 AND d.credential_generation=$4
  AND d.revoked_at IS NULL AND d.credential_expires_at>clock_timestamp()
  AND d.privacy_mode=false AND d.external_items_enabled=true AND setup.cards ? 'external_items'
  AND (setup.all_sources OR EXISTS(SELECT 1 FROM display_setup_sources selected
    WHERE selected.household_id=d.household_id AND selected.setup_id=d.setup_id AND selected.connection_id=p.connection_id))
  AND EXISTS(SELECT 1 FROM display_person_grants person_grant WHERE person_grant.household_id=d.household_id
    AND person_grant.display_id=d.id AND person_grant.person_id=p.person_id AND person_grant.profile_allowed)
  AND CASE WHEN d.person_ids_override IS NOT NULL THEN p.person_id=ANY(d.person_ids_override)
    ELSE EXISTS(SELECT 1 FROM display_setup_people selected WHERE selected.household_id=d.household_id
      AND selected.setup_id=d.setup_id AND selected.person_id=p.person_id) END`;

export async function listDisplaySchoolPlans(display: SchoolPlanDisplay, raw: unknown = {}) {
  const filter = parseSchoolPlan(schoolPlanDisplayListSchema, raw);
  validateFilterWeek(filter);
  const result = await pool.query<PresentationRow & { pdf_status: 'server_verified' | 'unverified_link' | null }>(`
    SELECT ${presentationColumns},CASE WHEN NOT s.display_pdf_links_allowed OR p.pdf_url IS NULL THEN NULL
      WHEN snapshot.plan_id IS NOT NULL THEN 'server_verified' ELSE 'unverified_link' END AS pdf_status ${displayPlanFrom}
    WHERE ${displayWhere} AND ($5::uuid IS NULL OR p.person_id=$5)
      AND ($6::int IS NULL OR p.iso_year=$6) AND ($7::int IS NULL OR p.iso_week=$7)
    ORDER BY p.week_starts_on DESC,p.id LIMIT $8`,
  [display.householdId, display.id, display.credentialHash, display.credentialGeneration, filter.personId ?? null,
    filter.isoYear ?? null, filter.isoWeek ?? null, filter.limit]);
  return result.rows.map((row) => ({
    ...planDetails(row),
    sourceStatus: row.source_error ? 'stale' as const : 'current' as const,
    lastSourceObservedAt: row.last_source_observed_at.toISOString(),
    uncertainty: row.uncertainty,
    pdfLinkAvailable: row.pdf_status === 'server_verified',
    pdfStatus: row.pdf_status,
  }));
}

function memberPlan(row: PresentationRow & { pdf_status: 'server_verified' | 'unverified_link' | null }) {
  return {
    ...planDetails(row),
    sourceStatus: row.source_error ? 'stale' as const : 'current' as const,
    lastSourceObservedAt: row.last_source_observed_at.toISOString(),
    uncertainty: row.uncertainty,
    pdfLinkAvailable: row.pdf_status === 'server_verified',
    pdfStatus: row.pdf_status,
  };
}

/** Browser-member projection spans all live connections in the household. It
 * deliberately omits source URLs, raw PDF URLs, connection IDs and targets. */
export async function listMemberSchoolPlans(member: SchoolPlanMember, raw: unknown = {}) {
  const filter = parseSchoolPlan(schoolPlanDisplayListSchema, raw);
  validateFilterWeek(filter);
  return transaction(async (client) => {
    const membership = await requireMember(client, member);
    const people = membership.capabilities.includes('household.manage') ? undefined : [membership.person_id];
    if (filter.personId && people && !people.includes(filter.personId)) return [];
    const result = await client.query<PresentationRow & { pdf_status: 'server_verified' | 'unverified_link' | null }>(`
      SELECT ${presentationColumns},CASE WHEN p.pdf_url IS NULL THEN NULL
        WHEN snapshot.plan_id IS NOT NULL THEN 'server_verified' ELSE 'unverified_link' END AS pdf_status ${planFrom}
      WHERE p.household_id=$1 AND ($2::uuid[] IS NULL OR p.person_id=ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR p.person_id=$3) AND ($4::int IS NULL OR p.iso_year=$4)
        AND ($5::int IS NULL OR p.iso_week=$5)
      ORDER BY p.week_starts_on DESC,p.id LIMIT $6`,
    [member.householdId, people ?? null, filter.personId ?? null, filter.isoYear ?? null, filter.isoWeek ?? null, filter.limit]);
    return result.rows.map(memberPlan);
  });
}

export async function getMemberSchoolPlan(member: SchoolPlanMember, planId: string) {
  const id = parseSchoolPlan(uuidSchema, planId);
  return transaction(async (client) => {
    const membership = await requireMember(client, member);
    const people = membership.capabilities.includes('household.manage') ? undefined : [membership.person_id];
    const row = (await client.query<PresentationRow & { pdf_status: 'server_verified' | 'unverified_link' | null }>(`
      SELECT ${presentationColumns},CASE WHEN p.pdf_url IS NULL THEN NULL
        WHEN snapshot.plan_id IS NOT NULL THEN 'server_verified' ELSE 'unverified_link' END AS pdf_status ${planFrom}
      WHERE p.household_id=$1 AND p.id=$2 AND ($3::uuid[] IS NULL OR p.person_id=ANY($3::uuid[]))`,
    [member.householdId, id, people ?? null])).rows[0];
    if (!row) throw notFound();
    return memberPlan(row);
  });
}

export async function getMemberSchoolPlanPdfSnapshot(member: SchoolPlanMember, planId: string) {
  const id = parseSchoolPlan(uuidSchema, planId);
  return transaction(async (client) => {
    const membership = await requireMember(client, member);
    const people = membership.capabilities.includes('household.manage') ? undefined : [membership.person_id];
    const row = (await client.query<{ bytes: Buffer; sha256: string; verified_at: Date }>(`
      SELECT snapshot.bytes,snapshot.sha256,snapshot.verified_at ${planFrom}
      WHERE p.household_id=$1 AND p.id=$2 AND snapshot.plan_id IS NOT NULL
        AND ($3::uuid[] IS NULL OR p.person_id=ANY($3::uuid[]))`, [member.householdId, id, people ?? null])).rows[0];
    if (!row) throw notFound();
    return {
      bytes: row.bytes,
      sha256: row.sha256,
      verifiedAt: row.verified_at.toISOString(),
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="school-plan.pdf"',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    };
  });
}

/** Call from an authenticated display route using same-origin referrer/redirect protections. */
export async function getDisplaySchoolPlanPdfLink(display: SchoolPlanDisplay, planId: string) {
  const id = parseSchoolPlan(uuidSchema, planId);
  const row = (await pool.query<{ pdf_url: string }>(`SELECT p.pdf_url ${displayPlanFrom}
    WHERE ${displayWhere} AND p.id=$5 AND s.display_pdf_links_allowed AND p.pdf_url IS NOT NULL`,
  [display.householdId, display.id, display.credentialHash, display.credentialGeneration, id])).rows[0];
  if (!row) throw notFound();
  return { status: 'unverified_link' as const, url: row.pdf_url };
}

/** Authorization and bytes are selected together. Apply these headers to a protected download response. */
export async function getDisplaySchoolPlanPdfSnapshot(display: SchoolPlanDisplay, planId: string) {
  const id = parseSchoolPlan(uuidSchema, planId);
  const row = (await pool.query<{ bytes: Buffer; sha256: string; verified_at: Date }>(`
    SELECT snapshot.bytes,snapshot.sha256,snapshot.verified_at ${displayPlanFrom}
    WHERE ${displayWhere} AND p.id=$5 AND s.display_pdf_links_allowed AND snapshot.plan_id IS NOT NULL`,
  [display.householdId, display.id, display.credentialHash, display.credentialGeneration, id])).rows[0];
  if (!row) throw notFound();
  return {
    bytes: row.bytes,
    sha256: row.sha256,
    verifiedAt: row.verified_at.toISOString(),
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="school-plan.pdf"',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}
