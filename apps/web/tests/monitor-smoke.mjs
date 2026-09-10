// All API traffic is synthetic and intercepted: no database, source or AI calls.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
const baseURL = process.env.BASE_URL ?? "http://samvev-m1-app-1:4173";
const householdId = "10000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";
const accountId = "40000000-0000-4000-8000-000000000001";
const capabilities = ["installation.manage", "household.view", "household.manage", "people.manage", "account.manage", "capability.manage", "message.create.household", "message.publish.display", "message.schedule", "message.manage.household", "display.manage"];
const me = {
  account: { id: accountId, email: "owner@task-test.invalid", locale: "nb", theme: "light" },
  csrfToken: "synthetic-browser-only",
  memberships: [{ id: membershipId, household_id: householdId, person_id: personId,
    role_preset: "installation_admin", capabilities, revision: 1, household_name: "Testhjem",
    timezone: "Europe/Oslo", household_locale: "nb", display_name: "Testeier", display_ids: [] }],
};
const householdBase = `/api/v1/households/${householdId}`;
const responses = {
  "/api/v1/setup/status": { claimed: true, demo: false, demoAvailable: false, locale: "nb" },
  "/api/v1/setup/progress": { setupStep: "complete" },
  "/api/v1/me": me,
  [`${householdBase}/people`]: { people: [
    { id: personId, display_name: "Testeier", age_group: "adult", birth_date: "1990-01-15", calculated_age: 36,
      person_revision: 1, membership_id: membershipId, role_preset: "installation_admin", capabilities,
      revision: 1, has_login: true, has_active_login: true, account_status: "active",
      email: "owner@task-test.invalid", account_id: accountId, account_revision: 1, display_ids: [] },
    { id: "20000000-0000-4000-8000-000000000002", display_name: "Testprofil", age_group: "unspecified",
      birth_date: null, person_revision: 1, membership_id: "30000000-0000-4000-8000-000000000002",
      role_preset: "limited", capabilities: ["household.view"], revision: 1, has_login: false,
      has_active_login: false, account_status: "profile", email: null, account_id: null, account_revision: null, display_ids: [] },
  ] },
  [`${householdBase}/displays`]: { displays: [{ id: "50000000-0000-4000-8000-000000000001", name: "Testskjerm", revision: 1 }] },
  [`${householdBase}/messages`]: { messages: [] },
  [`${householdBase}/dashboard`]: { upcomingBirthday: null },
  [`${householdBase}/settings`]: { show_upcoming_birthday: false, revision: 1 },
  [`${householdBase}/monitors`]: { tasks: [] },
  [`${householdBase}/ai/settings`]: {
    enabled: false, provider: "openai_compatible", hasApiKey: false, baseUrl: null,
    defaultModel: "", strongModel: "", revision: 1,
    availability: { status: "not_configured", available: false, errorCode: null, checkedAt: null },
    providers: [{ id: "openai_compatible", runtimeAvailable: true, reasonCode: null }, { id: "openai", runtimeAvailable: true, reasonCode: null }],
    chatGptSubscription: { feasibility: "partial", status: "unavailable", reasonCode: "AI_PROVIDER_UNAVAILABLE" },
  },
  [`${householdBase}/ai/usage`]: { summary: { requests: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0 }, recent: [] },
};

const base = `${householdBase}/monitors`;
const sourceUrl = "https://example.com/news";
const scheduledAt = "2030-09-19T10:00:00.000Z";
const checkedAt = "2030-09-18T10:00:00.000Z";
const taskId = "60000000-0000-4000-8000-000000000001";
const answer = { version: 1, answer: "Biblioteket åpner en ny lesehage.", evidence: { quote: "Biblioteket åpner en ny lesehage.", sourceUrl }, confidence: 0.99, uncertainty: "Åpningsdatoen er ikke oppgitt." };
const rule = { resultKind: "answer", summary: "Finn den nyeste overskriften og vis svaret.", eventTypes: [], keywords: [], people: [], checkIntervalMinutes: 60, noticeDaysBefore: 1, noticeLocalTime: "18:00" };
let tasks = [];
let failNext;
let unchangedNext = false;
let gate;
let release;
const calls = [];
const unexpected = [];
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  const original = AbortSignal.timeout;
  window.taskTimeouts = [];
  AbortSignal.timeout = function (ms) { window.taskTimeouts.push(ms); return original.call(this, ms); };
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
async function mock(currentPage, restricted = false) {
  await currentPage.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === base) return route.fulfill({ json: { tasks } });
    if (path.startsWith(base) && request.method() !== "GET") {
      const body = request.postDataJSON();
      calls.push({ path, method: request.method(), body });
      if (gate) await gate;
      if (failNext) { const code = failNext; failNext = undefined; return route.fulfill({ status: 422, json: { error: { code } } }); }
      if (path === base && request.method() === "POST") {
        const task = { id: taskId, name: body.name ?? "Nyheter fra biblioteket", instruction: body.instruction, sourceUrl: body.sourceUrl ?? sourceUrl, state: "draft", checkIntervalMinutes: 1440, noticeDaysBefore: 1, noticeLocalTime: "18:00", providerPolicy: "default", modelTier: "routine", targets: body.targets, interpretedRule: null, events: [], revision: 1, approvedRevision: null, lastCheckedAt: null, nextCheckAt: null, lastResult: null, lastChangedAt: null, errorCode: null, stats: { checks: 0, aiCalls: 0, unchanged: 0 } };
        tasks = [task]; return route.fulfill({ json: task });
      }
      let task = tasks.find((entry) => path.includes(entry.id));
      expect(body.expectedRevision).toBe(task.revision);
      if (request.method() === "DELETE") { tasks = tasks.filter((entry) => entry.id !== task.id); return route.fulfill({ status: 204 }); }
      if (request.method() === "PATCH") {
        task = { ...task, ...body, revision: task.revision + 1, state: "draft", interpretedRule: null, nextCheckAt: null, latestResult: null, events: [], lastResult: null };
      } else {
        const action = path.split("/").at(-1);
        if (["test", "run", "smarter"].includes(action)) {
          if (action === "run" && unchangedNext) {
            unchangedNext = false; task.lastCheckedAt = "2030-09-18T11:00:00.000Z"; task.lastResult = "unchanged";
            return route.fulfill({ json: { outcome: "unchanged", resultKind: null, result: null, sourceUrl, checkedAt: task.lastCheckedAt } });
          }
          if (action === "run") { task.lastCheckedAt = checkedAt; task.lastResult = answer.answer; task.stats = { checks: 14, aiCalls: 1, unchanged: 13 }; }
          const eventResult = task.interpretedRule.resultKind === "events";
          task.latestResult = { resultKind: eventResult ? "events" : "answer", result: eventResult ? { version: 1, events: task.events } : answer, sourceUrl, checkedAt };
          return route.fulfill({ json: { outcome: "changed", ...task.latestResult } });
        }
        task = { ...task, revision: task.revision + 1 };
        if (action === "interpret") task = { ...task, interpretedRule: rule, checkIntervalMinutes: 60 };
        else if (action === "approve" || action === "resume") task = { ...task, state: "active", approvedRevision: task.revision, nextCheckAt: scheduledAt };
        if (action === "approve") task = { ...task, latestResult: null, events: [], lastResult: null };
        else if (action === "pause") task = { ...task, state: "paused", nextCheckAt: null };
        else if (action === "quality") task.modelTier = body.quality === "smarter" ? "strong" : "routine";
        else if (!["interpret", "resume"].includes(action)) unexpected.push(path);
      }
      tasks = tasks.map((entry) => entry.id === task.id ? task : entry);
      return route.fulfill({ json: task });
    }
    if (request.method() === "GET" && responses[path] !== undefined) {
      const value = path === "/api/v1/me" && restricted ? { ...me, memberships: [{ ...me.memberships[0], role_preset: "limited", capabilities: ["household.view"] }] } : responses[path];
      return route.fulfill({ json: value });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED_TEST_REQUEST" } } });
  });
}
const panel = () => page.locator(".monitor-page");
const card = () => panel().getByRole("article").first();
const button = (name) => card().getByRole("button", { name, exact: true });
const navigate = async () => { await page.getByRole("button", { name: "Oppdrag", exact: true }).click(); await expect(panel().getByRole("heading", { name: "Oppdrag", exact: true })).toBeVisible(); };
const noTechnicalTerms = async () => { await expect(panel()).not.toContainText(/OpenAI|Ollama|provider|leverandør|modell|model|policy|reasoning|resonnering|API|KI-/i); };
const axe = async () => { const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(result.violations.map(({ id }) => id)).toEqual([]); };
const layout = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
try {
  await mock(page);
  await page.goto("/"); await navigate();
  await panel().getByRole("button", { name: "Nytt oppdrag" }).click();
  await expect(page.getByLabel("Din forespørsel", { exact: true })).toBeFocused();
  await noTechnicalTerms();
  await page.getByLabel("Din forespørsel", { exact: true }).fill("Finn den nyeste overskriften.");
  failNext = "MONITOR_SOURCE_REQUIRED";
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(panel().getByRole("alert")).toContainText("Samvev trenger en kilde");
  await expect(panel().getByRole("alert")).toBeFocused();
  failNext = "MONITOR_SOURCE_AMBIGUOUS";
  await page.getByLabel("Din forespørsel", { exact: true }).fill("Sammenlign https://example.com og https://example.org.");
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(panel().getByRole("alert")).toContainText("Forespørselen inneholder flere kilder");
  await page.getByLabel("Din forespørsel", { exact: true }).fill("Finn den nyeste overskriften fra https://example.com/news hver time.");
  gate = new Promise((resolve) => { release = resolve; });
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(page.getByLabel("Din forespørsel", { exact: true })).toBeDisabled();
  release(); gate = undefined;
  await expect(card()).toContainText("Venter på din godkjenning");
  await expect(card().locator(".preview-panel")).toBeFocused();
  expect(calls.filter((call) => call.path === base).at(-1).body).not.toHaveProperty("sourceUrl");
  expect(calls.filter((call) => call.path === base).at(-1).body).not.toHaveProperty("name");
  for (const call of calls) { expect(call.body).not.toHaveProperty("providerPolicy"); expect(call.body).not.toHaveProperty("modelTier"); }
  await expect(card()).toContainText("Intervall: 60 minutter");
  await expect(card()).toContainText("Svar fra kilden");
  await expect(card()).toContainText("Testskjerm");
  await button("Test nå").focus(); await page.keyboard.press("Enter");
  await expect(card().locator(".monitor-result")).toBeFocused();
  await expect(card()).toContainText(answer.answer);
  await expect(card()).toContainText("Dette er en prøve. Oppdragets plan og varsler er uendret.");
  expect(tasks[0].state).toBe("draft"); expect(tasks[0].nextCheckAt).toBeNull();
  await button("Godkjenn og aktiver").click();
  await expect(card().locator(".monitor-state")).toHaveText("Aktiv");
  await button("Kjør nå").click();
  await expect(card()).toContainText("Neste planlagte kontroll er uendret");
  await expect(card()).toContainText("Kontroller: 14 · Nye tolkninger: 1");
  expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  await page.reload(); await navigate();
  await expect(card().locator(".monitor-result").getByRole("heading")).toHaveText("Siste resultat");
  await expect(card().locator(".monitor-result")).toContainText(answer.answer);
  await expect(card().locator(".monitor-result blockquote")).toHaveText(answer.evidence.quote);
  await expect(card().locator(".monitor-result")).toContainText(answer.uncertainty);
  await expect(card().locator(".monitor-result a")).toHaveAttribute("href", sourceUrl);
  await expect(card().locator(".monitor-result small")).toContainText("2030");
  await expect(card().locator(".monitor-result")).not.toContainText("Dette er en prøve");
  expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  unchangedNext = true;
  await button("Kjør nå").click();
  await expect(card().locator(".monitor-result")).toContainText("Kilden er uendret");
  await expect(card().locator(".monitor-result")).toContainText(answer.answer);
  await expect(card().locator(".monitor-result blockquote")).toHaveText(answer.evidence.quote);
  await expect(card().locator(".monitor-result")).toContainText(answer.uncertainty);
  await expect(card().locator(".monitor-result a")).toHaveAttribute("href", sourceUrl);
  await expect(card().locator(".monitor-result small")).toContainText("12:00");
  await button("Prøv med smartere KI").click();
  await expect(card()).toContainText("Et smartere forslag");
  expect(tasks[0].modelTier).toBe("routine"); expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  await button("Bruk smartere KI for dette oppdraget fremover").click();
  await expect(card().locator(".monitor-meta")).toContainText("Smartere");
  expect(tasks[0].nextCheckAt).toBe(scheduledAt);
  await button("Bruk standard fremover").click();
  await expect(card().locator(".monitor-meta")).toContainText("Standard");
  failNext = "AI_TIMEOUT";
  await button("Kjør nå").click();
  await expect(card().getByRole("alert")).toContainText("Dette tok for lang tid");
  await expect(card().getByRole("alert")).toBeFocused();
  await noTechnicalTerms();
  await button("Pause").click();
  await expect(card().locator(".monitor-state")).toHaveText("Pauset");
  await button("Test nå").click();
  await expect(card()).toContainText("Testresultat"); expect(tasks[0].state).toBe("paused");
  await button("Aktiver igjen").click();
  await expect(card().locator(".monitor-state")).toHaveText("Aktiv");
  await axe(); await layout();
  await page.setViewportSize({ width: 1280, height: 752 }); await layout(); await noTechnicalTerms(); await axe();
  if (process.env.MONITOR_SCREENSHOT_DIR) { await mkdir(process.env.MONITOR_SCREENSHOT_DIR, { recursive: true }); await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()); await panel().screenshot({ path: `${process.env.MONITOR_SCREENSHOT_DIR}/tasks-answer-nb-synthetic.png` }); }
  await button("Endre").click();
  await expect(page.getByLabel("Din forespørsel", { exact: true })).toBeFocused();
  await expect(panel()).toContainText("Oppdraget må godkjennes igjen");
  await page.getByLabel("Kilde (valgfritt)", { exact: true }).fill("https://example.org/override");
  await panel().getByRole("button", { name: "Lag oppsett fra forespørselen", exact: true }).click();
  await expect(card().locator(".preview-panel")).toBeFocused();
  await expect(card()).toContainText("Venter på din godkjenning");
  expect(calls.findLast((call) => call.method === "PATCH").body.sourceUrl).toBe("https://example.org/override");
  expect(tasks[0].latestResult).toBeNull();
  expect(tasks[0].events).toEqual([]);
  await expect(card().locator(".monitor-result")).toHaveCount(0);
  await expect(card()).not.toContainText(answer.answer);
  await button("Godkjenn og aktiver").click();
  await expect(card().locator(".monitor-state")).toHaveText("Aktiv");
  await expect(card().locator(".monitor-result")).toHaveCount(0);
  await expect(card()).not.toContainText(answer.answer);
  await button("Kjør nå").click();
  await expect(card().locator(".monitor-result")).toContainText(answer.answer);
  await button("Slett").click();
  await expect(card().locator(".monitor-delete")).toBeFocused();
  await button("Ja, slett oppdraget").click();
  await expect(panel().getByRole("heading", { name: "Oppdrag", exact: true })).toBeFocused();
  await expect(panel()).toContainText("Ingen oppdrag ennå");
  const timeoutValues = await page.evaluate(() => window.taskTimeouts);
  expect(timeoutValues).toContain(60000); expect(timeoutValues).toContain(12000);
  // Persisted events and incomplete setup get distinct representations.
  tasks = [{ id: taskId, name: "Testtur", instruction: "Finn fremtidige turer fra https://example.com/news.", sourceUrl, state: "active", checkIntervalMinutes: 60, noticeDaysBefore: 1, noticeLocalTime: "18:00", providerPolicy: "local", modelTier: "routine", targets: { personIds: [], displayIds: ["50000000-0000-4000-8000-000000000001"] }, interpretedRule: { ...rule, resultKind: "events", summary: "Finn fremtidige turer.", eventTypes: ["tur"] }, events: [{ date: "2030-09-20", time: "10:00", type: "tur", description: "Tur til testparken", actions: ["Ta med vann"], who: ["Testprofil"], evidence: { quote: "2030-09-20 klokken 10:00: Tur til testparken. Ta med vann.", sourceUrl }, confidence: .99, uncertainty: null }], revision: 1, approvedRevision: 1, lastCheckedAt: checkedAt, nextCheckAt: scheduledAt, lastResult: "1 event(s)", lastChangedAt: checkedAt, errorCode: null, stats: { checks: 1, aiCalls: 1, unchanged: 0 } }];
  tasks.push({ ...tasks[0], id: "60000000-0000-4000-8000-000000000002", name: "Uferdig oppdrag", state: "draft", interpretedRule: null, events: [], nextCheckAt: null });
  me.account.locale = "en";
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(panel()).toContainText("Setup needed");
  await expect(panel()).toContainText("Days before: 1 · Time: 18:00 · Europe/Oslo");
  await card().getByRole("button", { name: "Run now", exact: true }).click();
  await expect(card()).toContainText("Tur til testparken");
  await expect(card()).toContainText("Ta med vann");
  await expect(card().locator(".monitor-result a").last()).toHaveAttribute("href", sourceUrl);
  unchangedNext = true;
  await card().getByRole("button", { name: "Run now", exact: true }).click();
  await expect(card().locator(".monitor-result")).toContainText("Source unchanged");
  await expect(card().locator(".monitor-result")).toContainText("Tur til testparken");
  await expect(card().locator(".monitor-result blockquote")).toContainText("2030-09-20");
  await noTechnicalTerms(); await layout(); await axe();
  const actionHeights = await panel().locator(".card-actions button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(actionHeights.every((height) => height >= 44)).toBe(true);
  me.account.theme = "dark";
  await page.setViewportSize({ width: 1280, height: 752 }); await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await noTechnicalTerms(); await layout(); await axe();
  const limitedContext = await browser.newContext({ baseURL }); const limited = await limitedContext.newPage(); await mock(limited, true); await limited.goto("/");
  await expect(limited.getByRole("button", { name: "Tasks", exact: true })).toHaveCount(0); await limitedContext.close();
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  console.log("PASS synthetic prompt-first create/interpret; optional/ambiguous source errors; approval/test/manual/quality/pause/resume/edit/delete; answer/event evidence+time including persisted answer evidence/uncertainty after reload; unchanged retains answer/events; edited/reapproved setup clears stale results; preserved schedule representation; no technical controls; 60s actions; restricted navigation; keyboard/focus; 44px actions; nb/en mobile/XL/desktop and dark-theme layout/Axe; zero real requests");
} finally { if (gate) release(); await browser.close(); }
