// Component-level CSS and accessibility check; uses no app runtime or account data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from '@playwright/test';

registerHooks({load(url, context, nextLoad) {
  return /\.(svg|png|webp)$/.test(url)
    ? {format: 'module', source: `export default ${JSON.stringify(url.split('/').at(-1))}`, shortCircuit: true}
    : nextLoad(url, context);
}});

const css = await readFile(new URL('../src/round9.css', import.meta.url), 'utf8');
const {CalendarProviderLogo, SpondHomeAssistantLogos} = await import('../src/calendar-provider-logos.tsx');
const fixtures = [
  ['google', 'Google Calendar', createElement(CalendarProviderLogo, {provider: 'google'})],
  ['microsoft', 'Outlook / Microsoft 365', createElement(CalendarProviderLogo, {provider: 'microsoft'})],
  ['home_assistant', 'Home Assistant', createElement(CalendarProviderLogo, {provider: 'home_assistant'})],
  ['spond', 'Spond / Home Assistant', createElement(SpondHomeAssistantLogos)],
];
const markup = fixtures.map(([provider, label, mark]) =>
  `<div class="provider" data-provider="${provider}">${renderToStaticMarkup(mark)}<span>${label}</span></div>`
).join('');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>
    body{margin:0;padding:16px;font:16px sans-serif}.providers{display:grid;gap:12px}
    .provider{display:flex;align-items:center;gap:9px;min-height:44px;color:CanvasText}
    [data-theme="light"]{--teal:#087f78}[data-theme="dark"]{--teal:#52d6c7}
    ${css}
  </style><main><section data-theme="light"><div class="providers">${markup}</div></section><section data-theme="dark" style="color-scheme:dark"><div class="providers">${markup}</div></section></main>`);
  const states = await page.locator('[data-theme]').evaluateAll(sections => sections.map(section => ({
    theme: section.getAttribute('data-theme'),
    providers: [...section.querySelectorAll('.provider')].map(item => {
      const icon = item.querySelector('svg');
      const rect = icon.getBoundingClientRect();
      return {
        provider: item.getAttribute('data-provider'),
        name: item.querySelector('span:not([aria-hidden="true"])')?.textContent,
        hidden: icon.getAttribute('aria-hidden'),
        width: rect.width,
        height: rect.height,
        color: getComputedStyle(icon).color,
      };
    }),
  })));

  for (const state of states) {
    assert.equal(state.providers.length, 4);
    for (const [index, item] of state.providers.entries()) {
      assert.equal(item.name, fixtures[index][1], `${state.theme} visible provider name`);
      assert.equal(item.hidden, 'true', `${state.theme} glyph is decorative`);
      assert.ok(item.width > 0 && item.height > 0, `${state.theme} glyph has a visible box`);
      assert.notEqual(item.color, 'rgba(0, 0, 0, 0)', `${state.theme} glyph has a visible color`);
    }
  }
  assert.notEqual(states[0].providers[0].color, states[1].providers[0].color, 'theme-aware glyph color');
  console.log(JSON.stringify({test: 'provider generic glyph browser fixture', states}, null, 2));
} finally {
  await browser.close();
}
