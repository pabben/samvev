import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  aiProviderTurnSchema, aiResultSchema, aiTaskSchema,
  type AiProviderTurn, type AiResult, type AiTask, type AiToolDefinition, type AiToolResult
} from '@samvev/contracts';
import {
  AiProviderFailure, createAiToolNameAliases, internalizeAiProviderTurn, validateAiProviderConfiguration,
  type AiProvider, type AiProviderConfiguration, type AiProviderSession, type AiToolChoice, type AiToolNameAliases
} from './provider.ts';
import type { AiHttpTransport, AiResolvedTarget } from './openai-provider.ts';
import { createPinnedLookup } from '../pinned-lookup.ts';

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
    lookup: createPinnedLookup(target)
  };
  const request = requestFn(url, options, (response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) response.destroy(new AiProviderFailure(
        (response.statusCode??502)>=200 && (response.statusCode??502)<300 ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR'
      ));
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

function contentText(message: Record<string, unknown>): string {
  const content = message.content;
  return (typeof content === 'string' ? content : Array.isArray(content) ? content
    .filter((part): part is { type: string; text: string } => Boolean(part) && typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text).join('\n') : '').trim();
}

function parsedArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function chatCompletionTurn(payload: Record<string, unknown>): AiProviderTurn {
  const usage = normalizedUsage(payload.usage);
  if (!Array.isArray(payload.choices) || !payload.choices.length) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  const message = (payload.choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== 'object') throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  const row = message as Record<string, unknown>;
  const toolCalls = Array.isArray(row.tool_calls) ? row.tool_calls.map((value) => {
    const call = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {};
    return { id: String(call.id ?? ''), name: String(fn.name ?? ''), arguments: parsedArguments(fn.arguments) };
  }) : [];
  // Treat assistant content accompanying function calls as intermediary text.
  // This preserves the provider-neutral strict output/tool-call XOR.
  const output = toolCalls.length ? '' : contentText(row);
  const parsed = aiProviderTurnSchema.safeParse({ ...(output ? { output } : {}), toolCalls, generatedAt: new Date().toISOString(), ...(usage ? { usage } : {}) });
  if (!parsed.success) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  return parsed.data;
}

function normalizedAssistantContinuation(turn:AiProviderTurn,aliases:AiToolNameAliases):Record<string,unknown>{
  if(turn.toolCalls.length){
    return{role:'assistant',content:null,tool_calls:turn.toolCalls.map((call)=>{
      const argumentsText=JSON.stringify(call.arguments);if(typeof argumentsText!=='string')throw new AiProviderFailure('AI_RESPONSE_INVALID',turn.usage);
      return{id:call.id,type:'function',function:{name:aliases.toWire(call.name),arguments:argumentsText}};
    })};
  }
  return{role:'assistant',content:turn.output!};
}

function combinedSignal(external: AbortSignal | undefined, timeoutMs: number): {signal:AbortSignal;close:(abort?:boolean)=>void} {
  const controller=new AbortController();const abort=()=>controller.abort();
  if(external?.aborted)controller.abort();else external?.addEventListener('abort',abort,{once:true});
  const timeout=external?undefined:setTimeout(abort,timeoutMs);return{signal:controller.signal,close:(cancel=false)=>{if(timeout)clearTimeout(timeout);external?.removeEventListener('abort',abort);if(cancel)controller.abort();}};
}

class ChatCompletionSession implements AiProviderSession {
  private readonly messages:Array<Record<string,unknown>>;
  private pending=new Map<string,string>();
  private closed=false;
  constructor(
    private readonly task:AiTask,private readonly configuration:AiProviderConfiguration,
    private readonly aliases:AiToolNameAliases,private readonly transport:AiHttpTransport,
    private readonly timeoutMs:number,private readonly target:{baseUrl:string;target:AiResolvedTarget},
    private readonly externalSignal?:AbortSignal,private readonly closeSession:()=>void=()=>{}
  ){this.messages=[{role:'user',content:task.input}];}
  close():void{if(this.closed)return;this.closed=true;this.closeSession();}
  async next(toolResults:AiToolResult[]=[],toolChoice:AiToolChoice='auto'):Promise<AiProviderTurn>{
    if(this.closed)throw new AiProviderFailure('AI_RESPONSE_INVALID');
    if(this.pending.size!==toolResults.length||toolResults.some((result)=>this.pending.get(result.callId)!==result.name)){this.close();throw new AiProviderFailure('AI_RESPONSE_INVALID');}
    if(toolResults.length){this.messages.push(...toolResults.map((result)=>({role:'tool',tool_call_id:result.callId,name:this.aliases.toWire(result.name),content:result.output})));this.pending.clear();}
    const active=combinedSignal(this.externalSignal,this.timeoutMs);
    const aborted=new Promise<never>((_resolve,reject)=>active.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
    try{
      const headers:Record<string,string>={'content-type':'application/json'};if(this.configuration.apiKey)headers.authorization=`Bearer ${this.configuration.apiKey}`;
      const response=await Promise.race([this.transport(completionUrl(this.target.baseUrl),{method:'POST',headers,body:JSON.stringify({
        model:this.configuration.model,messages:this.messages,max_tokens:this.task.maxOutputTokens??64,
        reasoning_effort:this.configuration.reasoningEffort??'none',stream:false,
        ...(this.aliases.wireTools.length?{tools:this.aliases.wireTools.map((tool)=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema,strict:true}})),tool_choice:toolChoice}:{})
      }),signal:active.signal},this.target.target),aborted]);
      const text=await Promise.race([response.text(),aborted]);if(Buffer.byteLength(text)>MAX_RESPONSE_BYTES)throw new AiProviderFailure(response.ok?'AI_RESPONSE_INVALID':'AI_UPSTREAM_ERROR');
      let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new AiProviderFailure(response.ok?'AI_RESPONSE_INVALID':'AI_UPSTREAM_ERROR');}
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new AiProviderFailure(response.ok?'AI_RESPONSE_INVALID':'AI_UPSTREAM_ERROR');
      const payload=parsed as Record<string,unknown>;const usage=normalizedUsage(payload.usage);if(!response.ok)throw new AiProviderFailure('AI_UPSTREAM_ERROR',usage);
      const turn=internalizeAiProviderTurn(chatCompletionTurn(payload),this.aliases);
      this.messages.push(normalizedAssistantContinuation(turn,this.aliases));this.pending=new Map(turn.toolCalls.map((call)=>[call.id,call.name]));return turn;
    }catch(error){const timedOut=active.signal.aborted;this.close();if(timedOut)throw new AiProviderFailure('AI_TIMEOUT');if(error instanceof AiProviderFailure)throw error;throw new AiProviderFailure('AI_UPSTREAM_ERROR');}
    finally{active.close();}
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai_compatible' as const;

  constructor(
    private readonly transport: AiHttpTransport = pinnedHttpTransport,
    private readonly timeoutMs = LOCAL_TIMEOUT_MS,
    private readonly resolver: AiHostnameResolver = defaultResolver
  ) {}

  createSession(rawTask:AiTask,configuration:AiProviderConfiguration,tools:AiToolDefinition[]=[],signal?:AbortSignal):AiProviderSession{
    const task=aiTaskSchema.parse(rawTask);validateAiProviderConfiguration(configuration);
    if(configuration.provider!==this.id||!configuration.baseUrl)throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    const aliases=createAiToolNameAliases(tools);let resolved:Promise<{baseUrl:string;target:AiResolvedTarget}>|undefined;let lifetime:ReturnType<typeof combinedSignal>|undefined;let session:ChatCompletionSession|undefined;let closed=false;
    const close=()=>{if(closed)return;closed=true;if(session)session.close();else lifetime?.close(true);};
    const lazy:AiProviderSession={close,next:async(results=[],toolChoice='auto')=>{if(closed)throw new AiProviderFailure('AI_RESPONSE_INVALID');lifetime??=combinedSignal(signal,this.timeoutMs);const active=lifetime;try{resolved??=resolveOpenAiCompatibleTarget(configuration.baseUrl!,this.resolver);const target=await Promise.race([resolved,new Promise<never>((_resolve,reject)=>active.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))]);session=new ChatCompletionSession(task,configuration,aliases,this.transport,this.timeoutMs,target,active.signal,()=>active.close(true));lazy.next=session.next.bind(session);return lazy.next(results,toolChoice);}catch(error){const timedOut=active.signal.aborted;active.close(true);closed=true;if(timedOut)throw new AiProviderFailure('AI_TIMEOUT');if(error instanceof AiProviderFailure)throw error;throw new AiProviderFailure('AI_UPSTREAM_ERROR');}}};
    return lazy;
  }

  async execute(rawTask: AiTask, configuration: AiProviderConfiguration): Promise<AiResult> {
    const task=aiTaskSchema.parse(rawTask);const session=this.createSession(task,configuration);
    try{const turn=await session.next();if(!turn.output)throw new AiProviderFailure('AI_RESPONSE_INVALID',turn.usage);return aiResultSchema.parse({output:turn.output,generatedAt:turn.generatedAt,uncertainty:'unknown',sources:task.sources,...(turn.usage?{usage:turn.usage}:{})});}
    finally{session.close();}
  }

  testConnection(configuration: AiProviderConfiguration): Promise<AiResult> {
    return this.execute({
      operation: 'generate', purpose: 'connection_test', input: 'Reply with the single word OK.',
      modelTier: 'routine', sources: []
    }, { ...configuration, reasoningEffort: 'none' });
  }
}
