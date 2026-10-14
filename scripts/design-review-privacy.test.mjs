import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { maskReviewPrivacy } from './design-review-privacy.mjs';

test('capture masking preserves real DOM geometry while removing runtime identity and message pixels', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main class="family-hub"><article class="hub-person"><span class="avatar">ZX</span><span class="hub-person-name"><strong>private fixture</strong></span><span class="combined">private fixture · activity</span></article><button class="account-button"><strong>private fixture</strong></button><article class="hub-message"><span class="hub-message-meta"><strong>private fixture</strong></span><span class="display-card-body">private message body</span></article></main>');
    const before = await page.locator('.hub-person').boundingBox();
    const redactions = await maskReviewPrivacy(page, ['private fixture']);
    const after = await page.locator('.hub-person').boundingBox();
    assert.deepEqual(after, before);
    assert.ok(redactions.includes('runtimeIdentity'));
    assert.ok(redactions.includes('messageBody'));
    assert.equal(await page.locator('[data-review-redact]').count() > 0, true);
    assert.equal(await page.locator('.hub-person-name strong').getAttribute('data-review-redact'), 'runtimeIdentity');
    assert.equal(await page.locator('.combined').getAttribute('data-review-redact'), 'runtimeIdentity');
  } finally { await browser.close(); }
});
