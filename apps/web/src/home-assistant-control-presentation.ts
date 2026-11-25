import {homeAssistantActions,type HomeAssistantAction,type HomeAssistantEntity,type HomeAssistantGrant,type HomeAssistantDisplayGrant,type HomeAssistantObservation,type ManagedHomeAssistantEntity} from './home-assistant-control-types';
import {secureUuid} from './secure-uuid';

export function allowedHomeAssistantActions(entity:Pick<HomeAssistantEntity,'domain'|'supportedActions'>):HomeAssistantAction[]{
  return homeAssistantActions.filter(action=>entity.supportedActions.includes(action)&&(entity.domain==='light'?action.startsWith('light.'):action==='cover.open_cover'));
}

export function homeAssistantConfigurationForConnection(entities:ManagedHomeAssistantEntity[],connectionId:string){
  return entities.filter(entity=>entity.connectionId===connectionId);
}

export async function mapHomeAssistantReadsSequentially<T,R>(items:T[],read:(item:T,index:number)=>Promise<R>,isCurrent:()=>boolean=()=>true):Promise<R[]>{
  const values:R[]=[];
  for(let index=0;index<items.length;index++){
    if(!isCurrent())break;
    values.push(await read(items[index]!,index));
  }
  return values;
}

export function homeAssistantActionsForObservation(entity:Pick<HomeAssistantEntity,'domain'|'supportedActions'>,observation:Pick<HomeAssistantObservation,'supportedActions'|'stateStatus'>|undefined,stale=false){
  if(!observation||observation.stateStatus!=='current'||stale)return[];
  return allowedHomeAssistantActions({...entity,supportedActions:entity.supportedActions.filter(action=>observation.supportedActions.includes(action))});
}

export function homeAssistantStateKey(status:'current'|'unknown'|'unavailable'){
  return status==='current'?'homeAssistantStateCurrent':status==='unavailable'?'homeAssistantStateUnavailable':'homeAssistantStateUnknown';
}

export function homeAssistantGrantReplacement(personGrants:HomeAssistantGrant[],displayGrants:HomeAssistantDisplayGrant[]){
  return{
    personGrants:personGrants.filter(grant=>grant.canRead).map(grant=>({personId:grant.personId,canRead:true as const,actions:[...grant.actions]})),
    displayGrants:displayGrants.filter(grant=>grant.canRead).map(grant=>({displayId:grant.displayId,canRead:true as const,actions:[...grant.actions]})),
  };
}

export function newHomeAssistantIdempotencyKey(source?:Parameters<typeof secureUuid>[0]){
  return `ha-${secureUuid(source)}`;
}
