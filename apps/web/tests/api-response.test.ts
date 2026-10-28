import assert from 'node:assert/strict';
import test from 'node:test';
import {api,ApiError} from '../src/api.ts';

async function withResponse(response:Response,work:()=>Promise<void>){
  const original=globalThis.fetch;
  globalThis.fetch=async()=>response;
  try{await work();}finally{globalThis.fetch=original;}
}

test('a 200 response whose body aborts is an offline error, not an invalid display credential',async()=>{
  const response=new Response(null,{status:200});
  response.json=async()=>{throw new DOMException('Synthetic body timeout','AbortError');};
  await withResponse(response,async()=>{
    await assert.rejects(api('/display/projection'),error=>error instanceof ApiError&&error.status===0&&error.code==='OFFLINE');
  });
});

test('invalid JSON after successful headers retains status zero for uncertain cookie outcomes',async()=>{
  await withResponse(new Response('synthetic invalid JSON',{status:200}),async()=>{
    await assert.rejects(api('/display/pairing/redeem','POST',{}),error=>error instanceof ApiError&&error.status===0&&error.code==='OFFLINE');
  });
});

test('body-read failure preserves the external lease-loss reason',async()=>{
  const external=new AbortController(),reason=new Error('display_redeem_lock_lost');
  const response=new Response(null,{status:200});
  response.json=async()=>{external.abort(reason);throw new DOMException('Synthetic aborted body','AbortError');};
  await withResponse(response,async()=>{
    await assert.rejects(api('/display/pairing/redeem','POST',{}, {signal:external.signal}),error=>error===reason);
  });
});

test('HTTP rejection keeps its status and bounded server error details',async()=>{
  await withResponse(Response.json({error:{code:'DISPLAY_REVOKED',details:{retryable:false}}},{status:403}),async()=>{
    await assert.rejects(api('/display/projection'),error=>error instanceof ApiError&&error.status===403&&error.code==='DISPLAY_REVOKED'&&error.details?.retryable===false);
  });
  await withResponse(new Response('synthetic non-JSON error',{status:401}),async()=>{
    await assert.rejects(api('/display/projection'),error=>error instanceof ApiError&&error.status===401&&error.code==='INTERNAL_ERROR');
  });
});

test('a successful no-content response does not attempt a JSON body read',async()=>{
  await withResponse(new Response(null,{status:204}),async()=>{
    assert.equal(await api('/display/disconnect','POST',{}),undefined);
  });
});
