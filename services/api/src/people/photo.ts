import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DomainError } from '@samvev/core';

export const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_PHOTO_PIXELS = 40_000_000;
const acceptedFormats = new Set(['jpeg','png','webp','avif','heif']);
const formatMime:Record<string,string>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',heif:'image/heif'};

export interface NormalizedProfilePhoto {
  originalMime:string;
  width:number;
  height:number;
  contentSha256:string;
  variant96:Buffer;
  variant512:Buffer;
}

function decodeBase64(value:string):Buffer{
  const bytes=Buffer.from(value,'base64');
  if(!bytes.length||bytes.length>MAX_PROFILE_PHOTO_BYTES)throw new DomainError('VALIDATION_FAILED',400,{reason:bytes.length?'photo_too_large':'photo_empty'});
  if(bytes.toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,''))throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_base64_invalid'});
  return bytes;
}

export async function normalizeProfilePhoto(imageBase64:string,crop?:{x:number;y:number;width:number;height:number}):Promise<NormalizedProfilePhoto>{
  const input=decodeBase64(imageBase64);
  let metadata:Awaited<ReturnType<sharp.Sharp['metadata']>>;
  try{metadata=await sharp(input,{failOn:'warning',limitInputPixels:MAX_PROFILE_PHOTO_PIXELS}).metadata();}
  catch{throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_invalid'});}
  if(!metadata.format||!acceptedFormats.has(metadata.format)||!metadata.width||!metadata.height)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_format_invalid'});
  if(metadata.width>12000||metadata.height>12000||metadata.width*metadata.height>MAX_PROFILE_PHOTO_PIXELS)throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_dimensions_too_large'});
  let normalized=sharp(input,{failOn:'warning',limitInputPixels:MAX_PROFILE_PHOTO_PIXELS}).rotate();
  const swapsAxes=metadata.orientation!==undefined && metadata.orientation>=5 && metadata.orientation<=8;
  const orientedWidth=swapsAxes?metadata.height:metadata.width;
  const orientedHeight=swapsAxes?metadata.width:metadata.height;
  if(crop){
    const left=Math.min(orientedWidth-1,Math.floor(crop.x*orientedWidth));
    const top=Math.min(orientedHeight-1,Math.floor(crop.y*orientedHeight));
    const width=Math.max(1,Math.min(orientedWidth-left,Math.round(crop.width*orientedWidth)));
    const height=Math.max(1,Math.min(orientedHeight-top,Math.round(crop.height*orientedHeight)));
    normalized=normalized.extract({left,top,width,height});
  }
  try{
    const [variant96,variant512]=await Promise.all([
      normalized.clone().resize(96,96,{fit:'cover',position:'centre'}).webp({quality:82,effort:4}).toBuffer(),
      normalized.clone().resize(512,512,{fit:'cover',position:'centre',withoutEnlargement:true}).webp({quality:86,effort:4}).toBuffer()
    ]);
    return {originalMime:formatMime[metadata.format]!,width:orientedWidth,height:orientedHeight,contentSha256:createHash('sha256').update(input).digest('hex'),variant96,variant512};
  }catch{throw new DomainError('VALIDATION_FAILED',400,{reason:'photo_invalid'});}
}
