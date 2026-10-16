import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DomainError, opaqueToken } from '@samvev/core';
import type { CalendarService } from '../calendar/service.ts';
import type { ProviderRuntimeConfig } from '../calendar/provider-config.ts';
import { pool, transaction, type DbClient } from '../db.ts';
import type { HomeAssistantControlAction, HomeAssistantControlDeadline, HomeAssistantControlEntity } from '../calendar/home-assistant-client.ts';
import {HomeAssistantControlClient,type HomeAssistantControlTransport} from './control-client.ts';

export type HomeAssistantControlActor=
  | {kind:'member';id:string;accountId:string;sessionId:string;membershipId:string;personId:string;householdId:string;}
  | {kind:'display';id:string;credentialHash:string;householdId:string;privacyMode:boolean;cards:string[];};
type RuntimeContext={accessToken:string;runtime:ProviderRuntimeConfig;connection:{id:string;revision:number;syncGeneration:number;providerConfigRevision:number;originHash:string}};
type EntityRow={id:string;household_id:string;connection_id:string;entity_registry_id:string;entity_id:string;device_registry_id:string|null;domain:'light'|'cover';name:string;display_name:string|null;supported_actions:HomeAssistantControlAction[];revision:number;selected:boolean;selected_origin_hash:string|null;connection_revision:number;sync_generation:number;provider_config_revision:number;origin_hash:string|null;state:string;disconnected_at:Date|null;credential_ciphertext:string|null;connection_state:string;};
type GrantRow={can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean;revision:number;};
type ManagedEntityRow={id:string;connection_id:string;entity_registry_id:string;entity_id:string;device_registry_id:string|null;domain:'light'|'cover';name:string;display_name:string|null;supported_actions:HomeAssistantControlAction[];revision:number;selected:boolean;selected_origin_hash:string|null;origin_hash:string|null;};
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const actionColumn=(action:HomeAssistantControlAction)=>action==='light.turn_on'?'can_turn_on':action==='light.turn_off'?'can_turn_off':'can_open';
const safeError=(error:unknown)=>{
  const reason=error instanceof DomainError?String(error.details?.reason??''):'',known=new Set(['calendar_reauthorization_required','home_assistant_origin_changed','home_assistant_origin_binding_unknown','home_assistant_connection_busy','home_assistant_unavailable','home_assistant_control_unavailable','home_assistant_control_entity_invalid','home_assistant_control_action_invalid','home_assistant_redirect_blocked','home_assistant_response_too_large','home_assistant_permission_denied']);
  return known.has(reason)?reason:'home_assistant_control_state_unknown';
};
const selectedForOrigin=(row:Pick<EntityRow,'selected'|'selected_origin_hash'|'origin_hash'>)=>row.selected&&Boolean(row.origin_hash)&&row.selected_origin_hash===row.origin_hash;
const supported=(row:EntityRow,action:HomeAssistantControlAction)=>selectedForOrigin(row)&&row.supported_actions.includes(action)&&((row.domain==='light'&&action.startsWith('light.'))||(row.domain==='cover'&&action==='cover.open_cover'));

export class HomeAssistantControlService{
  constructor(private readonly calendars:CalendarService,private readonly transport:HomeAssistantControlTransport=new HomeAssistantControlClient()){}

  private managedShape(row:ManagedEntityRow,personGrants:Array<{personId:string;canRead:boolean;actions:HomeAssistantControlAction[]}>,displayGrants:Array<{displayId:string;canRead:boolean;actions:HomeAssistantControlAction[]}>) {
    const active=Boolean(row.selected&&row.selected_origin_hash&&row.selected_origin_hash===row.origin_hash);
    return{id:row.id,connectionId:row.connection_id,registryId:row.entity_registry_id,entityId:row.entity_id,deviceRegistryId:row.device_registry_id,domain:row.domain,name:row.display_name??row.name,supportedActions:row.supported_actions,revision:row.revision,selected:active,requiresReselection:Boolean(row.selected&&!active),personGrants,displayGrants};
  }

  private async managedEntity(actor:Extract<HomeAssistantControlActor,{kind:'member'}>,entityId:string){
    return transaction(async(client)=>{
      await this.authorize(client,actor,true,true);const row=(await client.query<ManagedEntityRow>(`SELECT entity.id,entity.connection_id,entity.entity_registry_id,entity.entity_id,entity.device_registry_id,entity.domain,entity.name,entity.display_name,entity.supported_actions,entity.revision,entity.selected,entity.selected_origin_hash,connection.home_assistant_origin_hash AS origin_hash FROM home_assistant_control_entities entity JOIN calendar_connections connection ON connection.id=entity.connection_id AND connection.household_id=entity.household_id WHERE entity.household_id=$1 AND entity.id=$2`,[actor.householdId,entityId])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404);
      const [people,displays]=await Promise.all([
        client.query<{person_id:string;can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean}>(`SELECT person_id,can_read,can_turn_on,can_turn_off,can_open FROM home_assistant_control_person_grants WHERE household_id=$1 AND entity_id=$2 ORDER BY person_id`,[actor.householdId,entityId]),
        client.query<{display_id:string;can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean}>(`SELECT display_id,can_read,can_turn_on,can_turn_off,can_open FROM home_assistant_control_display_grants WHERE household_id=$1 AND entity_id=$2 ORDER BY display_id`,[actor.householdId,entityId])
      ]);
      await this.authorize(client,actor,true,true);
      const actions=(grant:{can_turn_on:boolean;can_turn_off:boolean;can_open:boolean})=>[...(grant.can_turn_on?['light.turn_on' as const]:[]),...(grant.can_turn_off?['light.turn_off' as const]:[]),...(grant.can_open?['cover.open_cover' as const]:[])];
      return this.managedShape(row,people.rows.map((grant)=>({personId:grant.person_id,canRead:grant.can_read,actions:actions(grant)})),displays.rows.map((grant)=>({displayId:grant.display_id,canRead:grant.can_read,actions:actions(grant)})));
    });
  }

  async configuration(actor:Extract<HomeAssistantControlActor,{kind:'member'}>){
    return transaction(async(client)=>{
      await this.authorize(client,actor,true,true);const rows=(await client.query<ManagedEntityRow>(`SELECT entity.id,entity.connection_id,entity.entity_registry_id,entity.entity_id,entity.device_registry_id,entity.domain,entity.name,entity.display_name,entity.supported_actions,entity.revision,entity.selected,entity.selected_origin_hash,connection.home_assistant_origin_hash AS origin_hash FROM home_assistant_control_entities entity JOIN calendar_connections connection ON connection.id=entity.connection_id AND connection.household_id=entity.household_id WHERE entity.household_id=$1 ORDER BY entity.name,entity.id LIMIT 1000`,[actor.householdId])).rows,ids=rows.map((row)=>row.id);
      const [people,displays]=ids.length?await Promise.all([
        client.query<{entity_id:string;person_id:string;can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean}>(`SELECT entity_id,person_id,can_read,can_turn_on,can_turn_off,can_open FROM home_assistant_control_person_grants WHERE household_id=$1 AND entity_id=ANY($2::uuid[]) ORDER BY entity_id,person_id`,[actor.householdId,ids]),
        client.query<{entity_id:string;display_id:string;can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean}>(`SELECT entity_id,display_id,can_read,can_turn_on,can_turn_off,can_open FROM home_assistant_control_display_grants WHERE household_id=$1 AND entity_id=ANY($2::uuid[]) ORDER BY entity_id,display_id`,[actor.householdId,ids])
      ]):[{rows:[] as Array<{entity_id:string;person_id:string;can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean}>},{rows:[] as Array<{entity_id:string;display_id:string;can_read:boolean;can_turn_on:boolean;can_turn_off:boolean;can_open:boolean}>}];
      await this.authorize(client,actor,true,true);
      const actions=(grant:{can_turn_on:boolean;can_turn_off:boolean;can_open:boolean})=>[...(grant.can_turn_on?['light.turn_on' as const]:[]),...(grant.can_turn_off?['light.turn_off' as const]:[]),...(grant.can_open?['cover.open_cover' as const]:[])];
      return{entities:rows.map((row)=>this.managedShape(row,people.rows.filter((grant)=>grant.entity_id===row.id).map((grant)=>({personId:grant.person_id,canRead:grant.can_read,actions:actions(grant)})),displays.rows.filter((grant)=>grant.entity_id===row.id).map((grant)=>({displayId:grant.display_id,canRead:grant.can_read,actions:actions(grant)}))))};
    });
  }

  async deselect(actor:Extract<HomeAssistantControlActor,{kind:'member'}>,entityId:string,expectedRevision:number){
    await transaction(async(client)=>{await this.authorize(client,actor,true,true);const row=await this.entity(client,actor.householdId,entityId,true,true);if(row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:row.revision});await client.query('UPDATE home_assistant_control_entities SET selected=false,revision=revision+1,updated_at=clock_timestamp() WHERE household_id=$1 AND id=$2',[actor.householdId,entityId]);await this.authorize(client,actor,true,true);});
    return this.managedEntity(actor,entityId);
  }

  private async authorize(client:DbClient,actor:HomeAssistantControlActor,write:boolean,manage=false):Promise<{displayPolicyRevision:number|null;expiresAt:Date}>{
    if(actor.kind==='member'){
      const row=(await client.query<{capabilities:string[];expires_at:Date}>(`SELECT membership.capabilities,session.expires_at FROM sessions session JOIN accounts account ON account.id=session.account_id JOIN memberships membership ON membership.account_id=account.id AND membership.household_id=$2 JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id WHERE session.id=$1 AND session.account_id=$3 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp() AND account.disabled_at IS NULL AND membership.id=$4 AND membership.person_id=$5 FOR SHARE OF session,account,membership,person`,[actor.sessionId,actor.householdId,actor.accountId,actor.membershipId,actor.personId])).rows[0];
      if(!row)throw new DomainError('UNAUTHENTICATED',401);if(!row.capabilities.includes('household.view'))throw new DomainError('FORBIDDEN',403);if(manage&&!row.capabilities.includes('household.manage'))throw new DomainError('FORBIDDEN',403);return{displayPolicyRevision:null,expiresAt:row.expires_at};
    }
    const row=(await client.query<{revision:number;cards:string[];privacy_mode:boolean;credential_expires_at:Date}>(`SELECT policy.revision,setup.cards,device.privacy_mode,device.credential_expires_at FROM displays device JOIN display_action_policies policy ON policy.display_id=device.id AND policy.household_id=device.household_id JOIN display_setups setup ON setup.id=device.setup_id AND setup.household_id=device.household_id WHERE device.id=$1 AND device.household_id=$2 AND device.credential_hash=$3 AND device.revoked_at IS NULL AND device.credential_expires_at>clock_timestamp() FOR SHARE OF device,policy,setup`,[actor.id,actor.householdId,actor.credentialHash])).rows[0];
    if(!row)throw new DomainError('UNAUTHENTICATED',401);if(row.privacy_mode||actor.privacyMode)throw new DomainError('FORBIDDEN',403,{reason:'display_privacy_mode'});if(!row.cards.includes('home_assistant')||!actor.cards.includes('home_assistant'))throw new DomainError('FORBIDDEN',403,{reason:'display_card_not_selected'});
    if(write){const policy=(await client.query<{home_assistant_control:boolean}>('SELECT home_assistant_control FROM display_action_policies WHERE household_id=$1 AND display_id=$2',[actor.householdId,actor.id])).rows[0];if(!policy?.home_assistant_control)throw new DomainError('FORBIDDEN',403,{reason:'display_action_not_granted'});}
    return{displayPolicyRevision:row.revision,expiresAt:row.credential_expires_at};
  }

  private async entity(client:DbClient,householdId:string,id:string,lock=false,forUpdate=false):Promise<EntityRow>{
    const lockClause=forUpdate?'FOR UPDATE OF entity,connection':lock?'FOR SHARE OF entity,connection':'';
    const row=(await client.query<EntityRow>(`SELECT entity.*,connection.revision AS connection_revision,connection.sync_generation,connection.provider_config_revision,connection.home_assistant_origin_hash AS origin_hash,connection.state AS connection_state,connection.disconnected_at,connection.credential_ciphertext FROM home_assistant_control_entities entity JOIN calendar_connections connection ON connection.id=entity.connection_id AND connection.household_id=entity.household_id WHERE entity.id=$1 AND entity.household_id=$2 ${lockClause}`,[id,householdId])).rows[0];
    if(!row)throw new DomainError('NOT_FOUND',404);return row;
  }

  private async connectionCurrent(client:DbClient,row:EntityRow,context:RuntimeContext):Promise<void>{
    const current=(await client.query<{revision:number;sync_generation:number;provider_config_revision:number;home_assistant_origin_hash:string|null;state:string;disconnected_at:Date|null;credential_ciphertext:string|null;provider:string;provider_status:string|null;provider_revision:number|null;provider_client_id_hash:string|null;authority_ok:boolean;owner_ok:boolean}>(`SELECT connection.revision,connection.sync_generation,connection.provider_config_revision,connection.home_assistant_origin_hash,connection.state,connection.disconnected_at,connection.credential_ciphertext,connection.provider,provider.status AS provider_status,provider.revision AS provider_revision,provider.client_id_hash AS provider_client_id_hash,
        EXISTS(SELECT 1 FROM integration_connections authority WHERE authority.id=connection.integration_connection_id AND authority.household_id=connection.household_id AND authority.revoked_at IS NULL) authority_ok,
        EXISTS(SELECT 1 FROM memberships membership JOIN persons person ON person.id=membership.person_id AND person.household_id=membership.household_id AND person.age_group='adult' JOIN accounts account ON account.id=membership.account_id AND account.disabled_at IS NULL WHERE membership.account_id=connection.owner_account_id AND membership.household_id=connection.household_id AND membership.capabilities ? 'household.view') owner_ok
      FROM calendar_connections connection JOIN households household ON household.id=connection.household_id
      LEFT JOIN installation_calendar_provider_configs provider ON provider.installation_id=household.installation_id AND provider.provider='home_assistant'
      WHERE connection.id=$1 AND connection.household_id=$2 FOR SHARE OF connection,household`,[row.connection_id,row.household_id])).rows[0];
    const providerCurrent=current?.provider_status==='active'&&current.provider_revision===context.connection.providerConfigRevision&&current.provider_client_id_hash===context.runtime.clientIdHash||!current?.provider_status&&context.runtime.source==='legacy_environment'&&context.connection.providerConfigRevision===0;
    if(!current||current.provider!=='home_assistant'||current.revision!==context.connection.revision||current.sync_generation!==context.connection.syncGeneration||current.provider_config_revision!==context.connection.providerConfigRevision||current.home_assistant_origin_hash!==context.connection.originHash||row.selected_origin_hash!==current.home_assistant_origin_hash||current.state!=='connected'||current.disconnected_at||!current.credential_ciphertext||!current.authority_ok||!current.owner_ok||!providerCurrent)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_changed'});
  }

  private async grant(client:DbClient,actor:HomeAssistantControlActor,row:EntityRow,lock=false):Promise<GrantRow>{
    const table=actor.kind==='member'?'home_assistant_control_person_grants':'home_assistant_control_display_grants',column=actor.kind==='member'?'person_id':'display_id',id=actor.kind==='member'?actor.personId:actor.id;
    const grant=(await client.query<GrantRow>(`SELECT can_read,can_turn_on,can_turn_off,can_open,revision FROM ${table} WHERE household_id=$1 AND entity_id=$2 AND ${column}=$3 ${lock?'FOR SHARE':''}`,[row.household_id,row.id,id])).rows[0];
    if(!grant)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_grant_required'});return grant;
  }

  async discover(actor:Extract<HomeAssistantControlActor,{kind:'member'}>,connectionId:string,expectedConnectionRevision:number){
    await transaction(async(client)=>{await this.authorize(client,actor,true,true);const current=(await client.query<{revision:number;provider:string;state:string}>(`SELECT revision,provider,state FROM calendar_connections WHERE id=$1 AND household_id=$2 FOR SHARE`,[connectionId,actor.householdId])).rows[0];if(!current)throw new DomainError('NOT_FOUND',404);if(current.provider!=='home_assistant'||current.state!=='connected')throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_unavailable'});if(current.revision!==expectedConnectionRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:current.revision});await this.authorize(client,actor,true,true);});
    return this.calendars.withHomeAssistantControlCredential(actor.householdId,connectionId,async(context)=>{
      await transaction(async(client)=>{await this.authorize(client,actor,true,true);const current=(await client.query<{revision:number;sync_generation:number;provider_config_revision:number;home_assistant_origin_hash:string|null}>(`SELECT revision,sync_generation,provider_config_revision,home_assistant_origin_hash FROM calendar_connections WHERE id=$1 AND household_id=$2 FOR SHARE`,[connectionId,actor.householdId])).rows[0];if(!current||current.revision!==context.connection.revision||current.sync_generation!==context.connection.syncGeneration||current.provider_config_revision!==context.connection.providerConfigRevision||current.home_assistant_origin_hash!==context.connection.originHash)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_changed'});await this.authorize(client,actor,true,true);});
      const entities=await this.transport.listEntities(context.accessToken,context.runtime);
      await transaction(async(client)=>{await this.authorize(client,actor,true,true);const current=(await client.query<{revision:number;sync_generation:number;provider_config_revision:number;home_assistant_origin_hash:string|null;state:string;disconnected_at:Date|null}>(`SELECT revision,sync_generation,provider_config_revision,home_assistant_origin_hash,state,disconnected_at FROM calendar_connections WHERE id=$1 AND household_id=$2 FOR SHARE`,[connectionId,actor.householdId])).rows[0];if(!current||current.revision!==context.connection.revision||current.sync_generation!==context.connection.syncGeneration||current.provider_config_revision!==context.connection.providerConfigRevision||current.home_assistant_origin_hash!==context.connection.originHash||current.state!=='connected'||current.disconnected_at)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_changed'});await this.authorize(client,actor,true,true);});
      return{entities};
    });
  }

  async select(actor:Extract<HomeAssistantControlActor,{kind:'member'}>,connectionId:string,input:{expectedConnectionRevision:number;registryId:string;displayName?:string|null}){
    const found=await this.discover(actor,connectionId,input.expectedConnectionRevision),candidate=found.entities.find((entity)=>entity.registryId===input.registryId);if(!candidate)throw new DomainError('NOT_FOUND',404,{reason:'home_assistant_control_entity_not_found'});
    const inspected=await this.calendars.withHomeAssistantControlCredential(actor.householdId,connectionId,async(context)=>({state:await this.transport.readState(context.accessToken,candidate.entityId,context.runtime),originHash:context.connection.originHash}));candidate.supportedActions=inspected.state.supportedActions;
    const id=await transaction(async(client)=>{
      await this.authorize(client,actor,true,true);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`home-assistant-control-selection:${connectionId}`]);
      const old=(await client.query<{id:string;entity_id:string;device_registry_id:string|null;domain:string;revision:number}>(`SELECT id,entity_id,device_registry_id,domain,revision FROM home_assistant_control_entities WHERE household_id=$1 AND connection_id=$2 AND entity_registry_id=$3 FOR UPDATE`,[actor.householdId,connectionId,candidate.registryId])).rows[0];
      const connection=(await client.query<{revision:number;sync_generation:number;provider_config_revision:number;home_assistant_origin_hash:string|null;provider:string;state:string}>(`SELECT revision,sync_generation,provider_config_revision,home_assistant_origin_hash,provider,state FROM calendar_connections WHERE id=$1 AND household_id=$2 FOR UPDATE`,[connectionId,actor.householdId])).rows[0];
      if(!connection||connection.provider!=='home_assistant'||connection.state!=='connected'||connection.home_assistant_origin_hash!==inspected.originHash)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_unavailable'});if(connection.revision!==input.expectedConnectionRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:connection.revision});
      if(old&&(old.device_registry_id!==candidate.deviceRegistryId||old.domain!==candidate.domain))throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_registry_identity_reused'});
      let selectedId:string;
      if(old){await client.query(`UPDATE home_assistant_control_entities SET entity_id=$2,name=$3,display_name=$4,supported_actions=$5,selected_origin_hash=$6,selected=true,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,[old.id,candidate.entityId,candidate.name,input.displayName??null,candidate.supportedActions,inspected.originHash]);selectedId=old.id;}
      else selectedId=(await client.query<{id:string}>(`INSERT INTO home_assistant_control_entities(household_id,connection_id,entity_registry_id,entity_id,device_registry_id,domain,name,display_name,supported_actions,selected_origin_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[actor.householdId,connectionId,candidate.registryId,candidate.entityId,candidate.deviceRegistryId,candidate.domain,candidate.name,input.displayName??null,candidate.supportedActions,inspected.originHash])).rows[0]!.id;
      await this.authorize(client,actor,true,true);return selectedId;
    });
    return this.managedEntity(actor,id);
  }

  async configureGrants(actor:Extract<HomeAssistantControlActor,{kind:'member'}>,entityId:string,input:{expectedRevision:number;personGrants:Array<{personId:string;canRead:boolean;actions:HomeAssistantControlAction[]}>;displayGrants:Array<{displayId:string;canRead:boolean;actions:HomeAssistantControlAction[]}>}){
    if([...input.personGrants,...input.displayGrants].some((grant)=>grant.actions.length>0&&!grant.canRead||!grant.canRead&&grant.actions.length===0))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_grant_invalid'});
    await transaction(async(client)=>{
      await this.authorize(client,actor,true,true);const row=await this.entity(client,actor.householdId,entityId,true,true);if(row.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:row.revision});
      for(const grant of [...input.personGrants,...input.displayGrants])if(grant.actions.some((action)=>!supported(row,action)))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_action_unsupported'});
      const people=input.personGrants.length?(await client.query<{id:string}>(`SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,[actor.householdId,input.personGrants.map((item)=>item.personId)])).rows:[];
      const displays=input.displayGrants.length?(await client.query<{id:string}>(`SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,[actor.householdId,input.displayGrants.map((item)=>item.displayId)])).rows:[];
      if(people.length!==input.personGrants.length||displays.length!==input.displayGrants.length)throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_grant_target_invalid'});
      await client.query('DELETE FROM home_assistant_control_person_grants WHERE entity_id=$1',[entityId]);await client.query('DELETE FROM home_assistant_control_display_grants WHERE entity_id=$1',[entityId]);
      for(const grant of input.personGrants)await client.query(`INSERT INTO home_assistant_control_person_grants(household_id,entity_id,person_id,can_read,can_turn_on,can_turn_off,can_open) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.householdId,entityId,grant.personId,grant.canRead,grant.actions.includes('light.turn_on'),grant.actions.includes('light.turn_off'),grant.actions.includes('cover.open_cover')]);
      for(const grant of input.displayGrants)await client.query(`INSERT INTO home_assistant_control_display_grants(household_id,entity_id,display_id,can_read,can_turn_on,can_turn_off,can_open) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.householdId,entityId,grant.displayId,grant.canRead,grant.actions.includes('light.turn_on'),grant.actions.includes('light.turn_off'),grant.actions.includes('cover.open_cover')]);
      await client.query('UPDATE home_assistant_control_entities SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[entityId]);
      const updated=(await client.query<{id:string;connection_id:string;entity_registry_id:string;entity_id:string;device_registry_id:string|null;domain:string;name:string;display_name:string|null;supported_actions:HomeAssistantControlAction[];revision:number}>('SELECT id,connection_id,entity_registry_id,entity_id,device_registry_id,domain,name,display_name,supported_actions,revision FROM home_assistant_control_entities WHERE id=$1',[entityId])).rows[0]!;
      await this.authorize(client,actor,true,true);
      return updated.id;
    });
    return this.managedEntity(actor,entityId);
  }

  async describe(actor:HomeAssistantControlActor,ref:{id:string;householdId:string},client:DbClient=pool){
    await this.authorize(client,actor,false);const row=await this.entity(client,ref.householdId,ref.id),grant=await this.grant(client,actor,row);
    if(!selectedForOrigin(row))throw new DomainError('NOT_FOUND',404);
    if(!grant.can_read)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_read_required'});
    await this.authorize(client,actor,false);
    return{id:row.id,connectionId:row.connection_id,registryId:row.entity_registry_id,entityId:row.entity_id,deviceRegistryId:row.device_registry_id,domain:row.domain,name:row.display_name??row.name,supportedActions:row.supported_actions.filter((action)=>grant[actionColumn(action)]),revision:row.revision,grantRevision:grant.revision};
  }

  async list(actor:HomeAssistantControlActor){
    await transaction(async(client)=>this.authorize(client,actor,false));const column=actor.kind==='member'?'person_id':'display_id',actorId=actor.kind==='member'?actor.personId:actor.id,table=actor.kind==='member'?'home_assistant_control_person_grants':'home_assistant_control_display_grants';
    const rows=(await pool.query<{id:string}>(`SELECT entity.id FROM home_assistant_control_entities entity JOIN calendar_connections connection ON connection.id=entity.connection_id AND connection.household_id=entity.household_id JOIN ${table} grant_row ON grant_row.entity_id=entity.id AND grant_row.household_id=entity.household_id WHERE entity.household_id=$1 AND entity.selected AND entity.selected_origin_hash=connection.home_assistant_origin_hash AND grant_row.${column}=$2 AND grant_row.can_read ORDER BY entity.name,entity.id LIMIT 100`,[actor.householdId,actorId])).rows;
    const entities=[];for(const row of rows)entities.push(await this.describe(actor,{id:row.id,householdId:actor.householdId}));return{entities};
  }

  async read(actor:HomeAssistantControlActor,entityId:string){
    const row=await this.entity(pool,actor.householdId,entityId);await transaction(async(client)=>{await this.authorize(client,actor,false);const current=await this.entity(client,actor.householdId,entityId,true),grant=await this.grant(client,actor,current);if(!grant.can_read)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_read_required'});if(!selectedForOrigin(current))throw new DomainError('NOT_FOUND',404);await this.authorize(client,actor,false);});
    try{return await this.calendars.withHomeAssistantControlCredential(actor.householdId,row.connection_id,async(context)=>{
      const live=await this.transport.listEntities(context.accessToken,context.runtime),candidate=live.find((item)=>item.registryId===row.entity_registry_id);
      if(!candidate||candidate.entityId!==row.entity_id||candidate.deviceRegistryId!==row.device_registry_id||candidate.domain!==row.domain)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_identity_changed'});
      const state=await this.transport.readState(context.accessToken,row.entity_id,context.runtime);
      await transaction(async(client)=>{await this.authorize(client,actor,false);const current=await this.entity(client,actor.householdId,entityId,true);await this.connectionCurrent(client,current,context);const grant=await this.grant(client,actor,current);if(!grant.can_read||current.revision!==row.revision)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_read_revoked'});await this.authorize(client,actor,false);});
      const description=await this.describe(actor,{id:row.id,householdId:actor.householdId});return{...description,supportedActions:state.supportedActions.filter((action)=>description.supportedActions.includes(action)),state:state.stateStatus==='current'?state.state:null,stateStatus:state.stateStatus,lastChangedAt:state.lastChangedAt,readAt:new Date().toISOString(),stateAuthority:'home_assistant' as const,physicalConfirmation:'not_available' as const,errorCode:null};
    });}catch(error){return{...await this.describe(actor,{id:row.id,householdId:actor.householdId}),state:null,stateStatus:'unknown' as const,lastChangedAt:null,readAt:null,stateAuthority:'home_assistant' as const,physicalConfirmation:'not_available' as const,errorCode:safeError(error)};}
  }

  async confirmOpen(actor:HomeAssistantControlActor,entityId:string,expectedRevision:number){
    const token=opaqueToken(32),tokenHash=sha(token);
    const result=await transaction(async(client)=>{
      const auth=await this.authorize(client,actor,true),row=await this.entity(client,actor.householdId,entityId,true);if(row.revision!==expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:row.revision});
      if(!supported(row,'cover.open_cover'))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_action_unsupported'});const grant=await this.grant(client,actor,row,true);if(!grant.can_read||!grant.can_open)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_action_not_granted'});
      if(!row.origin_hash||row.connection_state!=='connected'||row.disconnected_at||!row.credential_ciphertext)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_unavailable'});
      await client.query(`INSERT INTO home_assistant_control_confirmations(household_id,token_hash,actor_kind,actor_id,session_id,credential_hash,entity_id,action,entity_revision,grant_revision,display_policy_revision,connection_revision,sync_generation,provider_config_revision,origin_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'cover.open_cover',$8,$9,$10,$11,$12,$13,$14,clock_timestamp()+interval '30 seconds')`,[actor.householdId,tokenHash,actor.kind,actor.id,actor.kind==='member'?actor.sessionId:null,actor.kind==='display'?actor.credentialHash:null,entityId,row.revision,grant.revision,auth.displayPolicyRevision,row.connection_revision,row.sync_generation,row.provider_config_revision,row.origin_hash]);
      await this.authorize(client,actor,true);
      return{expiresInSeconds:30};
    });return{confirmationToken:token,...result};
  }

  async dispatch(actor:HomeAssistantControlActor,entityId:string,input:{expectedRevision:number;action:HomeAssistantControlAction;idempotencyKey:string;confirmationToken?:string}){
    // expectedRevision and the one-use confirmation token are omitted from the
    // canonical request hash so a retry can report the committed receipt.
    const hash=sha(JSON.stringify({entityId,action:input.action}));
    const reservation=await transaction(async(client)=>{
      const authorization=await this.authorize(client,actor,true),row=await this.entity(client,actor.householdId,entityId,true);const grant=await this.grant(client,actor,row,true);
      if(!supported(row,input.action))throw new DomainError('VALIDATION_FAILED',400,{reason:'home_assistant_control_action_unsupported'});
      if(!grant.can_read||!grant[actionColumn(input.action)])throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_action_not_granted'});
      const existing=(await client.query<{id:string;request_hash:string;status:string;observed_state:string|null;error_code:string|null;entity_id:string;action:HomeAssistantControlAction;expired:boolean}>('SELECT id,request_hash,status,observed_state,error_code,entity_id,action,deadline_at<=clock_timestamp() expired FROM home_assistant_control_dispatches WHERE household_id=$1 AND actor_kind=$2 AND actor_id=$3 AND idempotency_key=$4 FOR UPDATE',[actor.householdId,actor.kind,actor.id,input.idempotencyKey])).rows[0];
      if(existing){if(existing.request_hash!==hash||existing.entity_id!==entityId||existing.action!==input.action)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_idempotency_conflict'});let status=existing.status;if(status==='dispatching'&&existing.expired){await client.query(`UPDATE home_assistant_control_dispatches SET status='unknown',error_code='home_assistant_control_dispatch_expired',updated_at=clock_timestamp() WHERE id=$1 AND status='dispatching'`,[existing.id]);status='unknown';}await this.authorize(client,actor,true);return{existing:true,response:{id:existing.id,status,observedState:existing.observed_state,errorCode:status==='unknown'?existing.error_code:null,stateAuthority:'home_assistant',physicalConfirmation:'not_available'}};}
      if(row.revision!==input.expectedRevision)throw new DomainError('REVISION_CONFLICT',409,{revision:row.revision});
      if(row.connection_state!=='connected'||row.disconnected_at||!row.credential_ciphertext||!row.origin_hash)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_connection_unavailable'});
      if(input.action==='cover.open_cover'){
        if(!input.confirmationToken)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_confirmation_required'});
        const confirmation=(await client.query<{id:string;actor_kind:string;actor_id:string;session_id:string|null;credential_hash:string|null;entity_id:string;action:HomeAssistantControlAction;entity_revision:number;grant_revision:number;display_policy_revision:number|null;connection_revision:number;sync_generation:number;provider_config_revision:number;origin_hash:string;expired:boolean;consumed_at:Date|null}>('SELECT *,expires_at<=clock_timestamp() expired FROM home_assistant_control_confirmations WHERE household_id=$1 AND token_hash=$2 FOR UPDATE',[actor.householdId,sha(input.confirmationToken)])).rows[0];
        if(!confirmation||confirmation.consumed_at||confirmation.expired||confirmation.actor_kind!==actor.kind||confirmation.actor_id!==actor.id||confirmation.entity_id!==entityId||confirmation.action!==input.action||confirmation.entity_revision!==row.revision||confirmation.grant_revision!==grant.revision||confirmation.display_policy_revision!==authorization.displayPolicyRevision||confirmation.connection_revision!==row.connection_revision||confirmation.sync_generation!==row.sync_generation||confirmation.provider_config_revision!==row.provider_config_revision||confirmation.origin_hash!==row.origin_hash||confirmation.session_id!==(actor.kind==='member'?actor.sessionId:null)||confirmation.credential_hash!==(actor.kind==='display'?actor.credentialHash:null))throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_confirmation_invalid'});
        await client.query('UPDATE home_assistant_control_confirmations SET consumed_at=clock_timestamp() WHERE id=$1',[confirmation.id]);
      }
      const inserted=(await client.query<{id:string;deadline_at:Date}>(`INSERT INTO home_assistant_control_dispatches(household_id,actor_kind,actor_id,idempotency_key,request_hash,entity_id,action,connection_revision,entity_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,deadline_at`,[actor.householdId,actor.kind,actor.id,input.idempotencyKey,hash,entityId,input.action,row.connection_revision,row.revision])).rows[0]!;
      await this.authorize(client,actor,true);
      return{existing:false,id:inserted.id,deadlineAt:inserted.deadline_at,row,authorization,grant};
    });
    if(reservation.existing)return reservation.response;
    const reserved=reservation as {existing:false;id:string;deadlineAt:Date;row:EntityRow;authorization:{displayPolicyRevision:number|null};grant:GrantRow};
    const update=async(status:'accepted'|'reported'|'unknown',state:string|null,errorCode:string|null)=>{await pool.query(`UPDATE home_assistant_control_dispatches SET status=$2,observed_state=$3,error_code=$4,updated_at=clock_timestamp() WHERE id=$1 AND status='dispatching'`,[reserved.id,status,state,errorCode]);};
    try{
      return await this.calendars.withHomeAssistantControlCredential(actor.householdId,reserved.row.connection_id,async(context)=>{
        const inventory=await this.transport.listEntities(context.accessToken,context.runtime),candidate=inventory.find((item)=>item.registryId===reserved.row.entity_registry_id);
        if(!candidate||candidate.entityId!==reserved.row.entity_id||candidate.deviceRegistryId!==reserved.row.device_registry_id||candidate.domain!==reserved.row.domain)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_identity_changed'});
        const before=await this.transport.readState(context.accessToken,candidate.entityId,context.runtime);if(before.stateStatus!=='current'||!before.supportedActions.includes(input.action))throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_action_unavailable'});
        const finalGate=await transaction(async(client)=>{
          const authorization=await this.authorize(client,actor,true);const current=await this.entity(client,actor.householdId,entityId,true);await this.connectionCurrent(client,current,context);const grant=await this.grant(client,actor,current,true);
          if(current.revision!==reserved.row.revision||!supported(current,input.action)||!grant.can_read||!grant[actionColumn(input.action)]||grant.revision!==reserved.grant.revision||authorization.displayPolicyRevision!==reserved.authorization.displayPolicyRevision)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_permission_changed'});
          let confirmationExpiresAt=Number.POSITIVE_INFINITY;
          if(input.action==='cover.open_cover'){
            const confirmation=(await client.query<{id:string;expires_at:Date;expired:boolean;consumed_at:Date|null;entity_revision:number;grant_revision:number;display_policy_revision:number|null;connection_revision:number;sync_generation:number;provider_config_revision:number;origin_hash:string}>('SELECT id,expires_at,expires_at<=clock_timestamp() expired,consumed_at,entity_revision,grant_revision,display_policy_revision,connection_revision,sync_generation,provider_config_revision,origin_hash FROM home_assistant_control_confirmations WHERE household_id=$1 AND token_hash=$2 FOR UPDATE',[actor.householdId,sha(input.confirmationToken??'')])).rows[0];
            if(!confirmation||confirmation.expired||!confirmation.consumed_at||confirmation.entity_revision!==current.revision||confirmation.grant_revision!==grant.revision||confirmation.display_policy_revision!==authorization.displayPolicyRevision||confirmation.connection_revision!==current.connection_revision||confirmation.sync_generation!==current.sync_generation||confirmation.provider_config_revision!==current.provider_config_revision||confirmation.origin_hash!==current.origin_hash)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_confirmation_expired'});
            confirmationExpiresAt=confirmation.expires_at.getTime();
          }
          // Lock/read the reservation after the garage confirmation row so its
          // deadline still bounds every subsequent wait before dispatch.
          const dispatch=(await client.query<{deadline_at:Date}>('SELECT deadline_at FROM home_assistant_control_dispatches WHERE id=$1 AND status=\'dispatching\' FOR UPDATE',[reserved.id])).rows[0];if(!dispatch)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_dispatch_expired'});
          const finalAuthorization=await this.authorize(client,actor,true);if(finalAuthorization.displayPolicyRevision!==reserved.authorization.displayPolicyRevision)throw new DomainError('FORBIDDEN',403,{reason:'home_assistant_control_permission_changed'});
          const expiresAt=Math.min(dispatch.deadline_at.getTime(),finalAuthorization.expiresAt.getTime(),confirmationExpiresAt);if(Date.now()>=expiresAt)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_dispatch_expired'});
          return{expiresAt};
        });
        // This DB check immediately precedes the fixed external call. HA registry
        // changes remain an external-admin race that cannot share our transaction.
        const remaining=finalGate.expiresAt-Date.now();if(remaining<=0)throw new DomainError('CONFLICT',409,{reason:'home_assistant_control_dispatch_expired'});
        const controlDeadline:HomeAssistantControlDeadline={epochMs:finalGate.expiresAt,monotonicMs:performance.now()+remaining};
        const result=await this.transport.callAction(context.accessToken,candidate.entityId,input.action,context.runtime,controlDeadline);
        const desired=input.action==='light.turn_on'?'on':input.action==='light.turn_off'?'off':'open',reported=result.state.state===desired;
        const status=reported?'reported':'accepted';await update(status,result.state.state,result.state.stateStatus==='current'?null:'home_assistant_control_state_unknown');
        return{id:reserved.id,status,observedState:result.state.state,errorCode:result.state.stateStatus==='current'?null:'home_assistant_control_state_unknown',stateAuthority:'home_assistant',physicalConfirmation:'not_available'};
      });
    }catch(error){const errorCode=safeError(error);await update('unknown',null,errorCode);return{id:reserved.id,status:'unknown' as const,observedState:null,errorCode,stateAuthority:'home_assistant',physicalConfirmation:'not_available'};}
  }
}
