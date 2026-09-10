import { writeFile } from 'node:fs/promises';
import { runLifecycleBatch, closeLifecyclePool } from '../../api/src/lifecycle.ts';
import { runMonitorBatch, type MonitorBatchResult } from '../../api/src/monitor/engine.ts';

const healthFile=process.env.SAMVEV_WORKER_HEALTH_FILE ?? '/tmp/samvev-worker-health.json';
const intervalMs=Math.max(250,Number(process.env.SAMVEV_WORKER_INTERVAL_MS ?? 1000));
let stopping=false;
let lastMonitor:MonitorBatchResult={claimed:0,changed:0,unchanged:0,failed:0};

for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{stopping=true;});

async function tick():Promise<void>{
  try{
    const result=await runLifecycleBatch();
    await writeFile(healthFile,JSON.stringify({healthy:true,checkedAt:new Date().toISOString(),...result,monitors:lastMonitor}));
  }catch(error){
    console.error('worker_tick_failed',{name:error instanceof Error?error.name:'unknown'});
    await writeFile(healthFile,JSON.stringify({healthy:false,checkedAt:new Date().toISOString()})).catch(()=>undefined);
  }
}

async function monitorLoop():Promise<void>{while(!stopping){try{lastMonitor=await runMonitorBatch();}catch(error){console.error('monitor_tick_failed',{name:error instanceof Error?error.name:'unknown'});}if(!stopping)await new Promise((resolve)=>setTimeout(resolve,5000));}}
const monitors=monitorLoop();
while(!stopping){await tick();if(!stopping)await new Promise((resolve)=>setTimeout(resolve,intervalMs));}
await monitors;
await closeLifecyclePool();
