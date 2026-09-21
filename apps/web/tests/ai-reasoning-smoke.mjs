// Synthetic API interception only: no server writes, credentials or AI calls.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const baseURL = process.env.BASE_URL ?? "http://samvev-m1-app-1:4173";
const householdId = "10000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";
const accountId = "40000000-0000-4000-8000-000000000001";
const capabilities = ["installation.manage", "household.view", "household.manage", "people.manage", "account.manage", "capability.manage", "message.create.household", "message.publish.display", "message.schedule", "message.manage.household", "display.manage"];
const me = {
  account: { id: accountId, email: "owner@reasoning-test.invalid", locale: "nb", theme: "light" },
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
      email: "owner@reasoning-test.invalid", account_id: accountId, account_revision: 1, display_ids: [] },
    { id: "20000000-0000-4000-8000-000000000002", display_name: "Testprofil", age_group: "unspecified",
      birth_date: null, person_revision: 1, membership_id: "30000000-0000-4000-8000-000000000002",
      role_preset: "limited", capabilities: ["household.view"], revision: 1, has_login: false,
      has_active_login: false, account_status: "profile", email: null, account_id: null, account_revision: null, display_ids: [] },
  ] },
  [`${householdBase}/displays`]: { displays: [] },
  [`${householdBase}/messages`]: { messages: [] },
  [`${householdBase}/dashboard`]: { upcomingBirthday: null },
  [`${householdBase}/settings`]: { show_upcoming_birthday: false, revision: 1 },
  [`${householdBase}/monitors`]: { tasks: [] },
  [`${householdBase}/ai/settings`]: {
    enabled: false, provider: "openai_compatible", hasApiKey: false, baseUrl: "http://model.test:11434/v1",
    defaultModel: "synthetic-routine", strongModel: "synthetic-strong", revision: 1,
    defaultReasoningEffort: "none", strongReasoningEffort: "medium",
    availability: { status: "not_tested", available: false, errorCode: null, checkedAt: null },
    providers: [{ id: "openai_compatible", runtimeAvailable: true, reasonCode: null }, { id: "openai", runtimeAvailable: true, reasonCode: null }],
    chatGptSubscription: { feasibility: "partial", status: "unavailable", reasonCode: "AI_PROVIDER_UNAVAILABLE" },
  },
  [`${householdBase}/ai/usage`]: { summary: { requests: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0 }, recent: [] },
};

const aiBase = `${householdBase}/ai`;
let settings = responses[`${aiBase}/settings`];
const patches = [];
const tests = [];
const unexpected = [];
const errors = [];
let releaseAction;
let pendingAction;
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.route("**/api/v1/**", async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path === `${aiBase}/settings` && request.method() === "PATCH") {
    const patch = request.postDataJSON();
    patches.push(patch);
    if (pendingAction) await pendingAction;
    settings = { ...settings, ...patch, revision: settings.revision + 1 };
    return route.fulfill({ json: settings });
  }
  if (path === `${aiBase}/test` && request.method() === "POST") {
    const body = request.postDataJSON();
    tests.push(body);
    if (pendingAction) await pendingAction;
    // A cold local model may finish after the ordinary API deadline (12s).
    // Exercise the actual client timeout with a delayed synthetic response.
    if (body.modelTier === "routine") await new Promise((resolve) => setTimeout(resolve, 13000));
    settings = { ...settings, availability: { status: "available", available: true, errorCode: null, checkedAt: new Date().toISOString() } };
    return route.fulfill({ json: { available: true, provider: "openai_compatible", modelTier: body.modelTier, checkedAt: settings.availability.checkedAt } });
  }
  if (request.method() === "GET" && responses[path] !== undefined) {
    return route.fulfill({ json: path === `${aiBase}/settings` ? settings : responses[path] });
  }
  unexpected.push(`${request.method()} ${path}`);
  return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED_TEST_REQUEST" } } });
});
const routine = () => page.getByLabel("Resonnering for rutinenivået", { exact: true });
const strong = () => page.getByLabel("Resonnering for sterkt nivå", { exact: true });
const routineTest = () => page.getByRole("button", { name: "Test rutinenivået", exact: true });
const strongTest = () => page.getByRole("button", { name: "Test det sterke nivået", exact: true });
const save = () => page.getByRole("button", { name: "Lagre endringer", exact: true });
const openSettings = async () => {
  await page.getByRole("button", { name: "KI-innstillinger", exact: true }).click();
  await expect(page.getByRole("heading", { name: "KI, under din kontroll." })).toBeVisible();
};
const gate = () => { pendingAction = new Promise((resolve) => { releaseAction = resolve; }); };
const release = () => { releaseAction(); pendingAction = undefined; };
try {
  await page.goto("/");
  await openSettings();
  await expect(routine()).toHaveValue("none");
  await expect(strong()).toHaveValue("medium");
  await expect(save()).toBeDisabled();
  await expect(page.getByText(/Begge tester bruker alltid ingen resonnering/)).toBeVisible();
  await expect(page.getByLabel("API-nøkkel (valgfri)", { exact: true })).toHaveValue("");
  await routine().selectOption("low");
  await strong().selectOption("high");
  await expect(routineTest()).toBeDisabled();
  await expect(strongTest()).toBeDisabled();
  gate();
  await save().click();
  await expect(routine()).toBeDisabled();
  await expect(strong()).toBeDisabled();
  release();
  await expect(page.getByRole("status")).toContainText("KI-innstillingene er lagret");
  expect(patches).toHaveLength(1);
  expect(patches[0]).toEqual({ enabled: false, provider: "openai_compatible", baseUrl: "http://model.test:11434/v1", defaultModel: "synthetic-routine", strongModel: "synthetic-strong", defaultReasoningEffort: "low", strongReasoningEffort: "high", expectedRevision: 1 });
  await page.reload();
  await openSettings();
  await expect(routine()).toHaveValue("low");
  await expect(strong()).toHaveValue("high");
  await expect(save()).toBeDisabled();
  for (const [tier, button, result] of [["routine", routineTest, "Rutinenivå"], ["strong", strongTest, "Sterkt nivå"]]) {
    gate();
    await button().click();
    await expect(routine()).toBeDisabled();
    await expect(strong()).toBeDisabled();
    await expect(page.getByLabel("Rutinemodell", { exact: true })).toBeDisabled();
    await expect(save()).toBeDisabled();
    release();
    await expect(page.getByTestId("ai-test-result")).toContainText(`Tilkoblingen for ${result} var vellykket.`, { timeout: 20000 });
    await expect(page.getByTestId("ai-availability")).toContainText("Siste test var vellykket");
    await expect(routineTest()).toBeEnabled();
    await expect(strongTest()).toBeEnabled();
    await expect(routine()).toHaveValue("low");
    await expect(strong()).toHaveValue("high");
    expect(tests.at(-1)).toEqual({ modelTier: tier });
  }
  expect(tests).toEqual([{ modelTier: "routine" }, { modelTier: "strong" }]);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
  await page.getByLabel("OpenAI API", { exact: false }).check();
  await expect(routine()).toHaveCount(0);
  await expect(strong()).toHaveCount(0);
  await page.getByLabel("Lokal / OpenAI-kompatibel", { exact: false }).check();
  await expect(routine()).toHaveValue("low");
  await expect(strong()).toHaveValue("high");
  await expect(save()).toBeDisabled();
  if (process.env.AI_REASONING_SCREENSHOT) {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await mkdir(dirname(process.env.AI_REASONING_SCREENSHOT), { recursive: true });
    await page.locator(".ai-settings").screenshot({ path: process.env.AI_REASONING_SCREENSHOT });
  }
  me.account.locale = "en";
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.reload();
  await page.getByRole("button", { name: "AI settings", exact: true }).click();
  await expect(page.getByLabel("Routine reasoning", { exact: true })).toHaveValue("low");
  await expect(page.getByLabel("Strong reasoning", { exact: true })).toHaveValue("high");
  await expect(page.getByText(/Both tests always use no reasoning/)).toBeVisible();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  console.log("PASS reasoning defaults; independent save/reload; unchanged URL/models/no key; dirty and busy guards; both tier buttons/results including a 13s response beyond the ordinary API timeout; local-only fields; nb/en mobile/desktop; Axe; zero real API writes or AI calls");
} finally {
  if (pendingAction) release();
  await browser.close();
}
