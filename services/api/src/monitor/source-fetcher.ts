import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { DomainError } from '@samvev/core';
import { createPinnedLookup } from '../pinned-lookup.ts';

const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ICS_BYTES = 8 * 1024 * 1024;
const MAX_ICS_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVE_ICS_FETCHES = 4;
let activeIcsFetches = 0;
/**
 * ICS downloads default to 8 MiB and may be raised to 16 MiB with
 * SAMVEV_ICS_MAX_BYTES. Values outside 5–16 MiB fall back to the 8 MiB
 * default. Fetches remain pinned, streamed, and time-limited to 15 seconds;
 * at most four downloads/conversions run in this process at once, with no
 * waiting queue. Parsing is isolated in a worker with a 128 MiB heap and a
 * 5 second timeout.
 */
export function maxIcsSubscriptionBytes():number{
  const raw=process.env.SAMVEV_ICS_MAX_BYTES?.trim();
  if(!raw)return DEFAULT_MAX_ICS_BYTES;
  if(!/^\d+$/.test(raw))return DEFAULT_MAX_ICS_BYTES;
  const configured=Number(raw);
  return Number.isSafeInteger(configured)&&configured>=5*1024*1024&&configured<=MAX_ICS_BYTES?configured:DEFAULT_MAX_ICS_BYTES;
}
export const MAX_SUBSCRIPTION_BYTES = maxIcsSubscriptionBytes();
const MAX_TEXT = 250_000;
const MAX_AI_TEXT = 20_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
const blockedNames = new Set(['localhost','metadata.google.internal','metadata.google','metadata.goog','instance-data.ec2.internal','metadata.azure.internal']);
const blockedQueryKeys=new Set([
  'token','accesstoken','refreshtoken','idtoken','apikey','key','auth','authorization','bearer','jwt','credential',
  'password','secret','clientsecret','signature','sharedaccesssignature','sastoken','sig','session','cookie','securitytoken',
  'sr','st','spr'
]);

function hasCredentialQuery(url:URL):boolean{
  for(const key of url.searchParams.keys()){
    const compact=key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(blockedQueryKeys.has(compact)||/^(?:xamz|xgoog)(?:signature|credential|securitytoken)$/.test(compact))return true;
  }
  return false;
}

function ipv4(address:string):number[]|undefined { return isIP(address)===4 ? address.split('.').map(Number) : undefined; }
function ipv6(address:string):bigint|undefined{let value=address.toLowerCase().split('%')[0]!;const dotted=value.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];if(dotted){const parts=ipv4(dotted);if(!parts)return undefined;value=`${value.slice(0,-dotted.length)}${((parts[0]!<<8)|parts[1]!).toString(16)}:${((parts[2]!<<8)|parts[3]!).toString(16)}`;}const halves=value.split('::');if(halves.length>2)return undefined;const left=halves[0]?halves[0].split(':'):[];const right=halves[1]?halves[1].split(':'):[];const missing=8-left.length-right.length;if((halves.length===1&&missing!==0)||missing<0)return undefined;const groups=halves.length===2?[...left,...Array<string>(missing).fill('0'),...right]:left;if(groups.length!==8||groups.some((group)=>!/^[0-9a-f]{1,4}$/.test(group)))return undefined;return groups.reduce((result,group)=>(result<<16n)|BigInt(Number.parseInt(group,16)),0n);}
function prefix(value:bigint,bits:number,expected:bigint):boolean{return value>>BigInt(128-bits)===expected;}
export function isBlockedMonitorAddress(address:string):boolean {
  const p=ipv4(address);
  if(p){const [a,b,c]=p;return a===0||a===10||a===127||(a===100&&b!>=64&&b!<=127)||(a===169&&b===254)||(a===172&&b!>=16&&b!<=31)||(a===192&&(b===0||b===168||(b===88&&c===99)))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0&&c===113)||a!>=224;}
  if(isIP(address)!==6)return true;
  const v=ipv6(address);if(v===undefined||!prefix(v,3,1n))return true;
  return prefix(v,16,0x2002n)||prefix(v,32,0x20010000n)||prefix(v,32,0x20010db8n)||prefix(v,48,0x200100020000n)||prefix(v,28,0x2001001n)||prefix(v,20,0x3fff0n);
}

export function normalizeMonitorUrl(value:string):string {
  let url:URL;
  try{url=new URL(value);}catch{throw new DomainError('VALIDATION_FAILED',400);}
  const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!['http:','https:'].includes(url.protocol)||!hostname||url.username||url.password||hasCredentialQuery(url)||hostname.includes('%')||blockedNames.has(hostname)||hostname.endsWith('.metadata.google.internal')) throw new DomainError('AI_ENDPOINT_BLOCKED',422);
  if(isIP(hostname)&&isBlockedMonitorAddress(hostname))throw new DomainError('AI_ENDPOINT_BLOCKED',422);
  url.hash='';
  return url.toString();
}

function trimUrlPunctuation(value:string):string {
  return value.replace(/[),.;!?\]}]+$/g,'');
}

/** Deterministic extraction only. The model never selects an unapproved source. */
export function sourceUrlFromInstruction(instruction:string,manualSource?:string):string {
  if(manualSource?.trim())return normalizeMonitorUrl(manualSource.trim());
  const matches:string[]=[];
  const withoutUrls=instruction.replace(/https?:\/\/[^\s<>"']+/gi,(match)=>{matches.push(trimUrlPunctuation(match));return ' ';});
  const withoutEmails=withoutUrls.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,' ');
  const withoutIps=withoutEmails.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s<>"']*)?/g,(match)=>{matches.push(`https://${trimUrlPunctuation(match)}`);return ' ';});
  const domains=withoutIps.match(/\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"']*)?/gi)??[];
  matches.push(...domains.map(trimUrlPunctuation).map((value)=>`https://${value}`));
  const normalized=[...new Set(matches.map((value)=>normalizeMonitorUrl(value)))];
  if(normalized.length===0)throw new DomainError('MONITOR_SOURCE_REQUIRED',422);
  if(normalized.length!==1)throw new DomainError('MONITOR_SOURCE_AMBIGUOUS',422);
  return normalized[0]!;
}

export interface SourceLink { url:string; label:string; }
export interface SourceDocument {
  finalUrl:string; contentType:'text/html'|'application/pdf'|'application/vnd.met.no.locationforecast+json'; text:string; fingerprint:string;
  title?:string; headings?:string[]; links?:SourceLink[]; fetchedAt?:string; etag?:string; lastModified?:string;
  httpStatus?:number; byteSize?:number;
  /** Server-only successful tool request aliases. Never sourced from model output. */
  evidenceUrlAliases?:string[];
  /** Typed metadata for server-side evidence validation. Never accepted from model output. */
  evidenceKind?:'web'|'weather';
  evidenceDates?:string[];
  /** True only when the exact normalized source text was fully exposed to the model. */
  evidenceComplete?:boolean;
  /** Public citation URL with sensitive query coordinates removed when needed. */
  publicEvidenceUrl?:string;
}
export type MonitorResolver=(hostname:string)=>Promise<Array<{address:string;family:4|6}>>;

export function selectRelevantSource(source:SourceDocument,rule:unknown):SourceDocument{
  const candidate=rule&&typeof rule==='object'?rule as Record<string,unknown>:{};
  const terms=['eventTypes','keywords','people'].flatMap((key)=>Array.isArray(candidate[key])?candidate[key] as unknown[]:[]).filter((value):value is string=>typeof value==='string').map((value)=>value.normalize('NFKC').trim().toLocaleLowerCase()).filter((value)=>value.length>=2);
  const unique=[...new Set(terms)].sort();if(!unique.length){const text=source.text.slice(0,MAX_AI_TEXT);return {...source,text,fingerprint:createHash('sha256').update(`monitor-relevance-v1\n\n${text}`).digest('hex')};}
  const lines=source.text.split('\n');const selected=new Set<number>();
  lines.forEach((line,index)=>{const lower=line.toLocaleLowerCase();if(unique.some((term)=>lower.includes(term)))for(let context=Math.max(0,index-1);context<=Math.min(lines.length-1,index+1);context++)selected.add(context);});
  const text=[...selected].sort((a,b)=>a-b).map((index)=>lines[index]!).join('\n').slice(0,MAX_AI_TEXT);
  const fingerprint=createHash('sha256').update(`monitor-relevance-v1\n${unique.join('\n')}\n${text}`).digest('hex');
  return {...source,text,fingerprint};
}

function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)return Promise.reject(new DOMException('aborted','AbortError'));return Promise.race([promise,new Promise<T>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))]);}
async function resolvePublic(url:URL,resolver:MonitorResolver,signal:AbortSignal):Promise<{address:string;family:4|6}>{
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  const targets=await abortable(resolver(hostname),signal).catch((error)=>{if(signal.aborted)throw error;throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);});
  if(!targets.length||targets.some((target)=>isBlockedMonitorAddress(target.address)))throw new DomainError('AI_ENDPOINT_BLOCKED',422);
  return targets[0]!;
}
const defaultResolver:MonitorResolver=async(hostname)=>{
  const family=isIP(hostname);if(family)return [{address:hostname,family:family as 4|6}];
  return (await lookup(hostname,{all:true,verbatim:true})).map((row)=>({address:row.address,family:row.family as 4|6}));
};

type PinnedResponse={status:number;headers:Record<string,string|undefined>;body:Buffer};
type PinnedFetchOptions={maxBytes:number;tooLargeCode:string;accept?:string};
type PinnedTransport=(url:URL,target:{address:string;family:4|6},signal:AbortSignal,options?:PinnedFetchOptions)=>Promise<PinnedResponse>;
function fetchPinned(url:URL,target:{address:string;family:4|6},signal:AbortSignal,limits?:PinnedFetchOptions):Promise<PinnedResponse>{
  return new Promise((resolve,reject)=>{
    const fn=url.protocol==='https:'?httpsRequest:httpRequest;
    const options:RequestOptions={method:'GET',headers:{accept:limits?.accept??'text/html,application/xhtml+xml,application/pdf;q=0.9','user-agent':'Samvev-Monitor/1.0'},signal,lookup:createPinnedLookup(target)};
    const maxBytes=limits?.maxBytes??MAX_BYTES,tooLargeCode=limits?.tooLargeCode??'MONITOR_SOURCE_TOO_LARGE';
    const req=fn(url,options,(res)=>{const chunks:Buffer[]=[];let size=0;const declared=res.headers['content-length'];if(declared&&/^\d+$/.test(declared)&&Number(declared)>maxBytes){res.destroy(new DomainError(tooLargeCode,413,{reason:tooLargeCode==='CALENDAR_ICS_TOO_LARGE'?'calendar_ics_response_too_large':'source_response_too_large',declaredBytes:Number(declared),maxBytes}));return;}res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes)res.destroy(new DomainError(tooLargeCode,413,{reason:tooLargeCode==='CALENDAR_ICS_TOO_LARGE'?'calendar_ics_response_too_large':'source_response_too_large',observedBytes:size,maxBytes}));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode??502,headers:{location:res.headers.location,'content-type':res.headers['content-type'],'etag':res.headers.etag,'last-modified':res.headers['last-modified']},body:Buffer.concat(chunks)}));});
    req.on('error',reject);req.end();
  });
}

function decodeEntities(value:string):string{return value.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number(n)));}
function htmlText(html:string):string{return decodeEntities(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi,' ').replace(/<\/?(?:p|div|li|tr|td|th|h[1-6]|br|section|article)[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')).split('\n').map((line)=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n').slice(0,MAX_TEXT);}
function elementText(value:string):string{return decodeEntities(value.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function semanticHtml(html:string):string{
  const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);if(!main)return html;
  return main[1]!.replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
}
function anchorLabel(anchorHtml:string,fallbackUrl:string):string{
  const heading=anchorHtml.match(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i);const preferred=heading?.[2]??anchorHtml;
  return elementText(preferred).slice(0,200)||new URL(fallbackUrl).pathname.slice(0,200);
}
function htmlStructure(fullHtml:string,contentHtml:string,base:URL):{title?:string;headings:string[];links:SourceLink[]}{
  const titleMatch=fullHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);const title=titleMatch?elementText(titleMatch[1]!).slice(0,300):undefined;
  const headings=[...contentHtml.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((match)=>elementText(match[1]!)).filter(Boolean).slice(0,40).map((value)=>value.slice(0,300));
  const links:SourceLink[]=[];const seen=new Set<string>();
  for(const match of contentHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const url=new URL(match[1]!,base);if(!['http:','https:'].includes(url.protocol)){continue;}const normalized=normalizeMonitorUrl(url.toString());if(seen.has(normalized))continue;seen.add(normalized);links.push({url:normalized,label:anchorLabel(match[2]!,normalized)});if(links.length>=200)break;}catch{/* omit malformed or forbidden links */}
  }
  return {...(title?{title}:{}),headings,links};
}
function linkedPdf(html:string,base:URL):URL|undefined{
  for(const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)){try{const url=new URL(match[1]!,base);if(url.pathname.toLowerCase().endsWith('.pdf'))return url;}catch{/* ignore invalid link */}}
  return undefined;
}
async function pdfText(bytes:Uint8Array,signal:AbortSignal):Promise<string>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document=await abortable(pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true}).promise,signal);
  if(document.numPages>40)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);
  const lines:string[]=[];
  for(let page=1;page<=document.numPages;page++){
    const content=await abortable((await abortable(document.getPage(page),signal)).getTextContent(),signal);
    let line='';for(const item of content.items){if(!('str' in item))continue;line+=`${line?' ':''}${item.str}`;if(item.hasEOL){lines.push(line);line='';}}if(line)lines.push(line);
    if(lines.join('\n').length>MAX_TEXT)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);
  }
  const text=lines.join('\n').replace(/[ \t]+/g,' ').trim();
  if(!text)throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422);
  return text;
}

export class MonitorSourceFetcher {
  constructor(private readonly resolver:MonitorResolver=defaultResolver,private readonly transport=fetchPinned,private readonly timeoutMs=TIMEOUT_MS,private readonly extractPdfText=pdfText){}
  async fetch(rawUrl:string,options:{followLinkedPdf?:boolean;signal?:AbortSignal;redirectOrigin?:string}={}):Promise<SourceDocument>{
    const controller=new AbortController();let abortCause:'source_deadline'|'caller_abort'|undefined;let phase:'dns'|'request'|'redirect'|'pdf'='dns';const abort=(cause:'source_deadline'|'caller_abort')=>{abortCause??=cause;controller.abort();};const callerAbort=()=>abort('caller_abort');if(options.signal?.aborted)callerAbort();else options.signal?.addEventListener('abort',callerAbort,{once:true});const timeout=setTimeout(()=>abort('source_deadline'),this.timeoutMs);
    try{
    try{if(isCalendarSubscriptionUrl(new URL(rawUrl)))throw new DomainError('CALENDAR_SOURCE_USE_ICS',422);}catch(error){if(error instanceof DomainError)throw error;}
      let url=new URL(normalizeMonitorUrl(rawUrl));let response:Awaited<ReturnType<typeof fetchPinned>>|undefined;
      for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
        if(redirects>0)phase='redirect';else phase='dns';const target=await resolvePublic(url,this.resolver,controller.signal);phase=redirects>0?'redirect':'request';response=await this.transport(url,target,controller.signal);if(response.body.length>MAX_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);
        if(response.status>=300&&response.status<400&&response.headers.location){if(redirects===MAX_REDIRECTS)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);phase='redirect';const redirect=new URL(normalizeMonitorUrl(new URL(response.headers.location,url).toString()));if(options.redirectOrigin&&redirect.origin!==options.redirectOrigin)throw new DomainError('AI_ENDPOINT_BLOCKED',422);url=redirect;continue;}break;
      }
      if(!response||response.status<200||response.status>=300)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);
      let kind=(response.headers['content-type']??'').split(';')[0]!.trim().toLowerCase();
      if(!kind&&url.pathname.toLowerCase().endsWith('.pdf'))kind='application/pdf';
      let text:string;let finalUrl=url.toString();let metadata=response;let structure:{title?:string;headings:string[];links:SourceLink[]}|undefined;
      if(kind==='text/html'||kind==='application/xhtml+xml'){
        const html=response.body.toString('utf8');const content=semanticHtml(html);structure=htmlStructure(html,content,url);const pdf=options.followLinkedPdf===false?undefined:linkedPdf(content,url);
        if(pdf){
          const pageOrigin=url.origin;
          let safePdf=new URL(normalizeMonitorUrl(pdf.toString()));let linked:Awaited<ReturnType<typeof fetchPinned>>|undefined;
          if(safePdf.origin!==pageOrigin)throw new DomainError('AI_ENDPOINT_BLOCKED',422);
          for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){phase=redirects?'redirect':'dns';const target=await resolvePublic(safePdf,this.resolver,controller.signal);phase=redirects?'redirect':'request';linked=await this.transport(safePdf,target,controller.signal);if(linked.body.length>MAX_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);if(linked.status>=300&&linked.status<400&&linked.headers.location){if(redirects===MAX_REDIRECTS)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);phase='redirect';const redirect=new URL(normalizeMonitorUrl(new URL(linked.headers.location,safePdf).toString()));if(redirect.origin!==pageOrigin)throw new DomainError('AI_ENDPOINT_BLOCKED',422);safePdf=redirect;continue;}break;}
          if(!linked)throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);
          if(linked.body.length>MAX_BYTES)throw new DomainError('MONITOR_SOURCE_TOO_LARGE',413);const linkedType=(linked.headers['content-type']??'').split(';')[0]!.toLowerCase();
          if(linked.status>=200&&linked.status<300&&linkedType==='application/pdf'){phase='pdf';text=await this.extractPdfText(linked.body,controller.signal);kind='application/pdf';finalUrl=safePdf.toString();metadata=linked;}else text=htmlText(content);
        }else text=htmlText(content);
      }else if(kind==='application/pdf'){phase='pdf';text=await this.extractPdfText(response.body,controller.signal);}else throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422);
      if(!text)throw new DomainError('MONITOR_SOURCE_UNSUPPORTED',422);
      if(controller.signal.aborted)throw new DomainError('MONITOR_SOURCE_TIMEOUT',504);const normalized=text.normalize('NFKC').replace(/\r/g,'').trim();
      return {finalUrl,contentType:kind==='application/pdf'?'application/pdf':'text/html',text:normalized,fingerprint:createHash('sha256').update(normalized).digest('hex'),fetchedAt:new Date().toISOString(),httpStatus:metadata.status,byteSize:metadata.body.length,...(structure??{}),...(metadata.headers.etag?{etag:metadata.headers.etag}:{}),...(metadata.headers['last-modified']?{lastModified:metadata.headers['last-modified']}:{})};
    }catch(error){if(controller.signal.aborted)throw new DomainError('MONITOR_SOURCE_TIMEOUT',504,{sourceFetchCause:abortCause??'caller_abort',sourceFetchPhase:phase});if(error instanceof DomainError)throw error;throw new DomainError('MONITOR_SOURCE_UNAVAILABLE',502);}
    finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',callerAbort);}
  }
}

/** Secret subscription URLs may legitimately carry opaque query credentials.
 * They use the same DNS/IP pinning and redirect checks as monitor fetches, but
 * are never returned in projections or logs. */
export function normalizeSecretSubscriptionUrl(value:string):string{
  let url:URL;try{const normalized=value.trim().replace(/^webcal:/i,'https:');url=new URL(normalized);}catch{throw new DomainError('VALIDATION_FAILED',400);}
  const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(url.protocol!=='https:'||!hostname||url.username||url.password||hostname.includes('%')||blockedNames.has(hostname)||hostname.endsWith('.metadata.google.internal'))throw new DomainError('AI_ENDPOINT_BLOCKED',422);
  if(isIP(hostname)&&isBlockedMonitorAddress(hostname))throw new DomainError('AI_ENDPOINT_BLOCKED',422);url.hash='';return url.toString();
}

export class SecretSubscriptionFetcher{
  constructor(private readonly resolver:MonitorResolver=defaultResolver,private readonly transport:PinnedTransport=fetchPinned,private readonly timeoutMs=TIMEOUT_MS){}
  async fetch(rawUrl:string):Promise<string>{
    if(activeIcsFetches>=MAX_ACTIVE_ICS_FETCHES)throw new DomainError('CALENDAR_ICS_BUSY',503,{reason:'calendar_ics_fetch_busy',maxConcurrent:MAX_ACTIVE_ICS_FETCHES});
    activeIcsFetches++;
    let controller:AbortController|undefined,timeout:NodeJS.Timeout|undefined;
    try{
      const activeController=new AbortController();controller=activeController;timeout=setTimeout(()=>activeController.abort(),this.timeoutMs);
      let url=new URL(normalizeSecretSubscriptionUrl(rawUrl));let response:Awaited<ReturnType<typeof fetchPinned>>|undefined;
      for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
        if(isGoogleCalendarViewUrl(url))throw new DomainError('CALENDAR_ICS_GOOGLE_VIEW_URL',422,{reason:'calendar_google_view_url_not_ics'});
        const maxBytes=maxIcsSubscriptionBytes();const target=await resolvePublic(url,this.resolver,activeController.signal);response=await this.transport(url,target,activeController.signal,{maxBytes,tooLargeCode:'CALENDAR_ICS_TOO_LARGE',accept:'text/calendar, text/plain, application/octet-stream'});
        if(response.body.length>maxBytes)throw new DomainError('CALENDAR_ICS_TOO_LARGE',413,{reason:'calendar_ics_response_too_large',observedBytes:response.body.length,maxBytes});
        if(response.status>=300&&response.status<400){if(!response.headers.location)throw new DomainError('CALENDAR_ICS_HTTP_ERROR',502,{reason:'calendar_ics_redirect_invalid',httpStatus:response.status});if(redirects===MAX_REDIRECTS)throw new DomainError('CALENDAR_ICS_HTTP_ERROR',502,{reason:'calendar_ics_redirect_limit',httpStatus:response.status});url=new URL(normalizeSecretSubscriptionUrl(new URL(response.headers.location,url).toString()));continue;}break;
      }
      if(!response)throw new DomainError('CALENDAR_ICS_NETWORK_ERROR',502,{reason:'calendar_ics_response_missing'});
      if(response.status===401||response.status===403)throw new DomainError('CALENDAR_ICS_ACCESS_DENIED',502,{reason:'calendar_ics_access_denied',httpStatus:response.status});
      if(response.status<200||response.status>=300)throw new DomainError('CALENDAR_ICS_HTTP_ERROR',502,{reason:'calendar_ics_http_error',httpStatus:response.status});
      const type=(response.headers['content-type']??'').split(';')[0]!.trim().toLowerCase();if(type&&!['text/calendar','text/plain','application/octet-stream'].includes(type))throw new DomainError('CALENDAR_ICS_UNSUPPORTED',422,{reason:'calendar_ics_media_type_unsupported'});
      const text=response.body.toString('utf8');if(!/^BEGIN:VCALENDAR\r?$/m.test(text)||!/^END:VCALENDAR\r?$/m.test(text))throw new DomainError('CALENDAR_ICS_INVALID',422,{reason:'calendar_ics_format_invalid'});return text;
    }catch(error){if(controller?.signal.aborted)throw new DomainError('CALENDAR_ICS_TIMEOUT',504,{reason:'calendar_ics_request_timeout'});if(error instanceof DomainError)throw error;throw new DomainError('CALENDAR_ICS_NETWORK_ERROR',502,{reason:'calendar_ics_network_error'});}finally{if(timeout)clearTimeout(timeout);activeIcsFetches=Math.max(0,activeIcsFetches-1);}
  }
}

export function isGoogleCalendarViewUrl(url:URL):boolean{
  if(url.hostname.toLowerCase()!=='calendar.google.com')return false;
  const path=url.pathname.toLowerCase();
  if(path.includes('/calendar/ical/'))return false;
  if(url.searchParams.has('cid')&&/^\/calendar(?:\/u\/\d+)?\/?$/.test(path))return true;
  return /\/calendar\/(?:u\/\d+\/)?(?:r|embed|render)(?:\/|$)/.test(path)||path==='/calendar/embed'||path==='/calendar/render';
}

export function isCalendarSubscriptionUrl(url:URL):boolean{
  return url.pathname.toLowerCase().endsWith('.ics')||isGoogleCalendarViewUrl(url);
}
