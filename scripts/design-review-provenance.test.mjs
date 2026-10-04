import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRuntimeLeafCommand, requireMatchingProof, requireMatchingRuntimeProof, requireRuntimeTransition, safeSha, verifyInputs } from './design-review-provenance.mjs';

const sha = 'a'.repeat(40);
const inputs = { sourceSha: sha, inputFingerprint: 'inputs' };
const assets = { 'index.html': 'index', 'assets/app.js': 'bundle' };
const runtime = { runtimeFingerprint: 'runtime' };
const proof = { sourceSha: sha, inputFingerprint: 'inputs', distHashes: assets, runtimeFingerprint: 'runtime' };
test('accepts an exact committed-input, runtime and built-bundle proof', () => assert.doesNotThrow(() => requireMatchingProof(proof, inputs, assets, runtime)));
test('rejects changed build input and stale served bundle', () => {
  assert.throws(() => requireMatchingProof(proof, { ...inputs, inputFingerprint: 'edited' }, assets, runtime), /stale/);
  assert.throws(() => requireMatchingProof(proof, inputs, { ...assets, 'assets/app.js': 'stale' }, runtime), /bundle/);
  assert.throws(() => requireMatchingProof(proof, inputs, assets, { runtimeFingerprint: 'restarted' }), /runtime/);
});
test('rejects an unsafe provenance SHA', () => {
  assert.equal(safeSha('../not-a-commit'), false);
  assert.throws(() => requireMatchingProof({ ...proof, sourceSha: 'bad' }, inputs, assets, runtime), /Invalid/);
});
test('rejects stale runtime processes and database migration state', () => {
  const migrations = { fingerprint: 'migrations', files: { 'services/api/migrations/001.sql': '1'.repeat(64) } };
  const runtimeProof = { sourceSha: sha, inputFingerprint: 'inputs', migrationFingerprint: 'migrations', migrationFiles: migrations.files, runtimeFingerprint: 'runtime' };
  const current = { runtimeFingerprint: 'runtime', appliedMigrations: migrations.files };
  assert.doesNotThrow(() => requireMatchingRuntimeProof(runtimeProof, current, inputs, migrations));
  assert.throws(() => requireMatchingRuntimeProof(runtimeProof, { ...current, runtimeFingerprint: 'leaf-replaced' }, inputs, migrations), /processes changed/);
  assert.throws(() => requireMatchingRuntimeProof(runtimeProof, { ...current, appliedMigrations: {} }, inputs, migrations), /migrations do not exactly match/);
});
test('runtime transition requires app and worker restarts while preserving database and LAN config', () => {
  const service = { containerId: 'container', imageId: 'image', configFingerprint: 'config', startedAt: 'before', publicOrigin: null };
  const before = { app: { ...service, publicOrigin: 'http://192.168.0.220:4173' }, worker: service, db: { containerId: 'db', startedAt: 'db-start', restartCount: 0 }, syntheticDatabase: { fingerprint: 'synthetic' } };
  const after = { app: { ...before.app, startedAt: 'after' }, worker: { ...before.worker, startedAt: 'after' }, db: { ...before.db }, syntheticDatabase: { ...before.syntheticDatabase } };
  assert.doesNotThrow(() => requireRuntimeTransition(before, after));
  assert.throws(() => requireRuntimeTransition(before, { ...after, worker: before.worker }), /worker was not restarted/);
  assert.throws(() => requireRuntimeTransition(before, { ...after, db: { ...after.db, restartCount: 1 } }), /database was restarted/);
});
test('matches the actual tsx dist loader leaf and rejects its shell and wrapper parents', () => {
  const source='services/api/src/server.ts';
  assert.equal(isRuntimeLeafCommand(['/usr/local/bin/node','--require','/workspace/node_modules/tsx/dist/preflight.cjs','--import','file:///workspace/node_modules/tsx/dist/loader.mjs',source],source),true);
  assert.equal(isRuntimeLeafCommand(['sh','-c',`tsx ${source}`],source),false);
  assert.equal(isRuntimeLeafCommand(['node','/workspace/node_modules/.bin/tsx',source],source),false);
  assert.equal(isRuntimeLeafCommand(['/usr/local/bin/node','--import','file:///workspace/node_modules/tsx/dist/loader.mjs','services/worker/src/index.ts'],source),false);
});
test('verifies real Git blob bytes and rejects an edited tracked input', async t => {
  const base = join(process.cwd(), '.local/design-review-tests', randomUUID()); const source = join(base, 'source'); const mounted = join(base, 'mounted');
  t.after(() => rm(base, { recursive: true, force: true })); await mkdir(join(source, 'apps/web/src'), { recursive: true });
  await writeFile(join(source, 'apps/web/src/demo.js'), 'export const demo = 1;\n');
  await writeFile(join(source, '.gitignore'), 'apps/web/dist/\n');
  const run = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', source]); run(source, ['config', 'user.email', 'synthetic@example.invalid']); run(source, ['config', 'user.name', 'Synthetic']); run(source, ['add', '.']); run(source, ['commit', '-m', 'fixture']);
  execFileSync('git', ['clone', source, mounted]);
  const verified = await verifyInputs({ cloneDir: source, rootDir: mounted });
  assert.equal(safeSha(verified.sourceSha), true);
  await mkdir(join(mounted, 'apps/web/dist'), { recursive: true }); await writeFile(join(mounted, 'apps/web/dist/generated.js'), 'generated\n');
  await assert.doesNotReject(() => verifyInputs({ cloneDir: source, rootDir: mounted }));
  await writeFile(join(mounted, 'apps/web/src/demo.js'), 'export const demo = 2;\n');
  await assert.rejects(() => verifyInputs({ cloneDir: source, rootDir: mounted }), /differs/);
  await writeFile(join(mounted, 'apps/web/src/demo.js'), 'export const demo = 1;\n');
  await writeFile(join(mounted, 'apps/web/src/untracked.js'), 'export const untracked = true;\n');
  await assert.rejects(() => verifyInputs({ cloneDir: source, rootDir: mounted }), /Untracked/);
});
