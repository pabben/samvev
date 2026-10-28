import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {tokenHash} from '@samvev/core';
import {buildApp} from './app.ts';
import {pool} from './db.ts';
import {migrate} from './db/migrate.ts';

const origin='https://round15-next.test.invalid';
let app:FastifyInstance,householdId:string,personId:string,ownerCookie:string,displayCookie:string,connectionId:string,sourceId:string,displayId:string;
function cookie(response:LightMyRequestResponse){const value=response.headers['set-cookie'];return(Array.isArray(value)?value:value?[value]:[]).map((part)=>part.split(';')[0]).join('; ');}
function hash(value:string){return createHash('sha256').update(value).digest('hex');}

before(async()=>{
  const database=new URL(process.env.DATABASE_URL??'');
  if(database.hostname!=='test-db'||database.pathname!=='/samvev_test')throw new Error('Round 15 Next tests require the isolated test database');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claim=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic Next owner',email:'round15-next@test.invalid',password:'Synthetic-next-password-42'},household:{name:'Synthetic Next household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'light'}}});
  assert.equal(claim.statusCode,200,claim.body);householdId=claim.json().householdId;ownerCookie=cookie(claim);
  const owner=(await pool.query<{person_id:string;account_id:string}>('SELECT person_id,account_id FROM memberships WHERE id=$1',[claim.json().membershipId])).rows[0]!;personId=owner.person_id;
  connectionId=(await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic Next calendar') RETURNING id`,[householdId])).rows[0]!.id;
  const calendar=(await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state) VALUES($1,$2,$3,'ics','Synthetic Next source','connected') RETURNING id`,[householdId,connectionId,owner.account_id])).rows[0]!;
  sourceId=(await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled) VALUES($1,$2,'synthetic-next','Synthetic Next source',true) RETURNING id`,[householdId,calendar.id])).rows[0]!.id;
  const setup=(await pool.query<{id:string}>(`INSERT INTO display_setups(household_id,name,cards,card_order,all_sources,locale,theme) VALUES($1,'Synthetic Next setup','["next","external_items"]','["next","external_items"]',true,'en','light') RETURNING id`,[householdId])).rows[0]!;
  await pool.query('INSERT INTO display_setup_people(household_id,setup_id,person_id) VALUES($1,$2,$3)',[householdId,setup.id,personId]);
  const token='synthetic-round15-next-display-token';displayCookie=`samvev_display=${token}`;
  displayId=(await pool.query<{id:string}>(`INSERT INTO displays(household_id,name,privacy_mode,external_items_enabled,setup_id,credential_hash,credential_expires_at) VALUES($1,'Synthetic Next display',false,true,$2,$3,clock_timestamp()+interval '2 days') RETURNING id`,[householdId,setup.id,tokenHash(token)])).rows[0]!.id;
  await pool.query('INSERT INTO integration_connection_display_grants(household_id,connection_id,display_id) VALUES($1,$2,$3)',[householdId,connectionId,displayId]);
});
after(async()=>{await app.close();await pool.end();});

async function addEvent(key:string,start:string,end:string|null,options:{status?:string;allDay?:boolean;generic?:boolean}={}){
  const metadata={allDay:options.allDay??false,...(!options.generic?{calendar:{provider:'ics',sourceId,subjectHousehold:false,status:options.status??'confirmed'}}:{})};
  const item=(await pool.query<{id:string}>(`INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
    VALUES($1,$2,$3,'event',true,$3,'Synthetic Next detail','normal',$4,$5,$6,$7,$8) RETURNING id`,[householdId,connectionId,key,start,end,JSON.stringify({observedAt:new Date().toISOString(),uncertainty:'low'}),JSON.stringify(metadata),hash(key)])).rows[0]!;
  await pool.query('INSERT INTO integration_item_person_subjects(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item.id,personId]);
  await pool.query('INSERT INTO integration_item_person_targets(household_id,item_id,person_id) VALUES($1,$2,$3)',[householdId,item.id,personId]);
  await pool.query('INSERT INTO integration_item_display_targets(household_id,item_id,display_id) VALUES($1,$2,$3)',[householdId,item.id,displayId]);
  if(!options.generic)await pool.query(`INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation) VALUES($1,$2,$3,'single',$4,$3,$5,'active',1)`,[householdId,sourceId,key,item.id,hash(key)]);
  return item.id;
}

test('all Next routes filter cancellation and completed points before selection while history preserves source rows',async(t)=>{
  const tomorrow=new Date(Date.now()+86_400_000).toISOString().slice(0,10),at=(time:string)=>`${tomorrow}T${time}:00Z`;
  t.mock.timers.enable({apis:['Date'],now:Date.parse(at('09:00'))});
  const hidden=[];
  for(const [status,time] of [['cancelled','10:00'],['canceled','10:30'],['declined','11:00']] as const)hidden.push(await addEvent(`Synthetic ${status}`,at(time),at('11:30'),{status}));
  const pastMissing=await addEvent('Synthetic past missing end',at('08:00'),null);
  const pastEqual=await addEvent('Synthetic past equal endpoints',at('08:30'),at('08:30'));
  const invalidAllDay=await addEvent('Synthetic invalid all-day endpoints',at('00:00'),at('00:00'),{allDay:true});
  const confirmed=await addEvent('Synthetic confirmed noon',at('12:00'),at('13:00'));
  const endpoints=[
    {url:`/api/v1/households/${householdId}/activities/next`,cookie:ownerCookie},
    {url:`/api/v1/households/${householdId}/people/${personId}/activities/next`,cookie:ownerCookie},
    {url:'/api/v1/display/activities/next',cookie:displayCookie},
    {url:`/api/v1/display/people/${personId}/activities/next`,cookie:displayCookie}
  ];
  const expectNext=async(id:string)=>{for(const endpoint of endpoints){const response=await app.inject({method:'GET',url:endpoint.url,headers:{cookie:endpoint.cookie}});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().activity?.id,id,endpoint.url);}};
  await expectNext(confirmed);
  const futureEqual=await addEvent('Synthetic future equal endpoints',at('11:00'),at('11:00'));
  await expectNext(futureEqual);
  t.mock.timers.setTime(Date.parse(at('11:00')));await expectNext(futureEqual);
  t.mock.timers.setTime(Date.parse(at('11:00'))+1);await expectNext(confirmed);
  const genericPoint=await addEvent('Synthetic generic allDay hint point',at('11:30'),at('11:30'),{generic:true,allDay:true});
  await expectNext(genericPoint);
  t.mock.timers.setTime(Date.parse(at('11:30'))+1);await expectNext(confirmed);
  for(const endpoint of [
    {url:`/api/v1/households/${householdId}/people/${personId}/activities?from=${tomorrow}&to=${tomorrow}&limit=50`,cookie:ownerCookie},
    {url:`/api/v1/display/people/${personId}/activities?from=${tomorrow}&to=${tomorrow}&limit=50`,cookie:displayCookie}
  ]){
    const response=await app.inject({method:'GET',url:endpoint.url,headers:{cookie:endpoint.cookie}});assert.equal(response.statusCode,200,response.body);
    const rows=response.json().activities,ids=rows.map((row:any)=>row.id);
    for(const id of [...hidden,pastMissing,pastEqual,futureEqual,genericPoint])assert.ok(ids.includes(id),'history retains cancelled, declined and completed points');
    assert.ok(!ids.includes(invalidAllDay),'invalid all-day civil ranges stay closed');
    const savedPoint=rows.find((row:any)=>row.id===futureEqual);assert.equal(savedPoint.startsAt,savedPoint.endsAt,'normalization does not rewrite source endpoint values');
  }
});
