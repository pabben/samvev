import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';

const assetDirectory = join(import.meta.dirname, '../src/assets/calendar-providers');
const component = readFileSync(join(import.meta.dirname, '../src/calendar-provider-logos.tsx'), 'utf8');
const styles = readFileSync(join(import.meta.dirname, '../src/round9.css'), 'utf8');

test('provider artwork is local, vendor-origin SVG with no executable or external content', () => {
  const svgFiles = readdirSync(assetDirectory).filter(file => file.endsWith('.svg'));
  assert.deepEqual(svgFiles.sort(), [
    'google-calendar.svg', 'home-assistant-dark.svg', 'home-assistant-light.svg', 'outlook.svg', 'spond.svg',
  ]);
  for (const file of svgFiles) {
    const svg = readFileSync(join(assetDirectory, file), 'utf8');
    assert.match(svg, /^<svg\b/);
    assert.doesNotMatch(svg, /<script\b|\son\w+\s*=|<foreignObject\b/i, file);
    assert.doesNotMatch(svg, /(?:href|xlink:href)\s*=\s*["'](?:https?:|\/\/|data:)/i, file);
    assert.doesNotMatch(svg, /url\(\s*["']?(?:https?:|\/\/|data:)/i, file);
  }
  assert.match(component, /from '\.\/assets\/calendar-providers\//);
  assert.doesNotMatch(component, /https?:\/\//);
});

test('provider marks are decorative, keep light and dark Home Assistant variants, and scale for compact layouts', () => {
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /alt=""/);
  assert.match(component, /homeAssistantLight/);
  assert.match(component, /homeAssistantDark/);
  assert.match(styles, /\[data-theme="dark"\] \.calendar-provider-image-ha-dark/);
  assert.match(styles, /@media\(prefers-color-scheme:dark\)\{\[data-theme="system"\] \.calendar-provider-image-ha-light/);
  assert.match(styles, /calendar-provider-mark-spond\{[^}]*background:#243447/);
  assert.match(styles, /@media\(max-width:640px\).*?\.calendar-provider-grid/s);
});
