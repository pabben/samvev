import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentDisplaySource, isDisplayCacheForCurrentSource, isNewerDisplaySourceEvent, parseDisplaySourceEvent } from "../src/display-source-session.ts";
import { createDisplayRedeemLeaseRunner, type DisplayRedeemLeaseStore } from "../src/display-redeem-lock.ts";

test("source events accept only bounded IDs and valid monotonically increasing epochs", () => {
  assert.deepEqual(parseDisplaySourceEvent({ kind: "revoked", displayId: "synthetic-display", epoch: 12 }), { kind: "revoked", displayId: "synthetic-display", epoch: 12 });
  assert.deepEqual(parseDisplaySourceEvent({ kind: "authorized", displayId: "synthetic-display", epoch: 12 }), { kind: "authorized", displayId: "synthetic-display", epoch: 12 });
  assert.equal(parseDisplaySourceEvent({ kind: "authorized", displayId: null, epoch: 12 }), null);
  assert.equal(parseDisplaySourceEvent({ kind: "revoked", displayId: "x".repeat(81), epoch: 12 }), null);
  assert.equal(parseDisplaySourceEvent({ kind: "revoked", displayId: "synthetic-display", epoch: 0 }), null);
  const event = { kind: "authorized" as const, displayId: "synthetic-display", epoch: 12 };
  assert.equal(isNewerDisplaySourceEvent(11, event), true);
  assert.equal(isNewerDisplaySourceEvent(12, event), false);
  assert.equal(isNewerDisplaySourceEvent(13, event), false);
});

test("a late old-source authorization revoke cannot clear a newer credential for the same display ID", () => {
  const current = { displayId: "synthetic-display", epoch: 22, generation: 8 };
  assert.equal(isCurrentDisplaySource(current, { displayId: "synthetic-display", epoch: 21, generation: 7 }), false);
  assert.equal(isCurrentDisplaySource(current, { displayId: "synthetic-display", epoch: 22, generation: 7 }), false);
  assert.equal(isCurrentDisplaySource(current, { displayId: "another-display", epoch: 22, generation: 8 }), false);
  assert.equal(isCurrentDisplaySource(current, current), true);
  assert.equal(isDisplayCacheForCurrentSource({displayId:"synthetic-display",epoch:22},{kind:"revoked",displayId:"synthetic-display",epoch:22}),false,"known revocation cannot restore cached projection");
  assert.equal(isDisplayCacheForCurrentSource({displayId:"synthetic-display",epoch:21},{kind:"authorized",displayId:"synthetic-display",epoch:22}),false,"cache from an older source epoch is rejected");
  assert.equal(isDisplayCacheForCurrentSource({displayId:"synthetic-display",epoch:22},{kind:"authorized",displayId:"synthetic-display",epoch:22}),true);
});

function fakeIndexedDbLeaseStore({ loseRenewal = false, onRenew }:{loseRenewal?:boolean;onRenew?:(expiresAt:number)=>void} = {}): DisplayRedeemLeaseStore {
  const rows = new Map<string,{token:string;expiresAt:number}>();
  let transaction = Promise.resolve();
  const atomic = async <T>(work:()=>T):Promise<T> => {
    let release!:()=>void;
    const previous=transaction;
    transaction=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{return work();}finally{release();}
  };
  return {
    acquire:(name,token,_now,expiresAt)=>atomic(()=>{const current=rows.get(name);if(current&&current.expiresAt>Date.now())return false;rows.set(name,{token,expiresAt});return true;}),
    renew:(name,token,expiresAt)=>atomic(()=>{onRenew?.(expiresAt);const current=rows.get(name);if(loseRenewal||current?.token!==token)return false;rows.set(name,{token,expiresAt});return true;}),
    release:(name,token)=>atomic(()=>{if(rows.get(name)?.token===token)rows.delete(name);}),
  };
}

test("separate browser contexts serialize redemption through atomic IndexedDB-style transactions", async () => {
  let active = 0;
  let maximum = 0;
  const store=fakeIndexedDbLeaseStore();
  const contextA=createDisplayRedeemLeaseRunner(store,{leaseMs:100,renewMs:10,pollMs:1});
  const contextB=createDisplayRedeemLeaseRunner(store,{leaseMs:100,renewMs:10,pollMs:1});
  const redeem = (context:typeof contextA) => context(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active--;
  });
  await Promise.all([redeem(contextA), redeem(contextB), redeem(contextA)]);
  assert.equal(maximum, 1);
});

test("IndexedDB lease cleanup runs on failure and lease loss aborts the active redemption", async () => {
  const store=fakeIndexedDbLeaseStore();
  const contextA=createDisplayRedeemLeaseRunner(store,{leaseMs:50,renewMs:10,pollMs:1});
  const contextB=createDisplayRedeemLeaseRunner(store,{leaseMs:50,renewMs:10,pollMs:1});
  await assert.rejects(contextA(async()=>{throw new Error("synthetic failure");}),/synthetic failure/);
  let recovered=false;
  await contextB(async()=>{recovered=true;});
  assert.equal(recovered,true);

  const renewalExpiries:number[]=[];
  const lost=createDisplayRedeemLeaseRunner(fakeIndexedDbLeaseStore({loseRenewal:true,onRenew:expiresAt=>renewalExpiries.push(expiresAt)}),{leaseMs:50,renewMs:2,pollMs:1});
  let sawAbort=false;
  await assert.rejects(lost(async signal=>{await new Promise(resolve=>setTimeout(resolve,10));sawAbort=signal.aborted;}),/display_redeem_lock_lost/);
  assert.equal(sawAbort,true);
  assert.ok(renewalExpiries.length>0);
  assert.ok(renewalExpiries.every(expiresAt=>expiresAt-Date.now()<1000),"renewal must use the configured lease duration");
});

test("unavailable lock storage fails closed before any redemption work starts", async () => {
  const runner=createDisplayRedeemLeaseRunner({
    acquire:async()=>{throw new Error("indexeddb_unavailable");},
    renew:async()=>false,
    release:async()=>{},
  });
  let sent=false;
  await assert.rejects(runner(async()=>{sent=true;}),/indexeddb_unavailable/);
  assert.equal(sent,false);
});
