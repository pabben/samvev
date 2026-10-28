import { aiProviderTurnSchema, aiResultSchema, aiTaskSchema, type AiProviderTurn, type AiResult, type AiTask, type AiToolDefinition, type AiToolResult } from '@samvev/contracts';
import { AiProviderFailure, createAiToolNameAliases, internalizeAiProviderTurn, validateAiProviderConfiguration, type AiFailureCode, type AiProvider, type AiProviderConfiguration, type AiProviderSession, type AiToolChoice } from './provider.ts';
import type { AiHttpTransport } from './openai-provider.ts';

const ANTHROPIC_MESSAGES_URL='https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION='2026-10-21';
const MAX_RESPONSE_BYTES=256*1024;
const MAX_STORED_TOKENS=2_147_483_647;
type JsonObject=Record<string,unknown>;

function object(value:unknown):value is JsonObject{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function safeCount(value:unknown):number|undefined{return Number.isInteger(value)&&Number(value)>=0&&Number(value)<=MAX_STORED_TOKENS?Number(value):undefined;}

/** Anthropic's base input count excludes cache read and creation tokens. Keep the
 * normalized total truthful while preserving the two separately reportable values. */
export function normalizedAnthropicUsage(value:unknown):AiProviderTurn['usage']{
  if(!object(value))return undefined;
  const base=safeCount(value.input_tokens),read=safeCount(value.cache_read_input_tokens),write=safeCount(value.cache_creation_input_tokens),output=safeCount(value.output_tokens);
  const total=base===undefined?undefined:base+(read??0)+(write??0);
  const inputTokens=total!==undefined&&total<=MAX_STORED_TOKENS?total:undefined;
  return inputTokens===undefined&&output===undefined&&read===undefined&&write===undefined?undefined:{...(inputTokens===undefined?{}:{inputTokens}),...(output===undefined?{}:{outputTokens:output}),...(read===undefined?{}:{cachedInputTokens:read}),...(write===undefined?{}:{cacheWriteTokens:write})};
}

function hasRetryAfter(value:string|null):boolean{
  if(!value)return false;
  const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return true;
  const date=Date.parse(value);return Number.isFinite(date)&&date>Date.now();
}

function mapHttpFailure(status:number,body:unknown,retryAfter=false):AiProviderFailure{
  const error=object(body)&&object(body.error)?body.error:{};
  const type=typeof error.type==='string'?error.type:'';
  const message=typeof error.message==='string'?error.message.toLowerCase().slice(0,2048):'';
  if(/spend|spending|credit balance|monthly limit|workspace limit|organization limit|usage limit|spend cap/.test(message))return new AiProviderFailure('AI_BILLING_REQUIRED',undefined,'upstream_http_4xx');
  if(type==='billing_error'||status===402||/billing|payment required|insufficient credit/.test(message))return new AiProviderFailure('AI_BILLING_REQUIRED',undefined,'upstream_http_4xx');
  if(type==='authentication_error'||status===401)return new AiProviderFailure('AI_KEY_INVALID',undefined,'upstream_http_4xx');
  if(type==='permission_error'||status===403)return new AiProviderFailure('AI_PERMISSION_DENIED',undefined,'upstream_http_4xx');
  if(type==='not_found_error'||status===404||/model.{0,30}(not found|does not exist|unavailable)/.test(message))return new AiProviderFailure('AI_MODEL_UNAVAILABLE',undefined,'upstream_http_4xx');
  if(type==='rate_limit_error')return new AiProviderFailure('AI_PROVIDER_RATE_LIMITED',undefined,'upstream_rate_limited',undefined,undefined,retryAfter? 'provider_rate_limited':undefined);
  if(status===429)return new AiProviderFailure('AI_PROVIDER_RATE_LIMITED',undefined,'upstream_http_other');
  if(['api_error','overloaded_error','timeout_error'].includes(type)&&(status===408||status>=500))return new AiProviderFailure(status===408||status===504?'AI_TIMEOUT':'AI_UPSTREAM_ERROR',undefined,status>=500?'upstream_http_5xx':'upstream_http_other',undefined,undefined,'transient');
  if(status>=400&&status<500)return new AiProviderFailure('AI_UPSTREAM_ERROR',undefined,'upstream_http_4xx');
  return new AiProviderFailure('AI_UPSTREAM_ERROR',undefined,'upstream_http_other');
}

async function boundedText(response:Response):Promise<string>{
  if(!response.body)return '';
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new AiProviderFailure('AI_RESPONSE_INVALID');}chunks.push(part.value);}
  return Buffer.concat(chunks).toString('utf8');
}

const unsupportedSchemaConstraints=['minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','uniqueItems','minItems','maxItems'];
function wireSchema(value:unknown):unknown{
  if(Array.isArray(value))return value.map(wireSchema);
  if(!object(value))return value;
  const result:JsonObject={};const constraints:string[]=[];
  for(const [key,item] of Object.entries(value)){
    if(unsupportedSchemaConstraints.includes(key)){constraints.push(`${key}=${JSON.stringify(item)}`);continue;}
    if(key==='properties'&&object(item)){result.properties=Object.fromEntries(Object.entries(item).map(([name,schema])=>[name,wireSchema(schema)]));continue;}
    if(key==='patternProperties'&&object(item)){result.patternProperties=Object.fromEntries(Object.entries(item).map(([name,schema])=>[name,wireSchema(schema)]));continue;}
    if(['items','additionalProperties','not','if','then','else','contains','propertyNames'].includes(key)){result[key]=wireSchema(item);continue;}
    if(['anyOf','oneOf','allOf','prefixItems'].includes(key)){result[key]=wireSchema(item);continue;}
    result[key]=item;
  }
  if(value.type==='object'||Array.isArray(value.type)&&value.type.includes('object'))result.additionalProperties=false;
  if(constraints.length){const existing=typeof result.description==='string'?result.description:'';result.description=[existing,...constraints.map(item=>`Original schema also specifies ${item}.`)].filter(Boolean).join(' ');}
  return result;
}

function parseTurn(payload:JsonObject):AiProviderTurn{
  const usage=normalizedAnthropicUsage(payload.usage),actualModel=typeof payload.model==='string'?payload.model:undefined;
  if(payload.stop_reason==='refusal')throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);
  if(payload.stop_reason==='max_tokens'||!Array.isArray(payload.content))throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);
  const texts:string[]=[],toolCalls:Array<{id:string;name:string;arguments:unknown}>=[],ids=new Set<string>();
  for(const block of payload.content){
    if(!object(block))throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);
    if(block.type==='text'){if(typeof block.text!=='string')throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);if(block.text.trim())texts.push(block.text);continue;}
    if(block.type==='tool_use'){
      if(typeof block.id!=='string'||!block.id||ids.has(block.id)||typeof block.name!=='string'||!object(block.input))throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);
      ids.add(block.id);
      toolCalls.push({id:block.id,name:block.name,arguments:block.input});continue;
    }
    if(block.type==='thinking'||block.type==='redacted_thinking')continue;
    throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);
  }
  const output=toolCalls.length?'':texts.join('\n').trim();
  const parsed=aiProviderTurnSchema.safeParse({...(output?{output}:{}),toolCalls,generatedAt:new Date().toISOString(),...(actualModel?{actualModel}:{}),...(usage?{usage}:{})});
  if(!parsed.success)throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,undefined,actualModel);
  return parsed.data;
}

function combinedSignal(signal:AbortSignal|undefined,timeoutMs:number):{signal:AbortSignal;timedOut:()=>boolean;close:(cancel?:boolean)=>void}{
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  let didTimeout=false;const timeout=signal?undefined:setTimeout(()=>{didTimeout=true;abort();},timeoutMs);
  return{signal:controller.signal,timedOut:()=>didTimeout,close:(cancel=false)=>{if(timeout)clearTimeout(timeout);signal?.removeEventListener('abort',abort);if(cancel)controller.abort();}};
}

class AnthropicSession implements AiProviderSession{
  private messages:Array<JsonObject>;
  private pending=new Map<string,string>();
  private closed=false;
  private readonly model:string;
  private apiKey:string;
  private readonly maxOutputTokens:number;
  private readonly responseSchema:AiTask['responseSchema'];
  private readonly aliases:ReturnType<typeof createAiToolNameAliases>;
  private readonly toolsForSession:AiToolDefinition[];
  private beforeDispatch?:AiProviderConfiguration['beforeDispatch'];
  private onWireStart?:AiProviderConfiguration['onWireStart'];
  private active?:ReturnType<typeof combinedSignal>;
  constructor(task:AiTask,configuration:AiProviderConfiguration,tools:ReturnType<typeof createAiToolNameAliases>,private readonly transport:AiHttpTransport,private readonly timeoutMs:number,private readonly externalSignal?:AbortSignal){
    this.model=configuration.model;this.apiKey=configuration.apiKey??'';this.maxOutputTokens=task.maxOutputTokens??512;this.responseSchema=task.responseSchema;this.aliases=tools;this.toolsForSession=tools.wireTools;this.beforeDispatch=configuration.beforeDispatch;this.onWireStart=configuration.onWireStart;
    this.messages=[{role:'user',content:task.input}];
  }
  close():void{if(this.closed)return;this.closed=true;this.messages=[];this.pending.clear();this.apiKey='';this.beforeDispatch=undefined;this.onWireStart=undefined;this.active?.close(true);this.active=undefined;}
  async next(results:AiToolResult[]=[],toolChoice:AiToolChoice='auto'):Promise<AiProviderTurn>{
    if(this.closed)throw new AiProviderFailure('AI_RESPONSE_INVALID');
    const ids=new Set(results.map(result=>result.callId));
    if(ids.size!==results.length||this.pending.size!==results.length||results.some(result=>this.pending.get(result.callId)!==result.name)){this.close();throw new AiProviderFailure('AI_RESPONSE_INVALID');}
    if(results.length){this.messages.push({role:'user',content:results.map(result=>({type:'tool_result',tool_use_id:result.callId,content:result.output}))});this.pending.clear();}
    const active=combinedSignal(this.externalSignal,this.timeoutMs);this.active=active;let rejectAbort:(error:Error)=>void=()=>{};const onAbort=()=>rejectAbort(new DOMException('aborted','AbortError'));let aborted:Promise<never>|undefined,wireStarted=false;
    try{
      if(active.signal.aborted)throw new DOMException('aborted','AbortError');
      await this.beforeDispatch?.();if(active.signal.aborted)throw new DOMException('aborted','AbortError');this.onWireStart?.();wireStarted=true;
      aborted=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;active.signal.addEventListener('abort',onAbort,{once:true});});
      // The verified Haiku 5.5 API supports forced tools. Other/unknown IDs
      // use auto; the same server-side required-tool check applies to all.
      const supportsForcedTools=/^claude-haiku-5-5(?:-|$)/.test(this.model);
      const response=await Promise.race([this.transport(ANTHROPIC_MESSAGES_URL,{method:'POST',headers:{authorization:`Bearer ${this.apiKey}`,'content-type':'application/json','anthropic-version':ANTHROPIC_VERSION},body:JSON.stringify({model:this.model,max_tokens:this.maxOutputTokens,stream:false,messages:this.messages,...(this.responseSchema&&!this.toolsForSession.length?{output_config:{format:{type:'json_schema',schema:wireSchema(this.responseSchema.schema)}}}:{}),...(this.toolsForSession.length?{tools:this.toolsForSession.map(tool=>({name:tool.name,description:tool.description,input_schema:wireSchema(tool.inputSchema),strict:true})),tool_choice:toolChoice==='required'&&supportsForcedTools?{type:'any'}:{type:'auto'}}:{})}),signal:active.signal}).catch(error=>{if(error instanceof TypeError)throw new AiProviderFailure('AI_UPSTREAM_ERROR',undefined,'network_error',undefined,undefined,'network_error');throw error;}),aborted]);
      const text=await Promise.race([boundedText(response),aborted]);let body:unknown;try{body=JSON.parse(text);}catch{throw response.ok?new AiProviderFailure('AI_RESPONSE_INVALID'):new AiProviderFailure('AI_UPSTREAM_ERROR',undefined,'upstream_invalid_json');}
      if(!object(body)){throw response.ok?new AiProviderFailure('AI_RESPONSE_INVALID'):new AiProviderFailure('AI_UPSTREAM_ERROR',undefined,'upstream_invalid_json');}
      const usage=normalizedAnthropicUsage(body.usage),actualModel=typeof body.model==='string'?body.model:undefined;
      if(!response.ok){const failure=mapHttpFailure(response.status,body,hasRetryAfter(response.headers.get('retry-after')));throw new AiProviderFailure(failure.code,usage,failure.responseReason,actualModel,undefined,failure.fallbackReason);}
      const turn=internalizeAiProviderTurn(parseTurn(body),this.aliases);
      if(toolChoice==='required'&&this.toolsForSession.length&&!turn.toolCalls.length)throw new AiProviderFailure('AI_RESPONSE_INVALID',usage,'invalid_tool_calls',actualModel);
      // Preserve every provider block, including thinking/signature blocks, only in
      // this request-local history. They are never exposed as answer text or logged.
      this.messages.push({role:'assistant',content:body.content as unknown[]});
      this.pending=new Map(turn.toolCalls.map(call=>[call.id,call.name]));
      return turn;
    }catch(error){const timedOut=active.timedOut();const wasAborted=active.signal.aborted;this.close();if(timedOut)throw new AiProviderFailure('AI_TIMEOUT');if(wasAborted)throw new AiProviderFailure('AI_STREAM_INTERRUPTED');if(error instanceof AiProviderFailure)throw error;if(!wireStarted)throw error;throw new AiProviderFailure('AI_UPSTREAM_ERROR');}
    finally{if(aborted)active.signal.removeEventListener('abort',onAbort);active.close();if(this.active===active)this.active=undefined;}
  }
}

export class AnthropicProvider implements AiProvider{
  readonly id='anthropic' as const;
  constructor(private readonly transport:AiHttpTransport=fetch,private readonly timeoutMs=10_000){}
  createSession(rawTask:AiTask,configuration:AiProviderConfiguration,tools:AiToolDefinition[]=[],signal?:AbortSignal):AiProviderSession{
    const task=aiTaskSchema.parse(rawTask);validateAiProviderConfiguration(configuration);
    if(configuration.provider!==this.id||configuration.baseUrl)throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    const aliases=createAiToolNameAliases(tools);
    return new AnthropicSession(task,configuration,aliases,this.transport,this.timeoutMs,signal);
  }
  async execute(rawTask:AiTask,configuration:AiProviderConfiguration):Promise<AiResult>{const task=aiTaskSchema.parse(rawTask),session=this.createSession(task,configuration);try{const turn=await session.next();if(!turn.output)throw new AiProviderFailure('AI_RESPONSE_INVALID',turn.usage,undefined,turn.actualModel);return aiResultSchema.parse({output:turn.output,generatedAt:turn.generatedAt,uncertainty:'unknown',sources:task.sources,...(turn.actualModel?{actualModel:turn.actualModel}:{}),...(turn.usage?{usage:turn.usage}:{})});}finally{session.close();}}
  testConnection(configuration:AiProviderConfiguration):Promise<AiResult>{return this.execute({operation:'generate',purpose:'connection_test',input:'Reply with the single word OK.',modelTier:'routine',sources:[]},configuration);}
}
