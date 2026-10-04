import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const root = process.cwd();
export const clone = resolve(root, '.local/design-review-publish');
export const localRoot = resolve(root, '.local/design-review');
export const proofPath = resolve(localRoot, 'build-provenance.json');
export const runtimeProofPath = resolve(localRoot, 'runtime-provenance.json');
const prefixes = ['apps/', 'packages/', 'services/', 'scripts/'];
const exact = new Set(['package.json', 'package-lock.json', '.npmrc', 'Dockerfile', 'compose.yaml', '.env.example', 'tsconfig.json']);
const runtimeServices = { app: 'samvev-m1-qa-app-1', worker: 'samvev-m1-qa-worker-1', db: 'samvev-m1-qa-db-1' };
const expectedDatabaseUrl = 'postgresql://samvev_qa:synthetic-qa-data-only@qa-db:5432/samvev_qa';
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
export const safeSha = sha => /^[a-f0-9]{40}$/.test(sha ?? '');
export const isRuntimeLeafCommand = (args, sourceFile) => /(^|\/)node$/.test(args?.[0] ?? '') && args.includes('--import') && args.some(value => /\/tsx\/dist\/loader\.mjs$/.test(value)) && args.includes(sourceFile);

export function requireMatchingProof(proof, inputs, assets, runtime) {
  if (!safeSha(proof?.sourceSha)) throw new Error('Invalid build provenance source SHA.');
  if (inputs.sourceSha !== proof.sourceSha || inputs.inputFingerprint !== proof.inputFingerprint) throw new Error('Build provenance is stale for the canonical source or root inputs.');
  if (JSON.stringify(assets) !== JSON.stringify(proof.distHashes)) throw new Error('Built web bundle differs from build provenance.');
  if (!runtime || proof.runtimeFingerprint !== runtime.runtimeFingerprint) throw new Error('Build provenance is stale for the verified QA runtime.');
}

export function trackedBuildInputs(cloneDir = clone) {
  if (!existsSync(resolve(cloneDir, '.git'))) throw new Error('Missing canonical .local/design-review-publish checkout.');
  return git(cloneDir, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(path => prefixes.some(prefix => path.startsWith(prefix)) || exact.has(path));
}

export async function verifyInputs({ rootDir = root, cloneDir = clone } = {}) {
  const sourceSha = git(cloneDir, ['rev-parse', 'HEAD']);
  if (!safeSha(sourceSha)) throw new Error('Invalid canonical source SHA.');
  const files = trackedBuildInputs(cloneDir);
  const rootHashes = {};
  const cloneHashes = {};
  for (const path of files) {
    const expectedBlob = git(cloneDir, ['rev-parse', `HEAD:${path}`]);
    const target = resolve(rootDir, path);
    if (!existsSync(target) || git(rootDir, ['hash-object', '--no-filters', target]) !== expectedBlob) throw new Error(`Root build input differs from canonical source: ${path}`);
    rootHashes[path] = hash(await readFile(target));
    cloneHashes[path] = hash(await readFile(resolve(cloneDir, path)));
    if (rootHashes[path] !== cloneHashes[path]) throw new Error(`Root and canonical source bytes differ: ${path}`);
  }
  const untracked = execFileSync('git', ['--git-dir', resolve(cloneDir, '.git'), '--work-tree', rootDir, 'status', '--porcelain', '--untracked-files=all', '--', 'apps', 'packages', 'services', 'scripts'], { encoding: 'utf8' })
    .split('\n').filter(line => line.startsWith('?? ')).map(line => line.slice(3));
  if (untracked.length) throw new Error(`Untracked root build input: ${untracked[0]}`);
  const rootSourceFingerprint = hash(Object.entries(rootHashes).map(([path, sha]) => `${path}\0${sha}`).join('\n'));
  const cloneSourceFingerprint = hash(Object.entries(cloneHashes).map(([path, sha]) => `${path}\0${sha}`).join('\n'));
  if (rootSourceFingerprint !== cloneSourceFingerprint) throw new Error('Root and canonical source fingerprints differ.');
  return { sourceSha, inputFiles: rootHashes, inputFingerprint: rootSourceFingerprint, rootSourceFingerprint, cloneSourceFingerprint };
}

export async function migrationManifest({ rootDir = root, cloneDir = clone } = {}) {
  const prefix = 'services/api/migrations/';
  const files = trackedBuildInputs(cloneDir).filter(path => path.startsWith(prefix) && path.endsWith('.sql')).sort();
  if (!files.length) throw new Error('Canonical migration set is empty.');
  const hashes = {};
  for (const path of files) {
    const rootBytes = await readFile(resolve(rootDir, path));
    const cloneBytes = await readFile(resolve(cloneDir, path));
    const rootHash = hash(rootBytes);
    if (rootHash !== hash(cloneBytes)) throw new Error(`Migration differs from canonical source: ${path}`);
    hashes[path] = rootHash;
  }
  return { files: hashes, fingerprint: hash(Object.entries(hashes).map(([path, sha]) => `${path}\0${sha}`).join('\n')) };
}

function envObject(values = []) {
  return Object.fromEntries(values.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
}
function requireMount(container, destination, expected) {
  const mount = container.Mounts.find(item => item.Destination === destination);
  if (!mount || (expected.type && mount.Type !== expected.type) || (expected.source && mount.Source !== expected.source) || (expected.name && mount.Name !== expected.name) || mount.RW !== expected.rw) throw new Error(`Unsafe mount for ${container.Name}:${destination}.`);
  return { type: mount.Type, source: mount.Source, name: mount.Name ?? null, destination, readOnly: !mount.RW };
}
function inspectContainer(name, service) {
  const value = JSON.parse(docker(['inspect', name]))[0];
  if (!value || value.Name !== `/${name}`) throw new Error(`Missing exact QA container ${name}.`);
  const labels = value.Config.Labels ?? {};
  if (labels['com.docker.compose.project'] !== 'samvev-m1' || labels['com.docker.compose.service'] !== service) throw new Error(`Container ${name} is not the exact samvev-m1 ${service} service.`);
  if (value.State?.Health?.Status !== 'healthy') throw new Error(`QA service ${service} is not healthy.`);
  return value;
}
function leafProcess(container, sourceFile) {
  const program = `const fs=require('node:fs');const self=process.pid;const source=${JSON.stringify(sourceFile)};const out=[];for(const name of fs.readdirSync('/proc')){if(!/^\\d+$/.test(name)||Number(name)===self)continue;try{const args=fs.readFileSync('/proc/'+name+'/cmdline').toString().split('\\0').filter(Boolean);if(!/(^|\\/)node$/.test(args[0]||'')||!args.includes('--import')||!args.some(v=>/\\/tsx\\/dist\\/loader\\.mjs$/.test(v))||!args.includes(source))continue;const stat=fs.readFileSync('/proc/'+name+'/stat','utf8');const end=stat.lastIndexOf(')');const fields=stat.slice(end+2).split(' ');out.push({pid:Number(name),startTimeTicks:fields[19],cmdline:args});}catch{}}if(out.length!==1)throw new Error('Expected one leaf process for ${sourceFile}, got '+out.length);process.stdout.write(JSON.stringify(out[0]));`;
  return JSON.parse(docker(['exec', container, 'node', '-e', program]));
}
function safeContainer(value, service, sourceFile) {
  const env = envObject(value.Config.Env);
  if (env.DATABASE_URL !== expectedDatabaseUrl) throw new Error(`${service} is not connected to the synthetic QA database.`);
  if (service === 'qa-app') {
    if (env.SAMVEV_DEMO_MODE !== 'true' || env.HOST !== '0.0.0.0' || env.PORT !== '4173') throw new Error('qa-app does not have the exact synthetic QA runtime environment.');
    if (env.SAMVEV_PUBLIC_ORIGIN !== 'http://192.168.0.220:4173') throw new Error('qa-app does not preserve the trusted LAN public origin.');
    const bindings = value.HostConfig?.PortBindings?.['4173/tcp'];
    if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '192.168.0.220' || bindings[0].HostPort !== '4173') throw new Error('qa-app does not preserve the trusted LAN port binding.');
  }
  if (service === 'qa-worker' && env.SAMVEV_WORKER_HEALTH_FILE !== '/tmp/samvev-qa-worker-health.json') throw new Error('qa-worker has an unexpected health-file configuration.');
  const mounts = {
    workspace: requireMount(value, '/workspace', { type: 'bind', source: root, rw: true }),
    git: requireMount(value, '/workspace/.git', { type: 'bind', source: resolve(root, '.git'), rw: false }),
    nodeModules: requireMount(value, '/workspace/node_modules', { type: 'volume', name: 'samvev-m1-workspace-node-modules', rw: true }),
  };
  const portBinding = service === 'qa-app' ? value.HostConfig.PortBindings['4173/tcp'][0] : null;
  const summary = { name: value.Name.slice(1), service, containerId: value.Id, imageId: value.Image, imageReference: value.Config.Image, startedAt: value.State.StartedAt, restartCount: value.RestartCount, command: [...(value.Config.Entrypoint ?? []), ...(value.Config.Cmd ?? [])], databaseUrl: env.DATABASE_URL, publicOrigin: env.SAMVEV_PUBLIC_ORIGIN ?? null, demoMode: env.SAMVEV_DEMO_MODE ?? null, portBinding, mounts, leaf: leafProcess(value.Name.slice(1), sourceFile) };
  return { ...summary, configFingerprint: hash(stable({ imageId: summary.imageId, imageReference: summary.imageReference, command: summary.command, databaseUrl: summary.databaseUrl, publicOrigin: summary.publicOrigin, demoMode: summary.demoMode, portBinding, mounts })) };
}

export function requireMatchingRuntimeProof(proof, current, inputs, migrations) {
  if (!safeSha(proof?.sourceSha) || proof.sourceSha !== inputs.sourceSha || proof.inputFingerprint !== inputs.inputFingerprint) throw new Error('QA runtime proof is stale for the canonical source.');
  if (proof.migrationFingerprint !== migrations.fingerprint || JSON.stringify(proof.migrationFiles) !== JSON.stringify(migrations.files)) throw new Error('QA runtime proof is stale for the canonical migration set.');
  if (JSON.stringify(current.appliedMigrations) !== JSON.stringify(migrations.files)) throw new Error('QA database migrations do not exactly match the canonical migration set.');
  if (proof.runtimeFingerprint !== current.runtimeFingerprint) throw new Error('QA runtime containers or processes changed after runtime preparation.');
}

export function requireRuntimeTransition(before, after) {
  for (const key of ['app', 'worker']) {
    if (before[key].containerId !== after[key].containerId || before[key].imageId !== after[key].imageId || before[key].configFingerprint !== after[key].configFingerprint) throw new Error(`QA ${key} container configuration changed during restart.`);
    if (before[key].startedAt === after[key].startedAt) throw new Error(`QA ${key} was not restarted.`);
  }
  if (before.db.containerId !== after.db.containerId || before.db.startedAt !== after.db.startedAt || before.db.restartCount !== after.db.restartCount) throw new Error('QA database was restarted or replaced.');
  if (before.app.publicOrigin !== after.app.publicOrigin) throw new Error('QA LAN/public origin changed during runtime preparation.');
  if (before.syntheticDatabase.fingerprint !== after.syntheticDatabase.fingerprint) throw new Error('Synthetic QA database identity changed during runtime preparation.');
}

export function captureRuntimeState() {
  const app = safeContainer(inspectContainer(runtimeServices.app, 'qa-app'), 'qa-app', 'services/api/src/server.ts');
  const worker = safeContainer(inspectContainer(runtimeServices.worker, 'qa-worker'), 'qa-worker', 'services/worker/src/index.ts');
  const database = inspectContainer(runtimeServices.db, 'qa-db');
  const dbEnv = envObject(database.Config.Env);
  if (dbEnv.POSTGRES_DB !== 'samvev_qa' || dbEnv.POSTGRES_USER !== 'samvev_qa' || dbEnv.POSTGRES_PASSWORD !== 'synthetic-qa-data-only') throw new Error('qa-db does not have the exact synthetic QA identity.');
  const dbMount = requireMount(database, '/var/lib/postgresql/data', { type: 'volume', name: 'samvev-m1-qa-postgres-data', rw: true });
  const db = { name: runtimeServices.db, service: 'qa-db', containerId: database.Id, imageId: database.Image, imageReference: database.Config.Image, startedAt: database.State.StartedAt, restartCount: database.RestartCount, mount: dbMount };
  const databaseCheck = docker(['exec', runtimeServices.db, 'psql', '-U', 'samvev_qa', '-d', 'samvev_qa', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT current_database(),current_user,(SELECT count(*) FROM installations WHERE singleton AND demo_mode),(SELECT count(*) FROM households WHERE data_kind='demo'),(SELECT count(*) FROM households WHERE data_kind<>'demo'),(SELECT count(DISTINCT a.id) FROM accounts a JOIN memberships m ON m.account_id=a.id JOIN households h ON h.id=m.household_id WHERE h.data_kind='demo' AND a.disabled_at IS NULL AND a.email_normalized='admin@demo.invalid')"]);
  const [databaseName, databaseUser, demoInstallations, demoHouseholds, nonDemoHouseholds, activeDemoAdmins] = databaseCheck.split('|');
  if (databaseName !== 'samvev_qa' || databaseUser !== 'samvev_qa' || demoInstallations !== '1' || !/^\d+$/.test(demoHouseholds) || Number(demoHouseholds) < 1 || nonDemoHouseholds !== '0' || activeDemoAdmins !== '1') throw new Error('Database is not the populated synthetic-only QA database with one active demo administrator.');
  const syntheticDatabase = { databaseName, databaseUser, demoInstallationCount: Number(demoInstallations), demoHouseholdCount: Number(demoHouseholds), nonDemoHouseholdCount: Number(nonDemoHouseholds), activeDemoAdminCount: Number(activeDemoAdmins) };
  syntheticDatabase.fingerprint = hash(stable(syntheticDatabase));
  const migrationRows = docker(['exec', runtimeServices.db, 'psql', '-U', 'samvev_qa', '-d', 'samvev_qa', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT version,checksum FROM schema_migrations ORDER BY version']);
  const appliedMigrations = Object.fromEntries(migrationRows.split('\n').filter(Boolean).map(line => { const [version, checksum] = line.split('|'); if (!/^\d+.*\.sql$/.test(version) || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Invalid applied migration evidence.'); return [`services/api/migrations/${version}`, checksum]; }));
  const state = { app, worker, db, syntheticDatabase, appliedMigrations };
  return { ...state, runtimeFingerprint: hash(stable(state)) };
}

export async function writeRuntimeProof({ before, expectedSourceSha }) {
  const inputs = await verifyInputs();
  if (inputs.sourceSha !== expectedSourceSha) throw new Error('Canonical source changed during QA runtime preparation.');
  const migrations = await migrationManifest();
  const after = captureRuntimeState();
  requireRuntimeTransition(before, after);
  if (JSON.stringify(after.appliedMigrations) !== JSON.stringify(migrations.files)) throw new Error('QA database migrations do not exactly match the canonical migration set after migration.');
  const proof = { version: 2, sourceSha: inputs.sourceSha, inputFingerprint: inputs.inputFingerprint, rootSourceFingerprint: inputs.rootSourceFingerprint, cloneSourceFingerprint: inputs.cloneSourceFingerprint, migrationFingerprint: migrations.fingerprint, migrationFiles: migrations.files, preparedAt: new Date().toISOString(), requestedRestart: ['qa-app', 'qa-worker'], before, after, runtimeFingerprint: after.runtimeFingerprint };
  await mkdir(localRoot, { recursive: true });
  await writeFile(runtimeProofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  return proof;
}

export async function currentRuntimeProof() {
  if (!existsSync(runtimeProofPath)) throw new Error('Missing QA runtime provenance; run bash scripts/design-review-runtime.sh first.');
  const proof = JSON.parse(await readFile(runtimeProofPath, 'utf8'));
  const inputs = await verifyInputs();
  const migrations = await migrationManifest();
  const current = captureRuntimeState();
  requireMatchingRuntimeProof(proof, current, inputs, migrations);
  return proof;
}

export async function distHashes() {
  const dist = resolve(root, 'apps/web/dist');
  if (!existsSync(dist)) throw new Error('Missing apps/web/dist; run the explicit build command.');
  const names = execFileSync('find', [dist, '-type', 'f', '-printf', '%P\n'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
  if (!names.includes('index.html')) throw new Error('Built index.html is missing.');
  const hashes = {};
  for (const name of names) hashes[name] = hash(await readFile(resolve(dist, name)));
  return hashes;
}

export async function writeProof({ containerId, nodeVersion, expectedSourceSha }) {
  const runtime = await currentRuntimeProof();
  const inputs = await verifyInputs();
  const assets = await distHashes();
  if (expectedSourceSha && inputs.sourceSha !== expectedSourceSha) throw new Error('Canonical source changed during build.');
  const workingTreeDirty = execFileSync('git', ['--git-dir', resolve(clone, '.git'), '--work-tree', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  const proof = { version: 2, sourceSha: inputs.sourceSha, inputFingerprint: inputs.inputFingerprint, rootSourceFingerprint: inputs.rootSourceFingerprint, cloneSourceFingerprint: inputs.cloneSourceFingerprint, inputFileHashes: inputs.inputFiles, distHashes: assets, builtAt: new Date().toISOString(), containerId, nodeVersion, runtimeFingerprint: runtime.runtimeFingerprint, migrationFingerprint: runtime.migrationFingerprint, workingTreeDirty };
  await mkdir(localRoot, { recursive: true });
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  return proof;
}

export async function currentProof() {
  if (!existsSync(proofPath)) throw new Error('Missing build provenance; run bash scripts/design-review-build.sh first.');
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const runtime = await currentRuntimeProof();
  const inputs = await verifyInputs();
  const assets = await distHashes();
  requireMatchingProof(proof, inputs, assets, runtime);
  return { ...proof, runtime, workingTreeDirty: execFileSync('git', ['--git-dir', resolve(clone, '.git'), '--work-tree', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0 };
}

const command = process.argv[2];
if (command === 'verify-inputs') process.stdout.write(`${JSON.stringify(await verifyInputs())}\n`);
if (command === 'runtime-snapshot') process.stdout.write(`${JSON.stringify(captureRuntimeState())}\n`);
if (command === 'write-runtime') {
  const before = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'));
  process.stdout.write(`${JSON.stringify(await writeRuntimeProof({ before, expectedSourceSha: process.argv[4] }))}\n`);
}
if (command === 'verify-runtime') process.stdout.write(`${JSON.stringify(await currentRuntimeProof())}\n`);
if (command === 'verify') process.stdout.write(`${JSON.stringify(await currentProof())}\n`);
