import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { roleCapabilityPresets, type AiTask, type AiToolDefinition, type AiToolResult } from '@samvev/contracts';
import type { AiAdminService } from '../ai/admin-service.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { MonitorEngine } from './engine.ts';
import { MonitorService, type MonitorActor } from './service.ts';
import type { MonitorSourceFetcher, SourceDocument } from './source-fetcher.ts';
import type { MetWeatherClient, WeatherForecast } from './weather.ts';

const forecast:WeatherForecast={sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=58.3312&lon=8.2325',attribution:'MET Norway Locationforecast',retrievedAt:'2026-09-12T08:00:00Z',updatedAt:'2026-09-12T07:00:00Z',validFrom:'2026-09-13T06:00:00Z',validTo:'2026-09-13T06:00:00Z',location:{query:'Birkeland',canonicalName:'Birkeland',municipality:'Birkenes',region:'Agder',country:'Norge',latitude:58.3312,longitude:8.2325,placeId:'synthetic-place'},points:[{at:'2026-09-13T06:00:00Z',temperatureC:12,precipitationMm:0.2,windSpeedMps:3,symbolCode:'fair_day'}],fingerprint:'synthetic-weather-v1',httpStatus:200,cacheStatus:'miss'};
const weather={forecast:async()=>forecast} as unknown as MetWeatherClient;
const evidence='Forecast 2026-09-13T06:00:00Z: temperature 12 C; precipitation 0.2 mm; wind 3 m/s; symbol fair_day';

class FakeAi {
  tiers:string[]=[];
  inputs:string[]=[];
  routineInvalid=false;
  async createTaskSession(_household:string,task:AiTask,_policy:unknown,tools:AiToolDefinition[]){
    this.tiers.push(task.modelTier);this.inputs.push(task.input);let turn=0;const weatherTool=tools.find((item)=>item.name==='weather.forecast');assert.ok(weatherTool);
    return{provider:'openai_compatible' as const,model:task.modelTier==='strong'?'synthetic-strong':'synthetic-routine',close:()=>{},next:async(results:AiToolResult[]=[])=>{
      turn++;if(turn===1)return{toolCalls:[{id:`weather-${task.purpose}`,name:'weather.forecast',arguments:{location:'Birkeland',period:'tomorrow'}}],generatedAt:new Date().toISOString()};assert.equal(results.length,1);assert.match(results[0]!.output,/MET Norway Locationforecast/);
      const output=task.purpose==='monitor_interpretation'?(task.modelTier==='routine'?'{"version":1,"resultKind":':JSON.stringify({version:1,resultKind:'answer',summary:'Vis morgendagens vær for Birkeland.',eventTypes:[],keywords:['vær'],people:[],noticeDaysBefore:0,noticeLocalTime:'18:00',checkIntervalMinutes:60,tools:['weather.forecast'],location:{query:'Birkeland'}})):this.routineInvalid&&task.modelTier==='routine'?'{"version":1,"answer":':JSON.stringify({version:1,answer:evidence,evidence:{quote:evidence},confidence:task.modelTier==='routine'?0.3:0.9,uncertainty:null});
      return{output,toolCalls:[],generatedAt:new Date().toISOString()};
    }};
  }
}

test('weather-only task keeps nullable source and uses the same interpretation and Test-now runner',async()=>{
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');const ai=new FakeAi();
  const installation=(await pool.query<{id:string}>(`INSERT INTO installations(claimed_at,setup_step) VALUES(clock_timestamp(),'complete') RETURNING id`)).rows[0]!.id;
  const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic weather household','Europe/Oslo','nb') RETURNING id`,[installation])).rows[0]!.id;
  const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic adult','adult') RETURNING id`,[household])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'weather@test.invalid','unused','nb','system') RETURNING id`,[installation])).rows[0]!.id;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[household,account,person,JSON.stringify(roleCapabilityPresets.household_admin)])).rows[0]!.id;
  const actor:MonitorActor={accountId:account,installationId:installation,householdId:household,membershipId:membership,capabilities:[...roleCapabilityPresets.household_admin]};
  const service=new MonitorService(ai as unknown as AiAdminService,undefined,weather);const created=await service.create(actor,{instruction:'Sjekk været i Birkeland i morgen og vis temperaturen.',checkIntervalMinutes:60,noticeDaysBefore:0,noticeLocalTime:'18:00',targets:{personIds:[person],displayIds:[]}}) as any;
  assert.equal(created.sourceUrl,null);assert.deepEqual((await pool.query('SELECT source_url,tool_plan FROM monitor_tasks WHERE id=$1',[created.id])).rows[0],{source_url:null,tool_plan:['weather.forecast']});
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM schema_migrations WHERE version='013_monitor_typed_tools_and_quality.sql'`)).rows[0]!.count,1);await assert.rejects(pool.query(`UPDATE monitor_tasks SET tool_plan='["shell.exec"]'::jsonb WHERE id=$1`,[created.id]),(error:any)=>error.code==='23514');
  const interpreted=await service.interpret(actor,created.id,created.revision) as any;assert.equal(interpreted.lifecycle.status,'ready_for_approval');assert.equal(interpreted.interpretedRule.location.canonicalName,'Birkeland');assert.equal('latitude' in interpreted.interpretedRule.location,false);assert.deepEqual(ai.tiers,['routine','strong']);
  const result=await new MonitorEngine(undefined,ai as unknown as AiAdminService,weather).runManual(actor,created.id,interpreted.revision,'test');assert.equal(result.resultKind,'answer');assert.equal((result.result as any).answer,evidence);assert.equal(result.sourceUrl,'https://api.met.no/weatherapi/locationforecast/2.0/documentation');assert.equal((result.result as any).evidence.sourceUrl,result.sourceUrl);assert.equal(result.sources[0]!.kind,'weather');assert.equal(result.sources[0]!.canonicalLocation,'Birkeland');assert.equal(result.sources[0]!.forecastUpdatedAt,'2026-09-12T07:00:00Z');assert.equal(JSON.stringify(result).includes('58.3312'),false);
  assert.equal(ai.inputs.filter((input)=>input.includes('Complete this approved')).some((input)=>/latitude|longitude|58\.3312|8\.2325/.test(input)),false,'provider input must omit legacy coordinates');
  const persisted=(await pool.query<{state:string;source_url:string|null;model_tier:string}>(`SELECT state,source_url,model_tier FROM monitor_tasks WHERE id=$1`,[created.id])).rows[0]!;assert.deepEqual(persisted,{state:'draft',source_url:null,model_tier:'routine'});assert.equal((await pool.query<{count:number}>('SELECT count(*)::int AS count FROM messages')).rows[0]!.count,0);
  const run=(await pool.query<{provenance:any;ai_call_count:number;source_url:string}>(`SELECT tool_provenance AS provenance,ai_call_count,source_url FROM monitor_runs WHERE task_id=$1 AND run_kind='test'`,[created.id])).rows[0]!;assert.equal(run.provenance[0].tool,'weather.forecast');assert.equal(run.provenance[0].attribution,'MET Norway Locationforecast');assert.equal(run.source_url,'https://api.met.no/weatherapi/locationforecast/2.0/documentation');assert.equal(/lat=|lon=|58\.3312|8\.2325/.test(JSON.stringify(run)),false);assert.equal(JSON.stringify(run.provenance).includes('points'),false);assert.equal(run.ai_call_count,4);assert.deepEqual(ai.tiers,['routine','strong','routine','strong']);
  const quality=(await pool.query<{phase:string;reason:string;from_tier:string;to_tier:string;outcome:string}>('SELECT phase,reason,from_tier,to_tier,outcome FROM monitor_quality_audits WHERE task_id=$1 ORDER BY created_at',[created.id])).rows;assert.deepEqual(quality,[{phase:'interpretation',reason:'invalid_schema',from_tier:'routine',to_tier:'strong',outcome:'escalated'},{phase:'interpretation',reason:'invalid_schema',from_tier:'routine',to_tier:'strong',outcome:'succeeded'},{phase:'test',reason:'validated_low_confidence',from_tier:'routine',to_tier:'strong',outcome:'escalated'},{phase:'test',reason:'validated_low_confidence',from_tier:'routine',to_tier:'strong',outcome:'succeeded'}]);
  const ambiguous={forecast:async()=>{throw new (await import('@samvev/core')).DomainError('MONITOR_LOCATION_AMBIGUOUS',422,{candidates:[{name:'Birkeland',municipality:'Birkenes',region:'Agder',latitude:58.3}]});}} as unknown as MetWeatherClient;
  await assert.rejects(new MonitorEngine(undefined,ai as unknown as AiAdminService,ambiguous).runManual(actor,created.id,interpreted.revision,'test'),(error:any)=>error.code==='MONITOR_LOCATION_AMBIGUOUS'&&error.details.candidates.length===1&&!('latitude' in error.details.candidates[0]));
  const failed=(await pool.query<{error_details:any}>(`SELECT error_details FROM monitor_runs WHERE task_id=$1 AND outcome='failed' ORDER BY checked_at DESC LIMIT 1`,[created.id])).rows[0]!;assert.deepEqual(failed.error_details,{candidates:[{name:'Birkeland',municipality:'Birkenes',region:'Agder'}]});
  await assert.rejects(pool.query(`UPDATE monitor_runs SET error_details='[]'::jsonb WHERE task_id=$1`,[created.id]),(error:any)=>error.code==='23514');
  ai.routineInvalid=true;const active=await service.setState(actor,created.id,interpreted.revision,'approve') as any;assert.equal(await new MonitorEngine(undefined,ai as unknown as AiAdminService,weather).runOnce(),'changed');
  const scheduledQuality=(await pool.query<{reason:string;outcome:string}>(`SELECT reason,outcome FROM monitor_quality_audits WHERE task_id=$1 AND phase='scheduled' ORDER BY created_at`,[created.id])).rows;
  assert.deepEqual(scheduledQuality,[{reason:'invalid_schema',outcome:'escalated'},{reason:'invalid_schema',outcome:'succeeded'}]);assert.deepEqual(ai.tiers.slice(-2),['routine','strong']);
  const afterScheduled=(await pool.query<{model_tier:string;next_check_at:Date|null}>(`SELECT model_tier,next_check_at FROM monitor_tasks WHERE id=$1`,[created.id])).rows[0]!;assert.equal(afterScheduled.model_tier,'routine');assert.ok(afterScheduled.next_check_at);assert.notEqual(afterScheduled.next_check_at?.toISOString(),active.nextCheckAt);
});

test('web and weather evidence jointly gate a dated notification and changed forecast can remove it',async()=>{
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  const installation=(await pool.query<{id:string}>(`INSERT INTO installations(claimed_at,setup_step) VALUES(clock_timestamp(),'complete') RETURNING id`)).rows[0]!.id;
  const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic combined household','Europe/Oslo','nb') RETURNING id`,[installation])).rows[0]!.id;
  const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic adult','adult') RETURNING id`,[household])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'combined@test.invalid','unused','nb','system') RETURNING id`,[installation])).rows[0]!.id;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[household,account,person,JSON.stringify(roleCapabilityPresets.household_admin)])).rows[0]!.id;
  const actor:MonitorActor={accountId:account,installationId:installation,householdId:household,membershipId:membership,capabilities:[...roleCapabilityPresets.household_admin]};
  const plan:SourceDocument={finalUrl:'https://example.com/plan',contentType:'text/html',text:'Trip day 2030-09-20 A',fingerprint:'plan-v1',fetchedAt:'2026-09-12T08:00:00Z',evidenceKind:'web'};
  const fetcher={fetch:async()=>plan} as unknown as MonitorSourceFetcher;
  const weatherRequests:unknown[]=[];let rainy=true;const combinedWeather={forecast:async(input:unknown)=>{weatherRequests.push(input);return{...forecast,validFrom:'2030-09-20T08:00:00Z',validTo:'2030-09-20T08:00:00Z',points:[{at:'2030-09-20T08:00:00Z',temperatureC:12,precipitationMm:rainy?3:0,windSpeedMps:3,symbolCode:rainy?'rain':'fair_day'}],fingerprint:rainy?'weather-rain':'weather-dry'};}} as unknown as MetWeatherClient;
  let analysisSessions=0;const combinedTiers:string[]=[];class CombinedAi{
    async createTaskSession(_household:string,task:AiTask,_policy:unknown,_tools:AiToolDefinition[]){combinedTiers.push(task.modelTier);if(task.purpose==='monitor_source_analysis')analysisSessions++;let turn=0;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(results:AiToolResult[]=[])=>{
      turn++;
      if(task.purpose==='monitor_interpretation'){
        if(turn===1)return{toolCalls:[{id:'web',name:'web.open',arguments:{url:plan.finalUrl}},{id:'weather',name:'weather.forecast',arguments:{location:'Birkeland',period:'date',date:'2030-09-20'}}],generatedAt:new Date().toISOString()};
        assert.equal(results.length,2);return{output:JSON.stringify({version:1,resultKind:'events',summary:'Varsle om turdag når værvarselet viser regn.',eventTypes:['Trip day'],keywords:['rain'],people:['A'],noticeDaysBefore:1,noticeLocalTime:'18:00',checkIntervalMinutes:60,tools:['web.open','weather.forecast'],location:{query:'Birkeland'}}),toolCalls:[],generatedAt:new Date().toISOString()};
      }
      if(turn===1)return{toolCalls:[{id:'web',name:'web.open',arguments:{url:plan.finalUrl}}],generatedAt:new Date().toISOString()};
      if(turn===2){assert.equal(results.length,1);return{toolCalls:[{id:'weather',name:'weather.forecast',arguments:{location:'Birkeland',period:'date',date:'2030-09-20'}}],generatedAt:new Date().toISOString()};}
      assert.equal(results.length,1);
      const weatherQuote=rainy?'Forecast 2030-09-20T08:00:00Z: temperature 12 C; precipitation 3 mm; wind 3 m/s; symbol rain':'';
      const events=rainy?[{date:'2030-09-20',time:null,type:'Trip day',description:'Trip day rain',actions:[],who:['A'],evidence:{quote:plan.text,claims:['Trip day','A'],sources:[{quote:weatherQuote,claims:['rain']}]},confidence:0.9,uncertainty:null}]:[];
      return{output:JSON.stringify({version:1,events}),toolCalls:[],generatedAt:new Date().toISOString()};
    }};}
  }
  const ai=new CombinedAi() as unknown as AiAdminService;const service=new MonitorService(ai,fetcher,combinedWeather);
  const created=await service.create(actor,{instruction:'Sjekk turdagen på https://example.com/plan for A mot været i Birkeland 2030-09-20 og varsle bare ved regn.',checkIntervalMinutes:60,noticeDaysBefore:1,noticeLocalTime:'18:00',targets:{personIds:[person],displayIds:[]}}) as any;
  const interpreted=await service.interpret(actor,created.id,created.revision) as any;assert.equal(combinedTiers[0],'strong');assert.deepEqual((await pool.query<{reason:string;outcome:string}>(`SELECT reason,outcome FROM monitor_quality_audits WHERE task_id=$1 AND phase='interpretation'`,[created.id])).rows,[{reason:'multi_tool',outcome:'selected'}]);const active=await service.setState(actor,created.id,interpreted.revision,'approve') as any;
  const engine=new MonitorEngine(fetcher,ai,combinedWeather);const first=await engine.runManual(actor,created.id,active.revision,'manual');assert.equal((first.result as any).events.length,1);assert.equal(first.sources.length,2);assert.deepEqual(first.sources.map((item)=>item.kind),['web','weather']);assert.equal('latitude' in first.sources[1]!,false);
  const evidence=(first.result as any).events[0].evidence;assert.equal(evidence.sourceUrl,plan.finalUrl);assert.equal(evidence.sources[0].sourceUrl,'https://api.met.no/weatherapi/locationforecast/2.0/documentation');
  assert.equal(weatherRequests.every((input)=>JSON.stringify(input)==='{"location":"Birkeland","period":"date","date":"2030-09-20","timeWindow":"all"}'),true,'weather provider receives only place and forecast time');
  const runAudit=(await pool.query<{ai_call_count:number;attempted_tool_count:number;tool_count:number}>(`SELECT ai_call_count,attempted_tool_count,tool_count FROM monitor_tool_audits WHERE task_id=$1 AND phase='manual' ORDER BY created_at DESC LIMIT 1`,[created.id])).rows[0]!;assert.deepEqual(runAudit,{ai_call_count:3,attempted_tool_count:2,tool_count:2});
  const listed=(await service.list(actor) as any[]).find((item)=>item.id===created.id);const listedWeather=listed.latestResult.sources.find((item:any)=>item.kind==='weather');assert.equal(listedWeather.sourceUrl,'https://api.met.no/weatherapi/locationforecast/2.0/documentation');assert.equal(listedWeather.canonicalLocation,'Birkeland');assert.equal(listedWeather.validFrom,'2030-09-20T08:00:00Z');assert.equal(JSON.stringify(listedWeather).includes('58.3312'),false);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int AS count FROM messages')).rows[0]!.count,1);
  rainy=false;const current=(await pool.query<{revision:number}>('SELECT revision FROM monitor_tasks WHERE id=$1',[created.id])).rows[0]!;const second=await engine.runManual(actor,created.id,current.revision,'manual');assert.equal((second.result as any).events.length,0);
  assert.equal(analysisSessions,2,'weather fingerprint change must analyze even while web is unchanged');
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM monitor_events WHERE task_id=$1 AND active`,[created.id])).rows[0]!.count,0);
  assert.equal((await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM messages WHERE state IN ('scheduled','published')`)).rows[0]!.count,0);
});

test('a conditional freezing alert is routed to smarter AI during scheduled execution',async()=>{
  await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  const installation=(await pool.query<{id:string}>(`INSERT INTO installations(claimed_at,setup_step) VALUES(clock_timestamp(),'complete') RETURNING id`)).rows[0]!.id;
  const household=(await pool.query<{id:string}>(`INSERT INTO households(installation_id,name,timezone,default_locale) VALUES($1,'Synthetic frost household','Europe/Oslo','nb') RETURNING id`,[installation])).rows[0]!.id;
  const person=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic adult','adult') RETURNING id`,[household])).rows[0]!.id;
  const account=(await pool.query<{id:string}>(`INSERT INTO accounts(installation_id,email_normalized,password_hash,locale,theme) VALUES($1,'frost@test.invalid','unused','nb','system') RETURNING id`,[installation])).rows[0]!.id;
  const membership=(await pool.query<{id:string}>(`INSERT INTO memberships(household_id,account_id,person_id,role_preset,capabilities) VALUES($1,$2,$3,'household_admin',$4) RETURNING id`,[household,account,person,JSON.stringify(roleCapabilityPresets.household_admin)])).rows[0]!.id;
  const actor:MonitorActor={accountId:account,installationId:installation,householdId:household,membershipId:membership,capabilities:[...roleCapabilityPresets.household_admin]};
  const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const target=new Date(`${localToday}T12:00:00Z`);target.setUTCDate(target.getUTCDate()+1);const date=target.toISOString().slice(0,10);const at=`${date}T06:00:00Z`;
  const coldForecast:WeatherForecast={...forecast,validFrom:at,validTo:at,points:[{at,temperatureC:-2,precipitationMm:0,windSpeedMps:2,symbolCode:'clearsky_day'}],fingerprint:'synthetic-frost-v1'};
  const coldEvidence=`Forecast ${at}: temperature -2 C; precipitation 0 mm; wind 2 m/s; symbol clearsky_day`;const tiers:string[]=[];
  const ai={createTaskSession:async(_household:string,task:AiTask)=>{tiers.push(task.modelTier);let turn=0;return{provider:'openai_compatible' as const,model:'synthetic',close:()=>{},next:async(results:AiToolResult[]=[])=>{
    turn++;if(turn===1)return{toolCalls:[{id:'forecast',name:'weather.forecast',arguments:{location:'Birkeland',period:'tomorrow'}}],generatedAt:new Date().toISOString()};assert.equal(results.length,1);
    if(task.purpose==='monitor_interpretation')return{output:JSON.stringify({version:1,resultKind:'events',summary:'Varsle bare dersom temperaturen går under null.',eventTypes:['temperature'],keywords:['under null'],people:[],noticeDaysBefore:0,noticeLocalTime:'18:00',checkIntervalMinutes:60,tools:['weather.forecast'],location:{query:'Birkeland'}}),toolCalls:[],generatedAt:new Date().toISOString()};
    return{output:JSON.stringify({version:1,events:[{date,time:null,type:'temperature',description:'temperature -2 C',actions:[],who:[],evidence:{quote:coldEvidence},confidence:0.9,uncertainty:null}]}),toolCalls:[],generatedAt:new Date().toISOString()};
  }}}} as unknown as AiAdminService;
  const client={forecast:async()=>coldForecast} as unknown as MetWeatherClient;const service=new MonitorService(ai,undefined,client);
  const created=await service.create(actor,{instruction:'Varsle meg dersom temperaturen går under null i Birkeland i morgen.',checkIntervalMinutes:60,noticeDaysBefore:0,noticeLocalTime:'18:00',targets:{personIds:[person],displayIds:[]}}) as any;
  const interpreted=await service.interpret(actor,created.id,created.revision) as any;assert.equal((await pool.query<any>('SELECT interpreted_rule FROM monitor_tasks WHERE id=$1',[created.id])).rows[0].interpreted_rule.conditionalNotification,true);
  await service.setState(actor,created.id,interpreted.revision,'approve');assert.equal(await new MonitorEngine(undefined,ai,client).runOnce(),'changed');assert.deepEqual(tiers,['strong','strong']);
  const selection=(await pool.query<{reason:string;outcome:string}>(`SELECT reason,outcome FROM monitor_quality_audits WHERE task_id=$1 AND phase='scheduled'`,[created.id])).rows;assert.deepEqual(selection,[{reason:'conditional_notification',outcome:'selected'}]);
  assert.equal((await pool.query<{count:number}>('SELECT count(*)::int AS count FROM messages')).rows[0]!.count,1);
});

after(async()=>pool.end());
