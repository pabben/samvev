import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {DomainError} from '@samvev/core';

export const MAX_MEDIA_INPUT_BYTES=10*1024*1024;
export const MAX_MEDIA_PIXELS=40_000_000;
export const MAX_MEDIA_EDGE=12_000;
export const MEDIA_MASTER_EDGE=2_560;
export const MEDIA_PREVIEW_EDGE=720;
const supportedInputFormats=new Set(['jpeg','png','webp','avif','heif']);
const inputMime:Record<string,string>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',heif:'image/heif'};

export interface NormalizedMediaImage {
  originalMime:string;
  width:number;
  height:number;
  contentSha256:string;
  master:Buffer;
  preview:Buffer;
}

function decodeBase64(value:string):Buffer{
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_invalid'});
  if(bytes.length>MAX_MEDIA_INPUT_BYTES)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_too_large'});
  if(bytes.toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,''))throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_invalid'});
  return bytes;
}

export async function normalizeMediaImage(imageBase64:string):Promise<NormalizedMediaImage>{
  const input=decodeBase64(imageBase64);
  let metadata:Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try{metadata=await sharp(input,{failOn:'warning',limitInputPixels:MAX_MEDIA_PIXELS}).metadata();}
  catch{throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_invalid'});}
  if(!metadata.format||!supportedInputFormats.has(metadata.format)||!metadata.width||!metadata.height)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_format_invalid'});
  if(!sharp.format[metadata.format]?.input.file)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_format_invalid'});
  if(metadata.width>MAX_MEDIA_EDGE||metadata.height>MAX_MEDIA_EDGE||metadata.width*metadata.height>MAX_MEDIA_PIXELS)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_dimensions_too_large'});
  const swapsAxes=metadata.orientation!==undefined&&metadata.orientation>=5&&metadata.orientation<=8;
  const width=swapsAxes?metadata.height:metadata.width,height=swapsAxes?metadata.width:metadata.height;
  try{
    const normalized=sharp(input,{failOn:'warning',limitInputPixels:MAX_MEDIA_PIXELS}).rotate();
    const [master,preview]=await Promise.all([
      normalized.clone().resize(MEDIA_MASTER_EDGE,MEDIA_MASTER_EDGE,{fit:'inside',withoutEnlargement:true}).webp({quality:88,effort:4}).toBuffer(),
      normalized.clone().resize(MEDIA_PREVIEW_EDGE,MEDIA_PREVIEW_EDGE,{fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:4}).toBuffer()
    ]);
    const originalMime=metadata.format==='heif'&&metadata.mediaType==='image/avif'?'image/avif':inputMime[metadata.format]!;
    return{originalMime,width,height,contentSha256:createHash('sha256').update(input).digest('hex'),master,preview};
  }catch(error){
    if(error instanceof DomainError)throw error;
    throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_invalid'});
  }
}
