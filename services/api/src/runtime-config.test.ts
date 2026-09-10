import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicDeploymentReady, loadRuntimeConfig } from './runtime-config.ts';

test('runtime config keeps local development private and HTTP-compatible by default', () => {
  assert.deepEqual(loadRuntimeConfig({}), {
    publicOrigin: 'http://127.0.0.1:4173',
    secureCookies: false,
    trustProxy: false
  });
});

test('runtime config normalizes the public HTTPS origin and trusts only the named proxy', () => {
  assert.deepEqual(loadRuntimeConfig({
    SAMVEV_PUBLIC_ORIGIN: 'https://samvev.pabben.org',
    SAMVEV_TRUST_PROXY: '192.168.32.1/32'
  }), {
    publicOrigin: 'https://samvev.pabben.org',
    secureCookies: true,
    trustProxy: '192.168.32.1/32'
  });
});

test('runtime config rejects ambiguous origins and unbounded proxy trust', () => {
  for (const origin of [
    'ftp://samvev.pabben.org',
    'https://user:pass@samvev.pabben.org',
    'https://samvev.pabben.org/path',
    'https://samvev.pabben.org?query=1',
    'not-a-url'
  ]) {
    assert.throws(() => loadRuntimeConfig({ SAMVEV_PUBLIC_ORIGIN: origin }));
  }
  for (const trustProxy of ['true', '1', '*', '0.0.0.0/0', '::/0', 'uniquelocal', 'not-an-ip']) {
    assert.throws(() => loadRuntimeConfig({ SAMVEV_TRUST_PROXY: trustProxy }), /immediate proxy/);
  }
});

test('public HTTPS startup requires a claimed non-demo installation', async () => {
  const local = loadRuntimeConfig({});
  let localRead = false;
  await assertPublicDeploymentReady(local, true, async () => {
    localRead = true;
    return undefined;
  });
  assert.equal(localRead, false);

  const publicHttps = loadRuntimeConfig({ SAMVEV_PUBLIC_ORIGIN: 'https://samvev.pabben.org' });
  await assert.rejects(
    assertPublicDeploymentReady(publicHttps, true, async () => ({ claimedAt: new Date(), demoMode: false })),
    /SAMVEV_DEMO_MODE=true/
  );
  await assert.rejects(
    assertPublicDeploymentReady(publicHttps, false, async () => undefined),
    /privately claimed/
  );
  await assert.rejects(
    assertPublicDeploymentReady(publicHttps, false, async () => ({ claimedAt: new Date(), demoMode: true })),
    /non-demo/
  );
  await assert.doesNotReject(
    assertPublicDeploymentReady(publicHttps, false, async () => ({ claimedAt: new Date(), demoMode: false }))
  );
});
