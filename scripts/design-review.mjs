// Captures an already-populated synthetic QA account. It intentionally creates
// no fixture, display, integration, connection, or content records.
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishRound } from './design-review-publication.mjs';

const root = process.cwd();
const baseURL = process.env.DESIGN_REVIEW_BASE_URL;
if (!['http://qa-app:4173', 'http://192.168.0.220:4173'].includes(baseURL ?? '')) throw new Error('DESIGN_REVIEW_BASE_URL must be the configured isolated QA origin.');
const reviewRoot = resolve(root, 'docs/design/review');
const latest = resolve(reviewRoot, 'latest');
const archive = resolve(reviewRoot, 'archive');
const localRoot = resolve(root, '.local/design-review');
const sourceSha = process.env.DESIGN_REVIEW_SOURCE_SHA;
const dirtyValue = process.env.DESIGN_REVIEW_WORKING_TREE_DIRTY;
if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('DESIGN_REVIEW_SOURCE_SHA must be a commit SHA from the host wrapper.');
if (!['true', 'false'].includes(dirtyValue ?? '')) throw new Error('DESIGN_REVIEW_WORKING_TREE_DIRTY must be true or false from the host wrapper.');
const workingTreeDirty = dirtyValue === 'true';
const proofFile = resolve(root, process.env.DESIGN_REVIEW_PROOF_PATH ?? '');
if (proofFile !== resolve(root, '.local/design-review/build-provenance.json')) throw new Error('Unexpected provenance path.');
const proof = JSON.parse(await readFile(proofFile, 'utf8'));
if (proof.sourceSha !== sourceSha || !proof.distHashes || typeof proof.inputFingerprint !== 'string') throw new Error('Capture provenance does not match canonical source.');
const now = new Date();
const timestamp = now.toISOString();
const roundId = `${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${sourceSha.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
const stage = resolve(localRoot, `${roundId}-${process.pid}`);
const lock = resolve(localRoot, '.lock');
const views = [
  ['desktop-1920', 1920, 1080], ['mobile', 390, 844], ['ipad-portrait', 820, 1180],
  ['ipad-landscape', 1180, 820], ['shelly-1280', 1280, 752]
];
const screenshots = [];

const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = async response => {
  expect(response.ok(), `API response ${response.status()} from ${response.url()}`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
};
async function verifyServed(context) {
  const index = await context.request.get('/', { maxRedirects: 0 });
  expect(index.ok(), 'served index').toBeTruthy();
  const indexBody = await index.body();
  expect(sha256(indexBody), 'served index hash').toBe(proof.distHashes['index.html']);
  const urls = [...indexBody.toString('utf8').matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
  expect(urls.length, 'served index assets').toBeGreaterThan(0);
  for (const url of urls) {
    const response = await context.request.get(url, { maxRedirects: 0 });
    expect(response.ok(), `served ${url}`).toBeTruthy();
    expect(sha256(await response.body()), `served hash ${url}`).toBe(proof.distHashes[url.slice(1)]);
  }
  return new Set(urls);
}

async function assertFamilyHub(page, verification, title, theme) {
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.family-hub')).toBeVisible();
  await expect(page.locator('.hub-hero')).toBeVisible();
  await expect(page.locator('.hub-person')).toHaveCount(verification.peopleCount);
  await expect(page.locator('.hub-item-title, .hub-item h3').filter({ hasText: title }).first()).toBeVisible();
  await expect(page.locator('input[type="password"], .notice.error, [role="alert"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow').toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

await mkdir(localRoot, { recursive: true });
try { await mkdir(lock); } catch { throw new Error('A design-review capture is already running.'); }
let browser;
let context;
let original;
let sessionActive = false;
let sessionCsrf;
let cleanupFailure;
try {
  await mkdir(stage, { recursive: true });
  browser = await chromium.launch();
  context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const blocked = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) { blocked.push(url.href); return route.abort(); }
    return route.continue();
  });
  const api = async (path, method = 'GET', data, headers = {}) => json(await context.request.fetch(`/api/v1${path}`, { method, data, headers, maxRedirects: 0 }));
  const expectedAssets = await verifyServed(context);
  const setup = await api('/setup/status');
  expect(setup.demo, 'QA must be in synthetic demo mode').toBe(true);
  const login = await api('/auth/login', 'POST', { email: 'admin@demo.invalid', password: 'Synthetic-demo-pass-42' });
  sessionActive = true;
  sessionCsrf = login.csrfToken;
  const me = await api('/me');
  original = { locale: me.account.locale, theme: me.account.theme, csrf: me.csrfToken };
  const householdId = me.memberships[0]?.household_id;
  expect(householdId, 'synthetic account membership').toBeTruthy();
  const home = await api(`/households/${householdId}/home`);
  expect(home.people.length, 'existing synthetic Home people').toBeGreaterThan(0);
  expect(home.items.length, 'existing synthetic Home items').toBeGreaterThan(0);
  const proofTitle = home.items[0].title;
  const verification = { peopleCount: home.people.length, itemCount: home.items.length, itemTitlesHash: sha256(home.items.map(item => item.title).join('\n')) };
  const errors = [];
  await api('/me/preferences', 'PATCH', { locale: 'nb', theme: 'light' }, { 'X-CSRF-Token': original.csrf });
  const page = await context.newPage();
  const loadedAssets = new Set();
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === baseURL && url.pathname.startsWith('/assets/')) loadedAssets.add(url.pathname); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await assertFamilyHub(page, verification, proofTitle, 'light');
  for (const asset of expectedAssets) expect(loadedAssets, `page loaded ${asset}`).toContain(asset);
  for (const theme of ['light', 'dark']) {
    await api('/me/preferences', 'PATCH', { locale: 'nb', theme }, { 'X-CSRF-Token': original.csrf });
    await page.reload();
    for (const [surface, width, height] of views) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      const filename = `${surface}-${theme}.png`;
      await assertFamilyHub(page, verification, proofTitle, theme);
      await page.screenshot({ path: resolve(stage, filename), fullPage: false });
      screenshots.push({ commitSha: sourceSha, capturedAt: new Date().toISOString(), viewport: { width, height }, theme, filename, surface: 'member-home', path: '/', locale: 'nb', fullPage: false, uiVerification: verification });
    }
    for (const [surface, width, height] of [['mobile', 390, 844], ['desktop-1920', 1920, 1080]]) {
      const filename = `${surface}-${theme}-full.png`;
      await page.setViewportSize({ width, height });
      await assertFamilyHub(page, verification, proofTitle, theme);
      await page.screenshot({ path: resolve(stage, filename), fullPage: true });
      screenshots.push({ commitSha: sourceSha, capturedAt: new Date().toISOString(), viewport: { width, height }, theme, filename, surface: 'member-home', path: '/', locale: 'nb', fullPage: true, uiVerification: verification });
    }
  }
  expect(errors, `browser page errors: ${errors.join('; ')}`).toEqual([]);
  expect(blocked, `external browser requests: ${blocked.join('; ')}`).toEqual([]);
  await verifyServed(context);
  for (const image of screenshots) image.sha256 = sha256(await readFile(resolve(stage, image.filename)));
  await api('/me/preferences', 'PATCH', { locale: original.locale, theme: original.theme }, { 'X-CSRF-Token': original.csrf });
  const restored = await api('/me');
  expect(restored.account.locale, 'locale restoration').toBe(original.locale);
  expect(restored.account.theme, 'theme restoration').toBe(original.theme);
  await api('/auth/logout', 'POST', undefined, { 'X-CSRF-Token': sessionCsrf });
  sessionActive = false;
  original = undefined;
  await writeFile(resolve(stage, 'manifest.json'), `${JSON.stringify({ roundId, commitSha: sourceSha, workingTreeDirty, capturedAt: timestamp, provenance: { sourceSha: proof.sourceSha, inputFingerprint: proof.inputFingerprint, inputFileHashes: proof.inputFileHashes, distHashes: proof.distHashes, builtAt: proof.builtAt, containerId: proof.containerId, nodeVersion: proof.nodeVersion, servedAssetsVerified: [...expectedAssets] }, source: { origin: baseURL, account: 'admin@demo.invalid', syntheticDemo: true }, screenshots }, null, 2)}\n`);
  await mkdir(archive, { recursive: true });
  await publishRound({ stage, latest, archive });
  console.log(`Published ${screenshots.length} verified screenshots to docs/design/review/latest (round ${roundId}).`);
} finally {
  if (sessionActive && context) {
    const cleanupFailures = [];
    if (original) {
      try {
        const response = await context.request.fetch('/api/v1/me/preferences', { method: 'PATCH', data: { locale: original.locale, theme: original.theme }, headers: { 'X-CSRF-Token': original.csrf }, maxRedirects: 0 });
        if (!response.ok()) cleanupFailures.push(`preference restoration returned HTTP ${response.status()}`);
      } catch (error) { cleanupFailures.push(`preference restoration failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    try {
      const response = await context.request.fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': sessionCsrf }, maxRedirects: 0 });
      if (!response.ok()) cleanupFailures.push(`logout returned HTTP ${response.status()}`);
      else sessionActive = false;
    } catch (error) { cleanupFailures.push(`logout failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    if (cleanupFailures.length) cleanupFailure = new Error(`Design review cleanup failed: ${cleanupFailures.join('; ')}`);
  }
  await context?.close();
  await browser?.close();
  if (existsSync(stage)) await rm(stage, { recursive: true, force: true });
  await rm(lock, { recursive: true, force: true });
  if (cleanupFailure) throw cleanupFailure;
}
