import assert from 'node:assert/strict';
import test from 'node:test';
import type { MediaAlbum, MediaAsset } from '../src/media-adapters';
import { emptyHomePhotoPreview, homePhotoPreviewFailure, homePhotoPreviewSuccess } from '../src/home-media-presentation';

const album:MediaAlbum={id:'synthetic-album-a',name:'Synthetic album',kind:'photos',revision:1,owner:false,permissions:{read:true,upload:false,manage:false},assetCount:1};
const asset:MediaAsset={id:'synthetic-asset-a',albumId:album.id,kind:'photos',revision:1,title:'Synthetic photo',description:'',mimeType:'image/webp',width:640,height:480,url:'/synthetic/photo',previewUrl:'/synthetic/preview'};

test('home photo preview never carries authorized assets into another household scope or after revocation',()=>{
 const projected=homePhotoPreviewSuccess('synthetic-household-a',album,[asset]);
 assert.equal(projected.assets.length,1);
 assert.deepEqual(homePhotoPreviewFailure(projected,'synthetic-household-b'),emptyHomePhotoPreview('synthetic-household-b'));
 for(const status of [401,403,404])assert.deepEqual(homePhotoPreviewFailure(projected,'synthetic-household-a',status),emptyHomePhotoPreview('synthetic-household-a'));
});

test('home photo preview keeps only album-matching readable photo assets and marks temporary stale reads',()=>{
 const otherAlbum={...asset,id:'synthetic-asset-b',albumId:'synthetic-album-b'};
 const unrelatedKind={...asset,id:'synthetic-asset-c',kind:'backgrounds' as const};
 const projected=homePhotoPreviewSuccess('synthetic-household-a',album,[asset,otherAlbum,unrelatedKind]);
 assert.deepEqual(projected.assets.map(item=>item.id),[asset.id]);
 assert.equal(homePhotoPreviewFailure(projected,'synthetic-household-a',503).stale,true);
 assert.equal(homePhotoPreviewSuccess('synthetic-household-a',{...album,permissions:{...album.permissions,read:false}},[asset]).assets.length,0);
});
