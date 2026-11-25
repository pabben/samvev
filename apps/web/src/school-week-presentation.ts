export type SchoolWeekActivity = {
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  description?: string | null;
  practicalRequirements: string[];
};
export type SchoolWeekTextItem = { text: string; dueOn?: string | null };
export type SchoolWeekDeadline = { text: string; time?: string | null };
export type SchoolWeekReminder = { kind: 'after_school_standard' | 'after_school_exception' | 'general'; text: string; time?: string | null };
export type SchoolWeekDay = {
  date: string;
  kind: string;
  activities: SchoolWeekActivity[];
  practicalRequirements: string[];
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
  uncertainty: string | null;
  pdf: { status: string; url?: string | null };
};

export function schoolWeekDay(plan: Pick<SchoolWeekPlan, 'days'>, date: string) {
  return plan.days.find(day => day.date === date);
}

export function schoolWeekTomorrow(today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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

export function schoolWeekPdfAvailable(status: string) {
  return status === 'server_verified';
}
