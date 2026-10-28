import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { HomeProjection } from './home-types';
import { FamilyHub, type TaskAccess } from './family-hub';
import { HouseholdBoardCards } from './household-boards';
import { memberHouseholdBoardAdapter } from './household-board-adapters';
import { HouseholdBackgroundLayer, MediaLibraryPanel, MediaSlideshow } from './media-library';
import { memberMediaAdapter } from './media-adapters';
import { emptyHomePhotoPreview, homePhotoPreviewFailure, homePhotoPreviewSuccess } from './home-media-presentation';
import type { Display, Membership, Person } from './types';
import {HouseholdHomeAssistantControls} from './home-assistant-controls';
import { ErrorNotice, Loading, useI18n } from './ui';
import { monotonicClockAnchor, monotonicClockNow, wallInput } from './time';
export function Home({householdId,member,onCompose,onSessionChange,onManagePeople,taskAccess,onEditPhoto,editablePhotoIds,people=[],displays=[],canManageHousehold=false,canManageDisplays=false}:{taskAccess?:TaskAccess;onEditPhoto?:(id:string)=>void;editablePhotoIds?:string[];householdId:string;member:Membership;onCompose?:()=>void;onManagePeople?:()=>void;onSessionChange:()=>Promise<void>;people?:Person[];displays?:Display[];canManageHousehold?:boolean;canManageDisplays?:boolean}) {
 const {t}=useI18n();const [home,setHome]=useState<HomeProjection|null>(null);const [error,setError]=useState<unknown>();const [live,setLive]=useState(false);const [now,setNow]=useState(()=>Date.now());
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
 useEffect(()=>{
  const serverAt=Date.parse(home?.serverNow??"");
  const anchor=monotonicClockAnchor(Number.isFinite(serverAt)?serverAt:Date.now(),performance.now());
  const update=()=>setNow(monotonicClockNow(anchor,performance.now()));
  update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);
 },[home?.serverNow]);
 const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:home?.household.timezone??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return <><ErrorNotice error={error}/>{home?<div className="home-background-surface"><HouseholdBackgroundLayer householdId={householdId}/><div className="home-background-content"><FamilyHub householdId={householdId} localDate={localDate} birthdaySourceLocalDate={wallInput(home.serverNow,home.household.timezone).slice(0,10)} now={now} birthdays={home.upcomingBirthdays??[]} schoolActivities={home.schoolActivities??[]} taskAccess={taskAccess} onEditPhoto={onEditPhoto} editablePhotoIds={editablePhotoIds} people={home.people} items={home.items} messages={home.messages} zone={home.household.timezone} householdName={home.household.name} onCompose={onCompose} onManagePeople={onManagePeople} connection={t(live?'live':'polling')} homeModules={<HomeModules householdId={householdId} localDate={localDate}/>} homeSmartHome={<HouseholdHomeAssistantControls householdId={householdId} member={member} compact/>} homePhoto={<HomePhotoPreview key={householdId} householdId={householdId}/>}/><MediaLibraryPanel householdId={householdId} people={people} displays={displays} canManageHousehold={canManageHousehold} canManageDisplays={canManageDisplays}/></div></div>:!error?<Loading/>:null}</>;
}

function HomeModules({householdId,localDate}:{householdId:string;localDate:string}){
 const adapter=useMemo(()=>memberHouseholdBoardAdapter(householdId),[householdId]);
 return <HouseholdBoardCards adapter={adapter} localDate={localDate} visibleCards={['groceries','dinners']} display={false} compact/>;
}

function HomePhotoPreview({householdId}:{householdId:string}){
 const {t}=useI18n();const adapter=useMemo(()=>memberMediaAdapter(householdId),[householdId]);const [projection,setProjection]=useState(()=>emptyHomePhotoPreview(householdId));
 useEffect(()=>{let active=true;let generation=0;setProjection(emptyHomePhotoPreview(householdId));const refresh=async()=>{const request=++generation;try{const result=await adapter.listAlbums();const selected=result.albums.find(item=>item.kind==='photos'&&item.permissions.read&&item.assetCount>0);if(!selected){if(active&&request===generation)setProjection(emptyHomePhotoPreview(householdId));return}const images=await adapter.listAssets(selected.id);if(active&&request===generation)setProjection(homePhotoPreviewSuccess(householdId,selected,images.assets))}catch(error){if(!active||request!==generation)return;setProjection(current=>homePhotoPreviewFailure(current,householdId,(error as {status?:number})?.status))}};void refresh();const timer=window.setInterval(()=>void refresh(),30_000);return()=>{active=false;generation++;window.clearInterval(timer)}},[adapter,householdId]);
 const {album,assets,stale}=projection;if(projection.householdId!==householdId||!album||!assets.length)return null;
 return <section className="hub-panel hub-home-photos" aria-label={t('mediaPhotosTitle')}><header className="hub-panel-title"><h2>{t('mediaPhotosTitle')}</h2><span data-review-private="album-name">{album.name}</span></header>{stale&&<p className="field-hint" role="status">{t('mediaPreviewStale')}</p>}<MediaSlideshow assets={assets} label={album.name}/></section>;
}
