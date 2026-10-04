import { useEffect, useState } from 'react';
import { api } from './api';
import type { HomeProjection } from './home-types';
import { FamilyHub } from './family-hub';
import { ErrorNotice, Loading, useI18n } from './ui';
export function Home({householdId,onCompose,onSessionChange,onManagePeople}:{householdId:string;onCompose?:()=>void;onManagePeople?:()=>void;onSessionChange:()=>Promise<void>}) {
 const {t}=useI18n();const [home,setHome]=useState<HomeProjection|null>(null);const [error,setError]=useState<unknown>();const [live,setLive]=useState(false);
 useEffect(()=>{
  let active=true;let request=0;setHome(null);setError(undefined);setLive(false);
  const refresh=async()=>{const generation=++request;try {const value=await api<HomeProjection>(`/households/${householdId}/home`);if(active&&generation===request){setHome(value);setError(undefined)}}catch(e){if(!active||generation!==request)return;setError(e);if([401,403,404].includes((e as {status:number}).status)){setHome(null);void onSessionChange()}}};
  void refresh();const timer=setInterval(()=>void refresh(),5000);
  const stream=new EventSource(`/api/v1/households/${householdId}/events`);
  const health=(event:Event)=>{try{setLive(JSON.parse((event as MessageEvent).data).listenerConnected!==false)}catch{setLive(false)}};
  stream.addEventListener('ready',event=>{health(event);void refresh()});stream.addEventListener('heartbeat',health);stream.addEventListener('listener-degraded',()=>setLive(false));stream.addEventListener('listener-restored',()=>{setLive(false);void refresh()});stream.addEventListener('projection-invalidated',()=>void refresh());
  stream.addEventListener('authorization-changed',()=>{setHome(null);void refresh()});
  stream.addEventListener('authorization-revoked',()=>{request++;setHome(null);setLive(false);stream.close();void onSessionChange()});
  stream.onerror=()=>{setLive(false);void refresh()};
  return()=>{active=false;request++;stream.close();clearInterval(timer)};
 },[householdId,onSessionChange]);
 return <><ErrorNotice error={error}/>{home?<FamilyHub people={home.people} items={home.items} messages={home.messages} zone={home.household.timezone} householdName={home.household.name} onCompose={onCompose} onManagePeople={onManagePeople} connection={t(live?'live':'polling')}/>:!error?<Loading/>:null}</>;
}
