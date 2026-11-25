import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

registerHooks({load(url,context,nextLoad){
 return /\.(svg|png|webp)$/.test(url)?{format:'module',source:`export default ${JSON.stringify(url.split('/').at(-1))}`,shortCircuit:true}:nextLoad(url,context);
}});
const {CalendarErrorNotice}=await import('../src/calendar-connections');
const {LocaleProvider}=await import('../src/ui');
const {ApiError}=await import('../src/api');
const {en}=await import('../src/locales/en');
const {nb}=await import('../src/locales/nb');

function render(locale:'en'|'nb',code:string,details?:Record<string,unknown>){
 return renderToStaticMarkup(createElement(LocaleProvider,{locale,children:createElement(CalendarErrorNotice,{error:new ApiError(code,413,details)})}));
}

test('occurrence limits retain their event-count explanation instead of becoming download errors',()=>{
 for(const locale of ['en','nb'] as const){
  const output=render(locale,'CALENDAR_ICS_TOO_LARGE',{reason:'calendar_ics_occurrence_limit',maxOccurrences:10000});
  assert.match(output,new RegExp(new Intl.NumberFormat(locale).format(10000)));
  assert.match(output,locale==='en'?/appointments in the selected time window/:/avtaler i det valgte tidsvinduet/);
  assert.doesNotMatch(output,/\{\w+\}|MiB/);
 }
});

test('numeric error details interpolate while missing or invalid details use complete fallback text',()=>{
 const cases=[
  ['CALENDAR_ICS_PARSE_TIMEOUT','calendar_ics_parse_timeout','maxParseMs',5000],
  ['CALENDAR_ICS_TOO_LARGE','calendar_ics_occurrence_limit','maxOccurrences',10000],
  ['CALENDAR_ICS_PARSE_LIMIT','calendar_ics_parser_memory_limit','maxHeapMb',128],
  ['CALENDAR_ICS_ACCESS_DENIED','calendar_ics_access_denied','httpStatus',403],
  ['CALENDAR_ICS_HTTP_ERROR','calendar_ics_http_error','httpStatus',502],
 ] as const;
 for(const locale of ['en','nb'] as const)for(const [code,reason,param,value] of cases){
  const output=render(locale,code,{reason,[param]:value});
  assert.match(output,new RegExp(new Intl.NumberFormat(locale).format(value)));
  assert.doesNotMatch(output,/\{\w+\}/);
  for(const missing of [undefined,NaN,Infinity,-1,'unknown']){
   const fallback=render(locale,code,{reason,[param]:missing});
   assert.doesNotMatch(fallback,/\{\w+\}|NaN|Infinity|unknown/);
   assert.ok(fallback.includes((locale==='en'?en:nb)[code]));
  }
 }
});

test('byte overflow notices distinguish received bytes, declared bytes, and absent measurements',()=>{
 for(const locale of ['en','nb'] as const){
  for(const details of [
   {reason:'calendar_ics_response_too_large',observedBytes:9*1048576,maxBytes:8*1048576},
   {reason:'calendar_ics_response_too_large',declaredBytes:9*1048576,maxBytes:8*1048576},
   {reason:'calendar_ics_response_too_large'},
   undefined,
  ]){
   const output=render(locale,'CALENDAR_ICS_TOO_LARGE',details);
   assert.doesNotMatch(output,/\{\w+\}/);
   if(details?.maxBytes){assert.match(output,/9 MiB/);assert.match(output,/8 MiB/);}
  }
 }
});
