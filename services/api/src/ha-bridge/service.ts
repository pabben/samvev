import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type pg from 'pg';
import {z} from 'zod';
import {groceryCreateSchema,groceryUpdateSchema,groceryDeleteSchema,type Capability,integrationCapabilities} from '@samvev/contracts';
import {DomainError,initialMessageState,requireCapability} from '@samvev/core';
import {pool,transaction,type DbClient} from '../db.ts';
import {HouseholdBoardService,type IntegrationBoardActor,type BoardKind} from '../household-board/service.ts';

type IntegrationCapability=(typeof integrationCapabilities)[number];
export interface HaIntegrationContext{credentialId:string;credentialRevision:number;connectionId:string;householdId:string;installationId:string;capabilities:IntegrationCapability[];}
interface ManagerContext{accountId:string;sessionId:string;installationId:string;membershipId:string;householdId:string;personId:string;rolePreset:string;capabilities:Capability[];}
interface Dependencies{
  integrationAuth:(request:FastifyRequest)=>Promise<HaIntegrationContext>;
  lockIntegrationAuthority:(client:DbClient,context:HaIntegrationContext,capability:IntegrationCapability)=>Promise<void>;
  auditIntegration:(client:DbClient,context:HaIntegrationContext,action:string,subjectType:string,subjectId:string,metadata?:Record<string,unknown>)=>Promise<void>;
  authForHousehold:(request:FastifyRequest,id:string)=>Promise<ManagerContext>;
  recheckHouseholdAuth:(client:DbClient,request:FastifyRequest,auth:ManagerContext,capability:Capability)=>Promise<void>;
  rateLimit:(bucket:string,key:string,limit:number,window:number)=>Promise<void>;
}
interface HaCalendar{id:string;name:string;writable:boolean;freshness?:string;lastSyncSucceededAt?:string|null;errorCode?:string|null;lastCompleteWindow?:{from:string;to:string}|null;}
export interface HaSharing{revision:number;listIds:string[];household:boolean;personIds:string[];calendarSourceIds:string[];allowSharedNativeWrites:boolean;}
const emptySharing=():HaSharing=>({revision:0,listIds:[],household:false,personIds:[],calendarSourceIds:[],allowSharedNativeWrites:false});
const uuid=z.uuid();
const uniqueIds=z.array(uuid).max(50).refine(values=>new Set(values).size===values.length,'duplicate_ids');
const sharingSchema=z.object({expectedRevision:z.number().int().nonnegative(),listIds:z.array(z.literal('groceries')).max(1),household:z.boolean(),personIds:uniqueIds,calendarSourceIds:uniqueIds,allowSharedNativeWrites:z.boolean().default(false)}).strict();
const requestKey=z.string().min(8).max(128);
const revision=z.number().int().positive();
const instant=z.iso.datetime({offset:true});
const audience=z.object({household:z.boolean(),personIds:uniqueIds}).strict().refine(value=>value.household||value.personIds.length>0,'audience_required');
const messageFields={body:z.string().trim().min(1).max(1000),importance:z.enum(['normal','attention']),audience,publishAt:instant.optional(),expiresAt:instant};
const messageCreate=z.object({...messageFields,requestKey}).strict();
const messageUpdate=z.object({body:messageFields.body.optional(),importance:messageFields.importance.optional(),audience:audience.optional(),publishAt:instant.optional(),expiresAt:instant.optional(),expectedRevision:revision,requestKey}).strict();
const mutationRevision=z.object({expectedRevision:revision,requestKey}).strict();
const eventTime=z.union([z.iso.date(),instant]);
const eventFields={summary:z.string().trim().min(1).max(160),start:eventTime,end:eventTime,description:z.string().max(4000).optional(),location:z.string().max(160).optional()};
const eventCreate=z.object({...eventFields,requestKey}).strict();
const eventUpdate=z.object({summary:eventFields.summary.optional(),start:eventTime.optional(),end:eventTime.optional(),description:eventFields.description,location:eventFields.location,expectedRevision:revision,requestKey}).strict();
function ids(request:FastifyRequest){return request.params as Record<string,string>;}
function mustUuid(value:string|undefined):string{return uuid.parse(value);}
function payloadHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function conflict():never{throw new DomainError('REVISION_CONFLICT',409);}
function requireAudience(grants:HaSharing,value:{household:boolean;personIds:string[]}){
  if(value.household&&!grants.household||value.personIds.some(id=>!grants.personIds.includes(id)))throw new DomainError('FORBIDDEN',403,{reason:'ha_audience_not_shared'});
}
interface MessageRow{id:string;body:string;importance:string;audience_household:boolean;person_ids:string[];publish_at:Date;expires_at:Date;state:string;revision:number;author_name:string;author_type:string;author_integration_id:string|null;has_display_targets:boolean;invalid_display_targets:boolean;native_authored:boolean;}
const messageColumns=`m.id,m.body,m.importance,m.audience_household,m.publish_at,m.expires_at,m.state,m.revision,m.author_integration_id,
  COALESCE(person.display_name,m.author_display_name,m.author_integration_name) AS author_name,
  CASE WHEN m.author_integration_id IS NOT NULL THEN 'integration' WHEN m.author_display_id IS NOT NULL THEN 'display' ELSE 'member' END AS author_type,
  COALESCE((SELECT array_agg(pa.person_id ORDER BY pa.person_id) FROM message_person_audiences pa WHERE pa.message_id=m.id),ARRAY[]::uuid[]) AS person_ids,
  EXISTS(SELECT 1 FROM message_display_targets target WHERE target.message_id=m.id AND target.delivery_state IN ('queued','delivered','displayed')) AS has_display_targets,
  EXISTS(SELECT 1 FROM message_display_targets target LEFT JOIN displays display ON display.id=target.display_id AND display.household_id=m.household_id
    WHERE target.message_id=m.id AND target.delivery_state IN ('queued','delivered','displayed') AND
      (display.id IS NULL OR display.revoked_at IS NOT NULL OR display.credential_expires_at IS NULL OR display.credential_expires_at<=clock_timestamp())) AS invalid_display_targets,
  (EXISTS(SELECT 1 FROM message_lifecycle_events creation WHERE creation.message_id=m.id AND creation.from_state IS NULL AND creation.actor_type IN ('account','display','integration'))
    AND NOT EXISTS(SELECT 1 FROM message_lifecycle_events creation WHERE creation.message_id=m.id AND creation.from_state IS NULL AND creation.actor_type IN ('worker','system'))) AS native_authored`;
const messageJoins=`LEFT JOIN memberships author ON author.id=m.author_membership_id LEFT JOIN persons person ON person.id=author.person_id AND person.household_id=m.household_id`;
function audienceReadable(grants:HaSharing,value:{household:boolean;personIds:string[]}){return grants.household&&value.household||value.personIds.some(id=>grants.personIds.includes(id));}
function audienceWithin(grants:HaSharing,value:{household:boolean;personIds:string[]}){return(!value.household||grants.household)&&value.personIds.every(id=>grants.personIds.includes(id));}
function writeCapabilities(context:HaIntegrationContext,kind:'messages'|'calendar'){return context.capabilities.includes(`ha.${kind}.read`)&&context.capabilities.includes(`ha.${kind}.write`);}
function messageWritable(row:MessageRow,context:HaIntegrationContext,grants:HaSharing,includeEnded=false){
  const targets={household:row.audience_household,personIds:row.person_ids};
  return writeCapabilities(context,'messages')&&row.native_authored&&(row.author_integration_id===context.connectionId||grants.allowSharedNativeWrites)
    &&audienceReadable(grants,targets)&&audienceWithin(grants,targets)
    &&(!row.has_display_targets||grants.allowSharedNativeWrites&&grants.household&&!row.invalid_display_targets)
    &&(includeEnded||['published','scheduled'].includes(row.state)&&row.expires_at>new Date());
}
function mapMessage(row:MessageRow,context:HaIntegrationContext,grants:HaSharing){return{id:row.id,body:row.body,authorName:row.author_name,authorType:row.author_type,audience:{household:row.audience_household,personIds:row.person_ids},publishAt:row.publish_at.toISOString(),expiresAt:row.expires_at.toISOString(),importance:row.importance,state:row.state,revision:row.revision,readOnly:!messageWritable(row,context,grants)};}
interface EventRow{id:string;connection_id:string;title:string;body:string;starts_at:Date;ends_at:Date|null;metadata:Record<string,unknown>;revision:number;provider?:string;target_household:boolean;person_ids:string[];status:string;source_active:boolean;has_occurrence:boolean;ha_native_origin:boolean;}
function eventWritable(row:EventRow,context:HaIntegrationContext,grants:HaSharing,includeEnded=false){
  const targets={household:row.target_household,personIds:row.person_ids};
  return writeCapabilities(context,'calendar')&&row.source_active&&row.ha_native_origin===true&&row.metadata.haBridge===true&&!Object.hasOwn(row.metadata,'calendar')&&!row.has_occurrence
    &&(row.connection_id===context.connectionId||grants.allowSharedNativeWrites)&&audienceReadable(grants,targets)&&audienceWithin(grants,targets)
    &&(includeEnded||row.status==='active');
}
function mapEvent(row:EventRow,context:HaIntegrationContext,grants:HaSharing,includeAudience=false){
  const allDay=row.metadata.allDay===true&&(row.metadata.calendar!==undefined||row.metadata.haBridge===true);
  const start=allDay?row.starts_at.toISOString().slice(0,10):row.starts_at.toISOString();
  const fallbackEnd=new Date(row.starts_at.getTime()+(allDay?86400_000:1));
  const end=allDay?(row.ends_at??fallbackEnd).toISOString().slice(0,10):(row.ends_at??fallbackEnd).toISOString();
  return{id:row.id,summary:row.title,start,end,description:row.metadata.haDescriptionEmpty===true?'':typeof row.metadata.haDescription==='string'?row.metadata.haDescription:row.body,location:typeof row.metadata.location==='string'?row.metadata.location:'',revision:row.revision,readOnly:!eventWritable(row,context,grants),source:row.provider??'samvev',...(includeAudience?{audience:{household:row.target_household,personIds:row.person_ids}}:{})};
}
function eventDates(start:string,end:string){
  const allDay=start.length===10;if(allDay!==(end.length===10)||end<=start&&allDay)throw new DomainError('VALIDATION_FAILED',400,{reason:'calendar_event_time_invalid'});
  const startDate=new Date(allDay?`${start}T00:00:00.000Z`:start),endDate=new Date(allDay?`${end}T00:00:00.000Z`:end);
  if(endDate<=startDate)throw new DomainError('VALIDATION_FAILED',400,{reason:'calendar_event_time_invalid'});
  return{allDay,startDate,endDate};
}

/** Native transport adapter over Samvev's existing board, message and item models. */
export class HaBridgeService{
  constructor(private readonly dependencies:Dependencies){}
  private async sharing(client:DbClient,context:HaIntegrationContext):Promise<HaSharing>{
    const row=(await client.query<HaSharing>(`SELECT revision,list_ids AS "listIds",household,person_ids AS "personIds",calendar_source_ids AS "calendarSourceIds",allow_shared_native_writes AS "allowSharedNativeWrites" FROM integration_ha_sharing WHERE connection_id=$1 AND household_id=$2 FOR UPDATE`,[context.connectionId,context.householdId])).rows[0];
    return row??emptySharing();
  }
  private async authorize(client:DbClient,context:HaIntegrationContext,capability:IntegrationCapability):Promise<HaSharing>{
    await this.dependencies.lockIntegrationAuthority(client,context,capability);
    // Mutations return the authoritative resource (including existing fields).
    // A write-only credential must never gain a read channel through PATCH or
    // durable receipt replay, so every bridge write requires its paired read.
    if(capability.startsWith('ha.')&&capability.endsWith('.write'))await this.dependencies.lockIntegrationAuthority(client,context,capability.replace(/\.write$/,'.read') as IntegrationCapability);
    return this.sharing(client,context);
  }
  async authorizeBoard(client:DbClient,actor:IntegrationBoardActor,board:BoardKind,write:boolean){
    if(board!=='groceries')throw new DomainError('FORBIDDEN',403);
    const context:HaIntegrationContext={...actor,connectionId:actor.id,capabilities:actor.capabilities as IntegrationCapability[]};
    const sharing=await this.authorize(client,context,write?'ha.groceries.write':'ha.groceries.read');
    if(!sharing.listIds.includes('groceries'))throw new DomainError('FORBIDDEN',403,{reason:'ha_list_not_shared'});
  }
  private async connection(client:DbClient,context:HaIntegrationContext,grants:HaSharing){
    const row=(await client.query<{name:string;timezone:string}>(`SELECT connection.name,household.timezone FROM integration_connections connection JOIN households household ON household.id=connection.household_id WHERE connection.id=$1 AND connection.household_id=$2`,[context.connectionId,context.householdId])).rows[0]!;
    return{schemaVersion:1,installationId:context.installationId,connectionId:context.connectionId,householdId:context.householdId,name:row.name,timezone:row.timezone,capabilities:context.capabilities,grants};
  }
  private async authenticate(request:FastifyRequest){
    const context=await this.dependencies.integrationAuth(request);
    if(!context.capabilities.some(value=>value.startsWith('ha.')))throw new DomainError('FORBIDDEN',403);
    await this.dependencies.rateLimit('ha_bridge_connection',context.connectionId,240,60);
    return context;
  }
  private readCapability(context:HaIntegrationContext):IntegrationCapability{return context.capabilities.find(value=>value.startsWith('ha.'))!;}
  private async calendars(client:DbClient,context:HaIntegrationContext,grants:HaSharing):Promise<HaCalendar[]>{
    if(!context.capabilities.includes('ha.calendar.read')||!grants.household&&!grants.personIds.length)return[];
    const native={id:'samvev',name:'Samvev',writable:context.capabilities.includes('ha.calendar.write')};
    const sources=await client.query<{id:string;name:string;last_sync_succeeded_at:Date|null;last_complete_window_from:Date|null;last_complete_window_to:Date|null;error_code:string|null;state:string;sync_interval_minutes:number}>(`SELECT source.id,COALESCE(source.display_name,source.name) AS name,source.last_sync_succeeded_at,source.last_complete_window_from,source.last_complete_window_to,COALESCE(source.last_error_code,calendar.last_error_code) AS error_code,calendar.state,calendar.sync_interval_minutes FROM calendar_sources source
      JOIN calendar_connections calendar ON calendar.id=source.connection_id AND calendar.household_id=source.household_id AND calendar.disconnected_at IS NULL
      JOIN integration_connections authority ON authority.id=calendar.integration_connection_id AND authority.household_id=source.household_id AND authority.revoked_at IS NULL
      JOIN memberships owner_membership ON owner_membership.account_id=calendar.owner_account_id AND owner_membership.household_id=calendar.household_id AND owner_membership.capabilities ? 'household.view'
      JOIN persons owner_person ON owner_person.id=owner_membership.person_id AND owner_person.household_id=calendar.household_id AND owner_person.age_group='adult'
      JOIN accounts owner_account ON owner_account.id=calendar.owner_account_id AND owner_account.disabled_at IS NULL
      WHERE source.household_id=$1 AND source.id=ANY($2::uuid[]) AND source.enabled
        AND (($3::boolean AND source.target_household) OR EXISTS(SELECT 1 FROM calendar_source_person_readers reader WHERE reader.source_id=source.id AND reader.person_id=ANY($4::uuid[])))
      ORDER BY source.id FOR SHARE OF source,calendar,authority,owner_membership,owner_person,owner_account`,[context.householdId,grants.calendarSourceIds,grants.household,grants.personIds]);
    return[native,...sources.rows.map(source=>({id:source.id,name:source.name,writable:false,
      freshness:!source.last_sync_succeeded_at?'pending':source.error_code||source.state!=='connected'||Date.now()-source.last_sync_succeeded_at.getTime()>source.sync_interval_minutes*120_000?'stale':'current',
      lastSyncSucceededAt:source.last_sync_succeeded_at?.toISOString()??null,errorCode:source.error_code,
      lastCompleteWindow:source.last_complete_window_from&&source.last_complete_window_to?{from:source.last_complete_window_from.toISOString(),to:source.last_complete_window_to.toISOString()}:null}))];
  }
  private async mutation<T>(context:HaIntegrationContext,capability:IntegrationCapability,input:{requestKey:string;expectedRevision?:number},operation:unknown,run:(client:pg.PoolClient,grants:HaSharing,protectDisplays:(messageId:string)=>Promise<void>)=>Promise<T>):Promise<T>{
    return transaction(async(client)=>{
      const grants=await this.authorize(client,context,capability);
      const displayWitnesses=new Set<string>();
      const protectDisplays=async(messageId:string)=>{
        const displays=(await client.query<{id:string}>(`SELECT display.id FROM message_display_targets target JOIN displays display
          ON display.id=target.display_id AND display.household_id=target.household_id
          WHERE target.message_id=$1 AND target.household_id=$2 AND target.delivery_state IN ('queued','delivered','displayed') ORDER BY display.id FOR SHARE OF display`,[messageId,context.householdId])).rows;
        for(const display of displays)displayWitnesses.add(display.id);
        await assertDisplays();
      };
      const assertDisplays=async()=>{
        if(!displayWitnesses.size)return;
        const valid=await client.query(`SELECT id FROM displays WHERE household_id=$1 AND id=ANY($2::uuid[]) AND revoked_at IS NULL AND credential_expires_at>clock_timestamp()`,[context.householdId,[...displayWitnesses]]);
        if(valid.rowCount!==displayWitnesses.size)throw new DomainError('FORBIDDEN',403,{reason:'ha_display_authority_changed'});
      };
      const {expectedRevision:_,requestKey:key,...payload}=input;
      const hash=payloadHash({operation,payload});
      const old=(await client.query<{request_hash:string;response:T}>(`SELECT request_hash,response FROM integration_ha_requests WHERE connection_id=$1 AND request_key=$2 FOR UPDATE`,[context.connectionId,key])).rows[0];
      if(old){
        if(old.request_hash!==hash)throw new DomainError('CONFLICT',409,{reason:'idempotency_payload_mismatch'});
        // Durable receipts are protected content too: narrower sharing must not
        // reveal an old successful response after its resource was unshared.
        const receipt=old.response as {message?:{audience:{household:boolean;personIds:string[]}};event?:{id:string;summary?:string;audience?:{household:boolean;personIds:string[]}}};
        if(receipt.message){requireAudience(grants,receipt.message.audience);const current=await this.getMessage(client,context,(old.response as {message:{id:string}}).message.id);this.authorizeMessageMutation(current,context,grants,true);await protectDisplays(current.id);}
        if(receipt.event){
          const original=await this.writableEvent(client,context,grants,receipt.event.id,true);
          if(receipt.event.audience)requireAudience(grants,receipt.event.audience);
          // Pre-048 receipts cannot be shared-author writes. New cross-author
          // receipts retain original targets as well as checking current ones.
          else if(original.connection_id!==context.connectionId)throw new DomainError('FORBIDDEN',403);
        }
        await this.authorize(client,context,capability);await assertDisplays();return old.response;
      }
      const result=await run(client,grants,protectDisplays);
      await this.authorize(client,context,capability);
      await assertDisplays();
      await client.query(`INSERT INTO integration_ha_requests(household_id,connection_id,request_key,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)`,[context.householdId,context.connectionId,key,hash,JSON.stringify(result)]);
      return result;
    }).catch((error:unknown)=>{
      if((error as {code?:string})?.code==='40P01')throw new DomainError('CONFLICT',409,{reason:'ha_authority_concurrency_retry'});
      throw error;
    });
  }
  private async getMessage(client:DbClient,context:HaIntegrationContext,id:string){return(await client.query<MessageRow>(`SELECT ${messageColumns} FROM messages m ${messageJoins} WHERE m.id=$1 AND m.household_id=$2 FOR SHARE OF m`,[id,context.householdId])).rows[0]!;}
  private authorizeMessageMutation(row:MessageRow|undefined,context:HaIntegrationContext,grants:HaSharing,includeEnded=false){
    if(!row)throw new DomainError('NOT_FOUND',404);
    if(row.author_integration_id!==context.connectionId&&!grants.allowSharedNativeWrites)throw new DomainError('NOT_FOUND',404);
    if(!messageWritable(row,context,grants,includeEnded))throw new DomainError('FORBIDDEN',403,{reason:'ha_native_message_not_writable'});
  }

  private async lifecycle(client:DbClient,context:HaIntegrationContext,id:string,from:string|null,to:string,revision:number,action:string){
    await client.query(`INSERT INTO message_lifecycle_events(message_id,from_state,to_state,revision,actor_type,actor_id,idempotency_key) VALUES($1,$2,$3,$4,'integration',$5,$6)`,[id,from,to,revision,context.connectionId,`ha:${action}:${id}:${revision}`]);
    await this.dependencies.auditIntegration(client,context,`ha.message_${action}`,'message',id);
  }
  register(app:FastifyInstance,boards:HouseholdBoardService){
    const administrative='/api/v1/households/:householdId/integrations/:connectionId/ha-sharing';
    app.get(administrative,async(request,reply)=>{
      const auth=await this.dependencies.authForHousehold(request,mustUuid(ids(request).householdId));requireCapability(auth.capabilities,'household.manage');
      const connectionId=mustUuid(ids(request).connectionId);
      reply.header('Cache-Control','private, no-store');
      return transaction(async(client)=>{
        // Match integration administration lock order: connection before actor
        // rows, so revocation/audit cannot deadlock against this policy edit.
        const connection=await client.query('SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR UPDATE',[connectionId,auth.householdId]);if(!connection.rowCount)throw new DomainError('NOT_FOUND',404);
        await this.dependencies.recheckHouseholdAuth(client,request,auth,'household.manage');
        return this.sharing(client,{...auth,connectionId,credentialId:'',credentialRevision:0,capabilities:[]});
      });
    });
    app.patch(administrative,async(request,reply)=>{
      const auth=await this.dependencies.authForHousehold(request,mustUuid(ids(request).householdId));requireCapability(auth.capabilities,'household.manage');
      const connectionId=mustUuid(ids(request).connectionId),body=sharingSchema.parse(request.body);
      reply.header('Cache-Control','private, no-store');
      return transaction(async(client)=>{
        // Match integration administration lock order: connection before actor
        // rows, so revocation/audit cannot deadlock against this policy edit.
        const connection=await client.query('SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR UPDATE',[connectionId,auth.householdId]);if(!connection.rowCount)throw new DomainError('NOT_FOUND',404);
        await this.dependencies.recheckHouseholdAuth(client,request,auth,'household.manage');
        const context={...auth,connectionId,credentialId:'',credentialRevision:0,capabilities:[]};
        const previous=await this.sharing(client,context);if(previous.revision!==body.expectedRevision)conflict();
        const people=await client.query('SELECT id FROM persons WHERE household_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[auth.householdId,body.personIds]);
        const sources=await client.query('SELECT id FROM calendar_sources WHERE household_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[auth.householdId,body.calendarSourceIds]);
        if(people.rowCount!==body.personIds.length||sources.rowCount!==body.calendarSourceIds.length)throw new DomainError('NOT_FOUND',404);
        await client.query(`INSERT INTO integration_ha_sharing(household_id,connection_id,list_ids,household,person_ids,calendar_source_ids,allow_shared_native_writes) VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(connection_id) DO UPDATE SET list_ids=EXCLUDED.list_ids,household=EXCLUDED.household,person_ids=EXCLUDED.person_ids,calendar_source_ids=EXCLUDED.calendar_source_ids,allow_shared_native_writes=EXCLUDED.allow_shared_native_writes,revision=integration_ha_sharing.revision+1,updated_at=clock_timestamp()`,[auth.householdId,connectionId,JSON.stringify(body.listIds),body.household,body.personIds,body.calendarSourceIds,body.allowSharedNativeWrites]);
        await this.dependencies.recheckHouseholdAuth(client,request,auth,'household.manage');
        await client.query(`INSERT INTO audit_events(installation_id,household_id,actor_type,actor_id,action,subject_type,subject_id) VALUES($1,$2,'account',$3,'ha.sharing_updated','integration_connection',$4)`,[auth.installationId,auth.householdId,auth.accountId,connectionId]);
        return this.sharing(client,context);
      });
    });
    app.get('/api/v1/ha/connection',async(request,reply)=>{
      const context=await this.authenticate(request);reply.header('Cache-Control','private, no-store');
      return transaction(async(client)=>{const grants=await this.authorize(client,context,this.readCapability(context));const result=await this.connection(client,context,grants);await this.authorize(client,context,this.readCapability(context));return result;});
    });
    app.get('/api/v1/ha/snapshot',async(request,reply)=>{
      const context=await this.authenticate(request);reply.header('Cache-Control','private, no-store');
      return transaction(async(client)=>{
        const grants=await this.authorize(client,context,this.readCapability(context));
        const lists:Array<Record<string,unknown>>=[];const messages:ReturnType<typeof mapMessage>[]=[];
        if(context.capabilities.includes('ha.groceries.read')&&grants.listIds.includes('groceries')){
          await this.authorize(client,context,'ha.groceries.read');
          const items=(await client.query(`SELECT id,label,checked,revision FROM household_grocery_items WHERE household_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`,[context.householdId])).rows;
          lists.push({id:'groceries',name:'Samvev',writable:context.capabilities.includes('ha.groceries.write'),items});
        }
        if(context.capabilities.includes('ha.messages.read')){
          await this.authorize(client,context,'ha.messages.read');
          const rows=(await client.query<MessageRow>(`SELECT ${messageColumns} FROM messages m ${messageJoins}
            WHERE m.household_id=$1 AND m.state='published' AND m.publish_at<=clock_timestamp() AND m.expires_at>clock_timestamp()
              AND (($2::boolean AND m.audience_household) OR EXISTS(SELECT 1 FROM message_person_audiences reader WHERE reader.message_id=m.id AND reader.person_id=ANY($3::uuid[])))
            ORDER BY CASE m.importance WHEN 'attention' THEN 0 ELSE 1 END,m.publish_at,m.id`,[context.householdId,grants.household,grants.personIds])).rows;
          messages.push(...rows.map(row=>mapMessage(row,context,grants)));
        }
        const calendars=await this.calendars(client,context,grants);
        const result={...await this.connection(client,context,grants),lists,messages,calendars,serverNow:new Date().toISOString()};
        // Revalidate every read capability rather than trusting the initial auth snapshot.
        for(const cap of context.capabilities.filter(cap=>cap.startsWith('ha.')&&cap.endsWith('.read')))await this.authorize(client,context,cap);
        await this.authorize(client,context,this.readCapability(context));return result;
      });
    });
    const actor=(context:HaIntegrationContext):IntegrationBoardActor=>({...context,kind:'integration',id:context.connectionId});
    app.post('/api/v1/ha/lists/groceries/items',async(request,reply)=>{const context=await this.authenticate(request);reply.header('Cache-Control','private, no-store');return reply.status(201).send(await boards.createGrocery(actor(context),groceryCreateSchema.parse(request.body)));});
    app.patch('/api/v1/ha/lists/groceries/items/:id',async(request,reply)=>{const context=await this.authenticate(request);reply.header('Cache-Control','private, no-store');return boards.updateGrocery(actor(context),mustUuid(ids(request).id),groceryUpdateSchema.parse(request.body));});
    app.delete('/api/v1/ha/lists/groceries/items/:id',async(request,reply)=>{const context=await this.authenticate(request);reply.header('Cache-Control','private, no-store');return boards.deleteGrocery(actor(context),mustUuid(ids(request).id),groceryDeleteSchema.parse(request.body));});
    app.post('/api/v1/ha/messages',async(request,reply)=>{
      const context=await this.authenticate(request),body=messageCreate.parse(request.body);reply.header('Cache-Control','private, no-store');
      const result=await this.mutation(context,'ha.messages.write',body,'message.create',async(client,grants)=>{
        requireAudience(grants,body.audience);const publishAt=body.publishAt?new Date(body.publishAt):new Date(),expiresAt=new Date(body.expiresAt),state=initialMessageState(publishAt,expiresAt,new Date());
        const identity=await this.connection(client,context,grants);
        const row=(await client.query<{id:string}>(`INSERT INTO messages(household_id,author_integration_id,author_integration_name,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $9='published' THEN clock_timestamp() END) RETURNING id`,[context.householdId,context.connectionId,identity.name,body.body,body.importance,body.audience.household,publishAt,expiresAt,state,body.requestKey])).rows[0]!;
        for(const id of body.audience.personIds)await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[context.householdId,row.id,id]);
        await this.lifecycle(client,context,row.id,null,state,1,'created');return{message:mapMessage(await this.getMessage(client,context,row.id),context,grants)};
      });return reply.status(201).send(result);
    });
    app.patch('/api/v1/ha/messages/:id',async(request,reply)=>{
      const context=await this.authenticate(request),id=mustUuid(ids(request).id),body=messageUpdate.parse(request.body);reply.header('Cache-Control','private, no-store');
      return this.mutation(context,'ha.messages.write',body,{action:'message.update',id},async(client,grants,protectDisplays)=>{
        const current=(await client.query<{state:string;publish_at:Date;expires_at:Date;audience_household:boolean}>(`SELECT state,publish_at,expires_at,audience_household FROM messages WHERE id=$1 AND household_id=$2 FOR UPDATE`,[id,context.householdId])).rows[0];
        if(!current)throw new DomainError('NOT_FOUND',404);
        const currentMessage=await this.getMessage(client,context,id);this.authorizeMessageMutation(currentMessage,context,grants,true);await protectDisplays(id);if(!['published','scheduled'].includes(current.state))throw new DomainError('CONFLICT',409);if(body.audience)requireAudience(grants,body.audience);
        const publishAt=body.publishAt?new Date(body.publishAt):current.publish_at,expiresAt=body.expiresAt?new Date(body.expiresAt):current.expires_at;
        if(expiresAt<=publishAt||expiresAt<=new Date())throw new DomainError('SCHEDULE_INVALID',422);if(current.state==='published'&&publishAt>new Date())throw new DomainError('CONFLICT',409,{reason:'published_cannot_reschedule'});
        const updated=await client.query<{revision:number}>(`UPDATE messages SET body=COALESCE($3,body),importance=COALESCE($4,importance),audience_household=COALESCE($5,audience_household),publish_at=$6,expires_at=$7,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$8 RETURNING revision`,[id,context.householdId,body.body??null,body.importance??null,body.audience?.household??null,publishAt,expiresAt,body.expectedRevision]);if(!updated.rowCount)conflict();
        if(body.audience){await client.query('DELETE FROM message_person_audiences WHERE message_id=$1',[id]);for(const personId of body.audience.personIds)await client.query('INSERT INTO message_person_audiences(household_id,message_id,person_id) VALUES($1,$2,$3)',[context.householdId,id,personId]);}
        // Existing M1 targets retain their delivery semantics; an edit resets render receipts.
        await client.query(`UPDATE message_display_targets SET delivery_state='queued',delivered_revision=NULL,delivered_at=NULL,displayed_at=NULL WHERE message_id=$1 AND delivery_state IN ('queued','delivered','displayed')`,[id]);
        await this.lifecycle(client,context,id,current.state,current.state,updated.rows[0]!.revision,'edited');return{message:mapMessage(await this.getMessage(client,context,id),context,grants)};
      });
    });
    app.post('/api/v1/ha/messages/:id/withdraw',async(request,reply)=>{
      const context=await this.authenticate(request),id=mustUuid(ids(request).id),body=mutationRevision.parse(request.body);reply.header('Cache-Control','private, no-store');
      return this.mutation(context,'ha.messages.write',body,{action:'message.withdraw',id},async(client,grants,protectDisplays)=>{
        const current=(await client.query<{state:string}>(`SELECT state FROM messages WHERE id=$1 AND household_id=$2 FOR UPDATE`,[id,context.householdId])).rows[0];if(!current)throw new DomainError('NOT_FOUND',404);
        const message=await this.getMessage(client,context,id);this.authorizeMessageMutation(message,context,grants);await protectDisplays(id);
        if(!['scheduled','published'].includes(current.state))throw new DomainError('CONFLICT',409);const next=current.state==='scheduled'?'cancelled':'withdrawn';
        const result=await client.query<{revision:number}>(`UPDATE messages SET state=$3,revision=revision+1,ended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$4 RETURNING revision`,[id,context.householdId,next,body.expectedRevision]);if(!result.rowCount)conflict();
        await client.query(`UPDATE message_display_targets SET delivery_state='cancelled' WHERE message_id=$1`,[id]);await this.lifecycle(client,context,id,current.state,next,result.rows[0]!.revision,'withdrawn');return{message:mapMessage(await this.getMessage(client,context,id),context,grants)};
      });
    });
    app.get('/api/v1/ha/calendars/:calendarId/events',async(request,reply)=>{
      const context=await this.authenticate(request),query=z.object({start:instant,end:instant}).strict().parse(request.query),start=new Date(query.start),end=new Date(query.end);reply.header('Cache-Control','private, no-store');
      if(end<=start||end.getTime()-start.getTime()>366*86400_000)throw new DomainError('VALIDATION_FAILED',400,{reason:'ha_calendar_window_invalid'});
      return transaction(async(client)=>{
        const grants=await this.authorize(client,context,'ha.calendar.read'),calendarId=ids(request).calendarId!;
        const calendars=await this.calendars(client,context,grants),selected=calendars.find(calendar=>calendar.id===calendarId);if(!selected)throw new DomainError('FORBIDDEN',403,{reason:'ha_calendar_not_shared'});
        const sourceId=calendarId==='samvev'?null:mustUuid(calendarId);
        const complete=selected.lastCompleteWindow;
        // Imported snapshots are bounded. Never turn an unsynchronized range
        // into a misleading empty or partial successful calendar response.
        if(sourceId&&(!complete||start<new Date(complete.from)||end>new Date(complete.to)))throw new DomainError('CONFLICT',409,{reason:'ha_calendar_window_not_synced'});
        const rows=(await client.query<EventRow>(`SELECT i.id,i.connection_id,i.title,i.body,i.starts_at,i.ends_at,i.metadata,i.revision,calendar.provider,i.target_household,i.status,i.ha_native_origin,true AS source_active,(occurrence.id IS NOT NULL) AS has_occurrence,
          COALESCE((SELECT array_agg(target.person_id ORDER BY target.person_id) FROM integration_item_person_targets target WHERE target.item_id=i.id),ARRAY[]::uuid[]) AS person_ids
          FROM integration_items i JOIN integration_connections authority ON authority.id=i.connection_id AND authority.household_id=i.household_id AND authority.revoked_at IS NULL
          JOIN households household ON household.id=i.household_id
          LEFT JOIN calendar_occurrences occurrence ON occurrence.integration_item_id=i.id AND occurrence.household_id=i.household_id
          LEFT JOIN calendar_sources source ON source.id=occurrence.source_id AND source.household_id=i.household_id
          LEFT JOIN calendar_connections calendar ON calendar.id=source.connection_id AND calendar.household_id=i.household_id
          CROSS JOIN LATERAL(SELECT
            CASE WHEN (i.metadata->'calendar' IS NOT NULL OR i.metadata->'haBridge'='true'::jsonb) AND i.metadata->'allDay'='true'::jsonb THEN (i.starts_at AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE household.timezone ELSE i.starts_at END AS start,
            CASE WHEN (i.metadata->'calendar' IS NOT NULL OR i.metadata->'haBridge'='true'::jsonb) AND i.metadata->'allDay'='true'::jsonb THEN COALESCE((i.ends_at AT TIME ZONE 'UTC')::date,(i.starts_at AT TIME ZONE 'UTC')::date+1)::timestamp AT TIME ZONE household.timezone ELSE COALESCE(i.ends_at,i.starts_at+interval '1 millisecond') END AS end) timing
          WHERE i.household_id=$1 AND i.kind='event' AND i.status='active' AND i.starts_at IS NOT NULL
            AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp()) AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
            AND (($2::uuid IS NULL AND occurrence.id IS NULL) OR (source.id=$2 AND source.enabled AND calendar.disconnected_at IS NULL AND occurrence.status='active'))
            AND (($3::boolean AND i.target_household) OR EXISTS(SELECT 1 FROM integration_item_person_targets reader WHERE reader.item_id=i.id AND reader.person_id=ANY($4::uuid[])))
            AND COALESCE(i.metadata#>>'{calendar,status}','') NOT IN ('cancelled','canceled','declined')
            AND timing.start<$6 AND timing.end>$5
          ORDER BY timing.start,i.id`,[context.householdId,sourceId,grants.household,grants.personIds,start,end])).rows;
        await this.authorize(client,context,'ha.calendar.read');return{events:rows.map(row=>mapEvent(row,context,grants)),serverNow:new Date().toISOString()};
      });
    });
    app.post('/api/v1/ha/calendars/:calendarId/events',async(request,reply)=>{
      const context=await this.authenticate(request);if(ids(request).calendarId!=='samvev')throw new DomainError('FORBIDDEN',403,{reason:'ha_calendar_read_only'});const body=eventCreate.parse(request.body);reply.header('Cache-Control','private, no-store');
      const result=await this.mutation(context,'ha.calendar.write',body,'event.create',async(client,grants)=>{
        if(!grants.household&&!grants.personIds.length)throw new DomainError('FORBIDDEN',403,{reason:'ha_calendar_not_shared'});
        const dates=eventDates(body.start,body.end),metadata={allDay:dates.allDay,haBridge:true,haDescriptionEmpty:!body.description,...(body.location?{location:body.location}:{})};
        const identity=await this.connection(client,context,grants),source={label:identity.name,observedAt:new Date().toISOString(),uncertainty:'low'};
        const row=(await client.query<EventRow>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash,ha_native_origin)
          VALUES($1,$2,$3,'event',$4,$5,$6,'normal',$7,$8,$9,$10,$11,true) RETURNING id,connection_id,title,body,starts_at,ends_at,metadata,revision`,[context.householdId,context.connectionId,`ha:${randomUUID()}`,grants.household,body.summary,body.description||body.summary,dates.startDate,dates.endDate,JSON.stringify(source),JSON.stringify(metadata),payloadHash(body)])).rows[0]!;
        for(const personId of grants.personIds)await client.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[context.householdId,row.id,personId]);
        await this.dependencies.auditIntegration(client,context,'ha.event_created','integration_item',row.id);return{event:mapEvent({...row,target_household:grants.household,person_ids:grants.personIds,status:'active',source_active:true,has_occurrence:false,ha_native_origin:true},context,grants,true)};
      });return reply.status(201).send(result);
    });
    app.patch('/api/v1/ha/calendars/:calendarId/events/:id',async(request,reply)=>{
      const context=await this.authenticate(request);if(ids(request).calendarId!=='samvev')throw new DomainError('FORBIDDEN',403,{reason:'ha_calendar_read_only'});const id=mustUuid(ids(request).id),body=eventUpdate.parse(request.body);reply.header('Cache-Control','private, no-store');
      return this.mutation(context,'ha.calendar.write',body,{action:'event.update',id},async(client,grants)=>{
        const current=await this.writableEvent(client,context,grants,id);
        const before=mapEvent(current,context,grants),dates=eventDates(body.start??before.start,body.end??before.end),metadata:Record<string,unknown>={...current.metadata,allDay:dates.allDay,...(body.description!==undefined?{haDescriptionEmpty:!body.description}:{}),...(body.location!==undefined?{location:body.location}:{})};delete metadata.haDescription;
        const updated=(await client.query<EventRow>(`UPDATE integration_items SET title=COALESCE($4,title),body=CASE WHEN $5::text IS NULL THEN body WHEN $5='' THEN COALESCE($4,title) ELSE $5 END,starts_at=$6,ends_at=$7,metadata=$8,revision=revision+1,updated_at=clock_timestamp(),request_hash=$9
          WHERE id=$1 AND household_id=$2 AND revision=$3 RETURNING id,connection_id,title,body,starts_at,ends_at,metadata,revision`,[id,context.householdId,body.expectedRevision,body.summary??null,body.description??null,dates.startDate,dates.endDate,JSON.stringify(metadata),payloadHash(body)])).rows[0];if(!updated)conflict();
        await this.dependencies.auditIntegration(client,context,'ha.event_edited','integration_item',id);return{event:mapEvent({...current,...updated},context,grants,true)};
      });
    });
    app.delete('/api/v1/ha/calendars/:calendarId/events/:id',async(request,reply)=>{
      const context=await this.authenticate(request);if(ids(request).calendarId!=='samvev')throw new DomainError('FORBIDDEN',403,{reason:'ha_calendar_read_only'});const id=mustUuid(ids(request).id),body=mutationRevision.parse(request.body);reply.header('Cache-Control','private, no-store');
      return this.mutation(context,'ha.calendar.write',body,{action:'event.delete',id},async(client,grants)=>{
        const current=await this.writableEvent(client,context,grants,id);const row=(await client.query<{id:string;revision:number}>(`UPDATE integration_items SET status='withdrawn',withdrawn_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND household_id=$2 AND revision=$3 RETURNING id,revision`,[id,context.householdId,body.expectedRevision])).rows[0];if(!row)conflict();
        await this.dependencies.auditIntegration(client,context,'ha.event_deleted','integration_item',id);return{event:{...row,audience:{household:current.target_household,personIds:current.person_ids}}};
      });
    });
  }
  private async writableEvent(client:DbClient,context:HaIntegrationContext,grants:HaSharing,id:string,includeEnded=false){
    const source=(await client.query<{connection_id:string}>(`SELECT connection_id FROM integration_items WHERE id=$1 AND household_id=$2`,[id,context.householdId])).rows[0];
    if(!source)throw new DomainError('NOT_FOUND',404);
    if(source.connection_id!==context.connectionId&&!grants.allowSharedNativeWrites)throw new DomainError('NOT_FOUND',404);
    // Pin the original source's revocation state as well as the editing actor.
    const active=await client.query(`SELECT id FROM integration_connections WHERE id=$1 AND household_id=$2 AND revoked_at IS NULL FOR SHARE`,[source.connection_id,context.householdId]);
    if(!active.rowCount)throw new DomainError('FORBIDDEN',403);
    const row=(await client.query<EventRow>(`SELECT i.id,i.connection_id,i.title,i.body,i.starts_at,i.ends_at,i.metadata,i.revision,i.target_household,i.status,i.ha_native_origin,true AS source_active,
      COALESCE((SELECT array_agg(target.person_id ORDER BY target.person_id) FROM integration_item_person_targets target WHERE target.item_id=i.id),ARRAY[]::uuid[]) AS person_ids,
      EXISTS(SELECT 1 FROM calendar_occurrences occurrence WHERE occurrence.integration_item_id=i.id) AS has_occurrence
      FROM integration_items i WHERE i.id=$1 AND i.household_id=$2 AND i.kind='event' FOR UPDATE OF i`,[id,context.householdId])).rows[0];
    if(!row)throw new DomainError('NOT_FOUND',404);
    if(!eventWritable(row,context,grants,includeEnded))throw new DomainError('FORBIDDEN',403,{reason:'ha_native_event_not_writable'});
    return row;
  }
}
