// Component-level CSS check; uses no app runtime, server, account, or fixture data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from '@playwright/test';

registerHooks({load(url, context, nextLoad) {
  return /\.(svg|png)$/.test(url)
    ? {format: 'module', source: `export default ${JSON.stringify(url.split('/').at(-1))}`, shortCircuit: true}
    : nextLoad(url, context);
}});

const {SpondHomeAssistantLogos} = await import('../src/calendar-provider-logos.tsx');
const markup = renderToStaticMarkup(createElement(SpondHomeAssistantLogos));
const css = await readFile(new URL('../src/round9.css', import.meta.url), 'utf8');
const asset = async (name, type) => `data:${type};base64,${(await readFile(new URL(`../src/assets/calendar-providers/${name}`, import.meta.url))).toString('base64')}`;
const urls = {
  'spond-positive.png': await asset('spond-positive.png', 'image/png'),
  'spond-negative.png': await asset('spond-negative.png', 'image/png'),
  'home-assistant.svg': await asset('home-assistant.svg', 'image/svg+xml'),
};
const fixture = markup.replace(/src="([^"]+)"/g, (_, name) => `src="${urls[name] ?? name}"`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style><main><section data-theme="light">${fixture}</section><section data-theme="dark">${fixture}</section></main>`);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  const visibility = await page.locator('[data-theme]').evaluateAll(sections => sections.map(section => {
    const positive = section.querySelector('.calendar-provider-spond-positive');
    const negative = section.querySelector('.calendar-provider-spond-negative');
    const box = element => {
      const rect = element.getBoundingClientRect();
      return {display: getComputedStyle(element).display, width: rect.width, height: rect.height};
    };
    return {theme: section.getAttribute('data-theme'), positive: box(positive), negative: box(negative)};
  }));

  for (const state of visibility) {
    const visible = state.theme === 'light' ? state.positive : state.negative;
    const hidden = state.theme === 'light' ? state.negative : state.positive;
    assert.notEqual(visible.display, 'none', `${state.theme} mark is visible`);
    assert.ok(visible.width > 0 && visible.height > 0, `${state.theme} mark has a painted box`);
    assert.equal(hidden.display, 'none', `${state.theme} alternate mark is hidden`);
    assert.equal(hidden.width, 0, `${state.theme} alternate mark takes no width`);
    assert.equal(hidden.height, 0, `${state.theme} alternate mark takes no height`);
  }
  console.log(JSON.stringify({test: 'provider logo component CSS/asset fixture', visibility}, null, 2));
} finally {
  await browser.close();
}
