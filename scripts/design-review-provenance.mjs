import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const root = process.cwd();
export const clone = resolve(root, '.local/design-review-publish');
export const proofPath = resolve(root, '.local/design-review/build-provenance.json');
const prefixes = ['apps/', 'packages/', 'services/', 'scripts/'];
const exact = new Set(['package.json', 'package-lock.json', '.npmrc', 'Dockerfile', 'compose.yaml', '.env.example', 'tsconfig.json']);
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
export const safeSha = sha => /^[a-f0-9]{40}$/.test(sha ?? '');
export function requireMatchingProof(proof, inputs, assets) {
  if (!safeSha(proof?.sourceSha)) throw new Error('Invalid build provenance source SHA.');
  if (inputs.sourceSha !== proof.sourceSha || inputs.inputFingerprint !== proof.inputFingerprint) throw new Error('Build provenance is stale for the canonical source or root inputs.');
  if (JSON.stringify(assets) !== JSON.stringify(proof.distHashes)) throw new Error('Built web bundle differs from build provenance.');
}

export function trackedBuildInputs(cloneDir = clone) {
  if (!existsSync(resolve(cloneDir, '.git'))) throw new Error('Missing canonical .local/design-review-publish checkout.');
  const files = git(cloneDir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(path => prefixes.some(prefix => path.startsWith(prefix)) || exact.has(path));
  return files;
}
export async function verifyInputs({ rootDir = root, cloneDir = clone } = {}) {
  const sourceSha = git(cloneDir, ['rev-parse', 'HEAD']); if (!safeSha(sourceSha)) throw new Error('Invalid canonical source SHA.');
  const files = trackedBuildInputs(cloneDir); const inputFileHashes = {};
  for (const path of files) {
    const expectedBlob = git(cloneDir, ['rev-parse', `HEAD:${path}`]); const target = resolve(rootDir, path);
    if (!existsSync(target) || git(rootDir, ['hash-object', '--no-filters', target]) !== expectedBlob) throw new Error(`Root build input differs from canonical source: ${path}`);
    inputFileHashes[path] = hash(await readFile(target));
  }
  const untracked = execFileSync('git', ['--git-dir', resolve(cloneDir, '.git'), '--work-tree', rootDir, 'status', '--porcelain', '--untracked-files=all', '--', 'apps', 'packages', 'services', 'scripts'], { encoding: 'utf8' })
    .split('\n').filter(line => line.startsWith('?? ')).map(line => line.slice(3));
  if (untracked.length) throw new Error(`Untracked root build input: ${untracked[0]}`);
  return { sourceSha, inputFiles: inputFileHashes, inputFingerprint: hash(Object.entries(inputFileHashes).map(([path, sha]) => `${path}\0${sha}`).join('\n')) };
}
export async function distHashes() {
  const dist = resolve(root, 'apps/web/dist'); if (!existsSync(dist)) throw new Error('Missing apps/web/dist; run the explicit build command.');
  const names = execFileSync('find', [dist, '-type', 'f', '-printf', '%P\n'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  if (!names.includes('index.html')) throw new Error('Built index.html is missing.');
  const hashes = {}; for (const name of names) hashes[name] = hash(await readFile(resolve(dist, name)));
  return hashes;
}
export async function writeProof({ containerId, nodeVersion, expectedSourceSha }) {
  const inputs = await verifyInputs(); const assets = await distHashes();
  if (expectedSourceSha && inputs.sourceSha !== expectedSourceSha) throw new Error('Canonical source changed during build.');
  const workingTreeDirty = execFileSync('git', ['--git-dir', resolve(clone, '.git'), '--work-tree', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const proof = { version: 1, sourceSha: inputs.sourceSha, inputFingerprint: inputs.inputFingerprint, inputFileHashes: inputs.inputFiles, distHashes: assets, builtAt: new Date().toISOString(), containerId, nodeVersion, workingTreeDirty };
  await mkdir(resolve(root, '.local/design-review'), { recursive: true }); await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`); return proof;
}
export async function currentProof() {
  if (!existsSync(proofPath)) throw new Error('Missing build provenance; run bash scripts/design-review-build.sh first.');
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const inputs = await verifyInputs(); const assets = await distHashes(); requireMatchingProof(proof, inputs, assets);
  return { ...proof, workingTreeDirty: execFileSync('git', ['--git-dir', resolve(clone, '.git'), '--work-tree', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0 };
}
if (process.argv[2] === 'verify') process.stdout.write(`${JSON.stringify(await currentProof())}\n`);
