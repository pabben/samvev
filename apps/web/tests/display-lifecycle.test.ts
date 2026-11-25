import assert from "node:assert/strict";
import test from "node:test";
import { currentDisplayActivity, displayActivityAfterFailure, displayActivityVisible, displayMessageAudienceAllowed, permittedDisplayMessageAudience, pendingDisplayMessage, snapshotDisplayActivity, type DisplayActivityScope } from "../src/display-lifecycle.ts";
import type { HouseholdTimelineActivity, SchoolTimelineActivity } from "../src/home-types.ts";
import { formatCalendarEventRange } from "../src/time.ts";

const now = Date.parse("2026-10-16T03:30:00Z");
const scope: DisplayActivityScope = { generation: "synthetic-device:projection-1", clock: { serverAt: now, monotonicAt: 100, deadline: now + 900_000 }, maxAgeMs: 900_000 };
const calendar: Extract<HouseholdTimelineActivity, { type: "calendar" }> = {
  type: "calendar", id: "synthetic-calendar", personIds: [], contentLocale: "en", kind: "event", targets: { household: true, personIds: [] }, title: "Synthetic event", body: "Synthetic only", entries: [], priority: "normal",
  publishAt: new Date(now - 1000).toISOString(), startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), expiresAt: new Date(now + 120_000).toISOString(), source: { label: "Synthetic source", observedAt: new Date(now).toISOString(), uncertainty: "low" }, metadata: { calendar: { provider: "synthetic", sourceId: "synthetic-source", bridgeKind: "direct", subjectHousehold: true } }, revision: 1, updatedAt: new Date(now).toISOString(),
};
const school: SchoolTimelineActivity = { type: "school", id: "synthetic-school", taskId: "synthetic-task", personIds: [], date: "2026-10-15", time: "09:00", startsAt: "2026-10-15T19:00:00Z", kind: "preparation", title: "Synthetic school notice", actions: ["Bring synthetic item"], evidence: {}, confidence: 0.9, uncertainty: null, sourceUrl: null, recordedAt: null, expiresAt: new Date(now + 60_000).toISOString() };

test("a new accepted projection rejects old activity data even when selectors and the cache deadline look unchanged", () => {
  const snapshot = snapshotDisplayActivity(scope, [calendar], new Date(now).toISOString(), 100);
  assert.equal(currentDisplayActivity(snapshot, scope, 101), snapshot);
  assert.equal(currentDisplayActivity(snapshot, { ...scope, generation: "synthetic-device:projection-2" }, 101), null);
  assert.equal(currentDisplayActivity(snapshot, { ...scope, generation: "different-device:projection-1" }, 101), null);
});

test("transient failures preserve only the original snapshot deadline and authorization failures discard its data", () => {
  const shortScope = { ...scope, clock: { ...scope.clock, deadline: now + 1000 } };
  const snapshot = snapshotDisplayActivity(shortScope, [school], new Date(now).toISOString(), 100);
  assert.equal(displayActivityAfterFailure(snapshot, 503), snapshot);
  assert.equal(currentDisplayActivity(snapshot, { ...scope, clock: { ...scope.clock, deadline: now + 3_600_000 } }, 1100), null, "a newer outer deadline cannot extend last successful activity authorization");
  for (const status of [401, 403, 404]) assert.equal(displayActivityAfterFailure(snapshot, status), null);
  assert.equal(snapshot.clock.deadline, now + 1000);
});

test("activity lifetime uses a monotonic server clock, a fifteen minute ceiling, and fail-closed invalid times", () => {
  const longScope = { ...scope, maxAgeMs: 3_600_000, clock: { ...scope.clock, deadline: now + 3_600_000 } };
  const snapshot = snapshotDisplayActivity(longScope, calendar, new Date(now - 60_000).toISOString(), 1100);
  assert.equal(snapshot.clock.serverAt, now + 1000, "an older response timestamp cannot roll back the current server clock");
  assert.equal(snapshot.clock.deadline, now + 901_000);
  assert.equal(currentDisplayActivity(snapshot, longScope, 901_100), null);
  assert.throws(() => snapshotDisplayActivity(scope, [], "", 100), /invalid_display_activity_clock/);
  assert.throws(() => snapshotDisplayActivity({ ...scope, maxAgeMs: 0 }, [], new Date(now).toISOString(), 100), /invalid_display_activity_clock/);
  assert.equal(currentDisplayActivity(snapshot, longScope, Number.NaN), null);
});

test("successful empty activity data replaces old values instead of retaining a stale next item", () => {
  const old = snapshotDisplayActivity(scope, calendar, new Date(now).toISOString(), 100);
  const empty = snapshotDisplayActivity<HouseholdTimelineActivity | null>(scope, null, new Date(now + 1000).toISOString(), 1100);
  assert.equal(currentDisplayActivity(old, scope, 1100)?.value.id, calendar.id);
  assert.equal(currentDisplayActivity(empty, scope, 1100)?.value, null);
});

test("day chronology keeps completed timed events, but Next excludes ended events and both hide expired or unpublished content", () => {
  const ended = { ...calendar, endsAt: new Date(now).toISOString() };
  assert.equal(displayActivityVisible(ended, now, "Pacific/Honolulu"), true);
  assert.equal(displayActivityVisible(ended, now, "Pacific/Honolulu", true), false);
  assert.equal(displayActivityVisible({ ...calendar, expiresAt: new Date(now).toISOString() }, now, "UTC"), false);
  assert.equal(displayActivityVisible({ ...calendar, publishAt: new Date(now + 1).toISOString() }, now, "UTC"), false);
  assert.equal(displayActivityVisible({ ...calendar, endsAt: null, startsAt: new Date(now).toISOString() }, now, "UTC", true), false);
});

test("school remains actionable after its start and stops exactly at saved expiry", () => {
  assert.equal(displayActivityVisible(school, now, "Pacific/Honolulu", true), true);
  assert.equal(displayActivityVisible(school, now + 60_000, "Pacific/Honolulu", true), false);
  assert.equal(displayActivityVisible({ ...school, expiresAt: "" }, now, "UTC"), false);
});

test("Next applies civil all-day exclusive ends and a missing end means one local day across east/west offsets", () => {
  const allDay = { ...calendar, startsAt: "2026-10-15T00:00:00Z", endsAt: "2026-10-16T00:00:00Z", expiresAt: null, metadata: { ...calendar.metadata, allDay: true } };
  assert.equal(displayActivityVisible(allDay, now, "Pacific/Honolulu", true), true, "UTC marker has passed but Honolulu's local midnight has not");
  assert.equal(displayActivityVisible(allDay, Date.parse("2026-10-16T10:00:00Z"), "Pacific/Honolulu", true), false);
  const east = { ...allDay, publishAt: null };
  assert.equal(displayActivityVisible(east, Date.parse("2026-10-15T23:30:00Z"), "Pacific/Kiritimati", true), false);
  assert.equal(displayActivityVisible({ ...allDay, endsAt: null }, now, "Pacific/Honolulu", true), true);
  assert.equal(displayActivityVisible({ ...allDay, endsAt: null }, Date.parse("2026-10-16T10:00:00Z"), "Pacific/Honolulu", true), false);
  assert.match(formatCalendarEventRange("2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z", "en", "Pacific/Honolulu", true), /16/);
});

test("ambiguous send retries preserve the exact payload, key and expiry; an explicit changed draft creates a new attempt", () => {
  let keys = 0; const key = () => `synthetic-key-${++keys}`;
  const draft = { body: " Synthetic message ", personIds: ["b", "a", "a"], displayIds: [] };
  const first = pendingDisplayMessage(null, draft, now, key);
  const retry = pendingDisplayMessage(first, { ...draft, body: "Synthetic message", personIds: ["a", "b"] }, now + 3_600_000, key);
  assert.equal(retry, first); assert.deepEqual(retry.payload, first.payload); assert.equal(keys, 1);
  const changed = pendingDisplayMessage(first, { ...draft, body: "Explicit changed intent" }, now + 3_600_000, key);
  assert.equal(keys, 2); assert.notEqual(changed.payload.idempotencyKey, first.payload.idempotencyKey); assert.notEqual(changed.payload.expiresAt, first.payload.expiresAt);
});


test("current recipient allowlists remove revoked people and devices without treating a reduced audience as the same ambiguous attempt", () => {
  const recipients = { people: [{ id: "retained-person", displayName: "Synthetic retained person" }], displays: [{ id: "retained-display", name: "Synthetic retained display" }] };
  const original = { personIds: ["removed-person", "retained-person"], displayIds: ["removed-display", "retained-display"] };
  const permitted = permittedDisplayMessageAudience(original, recipients);
  assert.deepEqual(permitted, { personIds: ["retained-person"], displayIds: ["retained-display"] });
  assert.equal(displayMessageAudienceAllowed(original, recipients), false);
  assert.equal(displayMessageAudienceAllowed(permitted, recipients), true);
  assert.equal(displayMessageAudienceAllowed({ personIds: [], displayIds: [] }, recipients), false);
  const previous = pendingDisplayMessage(null, { body: "Synthetic ambiguous attempt", ...original }, now, () => "original-key");
  const next = pendingDisplayMessage(displayMessageAudienceAllowed(previous.payload.audience, recipients) ? previous : null, { body: previous.payload.body, ...permitted }, now + 1000, () => "new-key");
  assert.equal(next.payload.idempotencyKey, "new-key");
  assert.deepEqual(next.payload.audience, permitted);
});

test("recipient revalidation preserves the complete pending payload through unchanged grants, reordered lists and reconnect", () => {
  const recipients = { people: [{ id: "b", displayName: "Synthetic B" }, { id: "a", displayName: "Synthetic A" }], displays: [{ id: "d", name: "Synthetic display" }] };
  const first = pendingDisplayMessage(null, { body: "Synthetic retained draft", personIds: ["a", "b"], displayIds: ["d"] }, now, () => "retained-key");
  assert.equal(displayMessageAudienceAllowed(first.payload.audience, recipients), true);
  const audience = permittedDisplayMessageAudience(first.payload.audience, recipients);
  const retry = pendingDisplayMessage(first, { body: first.payload.body, ...audience }, now + 10_000, () => assert.fail("must not allocate a new key after unchanged authorization"));
  assert.equal(retry, first);
  assert.deepEqual(retry.payload, first.payload);
});
