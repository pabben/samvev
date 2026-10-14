import {api} from './api';
export interface CalendarPreview {
 sourceId:string;sourceRevision:number;totalCount:number;window?:{from:string;to:string};
 events:{title:string;start:string;end:string|null;allDay:boolean;status?:string;location?:string}[];
}
export type DraftCalendarPreview=CalendarPreview&{draftSignature:string};
/** Read source events only. Draft people/reader choices are never sent or saved here. */
export async function readCalendarPreview(path:string,sourceRevision:number,draftSignature:string,request:typeof api=api):Promise<DraftCalendarPreview>{
 const preview=await request<CalendarPreview>(`${path}/preview`,'POST',{expectedSourceRevision:sourceRevision},{timeoutMs:45000});
 return{...preview,draftSignature};
}
export function matchesCalendarPreview(preview:DraftCalendarPreview|undefined,sourceRevision:number,draftSignature:string):boolean{
 return Boolean(preview&&preview.sourceRevision===sourceRevision&&preview.draftSignature===draftSignature);
}
