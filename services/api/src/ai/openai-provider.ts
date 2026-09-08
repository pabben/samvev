import { aiResultSchema, aiTaskSchema, type AiResult, type AiTask } from '@samvev/contracts';
import { AiProviderFailure, type AiProvider, type AiProviderConfiguration } from './provider.ts';

export interface AiResolvedTarget { address: string; family: 4 | 6 }
export type AiHttpTransport = (url: string, init: RequestInit, target?: AiResolvedTarget) => Promise<Response>;

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_STORED_TOKENS = 2_147_483_647;

interface OpenAiPayload {
  status?: unknown;
  incomplete_details?: unknown;
  output?: unknown;
  usage?: unknown;
}

function normalizedUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const inputTokens = Number.isInteger(row.input_tokens) && Number(row.input_tokens) >= 0 && Number(row.input_tokens) <= MAX_STORED_TOKENS ? Number(row.input_tokens) : undefined;
  const outputTokens = Number.isInteger(row.output_tokens) && Number(row.output_tokens) >= 0 && Number(row.output_tokens) <= MAX_STORED_TOKENS ? Number(row.output_tokens) : undefined;
  return inputTokens === undefined && outputTokens === undefined ? undefined : {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens })
  };
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AiProviderFailure('AI_RESPONSE_INVALID');
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function outputText(payload: OpenAiPayload, usage?: { inputTokens?: number; outputTokens?: number }): string {
  if (payload.status !== 'completed' || payload.incomplete_details) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  if (!Array.isArray(payload.output)) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  const texts: string[] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const type = (part as { type?: unknown }).type;
      if (type === 'refusal') throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
      const text = (part as { text?: unknown }).text;
      if (type === 'output_text' && typeof text === 'string' && text.trim()) texts.push(text);
    }
  }
  const joined = texts.join('\n').trim();
  if (!joined || joined.length > 32_000) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  return joined;
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;

  constructor(
    private readonly transport: AiHttpTransport = fetch,
    private readonly timeoutMs = 10_000
  ) {}

  async execute(rawTask: AiTask, configuration: AiProviderConfiguration): Promise<AiResult> {
    const task = aiTaskSchema.parse(rawTask);
    if (configuration.provider !== this.id || !configuration.apiKey || !configuration.model.trim() || configuration.baseUrl) {
      throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${configuration.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: configuration.model, input: task.input, max_output_tokens: 64, store: false }),
        signal: controller.signal
      });
      const text = await boundedText(response);
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { throw new AiProviderFailure(response.ok ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AiProviderFailure(response.ok ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR');
      const payload = parsed as OpenAiPayload;
      const usage = normalizedUsage(payload.usage);
      if (!response.ok) throw new AiProviderFailure('AI_UPSTREAM_ERROR', usage);
      return aiResultSchema.parse({
        output: outputText(payload, usage), generatedAt: new Date().toISOString(), uncertainty: 'unknown',
        sources: task.sources, ...(usage ? { usage } : {})
      });
    } catch (error) {
      if (error instanceof AiProviderFailure) throw error;
      if (controller.signal.aborted || (error as { name?: string }).name === 'AbortError') throw new AiProviderFailure('AI_TIMEOUT');
      throw new AiProviderFailure('AI_UPSTREAM_ERROR');
    } finally { clearTimeout(timeout); }
  }

  testConnection(configuration: AiProviderConfiguration): Promise<AiResult> {
    return this.execute({ operation: 'generate', purpose: 'connection_test', input: 'Reply with the single word OK.', modelTier: 'routine', sources: [] }, configuration);
  }
}
