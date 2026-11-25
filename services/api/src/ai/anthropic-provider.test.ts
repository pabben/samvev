import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicProvider, normalizedAnthropicUsage } from './anthropic-provider.ts';
import { AiProviderFailure, type AiProviderConfiguration } from './provider.ts';
import { DomainError } from '@samvev/core';
import type { AiHttpTransport } from './openai-provider.ts';
import type { AiTask } from '@samvev/contracts';

const task:AiTask={operation:'generate',purpose:'synthetic_test',input:'Return a synthetic answer.',modelTier:'routine',maxOutputTokens:64,sources:[]};
const config:AiProviderConfiguration={provider:'anthropic',model:'claude-haiku-5-5',apiKey:'synthetic-anthropic-key'};
function response(body:unknown,status=200,headers:Record<string,string>={}):Response{return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});}

test('Anthropic Messages sends bounded non-streaming request and preserves actual model and token usage',async()=>{
  let sent:RequestInit|undefined,url='';
  const transport:AiHttpTransport=async(target,init)=>{url=target;sent=init;return response({id:'msg_synthetic',type:'message',role:'assistant',model:'claude-haiku-5-5-20261021',stop_reason:'end_turn',content:[{type:'text',text:'Synthetic answer'}],usage:{input_tokens:11,cache_read_input_tokens:3,cache_creation_input_tokens:2,output_tokens:7}});};
  const turn=await new AnthropicProvider(transport).createSession(task,config).next();
  assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(turn.output,'Synthetic answer');assert.equal(turn.actualModel,'claude-haiku-5-5-20261021');assert.deepEqual(turn.usage,{inputTokens:16,outputTokens:7,cachedInputTokens:3,cacheWriteTokens:2});
  const headers=sent!.headers as Record<string,string>;assert.equal(headers.authorization,'Bearer synthetic-anthropic-key');assert.equal(headers['anthropic-version'],'2026-10-21');
  const body=JSON.parse(String(sent!.body));assert.equal(body.stream,false);assert.equal(body.temperature,undefined);assert.equal(body.top_p,undefined);assert.equal(body.model,'claude-haiku-5-5');assert.equal(body.max_tokens,64);
});

test('Anthropic tool turns preserve opaque thinking blocks only in session replay and validate result identity',async()=>{
  const requests:unknown[]=[];
  const transport:AiHttpTransport=async(_url,init)=>{const body=JSON.parse(String(init.body));requests.push(body);return body.messages.length===1?response({model:'claude-sonnet-5-5',stop_reason:'tool_use',content:[{type:'thinking',thinking:'private synthetic thought',signature:'opaque-sig'},{type:'tool_use',id:'toolu_synthetic',name:body.tools[0].name,input:{url:'https://example.test.invalid'}}],usage:{input_tokens:10,output_tokens:4}}):response({model:'claude-sonnet-5-5',stop_reason:'end_turn',content:[{type:'text',text:'Done'}],usage:{input_tokens:8,output_tokens:2}});};
  const session=new AnthropicProvider(transport).createSession(task,config,[{name:'web.open',description:'Open a source',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}}]);
  const first=await session.next([], 'required');assert.equal(first.toolCalls[0]?.name,'web.open');
  await assert.rejects(session.next([{callId:'toolu_wrong',name:'web.open',output:'synthetic'}]),(error:unknown)=>error instanceof AiProviderFailure&&error.code==='AI_RESPONSE_INVALID');
  session.close();

  const followup=new AnthropicProvider(transport).createSession(task,config,[{name:'web.open',description:'Open a source',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}}]);
  await followup.next();const done=await followup.next([{callId:'toolu_synthetic',name:'web.open',output:'synthetic result'}]);assert.equal(done.output,'Done');
  const second=requests[2] as {messages:Array<{role:string;content:unknown}>};assert.deepEqual(second.messages[1]?.content,[{type:'thinking',thinking:'private synthetic thought',signature:'opaque-sig'},{type:'tool_use',id:'toolu_synthetic',name:(requests[1] as {tools:Array<{name:string}>}).tools[0]!.name,input:{url:'https://example.test.invalid'}}]);
  assert.deepEqual(second.messages[2]?.content,[{type:'tool_result',tool_use_id:'toolu_synthetic',content:'synthetic result'}]);
  assert.equal(((requests[0] as {tool_choice:{type:string}}).tool_choice).type,'any');followup.close();
});

test('Anthropic rejects duplicate upstream call IDs and duplicate result IDs for multiple calls to the same tool',async()=>{
  const tool={name:'web.open',description:'Open a source',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}};
  const duplicateUpstream=new AnthropicProvider(async(_url,init)=>{const body=JSON.parse(String(init.body));const name=body.tools[0].name;return response({model:'claude-haiku-5-5',stop_reason:'tool_use',content:[{type:'tool_use',id:'same-id',name,input:{url:'https://example.test.invalid/a'}},{type:'tool_use',id:'same-id',name,input:{url:'https://example.test.invalid/b'}}]});});
  await assert.rejects(duplicateUpstream.createSession(task,config,[tool]).next(),(error:unknown)=>error instanceof AiProviderFailure&&error.code==='AI_RESPONSE_INVALID');
  const multipleCalls=new AnthropicProvider(async(_url,init)=>{const body=JSON.parse(String(init.body));const name=body.tools[0].name;return response({model:'claude-haiku-5-5',stop_reason:'tool_use',content:[{type:'tool_use',id:'first-id',name,input:{url:'https://example.test.invalid/a'}},{type:'tool_use',id:'second-id',name,input:{url:'https://example.test.invalid/b'}}]});});
  const session=multipleCalls.createSession(task,config,[tool]);const turn=await session.next();assert.equal(turn.toolCalls.length,2);
  await assert.rejects(session.next([{callId:'first-id',name:'web.open',output:'first'},{callId:'first-id',name:'web.open',output:'duplicate'}]),(error:unknown)=>error instanceof AiProviderFailure&&error.code==='AI_RESPONSE_INVALID');
});

test('Anthropic response schema is sent for plain generation and unsuitable wire constraints are stripped',async()=>{
  let sentBody:Record<string,unknown>|undefined;
  const transport:AiHttpTransport=async(_url,init)=>{sentBody=JSON.parse(String(init.body));return response({model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:'{"name":"Synthetic"}'}],usage:{input_tokens:1,output_tokens:2}});};
  await new AnthropicProvider(transport).createSession({...task,responseSchema:{name:'synthetic_result',schema:{type:'object',properties:{name:{type:'string',minLength:1,maxLength:80},minimum:{type:'string'},maxLength:{type:'string'}},required:['name','minimum','maxLength'],additionalProperties:false}}},config).next();
  const format=(sentBody!.output_config as {format:Record<string,unknown>}).format;
  assert.equal(format.name,undefined);
  const schema=format.schema as {properties:Record<string,{description?:string}>;additionalProperties:boolean};
  assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.minimum);assert.ok(schema.properties.maxLength);assert.match(schema.properties.name!.description!,/Original schema also specifies minLength=1/);assert.match(schema.properties.name!.description!,/Original schema also specifies maxLength=80/);
});

test('Anthropic failures normalize safe key, billing, rate and model errors without upstream text',async()=>{
  const cases:Array<[number,unknown,string,string,boolean,string|undefined]>=[
    [401,{type:'authentication_error',message:'synthetic upstream private body'},'AI_KEY_INVALID','upstream_http_4xx',false,undefined],
    [402,{type:'billing_error',message:'synthetic upstream private body'},'AI_BILLING_REQUIRED','upstream_http_4xx',false,undefined],
    [403,{type:'permission_error',message:'synthetic upstream private body'},'AI_PERMISSION_DENIED','upstream_http_4xx',false,undefined],
    [404,{type:'not_found_error',message:'synthetic upstream private body'},'AI_MODEL_UNAVAILABLE','upstream_http_4xx',false,undefined],
    [400,{type:'invalid_request_error',message:'organization spend limit reached'},'AI_BILLING_REQUIRED','upstream_http_4xx',false,undefined],
    [429,{type:'billing_error',message:'workspace usage limit reached'},'AI_BILLING_REQUIRED','upstream_http_4xx',false,undefined],
    [429,{type:'rate_limit_error',message:'slow down'},'AI_PROVIDER_RATE_LIMITED','upstream_rate_limited',false,undefined],
    [429,{type:'rate_limit_error',message:'slow down'},'AI_PROVIDER_RATE_LIMITED','upstream_rate_limited',true,'provider_rate_limited'],
    [429,{type:'future_error',message:'synthetic upstream private body'},'AI_PROVIDER_RATE_LIMITED','upstream_http_other',false,undefined],
    [529,{type:'overloaded_error',message:'synthetic upstream private body'},'AI_UPSTREAM_ERROR','upstream_http_5xx',true,'transient'],
    [500,{type:'api_error',message:'synthetic upstream private body'},'AI_UPSTREAM_ERROR','upstream_http_5xx',true,'transient']
  ];
  for(const [status,error,code,reason,hasRetryAfter,fallbackReason] of cases){const provider=new AnthropicProvider(async()=>response({error},status,hasRetryAfter?{'retry-after':'2'}:{}));await assert.rejects(provider.execute(task,config),(failure:unknown)=>failure instanceof AiProviderFailure&&failure.code===code&&failure.responseReason===reason&&failure.fallbackReason===fallbackReason&&!failure.message.includes('synthetic upstream'));}
  await assert.rejects(new AnthropicProvider(async()=>{throw new TypeError('private network detail');}).execute(task,config),(error:unknown)=>error instanceof AiProviderFailure&&error.code==='AI_UPSTREAM_ERROR'&&error.responseReason==='network_error'&&error.fallbackReason==='network_error'&&!error.message.includes('private network'));
});

test('Anthropic pre-dispatch rejections are preserved and never reach transport',async()=>{
  let calls=0;
  const provider=new AnthropicProvider(async()=>{calls++;return response({model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:'must not run'}]});});
  const session=provider.createSession(task,{...config,beforeDispatch:async()=>{throw new DomainError('AI_CONFIGURATION_INVALID',422);}});
  await assert.rejects(session.next(),(error:unknown)=>error instanceof DomainError&&error.code==='AI_CONFIGURATION_INVALID');assert.equal(calls,0);
});

test('Anthropic required tools fail closed for every model; only verified Haiku 5.5 uses forced choice',async()=>{
  const tool={name:'web.open',description:'Open a source',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}};
  for(const model of ['claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1','claude-mythos-5-1','unknown-future-model','claude-haiku-5-5']){
    let sent:Record<string,unknown>|undefined;
    const provider=new AnthropicProvider(async(_url,init)=>{sent=JSON.parse(String(init.body));return response({model,stop_reason:'end_turn',content:[{type:'text',text:'I will answer directly'}]});});
    const session=provider.createSession(task,{...config,model},[tool]);
    await assert.rejects(session.next([], 'required'),(error:unknown)=>error instanceof AiProviderFailure&&error.code==='AI_RESPONSE_INVALID'&&error.responseReason==='invalid_tool_calls');
    assert.deepEqual(sent!.tool_choice,{type:model==='claude-haiku-5-5'?'any':'auto'});assert.equal(sent!.system,undefined);session.close();
  }
});

test('Anthropic cache token normalization is bounded and does not invent totals when base input is absent',()=>{
  assert.deepEqual(normalizedAnthropicUsage({input_tokens:4,cache_read_input_tokens:2,cache_creation_input_tokens:1,output_tokens:3}),{inputTokens:7,outputTokens:3,cachedInputTokens:2,cacheWriteTokens:1});
  assert.deepEqual(normalizedAnthropicUsage({cache_read_input_tokens:2,output_tokens:3}),{outputTokens:3,cachedInputTokens:2});
  assert.deepEqual(normalizedAnthropicUsage({input_tokens:2_147_483_647,cache_read_input_tokens:1}),{cachedInputTokens:1});
});
