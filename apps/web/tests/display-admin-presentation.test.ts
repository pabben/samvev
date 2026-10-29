import assert from "node:assert/strict";
import test from "node:test";
import { birthdayInputState, birthdayModePatch, calendarReadinessMessage, changedDevicePeople, displayActionHasMessageRecipients, displayCalendarSourceUpdate, displayChromePlan, displayFamilyCardPlan, displayFamilyContentVisible, displayLocalePatch, displayPreviewContentVisible, displayReadinessCard, displayReviewAccessPlan, displayReviewCanApply, displaySetupNeedsPrivateCopy, displayThemePatch, effectiveDisplayLocale, effectiveDisplayTheme, familyLayoutBirthdayEntries, inheritDevicePeople, noDevicePeople, selectedDevicePeople, visibleDisplayBirthdays } from "../src/display-admin-presentation.ts";

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

test("family layout and People selection share one roster and one hero; People remains standalone otherwise", () => {
  assert.deepEqual(displayFamilyCardPlan(["family_layout", "people"], true, false), { familyLayout: true, peopleCard: false, rosterInFamilyLayout: true });
  assert.deepEqual(displayFamilyCardPlan(["people"], false, false), { familyLayout: false, peopleCard: true, rosterInFamilyLayout: false });
  assert.deepEqual(displayFamilyCardPlan(["family_layout", "people"], true, true), { familyLayout: false, peopleCard: false, rosterInFamilyLayout: false });
});

test("preview suppresses empty optional card content while preserving real content", () => {
  assert.equal(displayPreviewContentVisible(null), false);
  assert.equal(displayPreviewContentVisible([]), false);
  assert.equal(displayPreviewContentVisible("   "), false);
  assert.equal(displayPreviewContentVisible(["synthetic-item"]), true);
  assert.equal(displayPreviewContentVisible("read-only state"), true);
});

test("empty optional family layout is omitted and a populated roster, message, item, or birthday keeps it", () => {
  assert.equal(displayFamilyContentVisible(true,0,0,0,0),false);
  assert.equal(displayFamilyContentVisible(true,1,0,0,0),true);
  assert.equal(displayFamilyContentVisible(true,0,1,0,0),true);
  assert.equal(displayFamilyContentVisible(true,0,0,1,0),true);
  assert.equal(displayFamilyContentVisible(true,0,0,0,1),true);
  assert.equal(displayFamilyContentVisible(false,2,1,1,1),false);
});

test("family plus People keeps one visible clock, date and household heading", () => {
  const cards = ["family_layout", "people"];
  const family = displayFamilyCardPlan(cards,true,false);
  assert.equal(family.familyLayout,true);
  assert.equal(family.peopleCard,false);
  const chrome = displayChromePlan(true);
  assert.deepEqual({familyHero:chrome.familyHero,displayClock:chrome.displayClock,displayIdentity:chrome.displayIdentity},{familyHero:true,displayClock:false,displayIdentity:false});
});

test("calendar access readiness is rendered in exactly one selected card", () => {
  assert.equal(displayReadinessCard(["today","tomorrow","external_items"]),"external_items");
  assert.equal(displayReadinessCard(["today","tomorrow"]),"today");
  assert.equal(displayReadinessCard(["tomorrow"]),"tomorrow");
  assert.equal(displayReadinessCard([]),null);
});

test("display review produces only explicit source and managed album deltas", () => {
  const current = { canShareCalendars: true, selectedCalendarDisplayIds: ["source-already-shared"], requestedCalendarDisplayIds: ["source-already-shared"], selectedAlbumReadIds: ["album-current"], managedAlbumIds: ["album-current", "album-managed"], requestedAlbumReadIds: ["album-current"] };
  const requested = { ...current, requestedCalendarDisplayIds: ["source-already-shared", "source-opted-in"], requestedAlbumReadIds: ["album-managed"] };
  assert.deepEqual(displayReviewAccessPlan(current, requested), {
    calendarDisplayIds: ["source-already-shared", "source-opted-in"], calendarChanged: true, calendarDenied: false,
    albumDisplayIds: ["album-managed"], albumChangedIds: ["album-current", "album-managed"], deniedAlbumIds: [],
  });
});

test("display review denies private calendar sharing and never silently grants an unmanaged album", () => {
  const base = { canShareCalendars: false, selectedCalendarDisplayIds: [], requestedCalendarDisplayIds: [], selectedAlbumReadIds: [], managedAlbumIds: [], requestedAlbumReadIds: [] };
  const noChoice = displayReviewAccessPlan(base, base);
  assert.equal(noChoice.calendarChanged, false);
  assert.equal(noChoice.calendarDenied, false);
  const request = { ...base, requestedCalendarDisplayIds: ["private-source"], requestedAlbumReadIds: ["unmanaged-album"] };
  const denied = displayReviewAccessPlan(base, request);
  assert.equal(denied.calendarDenied, true);
  assert.deepEqual(denied.calendarDisplayIds, []);
  assert.deepEqual(denied.albumDisplayIds, []);
  assert.deepEqual(denied.deniedAlbumIds, ["unmanaged-album"]);
});

test("layout review copies a default or shared setup before changing one display", () => {
  assert.equal(displaySetupNeedsPrivateCopy(true, [], "setup-1", "setup-1"), true);
  assert.equal(displaySetupNeedsPrivateCopy(false, ["other-display"], "setup-1", "setup-1"), true);
  assert.equal(displaySetupNeedsPrivateCopy(false, [], "setup-1", "setup-1"), false);
  assert.equal(displaySetupNeedsPrivateCopy(false, [], null, "setup-1"), true);
});

test("calendar display grant updates preserve subjects, readers, sync window, and other display targets", () => {
  const source = { revision: 9, enabled: true, purpose: "calendar", displayName: "Family plan", bridgeKind: "direct", syncWindowDays: { past: 21, future: 120 }, appliesTo: { household: false, personIds: ["person-a"] }, visibility: { household: false, personIds: ["person-b"], displayIds: ["display-a", "display-current"] } };
  assert.deepEqual(displayCalendarSourceUpdate(source, "display-current", false), { expectedRevision: 9, enabled: true, purpose: "calendar", displayName: "Family plan", bridgeKind: "direct", syncWindowDays: { past: 21, future: 120 }, appliesTo: source.appliesTo, visibility: { household: false, personIds: ["person-b"], displayIds: ["display-a"] } });
  assert.deepEqual(displayCalendarSourceUpdate(source, "display-new", true).visibility, { household: false, personIds: ["person-b"], displayIds: ["display-a", "display-current", "display-new"] });
});

test("message actions are not usable until a recipient is explicitly selected", () => {
  assert.equal(displayActionHasMessageRecipients({ personIds: [], displayIds: [] }), false);
  assert.equal(displayActionHasMessageRecipients({ personIds: ["person-a"], displayIds: [] }), true);
  assert.equal(displayActionHasMessageRecipients({ personIds: [], displayIds: ["display-a"] }), true);
});

test("selecting a review delta cannot apply it until the separate confirmation step", () => {
  assert.equal(displayReviewCanApply(false, 1), false);
  assert.equal(displayReviewCanApply(false, 4), false);
  assert.equal(displayReviewCanApply(true, 0), false);
  assert.equal(displayReviewCanApply(true, 4), true);
});
