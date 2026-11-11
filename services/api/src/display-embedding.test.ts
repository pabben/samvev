import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_SECURITY_POLICY, browserSecurityHeaders, displayCookieOptions, displayDocumentSecurityHeaders, isDisplayDocumentPath } from './browser-security.ts';
import { loadRuntimeConfig } from './runtime-config.ts';

const HTTPS = 'https://samvev.pabben.org';

test('display embedding is off unless explicitly configured', () => {
  assert.equal('displayFrameAncestors' in loadRuntimeConfig({ SAMVEV_PUBLIC_ORIGIN: HTTPS }), false);
  assert.equal('displayFrameAncestors' in loadRuntimeConfig({ SAMVEV_PUBLIC_ORIGIN: HTTPS, SAMVEV_DISPLAY_FRAME_ANCESTORS: '  ' }), false);
  assert.deepEqual(displayDocumentSecurityHeaders(true, []), browserSecurityHeaders(true));
  assert.deepEqual(displayCookieOptions(60, true, false), { httpOnly: true, sameSite: 'strict', secure: true, path: '/api/v1/display', maxAge: 60 });
});

test('display frame ancestors accept exact LAN and HTTPS origins and normalize duplicates', () => {
  const config = loadRuntimeConfig({
    SAMVEV_PUBLIC_ORIGIN: HTTPS,
    SAMVEV_DISPLAY_FRAME_ANCESTORS: 'http://192.0.2.26:8123, https://hass.example.test https://hass.example.test/'
  });
  assert.deepEqual(config.displayFrameAncestors, ['http://192.0.2.26:8123', 'https://hass.example.test']);
});

test('display frame ancestors reject wildcards, paths, keywords and non-HTTP schemes', () => {
  for (const value of ['*', 'https://*.pabben.org', 'https://hass.example.test/lovelace', "'self'", 'hass.example.test',
    'ftp://192.0.2.26', 'https://user:pass@hass.example.test', 'https://hass.example.test?x=1', 'javascript:alert(1)']) {
    assert.throws(() => loadRuntimeConfig({ SAMVEV_PUBLIC_ORIGIN: HTTPS, SAMVEV_DISPLAY_FRAME_ANCESTORS: value }), /SAMVEV_DISPLAY_FRAME_ANCESTORS/, value);
  }
});

test('display frame ancestors require an HTTPS public origin because SameSite=None needs Secure', () => {
  assert.throws(() => loadRuntimeConfig({ SAMVEV_DISPLAY_FRAME_ANCESTORS: 'http://192.0.2.26:8123' }), /requires an https/);
});

test('only the display document gets the widened frame-ancestors policy and no X-Frame-Options', () => {
  const headers = displayDocumentSecurityHeaders(true, ['http://192.0.2.26:8123', 'https://hass.example.test']);
  assert.equal(headers['X-Frame-Options'], undefined);
  assert.equal(headers['Strict-Transport-Security'], 'max-age=86400');
  const csp = headers['Content-Security-Policy'] ?? '';
  assert.match(csp, /frame-ancestors 'self' http:\/\/192\.0\.2\.26:8123 https:\/\/hass\.example\.test$/);
  assert.equal(csp.replace(/; frame-ancestors .*$/, ''), CONTENT_SECURITY_POLICY.replace(/; frame-ancestors .*$/, ''));
  assert.equal(isDisplayDocumentPath('/display'), true);
  for (const path of ['/', '/display/x', '/displays', '/api/v1/display/projection', '/integrations']) assert.equal(isDisplayDocumentPath(path), false, path);
});

test('embeddable display cookie is SameSite=None, Partitioned and still Secure, HttpOnly and API-scoped', () => {
  assert.deepEqual(displayCookieOptions(60, true, true), { httpOnly: true, sameSite: 'none', partitioned: true, secure: true, path: '/api/v1/display', maxAge: 60 });
  assert.equal(displayCookieOptions(60, false, true).sameSite, 'strict');
});
