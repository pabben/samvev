import assert from 'node:assert/strict';
import test,{afterEach,beforeEach} from 'node:test';
import {CalendarService,DefaultCalendarTransport} from './service.ts';

const originalFetch=globalThis.fetch;
beforeEach(()=>{process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_ID='synthetic-google';process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET='synthetic-google-secret';process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID='synthetic-microsoft';process.env.SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET='synthetic-microsoft-secret';});
afterEach(()=>{globalThis.fetch=originalFetch;});
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});}

test('Google transport consumes official token, identity, list and cancellation shapes',async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  globalThis.fetch=async(input,init)=>{const url=String(input);calls.push({url,init});if(url.includes('/token'))return json({access_token:'access',refresh_token:'refresh',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly'});if(url.includes('/userinfo'))return json({sub:'synthetic-subject',email:'calendar@test.invalid'});if(url.includes('/calendarList'))return json({items:[{id:'primary',summary:'Primary'}],nextPageToken:'next'});if(url.includes('/events'))return json({items:[{id:'single-id',iCalUID:'uid@example',summary:'Moved',start:{dateTime:'2026-10-25T10:00:00+01:00'},end:{dateTime:'2026-10-25T11:00:00+01:00'}},{id:'deleted-recurring',recurringEventId:'series-id',originalStartTime:{dateTime:'2026-10-26T09:00:00+01:00'},status:'cancelled'}]});return new Response(null,{status:204});};
  const transport=new DefaultCalendarTransport();const tokens=await transport.exchangeCode('google',{code:'code',verifier:'verifier',redirectUri:'https://samvev.test.invalid/callback'});assert.equal(tokens.providerSubject,'synthetic-subject');assert.equal(tokens.refreshToken,'refresh');
  const tokenBody=new URLSearchParams(String(calls.find((call)=>call.url.includes('/token'))?.init?.body));assert.equal(tokenBody.get('client_secret'),'synthetic-google-secret');
  assert.deepEqual((await transport.listCalendars('google','access')).items,[{externalId:'primary',name:'Primary'}]);const first=await transport.listEvents('google','access','primary',{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'});assert.equal(first.items[0]!.instanceId,'single-id');assert.deepEqual(first.items[1],{uid:'series-id',instanceId:'2026-10-26T09:00:00+01:00',title:'Untitled event',start:'2026-10-26T09:00:00+01:00',end:null,allDay:false,cancelled:true,location:undefined});assert.ok(calls.some((call)=>call.url.includes('showDeleted=true')));
});

test('confidential web registrations require both provider credentials and publish exact callbacks',async()=>{
  const readiness=new CalendarService().readiness('https://samvev.test.invalid');
  assert.deepEqual(readiness.google,{configured:true,redirectUri:'https://samvev.test.invalid/api/v1/calendar/oauth/google/callback',requiredEnvironment:['SAMVEV_GOOGLE_CALENDAR_CLIENT_ID','SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET']});
  assert.deepEqual(readiness.microsoft,{configured:true,redirectUri:'https://samvev.test.invalid/api/v1/calendar/oauth/microsoft/callback',requiredEnvironment:['SAMVEV_MICROSOFT_CALENDAR_CLIENT_ID','SAMVEV_MICROSOFT_CALENDAR_CLIENT_SECRET']});
  delete process.env.SAMVEV_GOOGLE_CALENDAR_CLIENT_SECRET;
  assert.equal(new CalendarService().readiness('https://samvev.test.invalid').google.configured,false);
  await assert.rejects(()=>new DefaultCalendarTransport().exchangeCode('google',{code:'code',verifier:'verifier',redirectUri:'https://samvev.test.invalid/api/v1/calendar/oauth/google/callback'}),(error:any)=>error.code==='CONFLICT'&&error.details.reason==='google_calendar_registration_missing');
});

test('Microsoft transport keeps stable single identities and rejects untrusted next links',async()=>{
  globalThis.fetch=async(input)=>{const url=String(input);if(url.includes('/calendarView'))return json({value:[{id:'event-id',subject:'Moved event',start:{dateTime:'2026-10-25T09:00:00.0000000'},end:{dateTime:'2026-10-25T10:00:00.0000000'},isAllDay:false,isCancelled:false}]});return json({value:[]});};
  const transport=new DefaultCalendarTransport();const page=await transport.listEvents('microsoft','access','calendar-id',{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'});assert.equal(page.items[0]!.uid,'event-id');assert.equal(page.items[0]!.instanceId,'single');
  await assert.rejects(()=>transport.listCalendars('microsoft','access','https://attacker.invalid/steal'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
  await assert.rejects(()=>transport.listEvents('microsoft','access','calendar-id',{from:'x',to:'y'},'https://graph.microsoft.com/v1.0/users/other/messages'),(error:any)=>error.code==='AI_ENDPOINT_BLOCKED');
});

test('provider 200 responses fail closed when list schemas are malformed',async()=>{
  globalThis.fetch=async()=>json({unexpected:'shape'});const transport=new DefaultCalendarTransport();
  await assert.rejects(()=>transport.listCalendars('google','access'),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE'&&error.details.reason==='calendar_provider_response_invalid');
  await assert.rejects(()=>transport.listEvents('microsoft','access','calendar-id',{from:'2026-10-01T00:00:00Z',to:'2027-04-01T00:00:00Z'}),(error:any)=>error.code==='MONITOR_SOURCE_UNAVAILABLE');
});

test('refresh persists rotated provider tokens and Google revoke is explicit',async()=>{
  const requests:string[]=[];globalThis.fetch=async(input)=>{const url=String(input);requests.push(url);if(url.includes('/token'))return json({access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:1800,scope:'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly'});return new Response('',{status:200});};
  const transport=new DefaultCalendarTransport();const refreshed=await transport.refresh('google','old-refresh');assert.equal(refreshed.refreshToken,'rotated-refresh');assert.equal(await transport.revoke('google','rotated-refresh'),'confirmed');assert.ok(requests.some((url)=>url==='https://oauth2.googleapis.com/revoke'));
});
