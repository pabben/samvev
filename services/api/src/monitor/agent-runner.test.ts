import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiProviderTurn, AiToolResult } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import type { AiAdminService } from '../ai/admin-service.ts';
import { MONITOR_AGENT_DEADLINE_MS,MONITOR_LEASE_MS,MonitorAgentRunner,monitorWebTool } from './agent-runner.ts';
import { answerFromAi } from './service.ts';
import type { MonitorSourceFetcher, SourceDocument } from './source-fetcher.ts';

const task={operation:'extract' as const,purpose:'synthetic_agent_test',input:'Use the approved source.',modelTier:'routine' as const,sources:[]};
const root:SourceDocument={finalUrl:'https://example.test/',contentType:'text/html',title:'Synthetic front',headings:['Top'],text:'Top\nSynthetic headline',fingerprint:'root-v1',fetchedAt:'2026-09-10T10:00:00.000Z',httpStatus:200,byteSize:123,links:[{url:'https://example.test/news','label':'News'}]};
const news:SourceDocument={finalUrl:'https://example.test/news',contentType:'text/html',title:'News',headings:['Story'],text:'Story\nSynthetic detail',fingerprint:'news-v1',fetchedAt:'2026-09-10T10:00:01.000Z',links:[]};

function harness(turns:AiProviderTurn[],documents:Record<string,SourceDocument>={[root.finalUrl]:root,[news.finalUrl]:news}){
  const results:AiToolResult[][]=[];const choices:Array<'auto'|'required'>=[];const fetchedUrls:string[]=[];
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(toolResults:AiToolResult[]=[],toolChoice:'auto'|'required'='auto')=>{results.push(toolResults);choices.push(toolChoice);const next=turns.shift();if(!next)throw new Error('unexpected turn');return next;}})} as unknown as AiAdminService;
  const fetcher={fetch:async(url:string)=>{fetchedUrls.push(url);const value=documents[url];if(!value)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);return value;}} as unknown as MonitorSourceFetcher;
  return{runner:new MonitorAgentRunner(ai,fetcher,1000),results,choices,fetchedUrls,get fetches(){return fetchedUrls.length;}};
}
const at='2026-09-10T10:00:00.000Z';

test('monitor agent deadline remains bounded below its execution lease',()=>{assert.equal(MONITOR_AGENT_DEADLINE_MS,180_000);assert.equal(MONITOR_LEASE_MS,240_000);assert.ok(MONITOR_AGENT_DEADLINE_MS<MONITOR_LEASE_MS);});

test('runner accepts a normal final turn without inventing a tool call',async()=>{
  const h=harness([{output:'Synthetic final',toolCalls:[],generatedAt:at}]);const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl});
  assert.equal(result.output,'Synthetic final');assert.equal(result.aiCalls,1);assert.equal(result.documents.length,0);assert.equal(h.fetches,0);assert.deepEqual(h.choices,['auto']);
});

test('runner uses required until a source opens and auto afterward',async()=>{
  const h=harness([{toolCalls:[{id:'root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},{output:'Evidence-backed final',toolCalls:[],generatedAt:at}]);
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,requireTool:true});assert.equal(result.output,'Evidence-backed final');assert.deepEqual(h.choices,['required','auto']);assert.equal(result.documents.length,1);
});

test('runner retries a premature required final until a source is opened',async()=>{
  const h=harness([
    {output:'Premature unsupported source answer',toolCalls:[],generatedAt:at},
    {toolCalls:[{id:'root_retry',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {output:'Evidence-backed retry result',toolCalls:[],generatedAt:at}
  ]);
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,requireTool:true});
  assert.equal(result.output,'Evidence-backed retry result');assert.equal(result.aiCalls,3);assert.deepEqual(h.choices,['required','required','auto']);assert.deepEqual(h.fetchedUrls,[root.finalUrl]);assert.equal(JSON.stringify(result).includes('Premature unsupported'),false);
});

test('repeated premature required finals end at the provider-turn bound without fetching',async()=>{
  const h=harness(Array.from({length:7},(_,index)=>({output:`Premature ${index}`,toolCalls:[],generatedAt:at})));
  await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,requireTool:true}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_TOOL_LIMIT'&&error.details?.aiCalls===7&&error.details?.attemptedToolCount===0);
  assert.deepEqual(h.choices,Array(7).fill('required'));assert.equal(h.fetches,0);assert.deepEqual(h.results,Array.from({length:7},()=>[]));
});

test('runner applies an explicit repair-turn ceiling inside the hard cap',async()=>{
  const h=harness(Array.from({length:7},(_,index)=>({output:`Premature ${index}`,toolCalls:[],generatedAt:at})));
  await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,requireTool:true,maxTurns:6,maxToolExecutions:6}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_TOOL_LIMIT'&&error.details?.aiCalls===6);
  assert.equal(h.results.length,6);assert.equal(h.fetches,0);
});

test('runner keeps one session through a premature final and closes it after its deadline aborts the retry',async()=>{
  let turns=0;let closed=0;
  const ai={createTaskSession:async(_household:string,_task:unknown,_policy:unknown,_tools:unknown,signal:AbortSignal)=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{closed++;},next:async()=>{turns++;if(turns===1)return{output:'Premature',toolCalls:[],generatedAt:at};return new Promise<never>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DomainError('AI_TIMEOUT',504)),{once:true}));}})} as unknown as AiAdminService;
  const runner=new MonitorAgentRunner(ai,{} as MonitorSourceFetcher,20);const started=Date.now();
  await assert.rejects(runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,requireTool:true}),(error:unknown)=>error instanceof DomainError&&error.code==='AI_TIMEOUT');
  assert.equal(turns,2);assert.equal(closed,1);assert.ok(Date.now()-started<60);
});

test('runner rejects credential-bearing root URLs before provider or fetch access',async()=>{
  const h=harness([{output:'must not run',toolCalls:[],generatedAt:at}]);
  await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:'https://example.test/?api%5Fkey=hidden'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_TOOL_INVALID');
  assert.equal(h.fetches,0);assert.equal(h.results.length,0);
});

test('runner returns one and multiple web results to the provider and records compact provenance',async()=>{
  const h=harness([
    {toolCalls:[{id:'call_root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'call_news',name:'web.open',arguments:{url:news.finalUrl}}],generatedAt:at},
    {output:'{"answer":"Synthetic detail"}',toolCalls:[],generatedAt:at}
  ]);
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'local',rootUrl:root.finalUrl});
  assert.equal(result.aiCalls,3);assert.equal(h.fetches,2);assert.deepEqual(result.dependencies.map((item)=>item.url),[root.finalUrl,news.finalUrl]);
  assert.equal(h.results[1]![0]!.callId,'call_root');assert.match(h.results[1]![0]!.output,/Synthetic headline/);assert.match(h.results[1]![0]!.output,/https:\/\/example\.test\/news/);
  const rootPayload=JSON.parse(h.results[1]![0]!.output) as {evidenceRule:string;url:string;headingOrder:string;linkOrder:string};assert.equal(rootPayload.url,root.finalUrl);assert.match(rootPayload.evidenceRule,/Listed link URLs are not opened sources/);assert.match(rootPayload.evidenceRule,/cite the payload url/);assert.equal(rootPayload.headingOrder,'document');assert.equal(rootPayload.linkOrder,'relevance-ranked');
  assert.match(monitorWebTool.description,/untrusted data/);assert.match(h.results[1]![0]!.output,/UNTRUSTED_SOURCE_DATA/);
  assert.equal(result.attemptedToolCount,2);assert.equal(result.provenance.length,2);assert.deepEqual(result.attempts,[
    {tool:'web.open',requestedUrl:root.finalUrl,outcome:'success',errorCode:null},
    {tool:'web.open',requestedUrl:news.finalUrl,outcome:'success',errorCode:null}
  ]);assert.equal(JSON.stringify(result.provenance).includes('Synthetic headline'),false);assert.equal(result.provenance[0]!.httpStatus,200);assert.equal(result.provenance[0]!.byteSize,123);
});

test('runner validates an entire tool batch before any fetch',async()=>{
  const h=harness([{toolCalls:[
    {id:'valid',name:'web.open',arguments:{url:root.finalUrl}},
    {id:'bad',name:'shell.exec',arguments:{command:'never'}}
  ],generatedAt:at}]);
  await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_TOOL_INVALID'&&error.details?.attemptedToolCount===2&&Array.isArray(error.details?.attempts)&&error.details.attempts.length===0);
  assert.equal(h.fetches,0);
});

test('runner failure trace contains only a validated URL and normalized error',async()=>{
  const h=harness([{toolCalls:[{id:'blocked_fetch',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at}],{});
  await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl}),(error:unknown)=>{
    if(!(error instanceof DomainError)||error.code!=='MONITOR_SOURCE_UNAVAILABLE')return false;
    assert.equal(error.details?.attemptedToolCount,1);assert.deepEqual(error.details?.provenance,[]);
    assert.deepEqual(error.details?.attempts,[{tool:'web.open',requestedUrl:root.finalUrl,outcome:'failed',errorCode:'MONITOR_SOURCE_UNAVAILABLE'}]);
    assert.equal(JSON.stringify(error.details).includes('arguments'),false);assert.equal(JSON.stringify(error.details).includes('fingerprint'),false);return true;
  });
});

test('runner rejects invalid args, duplicate ids, unknown tools and too many calls',async()=>{
  const cases:AiProviderTurn[]=[
    {toolCalls:[{id:'bad_args',name:'web.open',arguments:{url:root.finalUrl,method:'POST'}}],generatedAt:at},
    {toolCalls:[{id:'same',name:'web.open',arguments:{url:root.finalUrl}},{id:'same',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'unknown',name:'shell.exec',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'credential',name:'web.open',arguments:{url:'https://example.test/?api%5Fkey=hidden'}}],generatedAt:at},
    {toolCalls:Array.from({length:7},(_,index)=>({id:`call_${index}`,name:'web.open',arguments:{url:root.finalUrl}})),generatedAt:at}
  ];
  for(const turn of cases){const h=harness([turn]);await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl}),(error:unknown)=>error instanceof DomainError&&['MONITOR_TOOL_INVALID','MONITOR_TOOL_LIMIT'].includes(error.code));assert.equal(h.fetches,0);}
});

test('runner safely recovers after a fabricated URL without fetching or disclosing it',async()=>{
  const fabricated='https://example.test/invented-story';
  const h=harness([
    {toolCalls:[{id:'root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'invented',name:'web.open',arguments:{url:fabricated}}],generatedAt:at},
    {output:'Synthetic final from root heading',toolCalls:[],generatedAt:at}
  ]);
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl});
  assert.equal(result.output,'Synthetic final from root heading');assert.deepEqual(h.fetchedUrls,[root.finalUrl]);
  assert.deepEqual(result.attempts,[{tool:'web.open',requestedUrl:root.finalUrl,outcome:'success',errorCode:null}]);assert.equal(result.attemptedToolCount,2);
  const recovery=h.results[2]![0]!.output;assert.match(recovery,/URL_NOT_APPROVED/);assert.match(recovery,/Never construct or guess/);assert.equal(recovery.includes(fabricated),false);
});

test('runner rejects a mixed out-of-scope batch before every network side effect',async()=>{
  const fabricated='https://example.test/not-returned';
  const h=harness([
    {toolCalls:[{id:'root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'allowed',name:'web.open',arguments:{url:news.finalUrl}},{id:'invented',name:'web.open',arguments:{url:fabricated}}],generatedAt:at},
    {output:'Recovered final',toolCalls:[],generatedAt:at}
  ]);
  await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl});
  assert.deepEqual(h.fetchedUrls,[root.finalUrl]);assert.equal(h.results[2]!.length,2);assert.ok(h.results[2]!.every((item)=>item.output.includes('URL_NOT_APPROVED')&&!item.output.includes(fabricated)));
});

test('repeated scope mistakes terminate at the normal tool execution limit',async()=>{
  const turns:AiProviderTurn[]=Array.from({length:7},(_,index)=>({toolCalls:[{id:`invented_${index}`,name:'web.open',arguments:{url:`https://example.test/invented-${index}`}}],generatedAt:at}));
  const h=harness(turns);await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_TOOL_LIMIT'&&error.details?.attemptedToolCount===7);
  assert.equal(h.fetches,0);assert.deepEqual((await Promise.resolve(h.results)).flat().map((item)=>item.output.includes('URL_NOT_APPROVED')),[true,true,true,true,true,true]);
});

test('only surfaced links are allowed and meaningful content links are prioritized',async()=>{
  const hidden='https://example.test/login';const article='https://example.test/2026/09/important-report';
  const crowded:SourceDocument={...root,links:[
    ...Array.from({length:90},(_,index)=>({url:`https://example.test/nav-${index}`,label:index<60?`Menu ${index}`:`Section ${index}`})),
    {url:hidden,label:'Login'},{url:article,label:'Detailed public report about today'}
  ]};
  const h=harness([
    {toolCalls:[{id:'root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'hidden',name:'web.open',arguments:{url:hidden}}],generatedAt:at},
    {output:'Recovered final',toolCalls:[],generatedAt:at}
  ],{[root.finalUrl]:crowded});
  await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl});
  const payload=JSON.parse(h.results[1]![0]!.output) as {links:Array<{url:string}>};assert.ok(payload.links.some((link)=>link.url===article));assert.ok(!payload.links.some((link)=>link.url===hidden));
  assert.deepEqual(h.fetchedUrls,[root.finalUrl]);assert.match(h.results[2]![0]!.output,/URL_NOT_APPROVED/);
});

test('redirect final URL becomes an exact allowed cached target',async()=>{
  const requested='https://example.test/start';const redirected:SourceDocument={...root,finalUrl:'https://example.test/front'};
  const h=harness([
    {toolCalls:[{id:'start',name:'web.open',arguments:{url:requested}}],generatedAt:at},
    {toolCalls:[{id:'final',name:'web.open',arguments:{url:redirected.finalUrl}}],generatedAt:at},
    {output:'Final after redirect',toolCalls:[],generatedAt:at}
  ],{[requested]:redirected});
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:requested});assert.equal(result.output,'Final after redirect');assert.deepEqual(h.fetchedUrls,[requested]);
  const claim='Synthetic headline';const modelEvidence={version:1,answer:claim,evidence:{quote:claim,sourceUrl:requested},confidence:0.9,uncertainty:null};
  assert.deepEqual(result.evidenceDocuments[0]!.evidenceUrlAliases,[requested,redirected.finalUrl]);assert.equal(answerFromAi(JSON.stringify(modelEvidence),result.evidenceDocuments).evidence.sourceUrl,redirected.finalUrl);
  assert.throws(()=>answerFromAi(JSON.stringify({...modelEvidence,evidence:{...modelEvidence.evidence,sourceUrl:'https://example.test/unopened'}}),result.evidenceDocuments),(error:any)=>error.code==='AI_RESPONSE_INVALID');
});

test('serialized tool payload applies compact per-document and per-field ceilings',async()=>{
  const huge:SourceDocument={...root,title:'Ø'.repeat(1000),text:'Æ"\\\n'.repeat(40_000),headings:Array.from({length:40},(_,index)=>`Heading ${index} ${'Ø'.repeat(300)}`),links:Array.from({length:200},(_,index)=>({url:`https://example.test/content/${index}/${'x'.repeat(300)}`,label:`Meaningful content link ${index} `.repeat(8)}))};
  const h=harness([{toolCalls:[{id:'root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},{output:'Bounded',toolCalls:[],generatedAt:at}],{[root.finalUrl]:huge});
  await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl});const output=h.results[1]![0]!.output;
  const payload=JSON.parse(output) as {title:string;links:Array<{url:string;label:string}>;headings:string[];text:string;url:string;fingerprint:string;fetchedAt:string};
  assert.ok(Buffer.byteLength(output)<=16*1024);assert.ok(Buffer.byteLength(payload.title)<=512);assert.ok(Buffer.byteLength(payload.text)<=8*1024);
  assert.ok(payload.headings.length<=16);assert.ok(payload.headings.every((value)=>Buffer.byteLength(value)<=384));assert.ok(Buffer.byteLength(JSON.stringify(payload.headings))<=2*1024);
  assert.ok(payload.links.length<=24);assert.ok(payload.links.every((link)=>Buffer.byteLength(link.label)<=320));assert.ok(Buffer.byteLength(JSON.stringify(payload.links))<=5*1024);
  assert.equal(payload.url,root.finalUrl);assert.equal(payload.fingerprint,huge.fingerprint);assert.equal(payload.fetchedAt,huge.fetchedAt);
  assert.ok(output.indexOf('"links"')<output.indexOf('"headings"'));assert.ok(output.indexOf('"headings"')<output.indexOf('"text"'));
});

test('evidence validation is limited to the exact bounded fields shown to the model',async()=>{
  const visible='Visible first editorial headline';const hiddenText='Hidden off-window body claim';const hiddenHeading='Hidden seventeenth heading';const hiddenLink='Hidden twenty-fifth link';
  const bounded:SourceDocument={...root,text:`${visible}\n${'x'.repeat(12_000)}\n${hiddenText}`,headings:[visible,...Array.from({length:15},(_,index)=>`Visible heading ${index}`),hiddenHeading],links:[...Array.from({length:24},(_,index)=>({url:`https://example.test/story-${String(index).padStart(2,'0')}`,label:`Visible editorial link ${String(index).padStart(2,'0')}`})),{url:'https://example.test/story-99',label:hiddenLink}]};
  const h=harness([{toolCalls:[{id:'root',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},{output:'done',toolCalls:[],generatedAt:at}],{[root.finalUrl]:bounded});
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,requireTool:true});const evidence=result.evidenceDocuments[0]!;
  assert.equal(answerFromAi(JSON.stringify({version:1,answer:visible,evidence:{quote:visible},confidence:0.9,uncertainty:null}),evidence).answer,visible);
  for(const claim of [hiddenText,hiddenHeading,hiddenLink])assert.throws(()=>answerFromAi(JSON.stringify({version:1,answer:claim,evidence:{quote:claim},confidence:0.9,uncertainty:null}),evidence),(error:any)=>error.code==='AI_RESPONSE_INVALID',claim);
  assert.ok(bounded.text.includes(hiddenText));assert.ok(bounded.headings!.includes(hiddenHeading));assert.ok(bounded.links!.some((link)=>link.label===hiddenLink));
});

test('compact root discovery and followed document retain useful evidence and provenance',async()=>{
  const articleUrl='https://example.test/2026/compact-story';
  const rootDocument:SourceDocument={...root,title:'Synthetic daily front',headings:['Synthetic lead story','More news'],text:`Synthetic lead story\n${'Front context. '.repeat(2000)}`,links:[{url:articleUrl,label:'Synthetic lead story'},{url:'https://example.test/login',label:'Login'}]};
  const articleDocument:SourceDocument={...news,finalUrl:articleUrl,title:'Synthetic lead story',headings:['Synthetic lead story'],text:`Synthetic lead story\nExact evidence sentence for the requested result.\n${'Article context. '.repeat(2000)}`,fingerprint:'article-v1'};
  const h=harness([
    {toolCalls:[{id:'discover',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at},
    {toolCalls:[{id:'follow',name:'web.open',arguments:{url:articleUrl}}],generatedAt:at},
    {output:'Final from exact evidence sentence',toolCalls:[],generatedAt:at}
  ],{[root.finalUrl]:rootDocument,[articleUrl]:articleDocument});
  const result=await h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'local',rootUrl:root.finalUrl,requireTool:true});
  const rootPayload=JSON.parse(h.results[1]![0]!.output) as {title:string;headings:string[];links:Array<{url:string;label:string}>;text:string;url:string;fingerprint:string;fetchedAt:string};
  const articlePayload=JSON.parse(h.results[2]![0]!.output) as typeof rootPayload;
  assert.ok(Buffer.byteLength(h.results[1]![0]!.output)<=16*1024);assert.equal(rootPayload.title,'Synthetic daily front');assert.ok(rootPayload.headings.includes('Synthetic lead story'));
  assert.deepEqual(rootPayload.links[0],{url:articleUrl,label:'Synthetic lead story'});assert.match(rootPayload.text,/Synthetic lead story/);assert.equal(rootPayload.url,root.finalUrl);
  assert.ok(Buffer.byteLength(h.results[2]![0]!.output)<=16*1024);assert.match(articlePayload.text,/Exact evidence sentence for the requested result/);assert.equal(articlePayload.url,articleUrl);assert.equal(articlePayload.fingerprint,'article-v1');assert.equal(articlePayload.fetchedAt,articleDocument.fetchedAt);
  assert.deepEqual(result.provenance.map(({finalUrl,fingerprint,fetchedAt})=>({finalUrl,fingerprint,fetchedAt})),[
    {finalUrl:root.finalUrl,fingerprint:rootDocument.fingerprint,fetchedAt:rootDocument.fetchedAt},
    {finalUrl:articleUrl,fingerprint:articleDocument.fingerprint,fetchedAt:articleDocument.fetchedAt}
  ]);
  assert.deepEqual(h.fetchedUrls,[root.finalUrl,articleUrl]);
});

test('runner reuses a fetched URL but still bounds tool executions',async()=>{
  const turns:AiProviderTurn[]=[];for(let index=0;index<6;index++)turns.push({toolCalls:[{id:`repeat_${index}`,name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at});turns.push({toolCalls:[{id:'overflow',name:'web.open',arguments:{url:root.finalUrl}}],generatedAt:at});
  const h=harness(turns);await assert.rejects(h.runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_TOOL_LIMIT');assert.equal(h.fetches,1);
});

test('dependency refresh compares every followed document without an AI call',async()=>{
  const h=harness([]);const unchanged=await h.runner.refreshDependencies([{url:root.finalUrl,fingerprint:root.fingerprint,contentType:'text/html'},{url:news.finalUrl,fingerprint:news.fingerprint,contentType:'text/html'}]);assert.equal(unchanged.changed,false);assert.equal(h.fetches,2);
  const changedHarness=harness([],{[root.finalUrl]:{...root,fingerprint:'root-v2'},[news.finalUrl]:news});assert.equal((await changedHarness.runner.refreshDependencies([{url:root.finalUrl,fingerprint:root.fingerprint,contentType:'text/html'},{url:news.finalUrl,fingerprint:news.fingerprint,contentType:'text/html'}])).changed,true);
});

test('dependency refresh failure exposes only its validated source attempt',async()=>{
  const h=harness([],{});await assert.rejects(h.runner.refreshDependencies([{url:root.finalUrl,fingerprint:'old',contentType:'text/html'}]),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_SOURCE_UNAVAILABLE'&&JSON.stringify(error.details?.attempts)===JSON.stringify([{tool:'web.open',requestedUrl:root.finalUrl,outcome:'failed',errorCode:'MONITOR_SOURCE_UNAVAILABLE'}]));
});

test('dependency refresh and agent loop share one outer deadline',async()=>{
  const outer=new AbortController();const started=Date.now();const timeout=setTimeout(()=>outer.abort(),40);
  const ai={createTaskSession:async(_household:string,_task:unknown,_policy:unknown,_tools:unknown,_unusedSignal:AbortSignal)=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>{if(outer.signal.aborted)throw new DomainError('AI_TIMEOUT',504);return new Promise<never>((_resolve,reject)=>outer.signal.addEventListener('abort',()=>reject(new DomainError('AI_TIMEOUT',504)),{once:true}));}})} as unknown as AiAdminService;
  const fetcher={fetch:async()=>{await new Promise((resolve)=>setTimeout(resolve,25));return root;}} as unknown as MonitorSourceFetcher;
  const runner=new MonitorAgentRunner(ai,fetcher,1000);
  try{
    await runner.refreshDependencies([{url:root.finalUrl,fingerprint:'old',contentType:'text/html'}],outer.signal);
    await assert.rejects(runner.run({householdId:'00000000-0000-4000-8000-000000000001',task,policy:'default',rootUrl:root.finalUrl,signal:outer.signal}),(error:unknown)=>error instanceof DomainError&&error.code==='AI_TIMEOUT');
    assert.ok(Date.now()-started<100,'runner must use the remaining outer deadline instead of starting a new budget');
  }finally{clearTimeout(timeout);}
});
