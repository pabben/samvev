import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

registerHooks({load(url, context, nextLoad) {
  return /\.(svg|png)$/.test(url)
    ? {format: 'module', source: `export default ${JSON.stringify(url.split('/').at(-1))}`, shortCircuit: true}
    : nextLoad(url, context);
}});

const {CalendarProviderLogo, SpondHomeAssistantLogos} = await import('../src/calendar-provider-logos');

test('provider marks are local decorative images with readable names supplied by callers', () => {
  for (const provider of ['google', 'microsoft', 'home_assistant', 'spond'] as const) {
    const markup = renderToStaticMarkup(createElement(CalendarProviderLogo, {provider}));
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, /alt=""/);
    assert.doesNotMatch(markup, /https?:/);
  }

  const combined = renderToStaticMarkup(createElement(SpondHomeAssistantLogos));
  assert.equal((combined.match(/<img /g) ?? []).length, 3);
  assert.equal((combined.match(/alt=""/g) ?? []).length, 3);
  assert.match(combined, /calendar-provider-mark-spond/);
  assert.match(combined, /calendar-provider-mark-home_assistant/);
});

test('bundled assets match their documented original-byte hashes', () => {
  const expected = new Map([
    ['google-calendar.svg', '7f55cd877b2261948168db3d2e9468c0cf3f07766789489e853a0f9931dff8ea'],
    ['outlook.png', '0c66b126e19acc29e5ab22b796f0af8d8fe6bd5cc6e754ba063d8921696c6d03'],
    ['home-assistant.svg', 'a1c5bcc1b4cba9238169e7fce3d391cfe4fd9813c656accff505cc920a14549b'],
    ['spond-positive.png', '7fd5dbf26ccb0bf61674a6ccc69d39a8673c3f9e89d93e8c6696b7106b9200f6'],
    ['spond-negative.png', 'a54f68e588823f14a5995a685a222f229e7313413fe1fa41310ffd53d479cc7f'],
  ]);
  for (const [filename, hash] of expected) {
    const bytes = readFileSync(new URL(`../src/assets/calendar-providers/${filename}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, filename);
  }
});
