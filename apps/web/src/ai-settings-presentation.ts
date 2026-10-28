export type AiProviderId = 'openai'|'anthropic'|'openai_compatible'|'chatgpt_subscription'|'gemini';
export type AiFallbackProvider = 'openai'|'anthropic'|'openai_compatible';
export type SavedAiProvider = {provider:AiProviderId;configured:boolean;runtimeAvailable:boolean};

export function fallbackProviderChoices(saved:SavedAiProvider[],primary:AiProviderId):AiFallbackProvider[]{
  if(primary==='chatgpt_subscription')return [];
  return saved.filter((entry):entry is SavedAiProvider&{provider:AiFallbackProvider}=>
    entry.configured&&entry.runtimeAvailable&&entry.provider!==primary&&
    ['openai','anthropic','openai_compatible'].includes(entry.provider)
  ).map(entry=>entry.provider);
}

export function dailyDispatchLimitIsValid(enabled:boolean,value:string):boolean{
  if(!enabled)return true;
  if(!/^\d+$/.test(value))return false;
  const limit=Number(value);
  return Number.isSafeInteger(limit)&&limit>=1&&limit<=1_000_000;
}
