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

const providerCatalog = [
  { id: 'openai', runtimeAvailable: true, reasonCode: null },
  { id: 'chatgpt_subscription', runtimeAvailable: false, reasonCode: 'CHATGPT_CONNECTION_NOT_CONFIGURED' },
  { id: 'openai_compatible', runtimeAvailable: true, reasonCode: null },
  { id: 'gemini', runtimeAvailable: false, reasonCode: 'PROVIDER_NOT_IMPLEMENTED_M2_1' }
] as const;

function emptySettings(householdId: string): SettingsRow {
  return {
    household_id: householdId, enabled: false, provider: 'openai', api_key_ciphertext: null, base_url: null,
    default_model: '', strong_model: '', default_reasoning_effort: 'none', strong_reasoning_effort: 'medium',
    revision: 0, availability_status: 'not_tested',
    availability_error_code: null, availability_checked_at: null, availability_checked_revision: null
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

  constructor(options: { transport?: AiHttpTransport; keyFile?: string } = {}) {
    this.providers = {
      openai: new OpenAiProvider(options.transport),
      openai_compatible: new OpenAiCompatibleProvider(options.transport)
    };
    this.vault = new AiCredentialVault(options.keyFile);
  }

  async settings(householdId: string): Promise<Record<string, unknown>> {
    return this.settingsDto(await this.rawSettings(householdId));
  }

  async updateSettings(householdId: string, patch: AiSettingsPatch): Promise<Record<string, unknown>> {
    const ciphertext = typeof patch.apiKey === 'string' ? await this.vault.encrypt(householdId, patch.apiKey) : patch.apiKey;
    const updated = await transaction(async (client) => {
      const existing = (await client.query<SettingsRow>('SELECT * FROM ai_settings WHERE household_id=$1 FOR UPDATE', [householdId])).rows[0];
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
        return inserted.rows[0]!;
      }
      if (existing.revision !== patch.expectedRevision) throw new DomainError('REVISION_CONFLICT', 409);
      const provider = patch.provider ?? existing.provider;
      if (provider === 'openai' && typeof patch.apiKey === 'string' && patch.apiKey.length < 20) {
        throw new DomainError('VALIDATION_FAILED', 400);
      }
      const baseUrlValue = patch.baseUrl === undefined ? existing.base_url : patch.baseUrl;
      const baseUrl = provider === 'openai_compatible' && baseUrlValue ? normalizedBaseUrl(baseUrlValue) : null;
      const credentialIdentityChanged = provider !== existing.provider ||
        (provider === 'openai_compatible' && baseUrl !== existing.base_url);
      const nextCiphertext = ciphertext === undefined
        ? credentialIdentityChanged ? null : existing.api_key_ciphertext
        : ciphertext;
      const result = await client.query<SettingsRow>(`UPDATE ai_settings SET
        enabled=$2,provider=$3,api_key_ciphertext=$4,base_url=$5,default_model=$6,strong_model=$7,
        default_reasoning_effort=$8,strong_reasoning_effort=$9,
        revision=revision+1,availability_status='not_tested',availability_error_code=NULL,
        availability_checked_at=NULL,availability_checked_revision=NULL,updated_at=clock_timestamp()
        WHERE household_id=$1 AND revision=$10 RETURNING *`, [
          householdId, patch.enabled ?? existing.enabled, provider, nextCiphertext, baseUrl,
          patch.defaultModel ?? existing.default_model, patch.strongModel ?? existing.strong_model,
          patch.defaultReasoningEffort ?? existing.default_reasoning_effort,
          patch.strongReasoningEffort ?? existing.strong_reasoning_effort,
          patch.expectedRevision
        ]);
      if (!result.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
      return result.rows[0]!;
    });
    return this.settingsDto(updated);
  }

  async testConnection(householdId: string, tier: AiModelTier): Promise<Record<string, unknown>> {
    const settings = await this.rawSettings(householdId);
    const task: AiTask = { operation: 'generate', purpose: 'connection_test', input: 'Reply with the single word OK.', modelTier: tier, sources: [] };
    const outcome = await this.run(householdId, settings, task, false, true);
    const failureCode = outcome.success ? null : outcome.failure.code;
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
  async executeTask(householdId: string, rawTask: AiTask, policy: MonitorProviderPolicy = 'default'): Promise<AiResult> {
    return (await this.executeTaskWithContext(householdId, rawTask, policy)).result;
  }

  async executeTaskWithContext(householdId: string, rawTask: AiTask, policy: MonitorProviderPolicy = 'default'): Promise<{result:AiResult;provider:AiProviderId;model:string}> {
    const task = aiTaskSchema.parse(rawTask);
    const session=await this.createTaskSession(householdId,task,policy);
    try{const turn=await session.next();if(!turn.output)throw new DomainError('AI_RESPONSE_INVALID',502);return {result:{output:turn.output,generatedAt:turn.generatedAt,uncertainty:'unknown',sources:task.sources,...(turn.usage?{usage:turn.usage}:{})},provider:session.provider,model:session.model};}
    finally{session.close();}
  }

  /** Resolve/decrypt provider configuration once, then keep protocol state request-local. */
  async createTaskSession(
    householdId:string,rawTask:AiTask,policy:MonitorProviderPolicy='default',
    tools:AiToolDefinition[]=[],signal?:AbortSignal
  ):Promise<{provider:AiProviderId;model:string;next:(results?:AiToolResult[],toolChoice?:'auto'|'required')=>Promise<AiProviderTurn>;close:()=>void}>{
    const task=aiTaskSchema.parse(rawTask);const settings=await this.rawSettings(householdId);
    if((policy==='local'&&settings.provider!=='openai_compatible')||(policy==='openai'&&settings.provider!=='openai'))throw new DomainError('AI_PROVIDER_UNAVAILABLE',422);
    const model=task.modelTier==='strong'?settings.strong_model:settings.default_model;
    if(!settings.enabled){await this.recordUsage(householdId,settings.provider,model,task,false,'AI_DISABLED');throw new DomainError('AI_DISABLED',422);}
    const provider=this.providers[settings.provider];if(!provider)throw new DomainError('AI_PROVIDER_UNAVAILABLE',502);
    let apiKey:string|undefined;
    if(settings.api_key_ciphertext){try{apiKey=await this.vault.decrypt(householdId,settings.api_key_ciphertext);}catch{throw new DomainError('AI_CONFIGURATION_INVALID',422);}}
    const configuration={provider:settings.provider,model,apiKey,baseUrl:settings.base_url??undefined,reasoningEffort:task.modelTier==='strong'?settings.strong_reasoning_effort:settings.default_reasoning_effort};
    try{validateAiProviderConfiguration(configuration);}catch(error){throw new DomainError(error instanceof AiProviderFailure?error.code:'AI_CONFIGURATION_INVALID',422);}
    const wire=provider.createSession(task,configuration,tools,signal);
    return {provider:settings.provider,model,close:()=>wire.close(),next:async(results=[],toolChoice='auto')=>{
      try{const turn=await wire.next(results,toolChoice);await this.recordUsage(householdId,settings.provider,model,task,true,null,turn.usage);return turn;}
      catch(error){const failure=error instanceof AiProviderFailure?error:new AiProviderFailure('AI_UPSTREAM_ERROR');await this.recordUsage(householdId,settings.provider,model,task,false,failure.code,failure.usage);const status=['AI_CONFIGURATION_INVALID','AI_DISABLED'].includes(failure.code)?422:failure.code==='AI_TIMEOUT'?504:502;throw new DomainError(failure.code,status);}
    }};
  }

  async usage(householdId: string): Promise<Record<string, unknown>> {
    const [summary, recent] = await Promise.all([
      pool.query<{ requests: number; successes: number; failures: number; input_tokens: string; output_tokens: string }>(`SELECT
        count(*)::int AS requests,count(*) FILTER (WHERE success)::int AS successes,
        count(*) FILTER (WHERE NOT success)::int AS failures,
        LEAST(COALESCE(sum(input_tokens),0),9007199254740991)::bigint AS input_tokens,
        LEAST(COALESCE(sum(output_tokens),0),9007199254740991)::bigint AS output_tokens
        FROM ai_usage_events WHERE household_id=$1`, [householdId]),
      pool.query<{ provider: AiProviderId; model: string | null; purpose: string; success: boolean; failure_code: string | null; input_tokens: number | null; output_tokens: number | null; occurred_at: Date }>(`SELECT
        provider,model,purpose,success,failure_code,input_tokens,output_tokens,occurred_at
        FROM ai_usage_events WHERE household_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20`, [householdId])
    ]);
    const total = summary.rows[0] ?? { requests: 0, successes: 0, failures: 0, input_tokens: '0', output_tokens: '0' };
    return {
      summary: {
        requests: total.requests, successes: total.successes, failures: total.failures,
        inputTokens: Number(total.input_tokens), outputTokens: Number(total.output_tokens)
      },
      recent: recent.rows.map((row) => ({
        provider: row.provider, model: row.model, purpose: row.purpose, success: row.success,
        errorCode: row.failure_code, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
        occurredAt: row.occurred_at.toISOString()
      }))
    };
  }

  private async rawSettings(householdId: string): Promise<SettingsRow> {
    return (await pool.query<SettingsRow>('SELECT * FROM ai_settings WHERE household_id=$1', [householdId])).rows[0] ?? emptySettings(householdId);
  }

  private async run(
    householdId: string,
    settings: SettingsRow,
    task: AiTask,
    requireEnabled: boolean,
    connectionTest: boolean
  ): Promise<{ success: true; result: AiResult } | { success: false; failure: AiProviderFailure }> {
    const model = task.modelTier === 'strong' ? settings.strong_model : settings.default_model;
    let outcome: { success: true; result: AiResult } | { success: false; failure: AiProviderFailure };
    try {
      if (requireEnabled && !settings.enabled) throw new AiProviderFailure('AI_DISABLED');
      const provider = this.providers[settings.provider];
      if (!provider) throw new AiProviderFailure('AI_PROVIDER_UNAVAILABLE');
      let apiKey: string | undefined;
      if (settings.api_key_ciphertext) {
        try { apiKey = await this.vault.decrypt(householdId, settings.api_key_ciphertext); }
        catch { throw new AiProviderFailure('AI_CONFIGURATION_INVALID'); }
      }
      const reasoningEffort = connectionTest ? 'none' : task.modelTier === 'strong' ? settings.strong_reasoning_effort : settings.default_reasoning_effort;
      const configuration = { provider: settings.provider, model, apiKey, baseUrl: settings.base_url ?? undefined, reasoningEffort };
      validateAiProviderConfiguration(configuration);
      const result = connectionTest ? await provider.testConnection(configuration) : await provider.execute(task, configuration);
      outcome = { success: true, result };
    } catch (error) {
      outcome = { success: false, failure: error instanceof AiProviderFailure ? error : new AiProviderFailure('AI_UPSTREAM_ERROR') };
    }
    const usage = outcome.success ? outcome.result.usage : outcome.failure.usage;
    const failureCode: AiFailureCode | null = outcome.success ? null : outcome.failure.code;
    await this.recordUsage(householdId,settings.provider,model,task,outcome.success,failureCode,usage);
    return outcome;
  }

  private async recordUsage(householdId:string,provider:AiProviderId,model:string,task:AiTask,success:boolean,failureCode:AiFailureCode|null,usage?:{inputTokens?:number;outputTokens?:number}):Promise<void>{
    await pool.query(`INSERT INTO ai_usage_events(household_id,provider,model,operation,purpose,success,failure_code,input_tokens,output_tokens)
      VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9)`,[householdId,provider,model,task.operation,task.purpose,success,failureCode,usage?.inputTokens??null,usage?.outputTokens??null]);
  }

  private settingsDto(settings: SettingsRow): Record<string, unknown> {
    const runtimeSupported = Boolean(this.providers[settings.provider]);
    const hasCompleteConfig = hasStoredProviderConfiguration(settings);
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
      chatGptSubscription: { feasibility: 'partial', status: 'unavailable', reasonCode: 'CHATGPT_CONNECTION_NOT_CONFIGURED' }
    };
  }
}
