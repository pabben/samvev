import { writeFile } from 'node:fs/promises';
import { runLifecycleBatch, closeLifecyclePool } from '../../api/src/lifecycle.ts';

const healthFile=process.env.SAMVEV_WORKER_HEALTH_FILE ?? '/tmp/samvev-worker-health.json';
const intervalMs=Math.max(250,Number(process.env.SAMVEV_WORKER_INTERVAL_MS ?? 1000));
let stopping=false;

for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{stopping=true;});

async function tick():Promise<void>{
  try{
    const result=await runLifecycleBatch();
    await writeFile(healthFile,JSON.stringify({healthy:true,checkedAt:new Date().toISOString(),...result}));
  }catch(error){
    console.error('worker_tick_failed',{name:error instanceof Error?error.name:'unknown'});
    await writeFile(healthFile,JSON.stringify({healthy:false,checkedAt:new Date().toISOString()})).catch(()=>undefined);
  }
}

while(!stopping){await tick();if(!stopping)await new Promise((resolve)=>setTimeout(resolve,intervalMs));}
await closeLifecyclePool();
