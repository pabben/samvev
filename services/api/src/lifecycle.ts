import type pg from 'pg';
import { pool, transaction } from './db.ts';

export interface LifecycleBatchResult { published: number; expired: number }

export async function runLifecycleBatch(limit = 100): Promise<LifecycleBatchResult> {
  return transaction(async (client) => {
    const due = await client.query<{id:string;state:'scheduled'|'published';publish_at:Date;expires_at:Date;revision:number}>(`
      SELECT id,state,publish_at,expires_at,revision FROM messages
      WHERE (state='scheduled' AND publish_at<=clock_timestamp()) OR (state IN ('scheduled','published') AND expires_at<=clock_timestamp())
      ORDER BY LEAST(publish_at,expires_at),id FOR UPDATE SKIP LOCKED LIMIT $1`, [limit]);
    let published=0;
    let expired=0;
    for(const message of due.rows){
      if(message.expires_at<=new Date()){
        const result=await transition(client,message,'expired');
        if(result){expired++;await client.query(`UPDATE message_display_targets SET delivery_state='expired' WHERE message_id=$1 AND delivery_state NOT IN ('cancelled','failed')`,[message.id]);}
      }else if(message.state==='scheduled' && message.publish_at<=new Date()){
        const result=await transition(client,message,'published');
        if(result) published++;
      }
    }
    return {published,expired};
  });
}

async function transition(client:pg.PoolClient,message:{id:string;state:string;revision:number},next:'published'|'expired'):Promise<boolean>{
  const changed=await client.query(`UPDATE messages SET state=$2,published_at=CASE WHEN $2='published' THEN COALESCE(published_at,clock_timestamp()) ELSE published_at END,ended_at=CASE WHEN $2='expired' THEN clock_timestamp() ELSE ended_at END,updated_at=clock_timestamp()
    WHERE id=$1 AND state=$3 RETURNING id`,[message.id,next,message.state]);
  if(!changed.rowCount)return false;
  await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,idempotency_key) VALUES ($1,$2,$3,$4,'worker',$5) ON CONFLICT(idempotency_key) DO NOTHING`,[message.id,message.state,next,message.revision,`worker:${message.id}:${next}:${message.revision}`]);
  return true;
}

export async function closeLifecyclePool():Promise<void>{await pool.end();}
