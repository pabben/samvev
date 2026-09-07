import { test } from "node:test";
import assert from "node:assert/strict";
import { wallToInstant, wallInput } from "../src/time.ts";
test("household time ignores browser zone and supports fractional offsets", () => {
  assert.equal(
    wallToInstant("2026-09-07T07:00", "Europe/Oslo"),
    "2026-09-07T05:00:00.000Z",
  );
  assert.equal(
    wallToInstant("2026-09-07T07:00", "Asia/Kathmandu"),
    "2026-09-07T01:15:00.000Z",
  );
  assert.equal(
    wallInput("2026-09-07T05:00:00Z", "Europe/Oslo"),
    "2026-09-07T07:00",
  );
});
test("rejects nonexistent and ambiguous DST times and impossible dates", () => {
  assert.throws(
    () => wallToInstant("2026-03-29T02:30", "Europe/Oslo"),
    /TIME_NONEXISTENT/,
  );
  assert.throws(
    () => wallToInstant("2026-10-25T02:30", "Europe/Oslo"),
    /TIME_AMBIGUOUS/,
  );
  assert.throws(
    () => wallToInstant("2026-02-30T07:00", "Europe/Oslo"),
    /SCHEDULE_INVALID/,
  );
});
