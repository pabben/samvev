import assert from 'node:assert/strict';
import pg from 'pg';
assert.equal(process.env.DATABASE_URL, 'postgresql://display_proof:synthetic-display-proof-only@proof-db:5432/display_proof');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const identity = await pool.query("SELECT current_database() AS db,current_user AS username,(SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables");
assert.deepEqual(identity.rows[0], {db:'display_proof',username:'display_proof',tables:0});
await pool.end();
