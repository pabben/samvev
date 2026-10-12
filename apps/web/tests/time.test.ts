import { test } from "node:test";
import assert from "node:assert/strict";
import { wallToInstant, wallInput, formatEventRange } from "../src/time.ts";
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

test('event ranges retain both localized times, household date changes and all-day dates',()=>{
 for(const locale of ['nb','en']) {
  const same=formatEventRange('2026-10-12T16:00:00Z','2026-10-12T17:30:00Z',locale,'Europe/Oslo');
  assert.match(same,locale==='nb'?/18[:.]00/:/6:00/);
  assert.match(same,locale==='nb'?/19[:.]30/:/7:30/);
  const overnight=formatEventRange('2026-10-12T21:00:00Z','2026-10-12T23:30:00Z',locale,'Europe/Oslo');
  assert.match(overnight,/12/);assert.match(overnight,/13/);
  assert.match(overnight,locale==='nb'?/23[:.]00/:/11:00/);
  assert.match(overnight,locale==='nb'?/01[:.]30/:/1:30/);
  const allDay=formatEventRange('2026-10-12T10:00:00Z','2026-10-13T10:00:00Z',locale,'Europe/Oslo',true);
  assert.match(allDay,/12/);assert.match(allDay,/13/);assert.doesNotMatch(allDay,/12:00/);
  assert.ok(formatEventRange('2026-10-12T16:00:00Z',null,locale,'Europe/Oslo').length>0);
 }
});
