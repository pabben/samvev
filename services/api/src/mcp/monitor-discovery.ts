import { z } from 'zod';
import type { DbClient } from '../db.ts';

export const monitorDiscoveryInputSchema=z.strictObject({
  afterId:z.uuid().optional(),
  limit:z.number().int().min(1).max(50).default(20),
});
export const monitorDiscoveryOutputSchema=z.strictObject({
  tasks:z.array(z.strictObject({id:z.uuid(),name:z.string().min(1).max(80),state:z.enum(['draft','active','paused'])})).max(50),
  nextAfterId:z.uuid().nullable(),
});
export type MonitorDiscoveryInput=z.infer<typeof monitorDiscoveryInputSchema>;

const credentialWords=/(?<![\p{L}\p{M}\p{N}])(?:api[ '’(),–-]*key|access[ '’(),–-]*key|private[ '’(),–-]*key|client[ '’(),–-]*secret|auth|authorization|sig|signature|code|password|passwd|pwd|credential|session|bearer|token|secret)(?![\p{L}\p{M}\p{N}])/iu;
const ordinaryNameCharacters=/^[\p{L}\p{M}\p{N} ’'\-–,()]+$/u;
const longAlphaNumeric=/[\p{L}\p{M}\p{N}]{32,}/u;
const longAccountNumber=/\p{N}{12,}/u;

// Task names may embed sensitive fragments. Inspect the full normalized name,
// then either disclose it whole or withhold it whole to avoid partial leaks.
export function safeMonitorName(name:string):string {
  const normalized=name.normalize('NFKC');
  if(!ordinaryNameCharacters.test(normalized)||credentialWords.test(normalized)||longAlphaNumeric.test(normalized)||longAccountNumber.test(normalized))return '[name withheld]';
  let output='';
  for(const character of normalized){if(output.length+character.length>80)break;output+=character;}
  return output;
}

export async function discoverMonitorNames(client:DbClient,householdId:string,input:MonitorDiscoveryInput) {
  const rows=(await client.query<{id:string;name:string;state:'draft'|'active'|'paused'}>(
    `SELECT id,name,state FROM monitor_tasks
     WHERE household_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid)
     ORDER BY id ASC LIMIT $3`,[householdId,input.afterId??null,input.limit+1])).rows;
  const hasMore=rows.length>input.limit;
  const selected=rows.slice(0,input.limit).map(row=>({id:row.id,name:safeMonitorName(row.name),state:row.state}));
  return {tasks:selected,nextAfterId:hasMore?selected.at(-1)?.id??null:null};
}
