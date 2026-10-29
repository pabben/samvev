import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerHooks } from "node:module";

registerHooks({ load(url, context, nextLoad) { return url.endsWith(".webp") ? { format: "module", source: 'export default "synthetic-avatar.webp"', shortCircuit: true } : nextLoad(url, context); } });
const [{ ReadonlyPreview }, { LocaleProvider }] = await Promise.all([import("../src/display-setups-admin"), import("../src/ui")]);

function previewMarkup(result: any, orientation: "portrait" | "landscape" = "portrait") {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: { theme: "light" } } } });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
  return renderToStaticMarkup(createElement(LocaleProvider, { locale: "en", children: createElement(ReadonlyPreview, { result, displayName: "Synthetic display", cardLabel: (id: string) => id, orientation }) }));
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
