import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { publishRound, safeRoundId, validateStagedRound } from './design-review-publication.mjs';

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

test('host stage validation requires the exact fourteen PNG dimensions and hashes', async t => {
  const stage = join(process.cwd(), '.local/design-review', `capture-test-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  t.after(() => rm(stage, { recursive: true, force: true }));
  const definitions = [
    ['desktop-1920',1920,1080],['mobile',390,844],['ipad-portrait',820,1180],['ipad-landscape',1180,820],['shelly-1280',1280,752],
  ];
  const screenshots = [];
  for (const theme of ['light','dark']) {
    for (const [surface,width,height] of definitions) {
      const filename = `${surface}-${theme}.png`;
      const bytes = fakePng(width,height);
      await writeFile(join(stage,filename),bytes);
      screenshots.push(screen(filename,width,height,theme,false,bytes));
    }
    for (const [surface,width,height] of [['mobile',390,900],['desktop-1920',1920,1400]]) {
      const filename = `${surface}-${theme}-full.png`;
      const bytes = fakePng(width,height);
      await writeFile(join(stage,filename),bytes);
      screenshots.push(screen(filename,width,height,theme,true,bytes));
    }
  }
  const proof = { sourceSha:'a'.repeat(40),inputFingerprint:'inputs',runtimeFingerprint:'runtime',migrationFingerprint:'migrations',distHashes:{'index.html':'index'},runtime:{after:{app:{publicOrigin:'http://192.168.0.220:4173'}}} };
  const manifest = { roundId:'round-test',commitSha:proof.sourceSha,source:{origin:'http://192.168.0.220:4173',syntheticDemo:true},provenance:{sourceSha:proof.sourceSha,inputFingerprint:'inputs',runtimeFingerprint:'runtime',migrationFingerprint:'migrations',distHashes:proof.distHashes},screenshots };
  await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest));
  await assert.doesNotReject(() => validateStagedRound({stage,proof}));
  manifest.screenshots[0].sha256='0'.repeat(64);
  await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(() => validateStagedRound({stage,proof}),/PNG hash/);
});

function fakePng(width,height) {
  const bytes=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.write('IHDR',12,'ascii');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;
}
function screen(filename,width,height,theme,fullPage,bytes) {
  return {filename,commitSha:'a'.repeat(40),viewport:{width,height:fullPage?(filename.startsWith('mobile')?844:1080):height},theme,fullPage,surface:'member-home',path:'/',locale:'nb',uiVerification:{personIds:['synthetic-person']},sha256:createHash('sha256').update(bytes).digest('hex')};
}
