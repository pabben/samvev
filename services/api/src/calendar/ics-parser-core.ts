import ical from 'node-ical';
import {DomainError} from '@samvev/core';
import type {CalendarEvent} from './service.ts';

export const SNAPSHOT_MAX_ITEMS=10_000;

function invalidProviderResponse(){return new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});}

export function canonicalCalendarEvent(event:CalendarEvent):CalendarEvent{
  const uid=boundedString(event.uid,2048),instanceId=boundedString(event.instanceId,2048),title=boundedString(event.title,2048),location=boundedString(event.location,1024,{optional:true});
  if(typeof event.allDay!=='boolean'||typeof event.cancelled!=='boolean'||event.status!==undefined&&!['confirmed','tentative','declined','unanswered','cancelled'].includes(event.status))throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502,{reason:'calendar_provider_response_invalid'});
  let start:string,end:string|null;
  try{const rawStart=boundedString(event.start,100)!,rawEnd=boundedString(event.end,100,{optional:true}),validCivil=(raw:string)=>{const [year,month,day]=raw.slice(0,10).split('-').map(Number),date=new Date(Date.UTC(year!,month!-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month!-1||date.getUTCDate()!==day)throw new Error('invalid civil date');},civil=(raw:string)=>{validCivil(raw);return`${raw}T00:00:00.000Z`;},instant=(raw:string)=>{if(!/^\d{4}-\d{2}-\d{2}T/.test(raw))throw new Error('invalid instant');validCivil(raw);return new Date(raw).toISOString();},startCivil=/^\d{4}-\d{2}-\d{2}$/.test(rawStart),endCivil=Boolean(rawEnd&&/^\d{4}-\d{2}-\d{2}$/.test(rawEnd));if(event.allDay!==startCivil||rawEnd&&endCivil!==startCivil)throw new Error('mixed date kinds');start=startCivil?civil(rawStart):instant(rawStart);end=rawEnd?(endCivil?civil(rawEnd):instant(rawEnd)):null;}catch{throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_event_time_invalid'});}
  if(end&&end<=start)throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422,{reason:'calendar_event_time_invalid'});
  return{...event,uid:uid!,instanceId:instanceId!,start,end,title:title!.normalize('NFKC').trim().slice(0,160)||'Untitled event',location:location?.normalize('NFKC').trim().slice(0,160)};
}

function invalidIcs(){return new DomainError('CALENDAR_ICS_INVALID',422,{reason:'calendar_ics_content_invalid'});}
function boundedString(value:unknown,max:number,{optional=false}:{optional?:boolean}={}):string|undefined{if(value===undefined||value===null){if(optional)return undefined;throw invalidProviderResponse();}if(typeof value!=='string'||value.length===0||value.length>max)throw invalidProviderResponse();return value;}

export function parseIcsEventsInProcess(text:string,window:{from:string;to:string}):CalendarEvent[]{
  let parsed:ReturnType<typeof ical.sync.parseICS>;
  try{parsed=ical.sync.parseICS(text);}catch{throw invalidIcs();}
  const from=new Date(window.from),to=new Date(window.to),events:CalendarEvent[]=[];
  const push=(event:CalendarEvent)=>{if(events.length>=SNAPSHOT_MAX_ITEMS)throw new DomainError('CALENDAR_ICS_TOO_LARGE',413,{reason:'calendar_ics_occurrence_limit',maxOccurrences:SNAPSHOT_MAX_ITEMS});events.push(event);};
  const stamp=(value:Date)=>value.toISOString();
  for(const item of Object.values(parsed)){
    if(item.type!=='VEVENT')continue;
    const event=item as ical.VEvent;
    if(event.rrule&&event.start){
      if(event.rrule.options.freq>3)throw new DomainError('CALENDAR_ICS_UNSUPPORTED',422,{reason:'calendar_ics_recurrence_frequency_unsupported'});
      const overrides=new Map<string,ical.VEvent>();
      for(const [key,override] of Object.entries(event.recurrences??{})){const original=override.recurrenceid instanceof Date?stamp(override.recurrenceid):key;overrides.set(original,override);}
      const excluded=new Set<string>();
      for(const [key,date] of Object.entries(event.exdate??{}))excluded.add(date instanceof Date?stamp(date):key);
      const baseDuration=Math.max(0,(event.end?.getTime()??event.start.getTime())-event.start.getTime());
      const remaining=SNAPSHOT_MAX_ITEMS-events.length;let exceeded=false;
      const rangeFrom=new Date(Math.max(event.start.getTime(),from.getTime()-baseDuration));
      const occurrences=event.rrule.between(rangeFrom,to,true,(_date,length)=>{if(length>=remaining){exceeded=true;return false;}return true;});
      if(exceeded)throw new DomainError('CALENDAR_ICS_TOO_LARGE',413,{reason:'calendar_ics_occurrence_limit',maxOccurrences:SNAPSHOT_MAX_ITEMS});
      const byIdentity=new Map(occurrences.map((original)=>[stamp(original),original]));
      for(const [identity,override] of overrides){if(override.start&&override.start>=from&&override.start<to){const recurrenceId=override.recurrenceid instanceof Date?override.recurrenceid:new Date(identity);if(Number.isFinite(recurrenceId.getTime()))byIdentity.set(stamp(recurrenceId),recurrenceId);}}
      for(const original of [...byIdentity.values()].sort((left,right)=>left.getTime()-right.getTime())){
        const identity=stamp(original),override=overrides.get(identity);
        if(excluded.has(identity)&&!override)continue;
        const start=override?.start??original;
        const duration=override?.start&&override.end?Math.max(0,override.end.getTime()-override.start.getTime()):baseDuration;
        if(start>=to||start.getTime()+duration<from.getTime())continue;
        const allDay=(override?.datetype??event.datetype)==='date',end=duration?new Date(start.getTime()+duration):null;
        push({uid:String(event.uid),instanceId:identity,title:String(override?.summary??event.summary??'Untitled event'),start:allDay?start.toISOString().slice(0,10):stamp(start),end:end?(allDay?end.toISOString().slice(0,10):stamp(end)):null,allDay,cancelled:String(override?.status??event.status??'').toUpperCase()==='CANCELLED',location:String(override?.location??event.location??'')||undefined});
      }
    }else if(event.start&&event.start<to&&(event.end??event.start)>=from){
      const allDay=event.datetype==='date';push({uid:String(event.uid),instanceId:event.recurrenceid?.toISOString()??event.start.toISOString(),title:String(event.summary??'Untitled event'),start:allDay?event.start.toISOString().slice(0,10):event.start.toISOString(),end:event.end?(allDay?event.end.toISOString().slice(0,10):event.end.toISOString()):null,allDay,cancelled:String(event.status??'').toUpperCase()==='CANCELLED',location:String(event.location??'')||undefined});
    }
  }
  try{return events.map(canonicalCalendarEvent);}catch(error){if(error instanceof DomainError&&error.code==='CALENDAR_ICS_TOO_LARGE')throw error;throw invalidIcs();}
}
