import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('Anthropic routine and strong model labels target their rendered inputs', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
  const { AnthropicModelField } = await vite.ssrLoadModule('/src/ai-settings.tsx') as typeof import('../src/ai-settings');
  const optionLabels = {
    haiku: 'Claude Haiku 5.5',
    sonnet: 'Claude Sonnet 5.5',
    custom: (model: string) => `Custom model ID: ${model}`,
  };
  const html = renderToStaticMarkup(createElement('section', null,
    createElement(AnthropicModelField, {
      field: 'defaultModel', value: 'claude-haiku-5-5', disabled: false,
      label: 'Routine model', hint: 'Routine hint', optionLabels, onChange: () => {},
    }),
    createElement(AnthropicModelField, {
      field: 'strongModel', value: 'claude-sonnet-5-5', disabled: false,
      label: 'Strong model', hint: 'Strong hint', optionLabels, onChange: () => {},
    }),
  ));

  for (const label of ['Routine model', 'Strong model']) {
    const labelMatch = html.match(new RegExp(`<label for="([^"]+)">${label}</label>`));
    assert.ok(labelMatch, `${label} label renders with a for target`);
    const id = labelMatch[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(html, new RegExp(`<input[^>]*\\sid="${id}"`), `${label} points to a rendered input`);
  }
  assert.match(html, /<input[^>]*list="anthropic-defaultModel"/);
  assert.match(html, /<datalist id="anthropic-defaultModel">/);
  assert.match(html, /<input[^>]*list="anthropic-strongModel"/);
  assert.match(html, /<datalist id="anthropic-strongModel">/);
  } finally {
    await vite.close();
  }
});
