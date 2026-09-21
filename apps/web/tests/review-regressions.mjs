// Frontend protocol/error regressions. Network fault fixtures are test-only; no production clock or mock integration.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
const baseURL = process.env.BASE_URL ?? "http://app:4173";
const out =
  process.env.SMOKE_ARTIFACT_DIR ??
  "docs/implementation/artifacts/frontend-final";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const checks = [];
const record = (text) => {
  checks.push(text);
  console.log(`PASS ${text}`);
};
const password = "Synthetic-pilot-pass-42";
const login = async (ctx, email) => {
  const response = await ctx.request.post("/api/v1/auth/login", {
    data: { email, password },
  });
  expect(response.ok()).toBeTruthy();
  return (await ctx.request.get("/api/v1/me")).json();
};
const savePrefs = async (prefs) => {
  const res = await context.request.patch("/api/v1/me/preferences", {
    headers: { "X-CSRF-Token": me.csrfToken },
    data: prefs,
  });
  expect(res.ok()).toBeTruthy();
};
await expect
  .poll(
    async () => {
      try {
        return (await context.request.get("/api/v1/health")).ok();
      } catch {
        return false;
      }
    },
    { timeout: 60000 },
  )
  .toBeTruthy();
const me = await login(context, "owner@pilot.invalid");
const base = `/api/v1/households/${me.memberships[0].household_id}`;
const mutate = async (path, data, method = "post") => {
  const response = await context.request[method](path, {
    headers: { "X-CSRF-Token": me.csrfToken },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
};
const checkAxe = async (p, label) => {
  const result = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    label,
  ).toEqual([]);
  record(label);
};
try {
  await savePrefs({ locale: "en", theme: "light" });
  await page.goto("/");
  await page.locator(".account-button").click();
  let dialog = page.getByRole("dialog");
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let patchCount = 0;
  await page.route("**/api/v1/me/preferences", async (route) => {
    patchCount++;
    await gate;
    await route.continue();
  });
  await dialog.getByLabel("Language", { exact: true }).selectOption("nb");
  await expect(dialog.getByTestId("preference-save-status")).toHaveText(
    "Saving…",
  );
  await expect(dialog.getByLabel("Language", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Appearance", { exact: true })).toBeDisabled();
  // Even a synthetic second DOM change cannot enqueue a stale preference object.
  await dialog
    .getByLabel("Appearance", { exact: true })
    .dispatchEvent("change");
  expect(patchCount).toBe(1);
  release();
  await expect(dialog.getByTestId("preference-save-status")).toHaveText(
    "Innstillingene er lagret",
  );
  await page.unroute("**/api/v1/me/preferences");
  await dialog.getByLabel("Utseende", { exact: true }).selectOption("dark");
  await expect(dialog.getByTestId("preference-save-status")).toHaveText(
    "Innstillingene er lagret",
  );
  await expect(dialog.getByLabel("Utseende", { exact: true })).toHaveValue(
    "dark",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  record(
    "F1 delayed PATCH disables rapid changes; both persisted choices survive reload after save",
  );
  await page.locator(".account-button").click();
  dialog = page.getByRole("dialog");
  await page.route("**/api/v1/me/preferences", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }),
    }),
  );
  await dialog.getByLabel("Språk", { exact: true }).selectOption("en");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Språk", { exact: true })).toHaveValue("nb");
  await expect(dialog.getByLabel("Utseende", { exact: true })).toBeEnabled();
  await page.unroute("**/api/v1/me/preferences");
  await dialog.getByLabel("Språk", { exact: true }).selectOption("en");
  await expect(dialog.getByTestId("preference-save-status")).toHaveText(
    "Preferences saved",
  );
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("Appearance", { exact: true }).selectOption("system");
  await expect(dialog.getByTestId("preference-save-status")).toHaveText(
    "Preferences saved",
  );
  await expect(dialog.getByLabel("Appearance", { exact: true })).toHaveValue(
    "system",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  record(
    "F1 failure retains preferences, retry succeeds, system follows OS changes",
  );
  await dialog.getByLabel("Appearance", { exact: true }).selectOption("light");
  await expect(dialog.getByTestId("preference-save-status")).toHaveText(
    "Preferences saved",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "New message", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  const schedule = dialog.getByRole("button", {
    name: "Schedule",
    exact: true,
  });
  await expect(schedule).toHaveAttribute("aria-pressed", "false");
  await schedule.focus();
  await page.keyboard.press("Space");
  await expect(schedule).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByRole("button", { name: "Publish now", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog
    .getByLabel("Publish at", { exact: true })
    .fill("2026-10-26T07:00");
  await dialog.getByLabel("Hide at", { exact: true }).fill("2026-10-26T10:00");
  const preview = dialog.locator(".preview-card");
  await expect(preview).toContainText("Starts Oct 26, 2026, 7:00 AM");
  await expect(preview).toContainText("Until Oct 26, 2026, 10:00 AM");
  await expect(preview).toContainText("Europe/Oslo");
  await expect(preview).not.toContainText("2026-10-26T");
  await dialog
    .getByLabel("Publish at", { exact: true })
    .fill("2026-10-25T02:30");
  await expect(preview).toContainText("Choose a valid time to preview it.");
  await dialog
    .getByLabel("Your message", { exact: true })
    .fill("Synthetic retained form text");
  await dialog
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Your message", { exact: true })).toHaveValue(
    "Synthetic retained form text",
  );
  record(
    "F4 keyboard selected state and F5 localized preview, expiry, zone and invalid-time preservation",
  );
  await checkAxe(page, "F2 composer unchanged Axe WCAG A/AA checks");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await checkAxe(page, "F2 member board unchanged Axe WCAG A/AA checks");
  // Separate front-end capability combinations; server enforcement has independent API tests.
  const originalMe = await (await context.request.get("/api/v1/me")).json();
  const policyContext = await browser.newContext({ baseURL });
  await policyContext.addCookies(await context.cookies());
  const policyPage = await policyContext.newPage();
  const responseFor = (caps) => ({
    ...originalMe,
    memberships: originalMe.memberships.map((m) => ({
      ...m,
      capabilities: caps,
    })),
  });
  await policyPage.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: responseFor([
        "household.view",
        "people.manage",
        "capability.manage",
      ]),
    }),
  );
  await policyPage.goto("/");
  await policyPage.getByRole("button", { name: "People", exact: true }).click();
  await expect(policyPage.locator(".person-email")).toHaveCount(0);
  await policyPage
    .getByRole("button", { name: "Add person", exact: true })
    .click();
  let personDialog = policyPage.getByRole("dialog");
  await expect(
    personDialog.getByLabel("Give this person a sign-in"),
  ).toHaveCount(0);
  await expect(
    personDialog
      .getByLabel("Starting permissions")
      .locator('option[value="household_admin"]'),
  ).toBeDisabled();
  await expect(
    personDialog.getByLabel("Manage people", { exact: true }),
  ).toBeDisabled();
  await personDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await policyPage.unroute("**/api/v1/me");
  await policyPage.route("**/api/v1/me", (route) =>
    route.fulfill({ json: responseFor(["household.view", "account.manage"]) }),
  );
  await policyPage.reload();
  await policyPage.getByRole("button", { name: "People", exact: true }).click();
  await expect(
    policyPage.getByRole("button", { name: "Add person", exact: true }),
  ).toHaveCount(0);
  await expect(policyPage.locator(".person-email").first()).toBeVisible();
  await policyContext.close();
  await page.getByRole("button", { name: "People", exact: true }).click();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  personDialog = page.getByRole("dialog");
  await expect(
    personDialog
      .getByLabel("Starting permissions")
      .locator('option[value="household_admin"]'),
  ).toBeDisabled();
  await personDialog.getByLabel("Give this person a sign-in").check();
  await expect(
    personDialog
      .getByLabel("Starting permissions")
      .locator('option[value="household_admin"]'),
  ).toBeEnabled();
  await personDialog
    .getByLabel("Starting permissions")
    .selectOption("household_admin");
  await personDialog.getByLabel("Give this person a sign-in").uncheck();
  await expect(personDialog.getByLabel("Starting permissions")).toHaveValue(
    "member",
  );
  await expect(
    personDialog.getByLabel("Manage displays", { exact: true }),
  ).not.toBeChecked();
  await personDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  record(
    "F7 separate people/account controls and active-login elevated role/grant requirements",
  );
  // Real limited-author message changed by a different user; original author and safe activity remain visible.
  const limitedContext = await browser.newContext({ baseURL });
  const lm = await login(limitedContext, "limited@pilot.invalid");
  let response = await limitedContext.request.post(`${base}/messages`, {
    headers: { "X-CSRF-Token": lm.csrfToken },
    data: {
      body: "Synthetic activity review",
      audience: { household: true, personIds: [], displayIds: [] },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      idempotencyKey: `activity-review-${Date.now()}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  let message = await response.json();
  message = await mutate(
    `${base}/messages/${message.id}`,
    {
      body: "Synthetic activity review, edited",
      expectedRevision: message.revision,
    },
    "patch",
  );
  await mutate(`${base}/messages/${message.id}/withdraw`, {
    expectedRevision: message.revision,
  });
  const limited = await limitedContext.newPage();
  await limited.goto("/");
  await limited.getByRole("tab", { name: /History/ }).click();
  const changed = limited
    .locator(".message-card")
    .filter({ hasText: "Synthetic activity review, edited" })
    .first();
  await expect(changed).toContainText("From Robin · example");
  await expect(changed.locator(".message-activity")).toContainText(
    "Edited by Avery · example",
  );
  await expect(changed.locator(".message-activity")).toContainText(
    "Withdrawn by Avery · example",
  );
  await limitedContext.close();
  record(
    "F6 real other-user edit/withdraw activity is visible to original author",
  );
  // Pair a restricted test screen via real endpoints, then inject only stream/network/timing faults.
  const displayContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 752 },
  });
  const bound = await displayContext.newPage();
  await bound.goto("/display");
  await bound.getByRole("button", { name: "Get a pairing code" }).click();
  const code = await bound.getByTestId("pairing-code").textContent();
  const paired = await mutate(`${base}/displays/pairing/approve`, {
    code,
    name: "Frontend fault-test · example",
    locale: "en",
    theme: "light",
    privacyMode: false,
    allowedContent: "household_messages",
  });
  await expect(bound.locator(".display-identity strong")).toHaveText(
    "Frontend fault-test · example",
    { timeout: 15000 },
  );
  for (const [index, body] of [
    "Short-lived synthetic card",
    "Later synthetic card",
  ].entries())
    await mutate(`${base}/messages`, {
      body,
      importance: index === 0 ? "attention" : "normal",
      audience: {
        household: false,
        personIds: [],
        displayIds: [paired.displayId],
      },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      idempotencyKey: `cache-review-${Date.now()}-${index}`,
    });
  await expect(bound.locator(".display-card")).toHaveCount(2, {
    timeout: 10000,
  });
  const projection = await (
    await displayContext.request.get("/api/v1/display/projection")
  ).json();
  await bound.close();
  const testScreen = await displayContext.newPage();
  await testScreen.addInitScript(() => {
    class ControlledEvents extends EventTarget {
      static instance;
      static count = 0;
      constructor() {
        super();
        ControlledEvents.instance = this;
        ControlledEvents.count++;
      }
      close() {}
    }
    window.EventSource = ControlledEvents;
    window.sendStream = (name, data) =>
      ControlledEvents.instance.dispatchEvent(
        new MessageEvent(name, { data: JSON.stringify(data) }),
      );
  });
  let projectionMode = "ok",
    releaseProjection;
  let pendingProjection = false;
  await testScreen.route("**/api/v1/display/projection", async (route) => {
    if (projectionMode === "fail") {
      await route.fulfill({
        status: 503,
        json: { error: { code: "INTERNAL_ERROR" } },
      });
      return;
    }
    if (projectionMode === "held") {
      pendingProjection = true;
      await new Promise((resolve) => (releaseProjection = resolve));
    }
    await route.fulfill({
      json: {
        ...projection,
        serverNow: new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        cacheUntil: new Date(Date.now() + 900000).toISOString(),
      },
    });
  });
  await testScreen.goto("/display");
  await expect(testScreen.locator(".display-card")).toHaveCount(2);
  await testScreen.evaluate(() =>
    window.sendStream("ready", {
      listenerConnected: false,
      pollingFallback: true,
    }),
  );
  await expect(testScreen.locator(".connection-pill")).toHaveText(
    "Updating by polling",
  );
  await testScreen.evaluate(() =>
    window.sendStream("heartbeat", {
      listenerConnected: true,
      pollingFallback: false,
    }),
  );
  await expect(testScreen.locator(".connection-pill")).toHaveText(
    "Updating by polling",
  );
  projectionMode = "held";
  await testScreen.evaluate(() =>
    window.sendStream("listener-restored", {
      listenerConnected: true,
      pollingFallback: true,
      refetchRequired: true,
    }),
  );
  await expect.poll(() => pendingProjection).toBeTruthy();
  await testScreen.evaluate(() =>
    window.sendStream("heartbeat", {
      listenerConnected: true,
      pollingFallback: false,
    }),
  );
  await expect(testScreen.locator(".connection-pill")).toHaveText(
    "Reconnecting",
  );
  projectionMode = "ok";
  releaseProjection();
  await expect(testScreen.locator(".connection-pill")).toHaveText(
    "Live updates",
  );
  record(
    "F3 degraded startup and heartbeat cannot claim Live; restored waits for fresh projection",
  );
  await testScreen.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(testScreen.locator(".connection-pill")).not.toHaveText(
    "Live updates",
  );
  projectionMode = "held";
  pendingProjection = false;
  await testScreen.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(() => testScreen.evaluate(() => window.EventSource.count))
    .toBe(2);
  await expect.poll(() => pendingProjection).toBeTruthy();
  await testScreen.evaluate(() =>
    window.sendStream("heartbeat", {
      listenerConnected: true,
      pollingFallback: false,
    }),
  );
  await expect(testScreen.locator(".connection-pill")).not.toHaveText(
    "Live updates",
  );
  await testScreen.evaluate(() =>
    window.sendStream("ready", {
      listenerConnected: true,
      pollingFallback: false,
    }),
  );
  await expect(testScreen.locator(".connection-pill")).not.toHaveText(
    "Live updates",
  );
  projectionMode = "ok";
  releaseProjection();
  await expect(testScreen.locator(".connection-pill")).toHaveText(
    "Live updates",
  );
  record(
    "F3 offline closes old stream; online creates a new stream and requires ready plus fresh projection",
  );

  await testScreen.close();
  const cachePage = await displayContext.newPage();
  await cachePage.clock.install();
  await cachePage.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      close() {}
    };
  });
  const anchor = Date.now();
  const timed = {
    ...projection,
    serverNow: new Date(anchor).toISOString(),
    generatedAt: new Date(anchor).toISOString(),
    cacheUntil: new Date(anchor + 900000).toISOString(),
    cards: projection.cards.map((card, index) => ({
      ...card,
      expiresAt: new Date(
        anchor + (index === 0 ? 60000 : 1200000),
      ).toISOString(),
    })),
  };
  let firstFetch = true;
  await cachePage.route("**/api/v1/display/projection", (route) => {
    if (firstFetch) {
      firstFetch = false;
      return route.fulfill({ json: timed });
    }
    return route.abort("failed");
  });
  await cachePage.goto("/display");
  await expect(cachePage.locator(".display-card")).toHaveCount(2);
  await cachePage.clock.fastForward(61000);
  await expect(cachePage.locator(".display-card")).toHaveCount(1);
  await expect(cachePage.locator(".display-card-body")).toHaveText(
    "Later synthetic card",
  );
  await expect(cachePage.locator(".display-identity strong")).toHaveText(
    "Frontend fault-test · example",
  );
  await cachePage.reload();
  await expect(cachePage.locator(".display-card")).toHaveCount(1);
  await cachePage.clock.fastForward(840000);
  await expect(cachePage.locator(".display-card")).toHaveCount(0);
  await expect(
    cachePage.getByRole("heading", { name: "Saved messages have cleared." }),
  ).toBeVisible();
  await expect(cachePage.locator(".connection-pill")).not.toHaveText(
    "Live updates",
  );
  expect(
    await cachePage.evaluate(() =>
      localStorage.getItem("samvev.display.projection.v1"),
    ),
  ).toBeNull();
  record(
    "F3 independent offline card expiry, metadata retention, reload deadline and real 15min cache clearing",
  );
  await cachePage.close();
  await displayContext.close();
  await mutate(
    `${base}/displays/${paired.displayId}`,
    { revoked: true },
    "patch",
  );
  await savePrefs({ locale: "en", theme: "light" });
  await writeFile(
    `${out}/review-regressions.json`,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        checks,
        notes: [
          "Fault injection is frontend-only test code; scheduling smoke uses real worker.",
          "No QA baselines changed.",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
