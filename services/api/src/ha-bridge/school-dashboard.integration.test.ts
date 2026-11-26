import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test,{after,before} from 'node:test';
import type {FastifyInstance,LightMyRequestResponse} from 'fastify';
import {buildApp} from '../app.ts';
import {pool} from '../db.ts';
import {migrate} from '../db/migrate.ts';

const origin='https://samvev-ha-school.test.invalid';
const privateSourceText='PRIVATE_SCHOOL_SOURCE_MUST_NOT_LEAK';
let app:FastifyInstance,householdId='',ownerPersonId='',secondPersonId='',haConnectionId='',haToken='',cookie='',csrf='',sourceId='',secondSourceId='',planId='';

function cookies(response:LightMyRequestResponse){const raw=response.headers['set-cookie'];return(Array.isArray(raw)?raw:[raw!]).map(value=>value.split(';')[0]).join('; ');}
function admin(){return{cookie,origin,'x-csrf-token':csrf};}
function bearer(){return{authorization:`Bearer ${haToken}`};}
async function createConnection(name:string,capabilities:string[]){
  const response=await app.inject({method:'POST',url:`/api/v1/households/${householdId}/integrations`,headers:admin(),payload:{name,displayIds:[],credential:{name:`${name} credential`,capabilities,expiresAt:null}}});
  assert.equal(response.statusCode,201,response.body);return{connectionId:response.json().connection.id as string,token:response.json().credentialToken as string};
}
async function policy(expectedRevision:number,overrides:Record<string,unknown>={}){return app.inject({method:'PATCH',url:`/api/v1/households/${householdId}/integrations/${haConnectionId}/ha-sharing`,headers:admin(),payload:{expectedRevision,listIds:[],household:false,personIds:[],calendarSourceIds:[],allowSharedNativeWrites:false,...overrides}});}
async function snapshot(){return app.inject({method:'GET',url:'/api/v1/ha/snapshot',headers:bearer()});}

before(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');assert.equal(url.hostname,'test-db');assert.equal(url.pathname,'/samvev_test');
  await migrate();await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
  app=await buildApp({runtimeConfig:{publicOrigin:origin,secureCookies:true,trustProxy:false}});
  const begin=await app.inject({method:'POST',url:'/api/v1/setup/begin',headers:{origin}});
  const claimed=await app.inject({method:'POST',url:'/api/v1/setup/claim',headers:{origin},payload:{claimToken:begin.json().claimToken,owner:{displayName:'Synthetic HA school owner',email:'ha-school-owner@test.invalid',password:'Synthetic-ha-school-password-42'},household:{name:'Synthetic HA school household',timezone:'Europe/Oslo',locale:'en'},preferences:{locale:'en',theme:'system'}}});
  assert.equal(claimed.statusCode,200,claimed.body);householdId=claimed.json().householdId;cookie=cookies(claimed);csrf=claimed.json().csrfToken;
  ownerPersonId=(await pool.query<{person_id:string}>('SELECT person_id FROM memberships WHERE id=$1',[claimed.json().membershipId])).rows[0]!.person_id;
  secondPersonId=(await pool.query<{id:string}>(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic second school person','child') RETURNING id`,[householdId])).rows[0]!.id;
  const school=await createConnection('Synthetic school source',['integration.items.write']);
  ({connectionId:haConnectionId,token:haToken}=await createConnection('Synthetic HA school dashboard',['ha.calendar.read']));
  sourceId=(await pool.query<{id:string}>(`INSERT INTO school_plan_sources(household_id,connection_id,person_id,class_key,source_page_url,display_pdf_links_allowed)
    VALUES($1,$2,$3,$4,$5,true) RETURNING id`,[householdId,school.connectionId,ownerPersonId,'synthetic-class-a',`https://school.test.invalid/${privateSourceText}/class-a`])).rows[0]!.id;
  secondSourceId=(await pool.query<{id:string}>(`INSERT INTO school_plan_sources(household_id,connection_id,person_id,class_key,source_page_url)
    VALUES($1,$2,$3,'synthetic-class-b','https://school.test.invalid/class-b') RETURNING id`,[householdId,school.connectionId,secondPersonId])).rows[0]!.id;
  const inserted=await pool.query<{id:string}>(`WITH week AS (
      SELECT date_trunc('week',clock_timestamp() AT TIME ZONE timezone)::date AS monday,clock_timestamp()-interval '3 minutes' AS source_at FROM households WHERE id=$1)
    INSERT INTO school_plans(household_id,connection_id,person_id,source_id,iso_year,iso_week,week_starts_on,week_ends_on,content_locale,days,pdf_url,source_revision,uncertainty,observed_at,interpreted_at,last_source_observed_at,last_checked_at,content_hash)
    SELECT $1,$2,$3,$4,EXTRACT(ISOYEAR FROM monday)::int,EXTRACT(WEEK FROM monday)::int,monday,monday+6,'en',$5::jsonb,$6,$7,'low',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '4 minutes',source_at,source_at,repeat('a',64) FROM week RETURNING id`,
  [householdId,school.connectionId,ownerPersonId,sourceId,JSON.stringify([{date:'synthetic-monday',title:'Synthetic maths',items:['Synthetic pencil case']}]),`https://school.test.invalid/${privateSourceText}/week.pdf`,privateSourceText]);
  planId=inserted.rows[0]!.id;
  await pool.query(`WITH week AS (SELECT date_trunc('week',clock_timestamp() AT TIME ZONE timezone)::date AS monday,clock_timestamp()-interval '3 minutes' AS source_at FROM households WHERE id=$1)
    INSERT INTO school_plans(household_id,connection_id,person_id,source_id,iso_year,iso_week,week_starts_on,week_ends_on,content_locale,days,source_revision,uncertainty,observed_at,interpreted_at,last_source_observed_at,last_checked_at,content_hash)
    SELECT $1,$2,$3,$4,EXTRACT(ISOYEAR FROM monday)::int,EXTRACT(WEEK FROM monday)::int,monday,monday+6,'en','[{"date":"synthetic-tuesday","title":"Unshared plan"}]',$5,'unknown',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '4 minutes',source_at,source_at,repeat('b',64) FROM week`,
  [householdId,school.connectionId,secondPersonId,secondSourceId,'unshared-revision']);
  const pdf=Buffer.from('%PDF-1.4\nSynthetic private PDF\n');
  await pool.query(`INSERT INTO school_plan_pdf_snapshots(household_id,plan_id,plan_content_revision,pdf_url,bytes,sha256) VALUES($1,$2,1,$3,$4,$5)`,[householdId,planId,`https://school.test.invalid/${privateSourceText}/week.pdf`,pdf,createHash('sha256').update(pdf).digest('hex')]);
});
after(async()=>{await app.close();await pool.end();});

test('HA school dashboard is separately shared, bounded and contains no source or PDF material',async()=>{
  const denied=await snapshot();assert.equal(denied.statusCode,200,denied.body);assert.deepEqual(denied.json().schoolPlans,[]);assert.deepEqual(denied.json().calendars,[]);assert.deepEqual(denied.json().messages,[]);

  const personMismatch=await policy(0,{schoolPersonIds:[ownerPersonId],schoolSourceIds:[secondSourceId]});assert.equal(personMismatch.statusCode,403,personMismatch.body);assert.equal(personMismatch.json().error.details.reason,'ha_school_source_unavailable_or_person_not_shared');
  const shared=await policy(0,{schoolPersonIds:[ownerPersonId],schoolSourceIds:[sourceId]});assert.equal(shared.statusCode,200,shared.body);assert.equal(shared.json().revision,1);

  const visible=await snapshot();assert.equal(visible.statusCode,200,visible.body);assert.equal(visible.headers['cache-control'],'private, no-store');assert.deepEqual(visible.json().calendars,[],'school-person grants do not widen calendar audiences');assert.deepEqual(visible.json().messages,[],'school-person grants do not widen message audiences');assert.equal(visible.json().schoolPlans.length,1);
  const plan=visible.json().schoolPlans[0];assert.equal(plan.id,planId);assert.equal(plan.personId,ownerPersonId);assert.equal(plan.days[0].title,'Synthetic maths');assert.deepEqual(Object.keys(plan).sort(),['contentLocale','contentRevision','days','endsOn','id','isoWeek','isoYear','lastSourceObservedAt','personId','revision','sourceStatus','startsOn','uncertainty'].sort());
  assert.doesNotMatch(visible.body,new RegExp(privateSourceText));assert.doesNotMatch(JSON.stringify(plan),/sourcePageUrl|sourceId|pdfUrl|pdfLink|pdfBytes|sha256|classKey|connectionId/);
  assert.equal(visible.json().schoolPlans.some((value:{personId:string})=>value.personId===secondPersonId),false);

  const preserved=await policy(1);assert.equal(preserved.statusCode,200,preserved.body);assert.deepEqual(preserved.json().schoolPersonIds,[ownerPersonId]);assert.deepEqual(preserved.json().schoolSourceIds,[sourceId]);assert.equal((await snapshot()).json().schoolPlans.length,1,'legacy policy updates preserve explicit school sharing');
  const removed=await policy(2,{schoolPersonIds:[],schoolSourceIds:[]});assert.equal(removed.statusCode,200,removed.body);assert.deepEqual((await snapshot()).json().schoolPlans,[]);

  const restored=await policy(3,{schoolPersonIds:[ownerPersonId],schoolSourceIds:[sourceId]});assert.equal(restored.statusCode,200,restored.body);await pool.query('UPDATE school_plan_sources SET revoked_at=clock_timestamp() WHERE id=$1',[sourceId]);assert.deepEqual((await snapshot()).json().schoolPlans,[],'source revocation removes the projection immediately');
  const stalePreserve=await policy(4);assert.equal(stalePreserve.statusCode,403,stalePreserve.body);assert.equal(stalePreserve.json().error.details.reason,'ha_school_source_unavailable_or_person_not_shared');
  const clearStale=await policy(4,{schoolPersonIds:[],schoolSourceIds:[]});assert.equal(clearStale.statusCode,200,clearStale.body);
});
