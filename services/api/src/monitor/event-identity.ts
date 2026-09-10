import { createHash } from 'node:crypto';

export interface IdentifiedEvent {type:string;description:string;who:string[];date:string;time:string|null;}

export function orderedMonitorEvents<T extends IdentifiedEvent>(events:T[]):Array<T&{eventKeyPart:string}>{
  const ordered=[...events].sort((a,b)=>`${a.date}|${a.time??''}|${a.type}|${[...a.who].sort().join('|')}|${a.description}`.localeCompare(`${b.date}|${b.time??''}|${b.type}|${[...b.who].sort().join('|')}|${b.description}`));
  const occurrences=new Map<string,number>();
  return ordered.map((event)=>{const group=`${event.type.trim().toLowerCase()}|${[...event.who].map((value)=>value.trim().toLowerCase()).sort().join('|')}`;const occurrence=occurrences.get(group)??0;occurrences.set(group,occurrence+1);return {...event,eventKeyPart:`${group}|${occurrence}`};});
}

export function monitorEventKey(taskId:string,eventKeyPart:string):string{return createHash('sha256').update(`${taskId}|${eventKeyPart}`).digest('hex');}
