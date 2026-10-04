import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { HubItem, HubMessage, HubPerson } from './home-types';
import { currentItems, dayEvents, messageAvatarKey, importantItems, hubSectionOrder, splitBriefs, personalPreviewItems, hiddenPersonalCount, resolveHubDetail, type HubDetailSelection } from './home-presentation';
import { Avatar, Dialog, Icon, useI18n } from './ui';
import { formatDate, wallInput } from './time';
const kindKeys={event:'hubEvent',reminder:'hubReminder',alert:'hubAlert',summary:'hubSummary',list:'hubList',observation:'hubObservation'} as const;
const kindIcons={event:'calendar',reminder:'sun',alert:'bell',summary:'spark',list:'list',observation:'leaf'};
type DetailAccess={open:(selection:HubDetailSelection,trigger:HTMLButtonElement)=>void;provenance:Record<string,boolean>;setProvenance:(id:string,open:boolean)=>void;rememberProvenanceFocus:(id:string,node:HTMLElement)=>void};
const HubDetails=createContext<DetailAccess|null>(null);
export function FamilyHub({people,items,messages,zone,householdName,display=false,now:givenNow,onCompose,onManagePeople,connection}:{people:HubPerson[];items:HubItem[];messages:HubMessage[];zone:string;householdName:string;display?:boolean;now?:number;onCompose?:()=>void;onManagePeople?:()=>void;connection?:string}) {
  const {t,locale}=useI18n();
  const {dark,compact,mobile,lowHeight}=useHubComposition();
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
  const detail=resolveHubDetail(selection,people,active);
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
  const briefs=active.filter(i=>['summary','list','observation'].includes(i.kind)&&!important.includes(i));
  const stackAgenda=false;
  const {agendaCompanion,companion,remaining:otherBriefs}=splitBriefs(briefs,stackAgenda);
  const liveMessages=messages.filter(m=>Date.parse(m.publishAt)<=now&&Date.parse(m.expiresAt)>now);
  const sections: Record<string, ReactNode> = {
    people: mobile ? null : <section key="people" className="hub-person-section" aria-labelledby="hub-people-title"><PanelTitle id="hub-people-title" icon="people" title={t(dark&&!compact?'hubFamilyHeading':'hubPeople')} count={people.length}/><div className="hub-person-grid">{people.map((person,index)=>{
      const personal=personalPreviewItems(active,person.id);
      return <PersonCard key={person.id} person={person} index={index} items={personal} people={people} zone={zone} display={display} previewLimit={dark?1:lowHeight?2:3}/>;
    })}</div></section>,
    important: <section key="important" className="hub-important hub-panel" data-hub-scope="important"><PanelTitle icon="sun" title={t('hubImportant')} count={important.length}/>{important.length?<div className="hub-important-grid">{important.map(item=><article key={item.id} className={`hub-reminder kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><Icon name={kindIcons[item.kind]} size={22}/><div><ItemTitle item={item} people={people} zone={zone} display={display} heading indicator/><p className="hub-reminder-target">{targetNames(item,people,t('hubFamily'))}</p>{item.body&&<p className="hub-reminder-body" lang={item.contentLocale ?? ''}>{item.body}</p>}</div></article>)}</div>:<p className="hub-empty"><Icon name="check"/>{t('hubNoImportant')}</p>}</section>,
    messages: <section key="messages" className="hub-messages hub-panel"><PanelTitle icon="message" title={t('hubMessages')} count={liveMessages.length}/>{liveMessages.length?<div className="hub-message-grid">{liveMessages.map((message,i)=><article className={`hub-message ${message.importance}`} data-card-id={message.id} key={message.id}><Avatar name={message.authorName} index={Math.max(0,people.findIndex(p=>p.id===message.authorPersonId))} avatarKey={messageAvatarKey(message,people)}/><div><div className="hub-message-meta"><strong>{message.authorName}</strong><time dateTime={message.publishAt}>{formatDate(message.publishAt,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time></div><p className="display-card-body">{message.body}</p></div></article>)}</div>:<p className="hub-empty">{t('hubNoMessages')}</p>}{mobile&&!dark&&onCompose&&<button className="button hub-feed-compose" onClick={onCompose}><Icon name="message"/>{t('newMessage')}</button>}</section>,
    companion: companion?<section key="companion" className="hub-companion" aria-label={t('hubBriefs')}><ItemCard item={companion} people={people} zone={zone} display={display}/></section>:null,
    briefs: otherBriefs.length>0?<section key="briefs" className="hub-brief-section"><PanelTitle icon="spark" title={t('hubBriefs')}/><div className="hub-brief-grid">{otherBriefs.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</div></section>:null,
  };
  for (const offset of [0,1]) {
    const key=offset?'tomorrow':'today';
    const events=dayEvents(active,now,zone,offset);
    const day=<section key={key} data-hub-scope={key} className={`hub-agenda hub-day hub-panel hub-${key}`}><PanelTitle icon={offset?'calendar':'sun'} title={t(offset?'hubTomorrow':'hubToday')} count={events.length}/>{events.length?<ol className="hub-timeline">{events.map(item=><li key={item.id} data-item-id={item.id}><time dateTime={item.startsAt!}>{item.metadata.allDay?t('hubAllDay'):formatDate(item.startsAt!,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time><div><ItemTitle item={item} people={people} zone={zone} display={display}/><p>{targetNames(item,people,t('hubFamily'))}</p>{item.metadata.location&&<small lang={item.contentLocale ?? ''}>{item.metadata.location}</small>}</div></li>)}</ol>:<p className="hub-empty"><Icon name="leaf"/>{t('hubNoEvents')}</p>}</section>;
    sections[key]=day;
  }
  return <HubDetails.Provider value={detailAccess}><div ref={hubRoot} tabIndex={-1} className={`family-hub ${display?'hub-display':'hub-member'} ${dark?'hub-dark':'hub-light'} ${compact?'hub-compact':'hub-wide'} ${lowHeight?'hub-low-height':''} ${companion?'hub-has-companion':''}`} data-testid="family-hub">
    <section className="hub-hero">
      <div className="hub-hero-copy"><p className="hub-household">{householdName}</p><h1>{greeting}</h1><p className="hub-subtitle">{t('hubSubtitle')}</p></div>
      <div className="hub-hero-clock"><span>{formatDate(now,locale,zone,{weekday:'long',day:'numeric',month:'long'})}</span><strong>{formatDate(now,locale,zone,{hour:'2-digit',minute:'2-digit'})}</strong>{connection&&<span className="connection-pill" role="status"><span className="live-dot"/>{connection}</span>}</div>
      {onCompose&&<button className="button hub-compose" onClick={onCompose}><Icon name="plus"/>{t('newMessage')}</button>}
    </section>
    {mobile&&<nav className="hub-identities" aria-label={t('hubPeople')}>{people.map((p,i)=><button key={p.id} type="button" data-person-id={p.id} data-hub-detail={p.id} data-hub-detail-kind="person" onClick={event=>detailAccess.open({kind:'person',id:p.id},event.currentTarget)}><Avatar name={p.displayName} index={i} avatarKey={p.avatarKey}/><strong>{p.displayName}</strong></button>)}</nav>}
    <div className="hub-grid">{hubSectionOrder(dark,compact,mobile).map(key=>key==='dayPlan'?<div key="dayPlan" className="hub-day-plan">{sections.today}{sections.tomorrow}</div>:key==='quickActions'?(onCompose||important.length>0)&&<section key="quickActions" className="hub-quick-actions" aria-label={t('hubQuickActions')}>{onCompose&&<button className="button" onClick={onCompose}><Icon name="message"/>{t('newMessage')}</button>}{important[0]&&<button className="button" data-hub-detail={important[0].id} data-hub-detail-kind="item" onClick={event=>detailAccess.open({kind:'item',id:important[0]!.id},event.currentTarget)}><Icon name="bell"/>{t('hubImportant')}</button>}</section>:sections[key])}</div>
    {detail&&createPortal(<Dialog className={detail.kind==='person'?'hub-person-drawer':'hub-item-dialog'} title={detail.kind==='item'?detail.item.title:detail.person.displayName} titleLang={detail.kind==='item'?detail.item.contentLocale??'':undefined} onClose={closeDetail}>{detail.kind==='item'?<ItemCard item={detail.item} people={people} zone={zone} display={display}/>:<div className="hub-person-details"><header className="hub-detail-identity" data-accent={Math.max(0,people.findIndex(p=>p.id===detail.person.id))%4}><Avatar name={detail.person.displayName} avatarKey={detail.person.avatarKey} index={Math.max(0,people.findIndex(p=>p.id===detail.person.id))}/><div><p className="eyebrow">{t('hubForYou')}</p><h3>{detail.person.displayName}</h3><p>{t('hubPersonalScope')}</p></div></header>{(['event','reminder','other'] as const).map(group=>{const grouped=detail.items.filter(item=>!item.targets.household&&(group==='event'?item.kind==='event':group==='reminder'?['reminder','alert'].includes(item.kind):!['event','reminder','alert'].includes(item.kind)));return grouped.length?<section key={group}><h3 className="hub-detail-group-title">{t(group==='event'?'hubPersonEvents':group==='reminder'?'hubImportant':'hubBriefs')}</h3>{grouped.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</section>:null})}{!detail.items.some(item=>!item.targets.household)&&<p className="hub-empty">{t('hubNoPersonal')}</p>}{active.some(item=>item.targets.household)&&<section><h3 className="hub-detail-group-title">{t('hubSharedContent')}</h3><p className="field-hint">{t('hubSharedContentHint')}</p>{active.filter(item=>item.targets.household).map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</section>}{onManagePeople&&!display&&<button className="button" onClick={()=>{closeDetail();onManagePeople()}}><Icon name="people"/>{t('editPerson')}</button>}</div>}</Dialog>,document.body)}
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
function targetNames(item:HubItem,people:HubPerson[],family:string) { return item.targets.household?family:people.filter(p=>item.targets.personIds.includes(p.id)).map(p=>p.displayName).join(' · '); }
function PersonCard({person,index,items,people,zone,display,previewLimit}:{person:HubPerson;index:number;items:HubItem[];people:HubPerson[];zone:string;display:boolean;previewLimit:number}) {
 const {t,locale}=useI18n();const details=useContext(HubDetails);
 const remaining=hiddenPersonalCount(items.length,previewLimit);
 return <article className="hub-person" id={`hub-person-${person.id}`} tabIndex={-1} data-person-id={person.id} data-hub-scope={`person-${person.id}`} data-accent={index%4}>
   <header><button className="hub-person-identity" data-person-id={person.id} data-hub-detail={person.id} data-hub-detail-kind="person" onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)} aria-label={t('hubPersonDetails',{name:person.displayName,count:items.length})}><Avatar name={person.displayName} index={index} avatarKey={person.avatarKey}/><span className="hub-person-name"><strong>{person.displayName}</strong>{items.length>0&&<span>{`${items.length} · ${t('hubForYou')}`}</span>}</span><Icon name="arrow" size={16}/></button></header>
   {items.length?<ul className="hub-person-items">{items.map((item,i)=><li hidden={i>=previewLimit} key={item.id} data-item-id={item.id} className={`kind-${item.kind}`}><span className="hub-item-dot"><Icon name={kindIcons[item.kind]} size={16}/></span><div><ItemTitle item={item} people={people} zone={zone} display={display}/>{item.startsAt&&<small>{formatDate(item.startsAt,locale,zone,{weekday:'short',hour:'2-digit',minute:'2-digit'})}</small>}</div></li>)}</ul>:<div className="hub-person-clear"><Icon name="leaf" size={24}/><span>{t('hubNoPersonal')}</span></div>}
   {remaining>0&&<button className="hub-person-more" data-hub-detail={person.id} data-hub-detail-kind="person" onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)}>{t('hubMoreItems',{count:remaining})}</button>}
 </article>;
}
export function ItemCard({item,people,zone,display=false}:{item:HubItem;people:HubPerson[];zone:string;display?:boolean}) {
 const {t,locale}=useI18n();
 return <article className={`hub-item kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><div className="hub-item-label"><span><Icon name={kindIcons[item.kind]} size={18}/>{t(kindKeys[item.kind])}</span><small>{targetNames(item,people,t('hubFamily'))}</small></div><h3 lang={item.contentLocale ?? ""}>{item.title}</h3>{item.startsAt&&<p className="hub-item-when"><Icon name="calendar" size={16}/><time dateTime={item.startsAt}>{formatDate(item.startsAt,locale,zone,item.metadata.allDay?{weekday:'long',day:'numeric',month:'long'}:{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></p>}{item.metadata.location&&<p className="hub-item-location" lang={item.contentLocale??""}><Icon name="home" size={16}/>{item.metadata.location}</p>}{item.body&&<p className="hub-item-body" lang={item.contentLocale ?? ""}>{item.body}</p>}{item.entries.length>0&&<ul className="hub-list">{item.entries.map((entry,i)=><li key={i}><span aria-hidden="true">•</span><div lang={item.contentLocale ?? ""}><strong>{entry.label}</strong>{entry.detail&&<p>{entry.detail}</p>}</div></li>)}</ul>}<Provenance item={item} zone={zone} display={display}/></article>;
}

function Provenance({item,zone,display}:{item:HubItem;zone:string;display:boolean}) {const {t,locale}=useI18n();const details=useContext(HubDetails);return <details className="hub-provenance" data-provenance-id={item.id} open={details?Boolean(details.provenance[item.id]):undefined}><summary lang={item.contentLocale ?? ""} onFocus={event=>details?.rememberProvenanceFocus(item.id,event.currentTarget)} onClick={event=>{
 // A controlled disclosure records intent synchronously. Native toggle events
 // arrive later and can refer to a detached or reused card after relocation.
 if(details){event.preventDefault();details.setProvenance(item.id,!details.provenance[item.id]);}
 }}>{item.source.label}</summary><p>{t('hubObserved',{time:formatDate(item.source.observedAt,locale,zone)})}</p>{item.source.generatedAt&&<p>{t('hubGenerated',{time:formatDate(item.source.generatedAt,locale,zone)})}</p>}<p>{t('hubUncertainty',{level:t(({low:'hubLow',medium:'hubMedium',high:'hubHigh',unknown:'hubUnknown'} as const)[item.source.uncertainty])})}</p>{!display&&item.source.url&&<a href={item.source.url} target="_blank" rel="noreferrer">{t('hubSource')} <Icon name="arrow" size={14}/></a>}{!display&&item.source.links?.map(link=><a lang={item.contentLocale ?? ""} key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</details>;}

function ItemTitle({item,heading=false,indicator=false}:{item:HubItem;people:HubPerson[];zone:string;display:boolean;heading?:boolean;indicator?:boolean}) {
 const details=useContext(HubDetails);
 const button=<button lang={item.contentLocale??''} data-hub-detail={item.id} data-hub-detail-kind="item" className={`hub-item-title ${indicator?'hub-detail-indicator':''}`} onClick={event=>details?.open({kind:'item',id:item.id},event.currentTarget)}><strong>{item.title}</strong>{indicator&&<Icon name="arrow" size={16}/>}</button>;
 return heading?<h3 lang={item.contentLocale??''}>{button}</h3>:button;
}
