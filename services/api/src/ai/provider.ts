import { createHash } from 'node:crypto';
import {
  aiProviderTurnSchema, aiResultSchema, aiTaskSchema, aiToolDefinitionSchema,
  type AiProviderId, type AiProviderTurn, type AiReasoningEffort, type AiResult,
  type AiTask, type AiToolDefinition, type AiToolResult
} from '@samvev/contracts';

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
  createSession(
    task: AiTask,
    configuration: AiProviderConfiguration,
    tools?: AiToolDefinition[],
    signal?: AbortSignal
  ): AiProviderSession;
  execute(task: AiTask, configuration: AiProviderConfiguration): Promise<AiResult>;
  testConnection(configuration: AiProviderConfiguration): Promise<AiResult>;
}

export type AiToolChoice = 'auto' | 'required';

const WIRE_TOOL_NAME=/^[A-Za-z0-9_-]{1,64}$/;
export interface AiToolNameAliases {
  readonly wireTools:AiToolDefinition[];
  toInternal(wireName:string):string;
  toWire(internalName:string):string;
}

/** Provider wire names are opaque request-local aliases; domain names never leave the adapter. */
export function createAiToolNameAliases(rawTools:AiToolDefinition[]):AiToolNameAliases{
  const tools=rawTools.map((tool)=>{const parsed=aiToolDefinitionSchema.safeParse(tool);if(!parsed.success)throw new AiProviderFailure('AI_CONFIGURATION_INVALID');return parsed.data;});
  const internalToWire=new Map<string,string>();const wireToInternal=new Map<string,string>();
  for(const tool of tools){
    if(internalToWire.has(tool.name))throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    const wireName=`samvev_${createHash('sha256').update(`samvev-tool-v1\0${tool.name}`).digest('hex').slice(0,56)}`;
    if(!WIRE_TOOL_NAME.test(wireName)||wireToInternal.has(wireName))throw new AiProviderFailure('AI_CONFIGURATION_INVALID');
    internalToWire.set(tool.name,wireName);wireToInternal.set(wireName,tool.name);
  }
  const lookup=(map:Map<string,string>,name:string)=>{const value=map.get(name);if(!value)throw new AiProviderFailure('AI_RESPONSE_INVALID');return value;};
  return{
    wireTools:tools.map((tool)=>({...tool,name:lookup(internalToWire,tool.name)})),
    toInternal:(wireName)=>{if(!WIRE_TOOL_NAME.test(wireName))throw new AiProviderFailure('AI_RESPONSE_INVALID');return lookup(wireToInternal,wireName);},
    toWire:(internalName)=>lookup(internalToWire,internalName)
  };
}

export function internalizeAiProviderTurn(turn:AiProviderTurn,aliases:AiToolNameAliases):AiProviderTurn{
  const ids=new Set<string>();const toolCalls=turn.toolCalls.map((call)=>{if(ids.has(call.id))throw new AiProviderFailure('AI_RESPONSE_INVALID',turn.usage);ids.add(call.id);return{...call,name:aliases.toInternal(call.name)};});
  return validateAiProviderTurn({...turn,toolCalls});
}

/** Stateful wire-protocol details stay inside one short-lived provider adapter session. */
export interface AiProviderSession {
  next(toolResults?: AiToolResult[], toolChoice?: AiToolChoice): Promise<AiProviderTurn>;
  close():void;
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
export function validateAiProviderTurn(value: unknown): AiProviderTurn { return aiProviderTurnSchema.parse(value); }
