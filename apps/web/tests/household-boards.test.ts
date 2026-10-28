import assert from "node:assert/strict";
import test from "node:test";
import { dateOffset, displayHouseholdBoardAdapter, memberHouseholdBoardAdapter, sevenDayWindow } from "../src/household-board-adapters.ts";
import { mayApplyBoardRead, mutationFailure, reconcileBoardSnapshot } from "../src/household-board-state.ts";
import { secureUuid } from "../src/secure-uuid.ts";
import { todayDinnerSummary } from "../src/household-board-summary.ts";

test("dinner windows preserve calendar dates across month, leap day, and year boundaries", () => {
  assert.equal(dateOffset("2028-02-28", 1), "2028-02-29");
  assert.deepEqual(sevenDayWindow("2028-02-27"), { from: "2028-02-27", to: "2028-03-04" });
  assert.equal(dateOffset("2026-12-31", 1), "2027-01-01");
});

test("compact Home dinner preview describes today without contradicting a planned dinner tomorrow",()=>{
 const assignments=[{id:"tomorrow",localDate:"2026-10-29",title:"Fiskegrateng",emoji:"🐟",revision:1,cleared:false}];
 assert.equal(todayDinnerSummary(assignments,"2026-10-28",true).kind,"empty");
 assert.equal(todayDinnerSummary(assignments,"2026-10-28",false).kind,"unavailable");
 assert.equal(todayDinnerSummary(assignments,"2026-10-29",true).kind,"planned");
});

test("member board adapter uses only household endpoints and passes the revision/idempotency contract", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const adapter = memberHouseholdBoardAdapter("household id");
    await adapter.listGroceries();
    await adapter.updateGrocery("item/1", { checked: true, expectedRevision: 3, requestKey: "req-1" });
    assert.equal(calls[0]?.url, "/api/v1/households/household%20id/groceries");
    assert.equal(calls[1]?.url, "/api/v1/households/household%20id/groceries/item%2F1");
    assert.equal(calls[1]?.method, "PATCH");
    assert.deepEqual(calls[1]?.body, { checked: true, expectedRevision: 3, requestKey: "req-1" });
  } finally { globalThis.fetch = originalFetch; }
});

test("display adapter is device-scoped and read-only unless the caller supplies explicit action grants", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method ?? "GET" });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const readOnly = displayHouseholdBoardAdapter("display-fixture-a", { groceries: true });
    assert.equal(readOnly.scopeKey, "display:display-fixture-a");
    assert.throws(() => displayHouseholdBoardAdapter(" "), /display ID is required/);
    assert.deepEqual(readOnly.writable, { groceries: false, dinners: false });
    assert.deepEqual(readOnly.readable, { groceries: true, dinners: false });
    await readOnly.listGroceries();
    assert.equal(calls[0]?.url, "/api/v1/display/groceries");
    const granted = displayHouseholdBoardAdapter("display-fixture-a", { groceries: true }, { groceries: true });
    assert.deepEqual(granted.writable, { groceries: true, dinners: false });
    await granted.listDinners({ from: "2026-10-16", to: "2026-10-22" });
    assert.equal(calls[1]?.url, "/api/v1/display/dinners?from=2026-10-16&to=2026-10-22");
  } finally { globalThis.fetch = originalFetch; }
});

test("board snapshot controller keeps unknown distinct from empty and retains prior data only on transient errors", () => {
  const unknown = { value: undefined, state: "unknown" as const };
  assert.deepEqual(reconcileBoardSnapshot(unknown, { error: { status: 0 } }), unknown);
  const firstEmpty = reconcileBoardSnapshot(unknown, { value: [] as string[] });
  assert.deepEqual(firstEmpty, { value: [], state: "fresh" });
  const previousGroceries = { value: [{ id: "item-a", label: "fixture", checked: false, revision: 2 }], state: "fresh" as const };
  assert.deepEqual(reconcileBoardSnapshot(previousGroceries, { error: { status: 0 } }), { ...previousGroceries, state: "stale" });
  assert.deepEqual(reconcileBoardSnapshot(previousGroceries, { error: { status: 403 } }), { value: undefined, state: "denied" });
  assert.deepEqual(reconcileBoardSnapshot(previousGroceries, { value: [] }), { value: [], state: "fresh" });
  const dinner = { value: [{ id: "dinner-a", localDate: "2026-10-16", title: "fixture", emoji: "🍲", revision: 1, cleared: false }], state: "fresh" as const };
  const groceryAfterDeniedDinner = reconcileBoardSnapshot(previousGroceries, { value: previousGroceries.value });
  const deniedDinner = reconcileBoardSnapshot(dinner, { error: { status: 404 } });
  assert.equal(deniedDinner.state, "denied");
  assert.equal(groceryAfterDeniedDinner.state, "fresh", "a denied dinner endpoint must not discard an independently readable grocery board");
});

test("superseded polling cannot overwrite a committed mutation or leak into a changed household view", () => {
  assert.equal(mayApplyBoardRead("member:old|groceries", "member:new|groceries", 4, 4), false);
  assert.equal(mayApplyBoardRead("member:one|groceries", "member:one|groceries", 4, 5), false);
  assert.equal(mayApplyBoardRead("member:one|groceries", "member:one|groceries", 5, 5), true);
  assert.deepEqual(mutationFailure(409), { refresh: true, revokeBoard: false, clearAll: false, message: "boardChangedRefresh" });
  assert.deepEqual(mutationFailure(403), { refresh: false, revokeBoard: true, clearAll: false, message: "boardPermissionLost" });
  assert.deepEqual(mutationFailure(401), { refresh: false, revokeBoard: false, clearAll: true, message: "boardPermissionLost" });
});

test("HTTP LAN idempotency keys retain UUIDv4 entropy when crypto.randomUUID is unavailable", () => {
  const generated = secureUuid({ getRandomValues: bytes => { bytes.fill(0x11); return bytes; } });
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(secureUuid({ randomUUID: () => "secure-browser-uuid" }), "secure-browser-uuid");
  assert.throws(() => secureUuid({}), /cryptographically secure/);
});
