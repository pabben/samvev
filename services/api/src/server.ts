import { buildApp } from './app.ts';
import { pool } from './db.ts';
import { assertPublicDeploymentReady, loadRuntimeConfig } from './runtime-config.ts';

const runtimeConfig = loadRuntimeConfig();
await assertPublicDeploymentReady(runtimeConfig, process.env.SAMVEV_DEMO_MODE === 'true', async () => {
  const result = await pool.query<{ claimed_at: Date|null; demo_mode: boolean }>(
    'SELECT claimed_at,demo_mode FROM installations WHERE singleton=true'
  );
  const row = result.rows[0];
  return row ? { claimedAt: row.claimed_at, demoMode: row.demo_mode } : undefined;
});

const app = await buildApp({ runtimeConfig });
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 4173);

await app.listen({ host, port });

for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>void app.close().then(()=>process.exit(0)));
