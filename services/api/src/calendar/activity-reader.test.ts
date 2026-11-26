import test from 'node:test';
import assert from 'node:assert/strict';
import type { DbClient } from '../db.ts';
import { readCalendarActivityRows, type CalendarActivityReadInput } from './activity-reader.ts';

const householdId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const personId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('calendar activity reader preserves household, person, source and upcoming filters', async()=>{
  let captured:{sql:string;values:unknown[]|undefined}|undefined;
  const client={async query(sql:string,values?:unknown[]){captured={sql,values};return{rows:[]};}} as unknown as DbClient;
  const input:CalendarActivityReadInput={householdId,personIds:[personId],viewer:{personId,membershipId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},canViewAll:true,from:'2027-03-28',to:'2027-04-10',limit:12,sourceIds:[sourceId],upcomingOnly:true};
  assert.deepEqual(await readCalendarActivityRows(input,client),[]);
  assert.ok(captured);
  assert.match(captured.sql,/i\.household_id=\$1/);
  assert.match(captured.sql,/occurrence\.source_id=ANY\(\$8\)/);
  assert.match(captured.sql,/placement\.person_id=ANY\(\$2\)/);
  assert.match(captured.sql,/calendar,status.*NOT IN \('cancelled','canceled','declined'\)/);
  assert.match(captured.sql,/AT TIME ZONE household\.timezone/,'civil all-day events retain household-local date behavior');
  assert.deepEqual(captured.values?.slice(0,9),[householdId,[personId],'2027-03-28','2027-04-10',true,personId,13,[sourceId],null]);
  assert.ok(captured.values?.[17] instanceof Date,'upcoming-only query passes the current instant fence');
});

test('calendar reader emits no rows when a foreign household is selected', async()=>{
  const client={async query(sql:string,values?:unknown[]){
    assert.match(sql,/i\.household_id=\$1/);
    return{rows:values?.[0]===householdId?[{id:'event-a'}]:[]};
  }} as unknown as DbClient;
  const input:CalendarActivityReadInput={householdId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',personIds:[personId],viewer:{personId,membershipId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},canViewAll:true,from:'2027-03-28',to:'2027-04-03',limit:10,sourceIds:[sourceId]};
  assert.deepEqual(await readCalendarActivityRows(input,client),[]);
});
