import { isIP } from 'node:net';
import { DomainError } from '@samvev/core';
import { localeSchema, uuidSchema } from '@samvev/contracts';
import { z } from 'zod';

const text = (limit: number) => z.string().trim().min(1).max(limit)
  .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cs}]+$/u);
const shortText = text(160);
const detail = text(500);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const revision = z.number().int().min(0).max(2_147_483_646);
const classKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const pdfSecretParam = /token|secret|password|credential|signature|session|authorization|(?:^|[-_])(?:key|sig|auth|jwt|access)(?:$|[-_])/i;

// The URL remains byte-for-byte exact. No URL is dereferenced by this service.
const sourceUrl = z.string().url().max(2048).refine((value) => {
  if (!value.startsWith('https://') || /[\s\\#\u0000-\u001f\u007f]/u.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  const host = url.hostname.replace(/\.$/, '');
  return !url.username && !url.password && !url.port && !host.startsWith('[') && !isIP(host) &&
    host.includes('.') && !/(?:^|\.)(?:localhost|local|internal|lan|home|arpa)$/.test(host) &&
    [...url.searchParams.keys()].every((key) => !pdfSecretParam.test(key));
}, 'school_source_url_invalid');

export const schoolPlanSourceApprovalSchema = z.strictObject({
  connectionId: uuidSchema,
  personId: uuidSchema,
  classKey,
  sourcePageUrl: sourceUrl,
  displayPdfLinksAllowed: z.boolean().default(false),
});

const week = {
  isoYear: z.number().int().min(1900).max(9998),
  isoWeek: z.number().int().min(1).max(53),
};
export const schoolPlanKeySchema = z.strictObject({ sourceId: uuidSchema, ...week });
export const schoolPlanListSchema = z.strictObject({
  personId: uuidSchema.optional(),
  sourceId: uuidSchema.optional(),
  isoYear: week.isoYear.optional(),
  isoWeek: week.isoWeek.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const schoolPlanDisplayListSchema = schoolPlanListSchema.omit({ sourceId: true });

const practicalRequirement = z.strictObject({
  kind: z.enum(['bring', 'clothing', 'prepare', 'other']),
  text: detail,
});
const activity = z.strictObject({
  title: shortText,
  startsAt: time.optional(),
  endsAt: time.optional(),
  description: detail.optional(),
  practicalRequirements: z.array(practicalRequirement).max(10).default([]),
});
const reminder = z.strictObject({
  kind: z.enum(['after_school_standard', 'after_school_exception', 'general']),
  text: detail,
  time: time.optional(),
});
const day = z.strictObject({
  date,
  kind: z.enum(['school', 'school_free', 'unknown']),
  activities: z.array(activity).max(15).default([]),
  practicalRequirements: z.array(practicalRequirement).max(15).default([]),
  homework: z.array(z.strictObject({ text: detail, dueOn: date.optional() })).max(10).default([]),
  deadlines: z.array(z.strictObject({ text: detail, time: time.optional() })).max(10).default([]),
  reminders: z.array(reminder).max(10).default([]),
  weatherAdvice: detail.optional(),
});
const approvedSourceKey = schoolPlanKeySchema.extend({ personId: uuidSchema, classKey, sourcePageUrl: sourceUrl });
export const schoolPlanUpsertSchema = approvedSourceKey.extend({
  expectedRevision: revision,
  contentLocale: localeSchema,
  startsOn: date,
  endsOn: date,
  days: z.array(day).min(1).max(7),
  pdfUrl: sourceUrl.nullable(),
  sourceRevision: shortText,
  observedAt: timestamp,
  interpretedAt: timestamp,
  uncertainty: z.enum(['low', 'medium', 'high', 'unknown']),
  displayIds: z.array(uuidSchema).max(32).default([]),
});

export const schoolPlanSourceFailureSchema = approvedSourceKey.extend({
  expectedRevision: revision,
  checkedAt: timestamp,
  reason: z.enum(['unavailable', 'timeout', 'access_denied', 'document_missing', 'document_unreadable', 'wrong_class', 'unverified_content']),
});

export type SchoolPlanUpsert = z.output<typeof schoolPlanUpsertSchema>;
export type SchoolPlanDay = SchoolPlanUpsert['days'][number];
export type SchoolPlanSourceFailure = z.output<typeof schoolPlanSourceFailureSchema>;
export type SchoolPlanList = z.output<typeof schoolPlanListSchema>;

export function parseSchoolPlan<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw invalidSchoolPlan('invalid_input');
  return result.data;
}

type InvalidReason = 'invalid_input' | 'invalid_week' | 'invalid_day' | 'invalid_time' | 'empty_plan' |
  'invalid_pdf_origin' | 'invalid_timestamp' | 'duplicate_display' | 'plan_too_large';
export function invalidSchoolPlan(reason: InvalidReason): DomainError {
  return new DomainError('VALIDATION_FAILED', 400, { reason });
}

export function isoWeekRange(year: number, weekNumber: number): { startsOn: string; endsOn: string } {
  const monday = new Date(Date.UTC(year, 0, 4));
  const firstMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - firstMonday + (weekNumber - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  if (thursday.getUTCFullYear() !== year) throw invalidSchoolPlan('invalid_week');
  return { startsOn: monday.toISOString().slice(0, 10), endsOn: sunday.toISOString().slice(0, 10) };
}

export function validateSchoolPlanContent(input: SchoolPlanUpsert): void {
  const { startsOn, endsOn } = isoWeekRange(input.isoYear, input.isoWeek);
  if (startsOn !== input.startsOn || endsOn !== input.endsOn) throw invalidSchoolPlan('invalid_week');
  const dates = new Set<string>();
  let meaningful = false;
  for (const day of input.days) {
    if (dates.has(day.date) || day.date < startsOn || day.date > endsOn) throw invalidSchoolPlan('invalid_day');
    dates.add(day.date);
    if (day.activities.some((item) => item.startsAt && item.endsAt && item.endsAt < item.startsAt)) {
      throw invalidSchoolPlan('invalid_time');
    }
    // An explicit kind alone can preserve a declared school-free date.
    if (day.kind === 'school_free' || day.activities.length || day.practicalRequirements.length ||
        day.homework.length || day.deadlines.length) meaningful = true;
  }
  if (!meaningful) throw invalidSchoolPlan('empty_plan');
  // Leave slack for PostgreSQL's canonical JSON formatting.
  if (Buffer.byteLength(JSON.stringify(input.days)) > 120_000) throw invalidSchoolPlan('plan_too_large');
  const page = new URL(input.sourcePageUrl);
  if (input.pdfUrl && (new URL(input.pdfUrl).origin !== page.origin || new URL(input.pdfUrl).href === page.href)) {
    throw invalidSchoolPlan('invalid_pdf_origin');
  }
  if (Date.parse(input.interpretedAt) < Date.parse(input.observedAt)) throw invalidSchoolPlan('invalid_timestamp');
  validateCheckTime(input.observedAt);
  validateCheckTime(input.interpretedAt);
  if (new Set(input.displayIds).size !== input.displayIds.length) throw invalidSchoolPlan('duplicate_display');
}

export function validateCheckTime(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > Date.now() + 5 * 60_000) throw invalidSchoolPlan('invalid_timestamp');
}
