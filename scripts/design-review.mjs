// Capture only: the browser writes an ignored staging directory. The host
// wrapper re-verifies source/runtime/dist and publishes it after this exits.
import { chromium, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const baseURL = process.env.DESIGN_REVIEW_BASE_URL;
if (baseURL !== 'http://192.168.0.220:4173') throw new Error('DESIGN_REVIEW_BASE_URL must be the configured isolated QA LAN origin.');
const localRoot = resolve(root, '.local/design-review');
const stage = resolve(root, process.env.DESIGN_REVIEW_STAGE_PATH ?? '');
if (dirname(stage) !== localRoot || !/^capture-[a-zA-Z0-9_-]+$/.test(stage.slice(localRoot.length + 1))) throw new Error('Unexpected design-review staging path.');
const sourceSha = process.env.DESIGN_REVIEW_SOURCE_SHA;
const dirtyValue = process.env.DESIGN_REVIEW_WORKING_TREE_DIRTY;
if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('DESIGN_REVIEW_SOURCE_SHA must be a commit SHA from the host wrapper.');
if (!['true', 'false'].includes(dirtyValue ?? '')) throw new Error('DESIGN_REVIEW_WORKING_TREE_DIRTY must be true or false from the host wrapper.');
const workingTreeDirty = dirtyValue === 'true';
const proofFile = resolve(root, process.env.DESIGN_REVIEW_PROOF_PATH ?? '');
if (proofFile !== resolve(root, '.local/design-review/build-provenance.json')) throw new Error('Unexpected provenance path.');
const proof = JSON.parse(await readFile(proofFile, 'utf8'));
if (proof.sourceSha !== sourceSha || !proof.distHashes || typeof proof.inputFingerprint !== 'string' || typeof proof.runtimeFingerprint !== 'string') throw new Error('Capture provenance does not match canonical source and runtime.');
const now = new Date();
const timestamp = now.toISOString();
const roundId = `${timestamp.replace(/[-:.TZ]/g, '').slice(0, 14)}-${sourceSha.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
const views = [['desktop-1920', 1920, 1080], ['mobile', 390, 844], ['ipad-portrait', 820, 1180], ['ipad-landscape', 1180, 820], ['shelly-1280', 1280, 752]];
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
  const indexText = indexBody.toString('utf8');
  const entryAssets = new Set([...indexText.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]));
  expect(entryAssets.size, 'entry JS/CSS assets in index').toBeGreaterThan(0);
  const allAssets = new Set(Object.keys(proof.distHashes).filter(path => path.startsWith('assets/')).map(path => `/${path}`));
  expect(allAssets.size, 'built assets in provenance').toBeGreaterThan(0);
  for (const url of allAssets) {
    const response = await context.request.get(url, { maxRedirects: 0 });
    expect(response.ok(), `served ${url}`).toBeTruthy();
    expect(sha256(await response.body()), `served hash ${url}`).toBe(proof.distHashes[url.slice(1)]);
  }
  for (const entry of entryAssets) expect(allAssets, `entry asset exists in dist: ${entry}`).toContain(entry);
  return { allAssets, entryAssets };
}

async function assertFamilyHub(page, personIds, theme) {
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.family-hub')).toBeVisible();
  await expect(page.locator('.hub-hero')).toBeVisible();
  await expect(page.locator('.hub-today')).toBeVisible();
  await expect(page.locator('.hub-tomorrow')).toBeVisible();
  const renderedIds = await page.locator('[data-hub-detail-kind="person"][data-person-id]').evaluateAll(nodes => [...new Set(nodes.filter(node => node.checkVisibility()).map(node => node.getAttribute('data-person-id')).filter(Boolean))].sort());
  expect(renderedIds, 'visible semantic person controls must represent every actual Home person and no unknown identity').toEqual([...personIds].sort());
  await expect(page.locator('input[type="password"], .notice.error, [role="alert"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow').toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return renderedIds;
}

await mkdir(localRoot, { recursive: true });
if (existsSync(stage)) throw new Error('Design-review staging directory already exists.');
let browser;
let context;
let original;
let sessionActive = false;
let sessionCsrf;
let cleanupFailure;
let completed = false;
try {
  await mkdir(stage);
  browser = await chromium.launch();
  context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const blocked = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) { blocked.push(url.href); return route.abort(); }
    return route.continue();
  });
  const api = async (path, method = 'GET', data, headers = {}) => json(await context.request.fetch(`/api/v1${path}`, { method, data, headers, maxRedirects: 0 }));
  const served = await verifyServed(context);
  const setup = await api('/setup/status');
  expect(setup.demo, 'QA must be in synthetic demo mode').toBe(true);
  const login = await api('/auth/login', 'POST', { email: 'admin@demo.invalid', password: 'admin' });
  sessionActive = true;
  sessionCsrf = login.csrfToken;
  const me = await api('/me');
  original = { locale: me.account.locale, theme: me.account.theme, csrf: me.csrfToken };
  const householdId = me.memberships[0]?.household_id;
  expect(householdId, 'synthetic account membership').toBeTruthy();
  const home = await api(`/households/${householdId}/home`);
  expect(home.people.length, 'existing synthetic Home people').toBeGreaterThan(0);
  const personIds = home.people.map(person => person.id).sort();
  expect(new Set(personIds).size, 'unique Home person IDs').toBe(personIds.length);
  const verification = { personIds, personIdsHash: sha256(personIds.join('\n')), peopleCount: personIds.length, itemCount: home.items.length, itemIdsHash: sha256(home.items.map(item => item.id).sort().join('\n')) };
  const errors = [];
  await api('/me/preferences', 'PATCH', { locale: 'nb', theme: 'light' }, { 'X-CSRF-Token': original.csrf });
  const page = await context.newPage();
  const loadedAssets = new Set();
  const visibleImages = new Set();
  page.on('request', request => { const url = new URL(request.url()); if (url.origin === baseURL && url.pathname.startsWith('/assets/')) loadedAssets.add(url.pathname); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await assertFamilyHub(page, personIds, 'light');
  for (const theme of ['light', 'dark']) {
    await api('/me/preferences', 'PATCH', { locale: 'nb', theme }, { 'X-CSRF-Token': original.csrf });
    await page.reload();
    for (const [surface, width, height] of views) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => scrollTo(0, 0));
      const filename = `${surface}-${theme}.png`;
      const renderedPersonIds = await assertFamilyHub(page, personIds, theme);
      for (const path of await page.locator('img:visible').evaluateAll(images => images.map(image => new URL(image.currentSrc || image.src).pathname))) visibleImages.add(path);
      await page.screenshot({ path: resolve(stage, filename), fullPage: false });
      screenshots.push({ commitSha: sourceSha, capturedAt: new Date().toISOString(), viewport: { width, height }, theme, filename, surface: 'member-home', path: '/', locale: 'nb', fullPage: false, uiVerification: { ...verification, personIds: renderedPersonIds } });
    }
    for (const [surface, width, height] of [['mobile', 390, 844], ['desktop-1920', 1920, 1080]]) {
      const filename = `${surface}-${theme}-full.png`;
      await page.setViewportSize({ width, height });
      const renderedPersonIds = await assertFamilyHub(page, personIds, theme);
      for (const path of await page.locator('img:visible').evaluateAll(images => images.map(image => new URL(image.currentSrc || image.src).pathname))) visibleImages.add(path);
      await page.screenshot({ path: resolve(stage, filename), fullPage: true });
      screenshots.push({ commitSha: sourceSha, capturedAt: new Date().toISOString(), viewport: { width, height }, theme, filename, surface: 'member-home', path: '/', locale: 'nb', fullPage: true, uiVerification: { ...verification, personIds: renderedPersonIds } });
    }
  }
  const requiredLoadedAssets = new Set([...served.entryAssets, ...visibleImages]);
  for (const asset of requiredLoadedAssets) {
    expect(served.allAssets, `visible/entry asset exists in dist: ${asset}`).toContain(asset);
    expect(loadedAssets, `page loaded visible/entry asset: ${asset}`).toContain(asset);
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
  await writeFile(resolve(stage, 'manifest.json'), `${JSON.stringify({ roundId, commitSha: sourceSha, workingTreeDirty, capturedAt: timestamp, provenance: { sourceSha: proof.sourceSha, inputFingerprint: proof.inputFingerprint, rootSourceFingerprint: proof.rootSourceFingerprint, cloneSourceFingerprint: proof.cloneSourceFingerprint, runtimeFingerprint: proof.runtimeFingerprint, migrationFingerprint: proof.migrationFingerprint, inputFileHashes: proof.inputFileHashes, distHashes: proof.distHashes, builtAt: proof.builtAt, containerId: proof.containerId, nodeVersion: proof.nodeVersion, servedAssetsVerified: [...served.allAssets].sort(), loadedAssetsVerified: [...requiredLoadedAssets].sort() }, source: { origin: baseURL, account: 'admin@demo.invalid', uiAlias: 'admin', syntheticDemo: true }, screenshots }, null, 2)}\n`);
  completed = true;
  console.log(`Staged ${screenshots.length} verified screenshots for host publication (round ${roundId}).`);
} finally {
  if (sessionActive && context) {
    const failures = [];
    if (original) {
      try {
        const response = await context.request.fetch('/api/v1/me/preferences', { method: 'PATCH', data: { locale: original.locale, theme: original.theme }, headers: { 'X-CSRF-Token': original.csrf }, maxRedirects: 0 });
        if (!response.ok()) failures.push(`preference restoration returned HTTP ${response.status()}`);
      } catch (error) { failures.push(`preference restoration failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    }
    try {
      const response = await context.request.fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': sessionCsrf }, maxRedirects: 0 });
      if (!response.ok()) failures.push(`logout returned HTTP ${response.status()}`);
      else sessionActive = false;
    } catch (error) { failures.push(`logout failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    if (failures.length) cleanupFailure = new Error(`Design review cleanup failed: ${failures.join('; ')}`);
  }
  await context?.close();
  await browser?.close();
  if (!completed && existsSync(stage)) await rm(stage, { recursive: true, force: true });
  if (cleanupFailure) throw cleanupFailure;
}
