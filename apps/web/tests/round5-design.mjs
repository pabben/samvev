// Round 5 visual/regression evidence. This harness is intentionally limited to
// the sealed test application; it must never be pointed at the LAN QA instance.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.ROUND5_TEST_BASE_URL;
if (base !== "http://round5-test-app:4173") {
  throw new Error("ROUND5_TEST_BASE_URL must equal http://round5-test-app:4173");
}
const artifactDir = process.env.ROUND5_ARTIFACT_DIR ?? ".local/m3/design-round5";
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: "reduce", serviceWorkers: "block" });
const page = await context.newPage();
const checks = [], failures = [], blocked = [], aiRequests = [], blockedProviderCalls = [];
const record = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(`PASS ${name}`); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let originalPrefs, csrf, householdId, completed = false;

page.on("pageerror", error => failures.push(`pageerror:${error.message}`));
page.on("request", request => {
  if (/\/ai\/(?:settings|usage|test|chatgpt)/.test(request.url())) aiRequests.push({ method: request.method(), url: request.url() });
});
await page.addInitScript(() => {
  class ControlledEvents extends EventTarget {
    static instance;
    constructor() { super(); ControlledEvents.instance = this; }
    close() {}
  }
  window.EventSource = ControlledEvents;
  window.__round5Event = (name, data = {}) => ControlledEvents.instance.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
});
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) { blocked.push(url.href); return route.abort(); }
  return route.continue();
});
await context.route("**/api/v1/households/*/ai/**", route => {
  if (route.request().method() !== "GET") { blockedProviderCalls.push(`${route.request().method()} ${route.request().url()}`); return route.abort(); }
  return route.continue();
});

const api = async (path, method = "GET", data) => {
  const response = await context.request.fetch(`${base}/api/v1${path}`, { method, data, headers: method === "GET" ? {} : { "X-CSRF-Token": csrf } });
  if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.status() === 204 ? null : response.json();
};
const visibleIds = () => page.locator("[data-person-id]").evaluateAll(nodes => [...new Set(nodes.filter(node => node.checkVisibility()).map(node => node.getAttribute("data-person-id")))].filter(Boolean));
const accessibility = async label => {
  const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations;
  expect(violations.map(v => v.id), `${label} axe`).toEqual([]);
  const undersized = await page.locator("button,a[href],summary").evaluateAll(nodes => nodes.filter(node => node.checkVisibility() && !node.closest("[inert]") && !node.closest("dialog:not([open])")).filter(node => { const box = node.getBoundingClientRect(); return box.width < 44 || box.height < 44; }).map(node => node.textContent?.trim()));
  expect(undersized, `${label} visible controls under 44px`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} horizontal overflow`).toBeTruthy();
};
const setPrefs = async (locale, theme) => api("/me/preferences", "PATCH", { locale, theme });
const navAI = async (locale) => {
  const more = page.locator("nav.admin-navigation").getByRole("button", { name: locale === "nb" ? "Mer" : "More", exact: true });
  await expect(more).toBeVisible(); await more.click();
  const entry = page.getByRole("button", { name: locale === "nb" ? "AI og forbruk" : "AI and usage", exact: true });
  await expect(entry).toBeVisible(); await entry.click();
  await expect(page.locator(".ai-settings")).toBeVisible();
  await expect(page.getByRole("heading", { name: locale === "nb" ? "AI og forbruk" : "AI and usage", exact: true })).toBeVisible();
};

try {
  await page.goto(base);
  await page.locator('input[name="email"]').fill("admin");
  await page.locator('input[name="password"]').fill("admin");
  await page.getByRole("button", { name: /sign in|logg inn/i }).click();
  await page.getByTestId("family-hub").waitFor();
  const me = await api("/me"); csrf = me.csrfToken; householdId = me.memberships[0].household_id;
  originalPrefs = { locale: me.account.locale, theme: me.account.theme };
  const originalHome = await api(`/households/${householdId}/home`);
  const homePath = `**/api/v1/households/${householdId}/home`;
  const basePerson = originalHome.people[0] ?? { id: "seed", displayName: "Synthetic person", avatarKey: "fox" };
  const baseItem = originalHome.items[0] ?? { id: "seed-item", kind: "event", title: "Synthetic event", body: "Synthetic body", metadata: {}, source: { label: "Synthetic source" }, audience: {}, targets: {} };
  const projection = ({ people = 4, personal = 1, long = false, expiry = null }) => {
    const now = Date.now();
    const roster = Array.from({ length: people }, (_, index) => ({ ...basePerson, id: `round5-person-${index + 1}`, displayName: long ? `Synthetic household person ${index + 1} with a deliberately long accessible display name` : `Synthetic person ${index + 1}` }));
    const item = (id, title, targets, expiresAt = new Date(now + 3_600_000).toISOString()) => ({ ...baseItem, id, title, body: `${title}. Source: synthetic Round 5 evidence.`, kind: "event", publishAt: new Date(now - 60_000).toISOString(), expiresAt, startsAt: new Date(now + 30 * 60_000).toISOString(), source: { ...(baseItem.source ?? {}), label: "Synthetic Round 5 source", observedAt: new Date(now - 60_000).toISOString() }, targets, metadata: { ...(baseItem.metadata ?? {}), location: "Synthetic room" } });
    const items = [item("round5-shared", "Shared synthetic item", { household: true, personIds: [] })];
    for (let index = 0; index < personal; index++) items.push(item(`round5-personal-${index + 1}`, `Today personal item ${index + 1}`, { household: false, personIds: [roster[0]?.id].filter(Boolean) }, index === 0 && expiry ? expiry : undefined));
    return { ...originalHome, people: roster, items };
  };
  let current = projection({ people: 4, personal: 3, long: true });
  await page.route(homePath, route => route.fulfill({ json: current }));

  // Five viewports cover desktop, iPad portrait/landscape, mobile, and the wall display;
  // both supported languages and themes are represented without a slow Cartesian product.
  const matrix = [
    ["nb-light-desktop", "nb", "light", 1920, 1080, 4], ["en-dark-desktop", "en", "dark", 1920, 1080, 4],
    ["nb-dark-ipad-portrait", "nb", "dark", 820, 1180, 1], ["en-light-mobile", "en", "light", 390, 844, 0],
    ["nb-light-ipad-landscape", "nb", "light", 1180, 820, 8], ["en-dark-shelly", "en", "dark", 1280, 752, 4],
  ];
  for (const [label, locale, theme, width, height, people] of matrix) {
    current = projection({ people, personal: people ? 3 : 0, long: people > 1 });
    await setPrefs(locale, theme); await page.setViewportSize({ width, height }); await page.reload();
    await page.getByTestId("family-hub").waitFor();
    expect(await visibleIds(), `${label} identity IDs`).toEqual(current.people.map(person => person.id));
    await expect(page.locator("html")).toHaveAttribute("lang", locale); await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await accessibility(label); await page.screenshot({path: `${artifactDir}/${label}.png`}); record(label, { locale, theme, viewport: `${width}x${height}`, people });
  }

  // Explicit zero, one-with-no-personal-content, and many-person detail states.
  await setPrefs("nb", "light");
  current = projection({ people: 0, personal: 0 }); await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  expect(await visibleIds()).toEqual([]); record("zero people is distinct from an empty personal-item list");
  current = projection({ people: 1, personal: 0 }); await page.reload();
  let trigger = page.locator('[data-hub-detail-kind="person"][data-person-id="round5-person-1"]:visible'); await expect(trigger).toBeVisible(); await trigger.click();
  let dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await expect(dialog).toContainText("Shared synthetic item"); record("one person details show shared content and no fabricated personal item");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  current = projection({ people: 1, personal: 1 }); await page.reload();
  await trigger.click(); await expect(dialog.locator('[data-item-id^="round5-personal-"]')).toHaveCount(1); await expect(dialog).toContainText("Felles for husstanden"); await page.screenshot({path:`${artifactDir}/one-person-one-entry.png`}); await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); record("one personal entry still opens the person directly");
  current = projection({ people: 8, personal: 3, long: true }); await page.setViewportSize({ width: 1280, height: 820 }); await page.reload();
  trigger = page.locator('[data-hub-detail-kind="person"][data-person-id="round5-person-1"]:visible'); await trigger.click(); dialog = page.getByRole("dialog"); await expect(dialog.locator(".hub-detail-identity")).toContainText("Synthetic household person 1");
  await expect(dialog.locator('[data-item-id^="round5-personal-"]')).toHaveCount(3); await expect(dialog).toContainText("Felles for husstanden"); await expect(dialog).toContainText("Synthetic room"); await expect(dialog).toContainText("Synthetic Round 5 source"); await expect(dialog).toContainText(/Today personal item 1/);
  await page.screenshot({path:`${artifactDir}/many-person-drawer.png`});
  const focusables = dialog.locator('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary');
  await focusables.first().focus(); await page.keyboard.press("Shift+Tab"); await expect(focusables.last()).toBeFocused(); await page.keyboard.press("Tab"); await expect(focusables.first()).toBeFocused();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await expect(dialog).toBeVisible(); await page.setViewportSize({ width: 820, height: 1180 }); await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  const itemTrigger = page.locator('[data-hub-detail-kind="item"]').filter({ hasText: "Today personal item 1" }).first(); await itemTrigger.click(); await expect(dialog).toBeVisible(); expect(await dialog.locator(".hub-detail-identity").count()).toBe(0); await page.keyboard.press("Escape"); record("0/1/many details, focus trap, Escape return, theme and rotation preserve an open drawer; item is not a person drawer");

  // The controlled EventSource exercises Home's real projection-invalidated refresh with no reload.
  current = projection({ people: 4, personal: 2 }); await page.setViewportSize({ width: 1280, height: 820 }); await page.reload();
  trigger = page.locator('[data-hub-detail-kind="person"][data-person-id="round5-person-1"]:visible'); await trigger.click(); await expect(dialog).toBeVisible();
  current = { ...current, people: current.people.slice(1), items: current.items.filter(item => !item.targets.personIds?.includes("round5-person-1")) };
  await page.evaluate(() => window.__round5Event("projection-invalidated"));
  await expect(dialog).toBeHidden(); await expect(page.getByTestId("family-hub")).toBeVisible(); record("SSE projection invalidation refetches and withdraws a removed identity without reload");

  current = projection({ people: 1, personal: 1, expiry: new Date(Date.now() + 4_000).toISOString() }); await page.reload();
  await page.locator('[data-hub-detail-kind="item"]:visible').filter({ hasText: "Today personal item 1" }).click(); await expect(dialog).toBeVisible(); await expect.poll(async () => !(await dialog.isVisible()), { timeout: 8_000 }).toBeTruthy(); record("expired item closes its detail on the live clock");

  // Real, unconfigured settings must load. Rendering cannot call provider/model/test routes.
  aiRequests.length = 0; await setPrefs("nb", "light"); await page.setViewportSize({ width: 1280, height: 820 }); await page.goto(base); await navAI("nb");
  assert(aiRequests.some(request => /\/ai\/settings$/.test(request.url) && request.method === "GET"), "AI settings GET missing"); assert(aiRequests.some(request => /\/ai\/usage\?/.test(request.url) && request.method === "GET"), "AI usage GET missing");
  await page.locator(".ai-connect-steps summary").click(); await expect(page.locator(".ai-connect-steps")).toHaveAttribute("open", ""); await expect(page.locator(".ai-connect-steps")).toContainText("chatgpt-connect.ts"); await accessibility("actual AI onboarding");
  const aiText = await page.locator(".ai-settings").innerText(); expect(aiText).not.toMatch(/access[_ -]?token|refresh[_ -]?token|oauth code|balance:\s*\d/i); expect(aiRequests.filter(request => request.method !== "GET")).toEqual([]); record("actual unconfigured AI settings/onboarding loads without a provider call");

  // Transport-only DTOs verify connected, limited, ineligible and unknown-usage rendering while
  // explicitly blocking every provider action. They are labelled in the machine-readable evidence.
  const settingsPath = `**/api/v1/households/${householdId}/ai/settings`, usagePath = `**/api/v1/households/${householdId}/ai/usage?*`;
  const actualSettings = await api(`/households/${householdId}/ai/settings`), actualUsage = await api(`/households/${householdId}/ai/usage?days=30`);
  const states = [["connected", "connected"], ["limited", "usage_limited"], ["noteligible", "not_eligible"], ["unknownusage", "connected"]];
  for (const [label, status] of states) {
    const settings = { ...actualSettings, provider: "chatgpt_subscription", enabled: false, chatgpt: { ...actualSettings.chatgpt, activeRegistrationId: `r5-${label}`, registrations: [{ id: `r5-${label}`, label: "Synthetic connected account", status, revision: 1, isOwner: true, canManage: true }] } };
    const usage = { ...actualUsage, summary: { ...actualUsage.summary, unknownUsageCount: label === "unknownusage" ? 1 : 0, legacyUnknownAttempts: label === "unknownusage" ? 1 : 0, legacyUnknownAttempts: label === "unknownusage" ? 1 : 0 }, recent: label === "unknownusage" ? [{ provider: "chatgpt_subscription", route: "chatgpt_plan", model: null, actualModel: null, requestedModel: null, actualServiceTier: null, purpose: "synthetic", category: null, success: false, outcome: "legacy_unknown", actualDispatch: null, errorCode: null, inputTokens: null, outputTokens: null, occurredAt: new Date().toISOString() }] : actualUsage.recent };
    await page.route(settingsPath, route => route.fulfill({ json: settings })); await page.route(usagePath, route => route.fulfill({ json: usage }));
    await page.reload(); await navAI("nb"); await expect(page.locator(".ai-settings")).toBeVisible(); await expect(page.locator(".ai-registrations article").getByText("Synthetic connected account", { exact: true })).toBeVisible();
    if (label === "connected") await expect(page.locator(".ai-registrations article")).toContainText("Tilkoblet · kontotilgang verifisert");
    if (label === "limited") await expect(page.locator(".ai-registrations article")).toContainText("Planbruk satt på pause · kontroller kontogrensen");
    if (label === "noteligible") await expect(page.locator(".ai-registrations article")).toContainText("Kontoen er ikke kvalifisert · prøv først igjen når tilgangen er endret");
    if (label === "unknownusage") { await expect(page.locator(".ai-settings")).toContainText("Resultat ukjent"); await expect(page.locator(".ai-settings")).toContainText("historiske forsøk med ukjent utsending"); }
    record(`AI ${label} transport projection`, { injectedTransport: true, providerCallsBlocked: true }); await page.unroute(settingsPath); await page.unroute(usagePath);
  }
  expect(blockedProviderCalls, "AI provider/model/test calls must never be attempted").toEqual([]); completed = true;
} catch (error) { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)); }
finally {
  try { if (originalPrefs) await api("/me/preferences", "PATCH", originalPrefs); } catch (error) { failures.push(`restore preferences:${error}`); }
  try { const account = page.locator(".account-button:visible, .mobile-account:visible").first(); await expect(account).toBeVisible(); await account.click(); const signout = page.getByRole("button", { name: /sign out|logg ut/i }); await expect(signout).toBeVisible(); await signout.click(); } catch (error) { failures.push(`logout:${error}`); }
  await writeFile(`${artifactDir}/round5-design-results.json`, JSON.stringify({ executedAt: new Date().toISOString(), completed, isolatedOrigin: base, checks, failures, blocked, blockedProviderCalls, aiRequests, syntheticProjection: true, injectedTransport: true, liveOAuthUnverified: true }, null, 2));
  await context.close(); await browser.close();
}
if (blocked.length) failures.push(`unexpected external browser requests: ${blocked.join(", ")}`);
if (failures.length) throw new Error(failures.join("\n\n"));
console.log("PASS Round 5 isolated browser design regression");
