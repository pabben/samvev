export type SchoolWeekActivity = {
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  description?: string | null;
  practicalRequirements: SchoolWeekRequirement[];
};
export type SchoolWeekRequirement = { kind: 'bring' | 'clothing' | 'prepare' | 'other'; text: string };
export type SchoolWeekTextItem = { text: string; dueOn?: string | null };
export type SchoolWeekDeadline = { text: string; time?: string | null };
export type SchoolWeekReminder = { kind: 'after_school_standard' | 'after_school_exception' | 'general'; text: string; time?: string | null };
export type SchoolWeekDay = {
  date: string;
  kind: string;
  activities: SchoolWeekActivity[];
  practicalRequirements: SchoolWeekRequirement[];
  homework: SchoolWeekTextItem[];
  deadlines: SchoolWeekDeadline[];
  reminders: SchoolWeekReminder[];
  weatherAdvice?: string | null;
};
export type SchoolWeekPlan = {
  id: string;
  personId: string;
  isoYear: number;
  isoWeek: number;
  startsOn: string;
  endsOn: string;
  contentLocale: 'en' | 'nb' | null;
  days: SchoolWeekDay[];
  revision: number;
  contentRevision: number;
  sourceStatus: 'current' | 'stale';
  sourceError: string | null;
  uncertainty: 'low' | 'medium' | 'high' | 'unknown' | null;
  pdfLinkAvailable: boolean;
  pdfStatus: 'server_verified' | 'unverified_link' | null;
};

const EMPTY_PREVIEW_PLANS: SchoolWeekPlan[] = [];

/** Preview mode may use only server-filtered data and must never fall back to a live endpoint fetch. */
export function schoolWeekPreviewPlans(isPreview: boolean, plans?: SchoolWeekPlan[]) {
  return isPreview ? plans ?? EMPTY_PREVIEW_PLANS : undefined;
}

export function schoolWeekDay(plan: Pick<SchoolWeekPlan, 'days'>, date: string) {
  return plan.days.find(day => day.date === date);
}

export function schoolWeekTomorrow(today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function schoolWeekActivityAlreadyShown(date: string, title: string, personId: string, activities: { date: string; title: string; personId?: string }[]) {
  const normalizedTitle = title.trim().toLocaleLowerCase();
  return activities.some(activity => activity.date === date && (!activity.personId || activity.personId === personId) && activity.title.trim().toLocaleLowerCase() === normalizedTitle);
}

export function schoolWeekIdentity(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const isoYear = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { isoYear, isoWeek };
}

export function schoolWeekPlansPath(today: string, options: { display: boolean; householdId?: string }) {
  const { isoYear, isoWeek } = schoolWeekIdentity(today);
  const base = options.display ? '/display/school-plans' : `/households/${encodeURIComponent(options.householdId ?? '')}/school-plans`;
  const query = new URLSearchParams({ isoYear: String(isoYear), isoWeek: String(isoWeek), limit: '20' });
  return `${base}?${query.toString()}`;
}

export function currentSchoolWeekPlans(plans: SchoolWeekPlan[], today: string, visiblePersonIds: string[]) {
  const currentWeek = schoolWeekIdentity(today);
  return plans.filter(plan => plan.isoYear === currentWeek.isoYear && plan.isoWeek === currentWeek.isoWeek && plan.startsOn <= today && plan.endsOn >= today && visiblePersonIds.includes(plan.personId));
}

/** Convert an ISO local calendar date to an instant at noon in its household zone. */
export function schoolWeekDateAtNoon(date: string, zone: string) {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) throw new Error('invalid_school_week_date');
  const desired = Date.UTC(year, month - 1, day, 12);
  let instant = desired;
  const partsFormatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(partsFormatter.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
    instant += desired - represented;
  }
  return new Date(instant);
}

export function schoolWeekHomework(plan: Pick<SchoolWeekPlan, 'days'>) {
  return plan.days.flatMap(day => day.homework.map(item => ({ ...item, dueOn: item.dueOn ?? day.date })))
    .sort((left, right) => (left.dueOn ?? '').localeCompare(right.dueOn ?? ''));
}

export function schoolWeekPdfAvailable(linkAvailable: boolean, status: SchoolWeekPlan['pdfStatus']) {
  return linkAvailable && status === 'server_verified';
}

export function schoolWeekRequirementKey(kind: SchoolWeekRequirement['kind']) {
  return ({ bring: 'schoolWeekRequirementBring', clothing: 'schoolWeekRequirementClothing', prepare: 'schoolWeekRequirementPrepare', other: 'schoolWeekRequirementOther' } as const)[kind];
}

export function schoolWeekUncertaintyKey(value: NonNullable<SchoolWeekPlan['uncertainty']>) {
  return ({ low: 'schoolWeekUncertaintyLow', medium: 'schoolWeekUncertaintyMedium', high: 'schoolWeekUncertaintyHigh', unknown: 'schoolWeekUncertaintyUnknown' } as const)[value];
}

export function schoolWeekTimeLabel(value?: string | null) {
  return value && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

export function requestSchoolWeekPdf<T>(planId: string, onOpenPdf: (planId: string) => T) {
  return onOpenPdf(planId);
}
