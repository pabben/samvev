import { aiTaskSchema, type AiModelTier, type AiProviderId, type AiResult, type AiTask } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import { pool, transaction } from '../db.ts';
import { AiCredentialVault } from './credential-vault.ts';
import { OpenAiProvider, type AiHttpTransport } from './openai-provider.ts';
import { AiProviderFailure, type AiFailureCode, type AiProvider } from './provider.ts';

interface SettingsRow {
  household_id: string;
  enabled: boolean;
  provider: AiProviderId;
  api_key_ciphertext: string | null;
  default_model: string;
  strong_model: string;
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
  defaultModel?: string;
  strongModel?: string;
  expectedRevision: number;
}

const providerCatalog = [
  { id: 'openai', runtimeAvailable: true, reasonCode: null },
  { id: 'chatgpt_subscription', runtimeAvailable: false, reasonCode: 'CHATGPT_CONNECTION_NOT_CONFIGURED' },
  { id: 'openai_compatible', runtimeAvailable: false, reasonCode: 'PROVIDER_NOT_IMPLEMENTED_M2_1' },
  { id: 'gemini', runtimeAvailable: false, reasonCode: 'PROVIDER_NOT_IMPLEMENTED_M2_1' }
] as const;

function emptySettings(householdId: string): SettingsRow {
  return {
    household_id: householdId, enabled: false, provider: 'openai', api_key_ciphertext: null,
    default_model: '', strong_model: '', revision: 0, availability_status: 'not_tested',
    availability_error_code: null, availability_checked_at: null, availability_checked_revision: null
  };
}

export class AiAdminService {
  private readonly provider: AiProvider;
  private readonly vault: AiCredentialVault;

  constructor(options: { transport?: AiHttpTransport; keyFile?: string } = {}) {
    this.provider = new OpenAiProvider(options.transport);
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
        const inserted = await client.query<SettingsRow>(`INSERT INTO ai_settings(
          household_id,enabled,provider,api_key_ciphertext,default_model,strong_model,revision
        ) SELECT $1,$2,$3,$4,$5,$6,1 WHERE EXISTS(SELECT 1 FROM households WHERE id=$1)
        ON CONFLICT DO NOTHING RETURNING *`, [
          householdId, patch.enabled ?? base.enabled, patch.provider ?? base.provider,
          ciphertext === undefined ? base.api_key_ciphertext : ciphertext,
          patch.defaultModel ?? base.default_model, patch.strongModel ?? base.strong_model
        ]);
        if (!inserted.rowCount) throw new DomainError('REVISION_CONFLICT', 409);
        return inserted.rows[0]!;
      }
      if (existing.revision !== patch.expectedRevision) throw new DomainError('REVISION_CONFLICT', 409);
      const result = await client.query<SettingsRow>(`UPDATE ai_settings SET
        enabled=$2,provider=$3,api_key_ciphertext=$4,default_model=$5,strong_model=$6,
        revision=revision+1,availability_status='not_tested',availability_error_code=NULL,
        availability_checked_at=NULL,availability_checked_revision=NULL,updated_at=clock_timestamp()
        WHERE household_id=$1 AND revision=$7 RETURNING *`, [
          householdId, patch.enabled ?? existing.enabled, patch.provider ?? existing.provider,
          ciphertext === undefined ? existing.api_key_ciphertext : ciphertext,
          patch.defaultModel ?? existing.default_model, patch.strongModel ?? existing.strong_model,
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
  async executeTask(householdId: string, rawTask: AiTask): Promise<AiResult> {
    const task = aiTaskSchema.parse(rawTask);
    const settings = await this.rawSettings(householdId);
    const outcome = await this.run(householdId, settings, task, true, false);
    if (outcome.success) return outcome.result;
    const status = outcome.failure.code === 'AI_CONFIGURATION_INVALID' ? 422 :
      outcome.failure.code === 'AI_TIMEOUT' ? 504 : 502;
    throw new DomainError(outcome.failure.code, status);
  }

  async usage(householdId: string): Promise<Record<string, unknown>> {
    const [summary, recent] = await Promise.all([
      pool.query<{ requests: number; successes: number; failures: number; input_tokens: number; output_tokens: number }>(`SELECT
        count(*)::int AS requests,count(*) FILTER (WHERE success)::int AS successes,
        count(*) FILTER (WHERE NOT success)::int AS failures,COALESCE(sum(input_tokens),0)::int AS input_tokens,
        COALESCE(sum(output_tokens),0)::int AS output_tokens
        FROM ai_usage_events WHERE household_id=$1`, [householdId]),
      pool.query<{ provider: AiProviderId; model: string | null; purpose: string; success: boolean; failure_code: string | null; input_tokens: number | null; output_tokens: number | null; occurred_at: Date }>(`SELECT
        provider,model,purpose,success,failure_code,input_tokens,output_tokens,occurred_at
        FROM ai_usage_events WHERE household_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20`, [householdId])
    ]);
    const total = summary.rows[0] ?? { requests: 0, successes: 0, failures: 0, input_tokens: 0, output_tokens: 0 };
    return {
      summary: { requests: total.requests, successes: total.successes, failures: total.failures, inputTokens: total.input_tokens, outputTokens: total.output_tokens },
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
      if (requireEnabled && !settings.enabled) throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
      if (settings.provider !== this.provider.id) throw new AiProviderFailure('AI_PROVIDER_UNAVAILABLE');
      if (!settings.api_key_ciphertext || !model) throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
      let apiKey: string;
      try { apiKey = await this.vault.decrypt(householdId, settings.api_key_ciphertext); }
      catch { throw new AiProviderFailure('AI_CONFIGURATION_INVALID'); }
      const configuration = { provider: settings.provider, model, apiKey };
      const result = connectionTest ? await this.provider.testConnection(configuration) : await this.provider.execute(task, configuration);
      outcome = { success: true, result };
    } catch (error) {
      outcome = { success: false, failure: error instanceof AiProviderFailure ? error : new AiProviderFailure('AI_UPSTREAM_ERROR') };
    }
    const usage = outcome.success ? outcome.result.usage : outcome.failure.usage;
    const failureCode: AiFailureCode | null = outcome.success ? null : outcome.failure.code;
    await pool.query(`INSERT INTO ai_usage_events(
      household_id,provider,model,operation,purpose,success,failure_code,input_tokens,output_tokens
    ) VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9)`, [
      householdId, settings.provider, model, task.operation, task.purpose, outcome.success, failureCode,
      usage?.inputTokens ?? null, usage?.outputTokens ?? null
    ]);
    return outcome;
  }

  private settingsDto(settings: SettingsRow): Record<string, unknown> {
    const runtimeSupported = settings.provider === 'openai';
    const hasCompleteConfig = Boolean(settings.api_key_ciphertext && settings.default_model && settings.strong_model);
    let status: 'not_tested' | 'not_configured' | 'available' | 'unavailable' | 'error' =
      settings.availability_checked_revision === settings.revision ? settings.availability_status : 'not_tested';
    let errorCode = settings.availability_checked_revision === settings.revision ? settings.availability_error_code : null;
    if (!runtimeSupported) { status = 'unavailable'; errorCode = providerCatalog.find((item) => item.id === settings.provider)?.reasonCode ?? 'AI_PROVIDER_UNAVAILABLE'; }
    else if (!hasCompleteConfig) { status = 'not_configured'; errorCode = 'AI_CONFIGURATION_INVALID'; }
    return {
      enabled: settings.enabled, provider: settings.provider, hasApiKey: Boolean(settings.api_key_ciphertext),
      defaultModel: settings.default_model, strongModel: settings.strong_model, revision: settings.revision,
      availability: {
        status, available: status === 'available', errorCode,
        checkedAt: settings.availability_checked_revision === settings.revision ? settings.availability_checked_at?.toISOString() ?? null : null
      },
      providers: providerCatalog,
      chatGptSubscription: { feasibility: 'partial', status: 'unavailable', reasonCode: 'CHATGPT_CONNECTION_NOT_CONFIGURED' }
    };
  }
}
