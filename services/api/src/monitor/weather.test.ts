import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiProviderTurn, AiToolResult } from '@samvev/contracts';
import { DomainError } from '@samvev/core';
import type { AiAdminService } from '../ai/admin-service.ts';
import { MonitorAgentRunner } from './agent-runner.ts';
import type { MonitorSourceFetcher, SourceDocument } from './source-fetcher.ts';
import { monitorToolRegistry } from './tool-registry.ts';
import { KartverketPlaceResolver, MetWeatherClient, norwegianWeatherDate, weatherTargetDate, type FixedHttpRequest, type FixedHttpResponse, type FixedHttpTransport } from './weather.ts';

function response(status:number,value:unknown,headers:Record<string,string>={'content-type':'application/json'}):FixedHttpResponse{
  const body=Buffer.from(JSON.stringify(value));const normalized=new Map(Object.entries({...headers,'content-length':headers['content-length']??String(body.length)}).map(([key,item])=>[key.toLowerCase(),item]));
  return{status,headers:{get:(name)=>normalized.get(name.toLowerCase())??null},arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)};
}
const places={navn:[
  {skrivemåte:'Birkeland',stedsnummer:1,representasjonspunkt:{øst:8.232456,nord:58.331234},kommuner:[{kommunenavn:'Birkenes'}],fylker:[{fylkesnavn:'Agder'}]},
  {skrivemåte:'Birkeland',stedsnummer:2,representasjonspunkt:{øst:6.1,nord:60.2},kommuner:[{kommunenavn:'Sveio'}],fylker:[{fylkesnavn:'Vestland'}]}
]};
const forecast={properties:{meta:{updated_at:'2026-09-12T08:00:00Z'},timeseries:[
  {time:'2026-09-13T06:00:00Z',data:{instant:{details:{air_temperature:12.5,wind_speed:3.1}},next_1_hours:{summary:{symbol_code:'partlycloudy_day'},details:{precipitation_amount:0.2}}}},
  {time:'2026-09-13T12:00:00Z',data:{instant:{details:{air_temperature:15,wind_speed:4}},next_1_hours:{summary:{symbol_code:'rain'},details:{precipitation_amount:1.4}}}}
]}};

test('typed registry exposes only bounded provider-neutral web and weather contracts',()=>{
  const selected=monitorToolRegistry.select(['web.open','weather.forecast']);assert.deepEqual(selected.map((item)=>item.name),['web.open','weather.forecast']);assert.ok(selected.every((item)=>item.timeoutMs<=15_000&&item.provenance==='server_anchored'&&item.auditPolicy==='metadata_only'));assert.equal(monitorToolRegistry.get('shell.exec'),undefined);
  assert.equal(monitorToolRegistry.prepare('web.open',{url:'https://example.test/'},{approvedUrls:new Set(['https://example.test/']),taskText:'example'}).authorized,true);
  assert.equal(monitorToolRegistry.prepare('web.open',{url:'https://example.test/unapproved'},{approvedUrls:new Set(['https://example.test/']),taskText:'example'}).authorized,false);
  assert.throws(()=>monitorToolRegistry.prepare('weather.forecast',{location:'Invented',period:'tomorrow'},{approvedUrls:new Set(),taskText:'weather elsewhere'}),(error:any)=>error.code==='MONITOR_LOCATION_REQUIRED');
});

test('approved weather scope pins place and time while combined dates must come from opened evidence',()=>{
  const exact={approvedUrls:new Set<string>(),taskText:'irrelevant after approval',approvedWeatherScope:{location:'Birkeland',period:'tomorrow' as const,timeWindow:'morning' as const}};
  assert.equal(monitorToolRegistry.prepare('weather.forecast',{location:'Birkeland',period:'tomorrow',timeWindow:'morning'},exact).authorized,true);
  assert.throws(()=>monitorToolRegistry.prepare('weather.forecast',{location:'Another place',period:'tomorrow',timeWindow:'morning'},exact),(error:any)=>error.code==='MONITOR_TOOL_INVALID');
  assert.throws(()=>monitorToolRegistry.prepare('weather.forecast',{location:'Birkeland',period:'today',timeWindow:'morning'},exact),(error:any)=>error.code==='MONITOR_TOOL_INVALID');
  const dynamic={approvedUrls:new Set<string>(),taskText:'combined',approvedWeatherScope:{location:'Birkeland',period:'date' as const,timeWindow:'all' as const,dynamicDateFromEvidence:true},evidenceDates:new Set(['2030-09-20'])};
  assert.equal(monitorToolRegistry.prepare('weather.forecast',{location:'Birkeland',period:'date',date:'2030-09-20',timeWindow:'all'},dynamic).authorized,true);
  assert.equal(monitorToolRegistry.prepare('weather.forecast',{location:'Birkeland',period:'date',date:'2030-09-21',timeWindow:'all'},dynamic).authorized,false);
});

test('Norwegian calendar dates stay correct across local midnight and DST',()=>{
  assert.equal(norwegianWeatherDate(new Date('2026-03-28T23:30:00Z')),'2026-03-29');
  assert.equal(weatherTargetDate({location:'Oslo',period:'tomorrow',timeWindow:'all'},new Date('2026-03-28T23:30:00Z')),'2026-03-30');
  assert.equal(norwegianWeatherDate(new Date('2026-06-30T22:30:00Z')),'2026-07-01');
  assert.equal(weatherTargetDate({location:'Oslo',period:'tomorrow',timeWindow:'all'},new Date('2026-06-30T22:30:00Z')),'2026-07-02');
  assert.throws(()=>weatherTargetDate({location:'Oslo',period:'date',date:'2026-09-22',timeWindow:'all'},new Date('2026-09-12T08:00:00Z')),(error:any)=>error.code==='MONITOR_WEATHER_DATE_UNAVAILABLE');
});

test('Kartverket resolver deterministically disambiguates with municipality and minimizes coordinates',async()=>{
  const requests:FixedHttpRequest[]=[];const transport:FixedHttpTransport=async(request)=>{requests.push(request);return response(200,places);};const resolver=new KartverketPlaceResolver(transport);
  await assert.rejects(resolver.resolve('Birkeland'),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_LOCATION_AMBIGUOUS'&&Array.isArray(error.details?.candidates)&&JSON.stringify(error.details).includes('latitude')===false);
  const place=await resolver.resolve('Birkeland Birkenes');assert.equal(place.municipality,'Birkenes');assert.equal(place.latitude,58.3312);assert.equal(place.longitude,8.2325);assert.match(requests[0]!.url,/^https:\/\/ws\.geonorge\.no\/stedsnavn\/v1\/navn\?/);assert.ok(requests[0]!.headers['user-agent']);assert.equal(requests[0]!.headers['accept-encoding'],'gzip');
});

test('Kartverket resolver separates a reviewed municipality label from the place-name search',async()=>{
  const terms:string[]=[];const transport:FixedHttpTransport=async(request)=>{const term=new URL(request.url).searchParams.get('sok')!;terms.push(term);return response(200,term==='Birkeland'?places:{navn:[]});};
  const comma=await new KartverketPlaceResolver(transport).resolve('Birkeland, Birkenes');assert.equal(comma.municipality,'Birkenes');assert.deepEqual(terms,['Birkeland']);
  terms.length=0;const words=await new KartverketPlaceResolver(transport).resolve('Birkeland Birkenes');assert.equal(words.municipality,'Birkenes');assert.deepEqual(terms,['Birkeland Birkenes','Birkeland']);
});

test('MET client uses fixed HTTPS endpoint, identifying UA, cache and conditional revalidation',async()=>{
  const requests:FixedHttpRequest[]=[];let now=new Date('2026-09-12T08:00:00Z');let forecastCalls=0;
  const transport:FixedHttpTransport=async(request)=>{requests.push(request);if(request.url.startsWith('https://ws.geonorge.no/'))return response(200,{navn:[places.navn[0]]});forecastCalls++;if(forecastCalls===1)return response(200,forecast,{'content-type':'application/json','last-modified':'Sat, 12 Sep 2026 08:00:00 GMT','expires':'Sat, 12 Sep 2026 08:01:00 GMT'});return{status:304,headers:{get:(name)=>name.toLowerCase()==='expires'?'Sat, 12 Sep 2026 08:06:00 GMT':null},arrayBuffer:async()=>new ArrayBuffer(0)};};
  const resolver=new KartverketPlaceResolver(transport);const client=new MetWeatherClient(resolver,transport,1000,()=>now);
  const first=await client.forecast({location:'Birkeland Birkenes',period:'tomorrow',timeWindow:'all'});assert.equal(first.points.length,2);assert.equal(first.attribution,'MET Norway Locationforecast');assert.match(first.sourceUrl,/^https:\/\/api\.met\.no\/weatherapi\/locationforecast\/2\.0\/compact\?lat=58\.3312&lon=8\.2325$/);assert.equal(first.cacheStatus,'miss');
  assert.deepEqual(first.points[0],{at:'2026-09-13T06:00:00Z',temperatureC:12.5,windSpeedMps:3.1,precipitationMm:0.2,symbolCode:'partlycloudy_day'});
  assert.equal((await client.forecast({location:'Birkeland Birkenes',period:'tomorrow',timeWindow:'all'})).cacheStatus,'hit');assert.equal(forecastCalls,1);
  now=new Date('2026-09-12T08:02:00Z');const revalidated=await client.forecast({location:'Birkeland Birkenes',period:'tomorrow',timeWindow:'all'});assert.equal(revalidated.cacheStatus,'revalidated');assert.equal(revalidated.httpStatus,304);assert.equal(requests.at(-1)!.headers['if-modified-since'],'Sat, 12 Sep 2026 08:00:00 GMT');assert.ok(requests.at(-1)!.headers['user-agent']);
});

test('weather cache is process-local and intentionally cold after a client restart',async()=>{
  let calls=0;const transport:FixedHttpTransport=async(request)=>request.url.startsWith('https://ws.geonorge.no/')?response(200,{navn:[places.navn[0]]}):(calls++,response(200,forecast,{'content-type':'application/json','expires':'Sat, 12 Sep 2026 09:00:00 GMT'}));
  const first=new MetWeatherClient(new KartverketPlaceResolver(transport),transport,1000,()=>new Date('2026-09-12T08:00:00Z'));await first.forecast({location:'Birkeland Birkenes',period:'tomorrow'});await first.forecast({location:'Birkeland Birkenes',period:'tomorrow'});assert.equal(calls,1);
  const restarted=new MetWeatherClient(new KartverketPlaceResolver(transport),transport,1000,()=>new Date('2026-09-12T08:00:00Z'));await restarted.forecast({location:'Birkeland Birkenes',period:'tomorrow'});assert.equal(calls,2);
});

test('concurrent forecasts for one resolved location share the same upstream fetch',async()=>{
  let forecastCalls=0;const transport:FixedHttpTransport=async(request)=>{
    if(request.url.startsWith('https://ws.geonorge.no/'))return response(200,{navn:[places.navn[0]]});
    forecastCalls++;await new Promise((resolve)=>setTimeout(resolve,5));return response(200,forecast,{'content-type':'application/json','expires':'Sat, 12 Sep 2026 09:00:00 GMT'});
  };
  const client=new MetWeatherClient(new KartverketPlaceResolver(transport),transport,1000,()=>new Date('2026-09-12T08:00:00Z'));
  const [morning,afternoon]=await Promise.all([
    client.forecast({location:'Birkeland Birkenes',period:'tomorrow',timeWindow:'morning'}),
    client.forecast({location:'Birkeland Birkenes',period:'tomorrow',timeWindow:'afternoon'})
  ]);
  assert.equal(forecastCalls,1);assert.equal(morning.points.length,1);assert.equal(afternoon.points.length,1);
});

test('unknown Norwegian place fails without fabricated coordinates',async()=>{
  await assert.rejects(new KartverketPlaceResolver(async()=>response(200,{navn:[]})).resolve('Ukjent teststed'),(error:any)=>error.code==='MONITOR_LOCATION_NOT_FOUND');
});

test('one coordinate cache entry serves different dates and time windows',async()=>{
  let calls=0;const twoDays={properties:{meta:{updated_at:'2026-09-12T08:00:00Z'},timeseries:[
    {time:'2026-09-12T08:00:00Z',data:{instant:{details:{air_temperature:10,wind_speed:2}},next_1_hours:{summary:{symbol_code:'fair_day'},details:{precipitation_amount:0}}}},
    ...forecast.properties.timeseries
  ]}};
  const transport:FixedHttpTransport=async(request)=>request.url.startsWith('https://ws.geonorge.no/')?response(200,{navn:[places.navn[0]]}):(calls++,response(200,twoDays,{'content-type':'application/json','expires':'Sat, 12 Sep 2026 09:00:00 GMT'}));
  const client=new MetWeatherClient(new KartverketPlaceResolver(transport),transport,1000,()=>new Date('2026-09-12T08:00:00Z'));
  const today=await client.forecast({location:'Birkeland Birkenes',period:'today',timeWindow:'morning'});const tomorrow=await client.forecast({location:'Birkeland Birkenes',period:'tomorrow',timeWindow:'afternoon'});
  assert.equal(today.points.length,1);assert.equal(tomorrow.points.length,1);assert.equal(calls,1);
});

test('weather client classifies invalid MIME, oversized and timed out responses',async()=>{
  const placeTransport:FixedHttpTransport=async()=>response(200,{navn:[places.navn[0]]});const resolver=new KartverketPlaceResolver(placeTransport);
  const invalid=new MetWeatherClient(resolver,async()=>response(200,forecast,{'content-type':'text/html'}));await assert.rejects(invalid.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_SOURCE_UNSUPPORTED');
  const oversized=new MetWeatherClient(resolver,async()=>response(200,forecast,{'content-type':'application/json','content-length':String(3*1024*1024)}));await assert.rejects(oversized.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_SOURCE_TOO_LARGE');
  const malformed=new MetWeatherClient(resolver,async()=>response(200,{unexpected:true}));await assert.rejects(malformed.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_WEATHER_INVALID');
  const upstream=new MetWeatherClient(resolver,async()=>response(503,{}));await assert.rejects(upstream.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_WEATHER_UNAVAILABLE');
  const limited=new MetWeatherClient(resolver,async()=>response(429,{}));await assert.rejects(limited.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_WEATHER_RATE_LIMITED');
  const timeout=new MetWeatherClient(resolver,async(request)=>new Promise((_resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})),10);await assert.rejects(timeout.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_SOURCE_TIMEOUT');
});

test('weather client stops an oversized chunked response before buffering it all',async()=>{
  const resolver=new KartverketPlaceResolver(async()=>response(200,{navn:[places.navn[0]]}));let reads=0;let cancelled=false;
  const chunk=new Uint8Array(1024*1024+1);const client=new MetWeatherClient(resolver,async()=>({status:200,headers:{get:(name)=>name.toLowerCase()==='content-type'?'application/json':null},arrayBuffer:async()=>{throw new Error('must stream');},body:{getReader:()=>({read:async()=>{reads++;return reads<=2?{done:false,value:chunk}:{done:true};},cancel:async()=>{cancelled=true;}})}}));
  await assert.rejects(client.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:any)=>error.code==='MONITOR_SOURCE_TOO_LARGE');assert.equal(cancelled,true);assert.equal(reads,2);
});

test('MET status and configuration errors remain distinct and retry metadata is bounded',async()=>{
  const resolver=new KartverketPlaceResolver(async()=>response(200,{navn:[places.navn[0]]}));
  const partial=new MetWeatherClient(resolver,async()=>response(203,forecast));assert.equal((await partial.forecast({location:'Birkeland Birkenes',period:'tomorrow'})).httpStatus,203);
  const forbidden=new MetWeatherClient(resolver,async()=>response(403,{}));await assert.rejects(forbidden.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:any)=>error.code==='MONITOR_WEATHER_FORBIDDEN');
  const limited=new MetWeatherClient(resolver,async()=>response(429,{}, {'content-type':'application/json','retry-after':'999999'}));await assert.rejects(limited.forecast({location:'Birkeland Birkenes',period:'tomorrow'}),(error:any)=>error.code==='MONITOR_WEATHER_RATE_LIMITED'&&error.details.retryAfterSeconds===3600);
  const previous=process.env.SAMVEV_WEATHER_USER_AGENT;process.env.SAMVEV_WEATHER_USER_AGENT='invalid';try{await assert.rejects(new KartverketPlaceResolver(async()=>response(200,{navn:[]})).resolve('Oslo'),(error:any)=>error.code==='MONITOR_WEATHER_CONFIGURATION_INVALID');}finally{if(previous===undefined)delete process.env.SAMVEV_WEATHER_USER_AGENT;else process.env.SAMVEV_WEATHER_USER_AGENT=previous;}
});

test('agent runner returns weather tool data to the same provider loop with typed provenance',async()=>{
  const turns:AiProviderTurn[]=[{toolCalls:[{id:'weather',name:'weather.forecast',arguments:{location:'Birkeland',period:'tomorrow'}}],generatedAt:'2026-09-12T08:00:00Z'},{output:'final',toolCalls:[],generatedAt:'2026-09-12T08:00:01Z'}];const results:AiToolResult[][]=[];
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(items:AiToolResult[]=[])=>{results.push(items);return turns.shift()!;}})} as unknown as AiAdminService;
  const client={forecast:async()=>({sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=58.3312&lon=8.2325',attribution:'MET Norway Locationforecast' as const,retrievedAt:'2026-09-12T08:00:00Z',updatedAt:null,validFrom:'2026-09-13T06:00:00Z',validTo:'2026-09-13T06:00:00Z',location:{query:'Birkeland',canonicalName:'Birkeland',municipality:'Birkenes',region:'Agder',country:'Norge' as const,latitude:58.3312,longitude:8.2325,placeId:'1'},points:[{at:'2026-09-13T06:00:00Z',temperatureC:12,precipitationMm:0,windSpeedMps:3,symbolCode:'fair_day'}],fingerprint:'weather-v1',httpStatus:200 as const,cacheStatus:'miss' as const})} as unknown as MetWeatherClient;
  const runner=new MonitorAgentRunner(ai,undefined,1000,client);const outcome=await runner.run({householdId:'00000000-0000-4000-8000-000000000001',task:{operation:'extract',purpose:'weather_test',input:'weather for Birkeland',modelTier:'routine',sources:[]},policy:'default',toolNames:['weather.forecast'],requiredTools:['weather.forecast']});
  assert.equal(outcome.aiCalls,2);assert.match(results[1]![0]!.output,/MET Norway Locationforecast/);assert.equal(outcome.provenance[0]!.tool,'weather.forecast');assert.equal(outcome.provenance[0]!.canonicalLocation,'Birkeland');assert.deepEqual(outcome.dependencies[0]!.weatherRequest,{location:'Birkeland',period:'tomorrow',timeWindow:'all'});assert.equal(JSON.stringify(outcome.provenance).includes('points'),false);
});

test('weather tool rejects a model-invented place that was not approved in task context',async()=>{
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>({toolCalls:[{id:'weather',name:'weather.forecast',arguments:{location:'Inventedville',period:'tomorrow'}}],generatedAt:'2026-09-12T08:00:00Z'})})} as unknown as AiAdminService;let called=0;const weather={forecast:async()=>{called++;throw new Error('must not execute');}} as unknown as MetWeatherClient;
  await assert.rejects(new MonitorAgentRunner(ai,undefined,1000,weather).run({householdId:'00000000-0000-4000-8000-000000000001',task:{operation:'extract',purpose:'weather_test',input:'weather tomorrow with no named place',modelTier:'routine',sources:[]},policy:'default',toolNames:['weather.forecast'],requiredTools:['weather.forecast']}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_LOCATION_REQUIRED');assert.equal(called,0);
});

test('runner preserves only safe ambiguity candidates from the weather resolver',async()=>{
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>({toolCalls:[{id:'weather',name:'weather.forecast',arguments:{location:'Birkeland',period:'tomorrow'}}],generatedAt:'2026-09-12T08:00:00Z'})})} as unknown as AiAdminService;
  const weather={forecast:async()=>{throw new DomainError('MONITOR_LOCATION_AMBIGUOUS',422,{candidates:[{name:'Birkeland',municipality:'Birkenes',region:'Agder'}]});}} as unknown as MetWeatherClient;
  await assert.rejects(new MonitorAgentRunner(ai,undefined,1000,weather).run({householdId:'00000000-0000-4000-8000-000000000001',task:{operation:'extract',purpose:'weather_test',input:'weather for Birkeland',modelTier:'routine',sources:[]},policy:'default',toolNames:['weather.forecast'],requiredTools:['weather.forecast']}),(error:unknown)=>error instanceof DomainError&&error.code==='MONITOR_LOCATION_AMBIGUOUS'&&JSON.stringify(error.details?.candidates)==='[{"name":"Birkeland","municipality":"Birkenes","region":"Agder"}]'&&JSON.stringify(error.details).includes('latitude')===false);
});

test('dependency refresh detects a changed forecast while web evidence stays unchanged',async()=>{
  const root:SourceDocument={finalUrl:'https://example.test/plan',contentType:'text/html',text:'Trip day',fingerprint:'web-v1'};const fetcher={fetch:async()=>root} as unknown as MonitorSourceFetcher;
  const weather={forecast:async()=>({sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=58.3312&lon=8.2325',attribution:'MET Norway Locationforecast' as const,retrievedAt:'2026-09-12T08:00:00Z',updatedAt:null,validFrom:'2026-09-13T06:00:00Z',validTo:'2026-09-13T06:00:00Z',location:{query:'Birkeland',canonicalName:'Birkeland',municipality:'Birkenes',region:'Agder',country:'Norge' as const,latitude:58.3312,longitude:8.2325,placeId:'1'},points:[{at:'2026-09-13T06:00:00Z',temperatureC:12,precipitationMm:2,windSpeedMps:3,symbolCode:'rain'}],fingerprint:'weather-v2',httpStatus:200 as const,cacheStatus:'miss' as const})} as unknown as MetWeatherClient;
  const result=await new MonitorAgentRunner({} as AiAdminService,fetcher,1000,weather).refreshDependencies([{tool:'web.open',url:root.finalUrl,fingerprint:'web-v1',contentType:'text/html'},{tool:'weather.forecast',url:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=58.3312&lon=8.2325',fingerprint:'weather-v1',contentType:'application/vnd.met.no.locationforecast+json',weatherRequest:{location:'Birkeland',period:'tomorrow',timeWindow:'all'}}]);
  assert.equal(result.changed,true);assert.equal(result.documents.length,2);
});

test('changed web evidence skips an obsolete dynamic weather date so the agent can choose the new evidenced date',async()=>{
  const oldWeb={tool:'web.open' as const,url:'https://example.test/plan',fingerprint:'web-old',contentType:'text/html' as const};const oldWeather={tool:'weather.forecast' as const,url:'https://api.met.no/weatherapi/locationforecast/2.0/documentation',fingerprint:'weather-old',contentType:'application/vnd.met.no.locationforecast+json' as const,weatherRequest:{location:'Birkeland',period:'date' as const,date:'2030-09-20',timeWindow:'all' as const}};
  const next:SourceDocument={finalUrl:oldWeb.url,contentType:'text/html',text:'Trip day 2030-09-27',fingerprint:'web-new',evidenceDates:['2030-09-27']};let weatherCalls=0;
  const refreshed=await new MonitorAgentRunner({} as AiAdminService,{fetch:async()=>next} as unknown as MonitorSourceFetcher,1000,{forecast:async()=>{weatherCalls++;throw new Error('obsolete weather must not be fetched');}} as unknown as MetWeatherClient).refreshDependencies([oldWeb,oldWeather],undefined,{dynamicWeatherDate:true});
  assert.equal(refreshed.changed,true);assert.equal(refreshed.documents.length,1);assert.equal(refreshed.documents[0]!.fingerprint,'web-new');assert.equal(weatherCalls,0);
});

test('one bounded provider-neutral loop can combine approved web and official weather evidence',async()=>{
  const root:SourceDocument={finalUrl:'https://example.test/plan',contentType:'text/html',text:'Outdoor event tomorrow',headings:['Outdoor event'],links:[],fingerprint:'web-v1',fetchedAt:'2026-09-12T08:00:00Z'};
  const turns:AiProviderTurn[]=[{toolCalls:[{id:'web',name:'web.open',arguments:{url:root.finalUrl}},{id:'weather',name:'weather.forecast',arguments:{location:'Birkeland',period:'tomorrow'}}],generatedAt:'2026-09-12T08:00:00Z'},{output:'combined final',toolCalls:[],generatedAt:'2026-09-12T08:00:01Z'}];
  const ai={createTaskSession:async()=>({provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async()=>turns.shift()!})} as unknown as AiAdminService;
  const fetcher={fetch:async()=>root} as unknown as MonitorSourceFetcher;
  const weather={forecast:async()=>({sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=58.3312&lon=8.2325',attribution:'MET Norway Locationforecast' as const,retrievedAt:'2026-09-12T08:00:00Z',updatedAt:null,validFrom:'2026-09-13T06:00:00Z',validTo:'2026-09-13T06:00:00Z',location:{query:'Birkeland',canonicalName:'Birkeland',municipality:'Birkenes',region:'Agder',country:'Norge' as const,latitude:58.3312,longitude:8.2325,placeId:'1'},points:[{at:'2026-09-13T06:00:00Z',temperatureC:12,precipitationMm:0,windSpeedMps:3,symbolCode:'fair_day'}],fingerprint:'weather-v1',httpStatus:200 as const,cacheStatus:'miss' as const})} as unknown as MetWeatherClient;
  const outcome=await new MonitorAgentRunner(ai,fetcher,1000,weather).run({householdId:'00000000-0000-4000-8000-000000000001',task:{operation:'extract',purpose:'multi_tool_test',input:'combine with Birkeland weather',modelTier:'strong',sources:[]},policy:'default',rootUrl:root.finalUrl,toolNames:['web.open','weather.forecast'],requiredTools:['web.open','weather.forecast']});
  assert.equal(outcome.output,'combined final');assert.deepEqual(outcome.provenance.map((item)=>item.tool),['web.open','weather.forecast']);assert.deepEqual(outcome.dependencies.map((item)=>item.tool??'web.open'),['web.open','weather.forecast']);assert.equal(outcome.aiCalls,2);assert.equal(outcome.attemptedToolCount,2);
});
