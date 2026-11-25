import type {DinnerAssignment} from './household-board-adapters';

export function todayDinnerSummary(assignments:DinnerAssignment[],localDate:string,fresh:boolean){
 const assignment=assignments.find(row=>row.localDate===localDate);
 if(assignment?.title)return{kind:'planned' as const,assignment};
 return{kind:fresh?'empty' as const:'unavailable' as const};
}
