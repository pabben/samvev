import {api} from './api';
export interface CalendarPreview {
 sourceId:string;sourceRevision:number;totalCount:number;window?:{from:string;to:string};
 events:{title:string;start:string;end:string|null;allDay:boolean;status?:string;location?:string}[];
}
export type DraftCalendarPreview=CalendarPreview&{draftSignature:string};
/** Read source events only. Draft people/reader choices are never sent or saved here. */
export async function readCalendarPreview(path:string,sourceRevision:number,draftSignature:string,request:typeof api=api,syncWindowDays:{past:number;future:number}={past:28,future:364}):Promise<DraftCalendarPreview>{
 const preview=await request<CalendarPreview>(`${path}/preview`,'POST',{expectedSourceRevision:sourceRevision,syncWindowDays},{timeoutMs:45000});
 return{...preview,draftSignature};
}
export function matchesCalendarPreview(preview:DraftCalendarPreview|undefined,sourceRevision:number,draftSignature:string):boolean{
 return Boolean(preview&&preview.sourceRevision===sourceRevision&&preview.draftSignature===draftSignature);
}
export function calendarIcsSizeMessage(details:Record<string,unknown>):{key:'calendarIcsTooLarge'|'calendarIcsTooLargeDeclared'|'calendarIcsTooLargeFallback';values:Record<string,number>}{
 const observed=details.observedBytes,declared=details.declaredBytes,maximum=details.maxBytes;
 const validBytes=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 if(validBytes(observed)&&validBytes(maximum))return{key:'calendarIcsTooLarge',values:{observedMiB:Math.round(observed/1048576*100)/100,maxMiB:Math.round(maximum/1048576*100)/100}};
 if(validBytes(declared)&&validBytes(maximum))return{key:'calendarIcsTooLargeDeclared',values:{declaredMiB:Math.round(declared/1048576*100)/100,maxMiB:Math.round(maximum/1048576*100)/100}};
 return{key:'calendarIcsTooLargeFallback',values:{}};
}
