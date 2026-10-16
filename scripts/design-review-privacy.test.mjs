import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { maskReviewPrivacy } from './design-review-privacy.mjs';

test('capture masking hides protected photos and name-free private content without changing layout', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://capture.invalid/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
    await page.setContent(`<style>.hub-person,.hub-message,.hub-timeline,.hub-support-preview{padding:12px;width:300px}strong{color:red}img{width:48px;height:48px}</style>
      <main class="family-hub"><article class="hub-person"><span class="avatar">ZX</span><span class="hub-person-name"><strong>private fixture</strong></span><span class="combined">private fixture · activity</span><span class="hub-person-activity">Private diagnosis follow-up</span>
      <img id="protected-photo" src="https://capture.invalid/api/v1/households/11111111-1111-4111-8111-111111111111/people/22222222-2222-4222-8222-222222222222/photo/96?v=1"></article>
      <button class="account-button"><strong>private fixture</strong></button><article class="hub-message"><span class="hub-message-meta"><strong>private fixture</strong><time>18:40</time></span><span class="display-card-body">private message <b style="color:blue">nested body</b></span></article>
      <ol class="hub-timeline"><li data-item-id="synthetic-event"><time>09:15</time><div><button class="hub-item-title"><strong>Private appointment without a person name</strong></button><small>Confidential street 42</small></div></li></ol>
      <article class="hub-reminder" data-item-id="synthetic-reminder"><button><strong>Private medication reminder</strong></button></article>
      <article class="hub-support-preview" data-item-id="synthetic-brief"><button><strong>Private AI summary</strong></button><p>Confidential unnamed household details</p><details class="hub-provenance" open><summary>Internal source</summary><a href="https://example.invalid/private">Private source and timestamp</a></details></article>
      <section class="hub-waste"><button><span data-item-id="waste-private"><strong>Confidential waste route</strong><time>24 October</time></span></button></section>
      <article class="hub-temperature" data-item-id="temperature-private"><strong>Private bedroom sensor</strong><span class="hub-temperature-value">−3.5 °C</span><details open><summary>Source time</summary><p>Private source timestamp</p></details></article>
      <section class="household-boards"><span data-review-private="grocery-label">Private grocery item</span><span data-review-private="dinner-option">Private dinner plan</span></section>
      </main>`);
    await page.locator('#protected-photo').evaluate(image=>image.decode());
    const geometry=()=>page.locator('.hub-person,.hub-message,.hub-timeline,.hub-reminder,.hub-support-preview,#protected-photo').evaluateAll(nodes=>nodes.map(node=>{const {x,y,width,height}=node.getBoundingClientRect();return{x,y,width,height}}));
    const before=await geometry();
    assert.equal(await page.locator('#protected-photo').evaluate(node=>getComputedStyle(node).visibility),'visible');
    const redactions=await maskReviewPrivacy(page,['private fixture']);
    assert.deepEqual(await geometry(),before);
    for(const kind of ['runtimeIdentity','messageBody','protectedPhoto','dynamicItem','personalActivity','provenance','homeEnvironment','grocery-label','dinner-option'])assert.ok(redactions.includes(kind),kind);
    assert.equal(await page.locator('#protected-photo').evaluate(node=>getComputedStyle(node).visibility),'hidden');
    assert.equal(await page.locator('.avatar').evaluate(node=>getComputedStyle(node).visibility),'hidden');
    const privateText='.hub-person-name strong,.combined,.hub-person-activity,.display-card-body,.display-card-body b,.hub-message-meta time,.hub-timeline time,.hub-timeline strong,.hub-timeline small,.hub-reminder strong,.hub-support-preview strong,.hub-support-preview p,.hub-provenance summary,.hub-provenance a,.hub-waste strong,.hub-waste time,.hub-temperature strong,.hub-temperature-value,.hub-temperature p,[data-review-private]';
    for(const state of await page.locator(privateText).evaluateAll(nodes=>nodes.map(node=>{const css=getComputedStyle(node);return{marked:!!node.closest('[data-review-redact]'),hidden:css.visibility==='hidden'||(css.color==='rgba(0, 0, 0, 0)'&&css.webkitTextFillColor==='rgba(0, 0, 0, 0)'),shadow:css.textShadow}}))){
      assert.equal(state.marked,true);assert.equal(state.hidden,true);
    }
    assert.equal(await page.locator('.hub-timeline strong').textContent(),'Private appointment without a person name');
    assert.equal(await page.locator('.hub-temperature').evaluate(node=>getComputedStyle(node).color),'rgba(0, 0, 0, 0)');
    // New polling content must also be redacted without requiring its names.
    await page.locator('.hub-support-preview').evaluate(node=>{const p=document.createElement('p');p.id='late-private';p.textContent='Private asynchronously refreshed result';node.append(p)});
    await page.waitForFunction(()=>document.querySelector('#late-private')?.hasAttribute('data-review-redact'));
    assert.equal(await page.locator('#late-private').evaluate(node=>getComputedStyle(node).color),'rgba(0, 0, 0, 0)');
  } finally { await browser.close(); }
});
