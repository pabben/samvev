import assert from 'node:assert/strict';
import test from 'node:test';
import {DomainError} from '@samvev/core';
import type {AiTask,AiToolDefinition} from '@samvev/contracts';
import {OpenAiProvider} from './openai-provider.ts';
import {OpenAiCompatibleProvider} from './openai-compatible-provider.ts';
import {AnthropicProvider} from './anthropic-provider.ts';
import {AiProviderFailure} from './provider.ts';
const task:AiTask={operation:'generate',purpose:'synthetic_security',input:'Synthetic',modelTier:'routine',sources:[]};
const tool:AiToolDefinition={name:'synthetic.tool',description:'Synthetic',inputSchema:{type:'object',properties:{},additionalProperties:false}};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status});}

test('OpenAI API and compatible reject duplicate result IDs and preserve prewire policy rejection',async()=>{
 for(const compatible of [false,true]){
  let calls=0;const transport=async(_url:string,init:RequestInit)=>{calls++;const body=JSON.parse(String(init.body));return compatible?json({choices:[{message:{role:'assistant',tool_calls:['a','b'].map(id=>({id,type:'function',function:{name:body.tools[0].function.name,arguments:'{}'}}))},finish_reason:'tool_calls'}]}):json({status:'completed',output:['a','b'].map(call_id=>({type:'function_call',call_id,name:body.tools[0].name,arguments:'{}'}))});};
  const provider=compatible?new OpenAiCompatibleProvider(transport):new OpenAiProvider(transport);
  const config=compatible?{provider:'openai_compatible' as const,model:'synthetic',baseUrl:'http://127.0.0.1:11434/v1'}:{provider:'openai' as const,model:'synthetic',apiKey:'synthetic-only'};
  const s=provider.createSession(task,config,[tool]);await s.next();await assert.rejects(s.next([{callId:'a',name:tool.name,output:'Synthetic'},{callId:'a',name:tool.name,output:'Synthetic'}]),(e:any)=>e.code==='AI_RESPONSE_INVALID');assert.equal(calls,1);s.close();
  const denied=provider.createSession(task,{...config,beforeDispatch:async()=>{throw new DomainError('AI_DAILY_DISPATCH_LIMIT',429);}},[tool]);await assert.rejects(denied.next(),(e:any)=>e.code==='AI_DAILY_DISPATCH_LIMIT');assert.equal(calls,1);denied.close();
 }
});

test('Anthropic malformed server body and unrecognized postwire errors never authorize fallback',async()=>{
 for(const transport of [async()=>new Response('malformed',{status:503}),async()=>json({no_error_envelope:true},503),async()=>{throw new Error('synthetic local failure');}]){
  await assert.rejects(new AnthropicProvider(transport).execute(task,{provider:'anthropic',model:'claude-haiku-5-5',apiKey:'synthetic'}),(e:unknown)=>e instanceof AiProviderFailure&&e.fallbackReason===undefined);
 }
});
