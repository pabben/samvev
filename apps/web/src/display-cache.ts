import type { Projection } from "./types";
export interface CachedProjection {
  projection: Projection;
  savedAt: number;
  lastUpdated: string;
}
export interface CacheClock {
  serverAt: number;
  monotonicAt: number;
  deadline: number;
}
/** Never extend authorization when the wall clock moves backwards across reloads. */
export function restoreCache(
  value: CachedProjection,
  wallNow: number,
  monotonicNow: number,
): CacheClock | null {
  const elapsed = wallNow - value.savedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 900000)
    return null;
  const serverAt = Date.parse(value.projection.serverNow) + elapsed;
  const deadline = Math.min(
    Date.parse(value.projection.cacheUntil),
    Date.parse(value.projection.serverNow) + 900000,
  );
  if (
    !Number.isFinite(serverAt) ||
    !Number.isFinite(deadline) ||
    serverAt >= deadline
  )
    return null;
  return { serverAt, monotonicAt: monotonicNow, deadline };
}
export const serverTime = (clock: CacheClock, monotonicNow: number) =>
  clock.serverAt + Math.max(0, monotonicNow - clock.monotonicAt);
export function currentCards(
  projection: Projection,
  clock: CacheClock,
  monotonicNow: number,
) {
  const now = serverTime(clock, monotonicNow);
  return now >= clock.deadline
    ? []
    : projection.cards.filter(
        (card) =>
          Date.parse(card.expiresAt) > now && Date.parse(card.publishAt) <= now,
      );
}

/** External content shares the exact authorization deadline and monotonic clock. */
export function currentHub(projection: Projection, clock: CacheClock, monotonicNow: number) {
 const now=serverTime(clock,monotonicNow);
 if(now>=clock.deadline || !projection.hub)return undefined;
 const items=projection.hub.items.filter(item=>(!item.publishAt||Date.parse(item.publishAt)<=now)&&(!item.expiresAt||Date.parse(item.expiresAt)>now));
 const ids=new Set(items.flatMap(item=>item.targets.personIds));
 return {items,people:projection.hub.people.filter(person=>ids.has(person.id))};
}
