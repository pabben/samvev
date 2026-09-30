import type { HubItem, HubPerson } from './home-types';
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

// Stable section keys preserve open details while visual and reading order move together.
export function hubSectionOrder(dark:boolean, compact:boolean):string[] {
  if (compact) return ['important','today','tomorrow','messages','people','companion','briefs'];
  return dark ? ['today','tomorrow','people','important','messages','companion','briefs']
    : ['people','today','important','tomorrow','messages','companion','briefs'];
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

export type HubDetailSelection={kind:'item'|'person';id:string};
// Keep only identity in dialog state. Every render resolves the current permitted,
// unexpired projection, so SSE updates and withdrawal cannot leave stale details.
export function resolveHubDetail(selection:HubDetailSelection|null, people:HubPerson[], active:HubItem[]) {
  if(!selection)return undefined;
  if(selection.kind==='item') {
    const item=active.find(item=>item.id===selection.id);
    return item?{kind:'item' as const,item}:undefined;
  }
  const person=people.find(person=>person.id===selection.id);
  return person?{kind:'person' as const,person,items:personalPreviewItems(active,person.id)}:undefined;
}
export function personalPreviewItems(active:HubItem[],personId:string) {
  return personItems(active,personId).filter(item=>item.kind!=='summary'&&item.kind!=='list');
}
export function hiddenPersonalCount(itemCount:number,previewLimit:number) {return Math.max(0,itemCount-previewLimit);}
