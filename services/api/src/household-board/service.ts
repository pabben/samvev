import { createHash } from 'node:crypto';
import { DomainError } from '@samvev/core';
import { pool, transaction, type DbClient } from '../db.ts';

export type BoardKind='groceries'|'dinners';
export type BoardActor={kind:'member';id:string;accountId:string;sessionId:string;membershipId:string;householdId:string}|{kind:'display';id:string;credentialHash:string;householdId:string};
type AuthorizeDisplayBoard=(client:DbClient,actor:Extract<BoardActor,{kind:'display'}>,board:BoardKind,write:boolean)=>Promise<void>;

function hash(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function conflict():never{throw new DomainError('REVISION_CONFLICT',409);}

export class HouseholdBoardService {
  constructor(private readonly authorizeDisplayBoard:AuthorizeDisplayBoard){}

  private async authorizeActor(client:DbClient,actor:BoardActor,board:BoardKind,write:boolean):Promise<void>{
    if(actor.kind==='member'){
      const active=await client.query<{can_view:boolean}>(`SELECT (m.capabilities ? 'household.view') AS can_view FROM sessions s JOIN accounts a ON a.id=s.account_id
        JOIN memberships m ON m.account_id=a.id AND m.household_id=$4
        WHERE s.id=$1 AND s.account_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
          AND a.disabled_at IS NULL AND m.id=$3 FOR UPDATE OF s,a,m`,[actor.sessionId,actor.accountId,actor.membershipId,actor.householdId]);
      if(!active.rowCount)throw new DomainError('UNAUTHENTICATED',401);
      if(!active.rows[0]!.can_view)throw new DomainError('FORBIDDEN',403);
      return;
    }
    const active=await client.query(`SELECT 1 FROM displays WHERE id=$1 AND household_id=$2 AND credential_hash=$3
      AND revoked_at IS NULL AND credential_expires_at>clock_timestamp() FOR UPDATE`,[actor.id,actor.householdId,actor.credentialHash]);
    if(!active.rowCount)throw new DomainError('UNAUTHENTICATED',401);
    await this.authorizeDisplayBoard(client,actor,board,write);
  }

  private async mutate<T>(actor:BoardActor,key:string,payload:unknown,board:BoardKind,run:(client:DbClient)=>Promise<T>):Promise<T>{
    return transaction(async(client)=>{
      await this.authorizeActor(client,actor,board,true);
      // The operation payload excludes expectedRevision, so a retry after a committed write replays even with its original stale revision.
      const requestHash=hash(payload);
      const lockKey=`${actor.householdId}:${actor.kind}:${actor.id}:${key}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
      const existing=(await client.query<{request_hash:string;response:T}>(`SELECT request_hash,response FROM household_board_requests
        WHERE household_id=$1 AND actor_type=$2 AND actor_id=$3 AND request_key=$4 FOR UPDATE`,[actor.householdId,actor.kind,actor.id,key])).rows[0];
      if(existing){await this.authorizeActor(client,actor,board,true);if(existing.request_hash!==requestHash)throw new DomainError('CONFLICT',409,{reason:'idempotency_payload_mismatch'});return existing.response;}
      const response=await run(client);
      await client.query(`INSERT INTO household_board_requests(household_id,actor_type,actor_id,request_key,request_hash,response)
        VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[actor.householdId,actor.kind,actor.id,key,requestHash,JSON.stringify(response)]);
      // Authority can expire while waiting on a household/item lock; the final check rolls back both the mutation and receipt.
      await this.authorizeActor(client,actor,board,true);
      return response;
    });
  }

  async listGroceries(householdId:string){
    const rows=await pool.query(`SELECT id,label,checked,revision,created_at AS "createdAt",updated_at AS "updatedAt"
      FROM household_grocery_items WHERE household_id=$1 AND deleted_at IS NULL ORDER BY created_at,id LIMIT 200`,[householdId]);
    return{items:rows.rows};
  }
  async listDisplayGroceries(actor:Extract<BoardActor,{kind:'display'}>){
    return transaction(async(client)=>{await this.authorizeActor(client,actor,'groceries',false);const rows=await client.query(`SELECT id,label,checked,revision FROM household_grocery_items WHERE household_id=$1 AND deleted_at IS NULL ORDER BY created_at,id LIMIT 200`,[actor.householdId]);await this.authorizeActor(client,actor,'groceries',false);return{items:rows.rows};});
  }
  createGrocery(actor:BoardActor,input:{label:string;checked:boolean;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'grocery.create',label:input.label,checked:input.checked},'groceries',async(client)=>{
    await client.query('SELECT id FROM households WHERE id=$1 FOR UPDATE',[actor.householdId]);
    const count=(await client.query<{count:number}>(`SELECT count(*)::int AS count FROM household_grocery_items WHERE household_id=$1 AND deleted_at IS NULL`,[actor.householdId])).rows[0]!.count;
    if(count>=200)throw new DomainError('CONFLICT',409,{reason:'grocery_list_limit'});
    const row=(await client.query(`INSERT INTO household_grocery_items(household_id,label,checked,created_by_actor_type,created_by_actor_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id,label,checked,revision,created_at AS "createdAt",updated_at AS "updatedAt"`,[actor.householdId,input.label,input.checked,actor.kind,actor.id])).rows[0];return{item:row};
  });}
  updateGrocery(actor:BoardActor,id:string,input:{label?:string;checked?:boolean;expectedRevision:number;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'grocery.update',id,label:input.label??null,checked:input.checked??null},'groceries',async(client)=>{
    const row=(await client.query(`UPDATE household_grocery_items SET label=COALESCE($3,label),checked=COALESCE($4,checked),revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND household_id=$2 AND deleted_at IS NULL AND revision=$5 RETURNING id,label,checked,revision,created_at AS "createdAt",updated_at AS "updatedAt"`,[id,actor.householdId,input.label??null,input.checked??null,input.expectedRevision])).rows[0];if(!row)conflict();return{item:row};
  });}
  deleteGrocery(actor:BoardActor,id:string,input:{expectedRevision:number;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'grocery.delete',id},'groceries',async(client)=>{
    const row=(await client.query(`UPDATE household_grocery_items SET deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND household_id=$2 AND deleted_at IS NULL AND revision=$3 RETURNING id,revision`,[id,actor.householdId,input.expectedRevision])).rows[0];if(!row)conflict();return{item:row};
  });}

  async listDinnerOptions(householdId:string){const rows=await pool.query(`SELECT id,title,emoji,revision FROM household_dinner_options WHERE household_id=$1 AND deleted_at IS NULL ORDER BY title,id LIMIT 100`,[householdId]);return{options:rows.rows};}
  async listDisplayDinnerOptions(actor:Extract<BoardActor,{kind:'display'}>){return transaction(async(client)=>{await this.authorizeActor(client,actor,'dinners',false);const rows=await client.query(`SELECT id,title,emoji,revision FROM household_dinner_options WHERE household_id=$1 AND deleted_at IS NULL ORDER BY title,id LIMIT 100`,[actor.householdId]);await this.authorizeActor(client,actor,'dinners',false);return{options:rows.rows};});}
  createDinnerOption(actor:BoardActor,input:{title:string;emoji:string;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'dinner-option.create',title:input.title,emoji:input.emoji},'dinners',async(client)=>{
    await client.query('SELECT id FROM households WHERE id=$1 FOR UPDATE',[actor.householdId]);
    const count=(await client.query<{count:number}>(`SELECT count(*)::int AS count FROM household_dinner_options WHERE household_id=$1 AND deleted_at IS NULL`,[actor.householdId])).rows[0]!.count;
    if(count>=100)throw new DomainError('CONFLICT',409,{reason:'dinner_option_limit'});
    const row=(await client.query(`INSERT INTO household_dinner_options(household_id,title,emoji,created_by_actor_type,created_by_actor_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id,title,emoji,revision`,[actor.householdId,input.title,input.emoji,actor.kind,actor.id])).rows[0];return{option:row};
  });}
  updateDinnerOption(actor:BoardActor,id:string,input:{title?:string;emoji?:string;expectedRevision:number;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'dinner-option.update',id,title:input.title??null,emoji:input.emoji??null},'dinners',async(client)=>{
    const row=(await client.query(`UPDATE household_dinner_options SET title=COALESCE($3,title),emoji=COALESCE($4,emoji),revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND household_id=$2 AND deleted_at IS NULL AND revision=$5 RETURNING id,title,emoji,revision`,[id,actor.householdId,input.title??null,input.emoji??null,input.expectedRevision])).rows[0];if(!row)conflict();return{option:row};
  });}
  deleteDinnerOption(actor:BoardActor,id:string,input:{expectedRevision:number;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'dinner-option.delete',id},'dinners',async(client)=>{
    const row=(await client.query(`UPDATE household_dinner_options SET deleted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      WHERE id=$1 AND household_id=$2 AND deleted_at IS NULL AND revision=$3 RETURNING id,revision`,[id,actor.householdId,input.expectedRevision])).rows[0];if(!row)conflict();return{option:row};
  });}

  async listDinners(householdId:string,from:string,to:string){
    const rows=await pool.query(`SELECT id,local_date::text AS "localDate",CASE WHEN deleted_at IS NULL THEN title_snapshot ELSE NULL END AS title,
      CASE WHEN deleted_at IS NULL THEN emoji_snapshot ELSE NULL END AS emoji,revision,(deleted_at IS NOT NULL) AS cleared
      FROM household_dinner_assignments WHERE household_id=$1 AND local_date BETWEEN $2::date AND $3::date
      ORDER BY local_date,id LIMIT 62`,[householdId,from,to]);return{assignments:rows.rows};
  }
  async listDisplayDinners(actor:Extract<BoardActor,{kind:'display'}>,from:string,to:string){
    return transaction(async(client)=>{await this.authorizeActor(client,actor,'dinners',false);const rows=await client.query(`SELECT id,local_date::text AS "localDate",CASE WHEN deleted_at IS NULL THEN title_snapshot ELSE NULL END AS title,
      CASE WHEN deleted_at IS NULL THEN emoji_snapshot ELSE NULL END AS emoji,revision,(deleted_at IS NOT NULL) AS cleared
      FROM household_dinner_assignments WHERE household_id=$1 AND local_date BETWEEN $2::date AND $3::date ORDER BY local_date,id LIMIT 62`,[actor.householdId,from,to]);await this.authorizeActor(client,actor,'dinners',false);return{assignments:rows.rows};});
  }
  setDinner(actor:BoardActor,localDate:string,input:{optionId:string|null;expectedRevision:number;requestKey:string}){return this.mutate(actor,input.requestKey,{kind:'dinner.assign',localDate,optionId:input.optionId},'dinners',async(client)=>{
    await client.query('SELECT id FROM households WHERE id=$1 FOR UPDATE',[actor.householdId]);
    const current=(await client.query<{revision:number}>(`SELECT revision FROM household_dinner_assignments WHERE household_id=$1 AND local_date=$2::date FOR UPDATE`,[actor.householdId,localDate])).rows[0];
    if((current?.revision??0)!==input.expectedRevision)conflict();
    let snapshot:{title:string;emoji:string}|null=null;
    if(input.optionId){snapshot=(await client.query<{title:string;emoji:string}>(`SELECT title,emoji FROM household_dinner_options WHERE id=$1 AND household_id=$2 AND deleted_at IS NULL FOR SHARE`,[input.optionId,actor.householdId])).rows[0]??null;if(!snapshot)throw new DomainError('NOT_FOUND',404);}
    const row=(await client.query(`INSERT INTO household_dinner_assignments(household_id,local_date,title_snapshot,emoji_snapshot,deleted_at,updated_by_actor_type,updated_by_actor_id)
      VALUES($1,$2::date,$3,$4,CASE WHEN $3::text IS NULL THEN clock_timestamp() ELSE NULL END,$5,$6)
      ON CONFLICT(household_id,local_date) DO UPDATE SET title_snapshot=EXCLUDED.title_snapshot,emoji_snapshot=EXCLUDED.emoji_snapshot,
      deleted_at=EXCLUDED.deleted_at,revision=household_dinner_assignments.revision+1,updated_at=clock_timestamp(),updated_by_actor_type=EXCLUDED.updated_by_actor_type,updated_by_actor_id=EXCLUDED.updated_by_actor_id
      RETURNING id,local_date::text AS "localDate",title_snapshot AS title,emoji_snapshot AS emoji,revision,deleted_at IS NOT NULL AS cleared`,[actor.householdId,localDate,snapshot?.title??null,snapshot?.emoji??null,actor.kind,actor.id])).rows[0];return{assignment:row};
  });}
}

export function boardRequestHash(value:unknown):string{return hash(value);}
