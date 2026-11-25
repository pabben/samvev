import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);
const root = process.cwd();
const uuid = '11111111-1111-4111-8111-111111111111';

test('readiness check discovers only a healthy immutable public runtime and does not import', async t => {
  await mkdir(join(root, '.local/design-review-tests'), { recursive: true });
  const temporary = await mkdtemp(join(root, '.local/design-review-tests/chatgpt-runtime-'));
  const fakeBin = join(temporary, 'bin');
  const vault = join(root, '.local', `chatgpt-import-test-${Date.now()}-vault`);
  await mkdir(fakeBin, { recursive: true });
  await writeFile(vault, 'synthetic', { mode: 0o600 });
  t.after(async () => { await rm(temporary, { recursive: true, force: true }); await rm(vault, { force: true }); });
  const inspection = [{
    Config: { Image: 'samvev-m1/runtime:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', User: 'node', Labels: { 'com.docker.compose.project': 'samvev-m1', 'com.docker.compose.service': 'app', 'com.docker.compose.project.working_dir': root }, Env: ['DATABASE_URL=postgresql://private@db/private', 'SAMVEV_AI_MASTER_KEY_FILE=/run/secrets/samvev-ai-master-key'] },
    State: { Running: true, Health: { Status: 'healthy' } },
    Mounts: [{ Type: 'bind', Source: vault, Destination: '/run/secrets/samvev-ai-master-key', RW: false }],
    NetworkSettings: { Networks: { 'samvev-m1_default': {} } },
  }];
  const docker = `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' \"$*\" >>${JSON.stringify(join(temporary, 'docker.calls'))}\nif [[ \"$1\" == ps ]]; then echo fake-public-app; exit 0; fi\nif [[ \"$1\" == inspect ]]; then printf '%s' ${JSON.stringify(JSON.stringify(inspection))}; exit 0; fi\necho unexpected docker invocation >&2; exit 9\n`;
  const dockerPath = join(fakeBin, 'docker');
  await writeFile(dockerPath, docker, { mode: 0o700 });
  await chmod(dockerPath, 0o700);
  const nodeCalls = join(temporary, 'node.calls');
  await writeFile(join(fakeBin, 'node'), `#!/usr/bin/env bash\nprintf 'host node was called\\n' >>${JSON.stringify(nodeCalls)}\nexit 127\n`, { mode: 0o700 });
  const result = await run('bash', ['scripts/chatgpt-import-runtime.sh', '--household', uuid, '--owner-account', uuid, '--check'], { cwd: root, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  assert.match(result.stdout, /readiness verified/);
  assert.match(result.stdout, /no credential was read or imported/);
  const calls = await readFile(join(temporary, 'docker.calls'), 'utf8');
  assert.match(calls, /^ps /m);
  assert.match(calls, /^inspect /m);
  assert.doesNotMatch(calls, /^run /m);
  await assert.rejects(readFile(nodeCalls, 'utf8'), { code: 'ENOENT' });
});

test('readiness rejects unsafe runtime inspection without falling back to host Node.js', async t => {
  await mkdir(join(root, '.local/design-review-tests'), { recursive: true });
  const temporary = await mkdtemp(join(root, '.local/design-review-tests/chatgpt-runtime-unsafe-'));
  const fakeBin = join(temporary, 'bin');
  const vault = join(root, '.local', `chatgpt-import-test-${Date.now()}-vault`);
  await mkdir(fakeBin, { recursive: true });
  await writeFile(vault, 'synthetic', { mode: 0o600 });
  t.after(async () => { await rm(temporary, { recursive: true, force: true }); await rm(vault, { force: true }); });
  const base = [{
    Config: { Image: 'samvev-m1/runtime:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', User: 'node', Labels: { 'com.docker.compose.project': 'samvev-m1', 'com.docker.compose.service': 'app', 'com.docker.compose.project.working_dir': root }, Env: ['DATABASE_URL=postgresql://private@db/private', 'SAMVEV_AI_MASTER_KEY_FILE=/run/secrets/samvev-ai-master-key'] },
    State: { Running: true, Health: { Status: 'healthy' } },
    Mounts: [{ Type: 'bind', Source: vault, Destination: '/run/secrets/samvev-ai-master-key', RW: false }],
    NetworkSettings: { Networks: { 'samvev-m1_default': {} } },
  }];
  const inspectionPath = join(temporary, 'inspection.json');
  const docker = `#!/usr/bin/env bash\nset -eu\nif [[ "$1" == ps ]]; then echo fake-public-app; exit 0; fi\nif [[ "$1" == inspect ]]; then cat ${JSON.stringify(inspectionPath)}; exit 0; fi\nexit 9\n`;
  await writeFile(join(fakeBin, 'docker'), docker, { mode: 0o700 });
  const nodeCalls = join(temporary, 'node.calls');
  await writeFile(join(fakeBin, 'node'), `#!/usr/bin/env bash\nprintf 'host node was called\\n' >>${JSON.stringify(nodeCalls)}\nexit 127\n`, { mode: 0o700 });

  const unsafeCases = [
    ['unhealthy runtime', value => { value[0].State.Health.Status = 'unhealthy'; }, /Public app is not healthy/],
    ['mutable image', value => { value[0].Config.Image = 'samvev-m1/runtime:latest'; }, /immutable Samvev runtime image/],
    ['writable vault', value => { value[0].Mounts[0].RW = true; }, /required read-only AI vault mount/],
    ['vault outside local storage', value => { value[0].Mounts[0].Source = '/tmp/unsafe-vault'; }, /outside protected Samvev local storage/],
    ['multiple networks', value => { value[0].NetworkSettings.Networks.other = {}; }, /exactly one project network/],
    ['root runtime user', value => { value[0].Config.User = 'root'; }, /expected unprivileged user/],
  ];
  for (const [name, mutate, expected] of unsafeCases) {
    const inspection = structuredClone(base);
    mutate(inspection);
    await writeFile(inspectionPath, JSON.stringify(inspection), { mode: 0o600 });
    await assert.rejects(
      run('bash', ['scripts/chatgpt-import-runtime.sh', '--household', uuid, '--owner-account', uuid, '--check'], { cwd: root, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } }),
      error => {
        assert.match(error.stderr, expected, name);
        return true;
      },
    );
  }
  await assert.rejects(readFile(nodeCalls, 'utf8'), { code: 'ENOENT' });
});

test('import builds the protected runtime env and invokes only container Node.js', async t => {
  await mkdir(join(root, '.local/design-review-tests'), { recursive: true });
  const temporary = await mkdtemp(join(root, '.local/design-review-tests/chatgpt-runtime-import-'));
  const fakeBin = join(temporary, 'bin');
  const vault = join(root, '.local', `chatgpt-import-test-${Date.now()}-vault`);
  const credential = join(temporary, 'credential.json');
  await mkdir(fakeBin, { recursive: true });
  await writeFile(vault, 'synthetic', { mode: 0o600 });
  await writeFile(credential, '{"synthetic":true}\n', { mode: 0o600 });
  t.after(async () => { await rm(temporary, { recursive: true, force: true }); await rm(vault, { force: true }); });
  const inspection = [{
    Config: { Image: 'samvev-m1/runtime:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', User: '1000:1000', Labels: { 'com.docker.compose.project': 'samvev-m1', 'com.docker.compose.service': 'app', 'com.docker.compose.project.working_dir': root }, Env: ['DATABASE_URL=postgresql://synthetic@db/synthetic', 'SAMVEV_AI_MASTER_KEY_FILE=/run/secrets/samvev-ai-master-key'] },
    State: { Running: true, Health: { Status: 'healthy' } },
    Mounts: [{ Type: 'bind', Source: vault, Destination: '/run/secrets/samvev-ai-master-key', RW: false }],
    NetworkSettings: { Networks: { 'samvev-m1_default': {} } },
  }];
  const docker = `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >>${JSON.stringify(join(temporary, 'docker.calls'))}
if [[ "$1" == ps ]]; then echo fake-public-app; exit 0; fi
if [[ "$1" == inspect ]]; then printf '%s' ${JSON.stringify(JSON.stringify(inspection))}; exit 0; fi
if [[ "$1" == run ]]; then
  shift
  while (($#)); do
    if [[ "$1" == --env-file ]]; then cp "$2" ${JSON.stringify(join(temporary, 'captured.env'))}; break; fi
    shift
  done
  exit 0
fi
exit 9
`;
  await writeFile(join(fakeBin, 'docker'), docker, { mode: 0o700 });
  const nodeCalls = join(temporary, 'node.calls');
  await writeFile(join(fakeBin, 'node'), `#!/usr/bin/env bash\nprintf 'host node was called\\n' >>${JSON.stringify(nodeCalls)}\nexit 127\n`, { mode: 0o700 });

  await run('bash', ['scripts/chatgpt-import-runtime.sh', '--household', uuid, '--owner-account', uuid, '--file', credential], { cwd: root, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  const calls = await readFile(join(temporary, 'docker.calls'), 'utf8');
  assert.match(calls, /^run --rm --read-only --security-opt no-new-privileges --cap-drop ALL /m);
  assert.match(calls, /--network samvev-m1_default --user 1000:1000 --workdir \/workspace/);
  assert.match(calls, /samvev-m1\/runtime:a{40} npm run ai:chatgpt-import/);
  assert.match(calls, /--file \/run\/samvev-import\/credential\.json/);
  assert.equal(await readFile(join(temporary, 'captured.env'), 'utf8'), 'DATABASE_URL=postgresql://synthetic@db/synthetic\nSAMVEV_AI_MASTER_KEY_FILE=/run/secrets/samvev-ai-master-key\n');
  await assert.rejects(readFile(nodeCalls, 'utf8'), { code: 'ENOENT' });
});
