import type { CachedProjection } from './display-cache';
import { parseDisplaySourceEvent, sameDisplaySourceEvent, type DisplaySourceEvent } from './display-source-session';
import { withDisplayRedeemLock, type DisplayLockWork } from './display-redeem-lock';

export const DISPLAY_CACHE_KEY='samvev.display.projection.v1';
const SOURCE_KEY='samvev.display.source.v1';
const PROBE_KEY='samvev.display.coordination-probe';
export interface DisplaySourceStorage {
  read():DisplaySourceEvent|null;
  writable():void;
  write(event:DisplaySourceEvent):void;
  readCache():string|null;
  writeCache(value:string):void;
  removeCache():void;
  notify(event:DisplaySourceEvent):void;
}
export type DisplaySourceLock=<T>(work:DisplayLockWork<T>)=>Promise<T>;
type Result={applied:boolean;event:DisplaySourceEvent|null;cacheValue?:string};
const unavailable=()=>new Error('display_source_unavailable');

export function browserDisplaySourceStorage():DisplaySourceStorage{
  const storage=()=>{if(typeof window==='undefined')throw unavailable();return window.localStorage;};
  return{
    read(){
      try{const raw=storage().getItem(SOURCE_KEY);if(raw===null)return null;const parsed=parseDisplaySourceEvent(JSON.parse(raw));if(!parsed)throw unavailable();return parsed;}
      catch{throw unavailable();}
    },
    writable(){try{storage().setItem(PROBE_KEY,'1');storage().removeItem(PROBE_KEY);}catch{throw unavailable();}},
    write(event){try{storage().setItem(SOURCE_KEY,JSON.stringify(event));}catch{throw unavailable();}},
    readCache(){try{return storage().getItem(DISPLAY_CACHE_KEY);}catch{throw unavailable();}},
    writeCache(value){try{storage().setItem(DISPLAY_CACHE_KEY,value);}catch{throw unavailable();}},
    removeCache(){try{storage().removeItem(DISPLAY_CACHE_KEY);}catch{throw unavailable();}},
    notify(event){try{const channel=new BroadcastChannel('samvev.display.source');channel.postMessage(event);channel.close();}catch{/* Canonical storage, not broadcast delivery, is the authority. */}}
  };
}

/** All cooperating tabs serialize cookie mutations, epoch commits and cache
 * writes through the existing lock. A lease is bounded active-client
 * coordination; aborting a fetch cannot undo Set-Cookie already delivered. */
export function createDisplaySourceCoordinator(store:DisplaySourceStorage,lock:DisplaySourceLock){
  const read=()=>store.read();
  const current=(expected:DisplaySourceEvent|null)=>sameDisplaySourceEvent(read(),expected);
  const capacity=(event:DisplaySourceEvent|null)=>{if(event?.epoch===Number.MAX_SAFE_INTEGER)throw new Error('display_source_exhausted');};
  const publish=(kind:DisplaySourceEvent['kind'],displayId:string|null,previous:DisplaySourceEvent|null)=>{
    capacity(previous);
    const event:DisplaySourceEvent={kind,displayId,epoch:(previous?.epoch??0)+1};
    // Clear the old cache first: quota/write failure must not leave a known
    // obsolete cache restorable under its old canonical authorization marker.
    store.removeCache();
    store.write(event);
    if(!current(event))throw unavailable();
    store.notify(event);return event;
  };
  const stale=():Result=>({applied:false,event:read()});
  const cookieRequest=async<T>(expected:DisplaySourceEvent|null,request:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,owned:()=>Promise<void>):Promise<T>=>{
    try{return await request(signal);}
    catch(cause){
      // An explicit HTTP rejection (or local expiry check) did not redeem or
      // disconnect. A lost response can already have applied Set-Cookie: mark
      // the source uncertain before unlocking so old-tab intents cannot act
      // on that cookie. This marker does not claim a known server revocation.
      if((cause&&typeof cause==='object'&&'status'in cause&&typeof cause.status==='number'&&cause.status>0)||(cause instanceof Error&&cause.message==='pairing_expired'))throw cause;
      await owned();if(current(expected))publish('revoked',null,expected);
      throw new Error('display_source_uncertain');
    }
  };
  return{
    read,current,
    async revoke(expected:DisplaySourceEvent|null,active=()=>true):Promise<Result>{
      return lock(async(_signal,owned)=>{
        await owned();if(!active()||!current(expected))return stale();store.removeCache();store.writable();
        // Anonymous first load is unpaired, not evidence of lost credentials.
        if(!expected){store.removeCache();return{applied:true,event:null};}
        if(expected.kind==='revoked'){store.removeCache();return{applied:true,event:expected};}
        if(expected.epoch===Number.MAX_SAFE_INTEGER){
          // Terminal fail-closed marker; never wrap or authorize another epoch.
          const terminal:DisplaySourceEvent={...expected,kind:'revoked'};
          store.removeCache();store.write(terminal);store.notify(terminal);
          throw new Error('display_source_exhausted');
        }
        return{applied:true,event:publish('revoked',expected.displayId,expected)};
      });
    },
    async saveProjection(expected:DisplaySourceEvent|null,value:CachedProjection,active=()=>true):Promise<Result>{
      return lock(async(_signal,owned)=>{
        await owned();if(!active()||!current(expected))return stale();store.writable();capacity(expected);
        const id=value.projection.display.id;
        if(typeof id!=='string'||!id||id.length>80)throw unavailable();
        const event=expected?.kind==='authorized'&&expected.displayId===id?expected:publish('authorized',id,expected);
        const cacheValue=JSON.stringify({...value,sourceEpoch:event.epoch});
        store.writeCache(cacheValue);return{applied:true,event,cacheValue};
      });
    },
    async removeCache(expected:DisplaySourceEvent|null,cacheValue:string):Promise<void>{
      await lock(async(_signal,owned)=>{await owned();if(current(expected)&&store.readCache()===cacheValue)store.removeCache();});
    },
    async policyChanged(expected:DisplaySourceEvent|null,cacheValue:string|null,retries:number,active=()=>true):Promise<Result&{retryBudget:number|null}>{
      return lock(async(_signal,owned)=>{
        await owned();if(!active()||!current(expected))return{...stale(),retryBudget:null};
        if(cacheValue!==null&&store.readCache()===cacheValue)store.removeCache();
        // Policy conflict invalidates content, not the cookie or source epoch.
        return{applied:true,event:expected,retryBudget:retries>0?0:null};
      });
    },
    async redeem(expected:DisplaySourceEvent|null,request:(signal:AbortSignal)=>Promise<{id:string}>,active=()=>true):Promise<Result>{
      return lock(async(signal,owned)=>{
        await owned();if(!active()||!current(expected))return stale();store.writable();capacity(expected);
        const result=await cookieRequest(expected,request,signal,owned);
        await owned();if(!current(expected))return stale();
        if(!result||typeof result.id!=='string'||!result.id||result.id.length>80){publish('revoked',null,expected);throw new Error('display_source_uncertain');}
        // Cookie authority is published before releasing the cookie lock,
        // even if this particular pairing component unmounted in the meantime.
        return{applied:true,event:publish('authorized',result.id,expected)};
      });
    },
    async disconnect(expected:DisplaySourceEvent|null,request:(signal:AbortSignal)=>Promise<unknown>,active=()=>true):Promise<Result>{
      return lock(async(signal,owned)=>{
        await owned();if(!active()||!current(expected))return stale();store.writable();capacity(expected);
        await cookieRequest(expected,request,signal,owned);await owned();if(!current(expected))return stale();
        return{applied:true,event:publish('revoked',expected?.displayId??null,expected)};
      });
    }
  };
}
export const displaySourceCoordinator=createDisplaySourceCoordinator(browserDisplaySourceStorage(),withDisplayRedeemLock);
