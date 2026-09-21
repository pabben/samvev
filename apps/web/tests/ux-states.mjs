// Synthetic UX evidence. Only the explicitly named loading/error/account-status
// cases inject network responses; pairing, permissions and lifecycle use the API.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const baseURL = process.env.BASE_URL ?? 'http://samvev-m1-app-1:4173';
const out = process.env.UX_ARTIFACT_DIR ?? 'docs/implementation/artifacts/frontend-final/ux';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const dc = await browser.newContext({ baseURL, viewport: { width: 1280, height: 752 }, reducedMotion: 'reduce' });
const lc = await browser.newContext({ baseURL });
const page = await context.newPage();
const screen = await dc.newPage();
const checks = [], screenshots = [], messageIds = [], displayIds = [];
const record = (label) => { checks.push(label); console.log(`PASS ${label}`); };
const shot = async (p, name, evidence, fullPage = false) => {
  await p.screenshot({ path: `${out}/${name}.png`, fullPage });
  screenshots.push({ file: `${name}.png`, viewport: p.viewportSize(), evidence, fullPage });
};
const login = async (ctx, email) => {
  expect((await ctx.request.post('/api/v1/auth/login', { data: { email, password: 'Synthetic-pilot-pass-42' } })).ok()).toBeTruthy();
  return (await ctx.request.get('/api/v1/me')).json();
};
await expect.poll(async () => {
  try { return (await context.request.get('/api/v1/health')).ok(); }
  catch { return false; }
}, { timeout: 60000 }).toBeTruthy();
const me = await login(context, 'owner@pilot.invalid');
const limited = await login(lc, 'limited@pilot.invalid');
const base = `/api/v1/households/${me.memberships[0].household_id}`;
const mutate = async (path, data, method = 'post', ctx = context, auth = me) => {
  const r = await ctx.request[method](path, { headers: { 'X-CSRF-Token': auth.csrfToken }, data });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.status() === 204 ? null : r.json();
};
const people = async () => (await (await context.request.get(`${base}/people`)).json()).people;
const displays = async () => (await (await context.request.get(`${base}/displays`)).json()).displays;
const robinNow = async () => (await people()).find(p => p.display_name === 'Robin · example');
const prefs = async (locale, theme = 'light') => mutate('/api/v1/me/preferences', { locale, theme }, 'patch');
const openPeople = async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.locator('.person-card')).toHaveCount((await people()).length);
};
const editRobin = async () => {
  await page.locator('.person-card').filter({ has: page.getByRole('heading', { name: 'Robin · example', exact: true }) }).getByRole('button', { name: 'Edit permissions' }).click();
  return page.getByRole('dialog');
};
const pair = async (p, name) => {
  await p.goto('/display');
  const startResponse = p.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/display/pairing/start'));
  await p.getByRole('button', { name: 'Get a pairing code', exact: true }).click();
  const started = await startResponse;
  expect(started.status(), 'real pairing start must succeed; respect any429 rate-limit window').toBe(201);
  const code = await p.getByTestId('pairing-code').textContent();
  const result = await mutate(`${base}/displays/pairing/approve`, { code, name, locale: 'en', theme: 'light', privacyMode: false, allowedContent: 'household_messages' });
  displayIds.push(result.displayId);
  await expect(p.locator('.display-identity strong')).toHaveText(name, { timeout: 15000 });
  return result.displayId;
};
const createMessage = async (body, displayId, ctx = context, auth = me) => {
  const result = await mutate(`${base}/messages`, { body, importance: 'normal', audience: { household: false, personIds: [], displayIds: [displayId] }, expiresAt: new Date(Date.now() + 3600000).toISOString(), idempotencyKey: crypto.randomUUID() }, 'post', ctx, auth);
  messageIds.push(result.id);
  return result;
};
const noOverflow = async (p) => expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
let originalPrefs = { locale: me.account.locale, theme: me.account.theme };
let temporaryGrant = false;
let completed = false;
try {
  await prefs('en');
  if (process.env.UX_PHASE !== 'components') {
  // A repeatable fixture for fresh QA: grant our own screen, revoke it, then
  // exercise the same editor save. Existing stale grants are tested untouched.
  const historicalPerson = await robinNow();
  const activeAtStart = (await displays()).filter(d => !d.revoked_at).map(d => d.id);
  if (historicalPerson.display_ids.every(id => activeAtStart.includes(id))) {
    const hc = await browser.newContext({ baseURL });
    const hp = await hc.newPage();
    const hid = await pair(hp, 'Historical grant · example');
    await mutate(`${base}/memberships/${historicalPerson.membership_id}`, { rolePreset: historicalPerson.role_preset, capabilities: historicalPerson.capabilities, displayIds: [...historicalPerson.display_ids, hid], expectedRevision: historicalPerson.revision }, 'patch');
    temporaryGrant = true;
    await mutate(`${base}/displays/${hid}`, { revoked: true }, 'patch');
    await hc.close();
  }
  // F8: exercise real historical revoked grants before any fixture grant mutation.
  const before = await robinNow();
  const offered = (await displays()).filter(d => !d.revoked_at).map(d => d.id);
  const initialValid = before.display_ids.filter(id => offered.includes(id));
  await openPeople();
  let dialog = await editRobin();
  const patchRequest = page.waitForRequest(r => r.method() === 'PATCH' && r.url().endsWith(`/memberships/${before.membership_id}`));
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await patchRequest).postDataJSON().displayIds.sort()).toEqual([...initialValid].sort());
  await expect(dialog).not.toBeVisible();
  expect((await robinNow()).display_ids.sort()).toEqual([...initialValid].sort());
  record(`F8 real permissions save preserves ${initialValid.length} active grants and excludes ${before.display_ids.length - initialValid.length} historical unavailable grants`);
  await shot(page, 'people-valid-grants-en', 'Real membership save after historical grant sanitization');

  // Test-only response variants: ordinary callers may receive no active-status field.
  const sourcePeople = (await people()).slice(0, 4);
  for (const locale of ['en', 'nb']) {
    await prefs(locale);
    await page.route(`**${base}/people`, async route => {
      const states = [{ has_login: true, has_active_login: true }, { has_login: true, has_active_login: false }, { has_login: false }, { has_login: true }];
      const fixture = sourcePeople.map((p, i) => { const copy = { ...p, ...states[i] }; if (i > 1) delete copy.has_active_login; return copy; });
      await route.fulfill({ json: { people: fixture } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: locale === 'en' ? 'People' : 'Personer', exact: true }).click();
    await expect(page.locator('.person-login')).toHaveText(locale === 'en' ? ['Can sign in', 'Sign-in disabled', 'Profile only', 'Has an account'] : ['Kan logge inn', 'Innlogging er deaktivert', 'Kun profil', 'Har en konto']);
    const paths = await page.locator('.person-login svg').evaluateAll(nodes => nodes.map(n => n.innerHTML));
    expect(new Set(paths).size).toBe(3);
    expect(paths[2]).toBe(paths[3]);
    await shot(page, `people-account-states-${locale}`, 'Test-only account disclosure variants: active, disabled, profile-only, undisclosed', true);
    await page.unroute(`**${base}/people`);
  }
  record('F7 all four account disclosure labels and icon semantics rendered in en and nb');
  await prefs('en');

  const displayId = await pair(screen, 'UX evidence · example');
  await expect(screen.locator('.display-card')).toHaveCount(0);
  await expect(screen.getByRole('heading', { name: 'All clear for now.' })).toBeVisible();
  await shot(screen, 'display-fresh-empty-en', 'Real newly paired display with no targeted messages');
  record('new restricted display has truthful fresh empty state');

  // Real concurrent revocation: a visible choice must not silently disappear from submission.
  const cc = await browser.newContext({ baseURL });
  const concurrentScreen = await cc.newPage();
  const concurrentId = await pair(concurrentScreen, 'Concurrent revoke · example');
  await openPeople();
  dialog = await editRobin();
  await dialog.getByLabel('Concurrent revoke · example', { exact: true }).check();
  await mutate(`${base}/displays/${concurrentId}`, { revoked: true }, 'patch');
  const rejected = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/memberships/'));
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await rejected).status()).toBe(404);
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();
  await shot(page, 'permissions-concurrent-revoke-error', 'Real API rejection retains open permission form after concurrent target revocation');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await cc.close();
  record('F8 concurrent revoke remains an honest server error with the form retained');

  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  for (const key of ['ArrowRight', 'End', 'Home']) {
    await page.keyboard.press(key);
    const index = key === 'ArrowRight' ? 1 : key === 'End' ? 2 : 0;
    await expect(tabs.nth(index)).toBeFocused();
    await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
    expect(await tabs.nth(index).evaluate(n => getComputedStyle(n).outlineStyle !== 'none' && parseFloat(getComputedStyle(n).outlineWidth) >= 2)).toBeTruthy();
  }
  await shot(page, 'keyboard-tabs-focus', 'Arrow/Home/End selection and visible keyboard focus');
  const trigger = page.getByRole('button', { name: 'New message', exact: true }).first();
  await trigger.click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const focusable = dialog.locator('button:enabled,input:enabled,textarea:enabled,select:enabled,a[href]');
  const focusCount = await focusable.count();
  for (let i = 0; i < focusCount + 2; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(n => n.contains(document.activeElement))).toBeTruthy();
  }
  for (let i = 0; i < focusCount + 2; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(n => n.contains(document.activeElement))).toBeTruthy();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  record('keyboard tabs expose selection and visible focus; modal contains forward/backward focus and restores trigger');

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  dialog = page.getByRole('dialog');
  const draft = 'Synthetic retained draft: a slow breakfast and a little preparation.';
  await dialog.getByLabel('Your message', { exact: true }).fill(draft);
  await dialog.getByLabel('UX evidence · example', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await dialog.getByRole('button', { name: 'Tomorrow at 07:00', exact: true }).click();
  const inputsBefore = await dialog.locator('input').evaluateAll(ns => ns.map(n => ({ name: n.name, value: n.value, checked: n.checked })));
  const controls = dialog.locator('button:visible,input:visible,textarea:visible,select:visible');
  for (let i = 0; i < await controls.count(); i++) {
    const c = controls.nth(i);
    await c.scrollIntoViewIfNeeded();
    const box = await c.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(845);
  }
  await noOverflow(page);
  await shot(page, 'mobile-composer-bottom-controls', 'Every visible composer control scrolled within 390×844 viewport');
  await page.route(`**${base}/messages`, async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } });
    else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Schedule message', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Your message', { exact: true })).toHaveValue(draft);
  expect(await dialog.locator('input').evaluateAll(ns => ns.map(n => ({ name: n.name, value: n.value, checked: n.checked })))).toEqual(inputsBefore);
  await expect(dialog.getByRole('button', { name: 'Schedule', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('alert').scrollIntoViewIfNeeded();
  await shot(page, 'mobile-composer-retained-error', 'Test-only POST503 retains body, recipients, schedule, expiry and visible retry action');
  await page.unroute(`**${base}/messages`);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  record('all mobile composer controls reachable; API failure preserves every draft value');

  // Actual multiple-author projection. Add only our temporary grant, preserve all existing active permissions.
  let robin = await robinNow();
  await mutate(`${base}/memberships/${robin.membership_id}`, { rolePreset: robin.role_preset, capabilities: robin.capabilities, displayIds: [...new Set([...robin.display_ids, displayId])], expectedRevision: robin.revision }, 'patch');
  temporaryGrant = true;
  const longBody = 'Eksempelbeskjed: Husk det vi trenger før vi går hjemmefra. ' + 'Morgensamordning'.repeat(57);
  expect(longBody.length).toBeLessThanOrEqual(1000);
  await createMessage(longBody, displayId);
  await createMessage('Synthetic note from Robin: the bag is ready for tomorrow.', displayId, lc, limited);
  await expect(screen.locator('.display-card')).toHaveCount(2, { timeout: 15000 });
  await mutate(`${base}/displays/${displayId}`, { locale: 'nb', theme: 'dark' }, 'patch');
  await expect(screen.locator('html')).toHaveAttribute('lang', 'nb', { timeout: 15000 });
  await screen.setViewportSize({ width: 390, height: 844 });
  await expect(screen.getByRole('button', { name: 'Vis hele beskjeden', exact: true })).toBeVisible();
  await screen.getByRole('button', { name: 'Vis hele beskjeden', exact: true }).click();
  await expect(screen.getByRole('button', { name: 'Vis mindre', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await noOverflow(screen);
  await shot(screen, 'mobile-long-expanded-nb-dark', 'Real long/unbroken body expanded in Bokmål; no horizontal overflow', true);
  await screen.setViewportSize({ width: 1280, height: 752 });
  await screen.getByRole('button', { name: 'Skjermvalg', exact: true }).click();
  await expect(screen.getByRole('dialog')).toBeVisible();
  await screen.getByLabel('Skjermoppsett').selectOption('timeline');
  await screen.getByRole('dialog').getByRole('button', { name: 'Lukk', exact: true }).click();
  await expect(screen.locator('.person-column')).toHaveCount(2);
  for (const author of ['Avery · example', 'Robin · example'])
    await expect(screen.locator('.person-column h2').filter({ hasText: author })).toHaveCount(1);
  await expect(screen.locator('.display-card')).toHaveCount(2);
  await noOverflow(screen);
  await shot(screen, 'shelly-person-columns-nb-dark', 'Real published messages grouped by two original authors with publication times');
  record('long unbroken nb content expands without overflow; real two-author Timeline/Person Columns renders');
  await mutate(`${base}/displays/${displayId}`, { privacyMode: true, locale: 'en' }, 'patch');
  await expect(screen.getByRole('heading', { name: 'Privacy mode', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(screen.locator('.display-card')).toHaveCount(0);
  await shot(screen, 'display-privacy-en-dark', 'Real persisted privacy mode suppresses all targeted cards');
  await mutate(`${base}/displays/${displayId}`, { privacyMode: false }, 'patch');
  await expect(screen.locator('.display-card')).toHaveCount(2, { timeout: 15000 });
  await mutate(`${base}/displays/${displayId}`, { revoked: true }, 'patch');
  await expect(screen.getByText('This display is no longer paired. Its saved messages have been cleared.', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(screen.locator('.display-card')).toHaveCount(0);
  expect(await screen.evaluate(() => localStorage.getItem('samvev.display.projection.v1'))).toBeNull();
  await shot(screen, 'display-revoked-en', 'Real revocation clears projection and returns to restricted pairing flow');
  record('real privacy toggle and revocation hide/clear messages and saved projection');
  }

  // Hold initial setup response to capture a real pending render, then return an explicit test-only service fault.
  await page.setViewportSize({ width: 1280, height: 752 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/setup/status', async route => { await gate; await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } }); });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Getting things ready…');
  await shot(page, 'member-loading', 'Test-only held initial API request; genuine pending loading component');
  release();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await shot(page, 'member-error-retry', 'Test-only initial API503; accessible error and retry');
  await page.unroute('**/api/v1/setup/status');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Messages', exact: true })).toBeVisible();
  record('pending loading and recoverable service-error states have semantic feedback and successful retry');

  await page.goto('/workbench');
  for (const [locale, theme, width, height] of [['en', 'light', 390, 844], ['nb', 'dark', 1280, 752], ['en', 'dark', 1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.locator('select').nth(0).selectOption(locale);
    await page.locator('select').nth(1).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.display-card')).toHaveCount(1);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('status')).toBeVisible();
    await noOverflow(page);
    await shot(page, `workbench-${width}-${locale}-${theme}`, 'Synthetic component workbench: message/person/status/schedule/header/empty/offline/error/loading', true);
  }
  record('workbench components captured in phone, Shelly and 16:9 profiles across en/nb and light/dark');
  completed = true;
} finally {
  // Withdraw only our synthetic messages; retain unrelated household history.
  for (const id of messageIds) {
    const rows = (await (await context.request.get(`${base}/messages`)).json()).messages;
    const message = rows.find(m => m.id === id);
    if (message && ['published', 'scheduled'].includes(message.state)) await mutate(`${base}/messages/${id}/withdraw`, { expectedRevision: message.revision });
  }
  if (temporaryGrant) {
    const robin = await robinNow();
    await mutate(`${base}/memberships/${robin.membership_id}`, { rolePreset: robin.role_preset, capabilities: robin.capabilities, displayIds: robin.display_ids.filter(id => !displayIds.includes(id)), expectedRevision: robin.revision }, 'patch');
  }
  for (const id of displayIds) {
    const display = (await displays()).find(d => d.id === id);
    if (display && !display.revoked_at) await mutate(`${base}/displays/${id}`, { revoked: true }, 'patch');
  }
  await mutate('/api/v1/me/preferences', originalPrefs, 'patch');
  await writeFile(`${out}/ux-results.json`, JSON.stringify({ executedAt: new Date().toISOString(), baseURL, completed, phase: process.env.UX_PHASE ?? 'all', checks, screenshots, cleanup: { ownMessagesWithdrawn: messageIds.length, ownDisplaysRevoked: displayIds.length, temporaryGrantRemoved: temporaryGrant }, syntheticOnly: true, networkFaults: 'Explicitly labeled per screenshot; no auth artifacts recorded' }, null, 2));
  await browser.close();
}
