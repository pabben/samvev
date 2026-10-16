import type {ProviderRuntimeConfig} from '../calendar/provider-config.ts';
import {issueHomeAssistantControlService,listHomeAssistantControlRegistry,readHomeAssistantControlState,type HomeAssistantControlAction,type HomeAssistantControlDeadline,type HomeAssistantControlEntity,type HomeAssistantControlState} from '../calendar/home-assistant-client.ts';

export interface HomeAssistantControlTransport{
  listEntities(accessToken:string,config:ProviderRuntimeConfig):Promise<HomeAssistantControlEntity[]>;
  readState(accessToken:string,entityId:string,config:ProviderRuntimeConfig):Promise<HomeAssistantControlState>;
  callAction(accessToken:string,entityId:string,action:HomeAssistantControlAction,config:ProviderRuntimeConfig,deadline:HomeAssistantControlDeadline):Promise<{accepted:true;state:HomeAssistantControlState}>;
}

export class HomeAssistantControlClient implements HomeAssistantControlTransport{
  listEntities(accessToken:string,config:ProviderRuntimeConfig){return listHomeAssistantControlRegistry(config,accessToken);}
  readState(accessToken:string,entityId:string,config:ProviderRuntimeConfig){return readHomeAssistantControlState(config,accessToken,entityId);}
  async callAction(accessToken:string,entityId:string,action:HomeAssistantControlAction,config:ProviderRuntimeConfig,deadline:HomeAssistantControlDeadline){
    await issueHomeAssistantControlService(config,accessToken,entityId,action,deadline);
    // Never expose the broad changed_states service result. Read only the target.
    return{accepted:true as const,state:await readHomeAssistantControlState(config,accessToken,entityId)};
  }
}
