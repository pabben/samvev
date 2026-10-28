import {Worker} from 'node:worker_threads';
import {DomainError} from '@samvev/core';
import type {CalendarEvent} from './service.ts';
import {MAX_SUBSCRIPTION_BYTES} from '../monitor/source-fetcher.ts';

const WORKER_TIMEOUT_MS=5_000;
const MAX_ACTIVE_WORKERS=2;
const MAX_QUEUED_WORKERS=4;
const PARSER_HEAP_MB=128;
type Window={from:string;to:string};
type Job={text:string;window:Window;resolve:(events:CalendarEvent[])=>void;reject:(error:unknown)=>void};
type WorkerMessage={ok:true;events:CalendarEvent[]}|{ok:false;code:string;status:number;details?:unknown};
const queue:Job[]=[];
let active=0;

function icsError(code:string,status:number,reason:string,details:Record<string,unknown>={}):DomainError{return new DomainError(code,status,{reason,...details});}
function domainError(message:WorkerMessage):DomainError{
  if(message.ok)return icsError('CALENDAR_ICS_PARSE_FAILED',502,'calendar_ics_parse_failed');
  const code=['CALENDAR_ICS_INVALID','CALENDAR_ICS_TOO_LARGE','CALENDAR_ICS_UNSUPPORTED'].includes(message.code)?message.code:'CALENDAR_ICS_PARSE_FAILED';
  const fallbackStatus=code==='CALENDAR_ICS_TOO_LARGE'?413:code==='CALENDAR_ICS_UNSUPPORTED'?422:502;
  const supplied=message.details&&typeof message.details==='object'&&!Array.isArray(message.details)?message.details as Record<string,unknown>:{};
  const allowedReasons=new Set(['calendar_ics_content_invalid','calendar_ics_occurrence_limit','calendar_ics_recurrence_frequency_unsupported']);
  const details:Record<string,unknown>={...(typeof supplied.reason==='string'&&allowedReasons.has(supplied.reason)?{reason:supplied.reason}:{reason:'calendar_ics_parse_failed'})};
  for(const key of ['maxOccurrences','maxParseMs','maxHeapMb'] as const)if(Number.isSafeInteger(supplied[key])&&(supplied[key] as number)>0)details[key]=supplied[key];
  return new DomainError(code,code==='CALENDAR_ICS_INVALID'?422:fallbackStatus,details);
}
function drain(){while(active<MAX_ACTIVE_WORKERS&&queue.length){const job=queue.shift()!;start(job);}}
function start(job:Job){
  active++;let worker:Worker,finished=false,timer:NodeJS.Timeout|undefined,result:WorkerMessage|undefined,failure:DomainError|undefined;
  const finish=()=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);active=Math.max(0,active-1);if(failure)job.reject(failure);else if(!result||!result.ok)job.reject(result?domainError(result):icsError('CALENDAR_ICS_PARSE_FAILED',502,'calendar_ics_parse_failed'));else job.resolve(result.events);drain();};
  try{worker=new Worker(new URL('./ics-parser-bootstrap.mjs',import.meta.url),{workerData:{text:job.text,window:job.window},resourceLimits:{maxOldGenerationSizeMb:PARSER_HEAP_MB,maxYoungGenerationSizeMb:16}});}
  catch{active=Math.max(0,active-1);job.reject(icsError('CALENDAR_ICS_PARSE_FAILED',502,'calendar_ics_worker_start_failed'));drain();return;}
  timer=setTimeout(()=>{failure=icsError('CALENDAR_ICS_PARSE_TIMEOUT',504,'calendar_ics_parse_timeout',{maxParseMs:WORKER_TIMEOUT_MS});void worker.terminate().then(finish,finish);},WORKER_TIMEOUT_MS);
  worker.once('message',(message:WorkerMessage)=>{if(!message||typeof message!=='object'||typeof message.ok!=='boolean'){failure=icsError('CALENDAR_ICS_PARSE_FAILED',502,'calendar_ics_parse_failed');return;}result=message;});
  worker.once('error',(error:NodeJS.ErrnoException)=>{const limit=error.code==='ERR_WORKER_OUT_OF_MEMORY';failure=icsError(limit?'CALENDAR_ICS_PARSE_LIMIT':'CALENDAR_ICS_PARSE_FAILED',limit?413:502,limit?'calendar_ics_parser_memory_limit':'calendar_ics_parse_failed',{maxHeapMb:PARSER_HEAP_MB});});
  worker.once('exit',(code)=>{if(!failure&&(!result||code!==0))failure=icsError('CALENDAR_ICS_PARSE_FAILED',502,'calendar_ics_parser_exited');finish();});
}

export function parseIcsEvents(text:string,window:Window):Promise<CalendarEvent[]>{
  const bytes=Buffer.byteLength(text,'utf8');
  if(bytes>MAX_SUBSCRIPTION_BYTES)return Promise.reject(icsError('CALENDAR_ICS_TOO_LARGE',413,'calendar_ics_response_too_large',{observedBytes:bytes,maxBytes:MAX_SUBSCRIPTION_BYTES}));
  return new Promise((resolve,reject)=>{
    const job={text,window,resolve,reject};
    if(active<MAX_ACTIVE_WORKERS)start(job);
    else if(queue.length<MAX_QUEUED_WORKERS)queue.push(job);
    else reject(icsError('CALENDAR_ICS_BUSY',503,'calendar_ics_parser_busy',{maxActive:MAX_ACTIVE_WORKERS,maxQueued:MAX_QUEUED_WORKERS}));
  });
}
