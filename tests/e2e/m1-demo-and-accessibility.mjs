import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://qa-app:4173";
const out = "docs/implementation/artifacts/qa";
await mkdir(out, { recursive: true });
const checks = [];
const axeViolations = [];
const pass = (label) => { checks.push(label); console.log(`PASS ${label}`); };
const browser = await chromium.launch({ headless: true });
async function accessibilityCheck(page, surface) {
  const unnamed = await page.locator("button, a, input, textarea, select").evaluateAll((controls) => controls.filter((element) => {
    const name = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || element.labels?.length || element.textContent?.trim();
    const box = element.getBoundingClientRect();
    // Responsive navigation may deliberately render an alternate hidden control;
    // only elements participating in the visual/focus surface are audited here.
    if (box.width <= 0 || box.height <= 0) return false;
    return !name;
  }).map((element) => element.outerHTML));
  expect(unnamed, `${surface} unnamed or hidden interactive controls`).toEqual([]);
  const contrast = await page.locator("h1, h2, p, button, input, textarea, select").evaluateAll((elements) => {
    const rgb = (value) => (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const linear = (value) => { value /= 255; return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; };
    const luminance = (value) => .2126 * linear(value[0]) + .7152 * linear(value[1]) + .0722 * linear(value[2]);
    return elements.filter((element) => {
      if (!element.textContent?.trim() && !(element instanceof HTMLInputElement)) return false;
      let background = element; let style = getComputedStyle(background);
      while (style.backgroundColor === "rgba(0, 0, 0, 0)" && background.parentElement) { background = background.parentElement; style = getComputedStyle(background); }
      const foreground = rgb(getComputedStyle(element).color); const backdrop = rgb(style.backgroundColor);
      if (foreground.length !== 3 || backdrop.length !== 3) return false;
      const ratio = (Math.max(luminance(foreground), luminance(backdrop)) + .05) / (Math.min(luminance(foreground), luminance(backdrop)) + .05);
      return ratio < 3;
    }).map((element) => ({ text: element.textContent?.trim(), color: getComputedStyle(element).color }));
  });
  expect(contrast, `${surface} visible text contrast below 3:1`).toEqual([]);
}
async function axeCheck(page, surface) {
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  axeViolations.push(...report.violations.map(({ id, impact, help, nodes }) => ({
    surface, id, impact, help,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  })));
}
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: "reduce", colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect.poll(async () => {
    try { return (await context.request.get("/api/v1/health")).ok(); } catch { return false; }
  }, { timeout: 60_000 }).toBeTruthy();
  await page.goto("/");
  if (process.env.QA_EXISTING_DEMO === "true") {
    await page.getByLabel("Email", { exact: true }).fill("admin@demo.invalid");
    await page.getByLabel("Password", { exact: true }).fill("Synthetic-demo-pass-42");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  } else {
  await expect(page.getByRole("button", { name: "Explore a synthetic demo", exact: true })).toBeVisible();
    await accessibilityCheck(page, "fresh setup welcome");
    await axeCheck(page, "fresh setup welcome");
    await page.getByRole("button", { name: "Explore a synthetic demo", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Messages", exact: true })).toBeVisible();
  await page.screenshot({ path: `${out}/fresh-demo-member-en-light.png`, fullPage: false, animations: "disabled", caret: "hide" });
  if (process.env.QA_EXISTING_DEMO !== "true") pass("explicit fresh-install demo action creates and opens labelled synthetic household data");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await accessibilityCheck(page, "member message board");
  await axeCheck(page, "member message board");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await page.getByRole("button", { name: "New message", exact: true }).first().click();
  await accessibilityCheck(page.getByRole("dialog"), "message composer");
  await axeCheck(page, "message composer");
  await page.keyboard.press("Escape");
  const display = await context.newPage();
  await display.goto("/display");
  await expect(display.getByRole("button", { name: "Get a pairing code", exact: true })).toBeVisible();
  await accessibilityCheck(display, "restricted display pairing");
  await axeCheck(display, "restricted display pairing");
  pass("setup, member board, message composer and restricted display pairing have named controls, visible landmarks and sampled 3:1 text contrast");
  expect(errors).toEqual([]);
  expect(axeViolations, "aggregate axe WCAG 2 A/AA and 2.1 AA violations").toEqual([]);
  await display.close();
  await context.close();
  await writeFile(`${out}/demo-accessibility-visual.json`, JSON.stringify({ executedAt: new Date().toISOString(), baseURL, checks, axeViolations }, null, 2) + "\n");
} catch (error) {
  await writeFile(`${out}/demo-accessibility-visual.json`, JSON.stringify({ executedAt: new Date().toISOString(), baseURL, checks, axeViolations, error: String(error?.stack ?? error) }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
