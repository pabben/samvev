// Synthetic browser acceptance for display repair and keyboard settings.
// Every API request is intercepted; no database, account or network service is used.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://samvev-m1-app-1:4173';
const household = '10000000-0000-4000-8000-000000000017';
const person = '20000000-0000-4000-8000-000000000017';
const displayId = '60000000-0000-4000-8000-000000000017';
const setupId = '70000000-0000-4000-8000-000000000017';
const pairingId = '80000000-0000-4000-8000-000000000017';
const membershipId = '30000000-0000-4000-8000-000000000017';
const caps = ['household.view', 'household.manage', 'display.manage'];
const setup = { id: setupId, name: 'Synthetic shared setup', isDefault: true, revision: 3, locale: 'nb', theme: 'dark', cards: ['today'], cardOrder: ['today'], personIds: [person], familyLayoutEnabled: false };
const display = {
  id: displayId, name: 'Synthetic wall display', setup_id: setupId, setupName: setup.name,
  locale: 'nb', theme: 'dark', localeOverride: null, themeOverride: null,
  setupDefaults: { locale: 'nb', theme: 'dark', personIds: [person] },
  effective: { locale: 'nb', theme: 'dark', personIds: [person] },
  personIdsOverride: null, credentialGeneration: 4, privacy_mode: false,
  revoked_at: null, last_seen_at: null, external_items_enabled: false,
  birthdayMode: 'off', profile_person_ids: [], contentReadiness: { calendar: 'none_selected' },
};
const people = [{ id: person, display_name: 'Synthetic adult', age_group: 'adult', person_revision: 1, membership_id: membershipId, role_preset: 'household_admin', capabilities: caps, revision: 1, has_login: true, email: 'synthetic@example.invalid', display_ids: [displayId] }];
const membership = { id: membershipId, household_id: household, person_id: person, role_preset: 'household_admin', capabilities: caps, revision: 1, household_name: 'Synthetic household', timezone: 'Europe/Oslo', household_locale: 'nb', display_name: 'Synthetic adult', display_ids: [displayId] };
let approved = false;
let approvalPayload;
let redeemedId;
let setupPatch;
let displayPatch;

async function installSyntheticApi(context) {
  await context.route('**/api/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const body = req.method() === 'GET' ? {} : (req.postDataJSON() ?? {});
    let status = 200;
    let value = {};
    if (path === '/setup/status') value = { claimed: true, demo: false, demoAvailable: false, locale: 'nb' };
    else if (path === '/me') value = { account: { installation_id: '90000000-0000-4000-8000-000000000017', id: '40000000-0000-4000-8000-000000000017', email: 'synthetic@example.invalid', locale: 'nb', theme: 'light' }, csrfToken: 'synthetic-only', memberships: [membership] };
    else if (path === '/setup/progress') value = { setupStep: 'complete' };
    else if (path === `/households/${household}/people`) value = { people };
    else if (path === `/households/${household}/displays`) value = { displays: [display] };
    else if (path === `/households/${household}/messages`) value = { messages: [] };
    else if (path === `/households/${household}/dashboard`) value = { upcomingBirthday: null };
    else if (path === `/households/${household}/settings`) value = { show_upcoming_birthday: false, revision: 1 };
    else if (path === `/households/${household}/display-setups`) value = { setups: [setup] };
    else if (path === `/households/${household}/calendar-connections`) value = { connections: [] };
    else if (path === `/households/${household}/integrations`) value = { connections: [] };
    else if (path === `/households/${household}/media/albums`) value = { albums: [] };
    else if (path === `/households/${household}/displays/${displayId}/pairing/approve` && req.method() === 'POST') {
      approvalPayload = body;
      approved = true;
      value = { approved: true };
    } else if (path === `/households/${household}/displays/${displayId}` && req.method() === 'PATCH') {
      displayPatch = body;
      value = {};
    } else if (path === `/households/${household}/display-setups/${setupId}` && req.method() === 'PATCH') {
      setupPatch = body;
      value = {};
    } else if (path === '/display/pairing/start' && req.method() === 'POST') value = { pairingId, code: '123456', expiresAt: new Date(Date.now() + 120000).toISOString() };
    else if (path === `/display/pairing/${pairingId}/status`) value = { approved, expired: false };
    else if (path === '/display/pairing/redeem' && req.method() === 'POST') { redeemedId = displayId; value = { id: displayId }; }
    else if (path === '/display/projection') { status = 401; value = { error: { code: 'DISPLAY_NOT_PAIRED' } }; }
    else if (path === '/me/preferences' && req.method() === 'PATCH') value = body;
    else { status = 404; value = { error: { code: 'SYNTHETIC_ROUTE_NOT_DEFINED' } }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  });
}

const browser = await chromium.launch({ headless: true });
try {
  const adminContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const screenContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 752 }, reducedMotion: 'reduce' });
  await installSyntheticApi(adminContext);
  await installSyntheticApi(screenContext);
  const admin = await adminContext.newPage();
  const screen = await screenContext.newPage();
  await admin.goto('/?tab=displays');
  await admin.getByRole('heading', { name: 'Et felles blikk på hjemmet.', exact: true }).waitFor();
  await admin.locator('summary').filter({ hasText: 'Åpne eller koble til' }).click();
  await admin.getByRole('button', { name: 'Koble til denne eksisterende skjermen på nytt' }).click();
  await admin.getByRole('heading', { name: 'Koble til Synthetic wall display på nytt' }).waitFor();
  assert.match(await admin.locator('dialog').innerText(), /beholder oppsettet \(Synthetic shared setup\), personvalget og tilgangen/);
  await screen.goto('/display');
  await screen.getByRole('heading', { name: 'La husstanden bli synlig.' }).waitFor();
  await screen.getByRole('button', { name: /hent tilkoblingskode|get a pairing code/i }).click();
  // The synthetic display GUI requests a code; the admin GUI enters and approves that displayed code.
  const displayedCode = await screen.getByTestId('pairing-code').innerText();
  await admin.getByLabel('Sekssifret kode').fill(displayedCode);
  await admin.getByRole('button', { name: 'Godkjenn ny tilkobling' }).click();
  await admin.getByText('Ny tilkobling for denne skjermen er godkjent.').waitFor();
  assert.deepEqual(approvalPayload, { code: '123456', expectedCredentialGeneration: 4 });
  await screen.waitForTimeout(2200);
  assert.equal(redeemedId, displayId, 'second browser redeems into the same display registration');
  await admin.locator('dialog button.button').filter({ hasText: 'Lukk' }).click();

  await admin.locator('summary').filter({ hasText: /Norsk bokmål.*Mørkt/i }).click();
  const locale = admin.getByLabel('Skjermens språk');
  const theme = admin.getByLabel('Skjermens utseende');
  assert.equal(await locale.inputValue(), 'inherit');
  assert.equal(await theme.inputValue(), 'inherit');
  for (const control of [locale, theme]) {
    await control.focus();
    const focusStyle = await control.evaluate(el => {
      const style = getComputedStyle(el);
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    });
    assert.equal(focusStyle, true, 'keyboard focus is visibly indicated on native select');
  }
  await locale.focus();
  await admin.keyboard.press('Tab');
  assert.equal(await theme.evaluate(element => document.activeElement === element), true);
  assert.equal(displayPatch, undefined, 'opening and keyboard navigating controls does not change persisted overrides');
  assert.equal(setupPatch, undefined, 'per-display controls do not edit shared setup');
  await adminContext.close();
  await screenContext.close();
  console.log('PASS synthetic two-context re-pair approval/redeem same ID; #18 native language/appearance inheritance and keyboard focus. API requests were intercepted; server cookie revocation remains covered by round15-display-policy.integration.test.ts.');
} finally {
  await browser.close();
}
