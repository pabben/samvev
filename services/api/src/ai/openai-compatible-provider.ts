import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { aiResultSchema, aiTaskSchema, type AiResult, type AiTask } from '@samvev/contracts';
import { AiProviderFailure, type AiProvider, type AiProviderConfiguration } from './provider.ts';
import type { AiHttpTransport, AiResolvedTarget } from './openai-provider.ts';

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_STORED_TOKENS = 2_147_483_647;
const LOCAL_TIMEOUT_MS = 30_000;
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.google',
  'metadata.goog',
  'instance-data.ec2.internal',
  'metadata.azure.internal'
]);

export type AiHostnameResolver = (hostname: string) => Promise<AiResolvedTarget[]>;

function ipv4Parts(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split('.').map(Number);
}

function ipv6Value(address: string): bigint | undefined {
  let normalized = address.toLowerCase().split('%')[0]!;
  const dotted = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const parts = ipv4Parts(dotted);
    if (!parts) return undefined;
    const [a, b, c, d] = parts;
    normalized = `${normalized.slice(0, -dotted.length)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const groups = halves.length === 2 ? [...left, ...Array<string>(missing).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.reduce((value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

export function isBlockedAiTarget(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4) {
    const [a, b, c, d] = ipv4;
    return a === 0 || (a === 169 && b === 254) || a! >= 224 ||
      (a === 100 && b === 100 && c === 100 && d === 200) ||
      (a === 168 && b === 63 && c === 129 && d === 16);
  }
  if (isIP(address) !== 6) return true;
  const value = ipv6Value(address);
  if (value === undefined) return true;
  const first = Number(value >> 112n);
  const prefix96 = value >> 32n;
  if (prefix96 === 0xffffn || (prefix96 === 0n && value > 0xffffn)) {
    const ipv4 = Number(value & 0xffff_ffffn);
    return isBlockedAiTarget(`${ipv4 >>> 24}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`);
  }
  return value === 0n || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 ||
    value === ipv6Value('fd00:ec2::254') || value === ipv6Value('fd20:ce::254');
}

export function normalizeOpenAiCompatibleBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AiProviderFailure('AI_CONFIGURATION_INVALID'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || !hostname || url.username || url.password ||
      url.search || url.hash || hostname.includes('%') || METADATA_HOSTNAMES.has(hostname) ||
      hostname.endsWith('.metadata.google.internal')) {
    throw new AiProviderFailure('AI_ENDPOINT_BLOCKED');
  }
  if (isIP(hostname) && isBlockedAiTarget(hostname)) throw new AiProviderFailure('AI_ENDPOINT_BLOCKED');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

async function defaultResolver(hostname: string): Promise<AiResolvedTarget[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily) return [{ address: hostname, family: literalFamily as 4 | 6 }];
  return (await lookup(hostname, { all: true, verbatim: true })).map((row) => ({
    address: row.address,
    family: row.family as 4 | 6
  }));
}

export async function resolveOpenAiCompatibleTarget(
  baseUrl: string,
  resolver: AiHostnameResolver = defaultResolver
): Promise<{ baseUrl: string; target: AiResolvedTarget }> {
  const normalized = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  const hostname = new URL(normalized).hostname.replace(/^\[|\]$/g, '');
  let targets: AiResolvedTarget[];
  try { targets = await resolver(hostname); }
  catch { throw new AiProviderFailure('AI_UPSTREAM_ERROR'); }
  if (!targets.length) throw new AiProviderFailure('AI_UPSTREAM_ERROR');
  if (targets.some((target) => isBlockedAiTarget(target.address))) {
    throw new AiProviderFailure('AI_ENDPOINT_BLOCKED');
  }
  return { baseUrl: normalized, target: targets[0]! };
}

function completionUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.toString();
}

const pinnedHttpTransport: AiHttpTransport = (urlText, init, target) => new Promise((resolve, reject) => {
  if (!target) return reject(new AiProviderFailure('AI_ENDPOINT_BLOCKED'));
  const url = new URL(urlText);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    method: init.method,
    headers,
    signal: init.signal ?? undefined,
    lookup: ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
      callback(null, target.address, target.family);
    }) as RequestOptions['lookup']
  };
  const request = requestFn(url, options, (response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) response.destroy(new AiProviderFailure('AI_RESPONSE_INVALID'));
      else chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      try {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item);
        }
        const status = response.statusCode ?? 502;
        const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        resolve(new Response(body, { status, headers: responseHeaders }));
      } catch (error) {
        reject(error);
      }
    });
  });
  request.on('error', reject);
  if (typeof init.body === 'string' || init.body instanceof Uint8Array) request.write(init.body);
  else if (init.body != null) return request.destroy(new AiProviderFailure('AI_CONFIGURATION_INVALID'));
  request.end();
});

function normalizedUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const inputValue = row.prompt_tokens ?? row.input_tokens;
  const outputValue = row.completion_tokens ?? row.output_tokens;
  const inputTokens = Number.isInteger(inputValue) && Number(inputValue) >= 0 && Number(inputValue) <= MAX_STORED_TOKENS ? Number(inputValue) : undefined;
  const outputTokens = Number.isInteger(outputValue) && Number(outputValue) >= 0 && Number(outputValue) <= MAX_STORED_TOKENS ? Number(outputValue) : undefined;
  return inputTokens === undefined && outputTokens === undefined ? undefined : {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens })
  };
}

function outputText(payload: Record<string, unknown>, usage?: { inputTokens?: number; outputTokens?: number }): string {
  if (!Array.isArray(payload.choices) || !payload.choices.length) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  const message = (payload.choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== 'object' || (message as { refusal?: unknown }).refusal) {
    throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  }
  const content = (message as { content?: unknown }).content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content
    .filter((part): part is { type: string; text: string } => Boolean(part) && typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text).join('\n') : '';
  const normalized = text.trim();
  if (!normalized || normalized.length > 32_000) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  return normalized;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai_compatible' as const;

  constructor(
    private readonly transport: AiHttpTransport = pinnedHttpTransport,
    private readonly timeoutMs = LOCAL_TIMEOUT_MS,
    private readonly resolver: AiHostnameResolver = defaultResolver
  ) {}

  async execute(rawTask: AiTask, configuration: AiProviderConfiguration): Promise<AiResult> {
    const task = aiTaskSchema.parse(rawTask);
    if (configuration.provider !== this.id || !configuration.model.trim() || !configuration.baseUrl) {
      throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const abort = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      const { baseUrl, target } = await Promise.race([
        resolveOpenAiCompatibleTarget(configuration.baseUrl, this.resolver),
        abort
      ]);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (configuration.apiKey) headers.authorization = `Bearer ${configuration.apiKey}`;
      const response = await this.transport(completionUrl(baseUrl), {
        method: 'POST', headers,
        body: JSON.stringify({
          model: configuration.model,
          messages: [{ role: 'user', content: task.input }],
          max_tokens: 64,
          stream: false
        }),
        signal: controller.signal
      }, target);
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new AiProviderFailure('AI_RESPONSE_INVALID');
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { throw new AiProviderFailure(response.ok ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AiProviderFailure(response.ok ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR');
      }
      const payload = parsed as Record<string, unknown>;
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
    return this.execute({
      operation: 'generate', purpose: 'connection_test', input: 'Reply with the single word OK.',
      modelTier: 'routine', sources: []
    }, configuration);
  }
}
