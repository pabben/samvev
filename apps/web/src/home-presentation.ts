import type { HubItem, HubMessage, HubPerson } from './home-types';
import { wallInput } from './time';
export function currentItems(items:HubItem[], now:number):HubItem[] {
  return items.filter(item => (!item.publishAt || Date.parse(item.publishAt)<=now) && (!item.expiresAt || Date.parse(item.expiresAt)>now));
}
export function dayKey(now:number, zone:string, offset=0) {
  const day=wallInput(now,zone).slice(0,10);
  return new Date(Date.parse(`${day}T12:00:00Z`)+offset*86400000).toISOString().slice(0,10);
}
export function dayEvents(items:HubItem[], now:number, zone:string, offset=0) {
  const day=dayKey(now,zone,offset);
  return items.filter(i=>i.kind==='event'&&i.startsAt&&wallInput(i.startsAt,zone).slice(0,10)===day)
    .sort((a,b)=>Number(Boolean(b.metadata.allDay))-Number(Boolean(a.metadata.allDay)) || Date.parse(a.startsAt!)-Date.parse(b.startsAt!));
}
export function personItems(items:HubItem[],personId:string) { return items.filter(i=>i.targets.personIds.includes(personId)); }
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
export function adaptivePeopleLayout(count:number,width:number,gap:number) {
  if(count<=4||width<=0)return null;
  const capacity=Math.max(1,Math.min(6,Math.floor((width+gap)/(144+gap))));
  const rows=Math.ceil(count/capacity);
  return {columns:Math.ceil(count/rows),rows};
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

export type HubCollection='important'|'briefs'|'today'|'tomorrow'|'messages';
export type HubDetailSelection={kind:'item'|'person'|'message';id:string}|{kind:'collection';id:HubCollection};
export function collectionItems(id:HubCollection,active:HubItem[],now:number,zone:string):HubItem[] {
 if(id==='important')return importantItems(active);
 if(id==='briefs')return active.filter(item=>['summary','list','observation'].includes(item.kind)&&!importantItems(active).includes(item));
 if(id==='today'||id==='tomorrow')return dayEvents(active,now,zone,id==='tomorrow'?1:0);
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
export function personalPreviewItems(active:HubItem[],personId:string) {
  return personItems(active,personId).filter(item=>item.kind!=='summary'&&item.kind!=='list');
}
export function hiddenPersonalCount(itemCount:number,previewLimit:number) {return Math.max(0,itemCount-previewLimit);}

// A display may receive an author's permitted illustration without receiving
// that person in its targeted roster. Names are never identity evidence.
export function messageAvatarKey(message:Pick<HubMessage,'authorPersonId'|'authorAvatarKey'>,people:HubPerson[]):string|null {
  if(!message.authorPersonId)return null;
  const person=people.find(person=>person.id===message.authorPersonId);
  return person ? person.avatarKey??null : message.authorAvatarKey??null;
}
