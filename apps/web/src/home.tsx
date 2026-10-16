import { useEffect, useState } from 'react';
import { api } from './api';
import type { HomeProjection } from './home-types';
import { FamilyHub, type TaskAccess } from './family-hub';
import { MemberHouseholdBoards } from './household-boards';
import { HouseholdBackgroundLayer, MediaLibraryPanel } from './media-library';
import type { Display, Person } from './types';
import { ErrorNotice, Loading, useI18n } from './ui';
export function Home({householdId,onCompose,onSessionChange,onManagePeople,taskAccess,onEditPhoto,editablePhotoIds,people=[],displays=[],canManageHousehold=false,canManageDisplays=false}:{taskAccess?:TaskAccess;onEditPhoto?:(id:string)=>void;editablePhotoIds?:string[];householdId:string;onCompose?:()=>void;onManagePeople?:()=>void;onSessionChange:()=>Promise<void>;people?:Person[];displays?:Display[];canManageHousehold?:boolean;canManageDisplays?:boolean}) {
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
 const localDate=home?.household.localDate??new Intl.DateTimeFormat('en-CA',{timeZone:home?.household.timezone??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return <><ErrorNotice error={error}/>{home?<div className="home-background-surface"><HouseholdBackgroundLayer householdId={householdId}/><div className="home-background-content"><FamilyHub householdId={householdId} localDate={localDate} birthdays={home.upcomingBirthdays??[]} schoolActivities={home.schoolActivities??[]} taskAccess={taskAccess} onEditPhoto={onEditPhoto} editablePhotoIds={editablePhotoIds} people={home.people} items={home.items} messages={home.messages} zone={home.household.timezone} householdName={home.household.name} onCompose={onCompose} onManagePeople={onManagePeople} connection={t(live?'live':'polling')}/><div className="home-boards-shell"><MemberHouseholdBoards householdId={householdId} localDate={localDate}/><MediaLibraryPanel householdId={householdId} people={people} displays={displays} canManageHousehold={canManageHousehold} canManageDisplays={canManageDisplays}/></div></div></div>:!error?<Loading/>:null}</>;
}
