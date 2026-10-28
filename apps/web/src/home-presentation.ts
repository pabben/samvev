import type { HubItem, HubMessage, HubPerson } from './home-types';
import { currentCalendarActivityRelevant, timedActivityUnended } from './home-activity-presentation';
import { wallInput } from './time';
export function currentItems(items:HubItem[], now:number):HubItem[] {
  return items.filter(item => (!item.publishAt || Date.parse(item.publishAt)<=now) && (!item.expiresAt || Date.parse(item.expiresAt)>now));
}
export function dayKey(now:number, zone:string, offset=0) {
  const day=wallInput(now,zone).slice(0,10);
  return new Date(Date.parse(`${day}T12:00:00Z`)+offset*86400000).toISOString().slice(0,10);
}
/** Calendar all-day dates are civil; timed events overlap a local day at either end. */
export function eventDay(item:HubItem,zone:string) {return item.startsAt?(item.metadata.calendar&&item.metadata.allDay?item.startsAt.slice(0,10):wallInput(item.startsAt,zone).slice(0,10)):'';}
export function overlapsDay(item:HubItem,day:string,zone:string){
 if(item.kind!=='event'||!item.startsAt||['cancelled','canceled','declined'].includes(item.metadata.calendar?.status??''))return false;
 const start=eventDay(item,zone);
 if(item.metadata.calendar&&item.metadata.allDay){const end=item.endsAt?.slice(0,10);if(item.endsAt&&(!end||end<=start))return false;return start<=day&&(end?day<end:day===start);}
 // Subtract one millisecond before deriving the end day: midnight is exclusive.
 const end=item.endsAt&&Date.parse(item.endsAt)>Date.parse(item.startsAt)?wallInput(Date.parse(item.endsAt)-1,zone).slice(0,10):start;
 return start<=day&&end>=day;
}
export function chronologicalEvents(items:HubItem[],zone:string){return [...items].sort((a,b)=>eventDay(a,zone).localeCompare(eventDay(b,zone))||Number(Boolean(b.metadata.allDay))-Number(Boolean(a.metadata.allDay))||Date.parse(a.startsAt!)-Date.parse(b.startsAt!)||a.id.localeCompare(b.id));}
export function dayEvents(items:HubItem[], now:number, zone:string, offset=0, includeEnded=true) {
 return chronologicalEvents(items.filter(item=>overlapsDay(item,dayKey(now,zone,offset),zone)&&(includeEnded||!item.metadata.calendar||currentCalendarActivityRelevant(item.startsAt,item.endsAt,Boolean(item.metadata.calendar&&item.metadata.allDay),now,zone))),zone);
}
export function upcomingEvents(items:HubItem[],now:number,zone:string){
 const today=dayKey(now,zone);
 return chronologicalEvents(items.filter(item=>item.kind==='event'&&item.startsAt&&!['cancelled','canceled','declined'].includes(item.metadata.calendar?.status??'')&&(item.metadata.calendar&&item.metadata.allDay?(eventDay(item,zone)>=today||overlapsDay(item,today,zone)):timedActivityUnended(item.startsAt,item.endsAt,now))),zone);
}
export function eventDateGroups(items:HubItem[],zone:string){
 const groups=new Map<string,HubItem[]>();for(const item of chronologicalEvents(items,zone)){const day=eventDay(item,zone);groups.set(day,[...(groups.get(day)??[]),item]);}return [...groups].map(([day,items])=>({day,items}));
}
export function personalWindowItems(active:HubItem[],personId:string,now:number,zone:string){
 const today=dayKey(now,zone),tomorrow=dayKey(now,zone,1);
 return personItems(active,personId).filter(item=>!item.metadata.temperature&&!(item.metadata.calendar&&itemHousehold(item))&&(item.kind!=='event'||(overlapsDay(item,today,zone)||overlapsDay(item,tomorrow,zone))&&(!item.metadata.calendar||currentCalendarActivityRelevant(item.startsAt,item.endsAt,Boolean(item.metadata.calendar&&item.metadata.allDay),now,zone))));
}
export function wasteEvents(items:HubItem[],now:number,zone:string){return upcomingEvents(items.filter(item=>item.metadata.calendar?.purpose==='waste'),now,zone);}
export function temperatureItems(items:HubItem[]){return items.filter(item=>item.metadata.temperature).sort((a,b)=>(a.metadata.temperature?.order??0)-(b.metadata.temperature?.order??0)||a.title.localeCompare(b.title));}
/** Aging uses HA's timestamp, never Samvev's successful HTTP fetch time. */
export function temperatureIsStale(item:HubItem,now:number){const reading=item.metadata.temperature;if(!reading||reading.freshness!=='current')return true;const timestamp=reading.lastReportedAt??reading.lastUpdatedAt;const age=timestamp?now-Date.parse(timestamp):NaN;return !Number.isFinite(age)||age<0||age>30*60_000;}
export function temperatureReading(item:HubItem,locale:string){const reading=item.metadata.temperature;const value=reading?.value,unit=reading?.unit;return typeof value==='number'&&Number.isFinite(value)&&['°C','°F'].includes(unit??'')?`${new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value)} ${unit}`:null;}
export function itemSubjectIds(item:HubItem) { return item.metadata.calendar ? item.subjects?.personIds??[] : item.targets.personIds; }
export function itemHousehold(item:HubItem) { return item.metadata.calendar?.subjectHousehold??item.targets.household; }
export function personItems(items:HubItem[],personId:string) { return items.filter(i=>!i.metadata.temperature&&i.metadata.calendar?.purpose!=='waste'&&itemSubjectIds(i).includes(personId)); }
export function importantItems(items:HubItem[]) { return items.filter(i=>i.kind==='alert'||i.kind==='reminder'||['high','urgent'].includes(i.priority)); }

// Preserve a single focus on compact/low light surfaces. A wide dark board has
// a full-height reminder panel; its shorter variant has room for two previews.
// The collection entrance always exposes the rest, including long entries.
export function importantPreviewLimit({dark,compact,lowHeight}:{dark:boolean;compact:boolean;lowHeight:boolean}):number {
  return dark&&!compact ? (lowHeight?2:3) : 1;
}

// Measure the people panel, not the window: the neighbouring agenda keeps its
// own share. Above four identities, balance partial rows instead of leaving one
// tall card alone. A card keeps room for the existing avatar and readable name.
export function adaptivePeopleLayout(count:number,width:number,gap:number,minCardWidth=144) {
  if(count<=4||width<=0)return null;
  const capacity=Math.max(1,Math.min(6,Math.floor((width+gap)/(minCardWidth+gap))));
  const rows=Math.ceil(count/capacity);
  return {columns:Math.ceil(count/rows),rows};
}

/** Full names remain visible; reserve readable columns only when the roster needs them. */
export function peopleCardMinWidth(people:Pick<HubPerson,'displayName'>[]){
 return people.some(person=>person.displayName.trim().length>24||person.displayName.split(/\s+/u).some(word=>word.length>14))?240:144;
}

// Stable section keys preserve open details while visual and reading order move together.
export function hubSectionOrder(dark:boolean, compact:boolean, mobile=false):string[] {
  if (mobile) return dark ? ['important','quickActions','today','messages','tomorrow','support'] : ['important','messages','today','tomorrow','support'];
  return dark ? ['today','tomorrow','people','important','messages','support'] : ['people','dayPlan','important','messages','support'];
}

// A small, real update accompanies the human message. Never fabricate a widget
// or repeat an item in the remaining support group.
export function splitBriefs(items:HubItem[], stackAgenda=false) {
  const preferred=items.find(item=>item.kind==='observation')??items[0];
  const agendaCompanion=stackAgenda?preferred:undefined;
  const available=items.filter(item=>item.id!==agendaCompanion?.id);
  const companion=stackAgenda?(available.find(item=>item.kind==='summary')??available[0]):preferred;
  return {agendaCompanion,companion,remaining:items.filter(item=>item.id!==companion?.id&&item.id!==agendaCompanion?.id)};
}

export type HubCollection='important'|'briefs'|'today'|'tomorrow'|'messages'|'waste';
export type HubDetailSelection={kind:'item'|'person'|'message';id:string}|{kind:'collection';id:HubCollection};
export function collectionItems(id:HubCollection,active:HubItem[],now:number,zone:string):HubItem[] {
 if(id==='waste')return wasteEvents(active,now,zone);
 if(id==='important')return importantItems(active);
 if(id==='briefs')return active.filter(item=>['summary','list','observation'].includes(item.kind)&&!item.metadata.temperature&&!importantItems(active).includes(item));
 if(id==='today'||id==='tomorrow')return dayEvents(active,now,zone,id==='tomorrow'?1:0,true);
 return [];
}
// Keep only identity in dialog state. Every render resolves the current permitted,
// unexpired projection, so SSE updates and withdrawal cannot leave stale details.
export function resolveHubDetail(selection:HubDetailSelection|null, people:HubPerson[], active:HubItem[],messages:HubMessage[]=[],now=Date.now(),zone='UTC') {
  if(!selection)return undefined;
  if(selection.kind==='item') {
    const item=active.find(item=>item.id===selection.id);
    return item?{kind:'item' as const,item}:undefined;
  }
  if(selection.kind==='message'){const message=messages.find(message=>message.id===selection.id);return message?{kind:'message' as const,message}:undefined;}
  if(selection.kind==='collection')return {kind:'collection' as const,id:selection.id,items:collectionItems(selection.id,active,now,zone),messages:selection.id==='messages'?messages:[]};
  const person=people.find(person=>person.id===selection.id);
  return person?{kind:'person' as const,person,items:personItems(active,person.id)}:undefined;
}
export function personalPreviewItems(active:HubItem[],personId:string,now=Date.now(),zone='UTC') {
  const items=personalWindowItems(active,personId,now,zone).filter(item=>item.kind!=='summary'&&item.kind!=='list');
  return [...chronologicalEvents(items.filter(item=>item.kind==='event'),zone),...items.filter(item=>item.kind!=='event')];
}
export function hiddenPersonalCount(itemCount:number,previewLimit:number) {return Math.max(0,itemCount-previewLimit);}

// A display may receive an author's permitted illustration without receiving
// that person in its targeted roster. Names are never identity evidence.
export function messageAvatarKey(message:Pick<HubMessage,'authorPersonId'|'authorAvatarKey'>,people:HubPerson[]):string|null {
  if(!message.authorPersonId)return null;
  const person=people.find(person=>person.id===message.authorPersonId);
  return person ? person.avatarKey??null : message.authorAvatarKey??null;
}
