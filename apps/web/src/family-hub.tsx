import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { HubItem, HubMessage, HubPerson } from './home-types';
import { currentItems, dayEvents, importantItems, personItems, hubSectionOrder } from './home-presentation';
import { Avatar, Dialog, Icon, useI18n } from './ui';
import { formatDate, wallInput } from './time';
const kindKeys={event:'hubEvent',reminder:'hubReminder',alert:'hubAlert',summary:'hubSummary',list:'hubList',observation:'hubObservation'} as const;
const kindIcons={event:'calendar',reminder:'sun',alert:'bell',summary:'spark',list:'list',observation:'leaf'};
export function FamilyHub({people,items,messages,zone,householdName,display=false,now:givenNow,onCompose,connection}:{people:HubPerson[];items:HubItem[];messages:HubMessage[];zone:string;householdName:string;display?:boolean;now?:number;onCompose?:()=>void;connection?:string}) {
  const {t,locale}=useI18n();
  const {dark,compact}=useHubComposition();
  const [tick,setTick]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer)},[]);
  const now=givenNow??tick;
  const hour=Number(wallInput(now,zone).slice(11,13));
  const greeting=t(hour>=5&&hour<10?'hubMorning':hour>=10&&hour<18?'hubDay':'hubEvening');
  const active=currentItems(items,now);
  const important=importantItems(active);
  const briefs=active.filter(i=>['summary','list','observation'].includes(i.kind)&&!important.includes(i));
  const liveMessages=messages.filter(m=>Date.parse(m.publishAt)<=now&&Date.parse(m.expiresAt)>now);
  const sections: Record<string, ReactNode> = {
    people: <section key="people" className="hub-person-section" aria-labelledby="hub-people-title"><PanelTitle id="hub-people-title" icon="people" title={t(dark&&!compact?'hubFamilyHeading':'hubPeople')} count={people.length}/><div className="hub-person-grid">{people.map((person,index)=>{
      const personal=personItems(active,person.id).filter(i=>i.kind!=='summary'&&i.kind!=='list');
      return <article className="hub-person" key={person.id} id={`hub-person-${person.id}`} tabIndex={-1} data-person-id={person.id} data-accent={index%4}>
        <header><Avatar name={person.displayName} index={index}/><div><h3>{person.displayName}</h3><span>{personal.length?`${personal.length} · ${t('hubForYou')}`:t('hubNoPersonal')}</span></div></header>
        {personal.length?<ExpandableItems items={personal} people={people} zone={zone} display={display}/>:<div className="hub-person-clear"><Icon name="leaf" size={24}/><span>{t('hubNoPersonal')}</span></div>}
      </article>;
    })}</div></section>,
    important: <section key="important" className="hub-important hub-panel"><PanelTitle icon="sun" title={t('hubImportant')} count={important.length}/>{important.length?<div className="hub-important-grid">{important.map(item=><article key={item.id} className={`hub-reminder priority-${item.priority}`} data-item-id={item.id}><Icon name={kindIcons[item.kind]} size={22}/><div><ItemTitle item={item} people={people} zone={zone} display={display} heading/><p className="hub-reminder-target">{targetNames(item,people,t('hubFamily'))}</p>{item.body&&<p lang={item.contentLocale ?? ''}>{item.body}</p>}</div></article>)}</div>:<p className="hub-empty"><Icon name="check"/>{t('hubNoImportant')}</p>}</section>,
    messages: <section key="messages" className="hub-messages hub-panel"><PanelTitle icon="message" title={t('hubMessages')} count={liveMessages.length}/>{liveMessages.length?<div className="hub-message-grid">{liveMessages.map((message,i)=><article className={`hub-message ${message.importance}`} data-card-id={message.id} key={message.id}><Avatar name={message.authorName} index={Math.max(0,people.findIndex(p=>p.displayName===message.authorName))}/><div><div className="hub-message-meta"><strong>{message.authorName}</strong><time dateTime={message.publishAt}>{formatDate(message.publishAt,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time></div><p className="display-card-body">{message.body}</p></div></article>)}</div>:<p className="hub-empty">{t('hubNoMessages')}</p>}</section>,
    briefs: briefs.length>0?<section key="briefs" className="hub-brief-section"><PanelTitle icon="spark" title={t('hubBriefs')}/><div className="hub-brief-grid">{briefs.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</div></section>:null,
  };
  for (const offset of [0,1]) {
    const key=offset?'tomorrow':'today';
    const events=dayEvents(active,now,zone,offset);
    sections[key]=<section key={key} className={`hub-agenda hub-day hub-panel hub-${key}`}><PanelTitle icon={offset?'calendar':'sun'} title={t(offset?'hubTomorrow':'hubToday')} count={events.length}/>{events.length?<ol className="hub-timeline">{events.map(item=><li key={item.id} data-item-id={item.id}><time dateTime={item.startsAt!}>{item.metadata.allDay?t('hubAllDay'):formatDate(item.startsAt!,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time><div><ItemTitle item={item} people={people} zone={zone} display={display}/><p>{targetNames(item,people,t('hubFamily'))}</p>{item.metadata.location&&<small lang={item.contentLocale ?? ''}>{item.metadata.location}</small>}</div></li>)}</ol>:<p className="hub-empty"><Icon name="leaf"/>{t('hubNoEvents')}</p>}</section>;
  }
  return <div className={`family-hub ${display?'hub-display':'hub-member'} ${dark?'hub-dark':'hub-light'} ${compact?'hub-compact':'hub-wide'}`} data-testid="family-hub">
    <section className="hub-hero">
      <div className="hub-hero-copy"><p className="hub-household">{householdName}</p><h1>{greeting}</h1><p className="hub-subtitle">{t('hubSubtitle')}</p></div>
      <div className="hub-hero-clock"><span>{formatDate(now,locale,zone,{weekday:'long',day:'numeric',month:'long'})}</span><strong>{formatDate(now,locale,zone,{hour:'2-digit',minute:'2-digit'})}</strong>{connection&&<span className="connection-pill" role="status"><span className="live-dot"/>{connection}</span>}</div>
      {onCompose&&<button className="button hub-compose" onClick={onCompose}><Icon name="plus"/>{t('newMessage')}</button>}
    </section>
    {compact&&<nav className="hub-identities" aria-label={t('hubPeople')}>{people.map((p,i)=><a key={p.id} href={`#hub-person-${p.id}`} onClick={e=>{e.preventDefault();document.getElementById(`hub-person-${p.id}`)?.focus();document.getElementById(`hub-person-${p.id}`)?.scrollIntoView({block:'center'});}}><Avatar name={p.displayName} index={i}/><strong>{p.displayName}</strong></a>)}</nav>}
    <div className="hub-grid">{hubSectionOrder(dark,compact).map(key=>sections[key])}</div>
  </div>;
}
// Observe the already-resolved app theme (including system changes), so DOM,
// reading and keyboard order follow the same composition as the visible grid.
function useHubComposition() {
  const read=()=>({dark:document.documentElement.dataset.theme==='dark',compact:matchMedia('(max-width: 1000px)').matches});
  const [composition,setComposition]=useState(read);
  useEffect(()=>{
    const media=matchMedia('(max-width: 1000px)');
    const update=()=>setComposition(read());
    const observer=new MutationObserver(update);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    media.addEventListener('change',update);update();
    return()=>{observer.disconnect();media.removeEventListener('change',update)};
  },[]);
  return composition;
}

function PanelTitle({icon,title,count,id}:{icon:string;title:string;count?:number;id?:string}) {return <div className="hub-panel-title"><h2 id={id}><Icon name={icon}/>{title}</h2>{count!==undefined&&<span className="hub-count">{count}</span>}</div>}
function targetNames(item:HubItem,people:HubPerson[],family:string) { return item.targets.household?family:people.filter(p=>item.targets.personIds.includes(p.id)).map(p=>p.displayName).join(' · '); }
function ExpandableItems({items,people,zone,display}:{items:HubItem[];people:HubPerson[];zone:string;display:boolean}) {
 const [all,setAll]=useState(false);const {t,locale}=useI18n();
 return <><ul className="hub-person-items">{(all?items:items.slice(0,3)).map(item=><li key={item.id} data-item-id={item.id}><span className="hub-item-dot"><Icon name={kindIcons[item.kind]} size={16}/></span><div><ItemTitle item={item} people={people} zone={zone} display={display}/>{item.startsAt&&<small>{formatDate(item.startsAt,locale,zone,{weekday:'short',hour:'2-digit',minute:'2-digit'})}</small>}</div></li>)}</ul>{items.length>3&&<button className="text-button hub-expand" onClick={()=>setAll(!all)} aria-expanded={all}>{t(all?'hubShowLess':'hubMoreItems',{count:items.length-3})}</button>}</>;
}
export function ItemCard({item,people,zone,display=false}:{item:HubItem;people:HubPerson[];zone:string;display?:boolean}) {
 const {t,locale}=useI18n();
 return <article className={`hub-item kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><div className="hub-item-label"><span><Icon name={kindIcons[item.kind]} size={18}/>{t(kindKeys[item.kind])}</span><small>{targetNames(item,people,t('hubFamily'))}</small></div><h3 lang={item.contentLocale ?? ""}>{item.title}</h3>{item.body&&<p className="hub-item-body" lang={item.contentLocale ?? ""}>{item.body}</p>}{item.entries.length>0&&<ul className="hub-list">{item.entries.map((entry,i)=><li key={i}><span aria-hidden="true">•</span><div lang={item.contentLocale ?? ""}><strong>{entry.label}</strong>{entry.detail&&<p>{entry.detail}</p>}</div></li>)}</ul>}<Provenance item={item} zone={zone} display={display}/></article>;
}

function Provenance({item,zone,display}:{item:HubItem;zone:string;display:boolean}) {const {t,locale}=useI18n();return <details className="hub-provenance"><summary lang={item.contentLocale ?? ""}>{item.source.label}</summary><p>{t('hubObserved',{time:formatDate(item.source.observedAt,locale,zone)})}</p>{item.source.generatedAt&&<p>{t('hubGenerated',{time:formatDate(item.source.generatedAt,locale,zone)})}</p>}<p>{t('hubUncertainty',{level:t(({low:'hubLow',medium:'hubMedium',high:'hubHigh',unknown:'hubUnknown'} as const)[item.source.uncertainty])})}</p>{!display&&item.source.url&&<a href={item.source.url} target="_blank" rel="noreferrer">{t('hubSource')} <Icon name="arrow" size={14}/></a>}{!display&&item.source.links?.map(link=><a lang={item.contentLocale ?? ""} key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</details>;}

function ItemTitle({item,people,zone,display,heading=false}:{item:HubItem;people:HubPerson[];zone:string;display:boolean;heading?:boolean}) {
 const [open,setOpen]=useState(false);
 const button=<button lang={item.contentLocale ?? ''} className="hub-item-title" onClick={()=>setOpen(true)}><strong>{item.title}</strong></button>;
 // A detail dialog stays in the top layer when its keyed section moves on
 // rotation or theme change; its trigger remains the focus-return target.
 return <>{heading?<h3 lang={item.contentLocale ?? ''}>{button}</h3>:button}{open&&createPortal(<Dialog title={item.title} titleLang={item.contentLocale ?? ''} onClose={()=>setOpen(false)}><ItemCard item={item} people={people} zone={zone} display={display}/></Dialog>,document.body)}</>;
}
