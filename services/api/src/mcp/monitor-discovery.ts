import { z } from 'zod';
import type { DbClient } from '../db.ts';

export const monitorDiscoveryInputSchema=z.strictObject({
  nameQuery:z.string().trim().min(1).max(80).optional(),
  afterId:z.uuid().optional(),
  limit:z.number().int().min(1).max(50).default(20),
});
export const monitorDiscoveryOutputSchema=z.strictObject({
  tasks:z.array(z.strictObject({id:z.uuid(),name:z.string().min(1).max(80),state:z.enum(['draft','active','paused'])})).max(50),
  nextAfterId:z.uuid().nullable(),
});
export type MonitorDiscoveryInput=z.infer<typeof monitorDiscoveryInputSchema>;

// Names are user supplied and may embed source URLs or credentials. Preserve
// useful labels while removing URL-like substrings from the returned projection.
export function safeMonitorName(name:string):string {
  return name.replace(/\b(?:https?|webcal):\/\/[^\s<>"']+/gi,'[link removed]').slice(0,80);
}

export async function discoverMonitorNames(client:DbClient,householdId:string,input:MonitorDiscoveryInput) {
  const pattern=input.nameQuery===undefined?null:`%${input.nameQuery.replace(/[\\%_]/g,'\\$&')}%`;
  const rows=(await client.query<{id:string;name:string;state:'draft'|'active'|'paused'}>(
    `SELECT id,name,state FROM monitor_tasks
     WHERE household_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid)
       AND ($3::text IS NULL OR name ILIKE $3 ESCAPE E'\\\\')
     ORDER BY id ASC LIMIT $4`,[householdId,input.afterId??null,pattern,input.limit+1])).rows;
  const hasMore=rows.length>input.limit;
  const selected=rows.slice(0,input.limit).map(row=>({id:row.id,name:safeMonitorName(row.name),state:row.state}));
  return {tasks:selected,nextAfterId:hasMore?selected.at(-1)?.id??null:null};
}
