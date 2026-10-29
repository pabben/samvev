import {HomeEnvironment} from './home-environment';
import { BirthdayDayRow, HouseholdActivityWeek, PersonFutureTimeline, SchoolActivityCard } from './home-activities';
import {CalendarFreshness} from './calendar-freshness';
import { PersonTasks } from "./person-tasks";
import { personAccent, personColorToken } from "./person-identity";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import type { HubItem, HubMessage, HubPerson, HomeBirthday, HomeSchoolActivity } from './home-types';
import type { DinnerAssignment } from './household-board-adapters';
import { advanceHomeBirthdays, eventDay,overlapsDay,dayKey,upcomingEvents,eventDateGroups,personalWindowItems,temperatureItems,itemSubjectIds,itemHousehold,adaptivePeopleLayout,peopleCardMinWidth, currentItems, dayEvents, messageAvatarKey, importantItems, importantPreviewLimit, hubSectionOrder, personItems, personalPreviewItems, hiddenPersonalCount, resolveHubDetail, type HubCollection, type HubDetailSelection } from './home-presentation';
import { calendarActivityEnded, currentCalendarActivityRelevant, groupHomeSchoolActivities, shiftHomeDate, type GroupedSchoolActivity } from './home-activity-presentation';
import { Avatar, Dialog, Icon, useI18n } from './ui';
import { formatDate, formatEventRange, formatCalendarEventRange, wallInput } from './time';
const kindKeys={event:'hubEvent',reminder:'hubReminder',alert:'hubAlert',summary:'hubSummary',list:'hubList',observation:'hubObservation'} as const;
const kindIcons={event:'calendar',reminder:'sun',alert:'bell',summary:'spark',list:'list',observation:'leaf'};
type DetailAccess={open:(selection:HubDetailSelection,trigger:HTMLButtonElement)=>void;provenance:Record<string,boolean>;setProvenance:(id:string,open:boolean)=>void;rememberProvenanceFocus:(id:string,node:HTMLElement)=>void};
const HubDetails=createContext<DetailAccess|null>(null);
export type TaskAccess={householdId:string;onOpen:(id:string)=>void;onNew:(personId:string)=>void};
export function FamilyHub({people,items,messages,zone,householdName,householdId,localDate:givenLocalDate,birthdays=[],birthdaySourceLocalDate,schoolActivities=[],display=false,displayDinnersReadable=true,displaySnapshot,displaySections,displayCompactPeople=false,now:givenNow,onCompose,onManagePeople,connection,taskAccess,onEditPhoto,editablePhotoIds,homeModules,homeSmartHome,homePhoto}:{taskAccess?:TaskAccess;onEditPhoto?:(id:string)=>void;editablePhotoIds?:string[];homeModules?:ReactNode;homeSmartHome?:ReactNode;homePhoto?:ReactNode;people:HubPerson[];items:HubItem[];messages:HubMessage[];zone:string;householdName:string;householdId?:string;localDate?:string;birthdays?:HomeBirthday[];birthdaySourceLocalDate?:string;schoolActivities?:HomeSchoolActivity[];display?:boolean;displayDinnersReadable?:boolean;displaySnapshot?:{dinners: DinnerAssignment[];composition?:{theme:string;orientation:'portrait'|'landscape'}};displaySections?:Partial<Record<'people'|'today'|'tomorrow'|'important'|'messages'|'support'|'week'|'environment'|'next',boolean>>;displayCompactPeople?:boolean;now?:number;onCompose?:()=>void;onManagePeople?:()=>void;connection?:string}) {
  const {t,locale}=useI18n();
  const {dark,compact,mobile,lowHeight}=useHubComposition(displaySnapshot?.composition);
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
  const concisePeople=people.length>4;
  const peopleLayout=!dark&&!compact&&!concisePeople?adaptivePeopleLayout(people.length,peopleSpace.width,peopleSpace.gap,minCardWidth):null;
  const [tick,setTick]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer)},[]);
  const now=givenNow??tick;
  const localDate=givenLocalDate??dayKey(now,zone);
  const currentBirthdays=advanceHomeBirthdays(birthdays,birthdaySourceLocalDate,localDate);
  const [currentWeekDinnerState,setCurrentWeekDinnerState]=useState<{householdId?:string;localDate:string;dinners:import('./household-board-adapters').DinnerAssignment[];stale:boolean}>({householdId,localDate,dinners:[],stale:false});
  const dailyDinnerScopeMatches=Boolean(displaySnapshot)||currentWeekDinnerState.householdId===householdId&&currentWeekDinnerState.localDate===localDate;
  const currentWeekDinners=displaySnapshot?.dinners??(dailyDinnerScopeMatches?currentWeekDinnerState.dinners:[]);
  const updateWeekDinners=useCallback((dinners:import('./household-board-adapters').DinnerAssignment[]|undefined,stale=false)=>setCurrentWeekDinnerState(previous=>({householdId,localDate,dinners:dinners??(previous.householdId===householdId&&previous.localDate===localDate?previous.dinners:[]),stale})),[householdId,localDate]);
  const hour=Number(wallInput(now,zone).slice(11,13));
  const greeting=t(mobile ? (hour>=5&&hour<10?'hubMorningCompact':hour>=10&&hour<18?'hubDayCompact':'hubEveningCompact') : (hour>=5&&hour<10?'hubMorning':hour>=10&&hour<18?'hubDay':'hubEvening'));
  const active=currentItems(items,now);
  const today=dayKey(now,zone),tomorrow=dayKey(now,zone,1);
  const groupedSchool=groupHomeSchoolActivities(schoolActivities);
  const currentSchool=groupedSchool.filter(activity=>Date.parse(activity.expiresAt)>now&&(activity.date===today||activity.date===tomorrow));
  const calendarHistory=items.filter(item=>item.metadata.calendar&&(!item.publishAt||Date.parse(item.publishAt)<=now));
  const dayItems=[...active.filter(item=>!item.metadata.calendar),...calendarHistory];
  const detailItems=[...active.filter(item=>!item.metadata.calendar),...calendarHistory];
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
  const detail=resolveHubDetail(selection,people,detailItems,liveMessages,now,zone);
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
    open:(next,trigger)=>{if(displaySnapshot)return;returnTo.current={node:trigger,selection:next,scope:trigger.closest<HTMLElement>('[data-hub-scope]')?.dataset.hubScope,personId:trigger.closest<HTMLElement>('[data-person-id]')?.dataset.personId};setSelection(next);},
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
    people: mobile || (!display&&people.length===0) ? null : <section key="people" className={`hub-person-section ${peopleLayout?'hub-adaptive-people':''} ${peopleLayout&&peopleLayout.rows>1?'hub-people-multirow':''} ${concisePeople?'hub-people-summary':''}`} aria-labelledby="hub-people-title"><PanelTitle id="hub-people-title" icon="people" title={t(dark&&!compact?'hubFamilyHeading':'hubPeople')} count={people.length}/><div ref={peopleGrid} className="hub-person-grid" style={peopleLayout?{'--hub-people-columns':peopleLayout.columns} as CSSProperties:undefined}>{people.map((person,index)=>{
      const personal=personalPreviewItems(active,person.id,now,zone);
      const school=currentSchool.filter(activity=>activity.personIds.includes(person.id));
      const birthday=currentBirthdays.find(activity=>activity.personId===person.id);
      return <PersonCard combined={lowHeight&&!compact&&(concisePeople||Boolean(peopleLayout&&peopleLayout.rows>1))} summary={!display||concisePeople} taskAccess={display?taskAccess:undefined} key={person.id} person={person} index={index} items={personal} school={school} birthday={birthday} now={now} people={people} zone={zone} display={display} previewLimit={compact||dark||peopleLayout&&peopleLayout.rows>1?1:lowHeight?2:3}/>;
    })}</div></section>,
    important: <section key="important" className="hub-important hub-panel" data-hub-scope="important"><PanelTitle icon="bell" title={t('hubImportant')} count={important.length}/>{important.length?<><div className="hub-important-grid">{important.slice(0,previewLimit).map(item=><article key={item.id} className={`hub-reminder kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><Icon name={kindIcons[item.kind]} size={22}/><div><ItemTitle item={item} people={people} zone={zone} display={display} heading indicator/><p className="hub-reminder-target">{targetNames(item,people,t('hubFamily'))}</p></div></article>)}</div>{important.length>previewLimit&&collectionButton('important',important.length)}</>:<p className="hub-empty"><Icon name="check"/>{t('hubNoImportant')}</p>}</section>,
    messages: liveMessages.length ? <section key="messages" className="hub-messages hub-panel" data-hub-scope="messages"><div className="hub-message-heading"><PanelTitle icon="message" title={t('hubMessages')} count={liveMessages.length}/>{mobile&&!dark&&compose&&<button type="button" className="button hub-feed-compose" onClick={compose}><Icon name="plus" size={16}/>{t('newMessage')}</button>}</div>{liveMessages.length?<><div className="hub-message-grid">{liveMessages.slice(0,compact?1:display?liveMessages.length:2).map(message=><MessageCard key={message.id} message={message} people={people} zone={zone} preview/>)}</div>{(compact?liveMessages.length>1:!display&&liveMessages.length>2)&&collectionButton('messages',liveMessages.length)}</>:<p className="hub-empty">{t('hubNoMessages')}</p>}</section> : null,
    support: companion ? <section key="support" className="hub-support hub-panel" data-hub-scope="briefs"><PanelTitle icon="spark" title={t('hubBriefs')} count={briefs.length}/><div className="hub-support-preview" data-item-id={companion.id}><ItemTitle item={companion} people={people} zone={zone} display={display} heading indicator/>{companion.body&&<p lang={companion.contentLocale??''}>{companion.body}</p>}{companion.entries.length>0&&<p lang={companion.contentLocale??''}>{companion.entries.slice(0,2).map(entry=>entry.label).join(' · ')}</p>}</div>{briefs.length>1&&collectionButton('briefs',briefs.length)}</section> : null,

  };
  for (const offset of [0,1]) {
    const key=offset?'tomorrow':'today';
    const date=dayKey(now,zone,offset);
    const events=dayEvents(dayItems,now,zone,offset,true);
    const school=groupedSchool.filter(activity=>activity.date===date);
    const dinner=currentWeekDinners.find(activity=>activity.localDate===date&&activity.title);
    const limit=mobile?1:compact||lowHeight?3:5;
    const next=mobile&&!offset?events.find(item=>item.metadata.allDay||Date.parse(item.endsAt??item.startsAt!)>now):undefined;
    const preview=next?[next]:events.slice(0,limit);
    const birthdayCount=currentBirthdays.filter(activity=>activity.due===(offset?'tomorrow':'today')).length;
    const displayBirthdayRows=currentBirthdays.filter(activity=>activity.due===(offset?'tomorrow':'today'));
    const birthdayRow=display
      ? displayBirthdayRows.length?<div className="hub-birthday-row" data-review-private="birthday-row"><span className="hub-balloons" aria-hidden="true">🎈</span><strong>{t(offset?'hubBirthdayTomorrow':'hubBirthdayToday')}</strong><div className="hub-birthday-people">{displayBirthdayRows.map(birthday=><span className="hub-birthday-person" data-review-private="birthday-person" key={birthday.personId}>🎂 {birthday.displayName}</span>)}</div></div>:null
      : <BirthdayDayRow birthdays={currentBirthdays} due={offset?'tomorrow':'today'} people={people} onOpen={(person,trigger)=>detailAccess.open({kind:'person',id:person.id},trigger)}/>;
    const rowCount=events.length+school.length+(dinner?1:0)+birthdayCount;
    const day=<section key={key} data-hub-scope={key} className={`hub-agenda hub-day hub-panel hub-${key}`}><PanelTitle icon={offset?'calendar':'sun'} title={t(offset?'hubTomorrow':'hubToday')} count={rowCount}/>{birthdayRow}{events.length+school.length+(dinner?1:0)?<><ol className="hub-timeline">{preview.map(item=><li key={item.id} data-item-id={item.id} data-review-private={item.metadata.calendar?.purpose==='waste'?'waste-event':'day-event'}><time dateTime={item.startsAt!}>{item.metadata.allDay?t('hubAllDay'):formatDate(item.startsAt!,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time><span className="hub-week-icon" aria-hidden="true"><Icon name={itemIcon(item)} size={17}/></span><div><ItemTitle item={item} people={people} zone={zone} display={display}/>{!currentCalendarActivityRelevant(item.startsAt,item.endsAt,Boolean(item.metadata.calendar&&item.metadata.allDay),now,zone)&&<small className="hub-ended-label">{t('hubEnded')}</small>}<p>{targetNames(item,people,t('hubFamily'),count=>t('hubPeopleGroup',{count}))}</p>{item.metadata.location&&<small lang={item.contentLocale ?? ''}>{item.metadata.location}</small>}</div></li>)}{school.map(activity=><li key={`school:${activity.id}`} className="hub-day-school" data-review-private="school-activity"><time>{activity.time?activity.time.slice(0,5):t('hubAllDay')}</time><span aria-hidden="true">🎒</span><SchoolActivityCard activity={activity} people={people} compact hideMeta now={now} zone={zone}/></li>)}{dinner&&<li key={`dinner:${dinner.id}`} className="hub-day-dinner" data-review-private="dinner-event" data-event-id={dinner.id}><time>{t('hubDinnerLabel')}</time><span aria-hidden="true">{dinner.emoji??'🍽️'}</span><strong>{dinner.title}</strong></li>}</ol>{events.length>preview.length&&collectionButton(key,events.length)}</>:!birthdayCount?<p className="hub-empty"><Icon name="leaf"/>{t('hubNoEvents')}</p>:null}{dailyDinnerScopeMatches&&currentWeekDinnerState.stale&&<small className="hub-week-error" role="status">{t('hubWeekLoadError')}</small>}</section>;
    sections[key]=day;
  }
  const orderedSections:ReactNode[]=[];
  for(const key of hubSectionOrder(dark,compact,mobile)){
    if(!display&&key==='important'&&!important.length)continue;
    if(key==='dayPlan'){
      if(displaySections?.today!==false||displaySections?.tomorrow!==false)orderedSections.push(<div key="dayPlan" className="hub-day-plan">{displaySections?.today===false?null:sections.today}{displaySections?.tomorrow===false?null:sections.tomorrow}</div>);
      continue;
    }
    if(key==='quickActions'){
      if(compose||important.length>0)orderedSections.push(<section key="quickActions" className="hub-quick-actions" aria-label={t('hubQuickActions')}>{compose&&<button className="button" onClick={compose}><Icon name="message"/>{t('newMessage')}</button>}{liveMessages.length>0&&<button className="button" data-hub-detail="messages" data-hub-detail-kind="collection" onClick={event=>detailAccess.open({kind:'collection',id:'messages'},event.currentTarget)}><Icon name="message"/>{t('hubViewMessages',{count:liveMessages.length})}</button>}</section>);
      continue;
    }
    if(displaySections?.[key as keyof typeof displaySections]!==false)orderedSections.push(sections[key]);
  }
  const weekCard=!displaySnapshot&&(displaySections?.week!==false||display&&(displaySections?.today!==false||displaySections?.tomorrow!==false))?<HouseholdActivityWeek key={`${display?'display':'member'}:${householdId??'display'}`} householdId={householdId} localDate={localDate} zone={zone} now={now} people={people} display={display} householdBoardsReadableDinners={!display||displayDinnersReadable} showWeekCard={displaySections?.week!==false} showNextActivity={displaySections?.next!==false} onCurrentWeekDinners={updateWeekDinners}/>:null;
  return <HubDetails.Provider value={detailAccess}><div ref={hubRoot} tabIndex={-1} data-person-count={people.length} className={`family-hub ${display?'hub-display':'hub-member'} ${displayCompactPeople?'hub-display-compact-people':''} ${dark?'hub-dark':'hub-light'} ${compact?'hub-compact':'hub-wide'} ${lowHeight?'hub-low-height':''} ${companion?'hub-has-companion':''} ${people.length>4?'hub-larger-family':''} ${minCardWidth>144?'hub-long-names':''}`} data-testid="family-hub">
    <section className="hub-hero">
      <div className="hub-hero-copy"><p className="hub-household">{householdName}</p><h1>{greeting}</h1><p className="hub-subtitle">{t('hubSubtitle')}</p></div>
      <div className="hub-hero-clock"><span>{formatDate(now,locale,zone,{weekday:'long',day:'numeric',month:'long'})}</span><strong>{formatDate(now,locale,zone,{hour:'2-digit',minute:'2-digit'})}</strong>{connection&&<span className={`connection-pill ${connection===t('live')?'hub-live-status':''}`} role="status"><span className="live-dot"/>{connection}</span>}</div>
      {compose&&<button className="button hub-compose" onClick={compose}><Icon name="plus"/>{t('newMessage')}</button>}
    </section>
    {mobile&&people.length>0&&displaySections?.people!==false&&<nav className="hub-identities" aria-label={t('hubPeople')}>{people.map((p,i)=>{const birthday=currentBirthdays.find(item=>item.personId===p.id);return <button key={p.id} type="button" data-person-id={p.id} data-hub-detail={p.id} data-hub-detail-kind="person" aria-label={t('hubPersonDetails',{name:p.displayName})} onClick={event=>detailAccess.open({kind:'person',id:p.id},event.currentTarget)}><Avatar name={p.displayName} index={i} personId={p.id} colorToken={p.colorToken} avatarKey={p.avatarKey} photo={p.photo}/><strong>{p.displayName}</strong>{birthday&&<span className="hub-person-birthday" data-review-private="birthday-badge">🎂 {t(birthday.due==='today'?'hubBirthdayToday':'hubBirthdayTomorrow')}</span>}</button>})}</nav>}
    {!display?<>
      {mobile?<>
        <div className="hub-home-primary-grid hub-home-mobile">{orderedSections}<div className="hub-home-smart">{displaySections?.environment!==false&&<HomeEnvironment now={now} waste={[]} temperatures={temperatureItems(active)} zone={zone} onWaste={trigger=>detailAccess.open({kind:"collection",id:"waste"},trigger)}/ >}{homeSmartHome}</div></div>
        <div className="hub-home-secondary-grid">{homePhoto}</div>
      </>:<>
        <div className="hub-home-board">
          <div className="hub-home-agenda">
            <div className="hub-home-column hub-home-today">{sections.today}</div>
            <div className="hub-home-column hub-home-tomorrow">{sections.tomorrow}{sections.messages}</div>
          </div>
          {sections.people&&<div className="hub-home-column hub-home-people">{sections.people}</div>}
          {weekCard&&<div className="hub-home-week" data-testid="home-week-column">{weekCard}</div>}
          <div className="hub-home-column hub-home-services"><div className="hub-home-smart">{displaySections?.environment!==false&&<HomeEnvironment now={now} waste={[]} temperatures={temperatureItems(active)} zone={zone} onWaste={trigger=>detailAccess.open({kind:"collection",id:"waste"},trigger)}/ >}{homeSmartHome}</div>{homePhoto}</div>
          <div className="hub-home-modules">{homeModules}{sections.support}</div>
        </div>
        {important.length>0&&sections.important}
      </>}
      {mobile&&<div className="hub-home-modules">{homeModules}</div>}
    </>:<><div className="hub-grid">{orderedSections}</div>{homeModules}{displaySections?.environment!==false&&<HomeEnvironment now={now} waste={[]} temperatures={temperatureItems(active)} zone={zone} onWaste={trigger=>detailAccess.open({kind:"collection",id:"waste"},trigger)}/>}</>}
    {(display||mobile)&&weekCard&&<div className={display?'hub-display-week-outside':'hub-member-week-outside'}>{weekCard}</div>}
    {detail&&createPortal(<Dialog className={detail.kind==='person'?'hub-person-drawer':'hub-item-dialog'} title={detail.kind==='item'?detail.item.title:detail.kind==='person'?detail.person.displayName:detail.kind==='message'?t('hubMessageFrom',{name:detail.message.authorName}):collectionTitle(detail.id)} titleLang={detail.kind==='item'?detail.item.contentLocale??'':undefined} onClose={closeDetail}>
      {detail.kind==='item'?<ItemCard item={detail.item} people={people} zone={zone} display={display} hideTitle/>:
       detail.kind==='message'?<MessageCard message={detail.message} people={people} zone={zone}/>:
       detail.kind==='collection'?<div className="hub-collection-details" data-collection={detail.id}>{detail.messages.map(message=><MessageCard key={message.id} message={message} people={people} zone={zone}/>)}{detail.items.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display} now={now}/>)}{!detail.items.length&&!detail.messages.length&&<p className="hub-empty">{t('hubCollectionEmpty')}</p>}</div>:
       <div className="hub-person-details"><header className="hub-detail-identity" data-accent={personAccent(detail.person.id,detail.person.avatarKey)} data-color-token={personColorToken(detail.person.id,detail.person.colorToken,detail.person.avatarKey)}><Avatar name={detail.person.displayName} personId={detail.person.id} colorToken={detail.person.colorToken} avatarKey={detail.person.avatarKey} photo={detail.person.photo} index={Math.max(0,people.findIndex(p=>p.id===detail.person.id))}/><p>{t('hubPersonalScope')}</p></header><PersonFutureTimeline key={`${display?'display':'member'}:${detail.person.id}`} householdId={householdId} personId={detail.person.id} localDate={localDate} zone={zone} people={people} display={display} now={now}/>{(['reminder','other'] as const).map(group=>{const grouped=detail.items.filter(item=>!itemHousehold(item)&&!item.metadata.temperature&&(group==='reminder'?['reminder','alert'].includes(item.kind):!['event','reminder','alert'].includes(item.kind)));return grouped.length?<section key={group}><h3 className="hub-detail-group-title">{t(group==='reminder'?'hubImportant':'hubBriefs')}</h3>{grouped.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display} now={now}/>)}</section>:null})}{groupedSchool.filter(activity=>activity.personIds.includes(detail.person.id)).map(activity=><SchoolActivityCard key={activity.id} activity={activity} people={people} now={now} dateLabel={formatDate(`${activity.date}T12:00:00Z`,locale,'UTC',{weekday:'long',day:'numeric',month:'long'})} zone={zone}/>) }{active.some(item=>!item.metadata.temperature&&item.metadata.calendar?.purpose!=='waste'&&itemHousehold(item))&&<section><h3 className="hub-detail-group-title">{t('hubSharedContent')}</h3><p className="field-hint">{t('hubSharedContentHint')}</p>{active.filter(item=>!item.metadata.temperature&&item.metadata.calendar?.purpose!=='waste'&&itemHousehold(item)).map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display} now={now}/>)}</section>}{taskAccess&&!display&&<PersonTasks {...taskAccess} personId={detail.person.id} timezone={zone} onOpen={id=>{closeDetail();taskAccess.onOpen(id)}} onNew={id=>{closeDetail();taskAccess.onNew(id)}}/>}{onEditPhoto&&!display&&editablePhotoIds?.includes(detail.person.id)&&<button className="button" onClick={()=>{closeDetail();onEditPhoto(detail.person.id)}}>{t('photoEdit')}</button>}{onManagePeople&&!display&&<button className="button" onClick={()=>{closeDetail();onManagePeople()}}><Icon name="people"/>{t('editPerson')}</button>}</div>}
    </Dialog>,document.body)}
  </div></HubDetails.Provider>;
}
// Observe the already-resolved app theme (including system changes), so DOM,
// reading and keyboard order follow the same composition as the visible grid.
function useHubComposition(snapshot?:{theme:string;orientation:'portrait'|'landscape'}) {
  const queries=['(max-width: 1000px)','(max-width: 640px)','(min-width: 1001px) and (max-height: 850px)'];
  const read=()=>snapshot?{dark:snapshot.theme==='dark'||snapshot.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches,compact:snapshot.orientation==='portrait',mobile:false,lowHeight:snapshot.orientation==='landscape'}:{dark:document.documentElement.dataset.theme==='dark',compact:matchMedia(queries[0]!).matches,mobile:matchMedia(queries[1]!).matches,lowHeight:matchMedia(queries[2]!).matches};
  const [composition,setComposition]=useState(read);
  useEffect(()=>{
    const media=queries.map(query=>matchMedia(query));
    if(snapshot?.theme==='system')media.push(matchMedia('(prefers-color-scheme: dark)'));
    const update=()=>setComposition(read());
    const observer=snapshot?null:new MutationObserver(update);
    observer?.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    media.forEach(query=>query.addEventListener('change',update));update();
    return()=>{observer?.disconnect();media.forEach(query=>query.removeEventListener('change',update))};
  },[snapshot?.orientation,snapshot?.theme]);
  return snapshot?read():composition;
}

function PanelTitle({icon,title,count,id}:{icon:string;title:string;count?:number;id?:string}) {return <div className="hub-panel-title"><h2 id={id}><Icon name={icon}/>{title}</h2>{count!==undefined&&<span className="hub-count">{count}</span>}</div>}
function itemIcon(item:HubItem) { return item.metadata.calendar?.purpose==='waste'?'trash':kindIcons[item.kind]; }
function targetNames(item:HubItem,people:HubPerson[],family:string,group?:(count:number)=>string) { const audience=people.filter(p=>itemSubjectIds(item).includes(p.id));return itemHousehold(item)?family:group&&audience.length>=3?group(audience.length):audience.map(p=>p.displayName).join(' · '); }
function PersonCard({person,index,items,school,people,zone,display,previewLimit,taskAccess,now,summary=false,combined=false,birthday}:{now:number;combined?:boolean;summary?:boolean;taskAccess?:TaskAccess;person:HubPerson;index:number;items:HubItem[];school:GroupedSchoolActivity[];birthday?:HomeBirthday;people:HubPerson[];zone:string;display:boolean;previewLimit:number}) {
 const {t,locale}=useI18n();const details=useContext(HubDetails);
 const visibleItems=items.slice(0,previewLimit);
 const summaryActivity=visibleItems[0]?.title??school[0]?.title;
 const summaryLocale=visibleItems[0]?.contentLocale??'';
 const schoolDateLabel=(date:string)=>date===dayKey(now,zone)?t('hubToday'):date===dayKey(now,zone,1)?t('hubTomorrow'):formatDate(`${date}T12:00:00Z`,locale,'UTC',{weekday:'short',day:'numeric',month:'short'});
 const identity=<button className="hub-person-identity" data-person-id={person.id} data-hub-detail={person.id} data-hub-detail-kind="person" onClick={event=>details?.open({kind:'person',id:person.id},event.currentTarget)} aria-label={t('hubPersonDetails',{name:person.displayName})}>
   <Avatar name={person.displayName} index={index} personId={person.id} colorToken={person.colorToken} avatarKey={person.avatarKey} photo={person.photo}/>
   <span className="hub-person-name"><strong>{person.displayName}<Icon name="arrow" size={16}/></strong>{birthday&&<span className="hub-person-birthday" data-review-private="birthday-badge">🎂 {t(birthday.due==='today'?'hubBirthdayToday':'hubBirthdayTomorrow')}</span>}{summary&&summaryActivity&&<span className="hub-person-activity" lang={summaryLocale}>{summaryActivity}{visibleItems[0]?.metadata.allDay&&visibleItems[0].startsAt&&<small>{t('hubAllDay')} · {formatCalendarEventRange(visibleItems[0].startsAt,visibleItems[0].endsAt,locale,zone,true)}</small>}{visibleItems[0]&&<CalendarFreshness item={visibleItems[0]}/>}</span>}</span>
 </button>;
 return <article className={`hub-person ${combined?'hub-person-combined':''} ${!visibleItems.length&&!school.length&&!taskAccess?'hub-person-empty':''}`} id={`hub-person-${person.id}`} tabIndex={-1} data-person-id={person.id} data-hub-scope={`person-${person.id}`} data-accent={personAccent(person.id,person.avatarKey)} data-color-token={personColorToken(person.id,person.colorToken,person.avatarKey)} data-review-private="person-card">
   <header>{identity}</header>
   {!summary&&visibleItems.length>0&&<ul className="hub-person-items">{visibleItems.map(item=><li key={item.id} data-item-id={item.id} className={`kind-${item.kind}`}><span className="hub-item-dot"><Icon name={itemIcon(item)} size={16}/></span><div>{item.kind==='event'&&<span className="hub-person-day">{t(overlapsDay(item,dayKey(now,zone),zone)?'hubToday':'hubTomorrow')}</span>}<ItemTitle item={item} people={people} zone={zone} display={display}/>{item.startsAt&&<small>{item.metadata.allDay?<>{t('hubAllDay')} · {(item.metadata.calendar?formatCalendarEventRange:formatEventRange)(item.startsAt,item.endsAt,locale,zone,true)}</>:formatDate(item.startsAt,locale,zone,{weekday:'short',hour:'2-digit',minute:'2-digit'})}</small>}</div></li>)}</ul>}
   {!summary&&school.slice(0,previewLimit).map(activity=><SchoolActivityCard key={activity.id} activity={activity} people={people} compact dateLabel={schoolDateLabel(activity.date)} zone={zone}/>)}
   {taskAccess&&!display&&<PersonTasks {...taskAccess} personId={person.id} timezone={zone} compact onViewDetails={trigger=>details?.open({kind:'person',id:person.id},trigger)}/>}
 </article>;
}
export function UpcomingActivities({items,people,zone,now,display=false}:{items:HubItem[];people:HubPerson[];zone:string;now:number;display?:boolean}){
 const {t,locale}=useI18n();const personal=items.filter(item=>item.metadata.calendar?.purpose!=='waste');const upcoming=upcomingEvents(personal,now,zone);const windows=new Map<string,HubItem>();for(const item of personal)if(item.metadata.calendar?.lastCompleteWindow)windows.set(item.metadata.calendar.sourceId,item);
 return <section className="hub-upcoming"><h3 className="hub-detail-group-title">{t('hubUpcomingActivities')}</h3>{[...windows.values()].map(item=><p key={item.metadata.calendar!.sourceId} className="field-hint">{item.source.label} · {t('calendarPreviewWindow')}: {formatDate(item.metadata.calendar!.lastCompleteWindow!.from,locale,zone,{dateStyle:'medium'})} – {formatDate(item.metadata.calendar!.lastCompleteWindow!.to,locale,zone,{dateStyle:'medium'})}</p>)}{upcoming.length?eventDateGroups(upcoming,zone).map(group=><section key={group.day} className="hub-date-group"><h4><time dateTime={group.day}>{formatDate(`${group.day}T12:00:00Z`,locale,'UTC',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</time></h4>{group.items.map(item=><ItemCard key={item.id} item={item} people={people} zone={zone} display={display} now={now}/>)}</section>):<p className="hub-empty">{t('hubNoUpcomingActivities')}</p>}</section>;
}
export function ItemCard({item,people,zone,display=false,hideTitle=false,now}:{item:HubItem;people:HubPerson[];zone:string;display?:boolean;hideTitle?:boolean;now?:number}) {
 const {t,locale}=useI18n();
 return <article className={`hub-item kind-${item.kind} priority-${item.priority}`} data-item-id={item.id}><div className="hub-item-label"><span><Icon name={kindIcons[item.kind]} size={18}/>{t(kindKeys[item.kind])}</span><small>{targetNames(item,people,t('hubFamily'))}</small></div>{!hideTitle&&<h3 lang={item.contentLocale ?? ""}>{item.title}</h3>}{now!==undefined&&item.metadata.calendar&&calendarActivityEnded(item.startsAt,item.endsAt,Boolean(item.metadata.allDay),now,zone)&&<small className="hub-ended-label">{t('hubEnded')}</small>}<CalendarFreshness item={item} zone={zone} detail/>{item.startsAt&&<p className="hub-item-when"><Icon name="calendar" size={16}/><time dateTime={item.startsAt}>{item.metadata.allDay&&<>{t('hubAllDay')} · </>}{(item.metadata.calendar?formatCalendarEventRange:formatEventRange)(item.startsAt,item.endsAt,locale,zone,item.metadata.allDay)}</time></p>}{item.metadata.location&&<p className="hub-item-location" lang={item.contentLocale??""}><Icon name="home" size={16}/>{item.metadata.location}</p>}{item.body&&<p className="hub-item-body" lang={item.contentLocale ?? ""}>{item.body}</p>}{item.entries.length>0&&<ul className="hub-list">{item.entries.map((entry,i)=><li key={i}><span aria-hidden="true">•</span><div lang={item.contentLocale ?? ""}><strong>{entry.label}</strong>{entry.detail&&<p>{entry.detail}</p>}</div></li>)}</ul>}<Provenance item={item} zone={zone} display={display}/></article>;
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
 const content=<><Avatar name={message.authorName} personId={message.authorPersonId} colorToken={message.authorColorToken??people.find(person=>person.id===message.authorPersonId)?.colorToken} index={Math.max(0,people.findIndex(person=>person.id===message.authorPersonId))} avatarKey={messageAvatarKey(message,people)} photo={people.find(person=>person.id===message.authorPersonId)?.photo??message.authorPhoto}/><span className="hub-message-copy"><span className="hub-message-meta"><strong>{message.authorName}</strong><time dateTime={message.publishAt}>{formatDate(message.publishAt,locale,zone,{hour:'2-digit',minute:'2-digit'})}</time></span><span className="display-card-body">{message.body}</span>{preview&&<span className="hub-message-read">{t('hubReadMessage')} <Icon name="arrow" size={14}/></span>}</span></>;
 return <article className={`hub-message ${message.importance} ${preview?'hub-message-preview':'hub-message-full'}`} data-color-token={message.authorColorToken??undefined} data-card-id={message.id}>{preview?<button className="hub-message-open" data-hub-detail={message.id} data-hub-detail-kind="message" onClick={event=>details?.open({kind:'message',id:message.id},event.currentTarget)}>{content}</button>:content}</article>;
}
