import { resolve } from 'node:path';
import { pool } from '../db.ts';
import { provisionLiveE2e } from './live-e2e.ts';

const outputPath=process.argv[2];
if(process.env.SAMVEV_LIVE_E2E_ENABLED!=='true')throw new Error('SAMVEV_LIVE_E2E_ENABLED=true is required');
if(!outputPath)throw new Error('Usage: npm run e2e:provision -- <ignored-credential-output.json>');
const resolved=resolve(outputPath);
if(!resolved.includes('/.local/')&&!resolved.startsWith('/tmp/'))throw new Error('Credential output must be under ignored .local/ or /tmp');
try{
  const schemaReady=await pool.query(`SELECT to_regclass('public.live_e2e_registrations') AS name`);
  if(!schemaReady.rows[0]?.name)throw new Error('Migration 015_live_e2e_registration.sql must be applied before provisioning');
  const result=await provisionLiveE2e(resolved);
  process.stdout.write(`${JSON.stringify({...result,credentialsFile:resolved})}\n`);
}finally{await pool.end();}
