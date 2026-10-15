import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import test from 'node:test';
import { HomeAssistantClient } from './home-assistant-client.ts';
import type { ProviderRuntimeConfig } from './provider-config.ts';

function serverFrame(value:unknown,opcode=1):Buffer{
  const body=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  if(body.length<126)return Buffer.concat([Buffer.from([0x80|opcode,body.length]),body]);
  const header=Buffer.alloc(4);header[0]=0x80|opcode;header[1]=126;header.writeUInt16BE(body.length,2);return Buffer.concat([header,body]);
}

function takeClientFrames(buffer:Buffer):{messages:Record<string,unknown>[];rest:Buffer}{
  const messages:Record<string,unknown>[]=[];let offset=0;
  while(buffer.length-offset>=2){
    const first=buffer[offset]!,second=buffer[offset+1]!;assert.equal(first&0x80,0x80);const opcode=first&0x0f;assert.ok(opcode===1||opcode===10);assert.equal(second&0x80,0x80);
    let length=second&0x7f,header=2;if(length===126){if(buffer.length-offset<4)break;length=buffer.readUInt16BE(offset+2);header=4;}else if(length===127){if(buffer.length-offset<10)break;const wide=buffer.readBigUInt64BE(offset+2);assert.ok(wide<=BigInt(Number.MAX_SAFE_INTEGER));length=Number(wide);header=10;}
    if(buffer.length-offset<header+4+length)break;
    const mask=buffer.subarray(offset+header,offset+header+4),payload=Buffer.from(buffer.subarray(offset+header+4,offset+header+4+length));
    for(let index=0;index<payload.length;index++)payload[index]=payload[index]!^mask[index%4]!;
    if(opcode===1)messages.push(JSON.parse(payload.toString('utf8')) as Record<string,unknown>);offset+=header+4+length;
  }
  return{messages,rest:buffer.subarray(offset)};
}

async function body(request:IncomingMessage):Promise<string>{const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');}

test('Home Assistant client follows browser auth, current-user binding, Spond registry discovery and official calendar REST shapes',async(t)=>{
  const requests:Array<{method:string;url:string;authorization?:string;body:string}>=[];
  let spondEntityId='calendar.spond_team';
  let calendarStatus=200;
  let sourceState='off';
  let temperatureState='-3.5',temperatureUnit='°C';
  let calendarReturnedEntityId:string|undefined;
  let temperatureReturnedEntityId:string|undefined;
  let temperatureReportedAt='2026-10-15T08:00:00Z',temperatureUpdatedAt='2026-10-15T07:59:00Z';
  const server=createServer(async(request,response)=>{
    const requestBody=await body(request);requests.push({method:request.method??'',url:request.url??'',authorization:request.headers.authorization,body:requestBody});
    response.setHeader('content-type','application/json');
    if(request.method==='POST'&&request.url==='/auth/token'){
      const form=new URLSearchParams(requestBody);
      if(form.get('code')==='invalid-grant'){response.statusCode=400;response.end(JSON.stringify({error:'invalid_grant'}));return;}
      if(form.get('code')==='inactive-user'){response.statusCode=403;response.end(JSON.stringify({message:'inactive user'}));return;}
      if(form.get('grant_type')==='authorization_code')response.end(JSON.stringify({access_token:'access-code',refresh_token:'refresh-code',expires_in:1800}));
      else response.end(JSON.stringify({access_token:'access-refreshed',expires_in:1800}));
      return;
    }
    if(request.method==='POST'&&request.url==='/auth/revoke'){response.statusCode=200;response.end('{}');return;}
    if(request.method==='GET'&&request.url==='/api/calendars'){
      response.end(JSON.stringify([{entity_id:spondEntityId,name:'Spond team'},{entity_id:'calendar.personal',name:'Personal'}]));return;
    }
    if(request.method==='GET'&&request.url===`/api/states/${spondEntityId}`){response.end(JSON.stringify({entity_id:calendarReturnedEntityId??spondEntityId,state:sourceState,attributes:{}}));return;}
    if(request.method==='GET'&&request.url==='/api/states/sensor.outdoor_temperature'){response.end(JSON.stringify({entity_id:temperatureReturnedEntityId??'sensor.outdoor_temperature',state:temperatureState,last_reported:temperatureReportedAt,last_updated:temperatureUpdatedAt,attributes:{device_class:'temperature',unit_of_measurement:temperatureUnit}}));return;}
    if(request.method==='GET'&&request.url?.startsWith(`/api/calendars/${spondEntityId}?`)){
      if(calendarStatus!==200){response.statusCode=calendarStatus;response.end(JSON.stringify({message:'bounded synthetic error'}));return;}
      response.end(JSON.stringify([
        {uid:'spond-event-1',summary:'🟡 Practice',description:'Other participants and private notes',location:'Sports hall',start:{dateTime:'2026-10-15T16:00:00+02:00'},end:{dateTime:'2026-10-15T17:30:00+02:00'}},
        {uid:'spond-task-7',summary:'❌ Driving duty',description:'Private task list',status:'cancelled',start:{date:'2026-10-16'},end:{date:'2026-10-17'}}
      ]));return;
    }
    response.statusCode=404;response.end(JSON.stringify({message:'not found'}));
  });
  server.on('upgrade',(request,socket)=>{
    assert.equal(request.url,'/api/websocket');const key=String(request.headers['sec-websocket-key']);const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);socket.write(serverFrame({type:'auth_required',ha_version:'2026.10.0'}));
    let pending:Buffer=Buffer.alloc(0);socket.on('data',(chunk)=>{pending=Buffer.concat([pending,chunk]);const parsed=takeClientFrames(pending);pending=Buffer.from(parsed.rest);for(const message of parsed.messages){
      if(message.type==='auth'){assert.equal(message.access_token,'access-code');socket.write(serverFrame({type:'auth_ok',ha_version:'2026.10.0'}));continue;}
      if(message.type==='auth/current_user')socket.write(serverFrame({id:message.id,type:'result',success:true,result:{id:'ha-owner-id',name:'HA owner'}}));
      else if(message.type==='config/entity_registry/list')socket.write(serverFrame({id:message.id,type:'result',success:true,result:[
        {id:'registry-spond',entity_id:spondEntityId,platform:'spond_tracker',config_entry_id:'config-spond'},
        {id:'registry-other',entity_id:'calendar.personal',platform:'local',config_entry_id:'config-local'},
        {id:'sensor-temperature',entity_id:'sensor.outdoor_temperature',platform:'synthetic',translation_key:'temperature',original_name:'Outdoor temperature'}
      ]}));
    }});
  });
  await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const address=server.address();assert.ok(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
  const config:ProviderRuntimeConfig={provider:'home_assistant',source:'database',revision:1,clientIdHash:'0'.repeat(64),clientId:'https://samvev.example',origin};
  const client=new HomeAssistantClient();

  const authorization=new URL(client.authorizationUrl(config,'https://samvev.example/api/v1/calendar/oauth/home_assistant/callback','state-value'));
  assert.equal(authorization.origin,origin);assert.equal(authorization.pathname,'/auth/authorize');assert.equal(authorization.searchParams.get('client_id'),'https://samvev.example');assert.equal(authorization.searchParams.get('state'),'state-value');assert.equal(authorization.searchParams.has('code_challenge'),false);
  const token=await client.exchangeCode(config,{code:'one-time-code',redirectUri:'https://samvev.example/api/v1/calendar/oauth/home_assistant/callback'});
  assert.equal(token.providerSubject,'ha-owner-id');assert.equal(token.accountLabel,'HA owner');assert.deepEqual(token.scopes,['home_assistant_instance_token']);
  const sources=await client.listSources(config,token.accessToken);
  assert.equal(sources.length,2);assert.deepEqual(sources[0],{externalId:'registry-spond',name:'Spond team',provenance:{integrationDomain:'spond_tracker',entityId:'calendar.spond_team',platform:'calendar',identityKind:'registry',registryId:'registry-spond',configEntryId:'config-spond',validatedContractVersion:'0.12.2',referenceCommit:'0d8efdd'},sourceWarning:'home_assistant_spond_bounded_cache_status_and_first_name_identity_limitations'}, 'the registry identity, not the mutable entity ID, is the durable source identity');assert.equal(sources[1]!.provenance.integrationDomain,'home_assistant');assert.equal(sources[1]!.sourceWarning,undefined,'Spond-specific warnings do not leak onto general calendars');
  const events=await client.listEvents(config,token.accessToken,sources[0]!.externalId,{from:'2026-10-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'});
  assert.deepEqual(events,[
    {uid:'spond-event-1',instanceId:'single',identityKind:'provider',title:'🟡 Practice',start:'2026-10-15T16:00:00+02:00',end:'2026-10-15T17:30:00+02:00',allDay:false,cancelled:false,location:'Sports hall'},
    {uid:'spond-task-7',instanceId:'single',identityKind:'provider',title:'❌ Driving duty',start:'2026-10-16',end:'2026-10-17',allDay:true,cancelled:true,status:'cancelled',location:undefined}
  ]);assert.equal(JSON.stringify(events).includes('participants'),false);assert.equal(JSON.stringify(events).includes('Private'),false);
  const sensorCandidates=await client.listTemperatureSensors(config,token.accessToken);assert.equal(sensorCandidates.length,1);assert.equal(sensorCandidates[0]!.name,'Outdoor temperature');const temperature=await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature');assert.deepEqual(temperature,{value:-3.5,unit:'°C',status:'current',lastReportedAt:'2026-10-15T08:00:00Z',lastUpdatedAt:'2026-10-15T07:59:00Z',fetchedAt:temperature.fetchedAt});
  temperatureUnit='kWh';assert.equal((await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature')).reason,'invalid_unit');temperatureUnit='°F';temperatureState='-4.5';assert.equal((await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature')).value,-4.5);temperatureState='';assert.equal((await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature')).reason,'invalid_value','an empty HA state is never coerced to zero');temperatureState='unknown';assert.equal((await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature')).reason,'unknown');temperatureState='-3.5';temperatureUnit='°C';
  temperatureReportedAt='not-a-timestamp';temperatureUpdatedAt='2026-02-31T08:00:00Z';const malformedTimestamps=await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature');assert.equal(malformedTimestamps.lastReportedAt,null);assert.equal(malformedTimestamps.lastUpdatedAt,null,'malformed HA timestamps cannot be presented as a current measurement');temperatureReportedAt='2026-10-15T08:00:00.123456+00:00';temperatureUpdatedAt='2026-10-15T07:59:00Z';assert.equal((await client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature')).lastReportedAt,temperatureReportedAt);
  temperatureReturnedEntityId='sensor.other_temperature';await assert.rejects(client.readTemperatureSensor(config,token.accessToken,'sensor.outdoor_temperature'),(error:any)=>error?.details?.reason==='home_assistant_response_invalid','a targeted sensor read cannot accept a different returned entity');temperatureReturnedEntityId=undefined;
  const refreshed=await client.refresh(config,token.refreshToken!);assert.equal(refreshed.accessToken,'access-refreshed');assert.equal(refreshed.refreshToken,'refresh-code');
  assert.equal(await client.revoke(config,token.refreshToken!),'confirmed');

  const codeRequest=requests.find((request)=>request.url==='/auth/token'&&request.body.includes('authorization_code'))!;const codeForm=new URLSearchParams(codeRequest.body);
  assert.equal(codeForm.get('client_id'),'https://samvev.example');assert.equal(codeForm.get('code'),'one-time-code');assert.equal(codeForm.has('code_verifier'),false);
  const calendarRequest=requests.find((request)=>request.url.startsWith('/api/calendars/calendar.spond_team?'))!;const calendarUrl=new URL(calendarRequest.url,origin);
  assert.equal(calendarUrl.searchParams.get('start'),'2026-10-01T00:00:00.000Z');assert.equal(calendarUrl.searchParams.get('end'),'2026-12-01T00:00:00.000Z');assert.equal(calendarRequest.authorization,'Bearer access-code');
  assert.equal(requests.find((request)=>request.url==='/auth/revoke')?.method,'POST');
  spondEntityId='calendar.spond_team_renamed';
  const rediscovered=await client.listSources(config,token.accessToken);
  assert.equal(rediscovered[0]!.externalId,'registry-spond');assert.equal(rediscovered[0]!.provenance.entityId,'calendar.spond_team_renamed','a renamed Home Assistant entity keeps the same selected source identity');
  const afterRename=await client.listEvents(config,token.accessToken,rediscovered[0]!.externalId,{from:'2026-10-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'});
  assert.equal(afterRename[0]!.uid,'spond-event-1');
  assert.ok(requests.some((request)=>request.url.startsWith('/api/calendars/calendar.spond_team_renamed?')),'event retrieval resolves the stable source identity to the current registry entity');
  sourceState='unavailable';await assert.rejects(client.listEvents(config,token.accessToken,'registry-spond',{from:'2026-10-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'}),(error:any)=>error?.details?.reason==='home_assistant_calendar_source_stale','HTTP 200 cached events cannot freshen an unavailable Spond entity');sourceState='off';
  calendarReturnedEntityId='calendar.some_other_source';await assert.rejects(client.listEvents(config,token.accessToken,'registry-spond',{from:'2026-10-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'}),(error:any)=>error?.details?.reason==='home_assistant_response_invalid','calendar health is bound to the exact selected entity');calendarReturnedEntityId=undefined;
  await assert.rejects(client.exchangeCode(config,{code:'invalid-grant',redirectUri:'https://samvev.example/api/v1/calendar/oauth/home_assistant/callback'}),(error:any)=>error?.details?.reason==='calendar_reauthorization_required');
  await assert.rejects(client.exchangeCode(config,{code:'inactive-user',redirectUri:'https://samvev.example/api/v1/calendar/oauth/home_assistant/callback'}),(error:any)=>error?.details?.reason==='calendar_reauthorization_required');
  calendarStatus=401;await assert.rejects(client.listEvents(config,token.accessToken,'registry-spond',{from:'2026-10-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'}),(error:any)=>error?.details?.reason==='calendar_reauthorization_required');
  calendarStatus=403;await assert.rejects(client.listEvents(config,token.accessToken,'registry-spond',{from:'2026-10-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z'}),(error:any)=>error?.details?.reason==='home_assistant_permission_denied');
});

test('Home Assistant websocket uses one absolute deadline even while the server sends pings',async(t)=>{
  let closed!:()=>void;const socketClosed=new Promise<void>((resolve)=>{closed=resolve;});
  const server=createServer();server.on('upgrade',(request,socket)=>{
    const key=String(request.headers['sec-websocket-key']);const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);socket.write(serverFrame({type:'auth_required'}));
    socket.once('close',closed);socket.on('error',()=>{});let pending=Buffer.alloc(0),pings:NodeJS.Timeout|undefined;
    socket.on('data',(chunk)=>{pending=Buffer.concat([pending,chunk]);const parsed=takeClientFrames(pending);pending=Buffer.from(parsed.rest);for(const message of parsed.messages){if(message.type==='auth')socket.write(serverFrame({type:'auth_ok'}));else if(message.type==='config/entity_registry/list'){pings=setInterval(()=>{if(!socket.destroyed)socket.write(serverFrame(Buffer.from('still-waiting'),9),()=>{});},5);}}});
    socket.once('close',()=>{if(pings)clearInterval(pings);});
  });
  await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const address=server.address();assert.ok(address&&typeof address==='object');
  const config:ProviderRuntimeConfig={provider:'home_assistant',source:'database',revision:1,clientIdHash:'0'.repeat(64),clientId:'https://samvev.example',origin:`http://127.0.0.1:${address.port}`};
  const started=Date.now();await assert.rejects(new HomeAssistantClient(80).listSources(config,'synthetic-access'));assert.ok(Date.now()-started<750,'pings cannot extend the absolute websocket deadline');await Promise.race([socketClosed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('client socket was not destroyed on deadline')),500))]);
});

test('Home Assistant HTTP deadline starts before DNS resolution',async()=>{
  const neverResolves=async(_hostname:string)=>new Promise<Array<{address:string;family:number}>>(()=>{});
  const client=new HomeAssistantClient(100,60,neverResolves),config:ProviderRuntimeConfig={provider:'home_assistant',source:'database',revision:1,clientIdHash:'0'.repeat(64),clientId:'https://samvev.example',origin:'https://ha.test.invalid'};
  const started=Date.now();await assert.rejects(client.exchangeCode(config,{code:'synthetic-code',redirectUri:'https://samvev.example/api/v1/calendar/oauth/home_assistant/callback'}),(error:any)=>error?.details?.reason==='home_assistant_unavailable');assert.ok(Date.now()-started<750,'a stalled resolver cannot extend the HTTP operation deadline');
});
