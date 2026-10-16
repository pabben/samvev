import {useEffect,useMemo,useRef,useState} from 'react';
import {homeAssistantControlsApi as controlsApi} from './home-assistant-controls-api';
import {ApiError} from './api';
import type {CalendarConnection} from './calendar-connection-types';
import type {Display,Membership,Person} from './types';
import {homeAssistantActionsForObservation,homeAssistantConfigurationForConnection,homeAssistantGrantReplacement,homeAssistantStateKey,mapHomeAssistantReadsSequentially,newHomeAssistantIdempotencyKey} from './home-assistant-control-presentation';
import type {HomeAssistantAction,HomeAssistantConfirmation,HomeAssistantEntity,HomeAssistantObservation,HomeAssistantReceipt,ManagedHomeAssistantEntity,ReadableHomeAssistantEntity} from './home-assistant-control-types';
import {Check,Dialog,ErrorNotice,Field,Loading,useAction,useI18n} from './ui';
import {formatDate} from './time';
import {en,type TranslationKey} from './locales/en';
import './home-assistant-controls.css';

type DraftGrant={targetId:string;canRead:boolean;actions:HomeAssistantAction[]};
type GrantDraft={personGrants:DraftGrant[];displayGrants:DraftGrant[]};
type ManagerProps={householdId:string;connection:CalendarConnection;people:Person[];displays:Display[];onClose:()=>void;onSaved:()=>Promise<void>};

export function HomeAssistantControlManager({householdId,connection,people,displays,onClose,onSaved}:ManagerProps){
 const {t}=useI18n(),{run,busy,error}=useAction();const [configuration,setConfiguration]=useState<ManagedHomeAssistantEntity[]>(),[candidates,setCandidates]=useState<HomeAssistantEntity[]>(),[search,setSearch]=useState(''),[drafts,setDrafts]=useState<Record<string,GrantDraft>>({}),[displayNames,setDisplayNames]=useState<Record<string,string>>({});
 const base=`/households/${householdId}/home-assistant/controls`;
 const install=(entities:ManagedHomeAssistantEntity[])=>{const owned=homeAssistantConfigurationForConnection(entities,connection.id);setConfiguration(owned);setDrafts(Object.fromEntries(owned.map(entity=>[entity.id,makeGrantDraft(entity,people,displays)])));setDisplayNames(Object.fromEntries(owned.flatMap(entity=>[[`entity:${entity.id}`,entity.displayName??entity.name],[`registry:${entity.registryId}`,entity.displayName??entity.name]])))};
 const reload=async()=>{const value=await controlsApi.configuration(householdId);install(value.entities);await onSaved()};
 useEffect(()=>{void run(reload)},[base]);
 const discover=()=>run(async()=>{const value=await controlsApi.discover(householdId,connection.id,connection.revision);setCandidates(value.entities)});
 const saveSelection=(candidate:HomeAssistantEntity)=>run(async()=>{await controlsApi.select(householdId,connection.id,{expectedConnectionRevision:connection.revision,registryId:candidate.registryId,displayName:displayNames[`registry:${candidate.registryId}`]?.trim()||candidate.name});await reload();setCandidates(undefined)});
 const saveName=(entity:ManagedHomeAssistantEntity)=>run(async()=>{await controlsApi.select(householdId,connection.id,{expectedConnectionRevision:connection.revision,registryId:entity.registryId,displayName:displayNames[`entity:${entity.id}`]?.trim()||null});await reload()});
 const saveGrants=(entity:ManagedHomeAssistantEntity)=>run(async()=>{const draft=drafts[entity.id]??makeGrantDraft(entity,people,displays),normalized=homeAssistantGrantReplacement(draft.personGrants.map(row=>({personId:row.targetId,canRead:row.canRead,actions:row.actions})),draft.displayGrants.map(row=>({displayId:row.targetId,canRead:row.canRead,actions:row.actions})));await controlsApi.configureGrants(householdId,entity.id,{expectedRevision:entity.revision,...normalized});await reload()});
 const pause=(entity:ManagedHomeAssistantEntity)=>run(async()=>{await controlsApi.deselect(householdId,entity.id,entity.revision);await reload()});
 const visibleCandidates=useMemo(()=>{const needle=search.trim().toLocaleLowerCase();return(candidates??[]).filter(candidate=>!needle||`${candidate.name} ${candidate.entityId}`.toLocaleLowerCase().includes(needle)).slice(0,50)},[candidates,search]);
 const changed=(entityId:string,next:GrantDraft)=>setDrafts(previous=>({...previous,[entityId]:next}));
 return <Dialog title={t('homeAssistantControlsTitle')} onClose={onClose} wide className="ha-controls-dialog"><div className="ha-controls-stack"><p>{t('homeAssistantManagerIntro')}</p><p className="field-hint">{t('homeAssistantOAuthRights')}</p><ErrorNotice error={error}/>
  {!configuration?<Loading/>:<section className="ha-control-section"><div className="ha-control-heading"><h3>{t('homeAssistantSelected')}</h3><div className="form-actions"><button className="button" disabled={busy} onClick={()=>void run(reload)}>{t('homeAssistantReload')}</button><button className="button" disabled={busy||connection.state!=='connected'} onClick={()=>void discover()}>{t('homeAssistantDiscover')}</button></div></div>
   {configuration.length===0&&<p className="ha-controls-empty">{t('homeAssistantNoSelected')}</p>}
   <div className="ha-manager-list">{configuration.map(entity=><article className="ha-manager-card" key={entity.id}><header><div><h4>{entity.name}</h4><code>{entity.entityId}</code></div><div className="ha-control-badges"><span>{t(entity.domain==='light'?'homeAssistantLight':'homeAssistantCover')}</span><span className={entity.selected?'':'is-muted'}>{t(entity.selected?'homeAssistantSelectedStatus':entity.requiresReselection?'homeAssistantReselectionNeeded':'homeAssistantPaused')}</span></div></header>
    <Field label={t('homeAssistantDisplayName')}><input maxLength={80} value={displayNames[`entity:${entity.id}`]??entity.name} onChange={event=>setDisplayNames(previous=>({...previous,[`entity:${entity.id}`]:event.target.value}))}/></Field>
    {entity.requiresReselection?<p className="notice">{t('homeAssistantOriginReselection')}</p>:null}
    <p className="field-hint">{t('homeAssistantAvailableActions')}: {entity.supportedActions.map(action=>t(homeAssistantActionKey(action))).join(', ')||t('homeAssistantNoActions')}</p>
    <div className="ha-grant-grid"><GrantEditor disabled={busy} title={t('homeAssistantPeopleGrants')} rows={drafts[entity.id]?.personGrants??[]} actions={entity.supportedActions} targetName={id=>people.find(person=>person.id===id)?.display_name??t('homeAssistantUnknownTarget')} onChange={personGrants=>changed(entity.id,{...(drafts[entity.id]??makeGrantDraft(entity,people,displays)),personGrants})}/>
     <GrantEditor disabled={busy} title={t('homeAssistantDeviceGrants')} rows={drafts[entity.id]?.displayGrants??[]} actions={entity.supportedActions} targetName={id=>displays.find(display=>display.id===id)?.name??t('homeAssistantUnknownTarget')} onChange={displayGrants=>changed(entity.id,{...(drafts[entity.id]??makeGrantDraft(entity,people,displays)),displayGrants})}/></div>
    <div className="form-actions"><button className="button" disabled={busy} onClick={()=>void saveGrants(entity)}>{t('save')}</button>{entity.selected&&<button className="button" disabled={busy||connection.state!=='connected'||(displayNames[`entity:${entity.id}`]??entity.name)===(entity.displayName??entity.name)} onClick={()=>void saveName(entity)}>{t('homeAssistantSaveName')}</button>}{entity.selected&&<button className="button" disabled={busy} onClick={()=>void pause(entity)}>{t('homeAssistantPause')}</button>}</div>
   </article>)}</div>
  </section>}
  {candidates&&<section className="ha-control-section"><div className="ha-control-heading"><h3>{t('homeAssistantCandidates',{count:candidates.length})}</h3><button className="button" disabled={busy} onClick={()=>setCandidates(undefined)}>{t('close')}</button></div><Field label={t('homeAssistantSearch')}><input type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/></Field>{visibleCandidates.length===0?<p className="ha-controls-empty">{t('homeAssistantNoCandidates')}</p>:<ul className="ha-candidate-list">{visibleCandidates.map(candidate=>{const existing=configuration?.find(entity=>entity.registryId===candidate.registryId);return <li key={candidate.registryId}><div><strong>{candidate.name}</strong><code>{candidate.entityId}</code><small>{t(candidate.stateStatus==='current'?'homeAssistantStateCurrent':candidate.stateStatus==='unavailable'?'homeAssistantStateUnavailable':'homeAssistantStateUnknown')} · {candidate.state??'—'}</small><small>{t('homeAssistantAvailableActions')}: {candidate.supportedActions.map(action=>t(homeAssistantActionKey(action))).join(', ')||t('homeAssistantNoActions')}</small><Field label={t('homeAssistantDisplayName')}><input maxLength={80} value={displayNames[`registry:${candidate.registryId}`]??existing?.displayName??candidate.name} onChange={event=>setDisplayNames(previous=>({...previous,[`registry:${candidate.registryId}`]:event.target.value}))}/></Field></div><button className="button" disabled={busy||candidate.stateStatus!=='current'||Boolean(existing?.selected&&!existing.requiresReselection)} onClick={()=>void saveSelection(candidate)}>{existing?.requiresReselection?t('homeAssistantReselect'):existing&&!existing.selected?t('homeAssistantResume'):existing?.selected?t('homeAssistantSelectedStatus'):t('homeAssistantSelect')}</button></li>})}</ul>}{candidates.length>50&&<p className="field-hint">{t('homeAssistantCandidateLimit')}</p>}</section>}
  <div className="form-actions"><button className="button" disabled={busy} onClick={onClose}>{t('close')}</button></div>
 </div></Dialog>;
}

function makeGrantDraft(entity:ManagedHomeAssistantEntity,people:Person[],displays:Display[]):GrantDraft{
 const eligiblePeople=people.filter(person=>person.account_status==='active'&&person.capabilities.includes('household.view'));
 const savedPeople=new Map(entity.personGrants.map(grant=>[grant.personId,grant])),savedDisplays=new Map(entity.displayGrants.map(grant=>[grant.displayId,grant]));
 const personIds=new Set([...eligiblePeople.map(person=>person.id),...savedPeople.keys()]),displayIds=new Set([...displays.filter(display=>!display.revoked_at).map(display=>display.id),...savedDisplays.keys()]);
 return{personGrants:[...personIds].map(targetId=>{const saved=savedPeople.get(targetId);return{targetId,canRead:saved?.canRead??false,actions:[...(saved?.actions??[])]}}),displayGrants:[...displayIds].map(targetId=>{const saved=savedDisplays.get(targetId);return{targetId,canRead:saved?.canRead??false,actions:[...(saved?.actions??[])]}})};
}

function GrantEditor({title,rows,actions,targetName,onChange,disabled}:{title:string;rows:DraftGrant[];actions:HomeAssistantAction[];targetName:(id:string)=>string;onChange:(rows:DraftGrant[])=>void;disabled:boolean}){
 const {t}=useI18n();const setRow=(index:number,change:Partial<DraftGrant>)=>onChange(rows.map((row,rowIndex)=>rowIndex===index?{...row,...change}:row));
 return <fieldset disabled={disabled} className="ha-grant-editor"><legend>{title}</legend>{rows.map((row,index)=><div className="ha-grant-row" key={row.targetId}><Check label={targetName(row.targetId)} checked={row.canRead} onChange={canRead=>setRow(index,{canRead,actions:canRead?row.actions:[]})}/>{row.canRead&&<div className="ha-action-checks">{actions.map(action=><Check key={action} label={t(homeAssistantActionKey(action))} checked={row.actions.includes(action)} onChange={checked=>setRow(index,{actions:checked?[...new Set([...row.actions,action])]:row.actions.filter(item=>item!==action)})}/>)}</div>}</div>)}{!rows.length&&<p className="field-hint">{t('homeAssistantNoGrantTargets')}</p>}</fieldset>;
}

function homeAssistantActionKey(action:HomeAssistantAction){return action==='light.turn_on'?'homeAssistantLightOn':action==='light.turn_off'?'homeAssistantLightOff':'homeAssistantGarageOpen'}

type Actor={kind:'member';householdId:string;timezone:string}|{kind:'display';timezone:string;canAct:boolean};
export function HouseholdHomeAssistantControls({householdId,member}:{householdId:string;member:Membership}){
 if(!member.capabilities.includes('household.view'))return null;
 return <HomeAssistantControlDevice key={`${householdId}:${member.person_id}`} actor={{kind:'member',householdId,timezone:member.timezone}} />;
}

/** Reusable cookie-only display variant; the caller must pass the current display action-policy value. */
export function DeviceHomeAssistantControls({timezone='UTC',canAct=false,compact=false}:{timezone?:string;canAct?:boolean;compact?:boolean}){
 return <HomeAssistantControlDevice actor={{kind:'display',timezone,canAct}} compact={compact}/>;
}

type DeviceObservation=HomeAssistantObservation&{stale?:boolean};
function HomeAssistantControlDevice({actor,compact=false}:{actor:Actor;compact?:boolean}){
 const {t,locale}=useI18n(),{run,busy,error}=useAction();const [entities,setEntities]=useState<ReadableHomeAssistantEntity[]>(),[observations,setObservations]=useState<Record<string,DeviceObservation>>({}),[receipts,setReceipts]=useState<Record<string,HomeAssistantReceipt>>({}),[confirmation,setConfirmation]=useState<{entityId:string;value:HomeAssistantConfirmation;expiresAt:number}>(),[clock,setClock]=useState(Date.now());const keys=useRef(new Map<string,string>()),generation=useRef(0),refreshing=useRef(false),actionInFlight=useRef(false);
 const apiActor=actor.kind==='member'?{kind:'member' as const,householdId:actor.householdId}:{kind:'display' as const};
 const root=actor.kind==='member'?`/households/${actor.householdId}/home-assistant/controls`:'/display/home-assistant/controls';
 const clearScope=()=>{generation.current++;setEntities(undefined);setObservations({});setReceipts({});setConfirmation(undefined);keys.current.clear()};
 const refresh=async()=>{if(refreshing.current||actionInFlight.current)return;refreshing.current=true;const request=++generation.current;setConfirmation(undefined);try{
  try{const result=await controlsApi.list(apiActor);if(request!==generation.current)return;setEntities(result.entities);
   const previous=observations;const failures:unknown[]=[];
   const rows=await mapHomeAssistantReadsSequentially(result.entities,async entity=>{try{return[entity.id,await controlsApi.read(apiActor,entity.id)] as const}catch(readError){if(isAuthorizationFailure(readError))throw readError;failures.push(readError);const old=previous[entity.id];return[entity.id,old?{...old,stateStatus:'unknown' as const,stale:true,errorCode:'home_assistant_control_state_unknown'}:{...entity,state:null,stateStatus:'unknown' as const,lastChangedAt:null,readAt:null,stateAuthority:'home_assistant' as const,physicalConfirmation:'not_available' as const,errorCode:'home_assistant_control_state_unknown'}] as const}},()=>request===generation.current);
   if(request!==generation.current)return;setObservations(Object.fromEntries(rows));if(failures.length)throw failures[0];
  }catch(readError){if(request!==generation.current)return;if(isAuthorizationFailure(readError)){clearScope();}else if(entities?.length){setObservations(previous=>Object.fromEntries(Object.entries(previous).map(([id,observation])=>[id,{...observation,stateStatus:'unknown' as const,stale:true,errorCode:'home_assistant_control_state_unknown'}])))}throw readError}
 }finally{refreshing.current=false}};
 useEffect(()=>{clearScope();void run(refresh);return()=>{generation.current++}},[root]);
 useEffect(()=>{if(busy)return;const timer=setInterval(()=>{if(!busy&&!refreshing.current&&!actionInFlight.current)void run(refresh)},60_000);return()=>clearInterval(timer)},[busy,root]);
 useEffect(()=>{if(!confirmation)return;const timer=setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(timer)},[confirmation]);
 const actionKey=(entityId:string,action:HomeAssistantAction)=>{const cacheKey=`${entityId}:${action}`;let value=keys.current.get(cacheKey);if(!value){value=newHomeAssistantIdempotencyKey();keys.current.set(cacheKey,value)}return value};
 const refreshStateAfterReceipt=async(entity:ReadableHomeAssistantEntity,request:number)=>{try{const observation=await controlsApi.read(apiActor,entity.id);if(request===generation.current)setObservations(previous=>({...previous,[entity.id]:observation}))}catch(readError){if(request!==generation.current)return;if(isAuthorizationFailure(readError)){clearScope()}else setObservations(previous=>{const old=previous[entity.id];return old?{...previous,[entity.id]:{...old,stateStatus:'unknown',stale:true,errorCode:'home_assistant_control_state_unknown'}}:previous});throw readError}};
 const dispatch=(entity:ReadableHomeAssistantEntity,action:HomeAssistantAction,confirmationToken?:string)=>run(async()=>{if(refreshing.current||actionInFlight.current)return;actionInFlight.current=true;const request=generation.current,cacheKey=`${entity.id}:${action}`;try{const result=await controlsApi.dispatch(apiActor,entity.id,{expectedRevision:entity.revision,action,idempotencyKey:actionKey(entity.id,action),...(confirmationToken?{confirmationToken}:{})});if(request!==generation.current)return;setReceipts(previous=>({...previous,[entity.id]:result}));if(result.status!=='unknown')keys.current.delete(cacheKey);if(action==='cover.open_cover')setConfirmation(undefined);await refreshStateAfterReceipt(entity,request)}catch(actionError){if(request===generation.current&&isAuthorizationFailure(actionError))clearScope();throw actionError}finally{actionInFlight.current=false}});
 const prepareGarage=(entity:ReadableHomeAssistantEntity)=>run(async()=>{if(refreshing.current||actionInFlight.current)return;actionInFlight.current=true;const request=generation.current;try{const result=await controlsApi.confirmOpen(apiActor,entity.id,entity.revision);if(request!==generation.current)return;setConfirmation({entityId:entity.id,value:result,expiresAt:Date.now()+result.expiresInSeconds*1000});setClock(Date.now())}catch(confirmError){if(request===generation.current&&isAuthorizationFailure(confirmError))clearScope();throw confirmError}finally{actionInFlight.current=false}});
 const stateText=(observation:DeviceObservation|undefined)=>observation?.stale?t('homeAssistantStateStale'):observation?t(homeAssistantStateKey(observation.stateStatus)):t('homeAssistantStateLoading');
 const activeConfirmation=confirmation&&confirmation.expiresAt>clock?confirmation:undefined;
 if(entities?.length===0&&!error)return null;
 return <section className={`ha-device-controls ${compact?'ha-device-controls-compact':''}`} aria-labelledby={actor.kind==='member'?'ha-member-controls-title':'ha-display-controls-title'}><div className="ha-control-heading"><div><p className="eyebrow">{t('homeAssistantControlsEyebrow')}</p><h2 id={actor.kind==='member'?'ha-member-controls-title':'ha-display-controls-title'}>{t('homeAssistantControlsTitle')}</h2></div><button className="button" disabled={busy} onClick={()=>void run(refresh)}>{t('homeAssistantRefresh')}</button></div>
  {actor.kind==='display'&&!actor.canAct&&<p className="field-hint">{t('homeAssistantDisplayActionsDisabled')}</p>}
  <ErrorNotice error={error}/>{!entities&&!error?<Loading/>:entities?.length===0?<p className="ha-controls-empty">{t('homeAssistantNoReadable')}</p>:<div className="ha-device-grid">{(entities??[]).map(entity=>{const observation=observations[entity.id],actions=homeAssistantActionsForObservation(entity,observation,observation?.stale);const showControl=actor.kind==='member'||actor.canAct,canDispatch=actions.length>0;return <article className="ha-device-card" key={entity.id}><header><div><h3>{entity.name}</h3><code>{entity.entityId}</code></div><span className="ha-control-badge">{t(entity.domain==='light'?'homeAssistantLight':'homeAssistantCover')}</span></header>
   <p className="ha-device-state"><span>{stateText(observation)}</span><strong>{observation?.state??'—'}</strong></p>
   {observation?.lastChangedAt&&<p className="field-hint">{t('homeAssistantLastChanged')}: <time dateTime={observation.lastChangedAt}>{formatDate(observation.lastChangedAt,locale,actor.timezone)}</time></p>}
   {observation?.readAt&&<p className="field-hint">{t('homeAssistantCheckedAt')}: <time dateTime={observation.readAt}>{formatDate(observation.readAt,locale,actor.timezone)}</time></p>}
   {observation?.errorCode&&<p className="notice error">{t('homeAssistantControlReadError')}: {t(observation.errorCode in en?observation.errorCode as TranslationKey:'home_assistant_control_state_unknown')}</p>}
   <p className="field-hint">{t('homeAssistantStateAuthority')}</p>
   {receipts[entity.id]&&<div className={`ha-action-result ha-action-result-${receipts[entity.id]!.status}`} role="status"><strong>{t(receiptKey(receipts[entity.id]!.status))}</strong>{receipts[entity.id]!.observedState&&<span>{t('homeAssistantObservedState')}: {receipts[entity.id]!.observedState}</span>}{receipts[entity.id]!.errorCode&&<span>{t('homeAssistantControlReadError')}</span>}</div>}
   {showControl&&<div className="ha-device-actions">{actions.includes('light.turn_on')&&<button className="button" disabled={busy||!canDispatch} onClick={()=>void dispatch(entity,'light.turn_on')}>{t('homeAssistantLightOn')}</button>}{actions.includes('light.turn_off')&&<button className="button" disabled={busy||!canDispatch} onClick={()=>void dispatch(entity,'light.turn_off')}>{t('homeAssistantLightOff')}</button>}{actions.includes('cover.open_cover')&&(activeConfirmation?.entityId===entity.id?<><p className="notice">{t('homeAssistantConfirmationCountdown',{seconds:Math.max(0,Math.ceil((activeConfirmation.expiresAt-clock)/1000))})}</p><button className="button danger" disabled={busy||!canDispatch} onClick={()=>void dispatch(entity,'cover.open_cover',activeConfirmation.value.confirmationToken)}>{t('homeAssistantConfirmOpen')}</button></>:<button className="button danger" disabled={busy||!canDispatch} onClick={()=>void prepareGarage(entity)}>{t('homeAssistantPrepareOpen')}</button>)}</div>}
  </article>})}</div>}
 </section>;
}

function isAuthorizationFailure(error:unknown){return error instanceof ApiError&&[401,403,404].includes(error.status)}

function receiptKey(status:HomeAssistantReceipt['status']){return status==='reported'?'homeAssistantActionReported':status==='accepted'?'homeAssistantActionAccepted':'homeAssistantActionUnknown'}
