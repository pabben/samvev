// Explicit synthetic runtime smoke; does not reset an installation or persist cookies.
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
const baseURL = process.env.BASE_URL ?? "http://app:4173";
const out =
  process.env.SMOKE_ARTIFACT_DIR ??
  "docs/implementation/artifacts/frontend-final";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
  locale: "en-GB",
  reducedMotion: "reduce",
});
const displayContext = await browser.newContext({
  baseURL,
  viewport: { width: 1280, height: 752 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const screen = await displayContext.newPage();
let visualContext;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
screen.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const dynamicMasks = {};
const dynamicTextAssertions = {};
const record = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
const axeCheck = async (target, label) => {
  const report = await new AxeBuilder({ page: target })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    report.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.length,
    })),
    `${label} axe violations`,
  ).toEqual([]);
  record(`${label} passes axe WCAG 2 A/AA and 2.1 AA`);
};
const screenshot = async (p, name) => {
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: false });
};
const recordDynamicMasks = async (p, name) => {
  dynamicMasks[name] = await p.evaluate(() => {
    const rectsFor = (selector, timeOnly = false) =>
      [...document.querySelectorAll(selector)].flatMap((node) => {
        const range = document.createRange();
        if (timeOnly) {
          const text = [...node.childNodes].find(
            (child) =>
              child.nodeType === Node.TEXT_NODE && /\d/.test(child.textContent ?? ""),
          );
          if (!text) return [];
          const start = text.textContent.search(/\d/);
          range.setStart(text, start);
          range.setEnd(text, text.textContent.length);
        } else range.selectNodeContents(node);
        return [...range.getClientRects()].flatMap((box) => {
          if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight)
            return [];
          // Text Range geometry is fractional in Chromium. For the approved
          // Norwegian header clock at the two compact display widths, retain
          // its one right-edge antialias column without touching labels,
          // dates, icons, card text, or any other profile.
          const norwegianClockEdge =
            selector === ".display-date strong" &&
            document.documentElement.lang === "nb" &&
            [390, 1280].includes(innerWidth)
              ? 1
              : 0;
          return [{
            selector,
            text: range.toString(),
            x: Math.max(0, Math.floor(box.left)),
            y: Math.max(0, Math.floor(box.top)),
            width: Math.ceil(box.right) - Math.floor(box.left) + norwegianClockEdge,
            height: Math.ceil(box.bottom) - Math.floor(box.top),
          }];
        });
      });
    // These ranges begin at the first digit. Their icon and Until/Updated
    // label remain visible to visual comparison.
    return [
      ...rectsFor(".display-date strong"),
      ...rectsFor(".display-date span"),
      ...rectsFor(".display-card-top > span:last-child"),
      ...rectsFor(".display-until", true),
      ...rectsFor(".display-footer span:last-child", true),
    ];
  });
};
const osloFormat = (value, locale, options) =>
  new Intl.DateTimeFormat(locale, { timeZone: "Europe/Oslo", ...options }).format(
    new Date(value),
  );
const assertDynamicText = async (
  target,
  locale,
  name,
  displayId,
  source,
  fixedHeaderInstant,
) => {
  // Read the cache used by the rendered screen. A separate HTTP fetch could
  // advance generatedAt/serverNow at a minute boundary while the UI correctly
  // still shows its preceding projection or one-second clock tick.
  let rendered;
  await expect.poll(async () => {
    rendered = await target.evaluate(({ locale, displayId, fixedHeaderInstant }) => {
      const cache = JSON.parse(localStorage.getItem("samvev.display.projection.v1") ?? "null");
      if (!cache?.projection || cache.projection.display.id !== displayId)
        return null;
      const time = (value, options) =>
        new Intl.DateTimeFormat(locale, { timeZone: "Europe/Oslo", ...options }).format(new Date(value));
      const headerNow = fixedHeaderInstant ?? Date.parse(cache.projection.serverNow) + Math.max(0, Date.now() - cache.savedAt);
      return {
        projection: cache.projection,
        lastUpdated: cache.lastUpdated,
        header: {
          time: time(headerNow, { hour: "2-digit", minute: "2-digit" }),
          date: time(headerNow, { weekday: "long", day: "numeric", month: "long" }),
        },
      };
    }, { locale, displayId, fixedHeaderInstant });
    if (!rendered) return false;
    return (
      (await target.locator(".display-date strong").textContent()) === rendered.header.time &&
      (await target.locator(".display-date span").textContent()) === rendered.header.date
    );
  }, { timeout: 3000, intervals: [100, 200, 400] }).toBeTruthy();
  const projection = rendered.projection;
  const timeOptions = { hour: "2-digit", minute: "2-digit" };
  const headerTimeExpected = rendered.header.time;
  const headerDateExpected = rendered.header.date;
  const headerTimeActual = await target.locator(".display-date strong").textContent();
  const headerDateActual = await target.locator(".display-date span").textContent();
  expect(headerTimeActual).toBe(headerTimeExpected);
  expect(headerDateActual).toBe(headerDateExpected);
  const publishExpected = projection.cards.map((card) =>
    osloFormat(card.publishAt, locale, timeOptions),
  );
  const untilExpected = projection.cards.map(
    (card) =>
      `${locale === "nb" ? "Til" : "Until"} ${osloFormat(card.expiresAt, locale, timeOptions)}`,
  );
  const publishActual = await target
    .locator(".display-card-top > span:last-child")
    .allTextContents();
  const untilActual = await target.locator(".display-until").allTextContents();
  expect(publishActual).toEqual(publishExpected);
  expect(untilActual).toEqual(untilExpected);
  const footerActual = await target.locator(".display-footer span:last-child").textContent();
  const footerExpected = `${locale === "nb" ? "Oppdatert" : "Updated"} ${osloFormat(rendered.lastUpdated, locale, timeOptions)}`;
  expect(footerActual).toBe(footerExpected);
  dynamicTextAssertions[name] ??= {};
  dynamicTextAssertions[name][source] = {
    timezone: "Europe/Oslo",
    header: {
      time: { expected: headerTimeExpected, actual: headerTimeActual },
      date: { expected: headerDateExpected, actual: headerDateActual },
    },
    cards: projection.cards.map((card, index) => ({
      id: card.id,
      publish: { expected: publishExpected[index], actual: publishActual[index] },
      expiry: { expected: untilExpected[index], actual: untilActual[index] },
    })),
    footer: { expected: footerExpected, actual: footerActual },
  };
};
const password = "Synthetic-pilot-pass-42";
const displayName = "Kitchen · example";
const limitedName = "Robin · example";
const limitedEmail = "limited@pilot.invalid";
try {
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
  await page.goto("/");
  const noMotionContext = await browser.newContext({ baseURL, reducedMotion: "no-preference" });
  const noMotionPage = await noMotionContext.newPage();
  await noMotionPage.goto("/");
  const naturalMotion = await noMotionPage.locator(".button").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { transitionDuration: style.transitionDuration, animationName: style.animationName };
  });
  const reducedMotion = await page.locator(".button").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return { transitionDuration: style.transitionDuration, animationName: style.animationName };
  });
  expect(naturalMotion.transitionDuration).not.toBe("0s");
  expect(reducedMotion.transitionDuration).toBe("0s");
  expect(reducedMotion.animationName).toBe("none");
  await noMotionContext.close();
  record("reduced-motion media rule removes transition and animation from a real app button");
  const status = await (
    await context.request.get("/api/v1/setup/status")
  ).json();
  if (!status.claimed) {
    await expect(
      page.getByRole("button", { name: "Set up your household" }),
    ).toBeVisible();
    await screenshot(page, "welcome-en-light");
    await page.getByRole("button", { name: "Set up your household" }).click();
    await page
      .getByLabel("Your display name", { exact: true })
      .fill("Avery · example");
    await page
      .getByLabel("Household name", { exact: true })
      .fill("Example household");
    await page.getByLabel("Email", { exact: true }).fill("owner@pilot.invalid");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByLabel("Household time zone", { exact: true })
      .fill("Europe/Oslo");
    await screenshot(page, "onboarding-owner-en-light");
    await page
      .getByRole("button", { name: "Create household", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "A place for everyone." }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "A place for everyone." }),
    ).toBeVisible();
    record("first-run ownership and post-claim People-step refresh resume");
  } else {
    await page.getByLabel("Email", { exact: true }).fill("owner@pilot.invalid");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect
      .poll(async () => (await context.request.get("/api/v1/me")).ok())
      .toBeTruthy();
    const signedIn = await (await context.request.get("/api/v1/me")).json();
    const preferenceReset = await context.request.patch(
      "/api/v1/me/preferences",
      {
        data: { locale: "en", theme: "light" },
        headers: { "X-CSRF-Token": signedIn.csrfToken },
      },
    );
    expect(preferenceReset.ok()).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "People", exact: true }),
    ).toBeVisible();
  }
  const me = await (await context.request.get("/api/v1/me")).json();
  const household = me.memberships[0].household_id;
  const route = `/api/v1/households/${household}`;
  const mutate = async (path, data, method = "post") => {
    const response = await context.request[method](path, {
      data,
      headers: { "X-CSRF-Token": me.csrfToken },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.status() === 204 ? null : await response.json();
  };
  await page.getByRole("button", { name: "People", exact: true }).click();
  const existing = (await (await context.request.get(`${route}/people`)).json())
    .people;
  for (const person of [
    { name: "Morgan · example", role: "member", age: "adult" },
    {
      name: limitedName,
      role: "limited",
      age: "teen",
      email: limitedEmail,
    },
    { name: "Sky · example", role: "limited", age: "child" },
  ]) {
    if (existing.some((p) => p.display_name === person.name)) continue;
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Display name", { exact: true }).fill(person.name);
    await dialog.getByLabel("Age group (optional)").selectOption(person.age);
    await dialog.getByLabel("Starting permissions").selectOption(person.role);
    if (person.email) {
      for (const label of [
        "Write household messages",
        "Send to selected displays",
        "Schedule messages",
      ])
        await dialog.getByLabel(label, { exact: true }).check();
      await dialog.getByLabel("Give this person a sign-in").check();
      await dialog.getByLabel("Email", { exact: true }).fill(person.email);
      await dialog.getByLabel("Password", { exact: true }).fill(password);
    }
    await dialog
      .getByRole("button", { name: "Add person", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  }
  for (const name of ["Avery · example", "Morgan · example", limitedName, "Sky · example"])
    await expect(page.locator(".person-card").filter({
      has: page.getByRole("heading", { name, exact: true }),
    })).toHaveCount(1);
  if (!status.claimed) await expect(page.locator(".person-card")).toHaveCount(4);
  else expect(await page.locator(".person-card").count()).toBeGreaterThanOrEqual(4);
  await axeCheck(page, "people screen");
  await screenshot(page, "onboarding-people-en-light");
  record(
    "adult plus two limited profiles, optional limited sign-in, explicit capability presets",
  );
  if (await page.getByRole("button", { name: "Continue", exact: true }).count())
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  else
    await page.getByRole("button", { name: "Displays", exact: true }).click();
  await screen.goto("/display");
  const pairingStartResponse = screen.waitForResponse(response =>
    response.request().method() === "POST" && response.url().endsWith("/display/pairing/start"));
  await screen
    .getByRole("button", { name: "Get a pairing code", exact: true })
    .click();
  const pairingStarted = await pairingStartResponse;
  if (pairingStarted.status() !== 201) await writeFile(`${out}/pairing-start-failure.json`, JSON.stringify({
    executedAt: new Date().toISOString(), baseURL, status: pairingStarted.status(),
    retryAfter: pairingStarted.headers()["retry-after"] ?? null,
    code: (await pairingStarted.json()).error?.code,
  }, null, 2));
  expect(pairingStarted.status(), "pairing start; respect any429 rate-limit window").toBe(201);
  const code = await screen.getByTestId("pairing-code").textContent();
  await screenshot(screen, "pairing-code-en-light");
  await page
    .getByRole("button", { name: "Pair a display", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Six-digit code").fill(code);
  await dialog
    .getByLabel("Display name", { exact: true })
    .fill(displayName);
  await dialog.getByLabel("Display appearance").selectOption("light");
  const approvalResponse = page.waitForResponse(response =>
    response.request().method() === "POST" && response.url().endsWith("/displays/pairing/approve"));
  await dialog.getByRole("button", { name: "Approve this display" }).click();
  const pairedDisplayId = (await (await approvalResponse).json()).displayId;
  await expect(dialog).not.toBeVisible();
  await expect(screen.locator(".display-identity strong")).toHaveText(
    displayName,
    { timeout: 15000 },
  );
  record(
    "browser-bound display-generated code approval and restricted cookie redemption",
  );
  await axeCheck(screen, "paired restricted display");
  const ds = (await (await context.request.get(`${route}/displays`)).json())
    .displays;
  const display = ds.find(display => display.id === pairedDisplayId);
  expect(display, "the specific display approved by this browser flow").toBeTruthy();
  if (
    await page
      .getByRole("button", { name: "Open your message board", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Open your message board", exact: true })
      .click();
  await page.getByRole("button", { name: "People", exact: true }).click();
  const robin = page.locator(".person-card").filter({
    has: page.getByRole("heading", { name: limitedName, exact: true }),
  });
  await robin.getByRole("button", { name: "Edit permissions" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(displayName, { exact: true }).last().check();
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  record("limited member gets explicit approved-display grant through UI");
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  for (const [body, attention] of [
    [
      "Remember the gym bag tomorrow. A little preparation makes the morning easier.",
      true,
    ],
    [
      "A little note for everyone: let’s make time for a slow breakfast together.",
      false,
    ],
  ]) {
    await page
      .getByRole("button", { name: "New message", exact: true })
      .first()
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your message", { exact: true }).fill(body);
    if (attention) await dialog.getByLabel("Highlight as a reminder").check();
    await dialog
      .getByLabel(displayName, { exact: true })
      .last()
      .check();
    if (attention) {
      await axeCheck(page, "message composer");
      await screenshot(page, "composer-preview-en-light");
    }
    await dialog
      .getByRole("button", { name: "Publish message", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(screen.getByText(body, { exact: true })).toBeVisible({
      timeout: 15000,
    });
  }
  record(
    "real immediate publication appears live without manual display refresh",
  );
  await expect
    .poll(
      async () => {
        const m = (
          await (await context.request.get(`${route}/messages`)).json()
        ).messages;
        return m.some((m) =>
          m.deliveries.some(
            (d) => d.displayId === display.id && d.state === "displayed",
          ),
        );
      },
      { timeout: 15000 },
    )
    .toBeTruthy();
  record(
    "after-paint device render acknowledgement changes real delivery to displayed",
  );
  const limitedContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const limited = await limitedContext.newPage();
  limited.on("pageerror", (e) => errors.push(e.message));
  await limited.goto("/");
  await limited
    .getByLabel("Email", { exact: true })
    .fill(limitedEmail);
  await limited.getByLabel("Password", { exact: true }).fill(password);
  await limited.getByRole("button", { name: "Sign in", exact: true }).click();
  await limited
    .getByRole("button", { name: "New message", exact: true })
    .first()
    .click();
  dialog = limited.getByRole("dialog");
  await dialog
    .getByLabel("Your message", { exact: true })
    .fill("Remember gym clothes tomorrow");
  await dialog.getByLabel(displayName, { exact: true }).last().check();
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Tomorrow at 07:00", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Schedule message", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await limited.getByRole("tab", { name: /Planned/ }).click();
  let card = limited
    .locator(".message-card")
    .filter({ hasText: "Remember gym clothes tomorrow" });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  dialog = limited.getByRole("dialog");
  await dialog
    .getByLabel("Your message", { exact: true })
    .fill("Remember gym clothes and a water bottle tomorrow");
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  card = limited
    .locator(".message-card")
    .filter({ hasText: "Remember gym clothes and a water bottle tomorrow" });
  await expect(card).toBeVisible();
  await screenshot(limited, "limited-scheduled-mobile-en-light");
  await card.getByRole("button", { name: "Withdraw", exact: true }).click();
  await limited
    .getByRole("dialog")
    .getByRole("button", { name: "Withdraw message" })
    .click();
  await expect(
    limited
      .locator(".message-card")
      .filter({ hasText: "Remember gym clothes and a water bottle tomorrow" }),
  ).toHaveCount(0);
  await limited.getByRole("tab", { name: /History/ }).click();
  await expect(
    limited
      .locator(".message-card")
      .filter({ hasText: "Remember gym clothes and a water bottle tomorrow" })
      .first(),
  ).toBeVisible();
  record(
    "limited sign-in, tomorrow 07:00 scheduling, optimistic edit and withdrawal via mobile UI",
  );
  const limitedMe = await (
    await limitedContext.request.get("/api/v1/me")
  ).json();
  const accelerated = "A real scheduled reminder · synthetic timing check";
  const response = await limitedContext.request.post(`${route}/messages`, {
    headers: { "X-CSRF-Token": limitedMe.csrfToken },
    data: {
      body: accelerated,
      importance: "normal",
      audience: { household: false, personIds: [], displayIds: [display.id] },
      publishAt: new Date(Date.now() + 12000).toISOString(),
      expiresAt: new Date(Date.now() + 32000).toISOString(),
      idempotencyKey: `frontend-smoke-${Date.now()}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(screen.getByText(accelerated, { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(screen.getByText(accelerated, { exact: true })).not.toBeVisible({
    timeout: 30000,
  });
  record(
    "real worker automatically publishes and expires accelerated limited-member schedule",
  );
  // Visual snapshots use a separate page with only Date.now()/new Date()
  // fixed to the approved candidate's header instant. Its timers,
  // performance clock, network, display credential, SSE and server-side
  // scheduler remain real. The live screen above continues to assert the
  // real current header, cards and footer before every capture.
  visualContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 752 },
    reducedMotion: "reduce",
  });
  await visualContext.addCookies(await displayContext.cookies());
  await visualContext.addInitScript((instant) => {
    const RealDate = Date;
    class VisualDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [instant]));
      }
      static now() {
        return instant;
      }
    }
    window.Date = VisualDate;
  }, Date.parse("2026-09-07T02:45:00.000Z"));
  const visual = await visualContext.newPage();
  visual.on("pageerror", (e) => errors.push(e.message));
  // Keep one visual page alive through the whole matrix, matching the
  // approved capture lifecycle. Locale/theme updates below arrive through
  // the real display SSE stream; no per-profile navigation changes raster
  // state or substitutes a projection.
  await visual.goto("/display");
  await expect(visual.locator(".display-identity strong")).toHaveText(displayName, {
    timeout: 15000,
  });
  for (const [profile, viewport] of [
    ["mobile", { width: 390, height: 844 }],
    ["shared", { width: 1920, height: 1080 }],
    ["shelly-xl", { width: 1280, height: 752 }],
  ]) {
    await screen.setViewportSize(viewport);
    for (const locale of ["en", "nb"])
      for (const theme of ["light", "dark"]) {
        await mutate(
          `${route}/displays/${display.id}`,
          { locale, theme },
          "patch",
        );
        await expect(screen.locator("html")).toHaveAttribute("lang", locale, {
          timeout: 10000,
        });
        await expect(screen.locator("html")).toHaveAttribute(
          "data-theme",
          theme,
          { timeout: 10000 },
        );
        await expect(screen.locator(".display-identity strong")).toHaveText(
          displayName,
        );
        await expect(screen.locator(".display-card")).toHaveCount(2);
        await expect(screen.locator(".display-card-body")).toHaveText([
          "Remember the gym bag tomorrow. A little preparation makes the morning easier.",
          "A little note for everyone: let’s make time for a slow breakfast together.",
        ]);
        await expect(screen.locator(".display-page")).toHaveAttribute(
          "data-timezone",
          "Europe/Oslo",
        );
        await expect(screen.locator(".connection-pill")).toHaveText(
          locale === "nb" ? "Direkteoppdateringer" : "Live updates",
        );
        await expect(
          screen.getByText(/Times shown in UTC|Tidspunkter vises i UTC/),
        ).toHaveCount(0);
        expect(
          await screen.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await assertDynamicText(
          screen,
          locale,
          `display-${profile}-${locale}-${theme}`,
          display.id,
          "live",
        );
        await visual.setViewportSize(viewport);
        await expect(visual.locator("html")).toHaveAttribute("lang", locale, {
          timeout: 10000,
        });
        await expect(visual.locator("html")).toHaveAttribute("data-theme", theme, {
          timeout: 10000,
        });
        await expect(visual.locator(".display-identity strong")).toHaveText(displayName);
        await expect(visual.locator(".display-card")).toHaveCount(2);
        await expect(visual.locator(".display-card-body")).toHaveText([
          "Remember the gym bag tomorrow. A little preparation makes the morning easier.",
          "A little note for everyone: let’s make time for a slow breakfast together.",
        ]);
        await expect(visual.locator(".display-page")).toHaveAttribute("data-timezone", "Europe/Oslo");
        await expect(visual.locator(".connection-pill")).toHaveText(
          locale === "nb" ? "Direkteoppdateringer" : "Live updates",
        );
        const visualHeader = await visual.evaluate((locale) => ({
          time: new Intl.DateTimeFormat(locale, { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" }).format(new Date("2026-09-07T02:45:00.000Z")),
          date: new Intl.DateTimeFormat(locale, { timeZone: "Europe/Oslo", weekday: "long", day: "numeric", month: "long" }).format(new Date("2026-09-07T02:45:00.000Z")),
        }), locale);
        await expect(visual.locator(".display-date strong")).toHaveText(visualHeader.time);
        await expect(visual.locator(".display-date span")).toHaveText(visualHeader.date);
        expect(
          await visual.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBeTruthy();
        await assertDynamicText(
          visual,
          locale,
          `display-${profile}-${locale}-${theme}`,
          display.id,
          "fixed_visual",
          Date.parse("2026-09-07T02:45:00.000Z"),
        );
        await screenshot(visual, `display-${profile}-${locale}-${theme}`);
        await recordDynamicMasks(visual, `display-${profile}-${locale}-${theme}`);
      }
  }
  record(
    "12 real paired-display viewport/theme/locale screenshots with no horizontal overflow",
  );
  await visualContext.close();
  visualContext = undefined;
  await screen.setViewportSize({ width: 1280, height: 752 });
  await mutate(
    `${route}/displays/${display.id}`,
    { locale: "en", theme: "light" },
    "patch",
  );
  await expect(screen.locator("html")).toHaveAttribute("lang", "en", {
    timeout: 10000,
  });
  await displayContext.setOffline(true);
  await expect(
    screen
      .getByText("Offline · showing saved messages", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(screen.locator(".display-card")).toHaveCount(2);
  await screenshot(screen, "display-offline-shelly-en-light");
  await displayContext.setOffline(false);
  await expect(screen.getByText("Live updates", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  record(
    "offline saved projection is visibly stale; reconnection restores live status",
  );
  // User preferences persist through a browser reload; no synthetic local-only UI switch.
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Your preferences", exact: true })
    .last()
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Language", { exact: true })
    .selectOption("nb");
  await expect(page.getByTestId("preference-save-status")).toHaveText(
    "Innstillingene er lagret",
  );
  await page
    .getByRole("dialog")
    .getByLabel("Utseende", { exact: true })
    .selectOption("dark");
  await expect(page.getByTestId("preference-save-status")).toHaveText(
    "Innstillingene er lagret",
  );
  await expect(
    page.getByRole("dialog").getByLabel("Utseende", { exact: true }),
  ).toHaveValue("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await axeCheck(page, "member mobile nb dark");
  await screenshot(page, "member-mobile-nb-dark");
  record("member language and appearance persist through reload");
  expect(errors).toEqual([]);
  record("no uncaught browser page errors");
  await writeFile(
    `${out}/smoke-results.json`,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        baseURL,
        pairedDisplayId: display.id,
        checks,
        screenshots:
          "display-{mobile,shared,shelly-xl}-{en,nb}-{light,dark}.png",
        dynamicMasks,
        dynamicTextAssertions,
        visualClock: {
          instant: "2026-09-07T02:45:00.000Z",
          scope: "Separate screenshot page only; Date is fixed while timers, performance, API, SSE and worker remain real.",
        },
        notes: [
          "Synthetic fixtures only. Runtime was not reset.",
          "This report covers smoke only; complete acceptance also requires focused, UX, restart, and visual comparison reports.",
          "Screenshots at Shelly dimensions are not physical hardware certification.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await limitedContext.close();
} catch (error) {
  await screenshot(page, "failure-member");
  await screenshot(screen, "failure-display");
  throw error;
} finally {
  await visualContext?.close();
  await browser.close();
}
