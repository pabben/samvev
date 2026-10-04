import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, rename } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { currentProof, localRoot, root } from './design-review-provenance.mjs';

const expectedScreens = new Map([
  ['desktop-1920-light.png', [1920, 1080, 'light', false]],
  ['desktop-1920-dark.png', [1920, 1080, 'dark', false]],
  ['mobile-light.png', [390, 844, 'light', false]],
  ['mobile-dark.png', [390, 844, 'dark', false]],
  ['ipad-portrait-light.png', [820, 1180, 'light', false]],
  ['ipad-portrait-dark.png', [820, 1180, 'dark', false]],
  ['ipad-landscape-light.png', [1180, 820, 'light', false]],
  ['ipad-landscape-dark.png', [1180, 820, 'dark', false]],
  ['shelly-1280-light.png', [1280, 752, 'light', false]],
  ['shelly-1280-dark.png', [1280, 752, 'dark', false]],
  ['mobile-light-full.png', [390, null, 'light', true]],
  ['mobile-dark-full.png', [390, null, 'dark', true]],
  ['desktop-1920-light-full.png', [1920, null, 'light', true]],
  ['desktop-1920-dark-full.png', [1920, null, 'dark', true]],
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function safeRoundId(roundId) {
  if (typeof roundId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(roundId)) throw new Error('Unsafe design-review round ID.');
  return roundId;
}

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('Screenshot is not a PNG with an IHDR header.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export async function validateStagedRound({ stage, proof }) {
  if (dirname(resolve(stage)) !== resolve(localRoot) || !existsSync(stage)) throw new Error('Capture staging directory is outside the ignored review staging root.');
  const names = (await readdir(stage)).sort();
  const expectedFiles = ['manifest.json', ...expectedScreens.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedFiles)) throw new Error('Staged round must contain exactly manifest.json and the fourteen review PNGs.');
  const manifest = JSON.parse(await readFile(resolve(stage, 'manifest.json'), 'utf8'));
  safeRoundId(manifest.roundId);
  if (manifest.commitSha !== proof.sourceSha || manifest.provenance?.sourceSha !== proof.sourceSha || manifest.provenance?.inputFingerprint !== proof.inputFingerprint) throw new Error('Staged manifest source does not match the current canonical proof.');
  if (manifest.provenance?.runtimeFingerprint !== proof.runtimeFingerprint || manifest.provenance?.migrationFingerprint !== proof.migrationFingerprint) throw new Error('Staged manifest runtime or migrations do not match the current proof.');
  if (JSON.stringify(manifest.provenance?.distHashes) !== JSON.stringify(proof.distHashes)) throw new Error('Staged manifest bundle hashes do not match the current proof.');
  if (manifest.source?.origin !== proof.runtime.after.app.publicOrigin || manifest.source?.syntheticDemo !== true) throw new Error('Staged manifest does not identify the verified synthetic QA origin.');
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length !== expectedScreens.size) throw new Error('Staged manifest must describe fourteen screenshots.');
  const seen = new Set();
  for (const screenshot of manifest.screenshots) {
    const expected = expectedScreens.get(screenshot.filename);
    if (!expected || seen.has(screenshot.filename)) throw new Error(`Unexpected or duplicate screenshot ${screenshot.filename}.`);
    seen.add(screenshot.filename);
    const [width, height, theme, fullPage] = expected;
    if (screenshot.commitSha !== proof.sourceSha || screenshot.viewport?.width !== width || screenshot.theme !== theme || screenshot.fullPage !== fullPage) throw new Error(`Screenshot metadata does not match ${screenshot.filename}.`);
    if (!fullPage && screenshot.viewport.height !== height) throw new Error(`Screenshot viewport does not match ${screenshot.filename}.`);
    if (screenshot.surface !== 'member-home' || screenshot.path !== '/' || screenshot.locale !== 'nb') throw new Error(`Screenshot surface metadata does not match ${screenshot.filename}.`);
    if (!Array.isArray(screenshot.uiVerification?.personIds) || screenshot.uiVerification.personIds.length < 1) throw new Error(`Screenshot lacks semantic Home-person verification: ${screenshot.filename}.`);
    const bytes = await readFile(resolve(stage, screenshot.filename));
    const actual = pngSize(bytes);
    if (actual.width !== width || (!fullPage && actual.height !== height) || (fullPage && actual.height < 1)) throw new Error(`PNG dimensions do not match ${screenshot.filename}.`);
    if (sha256(bytes) !== screenshot.sha256) throw new Error(`PNG hash does not match ${screenshot.filename}.`);
  }
  if (seen.size !== expectedScreens.size) throw new Error('Staged screenshot set is incomplete.');
  return manifest;
}

export async function publishRound({ stage, latest, archive, exists = existsSync, read = readFile, move = rename }) {
  safeRoundId(basename(stage));
  if (resolve(stage) === resolve(latest) || !exists(stage)) throw new Error('Validated staging directory is missing.');
  let archived;
  if (exists(latest)) {
    const previous = JSON.parse(await read(resolve(latest, 'manifest.json'), 'utf8'));
    const previousId = safeRoundId(previous.roundId);
    archived = resolve(archive, previousId);
    if (exists(archived)) throw new Error(`Archive collision for ${previousId}.`);
    await move(latest, archived);
  }
  try {
    await move(stage, latest);
  } catch (error) {
    if (archived) await move(archived, latest);
    throw error;
  }
}

export async function finalizeStagedRound(stage) {
  // Validate stage bytes first, then recalculate all host-side source, runtime,
  // migration and dist evidence immediately before the atomic publication.
  const initialProof = await currentProof();
  await validateStagedRound({ stage, proof: initialProof });
  const finalProof = await currentProof();
  if (initialProof.runtimeFingerprint !== finalProof.runtimeFingerprint || initialProof.inputFingerprint !== finalProof.inputFingerprint || JSON.stringify(initialProof.distHashes) !== JSON.stringify(finalProof.distHashes)) throw new Error('Review inputs changed during final host verification.');
  const reviewRoot = resolve(root, 'docs/design/review');
  await publishRound({ stage, latest: resolve(reviewRoot, 'latest'), archive: resolve(reviewRoot, 'archive') });
}

if (process.argv[2] === 'finalize') {
  const stage = resolve(process.argv[3] ?? '');
  await finalizeStagedRound(stage);
  process.stdout.write('Published host-verified design review round.\n');
}
