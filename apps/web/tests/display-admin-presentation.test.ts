import assert from "node:assert/strict";
import test from "node:test";
import { applyDisplayReviewWrites, birthdayInputState, birthdayModePatch, calendarReadinessMessage, changedDevicePeople, displayActionHasMessageRecipients, displayActionPolicyRevocationPlan, displayCalendarSourceUpdate, displayChromePlan, displayFamilyCardPlan, displayFamilyContentVisible, displayLocalePatch, displayPreviewContentVisible, displayReadinessCard, displayReviewAccessPlan, displayReviewCanApply, displayReviewCardChange, displaySetupPeopleSelection, displayThemePatch, effectiveDisplayLocale, effectiveDisplayTheme, familyLayoutBirthdayEntries, inheritDevicePeople, noDevicePeople, savePrivateDisplaySetupDraft, selectedDevicePeople, visibleDisplayBirthdays } from "../src/display-admin-presentation.ts";

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

test("layout review always copies then reassigns only the reviewed display, even if another display binds concurrently", async () => {
  const assignments = new Map([["display-a", "shared-setup"]]);
  const events: string[] = [];
  const copied = await savePrivateDisplaySetupDraft(true, async () => {
    events.push("create-private-copy");
    assignments.set("display-b", "shared-setup"); // another display binds while the review is open
    return { id: "private-copy" };
  }, async setupId => {
    events.push("assign-display-a");
    assignments.set("display-a", setupId);
  });
  assert.equal(copied, "private-copy");
  assert.deepEqual(events, ["create-private-copy", "assign-display-a"]);
  assert.equal(assignments.get("display-a"), "private-copy");
  assert.equal(assignments.get("display-b"), "shared-setup");
});

test("display review applies policy revocations before other writes and delays every addition", async () => {
  const current = { revision: 7, messageCreate: true, messageSchedule: true, groceryWrite: false, dinnerWrite: false, photoUpload: false, homeAssistantControl: true, personIds: ["person-a"], displayIds: ["display-b"] };
  const desired = { ...current, messageCreate: false, messageSchedule: false, homeAssistantControl: false, photoUpload: true, personIds: [], displayIds: ["display-c"] };
  const plan = displayActionPolicyRevocationPlan(current, desired);
  assert.equal(plan.hasRevocations, true);
  assert.equal(plan.hasAdditions, true);
  assert.equal(plan.revoked.homeAssistantControl, false);
  assert.equal(plan.revoked.photoUpload, false, "the first patch must not add a capability");
  assert.deepEqual(plan.revoked.personIds, []);
  assert.deepEqual(plan.revoked.displayIds, []);

  const events: Array<{ kind: string; patch?: typeof plan.revoked }> = [];
  await assert.rejects(applyDisplayReviewWrites(current, desired, async patch => {
    events.push({ kind: "policy-revocation", patch });
    const { expectedRevision, ...fields } = patch;
    return { ...fields, revision: expectedRevision + 1 };
  }, async () => {
    events.push({ kind: "media-write" });
    throw new Error("REVISION_CONFLICT");
  }), /REVISION_CONFLICT/);
  assert.deepEqual(events.map(event => event.kind), ["policy-revocation", "media-write"]);
  assert.equal(events[0]?.patch?.homeAssistantControl, false);
  assert.equal(events[0]?.patch?.photoUpload, false);

  const success: string[] = [];
  await applyDisplayReviewWrites(current, desired, async patch => {
    success.push(`policy:${patch.expectedRevision}:${patch.homeAssistantControl}:${patch.photoUpload}`);
    const { expectedRevision, ...fields } = patch;
    return { ...fields, revision: expectedRevision + 1 };
  }, async () => { success.push("other-writes"); });
  assert.deepEqual(success, ["policy:7:false:false", "other-writes", "policy:8:false:true"]);
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

test("turning on a disabled family layout enables it and records that exact setup delta", () => {
  const original = { cards: ["today"], cardOrder: ["today"], familyLayoutEnabled: false };
  const selected = displayReviewCardChange(original, "family_layout", true);
  assert.deepEqual(selected, { cards: ["today", "family_layout"], cardOrder: ["today", "family_layout"], familyLayoutEnabled: true });
  assert.equal(selected.familyLayoutEnabled !== original.familyLayoutEnabled, true);
});

test("setup-person filtering is separate from profile grants and supports individual changes", () => {
  assert.deepEqual(displaySetupPeopleSelection(["person-a"], "person-b", true), ["person-a", "person-b"]);
  assert.deepEqual(displaySetupPeopleSelection(["person-a", "person-b"], "person-b", false), ["person-a"]);
});
