import assert from "node:assert/strict";
import test from "node:test";
import { birthdayInputState, birthdayModePatch, calendarReadinessMessage, changedDevicePeople, displayLocalePatch, displayThemePatch, effectiveDisplayLocale, effectiveDisplayTheme, familyLayoutBirthdayEntries, inheritDevicePeople, noDevicePeople, selectedDevicePeople, visibleDisplayBirthdays } from "../src/display-admin-presentation.ts";

test("display locale and theme inherit from their assigned setup unless a raw override is present", () => {
  assert.equal(effectiveDisplayLocale(null, "nb", "en"), "nb");
  assert.equal(effectiveDisplayLocale("en", "nb", "nb"), "en");
  assert.equal(effectiveDisplayTheme(null, "dark", "system"), "dark");
  assert.equal(effectiveDisplayTheme("light", "dark", "system"), "light");
});

test("display admin select values map to the strict update API locale and theme fields", () => {
  assert.deepEqual(displayLocalePatch("inherit"), { locale: null });
  assert.deepEqual(displayLocalePatch("nb"), { locale: "nb" });
  assert.deepEqual(displayThemePatch("inherit"), { theme: null });
  assert.deepEqual(displayThemePatch("dark"), { theme: "dark" });
});

test("device selection distinguishes inherited, none, and explicit current people without grant fields", () => {
  assert.deepEqual(inheritDevicePeople(), { personIdsOverride: null });
  assert.deepEqual(noDevicePeople(), { personIdsOverride: [] });
  assert.deepEqual(selectedDevicePeople(["p1", "p2", "p1"]), { personIdsOverride: ["p1", "p2"] });
  assert.deepEqual(changedDevicePeople(null, ["p1", "p2"], "p2", false), { personIdsOverride: ["p1"] });
  assert.deepEqual(changedDevicePeople([], ["p1", "p2"], "p2", true), { personIdsOverride: ["p2"] });
  for (const payload of [inheritDevicePeople(), noDevicePeople(), selectedDevicePeople(["p1"])]) {
    assert.deepEqual(Object.keys(payload), ["personIdsOverride"]);
  }
});

test("legacy birthday access stays visibly mixed until the manager explicitly chooses all or off", () => {
  assert.deepEqual(birthdayInputState("legacy_selected"), { checked: false, mixed: true });
  assert.deepEqual(birthdayInputState("all"), { checked: true, mixed: false });
  assert.deepEqual(birthdayInputState("off"), { checked: false, mixed: false });
  assert.deepEqual(birthdayModePatch("all"), { birthdayMode: "all" });
  assert.deepEqual(birthdayModePatch("off"), { birthdayMode: "off" });
});

test("family layout keeps dedicated birthdays when a separate people card hides the roster, while off hides every birthday", () => {
  const birthdays=[{personId:"not-selected",displayName:"Synthetic birthday-only person",due:"today" as const}];
  assert.deepEqual(familyLayoutBirthdayEntries("all",birthdays,true),birthdays);
  assert.deepEqual(familyLayoutBirthdayEntries("all",birthdays,false),birthdays);
  assert.deepEqual(familyLayoutBirthdayEntries("legacy_selected",birthdays,true),birthdays);
  assert.deepEqual(visibleDisplayBirthdays("off",birthdays),[]);
  assert.deepEqual(familyLayoutBirthdayEntries("off",birthdays,true),[]);
});

test("calendar readiness explains configuration without claiming provider failure or fresh sync", () => {
  assert.equal(calendarReadinessMessage("not_shared"), "displayReadinessNotShared");
  assert.equal(calendarReadinessMessage("ready"), "displayReadinessReady");
  assert.equal(calendarReadinessMessage(undefined), "displayReadinessUnknown");
});
