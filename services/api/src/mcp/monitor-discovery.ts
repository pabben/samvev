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

const sensitiveNamePatterns=[
  /\b[a-z][a-z0-9+.-]*:\s*\/\//i, // Any URI scheme, including credentials in the authority.
  /(?:^|[\s("'<])(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[\/?#]|$)/i, // Schemeless host/path.
  /(?:^|[\s("'<])(?:localhost|127(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d+)?(?:[\/?#]|$)/i,
  /(?:^|[\s/])[^\s/@:]+:[^\s/@]+@/i, // Userinfo, even when quoted.
  /[?&][^\s=&#]+=/, /#[^\s]+/, // Query and fragment syntax.
  /%(?:2f|3f|23|40|5c|3a|26|3d)/i, // Encoded path/query/authority delimiters.
  /(?:^|[^a-z0-9])(?:api[\s_-]*key|access[\s_-]*key|private[\s_-]*key|client[\s_-]*secret|password|passwd|pwd|credential|session|secret|authorization|bearer|token|signature)(?:$|[^a-z0-9])/i,
  /[\u0000-\u001f\u007f-\u009f]/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /(?:^|[^a-z0-9])[A-Za-z0-9_-]{32,}(?:$|[^a-z0-9])/,
];

// Task names may embed sensitive fragments. Inspect the full normalized name,
// then either disclose it whole or withhold it whole to avoid partial leaks.
export function safeMonitorName(name:string):string {
  const normalized=name.normalize('NFKC');
  if(sensitiveNamePatterns.some(pattern=>pattern.test(normalized)))return '[name withheld]';
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
