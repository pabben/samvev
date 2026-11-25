import {api} from './api';
import type {HomeAssistantAction,HomeAssistantConfirmation,HomeAssistantEntity,HomeAssistantObservation,HomeAssistantReceipt,ManagedHomeAssistantEntity,ReadableHomeAssistantEntity} from './home-assistant-control-types';

type ApiRequest=<T>(path:string,method?:string,body?:unknown,options?:{timeoutMs?:number})=>Promise<T>;
export type ControlActorPath={kind:'member';householdId:string}|{kind:'display'};

export function createHomeAssistantControlsApi(request:ApiRequest=api){
 const memberRoot=(householdId:string)=>`/households/${householdId}/home-assistant/controls`;
 const actorRoot=(actor:ControlActorPath)=>actor.kind==='member'?memberRoot(actor.householdId):'/display/home-assistant/controls';
 return{
  configuration:(householdId:string)=>request<{entities:ManagedHomeAssistantEntity[]}>(`${memberRoot(householdId)}/configuration`),
  discover:(householdId:string,connectionId:string,expectedConnectionRevision:number)=>request<{entities:HomeAssistantEntity[]}>(`/households/${householdId}/calendar-connections/${connectionId}/home-assistant/controls/discover`,'POST',{expectedConnectionRevision},{timeoutMs:45000}),
  select:(householdId:string,connectionId:string,input:{expectedConnectionRevision:number;registryId:string;displayName?:string|null})=>request<{entity:ManagedHomeAssistantEntity}>(`/households/${householdId}/calendar-connections/${connectionId}/home-assistant/controls`,'POST',input),
  deselect:(householdId:string,entityId:string,expectedRevision:number)=>request<ManagedHomeAssistantEntity>(`${memberRoot(householdId)}/${entityId}/deselect`,'POST',{expectedRevision}),
  configureGrants:(householdId:string,entityId:string,input:{expectedRevision:number;personGrants:Array<{personId:string;canRead:true;actions:HomeAssistantAction[]}>;displayGrants:Array<{displayId:string;canRead:true;actions:HomeAssistantAction[]}>})=>request<ManagedHomeAssistantEntity>(`${memberRoot(householdId)}/${entityId}/grants`,'PUT',input),
  list:(actor:ControlActorPath)=>request<{entities:ReadableHomeAssistantEntity[]}>(actorRoot(actor)),
  read:(actor:ControlActorPath,entityId:string)=>request<HomeAssistantObservation>(`${actorRoot(actor)}/${entityId}/state`),
  confirmOpen:(actor:ControlActorPath,entityId:string,expectedRevision:number)=>request<HomeAssistantConfirmation>(`${actorRoot(actor)}/${entityId}/confirm-open`,'POST',{expectedRevision}),
  dispatch:(actor:ControlActorPath,entityId:string,input:{expectedRevision:number;action:HomeAssistantAction;idempotencyKey:string;confirmationToken?:string})=>request<HomeAssistantReceipt>(`${actorRoot(actor)}/${entityId}/actions`,'POST',input),
 };
}

export const homeAssistantControlsApi=createHomeAssistantControlsApi();
