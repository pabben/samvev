import { aiResultSchema, aiTaskSchema, type AiProviderId, type AiResult, type AiTask } from '@samvev/contracts';

export interface AiProviderConfiguration {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
  /** Reserved for a later OpenAI-compatible provider; admin cannot set it in M2.1. */
  baseUrl?: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  execute(task: AiTask, configuration: AiProviderConfiguration): Promise<AiResult>;
  testConnection(configuration: AiProviderConfiguration): Promise<AiResult>;
}

export type AiFailureCode = 'AI_CONFIGURATION_INVALID' | 'AI_PROVIDER_UNAVAILABLE' |
  'AI_UPSTREAM_ERROR' | 'AI_RESPONSE_INVALID' | 'AI_TIMEOUT';

export class AiProviderFailure extends Error {
  constructor(
    public readonly code: AiFailureCode,
    public readonly usage?: { inputTokens?: number; outputTokens?: number }
  ) { super(code); }
}

export function validateAiTask(value: unknown): AiTask { return aiTaskSchema.parse(value); }
export function validateAiResult(value: unknown): AiResult { return aiResultSchema.parse(value); }
