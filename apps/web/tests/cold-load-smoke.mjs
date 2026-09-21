// Built-asset regression with synthetic API responses only. Never authenticates,
// writes to the server, invokes AI, or reads the real household's data.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const baseURL = process.env.BASE_URL ?? "http://samvev-m1-app-1:4173";
const householdId = "10000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";
const accountId = "40000000-0000-4000-8000-000000000001";
const capabilities = ["installation.manage", "household.view", "household.manage", "people.manage", "account.manage", "capability.manage", "message.create.household", "message.publish.display", "message.schedule", "message.manage.household", "display.manage"];
const me = {
  account: { id: accountId, email: "owner@cold-load.invalid", locale: "nb", theme: "light" },
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
      email: "owner@cold-load.invalid", account_id: accountId, account_revision: 1, display_ids: [] },
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
    enabled: false, provider: "openai_compatible", hasApiKey: false, baseUrl: null,
    defaultModel: "", strongModel: "", revision: 1,
    availability: { status: "not_configured", available: false, errorCode: null, checkedAt: null },
    providers: [{ id: "openai_compatible", runtimeAvailable: true, reasonCode: null }, { id: "openai", runtimeAvailable: true, reasonCode: null }],
    chatGptSubscription: { feasibility: "partial", status: "unavailable", reasonCode: "AI_PROVIDER_UNAVAILABLE" },
  },
  [`${householdBase}/ai/usage`]: { summary: { requests: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0 }, recent: [] },
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 850 }, reducedMotion: "reduce" });
const page = await context.newPage();
const requests = [];
const unexpected = [];
const errors = [];
const assets = [];
let documents = 0;
page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
page.on("response", (response) => {
  if (new URL(response.url()).pathname.startsWith("/assets/")) assets.push({ path: new URL(response.url()).pathname, status: response.status(), type: response.headers()["content-type"] });
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
async function mockApi(currentPage, overrides = {}) {
  await currentPage.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const value = { ...responses, ...overrides }[path];
    if (request.method() !== "GET" || value === undefined) {
      unexpected.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED_TEST_REQUEST" } } });
    }
    requests.push({ path, status: 200 });
    return route.fulfill({ status: 200, json: value });
  });
}
async function axe(currentPage) {
  const result = await new AxeBuilder({ page: currentPage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map(({ id }) => id)).toEqual([]);
}
async function home() {
  await expect(page.getByRole("heading", { name: "Små beskjeder. En enklere hverdag." })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Nå 0", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#root > *")).not.toHaveCount(0);
}
try {
  await mockApi(page);
  expect((await page.goto("/")).status()).toBe(200);
  await home();
  const startupPaths = ["/api/v1/setup/status", "/api/v1/me", "/api/v1/setup/progress", ...["dashboard", "settings", "people", "displays", "messages"].map((name) => `${householdBase}/${name}`)];
  for (const path of startupPaths) await expect.poll(() => requests.filter((request) => request.path === path && request.status === 200).length).toBeGreaterThan(0);
  expect(me.memberships).toHaveLength(1);
  await expect(page.getByText("Testhjem", { exact: true })).toBeVisible();
  await axe(page);
  const beforeReload = requests.length;
  expect((await page.reload()).status()).toBe(200);
  await home();
  for (const path of startupPaths) await expect.poll(() => requests.slice(beforeReload).filter((request) => request.path === path).length).toBeGreaterThan(0);
  const homeDocument = documents;
  for (const [navigation, heading] of [["Personer", "Plass til alle."], ["KI-innstillinger", "KI, under din kontroll."], ["Oppdrag", "Oppdrag"]]) {
    await page.getByRole("tab", { name: "Planlagt 0", exact: true }).click();
    await page.getByRole("button", { name: navigation, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Samvev", exact: true }).click();
    await home();
    await expect(page.locator("#main")).toBeFocused();
    expect(documents).toBe(homeDocument);
  }
  await page.getByRole("button", { name: "Personer", exact: true }).click();
  await page.getByRole("link", { name: "Samvev", exact: true }).focus();
  await page.keyboard.press("Enter");
  await home();
  expect(documents).toBe(homeDocument);
  // Observe native anchor defaults without opening tabs/windows in this test.
  const modifiedClicks = await page.getByRole("link", { name: "Samvev", exact: true }).evaluate((anchor) => {
    return [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }].map((options) => {
      let preventedByBrand;
      document.addEventListener("click", (event) => { preventedByBrand = event.defaultPrevented; event.preventDefault(); }, { once: true });
      anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...options }));
      return preventedByBrand;
    });
  });
  expect(modifiedClicks).toEqual([false, false, false, false, false]);
  expect(errors).toEqual([]);
  expect(assets.some(({ path }) => path.endsWith(".js"))).toBe(true);
  for (const asset of assets) {
    expect(asset.status, asset.path).toBe(200);
    expect(asset.type, asset.path).toMatch(asset.path.endsWith(".js") ? /javascript/ : /text\/css/);
  }
  for (const locale of ["nb", "en"]) {
    const failureContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    if (locale === "en") await failureContext.addInitScript(() => localStorage.setItem("samvev.preferences", JSON.stringify({ locale: "en", theme: "light" })));
    const failurePage = await failureContext.newPage();
    const failureErrors = [];
    failurePage.on("pageerror", (error) => failureErrors.push(error.message));
    failurePage.on("console", (message) => { if (message.type() === "error") failureErrors.push(message.text()); });
    // Deliberately violate the membership render contract to exercise the real
    // root boundary; no test-only crash switch is shipped in application code.
    await mockApi(failurePage, { "/api/v1/me": { ...me, account: { ...me.account, locale }, memberships: [] } });
    await failurePage.goto("/");
    await expect(failurePage.getByRole("heading", { name: locale === "nb" ? "Samvev kunne ikke vise siden" : "Samvev could not display this page" })).toBeVisible();
    await expect(failurePage.locator("html")).toHaveAttribute("lang", locale);
    await expect(failurePage.locator("body")).not.toContainText(/TypeError|household_id|componentStack|owner@cold-load.invalid/);
    await axe(failurePage);
    // Fix the mock before retry to verify recovery through an actual reload.
    await failurePage.unroute("**/api/v1/**");
    await mockApi(failurePage);
    await failurePage.getByRole("button", { name: locale === "nb" ? "Prøv på nytt" : "Try again", exact: true }).click();
    await expect(failurePage.getByRole("heading", { name: "Små beskjeder. En enklere hverdag." })).toBeVisible();
    expect(failureErrors.length).toBeGreaterThan(0);
    expect(failureErrors.every((error) => /Cannot read properties of undefined \(reading 'household_id'\)/.test(error))).toBe(true);
    await failureContext.close();
  }
  expect(unexpected).toEqual([]);
  console.log("PASS authenticated cold load/reload; expected startup GETs; one owner membership + nullable person fields; real JS/CSS MIME; People/AI/Tasks logo navigation and keyboard/modifiers without reload; nb/en render boundary + retry; desktop/mobile Axe; zero server writes or AI calls");
} finally {
  await browser.close();
}
