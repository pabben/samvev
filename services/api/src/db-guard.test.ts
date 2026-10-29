import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dbModule = fileURLToPath(new URL('./db.ts', import.meta.url));

function loadDb(databaseUrl: string | undefined, testContext: string | undefined) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (testContext !== undefined) env.NODE_TEST_CONTEXT = testContext;
  if (databaseUrl === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = databaseUrl;
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `await import(${JSON.stringify(new URL(`file://${dbModule}`).href)});`],
  { env, encoding: 'utf8' });
}

test('test runner DB guard allows only the isolated test database', () => {
  const allowed = loadDb('postgres://samvev_test:synthetic-test-data-only@test-db:5432/samvev_test', 'child-v8');
  assert.equal(allowed.status, 0, allowed.stderr);

  for (const url of [
    'postgres://samvev_test:synthetic-test-data-only@qa-db:5432/samvev_test',
    'postgres://samvev_test:synthetic-test-data-only@public-db.example/samvev',
    undefined,
    'not-a-database-url',
    'postgres://other:wrong@test-db:5432/samvev_test',
    'postgres://samvev_test:synthetic-test-data-only@test-db:5432/other',
  ]) {
    const rejected = loadDb(url, 'child-v8');
    assert.notEqual(rejected.status, 0, 'expected unsafe test database import to be rejected');
    assert.match(rejected.stderr, /requires an isolated test database URL/);
    assert.doesNotMatch(rejected.stderr, /synthetic-test-data-only|wrong|public-db\.example/);
  }
});

test('ordinary runtime does not apply the test-runner restriction', () => {
  const normalRuntime = loadDb('postgres://user:runtime-password@qa-db:5432/qa', undefined);
  assert.equal(normalRuntime.status, 0, normalRuntime.stderr);
});
