import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";

registerHooks({ load(url, context, nextLoad) { return url.endsWith(".webp") ? { format: "module", source: 'export default "synthetic-avatar.webp"', shortCircuit: true } : nextLoad(url, context); } });
const [{ ReadonlyPreview }, { LocaleProvider }] = await Promise.all([import("../src/display-setups-admin"), import("../src/ui")]);
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function previewMarkup(result: any, orientation: "portrait" | "landscape" = "portrait") {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: { theme: "light" } } } });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
  return renderToStaticMarkup(createElement(LocaleProvider, { locale: "en", children: createElement(ReadonlyPreview, { result, displayName: "Synthetic display", cardLabel: (id: string) => id === "home_assistant" ? result.display.locale === "nb" ? "Home Assistant-styring" : "Home Assistant controls" : id, orientation }) }));
}

const familyPeople = [{ id: "synthetic-person", displayName: "Synthetic person" }];
const base = {
  preview: true,
  setup: { id: "synthetic-setup", cards: ["family_layout", "people", "new_message"], cardOrder: ["family_layout", "people", "new_message"], familyLayoutEnabled: true, personIds: [], sourceIds: [], calendarSourceIds: [], sensorIds: [], albumIds: [], backgroundId: null },
  display: { id: "synthetic-display", name: "Synthetic display", householdName: "Synthetic household", timezone: "Europe/Oslo", locale: "nb", theme: "dark", privacyMode: false },
  familyLayout: { people: familyPeople, upcomingBirthdays: [] },
  hub: { people: familyPeople, items: [] },
  birthdays: { mode: "all", localDate: "2026-10-29", entries: [] },
  householdBoards: { from: "2026-10-29", groceries: [], dinners: [], readable: { groceries: false, dinners: false } },
  media: { assets: [] }, cards: [], serverNow: "2026-10-29T12:00:00.000Z", generatedAt: "2026-10-29T12:00:00.000Z", cacheUntil: "2026-10-29T12:15:00.000Z", maxStaleSeconds: 900,
} as any;

test("family plus People preview has one hub clock/heading and disables action affordances", () => {
  const html = previewMarkup(base);
  assert.equal((html.match(/class="hub-hero-clock"/g) ?? []).length, 1);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="family-hub"/g) ?? []).length, 1);
  assert.equal((html.match(/data-testid="home-activity-week"/g) ?? []).length, 0);
  assert.equal((html.match(/display-preview-people/g) ?? []).length, 0);
  assert.match(html, /<button[^>]*disabled[^>]*>Ny beskjed<\/button>/);
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /Forhåndsvis på Synthetic display/);
  assert.match(html, /display-preview-portrait/);
});

test("preview uses selected display locale/theme and orientation while keeping the action disabled", () => {
  const html = previewMarkup({ ...base, display: { ...base.display, locale: "en", theme: "light" } }, "landscape");
  assert.match(html, /data-theme="light"/);
  assert.match(html, /Preview on Synthetic display/);
  assert.match(html, /display-preview-landscape/);
  assert.match(html, /<button[^>]*disabled[^>]*>New message<\/button>/);
});

test("today, tomorrow and external cards show one calendar sharing reason", () => {
  const result = {
    ...base,
    setup: { ...base.setup, cards: ["today", "tomorrow", "external_items"], cardOrder: ["today", "tomorrow", "external_items"] },
    contentReadiness: { calendar: "not_shared" },
    dayActivities: { activities: [] },
  };
  const html = previewMarkup(result);
  assert.equal((html.match(/Ingen relevant valgt kalender/g) ?? []).length, 1);
});

test("snapshot cards reuse live week, board and media renderers with read-only controls", () => {
  let displayFetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { displayFetches++; throw new Error("preview must not fetch paired-display routes"); }) as typeof fetch;
  try {
    const today = "2026-10-29";
    const result = {
      ...base,
      setup: { ...base.setup, cards: ["week", "next", "groceries", "dinners", "photos", "home_assistant"], cardOrder: ["week", "next", "groceries", "dinners", "photos", "home_assistant"], familyLayoutEnabled: false },
      householdBoards: {
        from: today,
        groceries: [{ id: "grocery-1", label: "Apples", checked: false, revision: 1 }],
        dinners: [{ id: "dinner-1", localDate: today, title: "Soup", emoji: "🍲", revision: 1, cleared: false }],
        readable: { groceries: true, dinners: true },
      },
      media: {
        albums: [{ id: "album-1", name: "Photos", kind: "photos", revision: 1 }],
        assets: [{ id: "photo-1", albumId: "album-1", title: "Synthetic photo", previewUrl: "/synthetic-photo.webp" }],
        background: null, householdBackground: null,
      },
      weekActivities: { activities: [] },
      nextActivity: null,
    } as any;
    const html = previewMarkup(result);
    assert.match(html, /data-testid="home-activity-week"/);
    assert.match(html, /class="hub-week-days"/);
    assert.match(html, /class="board-list"/);
    assert.match(html, /board-day-picker/);
    assert.match(html, /class="hub-week-row-button[^\"]*" type="button" disabled/);
    assert.match(html, /media-display-playback/);
    assert.match(html, /class="media-slideshow"/);
    assert.match(html, /Home Assistant-styring/);
    assert.match(html, /Home Assistant-tilstand lastes ikke i administratorens forhåndsvisning/);
    assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled/);
    assert.match(html, /<button[^>]*disabled/);
    assert.equal(displayFetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
