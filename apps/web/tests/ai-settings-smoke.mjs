// M2.2 AI admin smoke. Provider inference is always intercepted; no paid request leaves the browser.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://samvev-m1-app-1:4173";
const out =
  process.env.AI_SMOKE_ARTIFACT_DIR ??
  "docs/implementation/artifacts/m2-2";
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const ownerContext = await browser.newContext({
  baseURL,
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
const limitedContext = await browser.newContext({ baseURL });
const page = await ownerContext.newPage();
page.on("pageerror", (error) => console.error("PAGE ERROR", error));
const checks = [];
const screenshots = [];
const record = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
const password = "Synthetic-pilot-pass-42";
const login = async (context, email) => {
  const response = await context.request.post("/api/v1/auth/login", {
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await context.request.get("/api/v1/me")).json();
};

await expect
  .poll(async () => {
    try {
      return (await ownerContext.request.get("/api/v1/health")).ok();
    } catch {
      return false;
    }
  }, { timeout: 60_000 })
  .toBeTruthy();

const owner = await login(ownerContext, "owner@pilot.invalid");
const limited = await login(limitedContext, "limited@pilot.invalid");
const householdId = owner.memberships[0].household_id;
const aiBase = `/api/v1/households/${householdId}/ai`;
const originalPrefs = {
  locale: owner.account.locale,
  theme: owner.account.theme,
};
const originalSettings = await (
  await ownerContext.request.get(`${aiBase}/settings`)
).json();
const authHeaders = { "X-CSRF-Token": owner.csrfToken };
const patchSettings = async (body) => {
  const response = await ownerContext.request.patch(`${aiBase}/settings`, {
    headers: authHeaders,
    data: body,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
};
const savePrefs = async (locale, theme) => {
  const response = await ownerContext.request.patch("/api/v1/me/preferences", {
    headers: authHeaders,
    data: { locale, theme },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
};
let settingsChanged = false;
let completed = false;

try {
  expect(
    originalSettings.hasApiKey,
    "smoke only changes AI configuration when no existing credential could be overwritten",
  ).toBe(false);
  await savePrefs("en", "light");
  await page.goto("/");
  await page.getByRole("button", { name: "AI settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI, under your control." })).toBeVisible();
  await expect(page.getByText("Unavailable in this slice")).toHaveCount(1);
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await page.getByLabel("Local / OpenAI-compatible", { exact: false }).check();
  await expect(page.getByLabel("Base URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("API key (optional)", { exact: true })).toHaveValue("");
  record("owner-only settings expose OpenAI and local compatible choices with conditional local fields");

  const enableAi = page.getByLabel("Enable AI for this household", { exact: true });
  if (await enableAi.isChecked()) await enableAi.uncheck();
  await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:11434/v1");
  await page.getByLabel("Routine model", { exact: true }).fill("synthetic-routine-test");
  await page.getByLabel("Strong model", { exact: true }).fill("synthetic-strong-test");
  await page
    .getByLabel("API key (optional)", { exact: true })
    .fill("short-local-test-key");
  settingsChanged = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("AI settings saved");
  await expect(page.getByLabel("API key (optional)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("API key (optional)", { exact: true })).toHaveAttribute(
    "placeholder",
    "A key is saved securely",
  );

  await page
    .getByLabel("Remove the saved API key when I save", { exact: true })
    .check();
  await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:11434/other/v1");
  await expect(page.getByLabel("API key (optional)", { exact: true })).toBeEnabled();
  await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:11434/v1");
  await page
    .getByLabel("Remove the saved API key when I save", { exact: true })
    .uncheck();
  record("credential removal cannot leave a replacement key field disabled after an endpoint change");

  await page.getByLabel("Routine model", { exact: true }).fill("synthetic-routine-test-v2");
  const patchRequest = page.waitForRequest(
    (request) => request.method() === "PATCH" && request.url().endsWith("/ai/settings"),
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await patchRequest).postDataJSON()).not.toHaveProperty("apiKey");
  await expect(page.getByRole("status")).toContainText("AI settings saved");
  record("real disabled configuration persists by revision, clears the key field, and omits an unchanged credential");

  await page.getByLabel("Strong model", { exact: true }).fill("unsaved-test-block");
  await expect(
    page.getByRole("button", { name: "Test routine tier", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Strong model", { exact: true }).fill("synthetic-strong-test");
  await expect(
    page.getByRole("button", { name: "Test routine tier", exact: true }),
  ).toBeEnabled();
  record("connection tests remain tied to persisted configuration");

  let releaseTest;
  const testGate = new Promise((resolve) => {
    releaseTest = resolve;
  });
  await page.route("**/api/v1/households/*/ai/test", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ modelTier: "routine" });
    await testGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: false,
        provider: "openai_compatible",
        modelTier: "routine",
        checkedAt: new Date().toISOString(),
        errorCode: "AI_RESPONSE_INVALID",
      }),
    });
  });
  await page.getByRole("button", { name: "Test routine tier", exact: true }).click();
  await expect(page.getByLabel("Routine model", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Enable AI for this household", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  releaseTest();
  await expect(page.getByTestId("ai-test-result")).toContainText(
    "provider response was incomplete",
  );
  record("test-only failed response serializes configuration actions and presents failure without a paid provider call");

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    axe.violations.map((violation) => violation.id),
    "AI settings accessibility scan",
  ).toEqual([]);
  record("owner AI settings pass the targeted WCAG axe scan");
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.locator(".skip-link").evaluate((element) => {
    element.hidden = true;
  });
  await page.screenshot({ path: `${out}/ai-settings-en-mobile-light.png`, fullPage: true });
  await page.locator(".skip-link").evaluate((element) => {
    element.hidden = false;
  });
  screenshots.push("ai-settings-en-mobile-light.png");

  await savePrefs("nb", "dark");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: "KI-innstillinger", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "KI, under din kontroll." })).toBeVisible();
  await page.screenshot({ path: `${out}/ai-settings-nb-desktop-dark.png`, fullPage: true });
  screenshots.push("ai-settings-nb-desktop-dark.png");
  record("localized AI settings render at mobile/light and desktop/dark viewports");

  const limitedPage = await limitedContext.newPage();
  await limitedPage.goto("/");
  await expect(
    limitedPage.getByRole("button", { name: /AI settings|KI-innstillinger/ }),
  ).toHaveCount(0);
  await expect(limitedPage.locator("body")).not.toContainText("synthetic-routine-test-v2");
  await expect(limitedPage.locator("body")).not.toContainText("synthetic-strong-test");
  const forbidden = await limitedContext.request.get(
    `/api/v1/households/${limited.memberships[0].household_id}/ai/settings`,
  );
  expect(forbidden.status()).toBe(403);
  record("limited member sees no AI navigation or model identifiers and receives 403 from the admin route");
  completed = true;
} finally {
  await page.unroute("**/api/v1/households/*/ai/test").catch(() => {});
  if (settingsChanged) {
    const current = await (
      await ownerContext.request.get(`${aiBase}/settings`)
    ).json();
    await patchSettings({
      enabled: originalSettings.enabled,
      provider: originalSettings.provider,
      apiKey: null,
      baseUrl: originalSettings.baseUrl,
      defaultModel: originalSettings.defaultModel,
      strongModel: originalSettings.strongModel,
      expectedRevision: current.revision,
    });
  }
  await savePrefs(originalPrefs.locale, originalPrefs.theme);
  await writeFile(
    `${out}/ai-settings-results.json`,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        completed,
        checks: checks.length,
        screenshots,
        providerCalls: "test-only intercepted response; no live inference",
        credential: "synthetic dummy removed; no pre-existing credential changed",
      },
      null,
      2,
    ),
  );
  await browser.close();
}
