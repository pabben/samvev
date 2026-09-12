import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@samvev/core';

const PLACE_ENDPOINT='https://ws.geonorge.no/stedsnavn/v1/navn';
const FORECAST_ENDPOINT='https://api.met.no/weatherapi/locationforecast/2.0/compact';
/** Coordinate-free page that explains the authoritative public forecast source. */
export const MET_PUBLIC_FORECAST_URL='https://api.met.no/weatherapi/locationforecast/2.0/documentation';
const MAX_RESPONSE_BYTES=2*1024*1024;
const DEFAULT_TIMEOUT_MS=10_000;
const MAX_CACHE_ENTRIES=256;
const DEFAULT_USER_AGENT='Samvev/0.1 (+https://github.com/pabben/samvev)';
const JSON_MIME=/^application\/(?:[a-z0-9.+-]*\+)?json\b/i;
function isCalendarDate(value:string):boolean{const parsed=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;}

export const weatherForecastArgsSchema=z.object({
  location:z.string().trim().min(1).max(200),
  period:z.enum(['today','tomorrow','date']).default('tomorrow'),
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate,'invalid_date').optional(),
  timeWindow:z.enum(['all','night','morning','afternoon','evening']).default('all')
}).strict().superRefine((value,ctx)=>{if(value.period==='date'&&!value.date)ctx.addIssue({code:'custom',message:'date_required',path:['date']});});
export type WeatherForecastArgs=z.infer<typeof weatherForecastArgsSchema>;

export interface ResolvedPlace {query:string;canonicalName:string;municipality:string|null;region:string|null;country:'Norge';latitude:number;longitude:number;placeId:string;}
export interface WeatherPoint {at:string;temperatureC:number|null;precipitationMm:number|null;windSpeedMps:number|null;symbolCode:string|null;}
export interface WeatherForecast {
  sourceUrl:string;attribution:'MET Norway Locationforecast';retrievedAt:string;updatedAt:string|null;validFrom:string;validTo:string;
  location:ResolvedPlace;points:WeatherPoint[];fingerprint:string;httpStatus:200|203|304;cacheStatus:'hit'|'miss'|'revalidated';
}

export interface FixedHttpRequest {url:string;headers:Record<string,string>;signal:AbortSignal;}
export interface FixedHttpResponse {status:number;headers:{get(name:string):string|null};arrayBuffer():Promise<ArrayBuffer>;body?:{getReader():{read():Promise<{done:boolean;value?:Uint8Array}>;cancel(reason?:unknown):Promise<void>}}|null;}
export type FixedHttpTransport=(request:FixedHttpRequest)=>Promise<FixedHttpResponse>;
const defaultTransport:FixedHttpTransport=async(request)=>fetch(request.url,{method:'GET',headers:request.headers,signal:request.signal,redirect:'error'});

const boundedPlaceName=z.string().trim().min(1).max(200);
const boundedRegionName=z.string().trim().min(1).max(120);
const forecastTimestamp=z.string().max(40).datetime({offset:true});
const weatherSymbol=z.string().min(1).max(80).regex(/^[a-z0-9_]+$/i);
const placeResponseSchema=z.object({navn:z.array(z.object({
  skrivemåte:boundedPlaceName,stedsnummer:z.union([z.string().max(120),z.number()]).optional(),
  representasjonspunkt:z.object({øst:z.number(),nord:z.number()}).passthrough(),
  kommuner:z.array(z.object({kommunenavn:boundedRegionName.optional()}).passthrough()).max(20).optional(),
  fylker:z.array(z.object({fylkesnavn:boundedRegionName.optional()}).passthrough()).max(20).optional()
}).passthrough()).max(100)}).passthrough();

const forecastSchema=z.object({properties:z.object({
  meta:z.object({updated_at:forecastTimestamp.optional()}).passthrough(),
  timeseries:z.array(z.object({time:forecastTimestamp,data:z.object({
    instant:z.object({details:z.object({air_temperature:z.number().min(-100).max(80).optional(),wind_speed:z.number().min(0).max(150).optional()}).passthrough()}).passthrough(),
    next_1_hours:z.object({summary:z.object({symbol_code:weatherSymbol.optional()}).passthrough(),details:z.object({precipitation_amount:z.number().min(0).max(1000).optional()}).passthrough()}).passthrough().optional(),
    next_6_hours:z.object({summary:z.object({symbol_code:weatherSymbol.optional()}).passthrough(),details:z.object({precipitation_amount:z.number().min(0).max(1000).optional()}).passthrough()}).passthrough().optional()
  }).passthrough()}).passthrough()).max(500)
}).passthrough()}).passthrough();

function weatherUserAgent():string{
  const value=process.env.SAMVEV_WEATHER_USER_AGENT?.trim()||DEFAULT_USER_AGENT;
  if(value.length<8||value.length>200||!/^[\x20-\x7e]+$/.test(value)||!value.includes('/'))throw new DomainError('MONITOR_WEATHER_CONFIGURATION_INVALID',500);
  return value;
}

function normalized(value:string):string{return value.normalize('NFKC').toLocaleLowerCase('nb').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function rounded(value:number):number{return Math.round(value*10_000)/10_000;}
function safeCandidates(candidates:ResolvedPlace[]):Array<{name:string;municipality:string|null;region:string|null}>{return candidates.slice(0,5).map((item)=>({name:item.canonicalName,municipality:item.municipality,region:item.region}));}
function placeSearchTerms(requested:string):string[]{
  const commaName=requested.split(',')[0]!.trim();const words=requested.split(/\s+/).filter(Boolean);const values=[...(commaName&&commaName!==requested?[commaName]:[]),requested];
  if(commaName===requested)for(let end=words.length-1;end>=1&&values.length<3;end--)values.push(words.slice(0,end).join(' '));
  return [...new Set(values.map((value)=>value.trim()).filter(Boolean))].slice(0,3);
}
function mapError(error:unknown,signal:AbortSignal,invalid='MONITOR_WEATHER_INVALID'):never{
  if(signal.aborted)throw new DomainError('MONITOR_SOURCE_TIMEOUT',504);
  if(error instanceof DomainError)throw error;
  throw new DomainError(invalid,502);
}
async function readJson(response:FixedHttpResponse,signal:AbortSignal):Promise<unknown>{
  const contentType=response.headers.get('content-type')??'';if(!JSON_MIME.test(contentType))throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422);
  const length=Number(response.headers.get('content-length')??0);if(Number.isFinite(length)&&length>MAX_RESPONSE_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);
  let body:Buffer;
  try{
    if(response.body){const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;while(true){const item=await reader.read();if(item.done)break;if(!item.value)continue;size+=item.value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel('response_too_large');throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);}chunks.push(item.value);}body=Buffer.concat(chunks.map((item)=>Buffer.from(item)),size);}
    else{const value=await response.arrayBuffer();if(value.byteLength>MAX_RESPONSE_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);body=Buffer.from(value);}
  }catch(error){mapError(error,signal);}
  try{return JSON.parse(body!.toString('utf8'));}catch{throw new DomainError('MONITOR_WEATHER_INVALID',502);}
}
function withDeadline(parent:AbortSignal|undefined,timeoutMs:number):{signal:AbortSignal;close():void}{
  const controller=new AbortController();const abort=()=>controller.abort();if(parent?.aborted)controller.abort();else parent?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeoutMs);
  return{signal:controller.signal,close(){clearTimeout(timer);parent?.removeEventListener('abort',abort);controller.abort();}};
}
function boundedRetryAfter(value:string|null,nowMs:number):number|undefined{
  if(!value)return undefined;const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return Math.min(Math.ceil(seconds),3600);
  const date=Date.parse(value);if(!Number.isFinite(date))return undefined;return Math.min(Math.max(0,Math.ceil((date-nowMs)/1000)),3600);
}

export class KartverketPlaceResolver {
  constructor(private readonly transport:FixedHttpTransport=defaultTransport,private readonly timeoutMs=DEFAULT_TIMEOUT_MS){}
  async resolve(query:string,signal?:AbortSignal):Promise<ResolvedPlace>{
    const requested=query.normalize('NFKC').trim();if(!requested)throw new DomainError('MONITOR_LOCATION_REQUIRED',422);
    const deadline=withDeadline(signal,this.timeoutMs);
    try{
      let candidates:ResolvedPlace[]=[];
      for(const term of placeSearchTerms(requested)){
        const url=new URL(PLACE_ENDPOINT);url.searchParams.set('sok',term);url.searchParams.set('treffPerSide','20');url.searchParams.set('utkoordsys','4258');
        const response=await this.transport({url:url.toString(),headers:{accept:'application/json','accept-encoding':'gzip','user-agent':weatherUserAgent()},signal:deadline.signal});
        if(response.status===429){const retryAfter=boundedRetryAfter(response.headers.get('retry-after'),Date.now());throw new DomainError('MONITOR_WEATHER_RATE_LIMITED',502,retryAfter===undefined?undefined:{retryAfterSeconds:retryAfter});}if(response.status<200||response.status>=300)throw new DomainError('MONITOR_WEATHER_UNAVAILABLE',502);
        const parsed=placeResponseSchema.safeParse(await readJson(response,deadline.signal));if(!parsed.success)throw new DomainError('MONITOR_WEATHER_INVALID',502);
        candidates=parsed.data.navn.map((item):ResolvedPlace=>({query:requested,canonicalName:item.skrivemåte,municipality:item.kommuner?.[0]?.kommunenavn??null,region:item.fylker?.[0]?.fylkesnavn??null,country:'Norge',latitude:rounded(item.representasjonspunkt.nord),longitude:rounded(item.representasjonspunkt.øst),placeId:String(item.stedsnummer??`${item.skrivemåte}:${item.representasjonspunkt.nord}:${item.representasjonspunkt.øst}`)}));
        if(candidates.length)break;
      }
      if(!candidates.length)throw new DomainError('MONITOR_LOCATION_NOT_FOUND',422);
      const queryParts=normalized(requested).split(' ');const score=(item:ResolvedPlace)=>{const name=normalized(item.canonicalName);const municipality=normalized(item.municipality??'');const region=normalized(item.region??'');return(name===queryParts[0]?100:name.startsWith(queryParts[0]!)?50:0)+queryParts.slice(1).filter((part)=>municipality.includes(part)||region.includes(part)).length*20;};
      candidates.sort((a,b)=>score(b)-score(a)||a.canonicalName.localeCompare(b.canonicalName,'nb')||(a.municipality??'').localeCompare(b.municipality??'','nb')||a.placeId.localeCompare(b.placeId));
      const bestScore=score(candidates[0]!);const tied=candidates.filter((item)=>score(item)===bestScore);const distinct=new Set(tied.map((item)=>`${normalized(item.canonicalName)}|${normalized(item.municipality??'')}|${normalized(item.region??'')}`));
      if(bestScore<=0)throw new DomainError('MONITOR_LOCATION_NOT_FOUND',422);if(distinct.size>1)throw new DomainError('MONITOR_LOCATION_AMBIGUOUS',422,{candidates:safeCandidates(tied)});
      return candidates[0]!;
    }catch(error){mapError(error,deadline.signal,'MONITOR_WEATHER_UNAVAILABLE');}finally{deadline.close();}
  }
}

interface RawForecast {sourceUrl:string;retrievedAt:string;updatedAt:string|null;points:WeatherPoint[];httpStatus:200|203|304;cacheStatus:'hit'|'miss'|'revalidated';}
interface CacheEntry {forecast:RawForecast;expiresAt:number;lastModified:string|null;}
export function norwegianWeatherDate(instant:Date):string{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);}
function addCalendarDays(value:string,days:number):string{const date=new Date(`${value}T12:00:00.000Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
export function weatherTargetDate(args:WeatherForecastArgs,now:Date):string{
  const today=norwegianWeatherDate(now);const date=args.period==='date'?args.date!:args.period==='tomorrow'?addCalendarDays(today,1):today;
  if(date<today||date>addCalendarDays(today,9))throw new DomainError('MONITOR_WEATHER_DATE_UNAVAILABLE',422,{earliestDate:today,latestDate:addCalendarDays(today,9)});
  return date;
}
function inWindow(iso:string,window:WeatherForecastArgs['timeWindow']):boolean{if(window==='all')return true;const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',hour:'2-digit',hourCycle:'h23'}).format(new Date(iso)));return window==='night'?hour<6:window==='morning'?hour>=6&&hour<12:window==='afternoon'?hour>=12&&hour<18:hour>=18;}

export class MetWeatherClient {
  private readonly cache=new Map<string,CacheEntry>();private readonly inFlight=new Map<string,Promise<RawForecast>>();
  constructor(private readonly resolver=new KartverketPlaceResolver(),private readonly transport:FixedHttpTransport=defaultTransport,private readonly timeoutMs=DEFAULT_TIMEOUT_MS,private readonly now=()=>new Date()){}
  async forecast(raw:unknown,signal?:AbortSignal):Promise<WeatherForecast>{
    const args=weatherForecastArgsSchema.parse(raw);const deadline=withDeadline(signal,this.timeoutMs);
    try{const place=await this.resolver.resolve(args.location,deadline.signal);const date=weatherTargetDate(args,this.now());const key=`${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;let rawForecast=this.inFlight.get(key);
      if(!rawForecast){rawForecast=this.fetchForecast(place,key,deadline.signal);this.inFlight.set(key,rawForecast);}
      let source:RawForecast;try{source=await rawForecast;}finally{if(this.inFlight.get(key)===rawForecast)this.inFlight.delete(key);}
      const points=source.points.filter((item)=>norwegianWeatherDate(new Date(item.at))===date&&inWindow(item.at,args.timeWindow)).slice(0,24);
      if(!points.length)throw new DomainError('MONITOR_WEATHER_DATE_UNAVAILABLE',422,{earliestDate:norwegianWeatherDate(new Date(source.points[0]?.at??this.now())),latestDate:norwegianWeatherDate(new Date(source.points.at(-1)?.at??this.now()))});
      const fingerprint=createHash('sha256').update(JSON.stringify({place:{lat:place.latitude,lon:place.longitude},date,window:args.timeWindow,points})).digest('hex');
      return{sourceUrl:source.sourceUrl,attribution:'MET Norway Locationforecast',retrievedAt:source.retrievedAt,updatedAt:source.updatedAt,validFrom:points[0]!.at,validTo:points.at(-1)!.at,location:place,points,fingerprint,httpStatus:source.httpStatus,cacheStatus:source.cacheStatus};}
    finally{deadline.close();}
  }
  private async fetchForecast(place:ResolvedPlace,key:string,parent?:AbortSignal):Promise<RawForecast>{
    const cached=this.cache.get(key);if(cached&&cached.expiresAt>this.now().getTime())return{...cached.forecast,cacheStatus:'hit'};
    const deadline=withDeadline(parent,this.timeoutMs);
    try{
      const url=new URL(FORECAST_ENDPOINT);url.searchParams.set('lat',place.latitude.toFixed(4));url.searchParams.set('lon',place.longitude.toFixed(4));
      const headers:Record<string,string>={accept:'application/json','accept-encoding':'gzip','user-agent':weatherUserAgent()};if(cached?.lastModified)headers['if-modified-since']=cached.lastModified;
      const response=await this.transport({url:url.toString(),headers,signal:deadline.signal});
      if(response.status===304&&cached){const expires=Date.parse(response.headers.get('expires')??'');const next={...cached,expiresAt:Number.isFinite(expires)?expires:this.now().getTime()+5*60_000,forecast:{...cached.forecast,retrievedAt:this.now().toISOString(),httpStatus:304 as const,cacheStatus:'revalidated' as const}};this.cache.set(key,next);return next.forecast;}
      if(response.status===403)throw new DomainError('MONITOR_WEATHER_FORBIDDEN',502);
      if(response.status===429){const retryAfter=boundedRetryAfter(response.headers.get('retry-after'),this.now().getTime());throw new DomainError('MONITOR_WEATHER_RATE_LIMITED',502,retryAfter===undefined?undefined:{retryAfterSeconds:retryAfter});}
      if(response.status!==200&&response.status!==203)throw new DomainError('MONITOR_WEATHER_UNAVAILABLE',502);
      const parsed=forecastSchema.safeParse(await readJson(response,deadline.signal));if(!parsed.success)throw new DomainError('MONITOR_WEATHER_INVALID',502);
      const points=parsed.data.properties.timeseries.map((item):WeatherPoint=>({at:item.time,temperatureC:item.data.instant.details.air_temperature??null,windSpeedMps:item.data.instant.details.wind_speed??null,precipitationMm:item.data.next_1_hours?.details.precipitation_amount??item.data.next_6_hours?.details.precipitation_amount??null,symbolCode:item.data.next_1_hours?.summary.symbol_code??item.data.next_6_hours?.summary.symbol_code??null}));if(!points.length)throw new DomainError('MONITOR_WEATHER_INVALID',502);
      const forecast:RawForecast={sourceUrl:url.toString(),retrievedAt:this.now().toISOString(),updatedAt:parsed.data.properties.meta.updated_at??null,points,httpStatus:response.status as 200|203,cacheStatus:cached?'revalidated':'miss'};
      const expires=Date.parse(response.headers.get('expires')??'');if(!this.cache.has(key)&&this.cache.size>=MAX_CACHE_ENTRIES)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{forecast,expiresAt:Number.isFinite(expires)?expires:this.now().getTime()+5*60_000,lastModified:response.headers.get('last-modified')});return forecast;
    }catch(error){mapError(error,deadline.signal,'MONITOR_WEATHER_UNAVAILABLE');}finally{deadline.close();}
  }
}

export function weatherEvidenceText(forecast:WeatherForecast):string{
  const place=[forecast.location.canonicalName,forecast.location.municipality,forecast.location.region,forecast.location.country].filter(Boolean).join(', ');
  return [`Location: ${place}`,`Source: ${forecast.attribution}`,`Valid: ${forecast.validFrom} to ${forecast.validTo}`,...forecast.points.map((point)=>`Forecast ${point.at}: temperature ${point.temperatureC??'unknown'} C; precipitation ${point.precipitationMm??'unknown'} mm; wind ${point.windSpeedMps??'unknown'} m/s; symbol ${point.symbolCode??'unknown'}`)].join('\n');
}
