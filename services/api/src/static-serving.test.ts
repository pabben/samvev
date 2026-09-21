import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildApp} from './app.ts';
import {pool} from './db.ts';

test('static serving discovers new build assets after startup and never uses SPA HTML for missing assets',async()=>{
  const webRoot=await mkdtemp(join(tmpdir(),'samvev-static-'));
  await mkdir(join(webRoot,'assets'));
  await writeFile(join(webRoot,'index.html'),'<!doctype html><script type="module" src="/assets/initial.js"></script>');
  await writeFile(join(webRoot,'assets','initial.js'),'export const build="initial";');
  const app=await buildApp({webRoot});
  try{
    await writeFile(join(webRoot,'assets','current-a1b2.js'),'export const build="current";');
    await writeFile(join(webRoot,'index.html'),'<!doctype html><script type="module" src="/assets/current-a1b2.js"></script>');

    const index=await app.inject({method:'GET',url:'/'});
    assert.equal(index.statusCode,200,index.body);
    assert.match(index.headers['content-type']??'',/text\/html/);
    assert.match(index.body,/current-a1b2\.js/);

    const asset=await app.inject({method:'GET',url:'/assets/current-a1b2.js'});
    assert.equal(asset.statusCode,200,asset.body);
    assert.match(asset.headers['content-type']??'',/javascript/);
    assert.equal(asset.body,'export const build="current";');

    const missing=await app.inject({method:'GET',url:'/assets/missing-deadbeef.js'});
    assert.equal(missing.statusCode,404,missing.body);
    assert.match(missing.headers['content-type']??'',/application\/json/);
    assert.doesNotMatch(missing.body,/doctype|current-a1b2/i);

    const clientRoute=await app.inject({method:'GET',url:'/invitation'});
    assert.equal(clientRoute.statusCode,200,clientRoute.body);
    assert.match(clientRoute.headers['content-type']??'',/text\/html/);
    assert.match(clientRoute.body,/current-a1b2\.js/);

    for(const reserved of ['/api','/assets']){
      const response=await app.inject({method:'GET',url:reserved});
      assert.equal(response.statusCode,404,response.body);
      assert.match(response.headers['content-type']??'',/application\/json/);
      assert.doesNotMatch(response.body,/doctype|current-a1b2/i);
    }

    const unknownPost=await app.inject({method:'POST',url:'/invitation'});
    assert.equal(unknownPost.statusCode,404,unknownPost.body);
    assert.match(unknownPost.headers['content-type']??'',/application\/json/);
    assert.doesNotMatch(unknownPost.body,/doctype|current-a1b2/i);

    const missingApi=await app.inject({method:'GET',url:'/api/v1/does-not-exist'});
    assert.equal(missingApi.statusCode,404,missingApi.body);
    assert.equal(missingApi.json().error.code,'NOT_FOUND');
  }finally{
    await app.close();
    await rm(webRoot,{recursive:true,force:true});
    await pool.end();
  }
});
