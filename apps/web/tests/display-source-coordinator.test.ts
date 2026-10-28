import assert from 'node:assert/strict';
import test from 'node:test';
import {createDisplaySourceCoordinator,type DisplaySourceLock,type DisplaySourceStorage} from '../src/display-source-coordinator.ts';
import {canCompleteDisplayPairing,displayCredentialLossKnown,isCurrentDisplayCallback,sameDisplaySourceEvent,type DisplaySourceEvent} from '../src/display-source-session.ts';
import {createDisplayRedeemLeaseRunner,type DisplayRedeemLeaseStore} from '../src/display-redeem-lock.ts';
import {requestAbortSignal} from '../src/api.ts';
import type {CachedProjection} from '../src/display-cache.ts';

const auth=(id:string,epoch:number):DisplaySourceEvent=>({kind:'authorized',displayId:id,epoch});
function sharedRealms(initial:DisplaySourceEvent|null=auth('A',1)){
  let event=initial,cache:string|null=null,tail:Promise<void>=Promise.resolve(),storageFails=false;
  const events:DisplaySourceEvent[]=[];
  const store:DisplaySourceStorage={
    read:()=>{if(storageFails)throw new Error('display_source_unavailable');return event;},
    writable:()=>{if(storageFails)throw new Error('display_source_unavailable');},
    write:value=>{if(storageFails)throw new Error('display_source_unavailable');event={...value};},
    readCache:()=>cache,writeCache:value=>{cache=value;},removeCache:()=>{cache=null;},notify:value=>{events.push(value);}
  };
  const lock:DisplaySourceLock=async work=>{let release!:()=>void;const previous=tail;tail=new Promise<void>(resolve=>{release=resolve;});await previous;try{return await work(new AbortController().signal,async()=>{});}finally{release();}};
  return{store,lock,events,A:createDisplaySourceCoordinator(store,lock),B:createDisplaySourceCoordinator(store,lock),cache:()=>cache,failStorage:()=>{storageFails=true;}};
}
function snapshot(id:string,at=1):CachedProjection{return{projection:{display:{id,name:'Synthetic display',householdName:'Synthetic household',locale:'en',theme:'light',privacyMode:false},serverNow:new Date(at).toISOString(),generatedAt:new Date(at).toISOString(),cacheUntil:new Date(at+900000).toISOString(),maxStaleSeconds:900,cards:[]},savedAt:at,lastUpdated:new Date(at).toISOString()};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}

test('queued cross-tab events cannot let old ACK, SSE or 401 callbacks revoke the new canonical source',async()=>{
  const realms=sharedRealms(),old=realms.A.read();
  const token={displayId:'A',epoch:1,generation:3,canonical:old};
  const transition=await realms.B.redeem(old,async()=>({id:'B'}));assert.equal(transition.applied,true);
  await realms.B.saveProjection(transition.event,snapshot('B'));const saved=realms.cache();
  // Realm A has deliberately not received the queued storage/Broadcast event.
  for(const callback of ['ACK','SSE','401']){
    assert.equal(isCurrentDisplayCallback(token,token,realms.A.read()),false,callback);
    const stale=await realms.A.revoke(old);assert.equal(stale.applied,false,callback);
    assert.equal(realms.cache(),saved);assert.deepEqual(realms.A.read(),transition.event);
  }
});

test('late old GET success cannot publish authorization, overwrite cache or delete a newer source cache',async()=>{
  const realms=sharedRealms(),old=realms.A.read();
  const initial=await realms.A.saveProjection(old,snapshot('A'));const oldValue=initial.cacheValue!;
  const transitioned=await realms.B.redeem(old,async()=>({id:'B'}));const fresh=await realms.B.saveProjection(transitioned.event,snapshot('B',2));
  assert.equal((await realms.A.saveProjection(old,snapshot('A',3))).applied,false);
  await realms.A.removeCache(old,oldValue);assert.equal(realms.cache(),fresh.cacheValue);
  // Even the same source epoch can have a newer successful cache snapshot.
  const newer=await realms.B.saveProjection(transitioned.event,snapshot('B',4));
  await realms.B.removeCache(transitioned.event,fresh.cacheValue!);assert.equal(realms.cache(),newer.cacheValue);
});

test('409 privacy changes discard the old projection cache and permit only one immediate fresh retry without revoking credentials',async()=>{
  const realms=sharedRealms(),source=realms.A.read();
  const privateValue=snapshot('A');privateValue.projection.cards=[{id:'private',kind:'household_message',body:'Synthetic old private content',importance:'normal',author:'Synthetic',publishAt:new Date(0).toISOString(),expiresAt:new Date(900000).toISOString(),revision:1}];
  const before=await realms.A.saveProjection(source,privateValue);
  const conflict=await realms.A.policyChanged(source,before.cacheValue!,1);
  assert.equal(conflict.applied,true);assert.equal(conflict.retryBudget,0);assert.equal(realms.cache(),null);assert.deepEqual(realms.A.read(),source);assert.equal(realms.events.length,0,'a policy retry neither disconnects nor opens a new pairing epoch');
  const fresh=snapshot('A',2);fresh.projection.display.privacyMode=true;
  const updated=await realms.A.saveProjection(source,fresh);assert.equal(updated.applied,true);assert.ok(!realms.cache()!.includes('Synthetic old private content'));
  const repeated=await realms.A.policyChanged(source,updated.cacheValue!,conflict.retryBudget!);assert.equal(repeated.retryBudget,null,'a second conflict stops the immediate retry chain');
  const newer=await realms.B.saveProjection(source,snapshot('A',3));await realms.A.policyChanged(source,before.cacheValue!,1);assert.equal(realms.cache(),newer.cacheValue,'an old 409 cannot delete another tab’s newer same-source cache');
});

test('redeem cookie application and canonical publication precede a waiting stale disconnect',async()=>{
  const realms=sharedRealms(),old=realms.A.read(),cookieApplied=deferred<void>(),finish=deferred<{id:string}>();
  let cookie='A',disconnectPosts=0;
  const redeem=realms.B.redeem(old,async()=>{cookie='B';cookieApplied.resolve();return finish.promise;});
  await cookieApplied.promise;
  const disconnect=realms.A.disconnect(old,async()=>{disconnectPosts++;cookie='none';});
  finish.resolve({id:'B'});const next=await redeem;assert.equal(next.applied,true);
  assert.equal((await disconnect).applied,false);assert.equal(disconnectPosts,0);assert.equal(cookie,'B');assert.deepEqual(realms.A.read(),auth('B',2));
});

test('an uncertain response after cookie application invalidates the old intent before unlocking',async()=>{
  const realms=sharedRealms(),old=realms.A.read(),applied=deferred<void>(),response=deferred<{id:string}>();
  let disconnectPosts=0;
  const mutation=realms.B.redeem(old,async()=>{applied.resolve();await response.promise;throw new TypeError('synthetic response body lost after headers');});
  await applied.promise;
  const pending=realms.A.disconnect(old,async()=>{disconnectPosts++;});
  response.resolve({id:'B'});await assert.rejects(mutation,/display_source_uncertain/);
  assert.equal((await pending).applied,false);assert.equal(disconnectPosts,0);
  assert.deepEqual(realms.A.read(),{kind:'revoked',displayId:null,epoch:2});assert.equal(displayCredentialLossKnown(realms.A.read(),false),false);
  const malformed=sharedRealms();await assert.rejects(malformed.A.redeem(malformed.A.read(),async()=>({} as {id:string})),/display_source_uncertain/);
  assert.deepEqual(malformed.A.read(),{kind:'revoked',displayId:null,epoch:2},'a missing identity after successful HTTP cannot leave an old cookie intent eligible');
});

test('parallel realm publications serialize distinct epochs and preserve the latest canonical payload',async()=>{
  const realms=sharedRealms(null);
  const first=realms.A.redeem(null,async()=>({id:'A'}));
  const second=realms.B.redeem(null,async()=>({id:'B'}));
  const results=await Promise.all([first,second]);assert.equal(results.filter(result=>result.applied).length,1);
  const next=await realms.B.redeem(realms.B.read(),async()=>({id:'B'}));assert.equal(next.event?.epoch,2);
  assert.deepEqual(realms.events.map(event=>event.epoch),[1,2]);
  // The incoming notification may be obsolete; adoption reads canonical state.
  assert.equal(sameDisplaySourceEvent(realms.events[0]!,realms.A.read()),false);assert.equal(realms.A.read()?.displayId,'B');
});

test('storage failure and epoch exhaustion stop cookie-changing requests before POST, without wrap or broadcast-only success',async()=>{
  const broken=sharedRealms();broken.failStorage();let sent=0;
  await assert.rejects(broken.A.redeem(auth('A',1),async()=>{sent++;return{id:'B'};}),/display_source_unavailable/);
  assert.equal(sent,0);assert.equal(broken.events.length,0);
  const exhausted=sharedRealms(auth('A',Number.MAX_SAFE_INTEGER));
  await assert.rejects(exhausted.A.redeem(exhausted.A.read(),async()=>{sent++;return{id:'B'};}),/display_source_exhausted/);
  assert.equal(sent,0);assert.equal(exhausted.A.read()?.epoch,Number.MAX_SAFE_INTEGER);
  await assert.rejects(exhausted.A.revoke(exhausted.A.read()),/display_source_exhausted/);
  assert.equal(exhausted.A.read()?.kind,'revoked');assert.equal(exhausted.A.read()?.epoch,Number.MAX_SAFE_INTEGER);
});

test('known credential loss clears its old cache even when canonical writes fail from quota',async()=>{
  const realms=sharedRealms(),old=realms.A.read();await realms.A.saveProjection(old,snapshot('A'));
  assert.ok(realms.cache());const storage={...realms.store,writable:()=>{throw new Error('display_source_unavailable');}};
  const coordinator=createDisplaySourceCoordinator(storage,realms.lock);
  await assert.rejects(coordinator.revoke(old),/display_source_unavailable/);assert.equal(realms.cache(),null);
  assert.deepEqual(coordinator.read(),old,'failure does not invent a broadcast-only newer epoch');
});

test('same display reconnect advances epoch and stale pairing or stream callbacks cannot complete over it',async()=>{
  const realms=sharedRealms(),old=realms.A.read(),token={displayId:'A',epoch:1,generation:5,canonical:old};
  let active=true;const response=deferred<{id:string}>(),started=deferred<void>();
  const pairing=realms.B.redeem(old,()=>{started.resolve();return response.promise;},()=>active);
  await started.promise;active=false;response.resolve({id:'A'});
  const next=await pairing;assert.equal(next.applied,true,'successful cookie authority is published even when old pairing UI unmounts');assert.equal(next.event?.epoch,2);
  assert.equal(canCompleteDisplayPairing(next.event,realms.A.read(),active),false);
  assert.equal(isCurrentDisplayCallback(token,token,realms.A.read()),false);
  assert.equal(canCompleteDisplayPairing(old,realms.A.read(),true),false);
  assert.equal(canCompleteDisplayPairing(next.event,realms.A.read(),true),true);
});

test('anonymous first 401 is unpaired, while actual prior source loss remains distinguishable',async()=>{
  const realms=sharedRealms(null);const first=await realms.A.revoke(null);
  assert.equal(first.event,null);assert.equal(realms.events.length,0);assert.equal(displayCredentialLossKnown(first.event,false),false);
  const connected=await realms.A.redeem(null,async()=>({id:'A'}));const lost=await realms.A.revoke(connected.event);
  assert.equal(displayCredentialLossKnown(lost.event,false),true);assert.equal(displayCredentialLossKnown(null,true),true);
});

test('a stalled or lost IndexedDB lease cannot publish cookie authority after its bounded lifetime',async()=>{
  let lease:{token:string;expires:number}|null=null;
  const store:DisplayRedeemLeaseStore={
    acquire:async(_name,token,now,expires)=>{if(lease&&lease.expires>now)return false;lease={token,expires};return true;},
    renew:async(_name,token,expires)=>{if(!lease||lease.token!==token||lease.expires<=Date.now())return false;lease.expires=expires;return true;},
    release:async(_name,token)=>{if(lease?.token===token)lease=null;}
  };
  const realms=sharedRealms(),runner=createDisplayRedeemLeaseRunner(store,{leaseMs:15,renewMs:1000,pollMs:1});
  const coordinator=createDisplaySourceCoordinator(realms.store,runner);
  await assert.rejects(coordinator.redeem(coordinator.read(),async()=>{await new Promise(resolve=>setTimeout(resolve,25));return{id:'B'};}),/display_redeem_lock_lost/);
  assert.deepEqual(coordinator.read(),auth('A',1));assert.equal(realms.events.length,0);
  // This cannot undo Set-Cookie already delivered; the server remains the final authority.
});

test('request cancellation composition works without AbortSignal.any and removes its timer/listener',async()=>{
  const original=Object.getOwnPropertyDescriptor(AbortSignal,'any');Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});
  try{const parent=new AbortController(),combined=requestAbortSignal(1000,parent.signal);parent.abort(new Error('display_redeem_lock_lost'));assert.equal(combined.signal.aborted,true);assert.equal((combined.signal.reason as Error).message,'display_redeem_lock_lost');combined.dispose();
    const timeout=requestAbortSignal(2);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(timeout.signal.aborted,true);timeout.dispose();
  }finally{if(original)Object.defineProperty(AbortSignal,'any',original);else delete (AbortSignal as unknown as {any?:unknown}).any;}
});
