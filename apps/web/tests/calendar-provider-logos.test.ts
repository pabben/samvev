import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

registerHooks({load(url, context, nextLoad) {
  return /\.(svg|png|webp)$/.test(url)
    ? {format: 'module', source: `export default ${JSON.stringify(url.split('/').at(-1))}`, shortCircuit: true}
    : nextLoad(url, context);
}});

const {CalendarProviderLogo, SpondHomeAssistantLogos} = await import('../src/calendar-provider-logos');

test('provider marks use decorative official images and keep provider identity in text', () => {
  for (const provider of ['google', 'microsoft', 'home_assistant', 'spond'] as const) {
    const markup = renderToStaticMarkup(createElement(CalendarProviderLogo, {provider}));
    assert.match(markup, new RegExp(`calendar-provider-mark-${provider}`));
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, /<img [^>]*alt=""/);
    assert.doesNotMatch(markup, /<svg |https?:|data:image/);
  }

  const combined = renderToStaticMarkup(createElement(SpondHomeAssistantLogos));
  assert.equal((combined.match(/<img /g) ?? []).length, 3);
  assert.match(combined, /calendar-provider-mark-spond/);
  assert.match(combined, /calendar-provider-mark-home_assistant/);
  assert.match(combined, /aria-hidden="true"/);
});
