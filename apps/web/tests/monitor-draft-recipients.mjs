// Synthetic browser proof for zero-recipient monitor drafts. Every API request is
// intercepted; this test never contacts a real service or uses household data.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:4174";
const householdId = "10000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000001";
const displayId = "50000000-0000-4000-8000-000000000001";
const taskId = "60000000-0000-4000-8000-000000000001";
const household = "/api/v1/households/" + householdId;
const base = household + "/monitors";
const capabilities = ["installation.manage", "household.view", "household.manage", "people.manage", "account.manage", "capability.manage", "message.create.household", "message.publish.display", "message.schedule", "message.manage.household", "display.manage"];
const me = {
  account: { id: "40000000-0000-4000-8000-000000000001", email: "owner@synthetic.invalid", locale: "nb", theme: "light" },
  csrfToken: "synthetic-browser-only",
  memberships: [{ id: "30000000-0000-4000-8000-000000000001", household_id: householdId, person_id: personId, role_preset: "installation_admin", capabilities, revision: 1, household_name: "Synthetic home", timezone: "Europe/Oslo", household_locale: "nb", display_name: "Synthetic owner", display_ids: [] }],
};
const person = { id: personId, display_name: "Synthetic recipient", age_group: "adult", birth_date: null, calculated_age: 36, person_revision: 1, membership_id: me.memberships[0].id, role_preset: "installation_admin", capabilities, revision: 1, has_login: true, has_active_login: true, account_status: "active", email: "owner@synthetic.invalid", account_id: me.account.id, account_revision: 1, display_ids: [] };
const initial = {
  "/api/v1/setup/status": { claimed: true, demo: false, demoAvailable: false, locale: "nb" },
  "/api/v1/setup/progress": { setupStep: "complete" },
  "/api/v1/me": me,
  [household + "/people"]: { people: [person] },
  [household + "/displays"]: { displays: [{ id: displayId, name: "Synthetic display", revision: 1 }] },
  [household + "/messages"]: { messages: [] },
  [household + "/dashboard"]: { upcomingBirthday: null },
  [household + "/settings"]: { show_upcoming_birthday: false, revision: 1 },
  [household + "/ai/settings"]: { enabled: false, provider: "openai_compatible", hasApiKey: false, baseUrl: null, defaultModel: "", strongModel: "", revision: 1, availability: { status: "not_configured", available: false, errorCode: null, checkedAt: null }, providers: [{ id: "openai_compatible", runtimeAvailable: true, reasonCode: null }, { id: "openai", runtimeAvailable: true, reasonCode: null }], chatGptSubscription: { feasibility: "partial", status: "unavailable", reasonCode: "AI_PROVIDER_UNAVAILABLE" } },
  [household + "/ai/usage"]: { summary: { requests: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0 }, recent: [] },
};
let task = {
  id: taskId,
  name: "Synthetic MCP draft",
  instruction: "Follow a synthetic public source and notify me.",
  sourceUrl: "https://example.invalid/news",
  sourceKinds: ["web"],
  state: "draft",
  checkIntervalMinutes: 1440,
  noticeDaysBefore: 1,
  noticeLocalTime: "18:00",
  targets: { personIds: [], displayIds: [] },
  subjects: { personIds: [], household: true, revision: 1 },
  presentation: { kind: null, schoolEndLocalTime: null, revision: 1 },
  interpretedRule: null,
  events: [],
  revision: 1,
  approvedRevision: null,
  lastCheckedAt: null,
  nextCheckAt: null,
  lastResult: null,
  lastChangedAt: null,
  errorCode: null,
  stats: { checks: 0, aiCalls: 0, unchanged: 0 },
};
const calls = [];
const unexpected = [];
await mkdir(resolve(process.cwd(), ".local/mcp-monitor-browser"), { recursive: true });

function presented(current) {
  const hasTargets = current.targets.personIds.length + current.targets.displayIds.length > 0;
  const status = current.interpretedRule ? "ready_for_approval" : "incomplete";
  const allowed = ["edit", "delete", ...(status === "incomplete" && hasTargets ? ["interpret"] : [])];
  const actions = Object.fromEntries(["interpret", "test", "approve", "edit", "delete", "run", "pause", "resume", "smarter", "quality", "refresh"].map((name) => [name, { enabled: allowed.includes(name), reason: allowed.includes(name) ? null : "setup_required" }]));
  return { ...current, lifecycle: { status, setupComplete: Boolean(current.interpretedRule), actions } };
}

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
await context.addInitScript(() => localStorage.setItem("samvev.preferences", JSON.stringify({ locale: "nb", theme: "light" })));
const page = await context.newPage();
page.on("pageerror", (error) => { unexpected.push("pageerror: " + error.message); console.error(error.stack); });
page.on("console", (message) => { if (message.type() === "error") console.error("browser console:", message.text()); });
await page.route("**/api/v1/**", async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === household + "/events") return route.fulfill({ contentType: "text/event-stream", body: 'event: ready\ndata: {"listenerConnected":true}\n\n' });
  if (path === "/api/v1/me/preferences" && request.method() === "PATCH") return route.fulfill({ status: 204 });
  if (request.method() === "GET" && path === base) return route.fulfill({ json: { tasks: task ? [presented(task)] : [] } });
  if (request.method() === "GET" && initial[path] !== undefined) return route.fulfill({ json: initial[path] });
  if (path === base + "/" + taskId && request.method() === "PATCH") {
    const body = request.postDataJSON();
    calls.push({ method: "PATCH", path, body });
    expect(body.expectedRevision).toBe(task.revision);
    task = { ...task, ...body, revision: task.revision + 1, state: "draft", interpretedRule: null };
    return route.fulfill({ json: presented(task) });
  }
  if (path === base + "/" + taskId + "/interpret" && request.method() === "POST") {
    calls.push({ method: "POST", path, body: request.postDataJSON() });
    return route.fulfill({ status: 202, json: { run: { id: "synthetic-execution", taskId, kind: "interpretation", status: "queued", progress: { stage: "queued", updatedAt: "2030-01-01T00:00:00.000Z" }, usesLocalAi: true, expectedDurationSeconds: 120, queuedAt: "2030-01-01T00:00:00.000Z", startedAt: null, completedAt: null, errorCode: null } } });
  }
  unexpected.push(request.method() + " " + path);
  console.error("unexpected synthetic request:", request.method(), path);
  return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED_SYNTHETIC_REQUEST" } } });
});

try {
  await page.goto("/?tab=monitors");
  const panel = page.locator(".monitor-page");
  await expect(panel.getByRole("heading", { name: "Oppdrag", exact: true })).toBeVisible();
  const card = panel.getByRole("article");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Rediger dette utkastet og velg minst én person eller skjerm.");
  await expect(card.getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true })).toHaveCount(0);
  expect(calls).toHaveLength(0);

  await page.getByRole("button", { name: "Dine innstillinger", exact: true }).first().click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.keyboard.press("Escape");
  await expect(card).toContainText("Edit this draft to choose at least one person or display.");
  await page.screenshot({ path: resolve(process.cwd(), ".local/mcp-monitor-browser/monitor-zero-recipient-en.png"), fullPage: true });
  await page.getByRole("button", { name: "Your preferences", exact: true }).first().click();
  await page.getByLabel("Language", { exact: true }).selectOption("nb");
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "Endre", exact: true }).click();
  await expect(page.getByLabel("Synthetic recipient", { exact: true })).not.toBeChecked();
  await page.getByLabel("Synthetic recipient", { exact: true }).check();
  await page.getByRole("button", { name: "Lagre utkast", exact: true }).click();
  await expect(card.getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("PATCH");
  expect(calls[0].body.targets).toEqual({ personIds: [personId], displayIds: [] });
  await page.screenshot({ path: resolve(process.cwd(), ".local/mcp-monitor-browser/monitor-recipient-selected-nb.png"), fullPage: true });

  await page.getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].path).toBe(base + "/" + taskId + "/interpret");
  expect(unexpected).toEqual([]);
  console.log("PASS synthetic zero-recipient draft: nb/en hints, no setup action before recipient, edit and save recipient, setup action enabled; no external API traffic");
} finally {
  await context.close();
  await browser.close();
}
