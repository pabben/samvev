import { aiResultSchema, aiTaskSchema, type AiProviderId, type AiReasoningEffort, type AiResult, type AiTask } from '@samvev/contracts';

export interface AiProviderConfiguration {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
  /** Required by OpenAI-compatible providers; absent for the fixed OpenAI endpoint. */
  baseUrl?: string;
  /** Optional provider hint. OpenAI-compatible defaults to none; OpenAI Responses ignores it. */
  reasoningEffort?: AiReasoningEffort;
}

export interface AiProvider {
  readonly id: AiProviderId;
  execute(task: AiTask, configuration: AiProviderConfiguration): Promise<AiResult>;
  testConnection(configuration: AiProviderConfiguration): Promise<AiResult>;
}

export type AiFailureCode = 'AI_CONFIGURATION_INVALID' | 'AI_DISABLED' | 'AI_PROVIDER_UNAVAILABLE' |
  'AI_UPSTREAM_ERROR' | 'AI_RESPONSE_INVALID' | 'AI_TIMEOUT' | 'AI_ENDPOINT_BLOCKED';

export const aiProviderRequirements: Record<AiProviderId, { apiKey: boolean; baseUrl: boolean }> = {
  openai: { apiKey: true, baseUrl: false },
  openai_compatible: { apiKey: false, baseUrl: true },
  chatgpt_subscription: { apiKey: false, baseUrl: false },
  gemini: { apiKey: true, baseUrl: false }
};

/** One configuration rule for settings status, connection tests, tasks and workers. */
export function validateAiProviderConfiguration(configuration: AiProviderConfiguration): void {
  const requirements = aiProviderRequirements[configuration.provider];
  if (!configuration.model.trim() || (requirements.apiKey && !configuration.apiKey) ||
      (requirements.baseUrl && !configuration.baseUrl)) {
    throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
  }
}

export class AiProviderFailure extends Error {
  constructor(
    public readonly code: AiFailureCode,
    public readonly usage?: { inputTokens?: number; outputTokens?: number }
  ) { super(code); }
}

export function validateAiTask(value: unknown): AiTask { return aiTaskSchema.parse(value); }
export function validateAiResult(value: unknown): AiResult { return aiResultSchema.parse(value); }
