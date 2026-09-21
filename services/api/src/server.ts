import { buildApp } from './app.ts';

const app = await buildApp();
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 4173);

await app.listen({ host, port });

for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>void app.close().then(()=>process.exit(0)));
