import pg from 'pg';
const { Pool } = pg;

/** Refuse to create a pool against anything except the isolated test database
 * when this module is loaded by Node's test runner. Never include the URL in
 * errors because it can contain credentials. */
export function assertIsolatedTestDatabase(databaseUrl: string | undefined): void {
  let database: URL;
  try {
    if (!databaseUrl) throw new Error();
    database = new URL(databaseUrl);
  } catch {
    throw new Error('Node test runner requires an isolated test database URL');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.hostname !== 'test-db' || database.pathname !== '/samvev_test' ||
      database.username !== 'samvev_test' || database.password !== 'synthetic-test-data-only' ||
      (database.port !== '' && database.port !== '5432') ||
      database.search !== '' || database.hash !== '') {
    throw new Error('Node test runner requires an isolated test database URL');
  }
}

if (process.env.NODE_TEST_CONTEXT) assertIsolatedTestDatabase(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.SAMVEV_DB_POOL_SIZE ?? 10),
  connectionTimeoutMillis: 2_000,
  statement_timeout: 10_000,
  application_name: process.env.SAMVEV_PROCESS_NAME ?? 'samvev-api'
});

pool.on('error', (error) => console.error('database_pool_error', { name: error.name, code: (error as { code?: string }).code }));

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export type DbClient = pg.Pool | pg.PoolClient;
