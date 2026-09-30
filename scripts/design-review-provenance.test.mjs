import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireMatchingProof, safeSha, verifyInputs } from './design-review-provenance.mjs';

const sha = 'a'.repeat(40);
const inputs = { sourceSha: sha, inputFingerprint: 'inputs' };
const assets = { 'index.html': 'index', 'assets/app.js': 'bundle' };
const proof = { sourceSha: sha, inputFingerprint: 'inputs', distHashes: assets };
test('accepts an exact committed-input and built-bundle proof', () => assert.doesNotThrow(() => requireMatchingProof(proof, inputs, assets)));
test('rejects changed build input and stale served bundle', () => {
  assert.throws(() => requireMatchingProof(proof, { ...inputs, inputFingerprint: 'edited' }, assets), /stale/);
  assert.throws(() => requireMatchingProof(proof, inputs, { ...assets, 'assets/app.js': 'stale' }), /bundle/);
});
test('rejects an unsafe provenance SHA', () => {
  assert.equal(safeSha('../not-a-commit'), false);
  assert.throws(() => requireMatchingProof({ ...proof, sourceSha: 'bad' }, inputs, assets), /Invalid/);
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
