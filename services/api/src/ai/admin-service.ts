import {
  aiTaskSchema, type AiModelTier, type AiProviderId, type AiProviderTurn,
  type AiReasoningEffort, type AiResult, type AiTask, type AiToolDefinition,
  type AiToolResult, type MonitorProviderPolicy
} from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import { pool, transaction } from '../db.ts';
import { AiCredentialVault } from './credential-vault.ts';
import { normalizeOpenAiCompatibleBaseUrl, OpenAiCompatibleProvider } from './openai-compatible-provider.ts';
import { OpenAiProvider, type AiHttpTransport } from './openai-provider.ts';
import {
  AiProviderFailure, aiProviderRequirements, validateAiProviderConfiguration,
  type AiFailureCode, type AiProvider
} from './provider.ts';
import { randomUUID } from 'node:crypto';
import { ChatGptSubscriptionProvider } from './chatgpt-provider.ts';
import { ChatGptOAuthService } from './chatgpt-oauth.ts';

interface SettingsRow {
  household_id: string;
  enabled: boolean;
  provider: AiProviderId;
  api_key_ciphertext: string | null;
  base_url: string | null;
  default_model: string;
  strong_model: string;
  default_reasoning_effort: AiReasoningEffort;
  strong_reasoning_effort: AiReasoningEffort;
  revision: number;
  availability_status: 'not_tested' | 'available' | 'unavailable' | 'error';
  availability_error_code: string | null;
  availability_checked_at: Date | null;
  availability_checked_revision: number | null;
  active_chatgpt_registration_id: string | null;
}

export interface AiSettingsPatch {
  enabled?: boolean;
  provider?: AiProviderId;
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string;
  strongModel?: string;
  defaultReasoningEffort?: AiReasoningEffort;
  strongReasoningEffort?: AiReasoningEffort;
  expectedRevision: number;
}

export type AiSessionMode='analysis'|'format_repair';
export interface AiExecutionContext{
  ownerAccountId?:string;ownerMembershipId?:string;taskId?:string;taskRevision?:number;
  executionId?:string;phase?:string;category?:'normal'|'setup'|'test';
  expectedProvider?:AiProviderId;expectedSettingsRevision?:number;expectedRegistrationId?:string;expectedRegistrationGeneration?:number;
}
export interface AiSettingsActor{installationId:string;accountId:string;membershipId:string;}

const providerCatalog = [
  { id: 'openai', runtimeAvailable: true, reasonCode: null },
  { id: 'chatgpt_subscription', runtimeAvailable: true, reasonCode: null },
  { id: 'openai_compatible', runtimeAvailable: true, reasonCode: null },
  { id: 'gemini', runtimeAvailable: false, reasonCode: 'PROVIDER_NOT_IMPLEMENTED_M2_1' }
] as const;

function emptySettings(householdId: string): SettingsRow {
  return {
    household_id: householdId, enabled: false, provider: 'openai', api_key_ciphertext: null, base_url: null,
    default_model: '', strong_model: '', default_reasoning_effort: 'none', strong_reasoning_effort: 'medium',
    revision: 0, availability_status: 'not_tested',
    availability_error_code: null, availability_checked_at: null, availability_checked_revision: null,
    active_chatgpt_registration_id:null
  };
}

function normalizedBaseUrl(value: string): string {
  try { return normalizeOpenAiCompatibleBaseUrl(value); }
  catch (error) {
    if (error instanceof AiProviderFailure) throw new DomainError(error.code, 422);
    throw new DomainError('AI_CONFIGURATION_INVALID', 422);
  }
}

function hasStoredProviderConfiguration(settings: SettingsRow): boolean {
  const requirements = aiProviderRequirements[settings.provider];
  return Boolean(settings.default_model && settings.strong_model &&
    (!requirements.apiKey || settings.api_key_ciphertext) &&
    (!requirements.baseUrl || settings.base_url));
}

export class AiAdminService {
  private readonly providers: Partial<Record<AiProviderId, AiProvider>>;
  private readonly vault: AiCredentialVault;
  readonly chatgpt:ChatGptOAuthService;

  constructor(options: { transport?: AiHttpTransport; keyFile?: string } = {}) {
    this.providers = {
      openai: new OpenAiProvider(options.transport),
      chatgpt_subscription: new ChatGptSubscriptionProvider(options.transport),
      openai_compatible: new OpenAiCompatibleProvider(options.transport)
    };
    this.vault = new AiCredentialVault(options.keyFile);
    this.chatgpt=new ChatGptOAuthService(options.transport,options.keyFile);
  }

  async settings(householdId: string,actor?:{installationId:string;accountId:string;membershipId:string}): Promise<Record<string, unknown>> {
    const settings=this.settingsDto(await this.rawSettings(householdId));
    const saved=await pool.query<{provider:AiProviderId;api_key_ciphertext:string|null;base_url:string|null;default_model:string;strong_model:string;default_reasoning_effort:AiReasoningEffort;strong_reasoning_effort:AiReasoningEffort;revision:number}>('SELECT provider,api_key_ciphertext,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort,revision FROM ai_provider_configurations WHERE household_id=$1 ORDER BY provider',[householdId]);
    const savedProviders=saved.rows.map((row)=>({provider:row.provider,hasApiKey:Boolean(row.api_key_ciphertext),baseUrl:row.base_url,defaultModel:row.default_model,strongModel:row.strong_model,defaultReasoningEffort:row.default_reasoning_effort,strongReasoningEffort:row.strong_reasoning_effort,revision:row.revision}));
    return actor?{...settings,savedProviders,chatgpt:await this.chatgpt.list({householdId,...actor})}:{...settings,savedProviders};
  }

  /** A sanitized queue-time fence. It deliberately contains no endpoint, model or credential. */
  async executionProfile(householdId:string,policy:MonitorProviderPolicy='default',context:AiExecutionContext={}):Promise<{provider:AiProviderId;settingsRevision:number;registrationId?:string;registrationGeneration?:number}> {
    const settings=await this.rawSettings(householdId);
    if((policy==='local'&&settings.provider!=='openai_compatible')||(policy==='openai'&&settings.provider!=='openai'))throw new DomainError('AI_PROVIDER_UNAVAILABLE',422);
    if(!settings.enabled)throw new DomainError('AI_DISABLED',422);
    if(!this.providers[settings.provider])throw new DomainError('AI_PROVIDER_UNAVAILABLE',502);
    if(settings.provider==='chatgpt_subscription'){
      if(!context.ownerAccountId||!context.ownerMembershipId||!settings.active_chatgpt_registration_id)throw new DomainError('MONITOR_OWNER_UNAUTHORIZED',403);
      const token=await this.chatgpt.accessToken({householdId,installationId:'',accountId:context.ownerAccountId,membershipId:context.ownerMembershipId},settings.active_chatgpt_registration_id);
      return{provider:settings.provider,settingsRevision:settings.revision,registrationId:settings.active_chatgpt_registration_id,registrationGeneration:token.generation};
    }
    if(!hasStoredProviderConfiguration(settings))throw new DomainError('AI_CONFIGURATION_INVALID',422);
    return{provider:settings.provider,settingsRevision:settings.revision};
  }

  async updateSettings(householdId: string, patch: AiSettingsPatch,actor?:AiSettingsActor): Promise<Record<string, unknown>> {
    const ciphertext = typeof patch.apiKey === 'string' ? await this.vault.encrypt(householdId, patch.apiKey) : patch.apiKey;
    const updated = await transaction(async (client) => {
      const existing = (await client.query<SettingsRow>('SELECT * FROM ai_settings WHERE household_id=$1 FOR UPDATE', [householdId])).rows[0];
      const requestedProvider=patch.provider??existing?.provider??'openai';
      const planRelevant=requestedProvider==='chatgpt_subscription'||existing?.provider==='chatgpt_subscription';
      const changedFields=Object.keys(patch).filter((key)=>key!=='expectedRevision');
      const emergencyDisable=existing?.provider==='chatgpt_subscription'&&patch.enabled===false&&changedFields.length===1&&changedFields[0]==='enabled';
      if(planRelevant&&!emergencyDisable){
        if(!actor)throw new DomainError('FORBIDDEN',403);
        const registrationId=existing?.active_chatgpt_registration_id;
        const owned=registrationId?await client.query(`SELECT 1 FROM ai_chatgpt_registrations r JOIN memberships m ON m.id=r.owner_membership_id AND m.account_id=r.owner_account_id AND m.household_id=r.household_id AND m.capabilities ? 'household.manage' JOIN accounts a ON a.id=r.owner_account_id AND a.disabled_at IS NULL WHERE r.id=$1 AND r.household_id=$2 AND r.owner_account_id=$3 AND r.owner_membership_id=$4 AND r.status='connected' AND r.credential_ciphertext IS NOT NULL FOR SHARE OF r,m,a`,[registrationId,householdId,actor.accountId,actor.membershipId]):undefined;
        if(!owned?.rowCount)throw new DomainError('FORBIDDEN',403);
      }
      if (!existing) {
        if (patch.expectedRevision !== 0) throw new DomainError('REVISION_CONFLICT', 409);
        const base = emptySettings(householdId);
        const provider = patch.provider ?? base.provider;
        if (provider === 'openai' && typeof patch.apiKey === 'string' && patch.apiKey.length < 20) {
          throw new DomainError('VALIDATION_FAILED', 400);
        }
        const baseUrl = provider === 'openai_compatible' && patch.baseUrl ? normalizedBaseUrl(patch.baseUrl) : null;
        const inserted = await client.query<SettingsRow>(`INSERT INTO ai_settings(
          household_id,enabled,provider,api_key_ciphertext,base_url,default_model,strong_model,
          default_reasoning_effort,strong_reasoning_effort,revision
        ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,1 WHERE EXISTS(SELECT 1 FROM households WHERE id=$1)
        ON CONFLICT DO NOTHING RETURNING *`, [
          householdId, patch.enabled ?? base.enabled, provider,
          ciphertext === undefined ? base.api_key_ciphertext : ciphertext,
          baseUrl, patch.defaultModel ?? base.default_model, patch.strongModel ?? base.strong_model,
          patch.defaultReasoningEffort ?? base.default_reasoning_effort,
          patch.strongReasoningEffort ?? base.strong_reasoning_effort
        ]);
        if (!inserted.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
        if(provider!=='chatgpt_subscription')await client.query(`INSERT INTO ai_provider_configurations(household_id,provider,api_key_ciphertext,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(household_id,provider) DO UPDATE SET api_key_ciphertext=EXCLUDED.api_key_ciphertext,base_url=EXCLUDED.base_url,default_model=EXCLUDED.default_model,strong_model=EXCLUDED.strong_model,default_reasoning_effort=EXCLUDED.default_reasoning_effort,strong_reasoning_effort=EXCLUDED.strong_reasoning_effort,revision=ai_provider_configurations.revision+1,updated_at=clock_timestamp()`,[householdId,provider,inserted.rows[0]!.api_key_ciphertext,inserted.rows[0]!.base_url,inserted.rows[0]!.default_model,inserted.rows[0]!.strong_model,inserted.rows[0]!.default_reasoning_effort,inserted.rows[0]!.strong_reasoning_effort]);
        return inserted.rows[0]!;
      }
      if (existing.revision !== patch.expectedRevision) throw new DomainError('REVISION_CONFLICT', 409);
      const provider = patch.provider ?? existing.provider;
      if (provider === 'openai' && typeof patch.apiKey === 'string' && patch.apiKey.length < 20) {
        throw new DomainError('VALIDATION_FAILED', 400);
      }
      const saved=(await client.query<SettingsRow>(`SELECT $1::uuid AS household_id,false AS enabled,provider,api_key_ciphertext,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort,revision,'not_tested'::text AS availability_status,NULL::text AS availability_error_code,NULL::timestamptz AS availability_checked_at,NULL::int AS availability_checked_revision,NULL::uuid AS active_chatgpt_registration_id FROM ai_provider_configurations WHERE household_id=$1 AND provider=$2`,[householdId,provider])).rows[0];
      const providerBase=provider===existing.provider?existing:saved??{...emptySettings(householdId),provider};
      const baseUrlValue = patch.baseUrl === undefined ? providerBase.base_url : patch.baseUrl;
      const baseUrl = provider === 'openai_compatible' && baseUrlValue ? normalizedBaseUrl(baseUrlValue) : null;
      const credentialIdentityChanged = provider === 'openai_compatible' && baseUrl !== providerBase.base_url;
      const nextCiphertext = ciphertext === undefined
        ? credentialIdentityChanged ? null : providerBase.api_key_ciphertext
        : ciphertext;
      const defaultModel=patch.defaultModel ?? providerBase.default_model;
      const strongModel=patch.strongModel ?? providerBase.strong_model;
      const defaultReasoning=patch.defaultReasoningEffort ?? providerBase.default_reasoning_effort;
      const strongReasoning=patch.strongReasoningEffort ?? providerBase.strong_reasoning_effort;
      if(provider!=='chatgpt_subscription')await client.query(`INSERT INTO ai_provider_configurations(household_id,provider,api_key_ciphertext,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(household_id,provider) DO UPDATE SET api_key_ciphertext=EXCLUDED.api_key_ciphertext,base_url=EXCLUDED.base_url,default_model=EXCLUDED.default_model,strong_model=EXCLUDED.strong_model,default_reasoning_effort=EXCLUDED.default_reasoning_effort,strong_reasoning_effort=EXCLUDED.strong_reasoning_effort,revision=ai_provider_configurations.revision+1,updated_at=clock_timestamp()`,[householdId,provider,nextCiphertext,baseUrl,defaultModel,strongModel,defaultReasoning,strongReasoning]);
      const result = await client.query<SettingsRow>(`UPDATE ai_settings SET
        enabled=$2,provider=$3,api_key_ciphertext=$4,base_url=$5,default_model=$6,strong_model=$7,
        default_reasoning_effort=$8,strong_reasoning_effort=$9,
        revision=revision+1,availability_status='not_tested',availability_error_code=NULL,
        availability_checked_at=NULL,availability_checked_revision=NULL,updated_at=clock_timestamp()
        WHERE household_id=$1 AND revision=$10 RETURNING *`, [
          householdId, patch.enabled ?? existing.enabled, provider, nextCiphertext, baseUrl,
          defaultModel,strongModel,defaultReasoning,strongReasoning,
          patch.expectedRevision
        ]);
      if (!result.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
      return result.rows[0]!;
    });
    return this.settingsDto(updated);
  }

  async testConnection(householdId: string, tier: AiModelTier,context:AiExecutionContext={}): Promise<Record<string, unknown>> {
    const settings = await this.rawSettings(householdId);
    const task: AiTask = { operation: 'generate', purpose: 'connection_test', input: 'Reply with the single word OK.', modelTier: tier, sources: [] };
    const outcome = await this.run(householdId, settings, task, false, true,context);
    const failureCode = outcome.success ? null : outcome.failure.code;
    if(settings.active_chatgpt_registration_id&&failureCode&&['AI_PLAN_USAGE_LIMITED','AI_PLAN_NOT_ELIGIBLE','AI_PLAN_PERMISSION_REQUIRED','AI_REAUTHORIZATION_REQUIRED'].includes(failureCode))await this.chatgpt.markTerminalFailure(householdId,settings.active_chatgpt_registration_id,failureCode as 'AI_PLAN_USAGE_LIMITED'|'AI_PLAN_NOT_ELIGIBLE'|'AI_PLAN_PERMISSION_REQUIRED'|'AI_REAUTHORIZATION_REQUIRED',outcome.success?undefined:outcome.failure.responseReason);
    const availabilityStatus = outcome.success ? 'available' : failureCode === 'AI_PROVIDER_UNAVAILABLE' ? 'unavailable' : 'error';
    await pool.query(`UPDATE ai_settings SET availability_status=$3,availability_error_code=$4,
      availability_checked_at=clock_timestamp(),availability_checked_revision=$2,updated_at=clock_timestamp()
      WHERE household_id=$1 AND revision=$2`, [householdId, settings.revision, availabilityStatus, failureCode]);
    return {
      available: outcome.success, provider: settings.provider, modelTier: tier,
      checkedAt: new Date().toISOString(), ...(failureCode ? { errorCode: failureCode } : {})
    };
  }

  /** Server-internal execution boundary. Authorization remains the caller's responsibility. */
  async executeTask(householdId: string, rawTask: AiTask, policy: MonitorProviderPolicy = 'default',context:AiExecutionContext={}): Promise<AiResult> {
    return (await this.executeTaskWithContext(householdId, rawTask, policy,context)).result;
  }

  async executeTaskWithContext(householdId: string, rawTask: AiTask, policy: MonitorProviderPolicy = 'default',context:AiExecutionContext={}): Promise<{result:AiResult;provider:AiProviderId;model:string}> {
    const task = aiTaskSchema.parse(rawTask);
    const session=await this.createTaskSession(householdId,task,policy,[],undefined,'analysis',context);
    try{const turn=await session.next();if(!turn.output)throw new DomainError('AI_RESPONSE_INVALID',502);return {result:{output:turn.output,generatedAt:turn.generatedAt,uncertainty:'unknown',sources:task.sources,...(turn.actualModel?{actualModel:turn.actualModel}:{}),...(turn.actualServiceTier?{actualServiceTier:turn.actualServiceTier}:{}),...(turn.usage?{usage:turn.usage}:{})},provider:session.provider,model:session.model};}
    finally{session.close();}
  }

  /** Resolve/decrypt provider configuration once, then keep protocol state request-local. */
  async createTaskSession(
    householdId:string,rawTask:AiTask,policy:MonitorProviderPolicy='default',
    tools:AiToolDefinition[]=[],signal?:AbortSignal,mode:AiSessionMode='analysis',context:AiExecutionContext={}
  ):Promise<{provider:AiProviderId;model:string;next:(results?:AiToolResult[],toolChoice?:'auto'|'required')=>Promise<AiProviderTurn>;close:()=>void}>{
    const task=aiTaskSchema.parse(rawTask);const settings=await this.rawSettings(householdId);
    this.requireExpectedProfile(settings,context);
    if((policy==='local'&&settings.provider!=='openai_compatible')||(policy==='openai'&&settings.provider!=='openai'))throw new DomainError('AI_PROVIDER_UNAVAILABLE',422);
    const model=task.modelTier==='strong'?settings.strong_model:settings.default_model;
    if(!settings.enabled){await this.recordPreflight(householdId,settings.provider,model,task,'AI_DISABLED',context);throw new DomainError('AI_DISABLED',422);}
    const provider=this.providers[settings.provider];if(!provider)throw new DomainError('AI_PROVIDER_UNAVAILABLE',502);
    let apiKey:string|undefined;const registrationId=settings.active_chatgpt_registration_id??undefined;let registrationGeneration:number|undefined;
    if(settings.provider==='chatgpt_subscription'){
      if(!context.ownerAccountId||!context.ownerMembershipId||!settings.active_chatgpt_registration_id)throw new DomainError('MONITOR_OWNER_UNAUTHORIZED',403);
      const access=await this.chatgpt.accessToken({householdId,installationId:'',accountId:context.ownerAccountId,membershipId:context.ownerMembershipId},settings.active_chatgpt_registration_id);apiKey=access.token;registrationGeneration=access.generation;
    }else if(settings.api_key_ciphertext){try{apiKey=await this.vault.decrypt(householdId,settings.api_key_ciphertext);}catch{throw new DomainError('AI_CONFIGURATION_INVALID',422);}}
    // A bounded format-only repair has already received server-verified evidence
    // and performs no semantic planning or tool selection. Minimal reasoning
    // preserves the chosen model/policy while reserving output tokens for the
    // required JSON instead of an unobservable reasoning trace.
    const configuredReasoning=task.modelTier==='strong'?settings.strong_reasoning_effort:settings.default_reasoning_effort;
    let pendingAttemptId:string|undefined;let authorized=false;let wireStarted=false;let turn=0;
    const configuration={provider:settings.provider,model,apiKey,baseUrl:settings.base_url??undefined,reasoningEffort:settings.provider==='chatgpt_subscription'?(mode==='format_repair'?'low':configuredReasoning==='none'?'low':configuredReasoning):mode==='format_repair'?'none':configuredReasoning,beforeDispatch:async()=>{
      if(authorized||wireStarted||!pendingAttemptId)throw new AiProviderFailure('AI_RESPONSE_INVALID');
      if(settings.provider==='chatgpt_subscription'&&registrationId){
        const access=await this.chatgpt.accessToken({householdId,installationId:'',accountId:context.ownerAccountId!,membershipId:context.ownerMembershipId!},registrationId);if(access.generation!==registrationGeneration)throw new AiProviderFailure('AI_REAUTHORIZATION_REQUIRED');configuration.apiKey=access.token;
      }
      await this.authorizeAndCreateAttempt(pendingAttemptId,householdId,settings,model,task,turn,context,true,registrationId,registrationGeneration);authorized=true;
    },onWireStart:()=>{if(!authorized||wireStarted||!pendingAttemptId)throw new AiProviderFailure('AI_RESPONSE_INVALID');wireStarted=true;}};
    try{validateAiProviderConfiguration(configuration);}catch(error){throw new DomainError(error instanceof AiProviderFailure?error.code:'AI_CONFIGURATION_INVALID',422);}
    const wire=provider.createSession(task,configuration,tools,signal);
    return {provider:settings.provider,model,close:()=>wire.close(),next:async(results=[],toolChoice='auto')=>{
      const attemptId=randomUUID();turn++;pendingAttemptId=attemptId;authorized=false;wireStarted=false;
      try{const result=await wire.next(results,toolChoice);await this.finishAttempt(attemptId,true,null,result.usage,result.actualModel,result.actualServiceTier);return result;}
      catch(error){const failure=error instanceof AiProviderFailure?error:error instanceof DomainError?new AiProviderFailure(error.code as AiFailureCode):new AiProviderFailure('AI_UPSTREAM_ERROR');if(wireStarted)await this.finishAttempt(attemptId,false,failure.code,failure.usage,failure.actualModel,failure.actualServiceTier);else if(authorized)await this.rejectAuthorizedAttempt(attemptId,failure.code);else await this.recordPreflight(householdId,settings.provider,model,task,failure.code,context,attemptId,registrationId);if(registrationId&&['AI_PLAN_USAGE_LIMITED','AI_PLAN_NOT_ELIGIBLE','AI_PLAN_PERMISSION_REQUIRED','AI_REAUTHORIZATION_REQUIRED'].includes(failure.code))await this.chatgpt.markTerminalFailure(householdId,registrationId,failure.code as 'AI_PLAN_USAGE_LIMITED'|'AI_PLAN_NOT_ELIGIBLE'|'AI_PLAN_PERMISSION_REQUIRED'|'AI_REAUTHORIZATION_REQUIRED',failure.responseReason);const status=['AI_CONFIGURATION_INVALID','AI_DISABLED','AI_REAUTHORIZATION_REQUIRED','AI_PLAN_PERMISSION_REQUIRED','AI_PLAN_USAGE_LIMITED','AI_PLAN_NOT_ELIGIBLE'].includes(failure.code)?422:failure.code==='AI_TIMEOUT'?504:502;throw new DomainError(failure.code,status,failure.responseReason?{providerResponseReason:failure.responseReason}:undefined);}
      finally{pendingAttemptId=undefined;}
    }};
  }

  async usage(householdId: string,days=30,ownerAccountId?:string): Promise<Record<string, unknown>> {
    if(days!==7&&days!==30)throw new DomainError('VALIDATION_FAILED',400);
    const priced=`u.input_tokens IS NOT NULL AND u.output_tokens IS NOT NULL
      AND (u.cached_input_tokens IS NOT NULL OR r.cached_input_rate=r.input_rate)
      AND (u.cache_write_tokens IS NOT NULL OR r.cache_write_rate=r.input_rate)
      AND COALESCE(u.cached_input_tokens,0)+COALESCE(u.cache_write_tokens,0)<=u.input_tokens`;
    const amount=`(u.input_tokens*r.input_rate
      +COALESCE(u.cached_input_tokens,0)*(r.cached_input_rate-r.input_rate)
      +COALESCE(u.cache_write_tokens,0)*(r.cache_write_rate-r.input_rate)
      +u.output_tokens*r.output_rate)/1000000`;
    const owner=[householdId,days,ownerAccountId??null];
    const normal=`COALESCE(u.category,CASE WHEN u.purpose='connection_test' THEN 'test' ELSE 'normal' END)='normal'`;
    const [summary,recent,byDay,byModel,byPurpose,planCost,apiCost,coverage,planForecast,apiForecast]=await Promise.all([
      pool.query<{requests:number;successes:number;failures:number;preflight_rejections:number;pending_attempts:number;legacy_unknown:number;input_tokens:string;output_tokens:string;unknown_usage:number}>(`SELECT count(*) FILTER(WHERE actual_dispatch)::int requests,count(*) FILTER(WHERE actual_dispatch AND outcome='completed')::int successes,count(*) FILTER(WHERE actual_dispatch AND outcome IN ('failed','interrupted'))::int failures,count(*) FILTER(WHERE actual_dispatch=false AND outcome='preflight_rejected')::int preflight_rejections,count(*) FILTER(WHERE actual_dispatch IS NULL AND outcome='started')::int pending_attempts,count(*) FILTER(WHERE actual_dispatch IS NULL AND outcome IS NULL)::int legacy_unknown,LEAST(COALESCE(sum(input_tokens),0),9007199254740991)::bigint input_tokens,LEAST(COALESCE(sum(output_tokens),0),9007199254740991)::bigint output_tokens,count(*) FILTER(WHERE actual_dispatch AND (input_tokens IS NULL OR output_tokens IS NULL))::int unknown_usage FROM ai_usage_events WHERE household_id=$1 AND ($3::uuid IS NULL OR owner_account_id=$3) AND occurred_at>=CURRENT_DATE-($2::int-1)*interval '1 day'`,owner),
      pool.query<{provider:AiProviderId;route:string|null;requested_model:string|null;actual_model:string|null;actual_service_tier:string|null;purpose:string;category:string|null;success:boolean;failure_code:string|null;actual_dispatch:boolean|null;outcome:string|null;input_tokens:number|null;output_tokens:number|null;occurred_at:Date}>(`SELECT provider,route,requested_model,actual_model,actual_service_tier,purpose,category,success,failure_code,actual_dispatch,outcome,input_tokens,output_tokens,occurred_at FROM ai_usage_events WHERE household_id=$1 AND ($3::uuid IS NULL OR owner_account_id=$3) AND occurred_at>=CURRENT_DATE-($2::int-1)*interval '1 day' ORDER BY occurred_at DESC,id DESC LIMIT 20`,owner),
      pool.query<{day:string;calls:number;input_tokens:string;output_tokens:string;unknown_usage:number}>(`SELECT d::date::text AS "day",count(u.id) FILTER(WHERE u.actual_dispatch)::int calls,COALESCE(sum(u.input_tokens),0)::bigint input_tokens,COALESCE(sum(u.output_tokens),0)::bigint output_tokens,count(u.id) FILTER(WHERE u.actual_dispatch AND (u.input_tokens IS NULL OR u.output_tokens IS NULL))::int unknown_usage FROM generate_series(CURRENT_DATE-($2::int-1)*interval '1 day',CURRENT_DATE,interval '1 day') d LEFT JOIN ai_usage_events u ON u.household_id=$1 AND ($3::uuid IS NULL OR u.owner_account_id=$3) AND u.occurred_at>=d AND u.occurred_at<d+interval '1 day' GROUP BY d ORDER BY d`,owner),
      pool.query<{model:string;route:string;calls:number;input_tokens:string;output_tokens:string}>(`SELECT COALESCE(actual_model,'unreported') model,COALESCE(route,'unknown') route,count(*) FILTER(WHERE actual_dispatch)::int calls,COALESCE(sum(input_tokens),0)::bigint input_tokens,COALESCE(sum(output_tokens),0)::bigint output_tokens FROM ai_usage_events WHERE household_id=$1 AND ($3::uuid IS NULL OR owner_account_id=$3) AND occurred_at>=CURRENT_DATE-($2::int-1)*interval '1 day' GROUP BY actual_model,route ORDER BY calls DESC,model`,owner),
      pool.query<{purpose:string;category:string;calls:number;input_tokens:string;output_tokens:string}>(`SELECT purpose,COALESCE(category,CASE WHEN purpose='connection_test' THEN 'test' ELSE 'normal' END) category,count(*) FILTER(WHERE actual_dispatch)::int calls,COALESCE(sum(input_tokens),0)::bigint input_tokens,COALESCE(sum(output_tokens),0)::bigint output_tokens FROM ai_usage_events WHERE household_id=$1 AND ($3::uuid IS NULL OR owner_account_id=$3) AND occurred_at>=CURRENT_DATE-($2::int-1)*interval '1 day' GROUP BY purpose,category ORDER BY calls DESC,purpose`,owner),
      pool.query<{amount:string;known_calls:number;total_calls:number;source_url:string|null;effective_from:string|null;observed_at:Date|null}>(`SELECT round(COALESCE(sum(${amount}) FILTER(WHERE ${priced}),0),8)::text amount,count(*) FILTER(WHERE ${priced})::int known_calls,count(*)::int total_calls,max(r.source_url) FILTER(WHERE ${priced}) source_url,max(r.effective_from)::text effective_from,max(r.observed_at) FILTER(WHERE ${priced}) observed_at FROM ai_usage_events u LEFT JOIN ai_rate_snapshots r ON r.id=u.rate_snapshot_id AND r.route='chatgpt_plan' WHERE u.household_id=$1 AND ($3::uuid IS NULL OR u.owner_account_id=$3) AND u.occurred_at>=CURRENT_DATE-($2::int-1)*interval '1 day' AND u.route='chatgpt_plan' AND u.actual_dispatch AND ${normal}`,owner),
      pool.query<{amount:string;known_calls:number;total_calls:number;source_url:string|null;effective_from:string|null;observed_at:Date|null}>(`SELECT round(COALESCE(sum(${amount}) FILTER(WHERE ${priced}),0),8)::text amount,count(*) FILTER(WHERE ${priced})::int known_calls,count(*)::int total_calls,max(r.source_url) FILTER(WHERE ${priced}) source_url,max(r.effective_from)::text effective_from,max(r.observed_at) FILTER(WHERE ${priced}) observed_at FROM ai_usage_events u LEFT JOIN ai_rate_snapshots r ON r.id=CASE WHEN u.route='chatgpt_plan' THEN u.api_equivalent_rate_snapshot_id WHEN u.route='openai_api' THEN u.rate_snapshot_id END AND r.route='openai_api' WHERE u.household_id=$1 AND ($3::uuid IS NULL OR u.owner_account_id=$3) AND u.occurred_at>=CURRENT_DATE-($2::int-1)*interval '1 day' AND u.route IN ('chatgpt_plan','openai_api') AND u.actual_dispatch AND ${normal}`,owner),
      pool.query<{tracking_started_at:Date|null;normal_days:number}>(`SELECT s.usage_tracking_started_at tracking_started_at,count(DISTINCT u.occurred_at::date)::int normal_days FROM ai_settings s LEFT JOIN ai_usage_events u ON u.household_id=s.household_id AND ($2::uuid IS NULL OR u.owner_account_id=$2) AND u.actual_dispatch AND ${normal} WHERE s.household_id=$1 GROUP BY s.usage_tracking_started_at`,[householdId,ownerAccountId??null]),
      pool.query<{amount:string;known_calls:number;total_calls:number}>(`SELECT round(COALESCE(sum(${amount}) FILTER(WHERE ${priced}),0)*30/7,8)::text amount,count(*) FILTER(WHERE ${priced})::int known_calls,count(*)::int total_calls FROM ai_usage_events u LEFT JOIN ai_rate_snapshots r ON r.id=u.rate_snapshot_id AND r.route='chatgpt_plan' WHERE u.household_id=$1 AND ($2::uuid IS NULL OR u.owner_account_id=$2) AND u.route='chatgpt_plan' AND u.actual_dispatch AND ${normal} AND u.occurred_at>=CURRENT_DATE-interval '7 days' AND u.occurred_at<CURRENT_DATE`,[householdId,ownerAccountId??null]),
      pool.query<{amount:string;known_calls:number;total_calls:number}>(`SELECT round(COALESCE(sum(${amount}) FILTER(WHERE ${priced}),0)*30/7,8)::text amount,count(*) FILTER(WHERE ${priced})::int known_calls,count(*)::int total_calls FROM ai_usage_events u LEFT JOIN ai_rate_snapshots r ON r.id=CASE WHEN u.route='chatgpt_plan' THEN u.api_equivalent_rate_snapshot_id WHEN u.route='openai_api' THEN u.rate_snapshot_id END AND r.route='openai_api' WHERE u.household_id=$1 AND ($2::uuid IS NULL OR u.owner_account_id=$2) AND u.route IN ('chatgpt_plan','openai_api') AND u.actual_dispatch AND ${normal} AND u.occurred_at>=CURRENT_DATE-interval '7 days' AND u.occurred_at<CURRENT_DATE`,[householdId,ownerAccountId??null])
    ]);
    const total=summary.rows[0]??{requests:0,successes:0,failures:0,preflight_rejections:0,pending_attempts:0,legacy_unknown:0,input_tokens:'0',output_tokens:'0',unknown_usage:0};
    const tracking=coverage.rows[0]?.tracking_started_at;const completeThrough=new Date();completeThrough.setUTCDate(completeThrough.getUTCDate()-1);const completeFrom=new Date(completeThrough);completeFrom.setUTCDate(completeFrom.getUTCDate()-6);const sevenDayTracking=Boolean(tracking&&tracking.getTime()<=Date.UTC(completeFrom.getUTCFullYear(),completeFrom.getUTCMonth(),completeFrom.getUTCDate()));
    const forecast=(row:{amount:string;known_calls:number;total_calls:number}|undefined,kind:'credits'|'usd')=>{const complete=sevenDayTracking?7:0;if(!sevenDayTracking)return{status:'preliminary' as const,reason:'partial_calendar_history',completeCalendarDays:complete,from:completeFrom.toISOString().slice(0,10),to:completeThrough.toISOString().slice(0,10),totalCalls:row?.total_calls??0,knownCalls:row?.known_calls??0,monthlyAmount:null,unit:kind==='credits'?'credits':'USD'};if(!(row?.total_calls??0))return{status:'preliminary' as const,reason:'insufficient_history',completeCalendarDays:7,from:completeFrom.toISOString().slice(0,10),to:completeThrough.toISOString().slice(0,10),totalCalls:0,knownCalls:0,monthlyAmount:null,unit:kind==='credits'?'credits':'USD'};if(row!.known_calls!==row!.total_calls)return{status:'preliminary' as const,reason:'unknown_pricing',completeCalendarDays:7,from:completeFrom.toISOString().slice(0,10),to:completeThrough.toISOString().slice(0,10),totalCalls:row!.total_calls,knownCalls:row!.known_calls,monthlyAmount:null,unit:kind==='credits'?'credits':'USD'};return{status:'available' as const,reason:null,completeCalendarDays:7,from:completeFrom.toISOString().slice(0,10),to:completeThrough.toISOString().slice(0,10),totalCalls:row!.total_calls,knownCalls:row!.known_calls,normalCalls30Days:((row!.total_calls/7)*30).toFixed(2),monthlyAmount:row!.amount,unit:kind==='credits'?'credits':'USD'};};
    const plan=planCost.rows[0],api=apiCost.rows[0];
    return{period:{days,from:byDay.rows[0]?.day??null,to:byDay.rows.at(-1)?.day??null},summary:{requests:total.requests,successes:total.successes,failures:total.failures,inputTokens:Number(total.input_tokens),outputTokens:Number(total.output_tokens),unknownUsageCount:total.unknown_usage,preflightRejections:total.preflight_rejections,pendingAttempts:total.pending_attempts,legacyUnknownAttempts:total.legacy_unknown},byDay:byDay.rows.map(row=>({date:row.day,calls:row.calls,inputTokens:Number(row.input_tokens),outputTokens:Number(row.output_tokens),unknownUsageCount:row.unknown_usage})),byModel:byModel.rows.map(row=>({model:row.model,route:row.route,calls:row.calls,inputTokens:Number(row.input_tokens),outputTokens:Number(row.output_tokens)})),byPurpose:byPurpose.rows.map(row=>({purpose:row.purpose,category:row.category,calls:row.calls,inputTokens:Number(row.input_tokens),outputTokens:Number(row.output_tokens)})),forecast:{chatGptCredits:forecast(planForecast.rows[0],'credits'),apiUsd:forecast(apiForecast.rows[0],'usd'),calendarDaysIncludeZeroUse:true,setupAndTestsExcluded:true},chatGptCredits:{status:(plan?.known_calls??0)>0?'estimated_recorded_usage':'unavailable',estimatedCredits:(plan?.known_calls??0)>0?plan!.amount:null,knownCalls:plan?.known_calls??0,unknownPricedAttempts:Math.max(0,(plan?.total_calls??0)-(plan?.known_calls??0)),usageUrl:'https://chatgpt.com/settings/usage',balance:null,pricePerCredit:null,sourceUrl:plan?.source_url??'https://learn.chatgpt.com/docs/pricing',effectiveFrom:plan?.effective_from??null,observedAt:plan?.observed_at?.toISOString()??null,note:'Recorded normal Samvev ChatGPT-plan usage estimate only; setup/tests, included-plan coverage, other apps, remaining balance and USD per credit are unknown.'},apiEquivalent:{currency:'USD',amount:(api?.known_calls??0)>0?api!.amount:null,status:(api?.known_calls??0)>0?'partial':'unavailable',knownCalls:api?.known_calls??0,unknownPricedAttempts:Math.max(0,(api?.total_calls??0)-(api?.known_calls??0)),scenarioOnly:true,assumption:'Pinned Standard-tier, no-region API comparison for ChatGPT-plan attempts; direct API attempts use their reported tier and pinned rate.',sourceUrl:api?.source_url??'https://developers.openai.com/api/docs/pricing',effectiveFrom:api?.effective_from??null,observedAt:api?.observed_at?.toISOString()??null,note:'Known normal-use events with immutable matching rate snapshots only; setup/tests and local models are excluded.'},recent:recent.rows.map(row=>({provider:row.provider,route:row.route,model:row.actual_model,actualModel:row.actual_model,requestedModel:row.requested_model,actualServiceTier:row.actual_service_tier,purpose:row.purpose,category:row.category,success:row.success,actualDispatch:row.actual_dispatch,outcome:row.outcome??(row.actual_dispatch===null?'legacy_unknown':row.success?'completed':'failed'),errorCode:row.failure_code,inputTokens:row.input_tokens,outputTokens:row.output_tokens,occurredAt:row.occurred_at.toISOString()}))};
  }

  private async rawSettings(householdId: string): Promise<SettingsRow> {
    const settings=(await pool.query<SettingsRow>('SELECT * FROM ai_settings WHERE household_id=$1',[householdId])).rows[0];if(!settings)return emptySettings(householdId);
    if(settings.provider==='chatgpt_subscription')return settings;
    const saved=(await pool.query<Pick<SettingsRow,'api_key_ciphertext'|'base_url'|'default_model'|'strong_model'|'default_reasoning_effort'|'strong_reasoning_effort'>>('SELECT api_key_ciphertext,base_url,default_model,strong_model,default_reasoning_effort,strong_reasoning_effort FROM ai_provider_configurations WHERE household_id=$1 AND provider=$2',[householdId,settings.provider])).rows[0];return saved?{...settings,...saved}:settings;
  }

  private requireExpectedProfile(settings:SettingsRow,context:AiExecutionContext):void{
    if(context.expectedProvider!==undefined&&settings.provider!==context.expectedProvider)throw new DomainError('AI_CONFIGURATION_INVALID',422);
    if(context.expectedSettingsRevision!==undefined&&settings.revision!==context.expectedSettingsRevision)throw new DomainError('AI_CONFIGURATION_INVALID',422);
    if(context.expectedRegistrationId!==undefined&&settings.active_chatgpt_registration_id!==context.expectedRegistrationId)throw new DomainError('AI_CONFIGURATION_INVALID',422);
  }

  private async authorizeAndCreateAttempt(attemptId:string,householdId:string,settings:SettingsRow,model:string,task:AiTask,turn:number,context:AiExecutionContext,requireEnabled:boolean,registrationId?:string,registrationGeneration?:number):Promise<void>{
    await transaction(async(client)=>{
      if(context.taskId){
        const row=(await client.query<{revision:number;approved_revision:number|null;approved_ai_provider:AiProviderId|null;approved_ai_registration_id:string|null;approved_ai_registration_generation:number|null}>(`SELECT revision,approved_revision,approved_ai_provider,approved_ai_registration_id,approved_ai_registration_generation FROM monitor_tasks WHERE id=$1 AND household_id=$2 FOR SHARE`,[context.taskId,householdId])).rows[0];
        if(!row||row.revision!==context.taskRevision)throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
        if(context.category==='normal'&&(row.approved_revision!==row.revision||(settings.provider==='chatgpt_subscription'&&(row.approved_ai_provider!=='chatgpt_subscription'||row.approved_ai_registration_id!==registrationId||row.approved_ai_registration_generation!==registrationGeneration))))throw new AiProviderFailure(settings.provider==='chatgpt_subscription'?'AI_REAUTHORIZATION_REQUIRED':'AI_CONFIGURATION_INVALID');
      }
      const current=(await client.query<{enabled:boolean;provider:AiProviderId;revision:number;active_chatgpt_registration_id:string|null}>('SELECT enabled,provider,revision,active_chatgpt_registration_id FROM ai_settings WHERE household_id=$1 FOR SHARE',[householdId])).rows[0];
      if(!current||current.provider!==settings.provider||current.revision!==settings.revision||(requireEnabled&&!current.enabled)||(settings.provider==='chatgpt_subscription'&&current.active_chatgpt_registration_id!==registrationId))throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
      if(context.expectedProvider!==undefined&&current.provider!==context.expectedProvider||context.expectedSettingsRevision!==undefined&&current.revision!==context.expectedSettingsRevision)throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
      if(context.ownerAccountId||context.ownerMembershipId){if(!context.ownerAccountId||!context.ownerMembershipId||!(await client.query(`SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id AND a.disabled_at IS NULL WHERE m.id=$1 AND m.account_id=$2 AND m.household_id=$3 AND m.capabilities ? 'household.manage' FOR SHARE OF m,a`,[context.ownerMembershipId,context.ownerAccountId,householdId])).rowCount)throw new AiProviderFailure('AI_REAUTHORIZATION_REQUIRED');}
      if(settings.provider==='chatgpt_subscription'){
        if(!context.ownerAccountId||!context.ownerMembershipId||!registrationId||registrationGeneration===undefined)throw new AiProviderFailure('AI_REAUTHORIZATION_REQUIRED');
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[registrationId]);
        const connected=await client.query(`SELECT 1 FROM ai_chatgpt_registrations r JOIN memberships m ON m.id=r.owner_membership_id AND m.account_id=r.owner_account_id AND m.household_id=r.household_id AND m.capabilities ? 'household.manage' JOIN accounts a ON a.id=r.owner_account_id AND a.disabled_at IS NULL WHERE r.id=$1 AND r.household_id=$2 AND r.owner_account_id=$3 AND r.owner_membership_id=$4 AND r.generation=$5 AND r.status='connected' AND r.credential_ciphertext IS NOT NULL FOR SHARE OF r,m,a`,[registrationId,householdId,context.ownerAccountId,context.ownerMembershipId,registrationGeneration]);
        if(!connected.rowCount||context.expectedRegistrationId!==undefined&&context.expectedRegistrationId!==registrationId||context.expectedRegistrationGeneration!==undefined&&context.expectedRegistrationGeneration!==registrationGeneration)throw new AiProviderFailure('AI_REAUTHORIZATION_REQUIRED');
      }
      await client.query(`INSERT INTO ai_usage_events(household_id,provider,model,requested_model,operation,purpose,success,failure_code,attempt_id,route,category,task_id,task_revision,execution_id,turn,phase,actual_dispatch,outcome,owner_account_id,registration_id) VALUES($1,$2,NULLIF($3,''),NULLIF($3,''),$4,$5,false,NULL,$6,$7,$8,$9,$10,$11,$12,$13,NULL,'started',$14,$15) ON CONFLICT DO NOTHING`,[householdId,settings.provider,model,task.operation,task.purpose,attemptId,this.route(settings.provider),context.category??(task.purpose==='connection_test'?'test':'normal'),context.taskId??null,context.taskRevision??null,context.executionId??null,turn,context.phase??null,context.ownerAccountId??null,registrationId??null]);
    });
  }

  private async run(
    householdId: string,
    settings: SettingsRow,
    task: AiTask,
    requireEnabled: boolean,
    connectionTest: boolean,
    context:AiExecutionContext={}
  ): Promise<{ success: true; result: AiResult } | { success: false; failure: AiProviderFailure }> {
    const model = task.modelTier === 'strong' ? settings.strong_model : settings.default_model;
    let outcome: { success: true; result: AiResult } | { success: false; failure: AiProviderFailure };const attemptId=randomUUID();let authorized=false;let wireStarted=false;let registrationId:string|undefined;let registrationGeneration:number|undefined;
    try {
      if (requireEnabled && !settings.enabled) throw new AiProviderFailure('AI_DISABLED');
      const provider = this.providers[settings.provider];
      if (!provider) throw new AiProviderFailure('AI_PROVIDER_UNAVAILABLE');
      let apiKey: string | undefined;
      if(settings.provider==='chatgpt_subscription'){
        if(!context.ownerAccountId||!context.ownerMembershipId||!settings.active_chatgpt_registration_id)throw new AiProviderFailure('AI_REAUTHORIZATION_REQUIRED');
        registrationId=settings.active_chatgpt_registration_id;const access=await this.chatgpt.accessToken({householdId,installationId:'',accountId:context.ownerAccountId,membershipId:context.ownerMembershipId},registrationId);apiKey=access.token;registrationGeneration=access.generation;
      }else if (settings.api_key_ciphertext) {
        try { apiKey = await this.vault.decrypt(householdId, settings.api_key_ciphertext); }
        catch { throw new AiProviderFailure('AI_CONFIGURATION_INVALID'); }
      }
      const reasoningEffort = settings.provider==='chatgpt_subscription'?'low':connectionTest ? 'none' : task.modelTier === 'strong' ? settings.strong_reasoning_effort : settings.default_reasoning_effort;
      this.requireExpectedProfile(settings,context);
      const attemptContext={...context,category:context.category??(connectionTest?'test':'normal') as 'normal'|'setup'|'test'};
      const configuration = { provider: settings.provider, model, apiKey, baseUrl: settings.base_url ?? undefined, reasoningEffort,beforeDispatch:async()=>{await this.authorizeAndCreateAttempt(attemptId,householdId,settings,model,task,1,attemptContext,requireEnabled,registrationId,registrationGeneration);authorized=true;},onWireStart:()=>{if(!authorized||wireStarted)throw new AiProviderFailure('AI_RESPONSE_INVALID');wireStarted=true;} };
      validateAiProviderConfiguration(configuration);
      const result = connectionTest ? await provider.testConnection(configuration) : await provider.execute(task, configuration);
      outcome = { success: true, result };
    } catch (error) {
      outcome = { success: false, failure: error instanceof AiProviderFailure ? error : error instanceof DomainError ? new AiProviderFailure(error.code as AiFailureCode) : new AiProviderFailure('AI_UPSTREAM_ERROR') };
    }
    const usage = outcome.success ? outcome.result.usage : outcome.failure.usage;
    const failureCode: AiFailureCode | null = outcome.success ? null : outcome.failure.code;
    if(wireStarted)await this.finishAttempt(attemptId,outcome.success,failureCode,usage,outcome.success?(outcome.result as AiResult&{actualModel?:string}).actualModel:outcome.failure.actualModel,outcome.success?(outcome.result as AiResult&{actualServiceTier?:string}).actualServiceTier:outcome.failure.actualServiceTier);else if(authorized)await this.rejectAuthorizedAttempt(attemptId,failureCode??'AI_UPSTREAM_ERROR');else await this.recordPreflight(householdId,settings.provider,model,task,failureCode??'AI_UPSTREAM_ERROR',{...context,category:context.category??(connectionTest?'test':'normal')},attemptId,registrationId);
    return outcome;
  }

  private route(provider:AiProviderId){return provider==='openai'?'openai_api':provider==='chatgpt_subscription'?'chatgpt_plan':'local';}
  private async recordPreflight(householdId:string,provider:AiProviderId,model:string,task:AiTask,failureCode:AiFailureCode,context:AiExecutionContext,attemptId=randomUUID(),registrationId?:string){await pool.query(`INSERT INTO ai_usage_events(household_id,provider,model,requested_model,operation,purpose,success,failure_code,attempt_id,route,category,task_id,task_revision,execution_id,phase,actual_dispatch,outcome,completed_at,owner_account_id,registration_id) VALUES($1,$2,NULLIF($3,''),NULLIF($3,''),$4,$5,false,$6,$7,$8,$9,$10,$11,$12,$13,false,'preflight_rejected',clock_timestamp(),$14,$15) ON CONFLICT DO NOTHING`,[householdId,provider,model,task.operation,task.purpose,failureCode,attemptId,this.route(provider),context.category??'normal',context.taskId??null,context.taskRevision??null,context.executionId??null,context.phase??null,context.ownerAccountId??null,registrationId??null]);}
  private async rejectAuthorizedAttempt(attemptId:string,failureCode:AiFailureCode){await pool.query(`UPDATE ai_usage_events SET actual_dispatch=false,outcome='preflight_rejected',failure_code=$2,completed_at=clock_timestamp() WHERE attempt_id=$1 AND actual_dispatch IS NULL AND outcome='started'`,[attemptId,failureCode]);}
  private async finishAttempt(attemptId:string,success:boolean,failureCode:AiFailureCode|null,usage?:{inputTokens?:number;outputTokens?:number;cachedInputTokens?:number;cacheWriteTokens?:number;reasoningTokens?:number},actualModel?:string,actualServiceTier?:string){await pool.query(`UPDATE ai_usage_events u SET actual_dispatch=true,success=$2,failure_code=$3,input_tokens=$4,output_tokens=$5,cached_input_tokens=$6,cache_write_tokens=$7,reasoning_tokens=$8,outcome=$9,actual_model=NULLIF($10,''),actual_service_tier=NULLIF($11,''),completed_at=clock_timestamp(),rate_snapshot_id=(SELECT r.id FROM ai_rate_snapshots r WHERE r.route=u.route AND r.model=$10 AND r.context_variant=CASE WHEN r.context_threshold_tokens IS NOT NULL AND $4>r.context_threshold_tokens THEN 'long_context' ELSE 'standard' END AND (r.route<>'openai_api' OR r.service_tier=$11) AND ((r.effective_from IS NOT NULL AND r.effective_from<=u.occurred_at::date) OR (r.effective_from IS NULL AND r.observed_at<=u.occurred_at)) ORDER BY r.effective_from DESC NULLS LAST,r.observed_at DESC LIMIT 1),api_equivalent_rate_snapshot_id=(SELECT r.id FROM ai_rate_snapshots r WHERE u.route='chatgpt_plan' AND r.route='openai_api' AND r.model=$10 AND r.service_tier='standard' AND r.context_variant=CASE WHEN r.context_threshold_tokens IS NOT NULL AND $4>r.context_threshold_tokens THEN 'long_context' ELSE 'standard' END AND ((r.effective_from IS NOT NULL AND r.effective_from<=u.occurred_at::date) OR (r.effective_from IS NULL AND r.observed_at<=u.occurred_at)) ORDER BY r.effective_from DESC NULLS LAST,r.observed_at DESC LIMIT 1),api_equivalent_assumption=CASE WHEN u.route='chatgpt_plan' THEN 'standard_tier_no_region_exact_model' END WHERE attempt_id=$1 AND outcome='started'`,[attemptId,success,failureCode,usage?.inputTokens??null,usage?.outputTokens??null,usage?.cachedInputTokens??null,usage?.cacheWriteTokens??null,usage?.reasoningTokens??null,success?'completed':failureCode==='AI_STREAM_INTERRUPTED'?'interrupted':'failed',actualModel??null,actualServiceTier??null]);
  }

  private settingsDto(settings: SettingsRow): Record<string, unknown> {
    const runtimeSupported = Boolean(this.providers[settings.provider]);
    const hasCompleteConfig = settings.provider==='chatgpt_subscription'?Boolean(settings.active_chatgpt_registration_id&&settings.default_model&&settings.strong_model):hasStoredProviderConfiguration(settings);
    let status: 'not_tested' | 'not_configured' | 'available' | 'unavailable' | 'error' =
      settings.availability_checked_revision === settings.revision ? settings.availability_status : 'not_tested';
    let errorCode = settings.availability_checked_revision === settings.revision ? settings.availability_error_code : null;
    if (!runtimeSupported) { status = 'unavailable'; errorCode = providerCatalog.find((item) => item.id === settings.provider)?.reasonCode ?? 'AI_PROVIDER_UNAVAILABLE'; }
    else if (!hasCompleteConfig) { status = 'not_configured'; errorCode = 'AI_CONFIGURATION_INVALID'; }
    return {
      enabled: settings.enabled, provider: settings.provider, hasApiKey: Boolean(settings.api_key_ciphertext),
      baseUrl: settings.base_url, defaultModel: settings.default_model, strongModel: settings.strong_model,
      defaultReasoningEffort: settings.default_reasoning_effort, strongReasoningEffort: settings.strong_reasoning_effort,
      revision: settings.revision,
      availability: {
        status, available: status === 'available', errorCode,
        checkedAt: settings.availability_checked_revision === settings.revision ? settings.availability_checked_at?.toISOString() ?? null : null
      },
      providers: providerCatalog,
      activeRoute:settings.provider==='openai'?'openai_api':settings.provider==='chatgpt_subscription'?'chatgpt_plan':'local',
      chatGptSubscription:{feasibility:'documented_preview',status:settings.active_chatgpt_registration_id?'configured':'not_configured',reasonCode:settings.active_chatgpt_registration_id?null:'CHATGPT_CONNECTION_NOT_CONFIGURED'}
    };
  }
}
