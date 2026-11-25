import type { CacheClock } from "./display-cache";
import { serverTime } from "./display-cache";
import type { HouseholdTimelineActivity } from "./home-types";
import { shiftHomeDate } from "./home-activity-presentation";
import { wallInput } from "./time";

export interface DisplayActivityScope {
  generation: string;
  clock: CacheClock;
  maxAgeMs: number;
}
export interface DisplayActivitySnapshot<T> {
  generation: string;
  clock: CacheClock;
  value: T;
}

/** Each accepted projection is a new authorization boundary. Its selectors do
 * not expose every grant revision, so an older activity response cannot stand
 * in for a read under the new projection. Nothing is persisted or queued. */
export function snapshotDisplayActivity<T>(scope: DisplayActivityScope, value: T, responseServerNow: string, monotonicNow: number): DisplayActivitySnapshot<T> {
  const responseAt = Date.parse(responseServerNow);
  const serverAt = Math.max(responseAt, serverTime(scope.clock, monotonicNow));
  const deadline = Math.min(scope.clock.deadline, serverAt + Math.min(900_000, scope.maxAgeMs));
  if (![responseAt, serverAt, deadline, monotonicNow].every(Number.isFinite) || scope.maxAgeMs <= 0 || deadline <= serverAt) throw new Error("invalid_display_activity_clock");
  return { generation: scope.generation, clock: { serverAt, monotonicAt: monotonicNow, deadline }, value };
}

export function currentDisplayActivity<T>(snapshot: DisplayActivitySnapshot<T> | null, scope: DisplayActivityScope, monotonicNow: number): DisplayActivitySnapshot<T> | null {
  if (!snapshot || snapshot.generation !== scope.generation) return null;
  const now = Math.max(serverTime(snapshot.clock, monotonicNow), serverTime(scope.clock, monotonicNow));
  return Number.isFinite(now) && now < Math.min(snapshot.clock.deadline, scope.clock.deadline) ? snapshot : null;
}

export function displayActivityAfterFailure<T>(snapshot: DisplayActivitySnapshot<T> | null, status?: number): DisplayActivitySnapshot<T> | null {
  return [401, 403, 404].includes(status ?? 0) ? null : snapshot;
}

/** Today retains completed timed events; Next also requires an unended event.
 * School remains actionable until its saved expiry, independently of start. */
export function displayActivityVisible(activity: HouseholdTimelineActivity, now: number, zone: string, next = false): boolean {
  if (!Number.isFinite(now)) return false;
  if (activity.expiresAt && !(Date.parse(activity.expiresAt) > now)) return false;
  if (activity.type === "school") return Date.parse(activity.expiresAt) > now;
  if (activity.publishAt && !(Date.parse(activity.publishAt) <= now)) return false;
  if (!next) return true;
  if (activity.metadata.calendar && activity.metadata.allDay && activity.startsAt) {
    const end = activity.endsAt?.slice(0, 10) ?? shiftHomeDate(activity.startsAt.slice(0, 10), 1);
    return end > wallInput(now, zone).slice(0, 10);
  }
  return activity.endsAt ? Date.parse(activity.endsAt) > now : Boolean(activity.startsAt && Date.parse(activity.startsAt) > now);
}

export interface PendingDisplayMessage {
  fingerprint: string;
  payload: {
    body: string;
    importance: "normal";
    audience: { personIds: string[]; displayIds: string[] };
    expiresAt: string;
    idempotencyKey: string;
  };
}
export interface DisplayMessageRecipients {
  people: Array<{ id: string; displayName: string }>;
  displays: Array<{ id: string; name: string }>;
}
export function permittedDisplayMessageAudience(audience: PendingDisplayMessage["payload"]["audience"], recipients: DisplayMessageRecipients): PendingDisplayMessage["payload"]["audience"] {
  return {
    personIds: audience.personIds.filter(id => recipients.people.some(person => person.id === id)),
    displayIds: audience.displayIds.filter(id => recipients.displays.some(display => display.id === id)),
  };
}
/** An ambiguous attempt may be retried only with its complete original audience.
 * Removing a recipient is a changed intent and must receive a different key. */
export function displayMessageAudienceAllowed(audience: PendingDisplayMessage["payload"]["audience"], recipients: DisplayMessageRecipients): boolean {
  const permitted = permittedDisplayMessageAudience(audience, recipients);
  return audience.personIds.length + audience.displayIds.length > 0 && permitted.personIds.length === audience.personIds.length && permitted.displayIds.length === audience.displayIds.length;
}
export function pendingDisplayMessage(previous: PendingDisplayMessage | null, draft: { body: string; personIds: string[]; displayIds: string[] }, serverNow: number, newKey: () => string): PendingDisplayMessage {
  const body = draft.body.trim(), personIds = [...new Set(draft.personIds)].sort(), displayIds = [...new Set(draft.displayIds)].sort();
  const fingerprint = JSON.stringify({ body, personIds, displayIds });
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, payload: { body, importance: "normal", audience: { personIds, displayIds }, expiresAt: new Date(serverNow + 86_400_000).toISOString(), idempotencyKey: newKey() } };
}
