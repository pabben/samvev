import { test } from "node:test";
import assert from "node:assert/strict";
import { wallToInstant, wallInput, formatEventRange, monotonicClockAnchor, monotonicClockNow } from "../src/time.ts";
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

test('calendar all-day display preserves civil dates and exclusive ends in both time-zone directions',async()=>{
 const {formatCalendarEventRange}=await import('../src/time.ts');
 for(const locale of ['nb','en'])for(const zone of ['Europe/Oslo','America/Los_Angeles','Pacific/Kiritimati']){
  const one=formatCalendarEventRange('2026-10-22T00:00:00Z','2026-10-23T00:00:00Z',locale,zone,true);
  assert.match(one,/22/);assert.doesNotMatch(one,/23|21|02[:.]00|00[:.]00/);
  assert.equal(formatCalendarEventRange('2026-10-22','2026-10-23',locale,zone,true),one);
  assert.equal(formatCalendarEventRange('2026-10-22',null,locale,zone,true),one);
  const multiple=formatCalendarEventRange('2026-10-22T00:00:00Z','2026-10-25T00:00:00Z',locale,zone,true);
  assert.match(multiple,/22/);assert.match(multiple,/24/);assert.doesNotMatch(multiple,/25/);
  assert.equal(formatCalendarEventRange('2026-10-22T06:00:00Z','2026-10-22T07:00:00Z',locale,zone,false),formatEventRange('2026-10-22T06:00:00Z','2026-10-22T07:00:00Z',locale,zone));
 }
});

test('household live clock advances from server time using monotonic elapsed time',()=>{
 const anchor=monotonicClockAnchor(Date.parse('2026-10-25T22:59:59Z'),1200);
 assert.equal(wallInput(anchor.serverAt,'Europe/Oslo'),'2026-10-25T23:59','the anchored clock is just before local midnight');
 assert.equal(monotonicClockNow(anchor,2200),Date.parse('2026-10-25T23:00:00Z'));
 assert.equal(wallInput(monotonicClockNow(anchor,2200),'Europe/Oslo'),'2026-10-26T00:00','local midnight rolls without a projection reload');
 const beforeFallback=wallInput(Date.parse('2026-10-25T00:30:00Z'),'Europe/Oslo');
 const afterFallback=wallInput(Date.parse('2026-10-25T01:30:00Z'),'Europe/Oslo');
 assert.equal(beforeFallback,'2026-10-25T02:30');
 assert.equal(afterFallback,beforeFallback,'the repeated local DST hour maps to two distinct UTC instants');
 assert.equal(monotonicClockNow(anchor,1100),anchor.serverAt,'a reset monotonic sample cannot rewind the anchored household clock');
});
