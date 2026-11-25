import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {normalizeMediaImage,MAX_MEDIA_INPUT_BYTES} from './image.ts';

test('media normalization rotates EXIF orientation, preserves aspect ratio and strips source metadata',async()=>{
  const source=await sharp({create:{width:40,height:20,channels:3,background:{r:90,g:130,b:170}}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const result=await normalizeMediaImage(source.toString('base64'));
  assert.equal(result.originalMime,'image/jpeg');
  assert.deepEqual([result.width,result.height],[20,40]);
  for(const bytes of [result.master,result.preview]){
    const metadata=await sharp(bytes).metadata();
    assert.equal(metadata.format,'webp');
    assert.equal(metadata.orientation,undefined);
    assert.equal(metadata.exif,undefined);
    assert.ok(metadata.width!<=2560&&metadata.height!<=2560);
    assert.ok(Math.abs(metadata.width!/metadata.height!-0.5)<0.03);
  }
});

test('media normalization rejects oversized input before decoding',async()=>{
  const oversized=Buffer.alloc(MAX_MEDIA_INPUT_BYTES+1).toString('base64');
  await assert.rejects(normalizeMediaImage(oversized),error=>{
    assert.equal((error as {details?:{reason?:string}}).details?.reason,'photo_too_large');
    return true;
  });
});

test('media normalization preserves AVIF source type when the configured decoder supports it',async()=>{
  if(!sharp.format.heif.input.buffer||!sharp.format.heif.output.buffer)return;
  const source=await sharp({create:{width:16,height:8,channels:3,background:{r:15,g:45,b:75}}}).avif().toBuffer();
  const result=await normalizeMediaImage(source.toString('base64'));
  assert.equal(result.originalMime,'image/avif');
  assert.equal((await sharp(result.master).metadata()).format,'webp');
});
