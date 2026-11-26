import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after, before } from 'node:test';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { pool } from '../db.ts';
import { migrate } from '../db/migrate.ts';
import { localDateInTimezone } from '../people/domain.ts';

const origin='https://home-mcp.test.invalid',callback='https://home-client.test.invalid/oauth/callback';
const grantedScopes=['mcp:home:read','mcp:people:read','mcp:calendar:read','mcp:messages:read','mcp:groceries:read','mcp:dinners:read'] as const;
const scopes=grantedScopes.join(' ');
const meta={[PROTOCOL_VERSION_META_KEY]:'2026-07-28',[CLIENT_INFO_META_KEY]:{name:'synthetic-home-client',version:'1.0.0'},[CLIENT_CAPABILITIES_META_KEY]:{}};
let app:FastifyInstance,householdId='',ownerCookie='',ownerCsrf='',clientId='',personId='',ungrantedPersonId='',grantId='',ownerMembershipId='',ownerAccountId='',integrationConnectionId='',calendarSourceId='',ungrantedCalendarSourceId='';

function inject(options:any){return app.inject({...options,headers:{host:new URL(origin).host,...(options.headers??{})}});}
function cookies(response:LightMyRequestResponse){const value=response.headers['set-cookie'],list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>item.split(';')[0]).join('; ');}
function form(value:Record<string,string>){return new URLSearchParams(value).toString();}
function challenge(verifier:string){return createHash('sha256').update(verifier).digest('base64url');}
function dateOffset(value:string,days:number){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
async function authorize(serial:number){
  const verifier=`synthetic-home-verifier-${serial}-abcdefghijklmnopqrstuvwxyz0123456789`,state=`home-state-${serial}-0123456789`;
  const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:callback,code_challenge:challenge(verifier),code_challenge_method:'S256',resource:`${origin}/mcp`,scope:scopes,state});
  const page=await inject({method:'GET',url:`/oauth/authorize?${query}`,headers:{cookie:ownerCookie}});assert.equal(page.statusCode,200,page.body);
  const approved=await inject({method:'POST',url:'/oauth/authorize',headers:{cookie:ownerCookie,origin,'content-type':'application/x-www-form-urlencoded'},payload:form({...Object.fromEntries(query),_csrf:ownerCsrf,household_id:householdId,decision:'approve'})});assert.equal(approved.statusCode,303,approved.body);
  const code=new URL(String(approved.headers.location)).searchParams.get('code');assert.ok(code);
  const exchanged=await inject({method:'POST',url:'/oauth/token',headers:{'content-type':'application/x-www-form-urlencoded'},payload:form({grant_type:'authorization_code',client_id:clientId,code,redirect_uri:callback,code_verifier:verifier,resource:`${origin}/mcp`})});assert.equal(exchanged.statusCode,200,exchanged.body);
  return exchanged.json().access_token as string;
}
async function callHome(token:string,id:number,sections:string[]=['people']){return inject({method:'POST',url:'/mcp',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'household.home.get'},payload:{jsonrpc:'2.0',id,method:'tools/call',params:{name:'household.home.get',arguments:{sections},_meta:meta}}});}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Integration tests refuse non-isolated DATABASE_URL');
  await migrate();
  const reset=await pool.connect();
  try { await reset.query('BEGIN');await reset.query("SET LOCAL statement_timeout='60s'");await reset.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');await reset.query('COMMIT'); }
  catch(error){await reset.query('ROLLBACK');throw error;}
  finally { reset.release(); }
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic home owner',email:'home-owner@test.invalid',password:'Synthetic-home-owner-pass-42'},household:{name:'Synthetic home household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});assert.equal(claim.statusCode,200,claim.body);
  householdId=claim.json().householdId;ownerMembershipId=claim.json().membershipId;ownerCookie=cookies(claim);ownerCsrf=claim.json().csrfToken;
  ownerAccountId=(await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1',[ownerMembershipId])).rows[0]!.account_id;
  personId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic selected person','child') RETURNING id`,[householdId])).rows[0]!.id;
  ungrantedPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic unselected person','adult') RETURNING id`,[householdId])).rows[0]!.id;
  integrationConnectionId=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic home calendar integration') RETURNING id`,[householdId])).rows[0]!.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state)
    VALUES($1,$2,$3,'ics','Synthetic home calendar','connected') RETURNING id`,[householdId,integrationConnectionId,ownerAccountId])).rows[0]!.id;
  const sources=await pool.query<{id:string;external_id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household)
    VALUES($1,$2,'synthetic-granted-home','Synthetic granted calendar',true,true),($1,$2,'synthetic-ungranted-home','Synthetic ungranted calendar',true,true)
    RETURNING id,external_id`,[householdId,calendar]);
  calendarSourceId=sources.rows.find((source)=>source.external_id==='synthetic-granted-home')!.id;
  ungrantedCalendarSourceId=sources.rows.find((source)=>source.external_id==='synthetic-ungranted-home')!.id;
  const client=await inject({method:'POST',url:'/oauth/register',payload:{client_name:'Synthetic home MCP',redirect_uris:[callback],token_endpoint_auth_method:'none'}});assert.equal(client.statusCode,201,client.body);clientId=client.json().client_id;
});
after(async()=>{if(app)await app.close();await pool.end();});

async function addCalendarEvent(input:{sourceId:string;personId:string;key:string;title:string;startsAt:Date|string;endsAt:Date|string|null;allDay:boolean;status?:string;freshness?:'current'|'stale';lastSuccessfulSyncAt?:string}){
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,publish_at,expires_at,source,metadata,request_hash)
    VALUES($1,$2,$3,'event',false,$4,'Synthetic private calendar detail','normal',$5,$6,clock_timestamp()-interval '1 day',clock_timestamp()+interval '400 days',$7,$8,$9) RETURNING id`,[
    householdId,integrationConnectionId,input.key,input.title,input.startsAt,input.endsAt,
    JSON.stringify({url:'https://calendar.test.invalid/private-token',observedAt:new Date().toISOString(),uncertainty:'low'}),
    JSON.stringify({allDay:input.allDay,calendar:{provider:'ics',sourceId:input.sourceId,...(input.status?{status:input.status}:{}),...(input.freshness?{freshness:input.freshness}:{}),...(input.lastSuccessfulSyncAt?{lastSuccessfulSyncAt:input.lastSuccessfulSyncAt}:{})},evidence:{quote:'Synthetic private evidence'}}),
    createHash('sha256').update(input.key).digest('hex')
  ])).rows[0]!.id;
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item,input.personId]);
  await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation)
    VALUES($1,$2,$3,'single',$4,$3,$5,'active',1)`,[householdId,input.sourceId,input.key,item,createHash('sha256').update(`occurrence:${input.key}`).digest('hex')]);
  return item;
}

test('home MCP follows OAuth and exact live grants and returns only requested bounded sections',async()=>{
  await authorize(1);
  const authorization=(await inject({method:'GET',url:`/api/v1/households/${householdId}/mcp/authorizations`,headers:{cookie:ownerCookie}})).json().authorizations[0];
  grantId=authorization.id;
  const selected=await inject({method:'PUT',url:`/api/v1/households/${householdId}/mcp/authorizations/${grantId}/policy`,headers:{cookie:ownerCookie,'x-csrf-token':ownerCsrf,origin,'content-type':'application/json'},payload:{expectedRevision:authorization.revision,scopes:authorization.scopes,personIds:[personId],displayIds:[],resources:[{kind:'calendar_source',id:calendarSourceId}]}});
  assert.equal(selected.statusCode,200,selected.body);
  const token=await authorize(2);
  const response=await callHome(token,1);assert.equal(response.statusCode,200,response.body);
  const result=response.json().result;assert.notEqual(result.isError,true,response.body);
  const home=result.structuredContent as Record<string,any>;
  assert.equal(home.householdId,householdId);assert.equal(home.timezone,'Europe/Oslo');assert.equal(home.locale,'en');
  assert.deepEqual(home.people,[{id:personId,displayName:'Synthetic selected person',revision:1}]);
  assert.deepEqual(Object.keys(home).sort(),['householdId','locale','people','serverNow','timezone','today','tomorrow','truncated'].sort());
  assert.deepEqual(home.truncated,{people:false});
  assert.doesNotMatch(JSON.stringify(home),/unselected|birth|photo|avatar|school|evidence|sourceUrl|metadata|"displayId"/i);
  const audit=(await pool.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM audit_events WHERE household_id=$1 AND action='mcp.home_read' ORDER BY occurred_at DESC LIMIT 1`,[householdId])).rows[0]!;
  assert.deepEqual(audit.metadata,{sections:['people'],counts:{people:1},truncated:{people:false}});

  await pool.query(`UPDATE mcp_oauth_grants SET scopes=scopes-'mcp:people:read' WHERE id=$1`,[grantId]);
  const narrowed=await callHome(token,2);assert.equal(narrowed.statusCode,200,narrowed.body);assert.equal(narrowed.json().result.isError,true);
  assert.doesNotMatch(narrowed.body,/Synthetic selected person/);
  await pool.query('UPDATE mcp_oauth_grants SET scopes=$2::jsonb WHERE id=$1',[grantId,JSON.stringify(grantedScopes)]);
});

test('home MCP composes calendar, active messages and household boards without widening grants',async()=>{
  const timezone='Europe/Oslo',today=localDateInTimezone(new Date(),timezone),tomorrow=dateOffset(today,1),afterTomorrow=dateOffset(today,2);
  const overnight=(await pool.query<{starts_at:Date;ends_at:Date}>(`SELECT
    ($1::date+time '23:30') AT TIME ZONE $3 AS starts_at,
    ($2::date+time '01:00') AT TIME ZONE $3 AS ends_at`,[today,tomorrow,timezone])).rows[0]!;
  const visibleOvernight=await addCalendarEvent({sourceId:calendarSourceId,personId,key:'synthetic-visible-overnight',title:'Synthetic overnight activity',startsAt:overnight.starts_at,endsAt:overnight.ends_at,allDay:false,freshness:'current',lastSuccessfulSyncAt:`${today}T10:00:00.000Z`});
  const visibleAllDay=await addCalendarEvent({sourceId:calendarSourceId,personId,key:'synthetic-visible-all-day',title:'Synthetic all-day activity',startsAt:`${tomorrow}T00:00:00.000Z`,endsAt:`${afterTomorrow}T00:00:00.000Z`,allDay:true,freshness:'stale',lastSuccessfulSyncAt:`${today}T09:00:00.000Z`});
  const visibleTentative=await addCalendarEvent({sourceId:calendarSourceId,personId,key:'synthetic-visible-tentative',title:'Synthetic tentative activity',startsAt:overnight.starts_at,endsAt:overnight.ends_at,allDay:false,status:'tentative'});
  const cancelled=await addCalendarEvent({sourceId:calendarSourceId,personId,key:'synthetic-cancelled',title:'Synthetic cancelled activity',startsAt:overnight.starts_at,endsAt:overnight.ends_at,allDay:false,status:'cancelled'});
  const declined=await addCalendarEvent({sourceId:calendarSourceId,personId,key:'synthetic-declined',title:'Synthetic declined activity',startsAt:overnight.starts_at,endsAt:overnight.ends_at,allDay:false,status:'declined'});
  const hiddenPersonEvent=await addCalendarEvent({sourceId:calendarSourceId,personId:ungrantedPersonId,key:'synthetic-hidden-person',title:'Synthetic hidden person activity',startsAt:overnight.starts_at,endsAt:overnight.ends_at,allDay:false});
  const hiddenSourceEvent=await addCalendarEvent({sourceId:ungrantedCalendarSourceId,personId,key:'synthetic-hidden-source',title:'Synthetic hidden source activity',startsAt:overnight.starts_at,endsAt:overnight.ends_at,allDay:false});

  const activeMessage=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at,created_at)
    VALUES($1,$2,'Synthetic older active message','normal',true,($3::date::timestamp AT TIME ZONE $5),(($4::date+1)::timestamp AT TIME ZONE $5),'published','synthetic-home-active',clock_timestamp(),clock_timestamp()-interval '30 days') RETURNING id`,[householdId,ownerMembershipId,today,tomorrow,timezone])).rows[0]!.id;
  const overnightMessage=(await pool.query<{id:string}>(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES($1,$2,'Synthetic overnight message','attention',true,($3::date+time '23:30') AT TIME ZONE $5,($4::date+time '01:00') AT TIME ZONE $5,'scheduled','synthetic-home-overnight',NULL) RETURNING id`,[householdId,ownerMembershipId,today,tomorrow,timezone])).rows[0]!.id;
  await pool.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at,created_at)
    SELECT $1,$2,'Synthetic irrelevant history '||series,'normal',true,clock_timestamp()-interval '60 days',($3::date::timestamp AT TIME ZONE $4)-interval '1 minute','published','synthetic-home-history-'||series,clock_timestamp()-interval '60 days',clock_timestamp()-make_interval(secs=>series)
    FROM generate_series(1,205) series`,[householdId,ownerMembershipId,today,timezone]);
  await pool.query(`INSERT INTO messages(household_id,author_membership_id,body,importance,audience_household,publish_at,expires_at,state,idempotency_key,published_at)
    VALUES
      ($1,$2,'Synthetic ended message','normal',true,clock_timestamp()-interval '2 days',($3::date::timestamp AT TIME ZONE $5)-interval '1 minute','published','synthetic-home-ended',clock_timestamp()-interval '2 days'),
      ($1,$2,'Synthetic beyond-window message','normal',true,(($4::date+1)::timestamp AT TIME ZONE $5),(($4::date+2)::timestamp AT TIME ZONE $5),'scheduled','synthetic-home-beyond',NULL)`,[householdId,ownerMembershipId,today,tomorrow,timezone]);

  const grocery=(await pool.query<{id:string}>(`INSERT INTO household_grocery_items(household_id,label,checked,created_by_actor_type,created_by_actor_id)
    VALUES($1,'Synthetic apples',false,'member',$2) RETURNING id`,[householdId,ownerMembershipId])).rows[0]!.id;
  await pool.query(`INSERT INTO household_grocery_items(household_id,label,checked,deleted_at,created_by_actor_type,created_by_actor_id)
    VALUES($1,'Synthetic deleted grocery',true,clock_timestamp(),'member',$2)`,[householdId,ownerMembershipId]);
  const dinnerRows=await pool.query<{id:string;local_date:string}>(`INSERT INTO household_dinner_assignments(household_id,local_date,title_snapshot,emoji_snapshot,updated_by_actor_type,updated_by_actor_id)
    VALUES($1,$2,'Synthetic soup','🍲','member',$5),($1,$3,'Synthetic tacos','🌮','member',$5),($1,$4,'Synthetic later dinner','🍽️','member',$5)
    RETURNING id,local_date::text`,[householdId,today,tomorrow,afterTomorrow,ownerMembershipId]);

  const token=await authorize(3),sections=['calendar','messages','groceries','dinners'];
  const response=await callHome(token,3,sections);assert.equal(response.statusCode,200,response.body);
  const rpc=response.json().result;assert.notEqual(rpc.isError,true,response.body);
  const home=rpc.structuredContent as Record<string,any>;
  assert.deepEqual(Object.keys(home).sort(),['calendar','dinners','groceries','householdId','locale','messages','serverNow','timezone','today','tomorrow','truncated'].sort());
  assert.deepEqual(home.calendar.map((event:{id:string})=>event.id).sort(),[visibleAllDay,visibleOvernight,visibleTentative].sort());
  assert.equal(home.calendar.find((event:{id:string})=>event.id===visibleAllDay)?.allDay,true);
  assert.equal(home.calendar.find((event:{id:string})=>event.id===visibleOvernight)?.endsAt,overnight.ends_at.toISOString());
  assert.deepEqual(home.calendar.find((event:{id:string})=>event.id===visibleOvernight)&&{freshness:home.calendar.find((event:{id:string})=>event.id===visibleOvernight).freshness,lastSuccessfulSyncAt:home.calendar.find((event:{id:string})=>event.id===visibleOvernight).lastSuccessfulSyncAt},{freshness:'current',lastSuccessfulSyncAt:`${today}T10:00:00.000Z`});
  assert.deepEqual(home.calendar.find((event:{id:string})=>event.id===visibleAllDay)&&{freshness:home.calendar.find((event:{id:string})=>event.id===visibleAllDay).freshness,lastSuccessfulSyncAt:home.calendar.find((event:{id:string})=>event.id===visibleAllDay).lastSuccessfulSyncAt},{freshness:'stale',lastSuccessfulSyncAt:`${today}T09:00:00.000Z`});
  assert.ok(home.calendar.every((event:{sourceId:string;personIds:string[]})=>event.sourceId===calendarSourceId&&event.personIds.length===1&&event.personIds[0]===personId));
  assert.deepEqual(home.messages.map((message:{id:string})=>message.id).sort(),[activeMessage,overnightMessage].sort(),'date filtering precedes the limit, so the older active message survives 205 newer history rows');
  assert.deepEqual(home.groceries,[{id:grocery,label:'Synthetic apples',checked:false,revision:1}]);
  assert.deepEqual(home.dinners.map((dinner:{localDate:string})=>dinner.localDate),[today,tomorrow]);
  assert.deepEqual(new Set(home.dinners.map((dinner:{id:string})=>dinner.id)),new Set(dinnerRows.rows.filter((dinner)=>dinner.local_date!==afterTomorrow).map((dinner)=>dinner.id)));
  const serialized=JSON.stringify(home);
  assert.doesNotMatch(serialized,/private-token|private calendar detail|private evidence|irrelevant history|ended message|beyond-window|deleted grocery|later dinner/i);
  for(const hidden of [ungrantedPersonId,ungrantedCalendarSourceId,hiddenPersonEvent,hiddenSourceEvent,cancelled,declined])assert.equal(serialized.includes(hidden),false);
  assert.deepEqual(home.truncated,{calendar:false,messages:false,groceries:false,dinners:false});
  const audit=(await pool.query<{metadata:Record<string,unknown>}>(`SELECT metadata FROM audit_events WHERE household_id=$1 AND action='mcp.home_read' ORDER BY occurred_at DESC,id DESC LIMIT 1`,[householdId])).rows[0]!;
  assert.deepEqual(audit.metadata,{sections,counts:{calendar:3,messages:2,groceries:1,dinners:2},truncated:{calendar:false,messages:false,groceries:false,dinners:false}});

  for(const [index,[section,scope]] of ([['calendar','mcp:calendar:read'],['messages','mcp:messages:read'],['groceries','mcp:groceries:read'],['dinners','mcp:dinners:read']] as const).entries()){
    await pool.query('UPDATE mcp_oauth_grants SET scopes=scopes-$2 WHERE id=$1',[grantId,scope]);
    const denied=await callHome(token,10+index,[section]);assert.equal(denied.statusCode,200,denied.body);assert.equal(denied.json().result.isError,true);
    assert.doesNotMatch(denied.body,/Synthetic (overnight activity|older active message|apples|soup)/);
    await pool.query('UPDATE mcp_oauth_grants SET scopes=$2::jsonb WHERE id=$1',[grantId,JSON.stringify(grantedScopes)]);
  }
});
