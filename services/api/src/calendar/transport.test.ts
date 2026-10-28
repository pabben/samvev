import assert from 'node:assert/strict';
import test,{afterEach,beforeEach} from 'node:test';
import {CalendarService,DefaultCalendarTransport,parseIcsEvents,uniqueCalendarProviderEvents,type CalendarEvent,type CalendarProviderEvent} from './service.ts';
import {canonicalCalendarEvent} from './ics-parser-core.ts';
import {parseHomeAssistantCalendarEvents} from './home-assistant-client.ts';
import {normalizeHomeAssistantOrigin} from './provider-config.ts';

const originalFetch=globalThis.fetch;
beforeEach(()=>{process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_ID='synthetic-google';process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET='synthetic-google-secret';process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID='synthetic-microsoft';process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET='synthetic-microsoft-secret';});
afterEach(()=>{globalThis.fetch=originalFetch;});
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}

test('Google transport consumes official token, identity, list and cancellation shapes',async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  globalThis.fetch=async(input,init)=>{const url=String(input);calls.push({url,init});if(url.includes('/token'))return json({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly'});if(url.includes('/userinfo'))return json({sub:'synthetic-subject',email:'calendar@test.invalid'});if(url.includes('/calendarList'))return json({items:[{id:'primary',summary:'Primary'}],nextPageToken:'next'});if(url.includes('/events'))return json({items:[{id:'single-id',iCalUID:'uid@example',summary:'Moved',attendees:[{self:true,responseStatus:'needsAction'},{displayName:'Must not be retained',responseStatus:'accepted'}],start:{dateTime:'2026-10-25T10:00:00+01:00'},end:{dateTime:'2026-10-25T11:00:00+01:00'}},{id:'deleted-recurring',recurringEventId:'series-id',originalStartTime:{dateTime:'2026-10-26T09:00:00+01:00'},status:'cancelled'}]});return new Response(null,{status:204});};
  const transport=new DefaultCalendarTransport();const tokens=await transport.exchangeCode('google',{code:'code',verifier:'verifier',redirectUri:'https://samvev.test.invalid/callback'});assert.equal(tokens.providerSubject,'synthetic-subject');assert.equal(tokens.refreshToken,'refresh');
  const tokenBody=new URLSearchParams(String(calls.find((call)=>call.url.includes('/token'))?.init?.body));assert.equal(tokenBody.get('client_secret'),'synthetic-google-secret');
  assert.deepEqual((await transport.listCalendars('google','access')).items,[{externalId:'primary',name:'Primary'}]);const first=await transport.listEvents('google','access','primary',{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'});assert.equal(first.items[0]!.instanceId,'single-id');assert.equal((first.items[0] as CalendarEvent).status,'unanswered');assert.equal(JSON.stringify(first.items).includes('Must not be retained'),false);assert.deepEqual(first.items[1],{marker:'cancellation',uid:'series-id',instanceId:'2026-10-26T09:00:00+01:00',identityKind:'provider'});assert.ok(calls.some((call)=>call.url.includes('showDeleted=true')));
});

test('confidential web registrations require both provider credentials and publish exact callbacks',async()=>{
  const readiness=new CalendarService().readiness('https://samvev.test.invalid');
  assert.deepEqual(readiness.google,{configured:true,redirectUri:'https://samvev.test.invalid/api/v1/calendar/oauth/google/callback',requiredEnvironment:['SAMVEV_GOOGLE_CALENDAR_CLIENT_ID','SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET']});
  assert.deepEqual(readiness.microsoft,{configured:true,redirectUri:'https://samvev.test.invalid/api/v1/calendar/oauth/microsoft/callback',requiredEnvironment:['SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID','SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET']});
  delete process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET;
  assert.equal(new CalendarService().readiness('https://samvev.test.invalid').google.configured,false);
  await assert.rejects(()=>new DefaultCalendarTransport().exchangeCode('google',{code:'code',verifier:'verifier',redirectUri:'https://samvev.test.invalid/api/v1/calendar/oauth/google/callback'}),(error:any)=>error.code==='CONFLICT'&&error.details.reason==='google_calendar_registration_missing');
});

test('Home Assistant calendar parsing preserves provider UIDs and gives UID-less snapshots exact local identities',()=>{
  const events=parseHomeAssistantCalendarEvents([
    {uid:'stable-event',summary:'🟡 Synthetic practice',start:{dateTime:'2026-10-25T10:00:00+01:00'},end:{dateTime:'2026-10-25T11:00:00+01:00'},description:'must be discarded',location:'Synthetic hall'},
    {uid:'stable-task',recurrence_id:'task-instance',summary:'🔧 Synthetic driving duty',start:{date:'2026-10-26'},end:{date:'2026-10-27'},status:'cancelled'},
    {uid:'stable-tentative',summary:'Synthetic tentative',start:{dateTime:'2026-10-27T10:00:00Z'},end:{dateTime:'2026-10-27T11:00:00Z'},status:'tentative'},
    {uid:'stable-confirmed',summary:'Synthetic confirmed',start:{dateTime:'2026-10-28T10:00:00Z'},end:{dateTime:'2026-10-28T11:00:00Z'},status:'confirmed'},
    {uid:'stable-declined',summary:'Synthetic declined',start:{dateTime:'2026-10-29T10:00:00Z'},end:{dateTime:'2026-10-29T11:00:00Z'},status:'declined'},
    {uid:'stable-unanswered',summary:'Synthetic unanswered',start:{dateTime:'2026-10-30T10:00:00Z'},end:{dateTime:'2026-10-30T11:00:00Z'},status:'unanswered'}
  ],'calendar.synthetic_spond');
  assert.deepEqual(events,[
    {uid:'stable-event',instanceId:'single',identityKind:'provider',title:'🟡 Synthetic practice',start:'2026-10-25T10:00:00+01:00',end:'2026-10-25T11:00:00+01:00',allDay:false,cancelled:false,location:'Synthetic hall'},
    {uid:'stable-task',instanceId:'task-instance',identityKind:'provider',title:'🔧 Synthetic driving duty',start:'2026-10-26',end:'2026-10-27',allDay:true,cancelled:true,status:'cancelled',location:undefined},
    {uid:'stable-tentative',instanceId:'single',identityKind:'provider',title:'Synthetic tentative',start:'2026-10-27T10:00:00Z',end:'2026-10-27T11:00:00Z',allDay:false,cancelled:false,status:'tentative',location:undefined},
    {uid:'stable-confirmed',instanceId:'single',identityKind:'provider',title:'Synthetic confirmed',start:'2026-10-28T10:00:00Z',end:'2026-10-28T11:00:00Z',allDay:false,cancelled:false,status:'confirmed',location:undefined},
    {uid:'stable-declined',instanceId:'single',identityKind:'provider',title:'Synthetic declined',start:'2026-10-29T10:00:00Z',end:'2026-10-29T11:00:00Z',allDay:false,cancelled:false,status:'declined',location:undefined},
    {uid:'stable-unanswered',instanceId:'single',identityKind:'provider',title:'Synthetic unanswered',start:'2026-10-30T10:00:00Z',end:'2026-10-30T11:00:00Z',allDay:false,cancelled:false,status:'unanswered',location:undefined}
  ]);
  const rescheduled=parseHomeAssistantCalendarEvents([{uid:'stable-event',summary:'🟡 Synthetic practice',start:{dateTime:'2026-10-25T12:00:00+01:00'},end:{dateTime:'2026-10-25T13:00:00+01:00'}}],'calendar.synthetic_spond');
  assert.equal(rescheduled[0]!.instanceId,'single');assert.equal(rescheduled[0]!.uid,events[0]!.uid);
  assert.equal('description' in events[0]!,false);
  const withoutUid=parseHomeAssistantCalendarEvents([{summary:'No provider identity',start:{dateTime:'2026-10-25T10:00:00Z'}},{summary:'No provider identity',start:{dateTime:'2026-10-25T10:00:00Z'}}],'calendar.synthetic_general');assert.equal(withoutUid[0]!.identityKind,'local_snapshot');assert.notEqual(withoutUid[0]!.uid,withoutUid[1]!.uid,'legitimate exact duplicates retain distinct deterministic ordinals');assert.deepEqual(parseHomeAssistantCalendarEvents([{summary:'No provider identity',start:{dateTime:'2026-10-25T10:00:00Z'}},{summary:'No provider identity',start:{dateTime:'2026-10-25T10:00:00Z'}}],'calendar.synthetic_general').map((item)=>item.uid),withoutUid.map((item)=>item.uid),'an identical snapshot is idempotent');
  assert.deepEqual(parseHomeAssistantCalendarEvents([{summary:'No provider identity',start:{dateTime:'2026-10-25T10:00:00Z'}},{summary:'No provider identity',start:{dateTime:'2026-10-25T10:00:00Z'}}],'calendar.renamed_general').map((item)=>item.uid),withoutUid.map((item)=>item.uid),'registry-backed entity renames do not alter UID-less local snapshot identities');
  assert.throws(()=>parseHomeAssistantCalendarEvents([{summary:'Impossible',start:{date:'2026-02-31'}}],'calendar.synthetic_general'),(error:any)=>error?.details?.reason==='home_assistant_calendar_event_invalid');
  assert.throws(()=>parseHomeAssistantCalendarEvents([{summary:'Mixed',start:{date:'2028-02-29'},end:{dateTime:'2028-03-01T10:00:00Z'}}],'calendar.synthetic_general'),(error:any)=>error?.details?.reason==='home_assistant_calendar_event_invalid');
  assert.throws(()=>parseHomeAssistantCalendarEvents([{summary:'Non-exclusive',start:{date:'2028-02-29'},end:{date:'2028-02-29'}}],'calendar.synthetic_general'),(error:any)=>error?.details?.reason==='home_assistant_calendar_event_invalid');
  assert.equal(parseHomeAssistantCalendarEvents([{summary:'Leap',start:{date:'2028-02-29'},end:{date:'2028-03-01'}}],'calendar.synthetic_general')[0]!.allDay,true);
  assert.equal(normalizeHomeAssistantOrigin('http://192.168.1.20:8123'),'http://192.168.1.20:8123');
  assert.throws(()=>normalizeHomeAssistantOrigin('http://user:secret@192.168.1.20:8123/path'),(error:any)=>error.code==='VALIDATION_FAILED');
});

test('Microsoft transport keeps stable single identities and rejects untrusted next links',async()=>{
  globalThis.fetch=async(input)=>{const url=String(input);if(url.includes('/calendarView'))return json({value:[{id:'event-id',subject:'Moved event',start:{dateTime:'2026-10-25T09:00:00.0000000'},end:{dateTime:'2026-10-25T10:00:00.0000000'},isAllDay:false,isCancelled:false,responseStatus:{response:'declined'}}]});return json({value:[]});};
  const transport=new DefaultCalendarTransport();const page=await transport.listEvents('microsoft','access','calendar-id',{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'});assert.equal(page.items[0]!.uid,'event-id');assert.equal(page.items[0]!.instanceId,'single');assert.equal((page.items[0] as CalendarEvent).status,'declined');
  await assert.rejects(()=>transport.listCalendars('microsoft','access','https://attacker.invalid/steal'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
  await assert.rejects(()=>transport.listEvents('microsoft','access','calendar-id',{from:'x',to:'y'},'https://graph.microsoft.com/v1.0/users/other/messages'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
});

test('Google and Microsoft sparse cancellation entries carry bounded identity markers only',async()=>{
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.includes('googleapis.com/calendar'))return json({items:[
      {id:'google-single-provider-id',status:'cancelled'},
      {id:'google-recurring-instance-id',recurringEventId:'google-series-id',originalStartTime:{dateTime:'2026-10-25T09:00:00Z'},status:'cancelled'},
      {id:'google-full-cancel-id',iCalUID:'google-full-ical-id',summary:'Synthetic cancelled appointment',start:{dateTime:'2026-10-25T09:00:00Z'},end:{dateTime:'2026-10-25T10:00:00Z'},status:'cancelled'}
    ]});
    return json({value:[
      {id:'microsoft-single-id',isCancelled:true},
      {id:'microsoft-recurring-id',seriesMasterId:'microsoft-series-id',originalStart:'2026-10-25T09:00:00Z',isCancelled:true},
      {id:'microsoft-full-id',subject:'Synthetic cancelled meeting',start:{dateTime:'2026-10-25T09:00:00Z'},end:{dateTime:'2026-10-25T10:00:00Z'},isCancelled:true}
    ]});
  };
  const transport=new DefaultCalendarTransport();
  const google=await transport.listEvents('google','access','primary',{from:'2026-10-01T00:00:00Z',to:'2027-01-01T00:00:00Z'});
  assert.equal(google.items.length,3);
  assert.deepEqual(google.items[0],{marker:'cancellation',uid:'google-single-provider-id',instanceId:'google-single-provider-id',instanceIdOnly:true,identityKind:'provider'});
  assert.deepEqual(google.items[1],{marker:'cancellation',uid:'google-series-id',instanceId:'2026-10-25T09:00:00Z',identityKind:'provider'});
  assert.equal('marker'in google.items[2]!,false);assert.equal((google.items[2] as any).title,'Synthetic cancelled appointment');
  const microsoft=await transport.listEvents('microsoft','access','calendar-id',{from:'2026-10-01T00:00:00Z',to:'2027-01-01T00:00:00Z'});
  assert.equal(microsoft.items.length,3);
  assert.deepEqual(microsoft.items[0],{marker:'cancellation',uid:'microsoft-single-id',instanceId:'single',identityKind:'provider'});
  assert.deepEqual(microsoft.items[1],{marker:'cancellation',uid:'microsoft-series-id',instanceId:'2026-10-25T09:00:00Z',identityKind:'provider'});
  assert.equal('marker'in microsoft.items[2]!,false);assert.equal((microsoft.items[2] as any).cancelled,true);
  globalThis.fetch=async(input)=>String(input).includes('googleapis.com')?json({items:[{status:'cancelled'}]}):json({value:[{isCancelled:true}]});
  await assert.rejects(()=>transport.listEvents('google','access','primary',{from:'2026-10-01T00:00:00Z',to:'2027-01-01T00:00:00Z'}),(error:any)=>error.details?.reason==='calendar_provider_response_invalid');
  await assert.rejects(()=>transport.listEvents('microsoft','access','calendar-id',{from:'2026-10-01T00:00:00Z',to:'2027-01-01T00:00:00Z'}),(error:any)=>error.details?.reason==='calendar_provider_response_invalid');
});

test('conflicting full-event and sparse-cancellation identities fail regardless of page order',()=>{
  const event:CalendarEvent={uid:'stable-provider-id',instanceId:'stable-instance-id',title:'Synthetic confirmed appointment',start:'2026-10-25T09:00:00Z',end:'2026-10-25T10:00:00Z',allDay:false,cancelled:false};
  const marker={marker:'cancellation' as const,uid:event.uid,instanceId:event.instanceId,identityKind:'provider' as const};
  for(const page of [[event,marker],[marker,event]] as CalendarProviderEvent[][]){
    assert.throws(()=>uniqueCalendarProviderEvents(page),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details.reason==='calendar_provider_response_invalid');
  }
  assert.equal(uniqueCalendarProviderEvents([event,{...event,identityKind:'provider'}]).length,1,'identical duplicate representations remain idempotent');
});

test('provider 200 responses fail closed when list schemas are malformed',async()=>{
  globalThis.fetch=async()=>json({unexpected:'shape'});const transport=new DefaultCalendarTransport();
  await assert.rejects(()=>transport.listCalendars('google','access'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details.reason==='calendar_provider_response_invalid');
  await assert.rejects(()=>transport.listEvents('microsoft','access','calendar-id',{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'}),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE');
});

test('provider JSON is streamed under byte, item and string bounds',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({items:[{id:'primary',summary:'x'.repeat(1024*1024)}]}),{status:200});
  await assert.rejects(()=>new DefaultCalendarTransport().listCalendars('google','access'),(error:any)=>error.code==='MONITOR_SOURCE_TOO_LARGE'&&error.details.reason==='calendar_provider_response_too_large');
  globalThis.fetch=async()=>new Response(JSON.stringify({items:Array.from({length:3001},(_,index)=>({id:`calendar-${index}`,summary:'Synthetic'}))}),{status:200});
  await assert.rejects(()=>new DefaultCalendarTransport().listCalendars('google','access'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details.reason==='calendar_provider_response_invalid');
  globalThis.fetch=async()=>json({items:[{id:'primary',summary:'x'.repeat(513)}]});
  await assert.rejects(()=>new DefaultCalendarTransport().listCalendars('google','access'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details.reason==='calendar_provider_response_invalid');
  globalThis.fetch=async()=>new Response(JSON.stringify({items:[]}),{status:200,headers:{'content-length':String(1024*1024+1)}});
  await assert.rejects(()=>new DefaultCalendarTransport().listCalendars('google','access'),(error:any)=>error.code==='MONITOR_SOURCE_TOO_LARGE');
});

test('ICS expansion rejects unsafe high-frequency recurrences before materializing them',async()=>{
  const malicious='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fast\r\nDTSTART:20261001T000000Z\r\nDTEND:20261001T000001Z\r\nRRULE:FREQ=SECONDLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  await assert.rejects(()=>parseIcsEvents(malicious,{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'}),(error:any)=>error.code==='CALENDAR_ICS_UNSUPPORTED'&&error.details.reason==='calendar_ics_recurrence_frequency_unsupported');
});

test('provider event validation keeps provider errors while malformed ICS events become ICS errors',async()=>{
  assert.throws(()=>canonicalCalendarEvent({uid:'',instanceId:'single',title:'Synthetic provider event',start:'2026-10-01T09:00:00Z',end:'2026-10-01T10:00:00Z',allDay:false,cancelled:false} as CalendarEvent),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details.reason==='calendar_provider_response_invalid');
  const malformed='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nSUMMARY:Synthetic event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  await assert.rejects(()=>parseIcsEvents(malformed,{from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z'}),(error:any)=>error.code==='CALENDAR_ICS_INVALID'&&error.details.reason==='calendar_ics_content_invalid');
});

test('ICS parser applies its event window before historical single-event limits',async()=>{
  const events=Array.from({length:10_001},(_,index)=>`BEGIN:VEVENT\r\nUID:historic-${index}\r\nDTSTART:19900101T000000Z\r\nDTEND:19900101T010000Z\r\nSUMMARY:Old appointment\r\nEND:VEVENT\r\n`).join('');
  const calendar=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
  const parsed=await parseIcsEvents(calendar,{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'});
  assert.deepEqual(parsed,[]);
});

test('ICS parser preserves old counted recurrence, EXDATE, moved override and window overlap',async()=>{
  const calendar='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:old-daily\r\nDTSTART:19800101T090000Z\r\nDTEND:19800101T100000Z\r\nRRULE:FREQ=DAILY;COUNT=20000\r\nEXDATE:20261002T090000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:overlap\r\nDTSTART:20260930T230000Z\r\nDTEND:20261001T020000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:old-daily\r\nRECURRENCE-ID:20261003T090000Z\r\nDTSTART:20261004T120000Z\r\nDTEND:20261004T130000Z\r\nSUMMARY:Moved appointment\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const parsed=await parseIcsEvents(calendar,{from:'2026-10-01T00:00:00Z',to:'2026-10-06T00:00:00Z'});
  assert.ok(parsed.some((event)=>event.uid==='old-daily'&&event.start==='2026-10-01T09:00:00.000Z'));
  assert.ok(!parsed.some((event)=>event.uid==='old-daily'&&event.start==='2026-10-02T09:00:00.000Z'));
  assert.ok(parsed.some((event)=>event.uid==='old-daily'&&event.start==='2026-10-04T12:00:00.000Z'&&event.title==='Moved appointment'));
  assert.ok(parsed.some((event)=>event.uid==='overlap'&&event.start==='2026-09-30T23:00:00.000Z'));
});

test('ICS worker pool caps active parses and rejects work beyond its bounded queue',async()=>{
  const calendar='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',window={from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z'};
  const results=await Promise.allSettled(Array.from({length:7},()=>parseIcsEvents(calendar,window)));
  assert.equal(results.filter((result)=>result.status==='fulfilled').length,6);
  assert.equal(results.filter((result)=>result.status==='rejected'&&result.reason.code==='CALENDAR_ICS_BUSY').length,1);
});

test('refresh persists rotated provider tokens and Google revoke is explicit',async()=>{
  const requests:string[]=[];globalThis.fetch=async(input)=>{const url=String(input);requests.push(url);if(url.includes('/token'))return json({access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:1800,scope:'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly'});return new Response('',{status:200});};
  const transport=new DefaultCalendarTransport();const refreshed=await transport.refresh('google','old-refresh');assert.equal(refreshed.refreshToken,'rotated-refresh');assert.equal(await transport.revoke('google','rotated-refresh'),'confirmed');assert.ok(requests.some((url)=>url==='https://oauth2.googleapis.com/revoke'));
});
