import {parentPort,workerData} from 'node:worker_threads';
import {DomainError} from '@samvev/core';
import {parseIcsEventsInProcess} from './ics-parser-core.ts';

if(!parentPort)throw new Error('ICS parser worker requires a parent port');
const input=workerData as {text:string;window:{from:string;to:string}};
try{parentPort.postMessage({ok:true,events:parseIcsEventsInProcess(input.text,input.window)});}
catch(error){
  if(error instanceof DomainError)parentPort.postMessage({ok:false,code:error.code,status:error.status,details:error.details});
  else parentPort.postMessage({ok:false,code:'CALENDAR_ICS_PARSE_FAILED',status:502,details:{reason:'calendar_ics_parse_failed'}});
}
