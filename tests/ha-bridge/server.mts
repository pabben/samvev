/** Real Samvev API for the cross-repository HA test harness. Synthetic data only. */
import assert from 'node:assert/strict';
import { buildApp } from '../../services/api/src/app.ts';
import { assertIsolatedTestDatabase, pool } from '../../services/api/src/db.ts';
import { migrate } from '../../services/api/src/db/migrate.ts';

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (process.env.SAMVEV_DEMO_MODE !== 'true') throw new Error('Isolated fixture requires demo mode');
await migrate();
await pool.query('TRUNCATE installations,pairing_requests,rate_limits RESTART IDENTITY CASCADE');
const origin = 'http://127.0.0.1:4193';
const app = await buildApp({ runtimeConfig: { publicOrigin: origin, secureCookies: false, trustProxy: false } });
const begin = await app.inject({ method: 'POST', url: '/api/v1/setup/begin', headers: { origin } });
assert.equal(begin.statusCode, 200, 'synthetic setup begin');
const claim = await app.inject({
  method: 'POST', url: '/api/v1/setup/claim', headers: { origin },
  payload: {
    claimToken: begin.json().claimToken,
    owner: { displayName: 'Synthetic HA owner', email: 'ha-owner@example.invalid', password: 'Synthetic-HA-roundtrip-password-42' },
    household: { name: 'Synthetic HA household', timezone: 'Europe/Oslo', locale: 'en' },
    preferences: { locale: 'en', theme: 'light' }
  }
});
assert.equal(claim.statusCode, 200, 'synthetic owner setup');
const householdId = claim.json().householdId;
await pool.query(`INSERT INTO persons(household_id,display_name,age_group) VALUES($1,'Synthetic private child','child')`, [householdId]);
await pool.query(`INSERT INTO households(installation_id,name,timezone,default_locale) SELECT installation_id,'Synthetic unrelated household','UTC','en' FROM households WHERE id=$1`, [householdId]);
// A synthetic, already imported recurring source exercises the actual export
// and HA read-only platform. Provider HTTP is covered by CalendarService tests;
// this fixture never uses an external calendar or credentials.
const owner = (await pool.query<{account_id:string}>('SELECT account_id FROM memberships WHERE id=$1', [claim.json().membershipId])).rows[0]!;
const authority = (await pool.query<{id:string}>(`INSERT INTO integration_connections(household_id,name) VALUES($1,'Synthetic imported calendar authority') RETURNING id`, [householdId])).rows[0]!;
const imported = (await pool.query<{id:string}>(`INSERT INTO calendar_connections(household_id,integration_connection_id,owner_account_id,provider,name,state) VALUES($1,$2,$3,'ics','Synthetic imported calendar','connected') RETURNING id`, [householdId,authority.id,owner.account_id])).rows[0]!;
const source = (await pool.query<{id:string}>(`INSERT INTO calendar_sources(household_id,connection_id,external_id,name,enabled,target_household,subject_household,last_sync_succeeded_at,last_complete_window_from,last_complete_window_to)
  VALUES($1,$2,'synthetic-recurring-source','Synthetic imported series',true,true,true,clock_timestamp(),clock_timestamp()-interval '5 days',clock_timestamp()+interval '60 days') RETURNING id`, [householdId,imported.id])).rows[0]!;
await pool.query(`WITH created AS (
  INSERT INTO integration_items(household_id,connection_id,external_id,kind,target_household,title,body,priority,starts_at,ends_at,source,metadata,request_hash)
  SELECT $1,$2,'fixture-occurrence-'||sequence,'event',true,'Synthetic imported occurrence '||sequence,'Synthetic imported appointment','normal',
    date_trunc('hour',clock_timestamp())+interval '1 day'+sequence*interval '1 hour',date_trunc('hour',clock_timestamp())+interval '1 day'+(sequence+1)*interval '1 hour','{}',
    jsonb_build_object('calendar',jsonb_build_object('provider','ics','sourceId',$3::text,'subjectHousehold',true,'status','confirmed')),repeat('a',64)
  FROM generate_series(1,3) sequence RETURNING id,external_id
)
INSERT INTO calendar_occurrences(household_id,source_id,event_uid,instance_id,integration_item_id,external_item_id,fingerprint,status,last_seen_generation)
SELECT $1,$3::uuid,'synthetic-series',external_id,id,external_id,repeat('a',64),'active',1 FROM created`, [householdId,authority.id,source.id]);
await app.listen({ host: '0.0.0.0', port: 4193 });
console.log('isolated_ha_fixture_ready');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void app.close().then(() => process.exit(0)));
