import { test } from "node:test";
import assert from "node:assert/strict";
import {
  restoreCache,
  currentCards,
  serverTime,
} from "../src/display-cache.ts";
import type { Projection } from "../src/types.ts";
const now = Date.parse("2026-09-07T05:00:00Z");
const projection: Projection = {
  display: {
    id: "d",
    name: "Example",
    householdName: "Example",
    locale: "en",
    theme: "light",
    privacyMode: false,
  },
  cards: [
    {
      id: "m",
      kind: "household_message",
      body: "Synthetic",
      importance: "normal",
      author: "Example",
      publishAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
      revision: 1,
    },
  ],
  serverNow: new Date(now).toISOString(),
  generatedAt: new Date(now).toISOString(),
  cacheUntil: new Date(now + 900000).toISOString(),
  maxStaleSeconds: 900,
};
test("cache reload preserves expiry and rejects backward clock or TTL extension", () => {
  const value = {
    projection,
    savedAt: now,
    lastUpdated: projection.generatedAt,
  };
  assert.equal(restoreCache(value, now - 1, 0), null);
  assert.equal(restoreCache(value, now + 900000, 0), null);
  const clock = restoreCache(value, now + 30000, 100)!;
  assert.equal(currentCards(projection, clock, 100).length, 1);
  assert.equal(currentCards(projection, clock, 30101).length, 0);
  assert.equal(serverTime(clock, 100), now + 30000);
});
test("cache deadline clears every card independently of a later card expiry", () => {
  const clock = { serverAt: now, monotonicAt: 0, deadline: now + 1000 };
  assert.equal(currentCards(projection, clock, 1001).length, 0);
});
test("early expiry preserves later cards and fixed reload deadline", () => {
  const later = {
    ...projection.cards[0]!,
    id: "later",
    expiresAt: new Date(now + 1200000).toISOString(),
  };
  const value = {
    projection: { ...projection, cards: [projection.cards[0]!, later] },
    savedAt: now,
    lastUpdated: projection.generatedAt,
  };
  const clock = restoreCache(value, now + 61000, 0)!;
  assert.deepEqual(
    currentCards(value.projection, clock, 0).map((c) => c.id),
    ["later"],
  );
  assert.equal(value.projection.display.name, "Example");
  assert.equal(clock.deadline, now + 900000);
  assert.equal(restoreCache(value, now + 900001, 0), null);
});
