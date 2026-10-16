import {createHash} from 'node:crypto';
import type pg from 'pg';
import {DomainError} from '@samvev/core';
import {pool,transaction,type DbClient} from '../db.ts';
import {normalizeMediaImage,type NormalizedMediaImage} from './image.ts';
import type {MediaAlbumCreate,MediaAlbumGrant,MediaAlbumUpdate,MediaAssetDelete,MediaAssetUpdate,MediaAssetUpload,MediaBackgroundUpdate,MediaDisplayGrant} from '@samvev/contracts';

export interface MediaMemberActor {accountId:string;sessionId:string;householdId:string;membershipId:string;personId:string;}
export interface MediaDisplayActor {id:string;householdId:string;setupId:string;privacyMode:boolean;credentialHash:string;}
export interface MediaPreviewSelection {cards:string[];albumIds:string[];backgroundId:string|null;}
export type MediaNormalizer=(base64:string)=>Promise<NormalizedMediaImage>;
export interface MediaOptions {normalizer?:MediaNormalizer;}
interface AlbumRow {id:string;name:string;album_kind:'photos'|'backgrounds';revision:number;owner_membership_id:string;owner:boolean;can_read:boolean;can_upload:boolean;can_manage:boolean;asset_count:number;}
interface AssetRow {id:string;album_id:string;album_kind:'photos'|'backgrounds';revision:number;title:string;description:string;original_mime:string;width:number;height:number;content_sha256:string;stored_bytes:number|string;created_at:Date;updated_at:Date;}
interface UsageRow {asset_count:number;stored_bytes:string;max_assets:number;max_bytes:string;}

async function liveMember(client:DbClient,actor:MediaMemberActor):Promise<{capabilities:string[]}>{
  const row=(await client.query<{capabilities:string[]}>(`SELECT membership.capabilities
    FROM sessions session JOIN accounts account ON account.id=session.account_id
    JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$2
    WHERE session.id=$1 AND session.account_id=$3 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
      AND account.disabled_at IS NULL AND membership.id=$4 FOR UPDATE OF session,account,membership`,[actor.sessionId,actor.householdId,actor.accountId,actor.membershipId])).rows[0];
  if(!row)throw new DomainError('UNAUTHENTICATED',401);
  if(!row.capabilities.includes('household.view'))throw new DomainError('FORBIDDEN',403);
  return row;
}
async function memberTransaction<T>(actor:MediaMemberActor,operation:(client:DbClient)=>Promise<T>):Promise<T>{
  return transaction(async(client)=>{const result=await operation(client);await liveMember(client,actor);return result;});
}
async function liveDisplay(client:DbClient,actor:MediaDisplayActor,write=false):Promise<{setup_id:string;privacy_mode:boolean}>{
  const row=(await client.query<{setup_id:string;privacy_mode:boolean}>(`SELECT setup_id,privacy_mode FROM displays WHERE id=$1 AND household_id=$2 AND credential_hash=$3 AND revoked_at IS NULL AND credential_expires_at>clock_timestamp() FOR UPDATE`,[actor.id,actor.householdId,actor.credentialHash])).rows[0];
  if(!row)throw new DomainError('UNAUTHENTICATED',401);
  if(write&&row.privacy_mode)throw new DomainError('FORBIDDEN',403,{reason:'display_privacy_mode'});
  return row;
}
async function displayTransaction<T>(actor:MediaDisplayActor,operation:(client:DbClient)=>Promise<T>):Promise<T>{
  return transaction(async(client)=>{const result=await operation(client);await liveDisplay(client,actor);return result;});
}
async function usage(client:DbClient,householdId:string,lock=true):Promise<UsageRow>{
  await client.query('INSERT INTO media_household_usage(household_id) VALUES($1) ON CONFLICT(household_id) DO NOTHING',[householdId]);
  const row=(await client.query<UsageRow>(`SELECT asset_count,stored_bytes,max_assets,max_bytes FROM media_household_usage WHERE household_id=$1 ${lock?'FOR UPDATE':''}`,[householdId])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);
  return row;
}
async function access(client:DbClient,householdId:string,albumId:string,membershipId:string):Promise<{can_read:boolean;can_upload:boolean;can_manage:boolean;is_owner:boolean}>{
  const album=(await client.query<{owner_membership_id:string}>(`SELECT owner_membership_id FROM media_albums WHERE household_id=$1 AND id=$2`,[householdId,albumId])).rows[0];
  if(!album)throw new DomainError('NOT_FOUND',404);
  const grants=(await client.query<{can_read:boolean;can_upload:boolean;can_manage:boolean}>(`SELECT can_read,can_upload,can_manage FROM media_album_grants WHERE household_id=$1 AND album_id=$2 AND (household_wide OR membership_id=$3) FOR SHARE`,[householdId,albumId,membershipId])).rows;
  return{can_read:grants.some(row=>row.can_read),can_upload:grants.some(row=>row.can_upload),can_manage:grants.some(row=>row.can_manage),is_owner:album.owner_membership_id===membershipId};
}
async function requireAlbumPermission(client:DbClient,actor:MediaMemberActor,albumId:string,permission:'can_read'|'can_upload'|'can_manage'):Promise<{can_read:boolean;can_upload:boolean;can_manage:boolean;is_owner:boolean}>{
  const rights=await access(client,actor.householdId,albumId,actor.membershipId);
  if(!rights.is_owner&&!rights[permission])throw new DomainError('NOT_FOUND',404);
  return rights;
}
function assetMetadata(row:AssetRow,householdId:string){return{id:row.id,albumId:row.album_id,kind:row.album_kind,revision:row.revision,title:row.title,description:row.description,mimeType:'image/webp',sourceMimeType:row.original_mime,width:row.width,height:row.height,contentSha256:row.content_sha256,storedBytes:Number(row.stored_bytes),createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),url:`/api/v1/households/${householdId}/media/assets/${row.id}/master?v=${row.revision}`,previewUrl:`/api/v1/households/${householdId}/media/assets/${row.id}/preview?v=${row.revision}`};}
function displayAssetMetadata(row:AssetRow){return{id:row.id,albumId:row.album_id,kind:row.album_kind,revision:row.revision,title:row.title,description:row.description,mimeType:'image/webp',width:row.width,height:row.height,url:`/api/v1/display/media/assets/${row.id}/master?v=${row.revision}`,previewUrl:`/api/v1/display/media/assets/${row.id}/preview?v=${row.revision}`};}
async function lockAlbum(client:DbClient,householdId:string,albumId:string):Promise<AlbumRow>{
  const row=(await client.query<AlbumRow>(`SELECT album.id,album.name,album.album_kind,album.revision,album.owner_membership_id,false AS owner,false AS can_read,false AS can_upload,false AS can_manage,0::int AS asset_count
    FROM media_albums album WHERE album.household_id=$1 AND album.id=$2 FOR UPDATE`,[householdId,albumId])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404);return row;
}
async function hasDisplayAlbumAccess(client:DbClient,householdId:string,displayId:string,setupId:string,albumId:string,permission:'can_read'|'can_upload'):Promise<boolean>{
  const row=(await client.query<{allowed:boolean}>(`SELECT grant_row.${permission} AS allowed
    FROM display_setups setup JOIN media_album_display_grants grant_row ON grant_row.household_id=setup.household_id AND grant_row.album_id=$4 AND grant_row.display_id=$3
    WHERE setup.household_id=$1 AND setup.id=$2 AND setup.cards ? 'photos' AND setup.album_ids ? $4::text FOR SHARE OF setup,grant_row`,[householdId,setupId,displayId,albumId])).rows[0];
  return row?.allowed===true;
}
// After actor locks: quota usage -> album (when required) -> setup -> asset -> grants.
// Reads must lock the setup separately before an asset; a joined row lock can visit
// the asset first and deadlock with album deletion clearing the setup selection.
async function selectedDisplayAsset(client:DbClient,householdId:string,displayId:string,setupId:string,assetId:string,privacyMode:boolean):Promise<AssetRow|undefined>{
  if(privacyMode)return undefined;
  const setup=await client.query('SELECT id FROM display_setups WHERE household_id=$1 AND id=$2 FOR SHARE',[householdId,setupId]);
  if(!setup.rowCount)return undefined;
  const row=(await client.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at
    FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id
    JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$3 AND grant_row.can_read
    JOIN displays device ON device.household_id=asset.household_id AND device.id=$3 AND device.setup_id=$2 AND device.revoked_at IS NULL AND device.privacy_mode=false
    JOIN display_setups setup ON setup.household_id=device.household_id AND setup.id=device.setup_id
    WHERE asset.household_id=$1 AND asset.id=$4 AND ((album.album_kind='photos' AND setup.cards ? 'photos' AND asset.album_id=ANY(SELECT jsonb_array_elements_text(setup.album_ids)::uuid)) OR (album.album_kind='backgrounds' AND (setup.background_id=asset.id OR EXISTS(SELECT 1 FROM media_household_settings setting WHERE setting.household_id=asset.household_id AND setting.background_asset_id=asset.id)))) FOR SHARE OF asset,grant_row`,[householdId,setupId,displayId,assetId])).rows[0];
  return row;
}

export async function validateDisplaySetupMediaSelection(client:DbClient,householdId:string,membershipId:string,albumIds:string[],backgroundId:string|null):Promise<void>{
  const ids=[...new Set(albumIds)];
  const albums=ids.length?(await client.query<{id:string;album_kind:string}>(`SELECT id,album_kind FROM media_albums WHERE household_id=$1 AND id=ANY($2::uuid[])`,[householdId,ids])).rows:[];
  if(albums.length!==ids.length||albums.some(album=>album.album_kind!=='photos'))throw new DomainError('NOT_FOUND',404);
  for(const album of albums){const rights=await access(client,householdId,album.id,membershipId);if(!rights.is_owner&&!rights.can_read)throw new DomainError('FORBIDDEN',403,{reason:'media_album_not_readable'});}
  if(backgroundId){const background=(await client.query<{album_id:string;album_kind:string}>(`SELECT asset.album_id,album.album_kind FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id WHERE asset.household_id=$1 AND asset.id=$2`,[householdId,backgroundId])).rows[0];if(!background||background.album_kind!=='backgrounds')throw new DomainError('NOT_FOUND',404);const rights=await access(client,householdId,background.album_id,membershipId);if(!rights.is_owner&&!rights.can_read)throw new DomainError('FORBIDDEN',403,{reason:'media_background_not_readable'});}
}

export class MediaService {
  private readonly normalize:MediaNormalizer;
  constructor(options:MediaOptions={}){this.normalize=options.normalizer??normalizeMediaImage;}

  async createAlbum(actor:MediaMemberActor,input:MediaAlbumCreate){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);await usage(client,actor.householdId);const inserted=await client.query<{id:string}>(`INSERT INTO media_albums(household_id,owner_membership_id,name,album_kind) VALUES($1,$2,$3,$4) RETURNING id`,[actor.householdId,actor.membershipId,input.name,input.kind]);const id=inserted.rows[0]!.id;
      return{id,name:input.name,kind:input.kind,revision:1,owner:true,permissions:{read:true,upload:true,manage:true},assets:[] as unknown[]};});
  }
  async listAlbums(actor:MediaMemberActor){
    await liveMember(pool,actor);
    const rows=(await pool.query<AlbumRow>(`SELECT album.id,album.name,album.album_kind,album.revision,album.owner_membership_id,
      album.owner_membership_id=$2 AS owner,COALESCE(bool_or(grant_row.can_read),false) OR album.owner_membership_id=$2 AS can_read,
      COALESCE(bool_or(grant_row.can_upload),false) OR album.owner_membership_id=$2 AS can_upload,COALESCE(bool_or(grant_row.can_manage),false) OR album.owner_membership_id=$2 AS can_manage,
      count(DISTINCT asset.id)::int AS asset_count
      FROM media_albums album LEFT JOIN media_album_grants grant_row ON grant_row.household_id=album.household_id AND grant_row.album_id=album.id AND (grant_row.household_wide OR grant_row.membership_id=$2)
      LEFT JOIN media_assets asset ON asset.household_id=album.household_id AND asset.album_id=album.id
      WHERE album.household_id=$1 GROUP BY album.id HAVING album.owner_membership_id=$2 OR bool_or(grant_row.can_read) OR bool_or(grant_row.can_upload) OR bool_or(grant_row.can_manage)
      ORDER BY album.created_at,album.id`,[actor.householdId,actor.membershipId])).rows;
    return{albums:rows.map(row=>({id:row.id,name:row.name,kind:row.album_kind,revision:row.revision,owner:row.owner,permissions:{read:row.can_read,upload:row.can_upload,manage:row.can_manage},assetCount:row.asset_count}))};
  }
  async updateAlbum(actor:MediaMemberActor,albumId:string,input:MediaAlbumUpdate){
    return memberTransaction(actor,async(client)=>{const live=await liveMember(client,actor);const album=await lockAlbum(client,actor.householdId,albumId);if(album.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:album.revision});const rights=await access(client,actor.householdId,albumId,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);const revision=album.revision+1;await client.query('UPDATE media_albums SET name=$3,revision=$4,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2',[albumId,actor.householdId,input.name,revision]);return{id:albumId,name:input.name,revision};});
  }
  async deleteAlbum(actor:MediaMemberActor,albumId:string,expectedRevision:number){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);const use=await usage(client,actor.householdId);const album=await lockAlbum(client,actor.householdId,albumId);if(album.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:album.revision});const rights=await access(client,actor.householdId,albumId,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);const count=(await client.query<{n:number;bytes:string}>(`SELECT count(*)::int AS n,COALESCE(sum(stored_bytes),0)::text AS bytes FROM media_assets WHERE household_id=$1 AND album_id=$2`,[actor.householdId,albumId])).rows[0]!;await client.query(`UPDATE display_setups SET album_ids=COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(album_ids) value WHERE value#>>'{}'<>$2::uuid::text), '[]'::jsonb),background_id=CASE WHEN background_id IN (SELECT id FROM media_assets WHERE album_id=$2 AND household_id=$1) THEN NULL ELSE background_id END,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND (album_ids @> jsonb_build_array($2::uuid::text) OR background_id IN (SELECT id FROM media_assets WHERE album_id=$2 AND household_id=$1))`,[actor.householdId,albumId]);await client.query(`UPDATE media_household_settings SET background_asset_id=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND background_asset_id IN (SELECT id FROM media_assets WHERE album_id=$2)`,[actor.householdId,albumId]);await client.query('DELETE FROM media_albums WHERE id=$1 AND household_id=$2',[albumId,actor.householdId]);return{deleted:true,remainingAssets:use.asset_count-count.n};});
  }
  async setGrant(actor:MediaMemberActor,albumId:string,input:MediaAlbumGrant){
    return memberTransaction(actor,async(client)=>{const live=await liveMember(client,actor);const album=await lockAlbum(client,actor.householdId,albumId);if(album.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:album.revision});const rights=await access(client,actor.householdId,albumId,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);if(input.membershipId){const target=await client.query('SELECT id FROM memberships WHERE id=$1 AND household_id=$2',[input.membershipId,actor.householdId]);if(!target.rowCount)throw new DomainError('NOT_FOUND',404);}
      const existing=(await client.query<{id:string}>(`SELECT id FROM media_album_grants WHERE household_id=$1 AND album_id=$2 AND household_wide=$3 AND membership_id IS NOT DISTINCT FROM $4 FOR UPDATE`,[actor.householdId,albumId,input.householdWide,input.membershipId])).rows[0];
      if(input.revoke){if(!existing)throw new DomainError('NOT_FOUND',404);await client.query('DELETE FROM media_album_grants WHERE id=$1',[existing.id]);}else if(existing)await client.query('UPDATE media_album_grants SET can_read=$2,can_upload=$3,can_manage=$4 WHERE id=$1',[existing.id,input.canRead,input.canUpload,input.canManage]);else await client.query(`INSERT INTO media_album_grants(household_id,album_id,membership_id,household_wide,can_read,can_upload,can_manage) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.householdId,albumId,input.membershipId,input.householdWide,input.canRead,input.canUpload,input.canManage]);
      const revision=album.revision+1;await client.query('UPDATE media_albums SET revision=$3,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2',[albumId,actor.householdId,revision]);return{albumId,revision,target:input.householdWide?'household':input.membershipId,revoked:input.revoke,permissions:input.revoke?null:{read:input.canRead,upload:input.canUpload,manage:input.canManage}};});
  }
  async revokeMemberGrant(actor:MediaMemberActor,albumId:string,membershipId:string,expectedRevision:number){
    return memberTransaction(actor,async(client)=>{const live=await liveMember(client,actor);const album=await lockAlbum(client,actor.householdId,albumId);if(album.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:album.revision});const rights=await access(client,actor.householdId,albumId,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);const deleted=await client.query('DELETE FROM media_album_grants WHERE household_id=$1 AND album_id=$2 AND membership_id=$3 AND NOT household_wide',[actor.householdId,albumId,membershipId]);if(!deleted.rowCount)throw new DomainError('NOT_FOUND',404);const revision=album.revision+1;await client.query('UPDATE media_albums SET revision=$3,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2',[albumId,actor.householdId,revision]);return{albumId,revision};});
  }
  async revokeGrant(actor:MediaMemberActor,albumId:string,input:{expectedRevision:number;membershipId:string|null;householdWide:boolean}){
    return memberTransaction(actor,async(client)=>{const live=await liveMember(client,actor);const album=await lockAlbum(client,actor.householdId,albumId);if(album.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:album.revision});const rights=await access(client,actor.householdId,albumId,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);const deleted=await client.query('DELETE FROM media_album_grants WHERE household_id=$1 AND album_id=$2 AND household_wide=$3 AND membership_id IS NOT DISTINCT FROM $4',[actor.householdId,albumId,input.householdWide,input.membershipId]);if(!deleted.rowCount)throw new DomainError('NOT_FOUND',404);const revision=album.revision+1;await client.query('UPDATE media_albums SET revision=$3,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2',[albumId,actor.householdId,revision]);return{albumId,revision};});
  }
  async albumGrants(actor:MediaMemberActor,albumId:string){
    const live=await liveMember(pool,actor);const album=await lockAlbum(pool,actor.householdId,albumId);const rights=await access(pool,actor.householdId,albumId,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('NOT_FOUND',404);
    const [members,displays]=await Promise.all([
      pool.query<{membership_id:string|null;household_wide:boolean;can_read:boolean;can_upload:boolean;can_manage:boolean;display_name:string|null}>(`SELECT grant_row.membership_id,grant_row.household_wide,grant_row.can_read,grant_row.can_upload,grant_row.can_manage,person.display_name FROM media_album_grants grant_row LEFT JOIN memberships membership ON membership.id=grant_row.membership_id AND membership.household_id=grant_row.household_id LEFT JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id WHERE grant_row.household_id=$1 AND grant_row.album_id=$2 ORDER BY grant_row.household_wide DESC,grant_row.membership_id`,[actor.householdId,albumId]),
      pool.query<{display_id:string;display_name:string;revision:number;can_read:boolean;can_upload:boolean}>(`SELECT grant_row.display_id,display.name AS display_name,grant_row.revision,grant_row.can_read,grant_row.can_upload FROM media_album_display_grants grant_row JOIN displays display ON display.id=grant_row.display_id AND display.household_id=grant_row.household_id WHERE grant_row.household_id=$1 AND grant_row.album_id=$2 ORDER BY display.name,display.id`,[actor.householdId,albumId])
    ]);
    return{album:{id:album.id,name:album.name,kind:album.album_kind,revision:album.revision},memberGrants:members.rows.map(row=>({membershipId:row.membership_id,householdWide:row.household_wide,displayName:row.display_name,permissions:{read:row.can_read,upload:row.can_upload,manage:row.can_manage}})),displayGrants:displays.rows.map(row=>({displayId:row.display_id,displayName:row.display_name,revision:row.revision,permissions:{read:row.can_read,upload:row.can_upload}}))};
  }
  async setDisplayGrant(actor:MediaMemberActor,albumId:string,displayId:string,input:MediaDisplayGrant){
    return memberTransaction(actor,async(client)=>{
      const live=await liveMember(client,actor);
      if(!live.capabilities.includes('display.manage'))throw new DomainError('FORBIDDEN',403);
      const display=(await client.query<{setup_id:string|null}>('SELECT setup_id FROM displays WHERE id=$1 AND household_id=$2 FOR UPDATE',[displayId,actor.householdId])).rows[0];
      if(!display?.setup_id)throw new DomainError('NOT_FOUND',404);
      await lockAlbum(client,actor.householdId,albumId);
      const rights=await access(client,actor.householdId,albumId,actor.membershipId);
      if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);
      const old=(await client.query<{revision:number}>(`SELECT revision FROM media_album_display_grants WHERE household_id=$1 AND album_id=$2 AND display_id=$3 FOR UPDATE`,[actor.householdId,albumId,displayId])).rows[0];
      if((input.expectedRevision??null)!==(old?.revision??null))throw new DomainError('REVISION_CONFLICT',409,{revision:old?.revision??null});
      if(input.revoke){
        if(!old)throw new DomainError('NOT_FOUND',404);
        await client.query('DELETE FROM media_album_display_grants WHERE household_id=$1 AND album_id=$2 AND display_id=$3',[actor.householdId,albumId,displayId]);
        return{albumId,displayId,revision:null,revoked:true};
      }
      const revision=(old?.revision??0)+1;
      await client.query(`INSERT INTO media_album_display_grants(household_id,album_id,display_id,can_read,can_upload,revision,updated_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) ON CONFLICT(album_id,display_id) DO UPDATE SET can_read=EXCLUDED.can_read,can_upload=EXCLUDED.can_upload,revision=EXCLUDED.revision,updated_at=clock_timestamp()`,[actor.householdId,albumId,displayId,input.canRead,input.canUpload,revision]);
      const selected=((await client.query(`SELECT 1 FROM display_setups WHERE id=$1 AND household_id=$2 AND (album_ids ? $3 OR background_id IN (SELECT id FROM media_assets WHERE album_id=$4 AND household_id=$2))`,[display.setup_id,actor.householdId,albumId,albumId])).rowCount??0)>0;
      return{albumId,displayId,revision,permissions:{read:input.canRead,upload:input.canUpload},selected};
    });
  }
  async listAssets(actor:MediaMemberActor,albumId:string){
    await liveMember(pool,actor);await requireAlbumPermission(pool,actor,albumId,'can_read');const rows=(await pool.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id WHERE asset.household_id=$1 AND asset.album_id=$2 ORDER BY asset.created_at,asset.id`,[actor.householdId,albumId])).rows;return{assets:rows.map(row=>assetMetadata(row,actor.householdId))};
  }
  async uploadMemberAsset(actor:MediaMemberActor,albumId:string,input:MediaAssetUpload){await liveMember(pool,actor);await requireAlbumPermission(pool,actor,albumId,'can_upload');const image=await this.normalize(input.imageBase64);return this.insertMemberAsset(actor,albumId,input,image);}
  async replaceMemberAsset(actor:MediaMemberActor,assetId:string,input:MediaAssetUpdate&{imageBase64:string}){
    // Reject inaccessible/stale replacements before expensive decoding. The commit
    // transaction repeats these checks after normalization without holding locks.
    await memberTransaction(actor,async(client)=>{
      await liveMember(client,actor);
      const location=(await client.query<{album_id:string}>('SELECT album_id FROM media_assets WHERE household_id=$1 AND id=$2',[actor.householdId,assetId])).rows[0];
      if(!location)throw new DomainError('NOT_FOUND',404);
      await lockAlbum(client,actor.householdId,location.album_id);
      await requireAlbumPermission(client,actor,location.album_id,'can_manage');
      const asset=(await client.query<{revision:number}>('SELECT revision FROM media_assets WHERE household_id=$1 AND id=$2',[actor.householdId,assetId])).rows[0];
      if(!asset)throw new DomainError('NOT_FOUND',404);
      if(asset.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:asset.revision});
    });
    const image=await this.normalize(input.imageBase64);return this.replaceMemberAssetNormalized(actor,assetId,input,image);
  }
  async uploadDisplayAsset(actor:MediaDisplayActor,albumId:string,input:MediaAssetUpload){const display=await liveDisplay(pool,actor,true);if(display.setup_id!==actor.setupId||!await hasDisplayAlbumAccess(pool,actor.householdId,actor.id,display.setup_id,albumId,'can_upload')||!await this.displayUploadAllowed(pool,actor))throw new DomainError('FORBIDDEN',403,{reason:'display_media_upload_not_granted'});const image=await this.normalize(input.imageBase64);return this.insertDisplayAsset(actor,albumId,input,image);}
  private async insertMemberAsset(actor:MediaMemberActor,albumId:string,input:MediaAssetUpload,image:NormalizedMediaImage){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);const current=await usage(client,actor.householdId);const album=await lockAlbum(client,actor.householdId,albumId);await requireAlbumPermission(client,actor,albumId,'can_upload');return this.insertAsset(client,actor.householdId,actor.membershipId,albumId,album.album_kind,input,image,current);});
  }
  private async insertDisplayAsset(actor:MediaDisplayActor,albumId:string,input:MediaAssetUpload,image:NormalizedMediaImage){
    return displayTransaction(actor,async(client)=>{const display=await liveDisplay(client,actor,true);if(display.setup_id!==actor.setupId)throw new DomainError('FORBIDDEN',403,{reason:'display_media_upload_not_granted'});const current=await usage(client,actor.householdId);const album=await lockAlbum(client,actor.householdId,albumId);if(!await hasDisplayAlbumAccess(client,actor.householdId,actor.id,display.setup_id,albumId,'can_upload'))throw new DomainError('FORBIDDEN',403,{reason:'display_media_upload_not_granted'});if(!await this.displayUploadAllowed(client,actor))throw new DomainError('FORBIDDEN',403,{reason:'display_action_not_granted'});return this.insertAsset(client,actor.householdId,null,albumId,album.album_kind,input,image,current,actor.id);});
  }
  private async displayUploadAllowed(client:DbClient,actor:MediaDisplayActor){const row=(await client.query<{allowed:boolean}>(`SELECT policy.photo_upload AS allowed FROM display_action_policies policy JOIN displays display ON display.household_id=policy.household_id AND display.id=policy.display_id WHERE policy.household_id=$1 AND policy.display_id=$2 AND display.revoked_at IS NULL AND display.privacy_mode=false FOR UPDATE OF policy,display`,[actor.householdId,actor.id])).rows[0];if(!row)throw new DomainError('UNAUTHENTICATED',401);return row.allowed;}
  private async insertAsset(client:DbClient,householdId:string,membershipId:string|null,albumId:string,albumKind:string,input:MediaAssetUpload,image:NormalizedMediaImage,current:UsageRow,displayId?:string){
    const bytes=image.master.length+image.preview.length;const used=BigInt(current.stored_bytes);if(current.asset_count>=current.max_assets||used+BigInt(bytes)>BigInt(current.max_bytes))throw new DomainError('VALIDATION_FAILED',413,{reason:'media_household_quota_exceeded',maxAssets:current.max_assets,maxBytes:Number(current.max_bytes)});
    const inserted=await client.query<{id:string}>(`INSERT INTO media_assets(household_id,album_id,title,description,original_mime,width,height,content_sha256,master_webp,preview_webp,created_by_membership_id,created_by_display_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,[householdId,albumId,input.title,input.description,image.originalMime,image.width,image.height,image.contentSha256,image.master,image.preview,membershipId,displayId??null]);
    const id=inserted.rows[0]!.id;const asset=(await client.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id WHERE asset.id=$1 AND asset.household_id=$2`,[id,householdId])).rows[0]!;
    return{asset:displayId?displayAssetMetadata(asset):assetMetadata(asset,householdId),remaining:{assets:current.max_assets-current.asset_count-1,bytes:Number(BigInt(current.max_bytes)-used-BigInt(bytes))}};
  }
  private async replaceMemberAssetNormalized(actor:MediaMemberActor,assetId:string,input:MediaAssetUpdate&{imageBase64:string},image:NormalizedMediaImage){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);const location=(await client.query<{album_id:string}>(`SELECT album_id FROM media_assets WHERE household_id=$1 AND id=$2`,[actor.householdId,assetId])).rows[0];if(!location)throw new DomainError('NOT_FOUND',404);const current=await usage(client,actor.householdId);const album=await lockAlbum(client,actor.householdId,location.album_id);const rights=await access(client,actor.householdId,album.id,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);const old=(await client.query<{revision:number;stored_bytes:string}>(`SELECT revision,stored_bytes::text FROM media_assets WHERE household_id=$1 AND id=$2 FOR UPDATE`,[actor.householdId,assetId])).rows[0];if(!old)throw new DomainError('NOT_FOUND',404);if(old.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:old.revision});const delta=BigInt(image.master.length+image.preview.length)-BigInt(old.stored_bytes);if(BigInt(current.stored_bytes)+delta>BigInt(current.max_bytes))throw new DomainError('VALIDATION_FAILED',413,{reason:'media_household_quota_exceeded',maxBytes:Number(current.max_bytes)});const revision=old.revision+1;await client.query(`UPDATE media_assets SET title=$3,description=$4,original_mime=$5,width=$6,height=$7,content_sha256=$8,master_webp=$9,preview_webp=$10,revision=$11,updated_at=clock_timestamp() WHERE household_id=$1 AND id=$2`,[actor.householdId,assetId,input.title,input.description,image.originalMime,image.width,image.height,image.contentSha256,image.master,image.preview,revision]);return{assetId,revision,storedBytes:image.master.length+image.preview.length};});
  }
  async updateAsset(actor:MediaMemberActor,assetId:string,input:MediaAssetUpdate){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);const location=(await client.query<{album_id:string}>(`SELECT album_id FROM media_assets WHERE household_id=$1 AND id=$2`,[actor.householdId,assetId])).rows[0];if(!location)throw new DomainError('NOT_FOUND',404);await usage(client,actor.householdId);const album=await lockAlbum(client,actor.householdId,location.album_id);const rights=await requireAlbumPermission(client,actor,album.id,'can_manage');if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);const row=(await client.query<{revision:number}>(`SELECT revision FROM media_assets WHERE household_id=$1 AND id=$2 FOR UPDATE`,[actor.householdId,assetId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:row.revision});const revision=row.revision+1;await client.query('UPDATE media_assets SET title=$3,description=$4,revision=$5,updated_at=clock_timestamp() WHERE household_id=$1 AND id=$2',[actor.householdId,assetId,input.title,input.description,revision]);return{assetId,revision,title:input.title,description:input.description};});
  }
  async deleteAsset(actor:MediaMemberActor,assetId:string,input:MediaAssetDelete){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);const first=(await client.query<{album_id:string}>(`SELECT album_id FROM media_assets WHERE household_id=$1 AND id=$2`,[actor.householdId,assetId])).rows[0];if(!first)throw new DomainError('NOT_FOUND',404);const current=await usage(client,actor.householdId);const album=await lockAlbum(client,actor.householdId,first.album_id);const rights=await access(client,actor.householdId,album.id,actor.membershipId);if(!rights.is_owner&&!rights.can_manage)throw new DomainError('FORBIDDEN',403);await client.query(`UPDATE display_setups SET background_id=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND background_id=$2`,[actor.householdId,assetId]);const row=(await client.query<{revision:number;stored_bytes:string}>(`SELECT revision,stored_bytes::text FROM media_assets WHERE household_id=$1 AND id=$2 FOR UPDATE`,[actor.householdId,assetId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:row.revision});await client.query('UPDATE media_household_settings SET background_asset_id=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND background_asset_id=$2',[actor.householdId,assetId]);await client.query('DELETE FROM media_assets WHERE household_id=$1 AND id=$2',[actor.householdId,assetId]);return{assetId,deleted:true,remaining:{assets:current.max_assets-current.asset_count+1,bytes:Number(BigInt(current.max_bytes)-BigInt(current.stored_bytes)+BigInt(row.stored_bytes))}};});
  }
  async setHouseholdBackground(actor:MediaMemberActor,input:MediaBackgroundUpdate){
    return memberTransaction(actor,async(client)=>{const live=await liveMember(client,actor);if(!live.capabilities.includes('household.manage'))throw new DomainError('FORBIDDEN',403);await usage(client,actor.householdId);const current=(await client.query<{revision:number}>('SELECT revision FROM media_household_settings WHERE household_id=$1 FOR UPDATE',[actor.householdId])).rows[0]??{revision:1};if(current.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:current.revision});if(input.assetId){const row=(await client.query<{album_id:string;album_kind:string}>(`SELECT asset.album_id,album.album_kind FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id WHERE asset.household_id=$1 AND asset.id=$2`,[actor.householdId,input.assetId])).rows[0];if(!row||row.album_kind!=='backgrounds')throw new DomainError('NOT_FOUND',404);await requireAlbumPermission(client,actor,row.album_id,'can_read');}const revision=current.revision+1;await client.query(`INSERT INTO media_household_settings(household_id,background_asset_id,revision,updated_at) VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(household_id) DO UPDATE SET background_asset_id=EXCLUDED.background_asset_id,revision=EXCLUDED.revision,updated_at=clock_timestamp()`,[actor.householdId,input.assetId,revision]);return{backgroundAssetId:input.assetId,revision};});
  }
  async householdBackground(actor:MediaMemberActor){
    await liveMember(pool,actor);await pool.query('INSERT INTO media_household_settings(household_id) VALUES($1) ON CONFLICT(household_id) DO NOTHING',[actor.householdId]);const row=(await pool.query<AssetRow&{selected_revision:number}>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at,setting.revision AS selected_revision FROM media_household_settings setting LEFT JOIN media_assets asset ON asset.household_id=setting.household_id AND asset.id=setting.background_asset_id LEFT JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id WHERE setting.household_id=$1`,[actor.householdId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);if(!row.id)return{background:null,revision:row.selected_revision};const rights=await access(pool,actor.householdId,row.album_id,actor.membershipId);return{background:rights.is_owner||rights.can_read?assetMetadata(row,actor.householdId):null,revision:row.selected_revision};
  }
  async displayProjection(actor:MediaDisplayActor){
    const display=await liveDisplay(pool,actor);if(display.setup_id!==actor.setupId||display.privacy_mode)return{albums:[],background:null,householdBackground:null};
    const albums=(await pool.query<{id:string;name:string;asset_count:number}>(`SELECT album.id,album.name,count(asset.id)::int AS asset_count FROM display_setups setup CROSS JOIN LATERAL jsonb_array_elements_text(setup.album_ids) selected(album_id) JOIN media_albums album ON album.household_id=setup.household_id AND album.id=selected.album_id::uuid AND album.album_kind='photos' JOIN media_album_display_grants grant_row ON grant_row.household_id=album.household_id AND grant_row.album_id=album.id AND grant_row.display_id=$3 AND grant_row.can_read LEFT JOIN media_assets asset ON asset.household_id=album.household_id AND asset.album_id=album.id WHERE setup.household_id=$1 AND setup.id=$2 AND setup.cards ? 'photos' GROUP BY album.id,album.name ORDER BY album.name,album.id`,[actor.householdId,actor.setupId,actor.id])).rows;
    const assets=(await pool.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at FROM display_setups setup CROSS JOIN LATERAL jsonb_array_elements_text(setup.album_ids) selected(album_id) JOIN media_albums album ON album.household_id=setup.household_id AND album.id=selected.album_id::uuid AND album.album_kind='photos' JOIN media_album_display_grants grant_row ON grant_row.household_id=album.household_id AND grant_row.album_id=album.id AND grant_row.display_id=$3 AND grant_row.can_read JOIN media_assets asset ON asset.household_id=album.household_id AND asset.album_id=album.id WHERE setup.household_id=$1 AND setup.id=$2 AND setup.cards ? 'photos' ORDER BY asset.created_at,asset.id LIMIT 250`,[actor.householdId,actor.setupId,actor.id])).rows;
    const backgroundId=(await pool.query<{id:string|null}>(`SELECT CASE WHEN grant_row.can_read THEN setup.background_id END AS id FROM display_setups setup LEFT JOIN media_assets asset ON asset.household_id=setup.household_id AND asset.id=setup.background_id LEFT JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$3 WHERE setup.household_id=$1 AND setup.id=$2`,[actor.householdId,actor.setupId,actor.id])).rows[0]?.id;
    const background=backgroundId?await selectedDisplayAsset(pool,actor.householdId,actor.id,actor.setupId,backgroundId,false):undefined;
    const householdBackgroundId=(await pool.query<{id:string|null}>(`SELECT CASE WHEN grant_row.can_read THEN setting.background_asset_id END AS id FROM media_household_settings setting LEFT JOIN media_assets asset ON asset.household_id=setting.household_id AND asset.id=setting.background_asset_id LEFT JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$2 WHERE setting.household_id=$1`,[actor.householdId,actor.id])).rows[0]?.id;
    const householdBackground=householdBackgroundId?await selectedDisplayAsset(pool,actor.householdId,actor.id,actor.setupId,householdBackgroundId,false):undefined;
    return{albums,assets:assets.map(displayAssetMetadata),background:background?displayAssetMetadata(background):null,householdBackground:householdBackground?displayAssetMetadata(householdBackground):null};
  }
  async previewProjection(manager:MediaMemberActor,actor:MediaDisplayActor,selection:MediaPreviewSelection,selectionTag:string){
    return transaction(async(client)=>{
      const managerState=await liveMember(client,manager);if(!managerState.capabilities.includes('display.manage'))throw new DomainError('FORBIDDEN',403);
      const device=await liveDisplay(client,actor);if(device.privacy_mode)return{albums:[],assets:[],background:null};
      const albums=selection.cards.includes('photos')&&selection.albumIds.length?(await client.query<{id:string;name:string;asset_count:number}>(`SELECT album.id,album.name,count(asset.id)::int AS asset_count
        FROM media_albums album JOIN media_album_display_grants grant_row ON grant_row.household_id=album.household_id AND grant_row.album_id=album.id AND grant_row.display_id=$3 AND grant_row.can_read
        LEFT JOIN media_assets asset ON asset.household_id=album.household_id AND asset.album_id=album.id
        WHERE album.household_id=$1 AND album.id=ANY($2::uuid[]) AND album.album_kind='photos' GROUP BY album.id,album.name ORDER BY album.name,album.id`,[manager.householdId,selection.albumIds,actor.id])).rows:[];
      const assets=selection.cards.includes('photos')&&selection.albumIds.length?(await client.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at
        FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id
        JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$3 AND grant_row.can_read
        WHERE asset.household_id=$1 AND asset.album_id=ANY($2::uuid[]) AND album.album_kind='photos' ORDER BY asset.created_at,asset.id LIMIT 250`,[manager.householdId,selection.albumIds,actor.id])).rows:[];
      const background=selection.backgroundId?(await client.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at
        FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id
        JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$3 AND grant_row.can_read
        WHERE asset.household_id=$1 AND asset.id=$2 AND album.album_kind='backgrounds'`,[manager.householdId,selection.backgroundId,actor.id])).rows[0]:undefined;
      const householdBackground=(await client.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at
        FROM media_household_settings setting JOIN media_assets asset ON asset.household_id=setting.household_id AND asset.id=setting.background_asset_id
        JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id AND album.album_kind='backgrounds'
        JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$2 AND grant_row.can_read
        WHERE setting.household_id=$1`,[manager.householdId,actor.id])).rows[0];
      const metadata=(asset:AssetRow)=>{const path=`/api/v1/households/${manager.householdId}/displays/${actor.id}/preview/assets/${asset.id}`;return{id:asset.id,albumId:asset.album_id,kind:asset.album_kind,revision:asset.revision,title:asset.title,description:asset.description,mimeType:'image/webp',width:asset.width,height:asset.height,url:`${path}/master?v=${asset.revision}&s=${selectionTag}`,previewUrl:`${path}/preview?v=${asset.revision}&s=${selectionTag}`};};
      await liveMember(client,manager);await liveDisplay(client,actor);
      return{albums,assets:assets.map(metadata),background:background?metadata(background):null,householdBackground:householdBackground?metadata(householdBackground):null};
    });
  }
  async assetBytesMember(actor:MediaMemberActor,assetId:string,variant:'master'|'preview',revision:number,ifNoneMatch?:string){
    return memberTransaction(actor,async(client)=>{await liveMember(client,actor);const location=(await client.query<{album_id:string}>(`SELECT album_id FROM media_assets WHERE household_id=$1 AND id=$2`,[actor.householdId,assetId])).rows[0];if(!location)throw new DomainError('NOT_FOUND',404);const album=await lockAlbum(client,actor.householdId,location.album_id);await requireAlbumPermission(client,actor,album.id,'can_read');const header=(await client.query<{revision:number;master_webp:Buffer;preview_webp:Buffer;content_sha256:string}>(`SELECT revision,master_webp,preview_webp,content_sha256 FROM media_assets WHERE household_id=$1 AND id=$2 FOR SHARE`,[actor.householdId,assetId])).rows[0];if(!header||header.revision!==revision)throw new DomainError('NOT_FOUND',404);return this.conditionalImage(variant==='master'?header.master_webp:header.preview_webp,header.revision,header.content_sha256,variant,ifNoneMatch);});
  }
  async assetBytesDisplay(actor:MediaDisplayActor,assetId:string,variant:'master'|'preview',revision:number,ifNoneMatch?:string){
    return transaction(async(client)=>{const display=await liveDisplay(client,actor);if(display.setup_id!==actor.setupId||display.privacy_mode)throw new DomainError('NOT_FOUND',404);const visible=await selectedDisplayAsset(client,actor.householdId,actor.id,display.setup_id,assetId,false);if(!visible||visible.revision!==revision)throw new DomainError('NOT_FOUND',404);const row=(await client.query<{master_webp:Buffer;preview_webp:Buffer}>(`SELECT master_webp,preview_webp FROM media_assets WHERE household_id=$1 AND id=$2`,[actor.householdId,assetId])).rows[0]!;await liveDisplay(client,actor);return this.conditionalImage(variant==='master'?row.master_webp:row.preview_webp,visible.revision,visible.content_sha256,variant,ifNoneMatch);});
  }
  async previewAssetBytes(manager:MediaMemberActor,actor:MediaDisplayActor,selection:MediaPreviewSelection,assetId:string,variant:'master'|'preview',revision:number,ifNoneMatch?:string){
    return transaction(async(client)=>{
      const managerState=await liveMember(client,manager);
      if(!managerState.capabilities.includes('display.manage'))throw new DomainError('FORBIDDEN',403);
      const device=await liveDisplay(client,actor);
      if(device.privacy_mode)throw new DomainError('NOT_FOUND',404);
      const asset=(await client.query<AssetRow>(`SELECT asset.id,asset.album_id,album.album_kind,asset.revision,asset.title,asset.description,asset.original_mime,asset.width,asset.height,asset.content_sha256,asset.stored_bytes,asset.created_at,asset.updated_at
        FROM media_assets asset JOIN media_albums album ON album.household_id=asset.household_id AND album.id=asset.album_id
        JOIN media_album_display_grants grant_row ON grant_row.household_id=asset.household_id AND grant_row.album_id=asset.album_id AND grant_row.display_id=$3 AND grant_row.can_read
        WHERE asset.household_id=$1 AND asset.id=$2 FOR SHARE OF asset,grant_row`,[manager.householdId,assetId,actor.id])).rows[0];
      let selected=false;
      if(asset?.album_kind==='photos')selected=selection.cards.includes('photos')&&selection.albumIds.includes(asset.album_id);
      else if(asset?.album_kind==='backgrounds')selected=selection.backgroundId===asset.id||Boolean((await client.query(`SELECT 1 FROM media_household_settings WHERE household_id=$1 AND background_asset_id=$2`,[manager.householdId,asset.id])).rowCount);
      if(!asset||!selected||asset.revision!==revision)throw new DomainError('NOT_FOUND',404);
      const bytes=(await client.query<{master_webp:Buffer;preview_webp:Buffer}>(`SELECT master_webp,preview_webp FROM media_assets WHERE household_id=$1 AND id=$2`,[manager.householdId,assetId])).rows[0]!;
      await liveMember(client,manager);await liveDisplay(client,actor);
      return this.conditionalImage(variant==='master'?bytes.master_webp:bytes.preview_webp,asset.revision,asset.content_sha256,variant,ifNoneMatch);
    });
  }
  private conditionalImage(bytes:Buffer,revision:number,sha:string,variant:string,ifNoneMatch?:string){const etag=`"media-${revision}-${sha.slice(0,16)}-${variant}"`;return{bytes,etag,notModified:ifNoneMatch===etag,contentType:'image/webp' as const};}
}

export const mediaService=new MediaService();
