import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const command = process.argv[2];
const workspaceRoots = ['apps', 'packages', 'services'];

if (!command) {
  throw new Error('A workspace npm script name is required.');
}

const workspaceDirectories = workspaceRoots.flatMap((workspaceRoot) => {
  const root = resolve(workspaceRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(root, entry.name, 'package.json')))
    .map((entry) => resolve(root, entry.name));
});

for (const workspace of workspaceDirectories) {
  const packageJson = JSON.parse(readFileSync(resolve(workspace, 'package.json'), 'utf8'));
  if (!packageJson.scripts?.[command]) continue;

  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm_execpath is unavailable.');

  const result = spawnSync(process.execPath, [npmCli, 'run', command, '--workspace', workspace], {
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
