import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishRound, safeRoundId } from './design-review-publication.mjs';

async function round(root, name) { const path = join(root, name); await mkdir(path); await writeFile(join(path, 'manifest.json'), JSON.stringify({ roundId: name })); return path; }
async function testRoot(t) { const root = join(process.cwd(), '.local/design-review-tests', randomUUID()); await mkdir(root, { recursive: true }); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('publication archives previous latest before replacing it', async t => {
  const root = await testRoot(t); const archive = join(root, 'archive'); await mkdir(archive);
  const latest = await round(root, 'old-round'); const stage = await round(root, 'new-round');
  await publishRound({ stage, latest, archive });
  assert.equal(JSON.parse(await readFile(join(latest, 'manifest.json'))).roundId, 'new-round');
  assert.equal(JSON.parse(await readFile(join(archive, 'old-round', 'manifest.json'))).roundId, 'old-round');
});

test('failed publication restores the previous latest', async t => {
  const root = await testRoot(t); const archive = join(root, 'archive'); await mkdir(archive);
  const latest = await round(root, 'old-round'); const stage = await round(root, 'new-round');
  let calls = 0;
  await assert.rejects(() => publishRound({ stage, latest, archive, move: async (from, to) => { calls++; if (calls === 2) throw new Error('simulated move failure'); await rename(from, to); } }));
  assert.equal(existsSync(latest), true);
  assert.equal(JSON.parse(await readFile(join(latest, 'manifest.json'))).roundId, 'old-round');
});

test('unsafe archive IDs and collisions preserve latest', async t => {
  assert.throws(() => safeRoundId('../escape'));
  const root = await testRoot(t); const archive = join(root, 'archive'); await mkdir(archive);
  const latest = await round(root, 'old-round'); const stage = await round(root, 'new-round'); await round(archive, 'old-round');
  await assert.rejects(() => publishRound({ stage, latest, archive }));
  assert.equal(JSON.parse(await readFile(join(latest, 'manifest.json'))).roundId, 'old-round');
});
