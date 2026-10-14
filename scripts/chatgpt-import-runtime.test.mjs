import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const result = await run('bash', ['scripts/chatgpt-import-runtime.sh', '--household', uuid, '--owner-account', uuid, '--check'], { cwd: root, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  assert.match(result.stdout, /readiness verified/);
  assert.match(result.stdout, /no credential was read or imported/);
  const calls = await (await import('node:fs/promises')).readFile(join(temporary, 'docker.calls'), 'utf8');
  assert.match(calls, /^ps /m);
  assert.match(calls, /^inspect /m);
  assert.doesNotMatch(calls, /^run /m);
});
