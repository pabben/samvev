import {
  aiProviderTurnSchema, aiResultSchema, aiTaskSchema,
  type AiProviderTurn, type AiResult, type AiTask, type AiToolDefinition, type AiToolResult
} from '@samvev/contracts';
import {
  AiProviderFailure, createAiToolNameAliases, internalizeAiProviderTurn, validateAiProviderConfiguration,
  type AiProvider, type AiProviderConfiguration, type AiProviderSession, type AiToolChoice, type AiToolNameAliases
} from './provider.ts';

export interface AiResolvedTarget { address: string; family: 4 | 6 }
export type AiHttpTransport = (url: string, init: RequestInit, target?: AiResolvedTarget) => Promise<Response>;

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_STORED_TOKENS = 2_147_483_647;

interface OpenAiPayload { status?: unknown; incomplete_details?: unknown; output?: unknown; usage?: unknown; }
type JsonSchema=Record<string,unknown>;

function schemaObject(value:unknown):value is JsonSchema{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function permitsNull(schema:unknown):boolean{
  if(!schemaObject(schema))return false;
  if(schema.type==='null'||(Array.isArray(schema.type)&&schema.type.includes('null'))||schema.const===null||(Array.isArray(schema.enum)&&schema.enum.includes(null)))return true;
  return ['anyOf','oneOf'].some((key)=>Array.isArray(schema[key])&&(schema[key] as unknown[]).some(permitsNull));
}

/** OpenAI strict Structured Outputs requires every declared object property in
 * `required`. Provider-neutral optional properties are represented as nullable
 * on the wire and removed again from a successful terminal response. */
export function openAiStrictResponseSchema(value:unknown):unknown{
  if(!schemaObject(value))return value;
  const result:JsonSchema={...value};
  // OpenAI Structured Outputs supports only a JSON Schema subset. Remove only
  // constraints used by Samvev's monitor schemas that the wire subset rejects;
  // the untouched provider-neutral schema remains authoritative server-side.
  if(value.format==='uri')delete result.format;
  if(value.uniqueItems===true)delete result.uniqueItems;
  for(const key of ['anyOf','oneOf','allOf'] as const)if(Array.isArray(value[key]))result[key]=(value[key] as unknown[]).map(openAiStrictResponseSchema);
  if(schemaObject(value.items))result.items=openAiStrictResponseSchema(value.items);
  if(schemaObject(value.properties)){
    const required=new Set(Array.isArray(value.required)?value.required.filter((item):item is string=>typeof item==='string'):[]);
    const properties=Object.fromEntries(Object.entries(value.properties).map(([name,schema])=>{
      const strict=openAiStrictResponseSchema(schema);return[name,required.has(name)||permitsNull(strict)?strict:{anyOf:[strict,{type:'null'}]}];
    }));
    result.properties=properties;result.required=Object.keys(properties);
  }
  return result;
}

function matchingSchema(value:unknown,schemas:unknown[]):unknown{
  let best=schemas[0],bestScore=-1;
  for(const schema of schemas){
    if(!schemaObject(schema))continue;
    if(value===null&&permitsNull(schema))return schema;
    if(schemaObject(value)&&schemaObject(schema.properties)){
      const keys=Object.keys(value);const known=new Set(Object.keys(schema.properties));
      const score=keys.filter((key)=>known.has(key)).length-(keys.some((key)=>!known.has(key))?1000:0);
      if(score>bestScore){best=schema;bestScore=score;}
    }else if(Array.isArray(value)&&schema.type==='array')return schema;
  }
  return best;
}

function normalizeStrictValue(value:unknown,schema:unknown):unknown{
  if(!schemaObject(schema)||value===null)return value;
  for(const key of ['anyOf','oneOf'] as const)if(Array.isArray(schema[key]))return normalizeStrictValue(value,matchingSchema(value,schema[key] as unknown[]));
  if(Array.isArray(value)&&schemaObject(schema.items))return value.map((item)=>normalizeStrictValue(item,schema.items));
  if(schemaObject(value)&&schemaObject(schema.properties)){
    const required=new Set(Array.isArray(schema.required)?schema.required.filter((item):item is string=>typeof item==='string'):[]);const result:JsonSchema={...value};
    for(const [name,propertySchema] of Object.entries(schema.properties)){
      if(result[name]===null&&!required.has(name)){delete result[name];continue;}
      if(Object.hasOwn(result,name))result[name]=normalizeStrictValue(result[name],propertySchema);
    }
    return result;
  }
  return value;
}

export function normalizeOpenAiStrictOutput(output:string,schema:unknown):string{
  try{return JSON.stringify(normalizeStrictValue(JSON.parse(output),schema));}catch{return output;}
}

export function normalizedResponsesUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const inputTokens = Number.isInteger(row.input_tokens) && Number(row.input_tokens) >= 0 && Number(row.input_tokens) <= MAX_STORED_TOKENS ? Number(row.input_tokens) : undefined;
  const outputTokens = Number.isInteger(row.output_tokens) && Number(row.output_tokens) >= 0 && Number(row.output_tokens) <= MAX_STORED_TOKENS ? Number(row.output_tokens) : undefined;
  return inputTokens === undefined && outputTokens === undefined ? undefined : {
    ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens })
  };
}

async function boundedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new AiProviderFailure('AI_RESPONSE_INVALID'); }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parsedArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function responsesTurn(payload: OpenAiPayload): AiProviderTurn {
  const usage = normalizedResponsesUsage(payload.usage);
  if (payload.status !== 'completed' || payload.incomplete_details || !Array.isArray(payload.output)) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  const texts: string[] = []; const toolCalls: Array<{id:string;name:string;arguments:unknown}> = [];
  for (const item of payload.output) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.type === 'function_call') { toolCalls.push({ id: String(row.call_id ?? ''), name: String(row.name ?? ''), arguments: parsedArguments(row.arguments) }); continue; }
    if (row.type !== 'message' || !Array.isArray(row.content)) continue;
    for (const part of row.content) {
      if (!part || typeof part !== 'object') continue;
      const content = part as Record<string, unknown>;
      if (content.type === 'refusal') throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) texts.push(content.text);
    }
  }
  // Some compatible model runtimes emit explanatory assistant text alongside a
  // valid function call. Intermediary text is not a final answer: the internal
  // contract deliberately remains a strict output/tool-call XOR.
  const output = toolCalls.length ? '' : texts.join('\n').trim();
  const parsed = aiProviderTurnSchema.safeParse({ ...(output ? { output } : {}), toolCalls, generatedAt: new Date().toISOString(), ...(usage ? { usage } : {}) });
  if (!parsed.success) throw new AiProviderFailure('AI_RESPONSE_INVALID', usage);
  return parsed.data;
}

function responseTools(tools: AiToolDefinition[]): unknown[] {
  return tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true }));
}

function combinedSignal(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; close: (abort?:boolean) => void } {
  const controller = new AbortController(); const abort = () => controller.abort();
  if (external?.aborted) controller.abort(); else external?.addEventListener('abort', abort, { once: true });
  const timeout = external ? undefined : setTimeout(abort, timeoutMs);
  return { signal: controller.signal, close: (cancel=false) => { if(timeout)clearTimeout(timeout); external?.removeEventListener('abort', abort);if(cancel)controller.abort(); } };
}

class OpenAiResponsesSession implements AiProviderSession {
  private input: unknown[];
  private pending = new Map<string,string>();
  private closed=false;
  constructor(
    private readonly task: AiTask, private readonly configuration: AiProviderConfiguration,
    private readonly aliases: AiToolNameAliases, private readonly transport: AiHttpTransport,
    private readonly timeoutMs: number, private readonly externalSignal?: AbortSignal,private readonly closeSession:()=>void=()=>{}
  ) { this.input = [{ role: 'user', content: [{ type: 'input_text', text: task.input }] }]; }

  close():void{if(this.closed)return;this.closed=true;this.closeSession();}

  async next(toolResults: AiToolResult[] = [], toolChoice:AiToolChoice='auto'): Promise<AiProviderTurn> {
    if(this.closed)throw new AiProviderFailure('AI_RESPONSE_INVALID');
    if (this.pending.size !== toolResults.length || toolResults.some((result) => this.pending.get(result.callId) !== result.name)){this.close();throw new AiProviderFailure('AI_RESPONSE_INVALID');}
    if (toolResults.length) {
      this.input.push(...toolResults.map((result) => ({ type: 'function_call_output', call_id: result.callId, output: result.output })));
      this.pending.clear();
    }
    const active = combinedSignal(this.externalSignal, this.timeoutMs);
    const aborted=new Promise<never>((_resolve,reject)=>active.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
    try {
      const response = await Promise.race([this.transport(OPENAI_RESPONSES_URL, {
        method: 'POST', headers: { authorization: `Bearer ${this.configuration.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.configuration.model, input: this.input, max_output_tokens: this.task.maxOutputTokens ?? 64, store: false,
          ...(this.aliases.wireTools.length===0&&this.pending.size===0&&this.task.responseSchema?{text:{format:{type:'json_schema',name:this.task.responseSchema.name,strict:true,schema:openAiStrictResponseSchema(this.task.responseSchema.schema)}}}:{}),
          ...(this.aliases.wireTools.length ? { tools: responseTools(this.aliases.wireTools), tool_choice:toolChoice, include:['reasoning.encrypted_content'] } : {})
        }), signal: active.signal
      }),aborted]);
      const text = await Promise.race([boundedText(response),aborted]); let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new AiProviderFailure(response.ok ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AiProviderFailure(response.ok ? 'AI_RESPONSE_INVALID' : 'AI_UPSTREAM_ERROR');
      const payload = parsed as OpenAiPayload; const usage = normalizedResponsesUsage(payload.usage);
      if (!response.ok) throw new AiProviderFailure('AI_UPSTREAM_ERROR', usage);
      let turn = internalizeAiProviderTurn(responsesTurn(payload),this.aliases);
      if(turn.output&&this.aliases.wireTools.length===0&&this.task.responseSchema)turn={...turn,output:normalizeOpenAiStrictOutput(turn.output,this.task.responseSchema.schema)};
      // Opaque reasoning/function-call items live only in this request-scoped adapter.
      this.input.push(...(payload.output as unknown[]));
      this.pending = new Map(turn.toolCalls.map((call) => [call.id, call.name]));
      return turn;
    } catch (error) {
      const timedOut=active.signal.aborted;this.close();if (timedOut) throw new AiProviderFailure('AI_TIMEOUT');
      if (error instanceof AiProviderFailure) throw error;
      throw new AiProviderFailure('AI_UPSTREAM_ERROR');
    } finally { active.close(); }
  }
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  constructor(private readonly transport: AiHttpTransport = fetch, private readonly timeoutMs = 10_000) {}

  createSession(rawTask: AiTask, configuration: AiProviderConfiguration, tools: AiToolDefinition[] = [], signal?: AbortSignal): AiProviderSession {
    const task = aiTaskSchema.parse(rawTask); validateAiProviderConfiguration(configuration);
    if (configuration.provider !== this.id || configuration.baseUrl) throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    const aliases=createAiToolNameAliases(tools);const lifetime=combinedSignal(signal,this.timeoutMs);
    return new OpenAiResponsesSession(task, configuration, aliases, this.transport, this.timeoutMs, lifetime.signal,()=>lifetime.close(true));
  }

  async execute(rawTask: AiTask, configuration: AiProviderConfiguration): Promise<AiResult> {
    const task = aiTaskSchema.parse(rawTask);const session=this.createSession(task,configuration);
    try{const turn=await session.next();if(!turn.output)throw new AiProviderFailure('AI_RESPONSE_INVALID',turn.usage);return aiResultSchema.parse({ output: turn.output, generatedAt: turn.generatedAt, uncertainty: 'unknown', sources: task.sources, ...(turn.usage ? { usage: turn.usage } : {}) });}
    finally{session.close();}
  }

  testConnection(configuration: AiProviderConfiguration): Promise<AiResult> {
    return this.execute({ operation: 'generate', purpose: 'connection_test', input: 'Reply with the single word OK.', modelTier: 'routine', sources: [] }, configuration);
  }
}
