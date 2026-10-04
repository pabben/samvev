import {
  aiProviderTurnSchema, aiResultSchema, aiTaskSchema,
  type AiProviderTurn, type AiResult, type AiTask, type AiToolDefinition, type AiToolResult
} from '@samvev/contracts';
import {
  AiProviderFailure, createAiToolNameAliases, internalizeAiProviderTurn, validateAiProviderConfiguration,
  type AiProvider, type AiProviderConfiguration, type AiProviderSession, type AiToolChoice, type AiToolNameAliases
} from './provider.ts';
import { normalizeOpenAiStrictOutput, openAiStrictResponseSchema, type AiHttpTransport } from './openai-provider.ts';

const RESPONSES_URL='https://api.openai.com/v1/responses';
const MAX_STREAM_BYTES=512*1024;

type TerminalEvent={type?:unknown;response?:unknown;error?:unknown};
function isObject(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function usageOf(response:Record<string,unknown>):AiProviderTurn['usage']|undefined{
  const raw=response.usage;if(!isObject(raw))return undefined;
  const input=typeof raw.input_tokens==='number'?raw.input_tokens:undefined;
  const output=typeof raw.output_tokens==='number'?raw.output_tokens:undefined;
  const inputDetails=isObject(raw.input_tokens_details)?raw.input_tokens_details:{};const outputDetails=isObject(raw.output_tokens_details)?raw.output_tokens_details:{};
  const cached=typeof inputDetails.cached_tokens==='number'?inputDetails.cached_tokens:undefined;const cacheWrite=typeof inputDetails.cache_write_tokens==='number'?inputDetails.cache_write_tokens:undefined;const reasoning=typeof outputDetails.reasoning_tokens==='number'?outputDetails.reasoning_tokens:undefined;
  const safe=(value:number|undefined)=>value===undefined?undefined:Number.isSafeInteger(value)&&value>=0&&value<=2_147_483_647?value:null;
  const values=[safe(input),safe(output),safe(cached),safe(cacheWrite),safe(reasoning)];
  if(values.includes(null))throw new AiProviderFailure('AI_RESPONSE_INVALID');
  return input===undefined&&output===undefined?undefined:{...(values[0]===undefined?{}:{inputTokens:values[0] as number}),...(values[1]===undefined?{}:{outputTokens:values[1] as number}),...(values[2]===undefined?{}:{cachedInputTokens:values[2] as number}),...(values[3]===undefined?{}:{cacheWriteTokens:values[3] as number}),...(values[4]===undefined?{}:{reasoningTokens:values[4] as number})};
}
function failureFor(value:unknown,usage?:AiProviderTurn['usage'],response?:Record<string,unknown>):AiProviderFailure{
  const metadata=[typeof response?.model==='string'?response.model:undefined,typeof response?.service_tier==='string'?response.service_tier:undefined] as const;
  const code=isObject(value)&&typeof value.code==='string'?value.code:'';
  if(code==='subscription_sharing_usage_limit_exceeded')return new AiProviderFailure('AI_PLAN_USAGE_LIMITED',usage,'upstream_rate_limited',...metadata);
  if(code==='subscription_sharing_usage_unavailable')return new AiProviderFailure('AI_PROVIDER_UNAVAILABLE',usage,'upstream_http_5xx',...metadata);
  if(code==='subscription_sharing_not_eligible'||code==='subscription_sharing_user_not_eligible'||code==='subscription_sharing_route_not_supported')return new AiProviderFailure('AI_PLAN_NOT_ELIGIBLE',usage,'upstream_http_4xx',...metadata);
  if(code==='subscription_sharing_invalid_user'||code==='chatpass_v2_invalid_authorization_context')return new AiProviderFailure('AI_REAUTHORIZATION_REQUIRED',usage,'upstream_http_4xx',...metadata);
  if(code==='chatpass_v2_scope_not_authorized')return new AiProviderFailure('AI_PLAN_PERMISSION_REQUIRED',usage,'upstream_http_4xx',...metadata);
  return new AiProviderFailure('AI_UPSTREAM_ERROR',usage,undefined,...metadata);
}
function terminalTurn(event:TerminalEvent,aliases:AiToolNameAliases):AiProviderTurn{
  if(event.type!=='response.completed'||!isObject(event.response)||event.response.status!=='completed')throw new AiProviderFailure('AI_RESPONSE_INVALID');
  const response=event.response;const usage=usageOf(response);const output=Array.isArray(response.output)?response.output:[];
  const chunks:string[]=[];const calls:Array<{id:string;name:string;arguments:unknown}>=[];
  for(const item of output){
    if(!isObject(item))continue;
    if(item.type==='function_call'&&typeof item.call_id==='string'&&typeof item.name==='string'){
      if(item.namespace!==undefined&&item.namespace!=='samvev')throw new AiProviderFailure('AI_RESPONSE_INVALID',usage);
      let args:unknown={};try{args=typeof item.arguments==='string'?JSON.parse(item.arguments):item.arguments;}catch{throw new AiProviderFailure('AI_RESPONSE_INVALID',usage);}
      calls.push({id:item.call_id,name:item.name.startsWith('samvev.')?item.name.slice('samvev.'.length):item.name,arguments:args});continue;
    }
    if(item.type==='message'&&Array.isArray(item.content))for(const content of item.content)if(isObject(content)&&content.type==='output_text'&&typeof content.text==='string')chunks.push(content.text);
  }
  const parsed=aiProviderTurnSchema.safeParse({...(!calls.length&&chunks.join('').trim()?{output:chunks.join('').trim()}:{}),toolCalls:calls,generatedAt:new Date().toISOString(),...(typeof response.model==='string'?{actualModel:response.model}:{}),...(typeof response.service_tier==='string'?{actualServiceTier:response.service_tier}:{}),...(usage?{usage}:{})});
  if(!parsed.success)throw new AiProviderFailure('AI_RESPONSE_INVALID',usage);
  return internalizeAiProviderTurn(parsed.data,aliases);
}
async function readTerminal(response:Response,signal:AbortSignal):Promise<TerminalEvent>{
  if(!response.ok){let value:unknown;try{value=await response.json();}catch{value={};}throw failureFor(isObject(value)?value.error:value);}
  if(!response.body)throw new AiProviderFailure('AI_STREAM_INTERRUPTED');
  const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';let bytes=0;let terminal:TerminalEvent|undefined;
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>MAX_STREAM_BYTES)throw new AiProviderFailure('AI_RESPONSE_INVALID');
      buffer=(buffer+decoder.decode(chunk.value,{stream:true})).replace(/\r\n/g,'\n');
      let split:number;while((split=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,split).replace(/\r/g,'');buffer=buffer.slice(split+2);const data=block.split('\n').filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trim()).join('\n');if(!data||data==='[DONE]')continue;let event:TerminalEvent;try{event=JSON.parse(data) as TerminalEvent;}catch{throw new AiProviderFailure('AI_RESPONSE_INVALID');}
        if(event.type==='response.failed'||event.type==='response.incomplete'||event.type==='error'){const failed=isObject(event.response)?event.response:undefined;throw failureFor(failed?failed.error:event.error,failed?usageOf(failed):undefined,failed);}
        if(event.type==='response.completed'){terminal=event;await reader.cancel();return terminal;}
      }
    }
  }catch(error){if(signal.aborted)throw new AiProviderFailure('AI_TIMEOUT');if(error instanceof AiProviderFailure)throw error;throw new AiProviderFailure('AI_STREAM_INTERRUPTED');}finally{reader.releaseLock();}
  if(!terminal)throw new AiProviderFailure('AI_STREAM_INTERRUPTED');return terminal;
}
function responseTools(tools:AiToolDefinition[]):unknown[]{return tools.length?[{type:'namespace',name:'samvev',description:'Approved Samvev local tools',tools:tools.map((tool)=>({type:'function',name:tool.name,description:tool.description,parameters:tool.inputSchema,strict:true}))}]:[];}

class ChatGptSession implements AiProviderSession{
  private input:unknown[];private pending=new Map<string,string>();private closed=false;private active?:AbortController;
  constructor(private task:AiTask,private configuration:AiProviderConfiguration,private aliases:AiToolNameAliases,private transport:AiHttpTransport,private signal?:AbortSignal){this.input=[{role:'user',content:[{type:'input_text',text:task.input}]}];}
  close(){this.closed=true;this.active?.abort();}
  async next(results:AiToolResult[]=[],toolChoice:AiToolChoice='auto'):Promise<AiProviderTurn>{
    if(this.closed)throw new AiProviderFailure('AI_RESPONSE_INVALID');
    if(results.length!==this.pending.size||results.some((result)=>this.pending.get(result.callId)!==result.name))throw new AiProviderFailure('AI_RESPONSE_INVALID');
    if(results.length){this.input.push(...results.map((result)=>({type:'function_call_output',call_id:result.callId,output:result.output})));this.pending.clear();}
    const controller=new AbortController();this.active=controller;const timeout=setTimeout(()=>controller.abort(),15_000);const abort=()=>controller.abort();if(this.signal?.aborted)controller.abort();else this.signal?.addEventListener('abort',abort,{once:true});
    try{
      if(controller.signal.aborted)throw new AiProviderFailure('AI_TIMEOUT');
      await this.configuration.beforeDispatch?.();
      if(controller.signal.aborted)throw new AiProviderFailure('AI_TIMEOUT');
      this.configuration.onWireStart?.();
      const response=await this.transport(RESPONSES_URL,{method:'POST',headers:{authorization:`Bearer ${this.configuration.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:this.configuration.model,instructions:'Follow the user request and return only the requested result.',input:this.input,store:false,stream:true,...(this.configuration.reasoningEffort&&this.configuration.reasoningEffort!=='none'?{reasoning:{effort:this.configuration.reasoningEffort}}:{}),...(this.aliases.wireTools.length?{tools:responseTools(this.aliases.wireTools),tool_choice:toolChoice,include:['reasoning.encrypted_content']}:{...(this.task.responseSchema?{text:{format:{type:'json_schema',name:this.task.responseSchema.name,strict:true,schema:openAiStrictResponseSchema(this.task.responseSchema.schema)}}}: {})})}),signal:controller.signal});
      const terminal=await readTerminal(response,controller.signal);let turn=terminalTurn(terminal,this.aliases);if(turn.output&&!this.aliases.wireTools.length&&this.task.responseSchema)turn={...turn,output:normalizeOpenAiStrictOutput(turn.output,this.task.responseSchema.schema)};if(isObject(terminal.response)&&Array.isArray(terminal.response.output))this.input.push(...terminal.response.output);
      this.pending=new Map(turn.toolCalls.map((call)=>[call.id,call.name]));
      return turn;
    }finally{clearTimeout(timeout);this.signal?.removeEventListener('abort',abort);if(this.active===controller)this.active=undefined;}
  }
}

export class ChatGptSubscriptionProvider implements AiProvider{
  readonly id='chatgpt_subscription' as const;
  constructor(private transport:AiHttpTransport=fetch){}
  createSession(rawTask:AiTask,configuration:AiProviderConfiguration,tools:AiToolDefinition[]=[],signal?:AbortSignal):AiProviderSession{
    const task=aiTaskSchema.parse(rawTask);validateAiProviderConfiguration(configuration);
    if(configuration.provider!==this.id||configuration.baseUrl||!configuration.apiKey)throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    return new ChatGptSession(task,configuration,createAiToolNameAliases(tools),this.transport,signal);
  }
  async execute(task:AiTask,configuration:AiProviderConfiguration):Promise<AiResult>{const parsed=aiTaskSchema.parse(task);const session=this.createSession(parsed,configuration);try{const turn=await session.next();if(!turn.output)throw new AiProviderFailure('AI_RESPONSE_INVALID',turn.usage);return aiResultSchema.parse({output:turn.output,generatedAt:turn.generatedAt,uncertainty:'unknown',sources:parsed.sources,...(turn.actualModel?{actualModel:turn.actualModel}:{}),...(turn.actualServiceTier?{actualServiceTier:turn.actualServiceTier}:{}),...(turn.usage?{usage:turn.usage}:{})});}finally{session.close();}}
  testConnection(configuration:AiProviderConfiguration):Promise<AiResult>{return this.execute({operation:'generate',purpose:'connection_test',input:'Reply with the single word OK.',modelTier:'routine',sources:[]},configuration);}
}
