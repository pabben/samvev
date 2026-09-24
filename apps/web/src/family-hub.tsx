import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { HubItem, HubMessage, HubPerson } from './home-types';
import { currentItems, dayEvents, importantItems, personItems } from './home-presentation';
import { Avatar, Dialog, Icon, useI18n } from './ui';
import { formatDate, wallInput } from './time';
const kindKeys={event:'hubEvent',reminder:'hubReminder',alert:'hubAlert',summary:'hubSummary',list:'hubList',observation:'hubObservation'} as const;
const kindIcons={event:'calendar',reminder:'sun',alert:'bell',summary:'spark',list:'list',observation:'leaf'};
export function FamilyHub({people,items,messages,zone,householdName,display=false,now:givenNow,onCompose,connection}:{people:HubPerson[];items:HubItem[];messages:HubMessage[];zone:string;householdName:string;display?:boolean;now?:number;onCompose?:()=>void;connection?:string}) {
  const {t,locale}=useI18n();
  const [tick,setTick]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer)},[]);
  const now=givenNow??tick;
  const hour=Number(wallInput(now,zone).slice(11,13));
  const greeting=t(hour>=5&&hour<10?'hubMorning':hour>=10&&hour<18?'hubDay':'hubEvening');
  const active=currentItems(items,now);
  const important=importantItems(active);
  const briefs=active.filter(i=>['summary','list','observation'].includes(i.kind)&&!important.includes(i));
  const liveMessages=messages.filter(m=>Date.parse(m.publishAt)<=now&&Date.parse(m.expiresAt)>now);
  return <div className={`family-hub ${display?'hub-display':'hub-member'}`} data-testid="family-hub">
    <section className="hub-hero">
      <div className="hub-hero-copy"><p className="eyebrow">{householdName} <span aria-hidden="true">/</span> {t('hubEyebrow')}</p><h1>{greeting}</h1><p className="hub-subtitle">{t('hubSubtitle')}</p>
        <div className="hub-hero-bottom"><div className="people-stack" role="group" aria-label={t('people')}>{people.slice(0,6).map((p,i)=><Avatar key={p.id} name={p.displayName} index={i}/>)}</div><span className="hub-family-caption">{t('tagline')}</span>{connection&&<span className="connection-pill" role="status"><span className="live-dot"/>{connection}</span>}</div>
      </div>
      <div className="hub-hero-clock"><span>{formatDate(now,locale,zone,{weekday:'long',day:'numeric',month:'long'})}</span><strong>{formatDate(now,locale,zone,{hour:'2-digit',minute:'2-digit'})}</strong>{onCompose&&<button className="button primary" onClick={onCompose}><Icon name="plus"/>{t('newMessage')}</button>}</div>
      <div className="hub-landscape" aria-hidden="true"><i/><i/><i/></div>
    </section>
    <div className="hub-grid">
      <section className="hub-important hub-panel"><PanelTitle icon="sun" title={t('hubImportant')} count={important.length}/>{important.length?<div className="hub-important-grid">{important.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</div>:<p className="hub-empty"><Icon name="check"/>{t('hubNoImportant')}</p>}</section>
      <section className="hub-person-section"><PanelTitle icon="people" title={t('hubPeople')} count={people.length}/><div className="hub-person-grid">{people.map((person,index)=>{
        const personal=personItems(active,person.id).filter(i=>i.kind!=='summary'&&i.kind!=='list');
        return <article className="hub-person" key={person.id} style={{'--person-index':index%5} as CSSProperties} data-person-id={person.id} data-accent={index%5}>
          <header><Avatar name={person.displayName} index={index}/><div><h3>{person.displayName}</h3><span>{personal.length?`${personal.length} · ${t('hubUpcoming')}`:t('hubNoPersonal')}</span></div></header>
          {personal.length?<ExpandableItems items={personal} people={people} zone={zone} display={display}/>:<div className="hub-person-clear"><Icon name="leaf" size={28}/><span>{t('hubNoPersonal')}</span></div>}
        </article>;
      })}</div></section>
      <section className="hub-agenda hub-panel"><PanelTitle icon="calendar" title={t('hubPlan')}/><div className="hub-day-columns">{[0,1].map(offset=>{
        const events=dayEvents(active,now,zone,offset);
        return <section className="hub-day" key={offset}><h3><span className={`hub-day-dot day-${offset}`}/>{t(offset?'hubTomorrow':'hubToday')}<span className="hub-count">{events.length}</span></h3>{events.length?<ol className="hub-timeline">{events.map(item=><li key={item.id} data-item-id={item.id}><time dateTime={item.startsAt!}>{item.metadata.allDay?t('hubAllDay'):formatDate(item.startsAt!,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time><div><ItemTitle item={item} people={people} zone={zone} display={display}/><p>{targetNames(item,people,t('hubFamily'))}</p>{item.metadata.location&&<small lang={item.contentLocale ?? ""}>{item.metadata.location}</small>}</div></li>)}</ol>:<p className="hub-empty">{t('hubNoEvents')}</p>}</section>;
      })}</div></section>
      {briefs.length>0&&<section className="hub-brief-section"><PanelTitle icon="spark" title={t('hubBriefs')}/><div className="hub-brief-grid">{briefs.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display}/>)}</div></section>}
      <section className="hub-messages hub-panel"><PanelTitle icon="message" title={t('hubMessages')} count={liveMessages.length}/>{liveMessages.length?<div className="hub-message-grid">{liveMessages.map((message,i)=><article className={`hub-message ${message.importance}`} data-card-id={message.id} key={message.id}><Avatar name={message.authorName} index={i}/><div><div className="hub-message-meta"><strong>{message.authorName}</strong><time dateTime={message.publishAt}>{formatDate(message.publishAt,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time></div><p className="display-card-body">{message.body}</p></div></article>)}</div>:<p className="hub-empty">{t('hubNoMessages')}</p>}</section>
    </div>
  </div>;
}
function PanelTitle({icon,title,count}:{icon:string;title:string;count?:number}) {return <div className="hub-panel-title"><h2><Icon name={icon}/>{title}</h2>{count!==undefined&&<span className="hub-count">{count}</span>}</div>}
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

function ItemTitle({item,people,zone,display}:{item:HubItem;people:HubPerson[];zone:string;display:boolean}) {const [open,setOpen]=useState(false);return <><button lang={item.contentLocale ?? ""} className="hub-item-title" onClick={()=>setOpen(true)}><strong>{item.title}</strong></button>{open&&<Dialog title={item.title} titleLang={item.contentLocale ?? ""} onClose={()=>setOpen(false)}><ItemCard item={item} people={people} zone={zone} display={display}/></Dialog>}</>;}
