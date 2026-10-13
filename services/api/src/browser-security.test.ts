import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import { CONTENT_SECURITY_POLICY, browserSecurityHeaders } from './browser-security.ts';
import { pool } from './db.ts';

const expectedHeaders={
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'SAMEORIGIN',
  'content-security-policy':CONTENT_SECURITY_POLICY
} as const;

function assertBrowserHeaders(response:LightMyRequestResponse,expectHsts:boolean):void{
  for(const [name,value] of Object.entries(expectedHeaders))assert.equal(response.headers[name],value,`${name} on ${response.statusCode}`);
  assert.equal(response.headers['strict-transport-security'],expectHsts?'max-age=86400':undefined);
}

test('browser security headers cover static, unauthorized and not-found responses while HSTS follows canonical configuration',async()=>{
  const webRoot=await mkdtemp(join(tmpdir(),'samvev-browser-security-'));
  await mkdir(join(webRoot,'assets'));
  await writeFile(join(webRoot,'index.html'),'<!doctype html><html><body>Samvev</body></html>');
  const insecure=await buildApp({webRoot,runtimeConfig:{publicOrigin:'http://127.0.0.1:4173',secureCookies:false,trustProxy:false}});
  try{
    const staticResponse=await insecure.inject({method:'GET',url:'/',headers:{'x-forwarded-proto':'https'}});
    assert.equal(staticResponse.statusCode,200,staticResponse.body);
    assertBrowserHeaders(staticResponse,false);

    const unauthorized=await insecure.inject({method:'GET',url:'/api/v1/me',headers:{'x-forwarded-proto':'https'}});
    assert.equal(unauthorized.statusCode,401,unauthorized.body);
    assertBrowserHeaders(unauthorized,false);

    const missing=await insecure.inject({method:'GET',url:'/api/v1/missing',headers:{'x-forwarded-proto':'https'}});
    assert.equal(missing.statusCode,404,missing.body);
    assertBrowserHeaders(missing,false);
  }finally{
    await insecure.close();
  }

  const secure=await buildApp({webRoot,runtimeConfig:{publicOrigin:'https://samvev.test',secureCookies:true,trustProxy:false}});
  try{
    const response=await secure.inject({method:'GET',url:'/',headers:{'x-forwarded-proto':'http'}});
    assert.equal(response.statusCode,200,response.body);
    assertBrowserHeaders(response,true);
  }finally{
    await secure.close();
    await rm(webRoot,{recursive:true,force:true});
    await pool.end();
  }
});

test('raw response headers use the same policy and add no preload or subdomain scope',()=>{
  const insecure=browserSecurityHeaders(false);
  assert.deepEqual(insecure,{
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'SAMEORIGIN',
    'Content-Security-Policy':CONTENT_SECURITY_POLICY
  });
  const secure=browserSecurityHeaders(true);
  assert.equal(secure['Strict-Transport-Security'],'max-age=86400');
  assert.doesNotMatch(secure['Strict-Transport-Security']??'',/includeSubDomains|preload/i);
});
