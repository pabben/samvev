import {HomeEnvironment} from './home-environment';
import {CalendarFreshness} from './calendar-freshness';
import { PersonTasks } from "./person-tasks";
import { personAccent } from "./person-identity";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import type { HubItem, HubMessage, HubPerson } from './home-types';
import { eventDay,overlapsDay,dayKey,upcomingEvents,eventDateGroups,personalWindowItems,wasteEvents,temperatureItems,itemSubjectIds,itemHousehold,adaptivePeopleLayout,peopleCardMinWidth, currentItems, dayEvents, messageAvatarKey, importantItems, importantPreviewLimit, hubSectionOrder, personItems, personalPreviewItems, hiddenPersonalCount, resolveHubDetail, type HubCollection, type HubDetailSelection } from './home-presentation';
import { Avatar, Dialog, Icon, useI18n } from './ui';
import { formatDate, formatEventRange, formatCalendarEventRange, wallInput } from './time';
const kindKeys={event:'hubEvent',reminder:'hubReminder',alert:'hubAlert',summary:'hubSummary',list:'hubList',observation:'hubObservation'} as const;
const kindIcons={event:'calendar',reminder:'sun',alert:'bell',summary:'spark',list:'list',observation:'leaf'};
type DetailAccess={open:(selection:HubDetailSelection,trigger:HTMLButtonElement)=>void;provenance:Record<string,boolean>;setProvenance:(id:string,open:boolean)=>void;rememberProvenanceFocus:(id:string,node:HTMLElement)=>void};
const HubDetails=createContext<DetailAccess|null>(null);
export type TaskAccess={householdId:string;onOpen:(id:string)=>void;onNew:(personId:string)=>void};
export function FamilyHub({people,items,messages,zone,householdName,display=false,now:givenNow,onCompose,onManagePeople,connection,taskAccess,onEditPhoto,editablePhotoIds}:{taskAccess?:TaskAccess;onEditPhoto?:(id:string)=>void;editablePhotoIds?:string[];people:HubPerson[];items:HubItem[];messages:HubMessage[];zone:string;householdName:string;display?:boolean;now?:number;onCompose?:()=>void;onManagePeople?:()=>void;connection?:string}) {
  const {t,locale}=useI18n();
  const {dark,compact,mobile,lowHeight}=useHubComposition();
  const peopleGrid=useRef<HTMLDivElement>(null);
  const [peopleSpace,setPeopleSpace]=useState({width:0,gap:14});
  useLayoutEffect(()=>{
    const grid=peopleGrid.current;
    if(!grid)return;
    const measure=()=>{const width=grid.getBoundingClientRect().width,gap=parseFloat(getComputedStyle(grid).columnGap)||0;setPeopleSpace(previous=>previous.width===width&&previous.gap===gap?previous:{width,gap});};
    measure();const observer=new ResizeObserver(measure);observer.observe(grid);
    return()=>observer.disconnect();
  },[mobile,dark,compact]);
  const minCardWidth=peopleCardMinWidth(people);
  const peopleLayout=!dark&&!compact?adaptivePeopleLayout(people.length,peopleSpace.width,peopleSpace.gap,minCardWidth):null;
  const concisePeople=dark&&!compact&&people.length>4;
  const [tick,setTick]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer)},[]);
  const now=givenNow??tick;
  const hour=Number(wallInput(now,zone).slice(11,13));
  const greeting=t(mobile ? (hour>=5&&hour<10?'hubMorningCompact':hour>=10&&hour<18?'hubDayCompact':'hubEveningCompact') : (hour>=5&&hour<10?'hubMorning':hour>=10&&hour<18?'hubDay':'hubEvening'));
  const active=currentItems(items,now);
  const hubRoot=useRef<HTMLDivElement>(null);
  const [selection,setSelection]=useState<HubDetailSelection|null>(null);
  const [provenance,setProvenance]=useState<Record<string,boolean>>({});
  const provenanceFocus=useRef<{id:string;node:HTMLElement}|null>(null);
  // Record semantic focus at the interaction, before media-query callbacks or
  // reparenting can detach/reuse the old node. Restore after the actual commit.
  useLayoutEffect(()=>{
    const remembered=provenanceFocus.current;
    if(!remembered)return;
    const active=document.activeElement;
    const stillSame=remembered.node.isConnected&&remembered.node.closest<HTMLElement>('[data-provenance-id]')?.dataset.provenanceId===remembered.id;
    if(stillSame&&active===remembered.node)return;
    if(active!==document.body&&active!==remembered.node){provenanceFocus.current=null;return;}
    const candidates=Array.from(document.querySelectorAll<HTMLElement>('[data-provenance-id]'));
    const replacement=candidates.find(node=>node.dataset.provenanceId===remembered.id&&node.getClientRects().length)?.querySelector<HTMLElement>('summary');
    if(replacement){provenanceFocus.current={id:remembered.id,node:replacement};replacement.focus();}
    else provenanceFocus.current=null;
  });
  const returnTo=useRef<{node:HTMLButtonElement;scope?:string;personId?:string;selection:HubDetailSelection}|null>(null);
  const liveMessages=messages.filter(m=>Date.parse(m.publishAt)<=now&&Date.parse(m.expiresAt)>now);
  const detail=resolveHubDetail(selection,people,active,liveMessages,now,zone);
  const closeDetail=()=>{
    setSelection(null);
    requestAnimationFrame(()=>{
      const target=returnTo.current;
      if(!target)return;
      const visible=(node:HTMLElement|undefined|null)=>node?.isConnected&&Boolean(node.getClientRects().length);
      if(visible(target.node)){target.node.focus();return;}
      const controls=Array.from(hubRoot.current?.querySelectorAll<HTMLButtonElement>('[data-hub-detail]')??[]);
      const same=controls.find(node=>node.dataset.hubDetail===target.selection.id&&node.dataset.hubDetailKind===target.selection.kind&&node.closest<HTMLElement>('[data-hub-scope]')?.dataset.hubScope===target.scope&&visible(node));
      const person=controls.find(node=>node.dataset.hubDetail===target.personId&&node.dataset.hubDetailKind==='person'&&visible(node));
      (same??person??hubRoot.current)?.focus();
    });
  };
  useEffect(()=>{if(selection&&!detail)closeDetail();},[selection,Boolean(detail)]);
  const detailAccess:DetailAccess={
    open:(next,trigger)=>{returnTo.current={node:trigger,selection:next,scope:trigger.closest<HTMLElement>('[data-hub-scope]')?.dataset.hubScope,personId:trigger.closest<HTMLElement>('[data-person-id]')?.dataset.personId};setSelection(next);},
    provenance,setProvenance:(id,open)=>setProvenance(previous=>previous[id]===open?previous:{...previous,[id]:open}),
    rememberProvenanceFocus:(id,node)=>{provenanceFocus.current={id,node};},
  };
  const important=importantItems(active);
  const briefs=active.filter(i=>['summary','list','observation'].includes(i.kind)&&!i.metadata.temperature&&!important.includes(i));
  const previewLimit=importantPreviewLimit({dark,compact,lowHeight});
  const compose=display?undefined:onCompose;
  const companion=briefs.find(item=>item.kind==='observation')??briefs[0];
  const collectionTitle=(id:HubCollection)=>t(({important:'hubImportant',briefs:'hubBriefs',messages:'hubMessages',today:'hubToday',tomorrow:'hubTomorrow',waste:'hubUpcomingWaste'} as const)[id]);
  const collectionButton=(id:HubCollection,count:number)=><button className="hub-collection-link" data-hub-detail={id} data-hub-detail-kind="collection" onClick={event=>detailAccess.open({kind:'collection',id},event.currentTarget)}>{t('hubViewCollection',{section:collectionTitle(id),count})}<Icon name="arrow" size={16}/></button>;
  const sections: Record<string, ReactNode> = {
    people: mobile ? null : <section key="people" className={`hub-person-section ${peopleLayout?'hub-adaptive-people':''} ${peopleLayout&&peopleLayout.rows>1?'hub-people-multirow':''} ${concisePeople?'hub-people-summary':''}`} aria-labelledby="hub-people-title"><PanelTitle id="hub-people-title" icon="people" title={t(dark&&!compact?'hubFamilyHeading':'hubPeople')} count={people.length}/><div ref={peopleGrid} className="hub-person-grid" style={peopleLayout?{'--hub-people-columns':peopleLayout.columns} as CSSProperties:undefined}>{people.map((person,index)=>{
      const personal=personalPreviewItems(active,person.id,now,zone);
      return <PersonCard combined={lowHeight&&!compact&&(concisePeople||Boolean(peopleLayout&&peopleLayout.rows>1))} summary={concisePeople} taskAccess={taskAccess} key={person.id} person={person} index={index} items={personal} totalCount={personalWindowItems(active,person.id,now,zone).length} now={now} people={people} zone={zone} display={display} previewLimit={compact||dark||peopleLayout&&peopleLayout.rows>1?1:lowHeight?2:3}/>;
    })}</div></section>,
    important: <section key="important" className="hub-important hub-panel" data-hub-scope="important"><PanelTitle icon="bell" title={t('hubImportant')} count={important.length}/>{important.length?<><div className="hub-important-grid">{important.slice(0,previewLimit).map(item=><article key={item.id} className={`hub-reminder kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><Icon name={kindIcons[item.kind]} size={22}/><div><ItemTitle item={item} people={people} zone={zone} display={display} heading indicator/><p className="hub-reminder-target">{targetNames(item,people,t('hubFamily'))}</p></div></article>)}</div>{important.length>previewLimit&&collectionButton('important',important.length)}</>:<p className="hub-empty"><Icon name="check"/>{t('hubNoImportant')}</p>}</section>,
    messages: <section key="messages" className="hub-messages hub-panel" data-hub-scope="messages"><div className="hub-message-heading"><PanelTitle icon="message" title={t('hubMessages')} count={liveMessages.length}/>{mobile&&!dark&&compose&&<button type="button" className="button hub-feed-compose" onClick={compose}><Icon name="plus" size={16}/>{t('newMessage')}</button>}</div>{liveMessages.length?<><div className="hub-message-grid">{liveMessages.slice(0,compact?1:liveMessages.length).map(message=><MessageCard key={message.id} message={message} people={people} zone={zone} preview/>)}</div>{compact&&liveMessages.length>1&&collectionButton('messages',liveMessages.length)}</>:<p className="hub-empty">{t('hubNoMessages')}</p>}</section>,
    support: <section key="support" className="hub-support hub-panel" data-hub-scope="briefs"><PanelTitle icon="spark" title={t('hubBriefs')} count={briefs.length}/>{companion?<><div className="hub-support-preview" data-item-id={companion.id}><ItemTitle item={companion} people={people} zone={zone} display={display} heading indicator/>{companion.body&&<p lang={companion.contentLocale??''}>{companion.body}</p>}{companion.entries.length>0&&<p lang={companion.contentLocale??''}>{companion.entries.slice(0,2).map(entry=>entry.label).join(' · ')}</p>}</div>{briefs.length>1&&collectionButton('briefs',briefs.length)}</>:<p className="hub-empty">{t('hubNoBriefs')}</p>}</section>,

  };
  for (const offset of [0,1]) {
    const key=offset?'tomorrow':'today';
    const events=dayEvents(active,now,zone,offset);
    const limit=mobile?(dark?3:1):compact||lowHeight?3:5;
    const next=mobile&&!dark&&!offset?events.find(item=>item.metadata.allDay||Date.parse(item.endsAt??item.startsAt!)>now):undefined;
    const preview=next?[next]:events.slice(0,limit);
    const day=<section key={key} data-hub-scope={key} className={`hub-agenda hub-day hub-panel hub-${key}`}><PanelTitle icon={offset?'calendar':'sun'} title={t(offset?'hubTomorrow':'hubToday')} count={events.length}/>{events.length?<ol className="hub-timeline">{preview.map(item=><li key={item.id} data-item-id={item.id}><time dateTime={item.startsAt!}>{item.metadata.allDay?t('hubAllDay'):formatDate(item.startsAt!,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time><div><ItemTitle item={item} people={people} zone={zone} display={display}/><p>{targetNames(item,people,t('hubFamily'))}</p>{item.metadata.location&&<small lang={item.contentLocale ?? ''}>{item.metadata.location}</small>}</div></li>)}</ol>:<p className="hub-empty"><Icon name="leaf"/>{t('hubNoEvents')}</p>}{events.length>preview.length&&collectionButton(key,events.length)}</section>;
    sections[key]=day;
  }
  return <HubDetails.Provider value={detailAccess}><div ref={hubRoot} tabIndex={-1} data-person-count={people.length} className={`family-hub ${display?'hub-display':'hub-member'} ${dark?'hub-dark':'hub-light'} ${compact?'hub-compact':'hub-wide'} ${lowHeight?'hub-low-height':''} ${companion?'hub-has-companion':''} ${people.length>4?'hub-larger-family':''} ${minCardWidth>144?'hub-long-names':''}`} data-testid="family-hub">
    <section className="hub-hero">
      <div className="hub-hero-copy"><p className="hub-household">{householdName}</p><h1>{greeting}</h1><p className="hub-subtitle">{t('hubSubtitle')}</p></div>
      <div className="hub-hero-clock"><span>{formatDate(now,locale,zone,{weekday:'long',day:'numeric',month:'long'})}</span><strong>{formatDate(now,locale,zone,{hour:'2-digit',minute:'2-digit'})}</strong>{connection&&<span className={`connection-pill ${connection===t('live')?'hub-live-status':''}`} role="status"><span className="live-dot"/>{connection}</span>}</div>
      {compose&&<button className="button hub-compose" onClick={compose}><Icon name="plus"/>{t('newMessage')}</button>}
    </section>
    {mobile&&<nav className="hub-identities" aria-label={t('hubPeople')}>{people.map((p,i)=><button key={p.id} type="button" data-person-id={p.id} data-hub-detail={p.id} data-hub-detail-kind="person" aria-label={t('hubPersonDetails',{name:p.displayName})} onClick={event=>detailAccess.open({kind:'person',id:p.id},event.currentTarget)}><Avatar name={p.displayName} index={i} personId={p.id} avatarKey={p.avatarKey} photo={p.photo}/><strong>{p.displayName}</strong></button>)}</nav>}
    <div className="hub-grid">{hubSectionOrder(dark,compact,mobile).map(key=>key==='dayPlan'?<div key="dayPlan" className="hub-day-plan">{sections.today}{sections.tomorrow}</div>:key==='quickActions'?(compose||important.length>0)&&<section key="quickActions" className="hub-quick-actions" aria-label={t('hubQuickActions')}>{compose&&<button className="button" onClick={compose}><Icon name="message"/>{t('newMessage')}</button>}{liveMessages.length>0&&<button className="button" data-hub-detail="messages" data-hub-detail-kind="collection" onClick={event=>detailAccess.open({kind:'collection',id:'messages'},event.currentTarget)}><Icon name="message"/>{t('hubViewMessages',{count:liveMessages.length})}</button>}</section>:sections[key])}</div>
    <HomeEnvironment now={now} waste={wasteEvents(active,now,zone)} temperatures={temperatureItems(active)} zone={zone} onWaste={trigger=>detailAccess.open({kind:"collection",id:"waste"},trigger)}/>
    {detail&&createPortal(<Dialog className={detail.kind==='person'?'hub-person-drawer':'hub-item-dialog'} title={detail.kind==='item'?detail.item.title:detail.kind==='person'?detail.person.displayName:detail.kind==='message'?t('hubMessageFrom',{name:detail.message.authorName}):collectionTitle(detail.id)} titleLang={detail.kind==='item'?detail.item.contentLocale??'':undefined} onClose={closeDetail}>
      {detail.kind==='item'?<ItemCard item={detail.item} people={people} zone={zone} display={display} hideTitle/>:
       detail.kind==='message'?<MessageCard message={detail.message} people={people} zone={zone}/>:
       detail.kind==='collection'?<div className="hub-collection-details" data-collection={detail.id}>{detail.messages.map(message=><MessageCard key={message.id} message={message} people={people} zone={zone}/>)}{detail.items.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}{!detail.items.length&&!detail.messages.length&&<p className="hub-empty">{t('hubCollectionEmpty')}</p>}</div>:
       <div className="hub-person-details"><header className="hub-detail-identity" data-accent={personAccent(detail.person.id,detail.person.avatarKey)}><Avatar name={detail.person.displayName} personId={detail.person.id} avatarKey={detail.person.avatarKey} photo={detail.person.photo} index={Math.max(0,people.findIndex(p=>p.id===detail.person.id))}/><p>{t('hubPersonalScope')}</p></header><UpcomingActivities items={detail.items.filter(item=>!itemHousehold(item))} people={people} zone={zone} now={now} display={display}/>{(['reminder','other'] as const).map(group=>{const grouped=detail.items.filter(item=>!itemHousehold(item)&&!item.metadata.temperature&&(group==='reminder'?['reminder','alert'].includes(item.kind):!['event','reminder','alert'].includes(item.kind)));return grouped.length?<section key={group}><h3 className="hub-detail-group-title">{t(group==='reminder'?'hubImportant':'hubBriefs')}</h3>{grouped.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</section>:null})}{!detail.items.some(item=>!itemHousehold(item))&&<p className="hub-empty">{t('hubNoPersonal')}</p>}{active.some(item=>!item.metadata.temperature&&item.metadata.calendar?.purpose!=='waste'&&itemHousehold(item))&&<section><h3 className="hub-detail-group-title">{t('hubSharedContent')}</h3><p className="field-hint">{t('hubSharedContentHint')}</p>{active.filter(item=>!item.metadata.temperature&&item.metadata.calendar?.purpose!=='waste'&&itemHousehold(item)).map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</section>}{taskAccess&&!display&&<PersonTasks {...taskAccess} personId={detail.person.id} timezone={zone} onOpen={id=>{closeDetail();taskAccess.onOpen(id)}} onNew={id=>{closeDetail();taskAccess.onNew(id)}}/>}{onEditPhoto&&!display&&editablePhotoIds?.includes(detail.person.id)&&<button className="button" onClick={()=>{closeDetail();onEditPhoto(detail.person.id)}}>{t('photoEdit')}</button>}{onManagePeople&&!display&&<button className="button" onClick={()=>{closeDetail();onManagePeople()}}><Icon name="people"/>{t('editPerson')}</button>}</div>}
    </Dialog>,document.body)}
  </div></HubDetails.Provider>;
}
// Observe the already-resolved app theme (including system changes), so DOM,
// reading and keyboard order follow the same composition as the visible grid.
function useHubComposition() {
  const queries=['(max-width: 1000px)','(max-width: 640px)','(min-width: 1001px) and (max-height: 850px)'];
  const read=()=>({dark:document.documentElement.dataset.theme==='dark',compact:matchMedia(queries[0]!).matches,mobile:matchMedia(queries[1]!).matches,lowHeight:matchMedia(queries[2]!).matches});
  const [composition,setComposition]=useState(read);
  useEffect(()=>{
    const media=queries.map(query=>matchMedia(query));
    const update=()=>setComposition(read());
    const observer=new MutationObserver(update);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    media.forEach(query=>query.addEventListener('change',update));update();
    return()=>{observer.disconnect();media.forEach(query=>query.removeEventListener('change',update))};
  },[]);
  return composition;
}

function PanelTitle({icon,title,count,id}:{icon:string;title:string;count?:number;id?:string}) {return <div className="hub-panel-title"><h2 id={id}><Icon name={icon}/>{title}</h2>{count!==undefined&&<span className="hub-count">{count}</span>}</div>}
function targetNames(item:HubItem,people:HubPerson[],family:string) { return itemHousehold(item)?family:people.filter(p=>itemSubjectIds(item).includes(p.id)).map(p=>p.displayName).join(' · '); }
function PersonCard({person,index,items,totalCount,people,zone,display,previewLimit,taskAccess,now,summary=false,combined=false}:{now:number;combined?:boolean;summary?:boolean;taskAccess?:TaskAccess;person:HubPerson;index:number;items:HubItem[];totalCount:number;people:HubPerson[];zone:string;display:boolean;previewLimit:number}) {
 const {t,locale}=useI18n();const details=useContext(HubDetails);
 const remaining=hiddenPersonalCount(totalCount,Math.min(items.length,previewLimit));
 // One complete detail entry on short displays avoids repeating three touch rows.
 // Its natural accessible name includes the visible activity and task status.
 if(combined){
  const preview=previewLimit>0?items[0]:undefined;
  const rest=hiddenPersonalCount(totalCount,preview?1:0);
  return <article className="hub-person hub-person-combined" id={`hub-person-${person.id}`} tabIndex={-1} data-person-id={person.id} data-hub-scope={`person-${person.id}`} data-accent={personAccent(person.id,person.avatarKey)}>
   <header><button className="hub-person-identity" data-person-id={person.id} data-hub-detail={person.id} data-hub-detail-kind="person" aria-label={t('hubPersonDetails',{name:person.displayName})} onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)}>
    <Avatar name={person.displayName} index={index} personId={person.id} avatarKey={person.avatarKey} photo={person.photo}/>
    <span className="hub-person-name"><strong>{person.displayName}<Icon name="arrow" size={16}/></strong></span>
    <span className="hub-person-overview"><span className="hub-person-activity">{preview?<><span lang={preview.contentLocale??''}>{preview.kind==='event'&&<span className="hub-person-day">{t(overlapsDay(preview,dayKey(now,zone),zone)?'hubToday':'hubTomorrow')} · </span>}{preview.title}</span><CalendarFreshness item={preview}/>{rest>0&&<> · <span className="hub-person-rest">{t('hubMoreItems',{count:rest})}</span></>}</>:totalCount?t(totalCount===1?'hubViewPersonalOne':'hubViewPersonal',{count:totalCount}):t('hubNoNearActivities')}</span>
     <span className="hub-upcoming-hint">{t('hubUpcomingActivities')}</span>
   {taskAccess&&!display&&<PersonTasks {...taskAccess} personId={person.id} timezone={zone} compact inline/>}
    </span>
   </button></header>
  </article>;
 }
 return <article className={`hub-person ${totalCount>0&&!items.length?'hub-person-no-preview':''}`} id={`hub-person-${person.id}`} tabIndex={-1} data-person-id={person.id} data-hub-scope={`person-${person.id}`} data-accent={personAccent(person.id,person.avatarKey)}>
   <header><button className="hub-person-identity" data-person-id={person.id} data-hub-detail={person.id} data-hub-detail-kind="person" onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)} aria-label={t('hubPersonDetails',{name:person.displayName})}><Avatar name={person.displayName} index={index} personId={person.id} avatarKey={person.avatarKey} photo={person.photo}/><span className="hub-person-name"><strong>{person.displayName}<Icon name="arrow" size={16}/></strong>{summary&&items[0]&&<span className="hub-person-activity" lang={items[0].contentLocale??''}>{items[0].kind==='event'&&<span className="hub-person-day">{t(overlapsDay(items[0],dayKey(now,zone),zone)?'hubToday':'hubTomorrow')} · </span>}{items[0].title}<CalendarFreshness item={items[0]}/></span>}{(!summary||!items.length)&&(totalCount>0||previewLimit===0||summary)&&<span>{totalCount?t(totalCount===1?'hubActivitySingle':'hubActivityCount',{count:totalCount}):t('hubNoNearActivities')}</span>}</span></button></header>
   {items.length&&!summary?<ul className="hub-person-items">{items.map((item,i)=><li hidden={i>=previewLimit} key={item.id} data-item-id={item.id} className={`kind-${item.kind}`}><span className="hub-item-dot"><Icon name={kindIcons[item.kind]} size={16}/></span><div>{item.kind==='event'&&<span className="hub-person-day">{t(overlapsDay(item,dayKey(now,zone),zone)?'hubToday':'hubTomorrow')}</span>}<ItemTitle item={item} people={people} zone={zone} display={display}/>{item.startsAt&&<small>{item.metadata.allDay?<>{t('hubAllDay')} · {(item.metadata.calendar?formatCalendarEventRange:formatEventRange)(item.startsAt,item.endsAt,locale,zone,true)}</>:formatDate(item.startsAt,locale,zone,{weekday:'short',hour:'2-digit',minute:'2-digit'})}</small>}</div></li>)}</ul>:totalCount===0?<div className="hub-person-clear"><Icon name="leaf" size={24}/><span>{t('hubNoNearActivities')}</span></div>:null}
   {remaining>0&&<button className="hub-person-more" data-hub-detail={person.id} data-hub-detail-kind="person" onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)}>{t(Math.min(items.length,previewLimit)===0?(remaining===1?'hubViewPersonalOne':'hubViewPersonal'):'hubMoreItems',{count:remaining})}</button>}
   <button className="hub-upcoming-link" data-hub-detail={person.id} data-hub-detail-kind="person" onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)}>{t('hubUpcomingActivities')}<Icon name="arrow" size={14}/></button>
   {taskAccess&&!display&&<PersonTasks {...taskAccess} personId={person.id} timezone={zone} compact onViewDetails={trigger=>details?.open({kind:"person",id:person.id},trigger)}/>}
 </article>;
}
export function UpcomingActivities({items,people,zone,now,display=false}:{items:HubItem[];people:HubPerson[];zone:string;now:number;display?:boolean}){
 const {t,locale}=useI18n();const personal=items.filter(item=>item.metadata.calendar?.purpose!=='waste');const upcoming=upcomingEvents(personal,now,zone);const windows=new Map<string,HubItem>();for(const item of personal)if(item.metadata.calendar?.lastCompleteWindow)windows.set(item.metadata.calendar.sourceId,item);
 return <section className="hub-upcoming"><h3 className="hub-detail-group-title">{t('hubUpcomingActivities')}</h3>{[...windows.values()].map(item=><p key={item.metadata.calendar!.sourceId} className="field-hint">{item.source.label} · {t('calendarPreviewWindow')}: {formatDate(item.metadata.calendar!.lastCompleteWindow!.from,locale,zone,{dateStyle:'medium'})} – {formatDate(item.metadata.calendar!.lastCompleteWindow!.to,locale,zone,{dateStyle:'medium'})}</p>)}{upcoming.length?eventDateGroups(upcoming,zone).map(group=><section key={group.day} className="hub-date-group"><h4><time dateTime={group.day}>{formatDate(`${group.day}T12:00:00Z`,locale,'UTC',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</time></h4>{group.items.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</section>):<p className="hub-empty">{t('hubNoUpcomingActivities')}</p>}</section>;
}
export function ItemCard({item,people,zone,display=false,hideTitle=false}:{item:HubItem;people:HubPerson[];zone:string;display?:boolean;hideTitle?:boolean}) {
 const {t,locale}=useI18n();
 return <article className={`hub-item kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><div className="hub-item-label"><span><Icon name={kindIcons[item.kind]} size={18}/>{t(kindKeys[item.kind])}</span><small>{targetNames(item,people,t('hubFamily'))}</small></div>{!hideTitle&&<h3 lang={item.contentLocale ?? ""}>{item.title}</h3>}<CalendarFreshness item={item} zone={zone} detail/>{item.startsAt&&<p className="hub-item-when"><Icon name="calendar" size={16}/><time dateTime={item.startsAt}>{item.metadata.allDay&&<>{t('hubAllDay')} · </>}{(item.metadata.calendar?formatCalendarEventRange:formatEventRange)(item.startsAt,item.endsAt,locale,zone,item.metadata.allDay)}</time></p>}{item.metadata.location&&<p className="hub-item-location" lang={item.contentLocale??""}><Icon name="home" size={16}/>{item.metadata.location}</p>}{item.body&&<p className="hub-item-body" lang={item.contentLocale ?? ""}>{item.body}</p>}{item.entries.length>0&&<ul className="hub-list">{item.entries.map((entry,i)=><li key={i}><span aria-hidden="true">•</span><div lang={item.contentLocale ?? ""}><strong>{entry.label}</strong>{entry.detail&&<p>{entry.detail}</p>}</div></li>)}</ul>}<Provenance item={item} zone={zone} display={display}/></article>;
}

function Provenance({item,zone,display}:{item:HubItem;zone:string;display:boolean}) {const {t,locale}=useI18n();const details=useContext(HubDetails);return <details className="hub-provenance" data-provenance-id={item.id} open={details?Boolean(details.provenance[item.id]):undefined}><summary lang={item.contentLocale ?? ""} onFocus={event=>details?.rememberProvenanceFocus(item.id,event.currentTarget)} onClick={event=>{
 // A controlled disclosure records intent synchronously. Native toggle events
 // arrive later and can refer to a detached or reused card after relocation.
 if(details){event.preventDefault();details.setProvenance(item.id,!details.provenance[item.id]);}
 }}>{item.source.label}</summary><p>{t('hubObserved',{time:formatDate(item.source.observedAt,locale,zone)})}</p>{item.source.generatedAt&&<p>{t('hubGenerated',{time:formatDate(item.source.generatedAt,locale,zone)})}</p>}<p>{t('hubUncertainty',{level:t(({low:'hubLow',medium:'hubMedium',high:'hubHigh',unknown:'hubUnknown'} as const)[item.source.uncertainty])})}</p>{!display&&item.source.url&&<a href={item.source.url} target="_blank" rel="noreferrer">{t('hubSource')} <Icon name="arrow" size={14}/></a>}{!display&&item.source.links?.map(link=><a lang={item.contentLocale ?? ""} key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</details>;}

function ItemTitle({item,heading=false,indicator=false}:{item:HubItem;people:HubPerson[];zone:string;display:boolean;heading?:boolean;indicator?:boolean}) {
 const details=useContext(HubDetails);
 const button=<button lang={item.contentLocale??''} data-hub-detail={item.id} data-hub-detail-kind="item" className={`hub-item-title ${indicator?'hub-detail-indicator':''}`} onClick={event=>details?.open({kind:'item',id:item.id},event.currentTarget)}><strong>{item.title}<CalendarFreshness item={item}/></strong>{indicator&&<Icon name="arrow" size={16}/>}</button>;
 return heading?<h3 lang={item.contentLocale??''}>{button}</h3>:button;
}

function MessageCard({message,people,zone,preview=false}:{message:HubMessage;people:HubPerson[];zone:string;preview?:boolean}) {
 const {t,locale}=useI18n();const details=useContext(HubDetails);
 const content=<><Avatar name={message.authorName} personId={message.authorPersonId} index={Math.max(0,people.findIndex(person=>person.id===message.authorPersonId))} avatarKey={messageAvatarKey(message,people)} photo={people.find(person=>person.id===message.authorPersonId)?.photo??message.authorPhoto}/><span className="hub-message-copy"><span className="hub-message-meta"><strong>{message.authorName}</strong><time dateTime={message.publishAt}>{formatDate(message.publishAt,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time></span><span className="display-card-body">{message.body}</span>{preview&&<span className="hub-message-read">{t('hubReadMessage')} <Icon name="arrow" size={14}/></span>}</span></>;
 return <article className={`hub-message ${message.importance} ${preview?'hub-message-preview':'hub-message-full'}`} data-card-id={message.id}>{preview?<button className="hub-message-open" data-hub-detail={message.id} data-hub-detail-kind="message" onClick={event=>details?.open({kind:'message',id:message.id},event.currentTarget)}>{content}</button>:content}</article>;
}
