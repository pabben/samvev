import type { HubItem } from './home-types';
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

// Stable keys preserve open details when theme or viewport changes the order.
export function hubSectionOrder(dark:boolean, compact:boolean):string[] {
  if (compact) return ['important','today','tomorrow','messages','people','briefs'];
  return dark ? ['today','tomorrow','people','important','messages','briefs']
    : ['people','today','tomorrow','important','messages','briefs'];
}
