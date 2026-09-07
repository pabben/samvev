import pg from 'pg';
const { Pool } = pg;

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
