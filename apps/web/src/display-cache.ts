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
