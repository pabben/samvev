export type CalendarRemovalSnapshotEntry={id:string;expectedRevision:number};
export const CALENDAR_REMOVAL_BATCH_SIZE=12;

/** Drop entries that are gone, active again, or have a changed revision. */
export function reconcileCalendarRemovalSnapshot<T extends CalendarRemovalSnapshotEntry,C extends {id:string;revision:number;disconnectedAt:string|null}>(snapshot:T[],current:C[]):T[]{
 return snapshot.filter(entry=>current.some(connection=>connection.id===entry.id&&connection.revision===entry.expectedRevision&&Boolean(connection.disconnectedAt)));
}

// Keep requests within the server's batch schema limit. The snapshot and its
// revisions are captured at confirmation time and never refreshed into newer
// revisions before sending, so server fences reject changed or active entries.
export async function removeCalendarConnectionsInChunks<T extends CalendarRemovalSnapshotEntry>(
 snapshot:T[],
 removeChunk:(connections:CalendarRemovalSnapshotEntry[])=>Promise<void>,
 onChunkRemoved:(ids:string[])=>Promise<void>,
 refresh:()=>Promise<void>,
 chunkSize=CALENDAR_REMOVAL_BATCH_SIZE,
){
 if(!Number.isInteger(chunkSize)||chunkSize<1)throw new RangeError('chunkSize must be a positive integer');
 for(let offset=0;offset<snapshot.length;offset+=chunkSize){
  const chunk=snapshot.slice(offset,offset+chunkSize);
  try{
   await removeChunk(chunk.map(({id,expectedRevision})=>({id,expectedRevision})));
  }catch(error){
   // Earlier chunks may already have succeeded. Refresh before surfacing the
   // failure, while leaving the failed and not-yet-sent names in the dialog.
   try{await refresh()}catch{}
   throw error;
  }
  await onChunkRemoved(chunk.map(({id})=>id));
  await refresh();
 }
}
