import type { MediaAlbum, MediaAsset } from './media-adapters';

export type HomePhotoPreviewState={householdId:string;album:MediaAlbum|null;assets:MediaAsset[];stale:boolean};

export function emptyHomePhotoPreview(householdId:string):HomePhotoPreviewState{return{householdId,album:null,assets:[],stale:false};}

export function homePhotoPreviewSuccess(householdId:string,album:MediaAlbum|null,assets:MediaAsset[]):HomePhotoPreviewState{
 if(!album||album.kind!=='photos'||!album.permissions.read)return emptyHomePhotoPreview(householdId);
 const authorizedAssets=assets.filter(asset=>asset.albumId===album.id&&asset.kind==='photos');
 return authorizedAssets.length?{householdId,album,assets:authorizedAssets,stale:false}:emptyHomePhotoPreview(householdId);
}

export function homePhotoPreviewFailure(state:HomePhotoPreviewState,householdId:string,status?:number):HomePhotoPreviewState{
 if(state.householdId!==householdId||[401,403,404].includes(status??0))return emptyHomePhotoPreview(householdId);
 return state.album&&state.assets.length?{...state,stale:true}:emptyHomePhotoPreview(householdId);
}
