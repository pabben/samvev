import type { DinnerAssignment } from "./household-board-adapters";
import type { HomeSchoolActivity, HouseholdTimelineActivity } from "./home-types";
import { wallInput } from "./time";

export type TimelineEntry =
  | { kind: "calendar"; id: string; date: string; activity: Extract<HouseholdTimelineActivity, { type: "calendar" }> }
  | { kind: "school"; id: string; date: string; activity: Extract<HouseholdTimelineActivity, { type: "school" }> }
  | { kind: "dinner"; id: string; date: string; title: string; emoji: string | null };

/** Timed activities have an exclusive end. Without an end, their start is a
 * point in time and cannot keep an activity current after that point. */
export function timedActivityUnended(startsAt: string | null, endsAt: string | null, now: number): boolean {
  if (!startsAt) return false;
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return false;
  if (!endsAt) return start >= now;
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && end > start && now < end;
}

/** Today and tomorrow cards only show activities in that local window. */
export function currentCalendarActivityRelevant(startsAt: string | null, endsAt: string | null, allDay: boolean, now: number, zone: string): boolean {
  if (!startsAt || !Number.isFinite(now)) return false;
  const today = wallInput(now, zone).slice(0, 10);
  const tomorrow = shiftHomeDate(today, 1);
  if (allDay) {
    const start = startsAt.slice(0, 10);
    const candidateEnd = endsAt?.slice(0, 10);
    if (endsAt && (!candidateEnd || candidateEnd <= start)) return false;
    const end = candidateEnd ?? shiftHomeDate(start, 1);
    return end > today && start <= tomorrow;
  }
  if (!timedActivityUnended(startsAt, endsAt, now)) return false;
  const startDay = wallInput(startsAt, zone).slice(0, 10);
  return startDay <= tomorrow;
}

export function calendarActivityEnded(startsAt: string | null, endsAt: string | null, allDay: boolean, now: number, zone: string): boolean {
  if (!startsAt || !Number.isFinite(now)) return false;
  if (allDay) {
    const start = startsAt.slice(0, 10);
    const candidateEnd = endsAt?.slice(0, 10);
    if (endsAt && (!candidateEnd || candidateEnd <= start)) return false;
    const end = candidateEnd ?? shiftHomeDate(start, 1);
    return end <= wallInput(now, zone).slice(0, 10);
  }
  if (endsAt) return Date.parse(endsAt) <= now;
  return Date.parse(startsAt) < now;
}

/** Day and history views retain completed rows; current cards use the stricter predicate above. */
export function timelineDayHistoryVisible(activity: HouseholdTimelineActivity, now: number): boolean {
  if (!Number.isFinite(now)) return false;
  if (activity.type === "school") return true;
  if (activity.publishAt && !(Date.parse(activity.publishAt) <= now)) return false;
  return true;
}

export function timelineActivityVisible(activity: HouseholdTimelineActivity, now: number, zone: string, next = false): boolean {
  if (activity.expiresAt && !(Date.parse(activity.expiresAt) > now)) return false;
  if (activity.type === "school") return !activity.expiresAt || Date.parse(activity.expiresAt) > now;
  if (["cancelled", "canceled", "declined"].includes(activity.metadata.calendar?.status ?? "")) return false;
  if (activity.publishAt && !(Date.parse(activity.publishAt) <= now)) return false;
  if (activity.metadata.calendar && activity.metadata.allDay) {
    const start = activity.startsAt?.slice(0, 10) ?? "";
    const candidateEnd = activity.endsAt?.slice(0, 10);
    if (activity.endsAt && (!candidateEnd || candidateEnd <= start)) return false;
    const end = candidateEnd ?? shiftHomeDate(start, 1);
    const today = wallInput(now, zone).slice(0, 10);
    return next ? end > today : currentCalendarActivityRelevant(activity.startsAt, activity.endsAt, true, now, zone);
  }
  return next ? timedActivityUnended(activity.startsAt, activity.endsAt, now) : currentCalendarActivityRelevant(activity.startsAt, activity.endsAt, false, now, zone);
}

export function homeWeekStart(localDate: string): string {
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return shiftHomeDate(localDate, -((day + 6) % 7));
}
export function homeWeekTitleKey(weekStart:string,currentWeek:string){return weekStart===currentWeek?"hubWeekTitle":"hubFutureWeekTitle";}
export function isTimelineActivityOngoing(activity:HouseholdTimelineActivity,localDate:string,now:number):boolean{
  if(activity.type!=="calendar"||!activity.startsAt)return false;
  if(activity.metadata.calendar&&activity.metadata.allDay){
    const start=activity.startsAt.slice(0,10);
    const endExclusive=activity.endsAt?.slice(0,10)??shiftHomeDate(start,1);
    return start<=localDate&&localDate<endExclusive;
  }
  const start=Date.parse(activity.startsAt);
  return activity.endsAt ? start<=now&&timedActivityUnended(activity.startsAt,activity.endsAt,now) : start===now;
}

export function personFutureWindow(weekStart:string,localDate:string){
  return {from:weekStart>localDate?weekStart:localDate,to:shiftHomeDate(weekStart,6)};
}

export function shiftHomeDate(localDate: string, offset: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function mergeTimelineEntries(activities: HouseholdTimelineActivity[], dinners: DinnerAssignment[], zone = "UTC", rangeStart?: string, rangeEnd?: string): TimelineEntry[] {
  const rows: TimelineEntry[] = [];
  for (const activity of activities) {
    if (activity.type === "school") rows.push({ kind: "school", id: activity.id, date: activity.date, activity });
    else {
      if (activity.endsAt && activity.startsAt) {
        if (activity.metadata.calendar && activity.metadata.allDay) {
          if (activity.endsAt.slice(0, 10) <= activity.startsAt.slice(0, 10)) continue;
        } else if (!Number.isFinite(Date.parse(activity.startsAt)) || !Number.isFinite(Date.parse(activity.endsAt)) || Date.parse(activity.endsAt) <= Date.parse(activity.startsAt)) continue;
      }
      const allDay=Boolean(activity.metadata.calendar&&activity.metadata.allDay);
      const start = activity.startsAt ? allDay ? activity.startsAt.slice(0, 10) : wallInput(activity.startsAt, zone).slice(0, 10) : "";
      const endExclusive = activity.endsAt ? allDay ? activity.endsAt.slice(0, 10) : wallInput(Date.parse(activity.endsAt) - 1, zone).slice(0, 10) : start;
      // All-day ends are exclusive civil dates; an item ending on the first
      // requested date does not overlap that date. Timed ends above are
      // converted to their final occupied local date.
      if (rangeStart && (allDay && activity.endsAt ? endExclusive <= rangeStart : endExclusive < rangeStart) || rangeEnd && start > rangeEnd) continue;
      const date = rangeStart && start < rangeStart ? rangeStart : start;
      rows.push({ kind: "calendar", id: activity.id, date, activity });
    }
  }
  for (const dinner of dinners) if (dinner.title && (!rangeStart || dinner.localDate >= rangeStart) && (!rangeEnd || dinner.localDate <= rangeEnd)) rows.push({ kind: "dinner", id: dinner.id, date: dinner.localDate, title: dinner.title, emoji: dinner.emoji });
  return rows.sort((a, b) => a.date.localeCompare(b.date) || timeKey(a, zone).localeCompare(timeKey(b, zone)) || kindRank(a.kind) - kindRank(b.kind) || a.id.localeCompare(b.id));
}

function timeKey(row: TimelineEntry, zone: string): string {
  if (row.kind === "school") return row.activity.time ?? "";
  if (row.kind === "calendar") return row.activity.metadata.calendar&&row.activity.metadata.allDay || !row.activity.startsAt ? "" : wallInput(row.activity.startsAt, zone).slice(11, 16);
  return "99:99";
}
function kindRank(kind: TimelineEntry["kind"]): number { return kind === "dinner" ? 0 : kind === "school" ? 1 : 2; }

export function dedupeTimelineActivities(activities: HouseholdTimelineActivity[]): HouseholdTimelineActivity[] {
  const unique = new Map<string, HouseholdTimelineActivity>();
  for (const row of activities) {
    const existing = unique.get(row.id);
    if (existing?.type === "school" && row.type === "school") {
      unique.set(row.id, { ...row, personIds: [...new Set([...existing.personIds, ...row.personIds])].sort() });
    } else if (!existing) unique.set(row.id, row);
  }
  return [...unique.values()];
}

export type GroupedSchoolActivity = Omit<HomeSchoolActivity, "personId"> & { personIds: string[] };
export async function collectActivitySourcePages(fetchPage:(cursor?:string)=>Promise<{sources:{id:string;name:string}[];nextCursor:string|null}>,locale:string){
  const sources:{id:string;name:string}[]=[];let cursor:string|undefined;
  for(let page=0;page<100;page++){
    const result=await fetchPage(cursor);sources.push(...result.sources);cursor=result.nextCursor??undefined;
    if(!cursor)return sources.sort((a,b)=>a.name.localeCompare(b.name,locale,{sensitivity:"base"}));
  }
  throw new Error("Activity source catalog exceeded its bounded page limit.");
}
export function groupHomeSchoolActivities(rows: HomeSchoolActivity[]): GroupedSchoolActivity[] {
  const grouped = new Map<string, GroupedSchoolActivity>();
  for (const row of rows) {
    const current = grouped.get(row.id);
    if (current) current.personIds = [...new Set([...current.personIds, row.personId])].sort();
    else grouped.set(row.id, { ...row, personIds: [row.personId] });
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
}
