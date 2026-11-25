import { pool, type DbClient } from '../db.ts';

export interface ExternalItemRow {
  id:string; external_id:string; kind:string; content_locale:'en'|'nb'|null; target_household:boolean; title:string; body:string;
  entries:Array<{label:string;detail?:string}>; priority:string; publish_at:Date|null; starts_at:Date|null;
  ends_at:Date|null; expires_at:Date|null; source:Record<string,unknown>; metadata:Record<string,unknown>;
  status:string; revision:number; updated_at:Date; person_ids:string[]; display_ids:string[];
  subject_person_ids:string[];
  calendar_connection_state:string|null; calendar_source_error_code:string|null; calendar_provider_status:string|null; calendar_owner_authorized:boolean;
  temperature_sensor_available:boolean|null;
  acl_witness?:string;acl_sensor_id?:string|null;
}

export function mapExternalItem(row:ExternalItemRow,options:{includeExternalId?:boolean;forDisplay?:boolean;selectedPersonIds?:string[]}={}):Record<string,unknown>{
  const source=options.forDisplay
    ? Object.fromEntries(Object.entries(row.source).filter(([key])=>!['url','links'].includes(key)))
    : row.source;
  const metadata=options.forDisplay
    ? Object.fromEntries(Object.entries(row.metadata).filter(([key])=>key!=='actionUrl'))
    : row.metadata;
  const storedCalendar=metadata.calendar&&typeof metadata.calendar==='object'&&!Array.isArray(metadata.calendar)?metadata.calendar as Record<string,unknown>:undefined;
  const storedFreshnessReason=['sync_failed','provider_disabled','reauthorization_required','source_missing'].includes(String(storedCalendar?.freshnessReason))?String(storedCalendar?.freshnessReason):undefined;
  const calendarIsStale=storedCalendar&&row.calendar_connection_state?row.calendar_owner_authorized!==true||storedCalendar.freshness==='stale'||!['connected','syncing','error'].includes(row.calendar_connection_state):false;
  const calendarFreshness=storedCalendar&&row.calendar_connection_state?{
    freshness:calendarIsStale?'stale':'current',
    lastSuccessfulSyncAt:typeof storedCalendar.lastSuccessfulSyncAt==='string'?storedCalendar.lastSuccessfulSyncAt:null,
    ...(calendarIsStale?{reason:row.calendar_owner_authorized!==true?'reauthorization_required':row.calendar_provider_status==='disabled'?'provider_disabled':storedFreshnessReason??(row.calendar_source_error_code?'sync_failed':'reauthorization_required')}:{})
  }:undefined;
  const calendarMetadata=calendarFreshness&&metadata.calendar&&typeof metadata.calendar==='object'&&!Array.isArray(metadata.calendar)
    ?{...Object.fromEntries(Object.entries(metadata.calendar as Record<string,unknown>).filter(([key])=>key!=='freshnessReason')),...calendarFreshness}
    :calendarFreshness;
  const storedTemperature=metadata.temperature&&typeof metadata.temperature==='object'&&!Array.isArray(metadata.temperature)?metadata.temperature as Record<string,unknown>:undefined;
  const temperatureAuthorityStale=Boolean(storedTemperature&&row.calendar_connection_state&&(row.calendar_owner_authorized!==true||row.calendar_provider_status==='disabled'||['expired','awaiting_consent','setup'].includes(row.calendar_connection_state)));
  const temperatureMetadata=storedTemperature?{...storedTemperature,...(temperatureAuthorityStale?{status:'stale',freshness:'stale',reason:row.calendar_owner_authorized!==true?'reauthorization_required':row.calendar_provider_status==='disabled'?'provider_disabled':'reauthorization_required'}:row.temperature_sensor_available===false?{status:'unavailable',freshness:'stale',reason:'sensor_missing'}:{})}:undefined;
  return {
    id:row.id,
    ...(options.includeExternalId?{externalId:row.external_id,status:row.status}:{}),
    kind:row.kind,contentLocale:row.content_locale,
    targets:{household:row.target_household,personIds:options.selectedPersonIds?row.person_ids.filter((id)=>options.selectedPersonIds!.includes(id)):row.person_ids,...(options.includeExternalId?{displayIds:row.display_ids}:{})},
    subjects:{personIds:options.selectedPersonIds?row.subject_person_ids.filter((id)=>options.selectedPersonIds!.includes(id)):row.subject_person_ids},
    title:row.title,body:row.body,entries:row.entries,priority:row.priority,
    publishAt:row.publish_at?.toISOString()??null,startsAt:row.starts_at?.toISOString()??null,
    endsAt:row.ends_at?.toISOString()??null,expiresAt:row.expires_at?.toISOString()??null,
    source,metadata:{...metadata,...(calendarMetadata?{calendar:calendarMetadata}:{}),...(temperatureMetadata?{temperature:temperatureMetadata}:{})},revision:row.revision,updatedAt:row.updated_at.toISOString()
  };
}

export const externalItemProjectionColumns=`i.id,i.external_id,i.kind,i.content_locale,i.target_household,i.title,i.body,i.entries,i.priority,
  i.publish_at,i.starts_at,i.ends_at,i.expires_at,i.source,i.metadata,i.status,i.revision,i.updated_at,
  (SELECT calendar.state FROM calendar_connections calendar WHERE calendar.integration_connection_id=i.connection_id) AS calendar_connection_state,
  (SELECT source.last_error_code FROM calendar_occurrences occurrence JOIN calendar_sources source ON source.id=occurrence.source_id WHERE occurrence.integration_item_id=i.id LIMIT 1) AS calendar_source_error_code,
  (SELECT provider.status FROM calendar_connections calendar JOIN households calendar_household ON calendar_household.id=calendar.household_id LEFT JOIN installation_calendar_provider_configs provider ON provider.installation_id=calendar_household.installation_id AND provider.provider=calendar.provider WHERE calendar.integration_connection_id=i.connection_id) AS calendar_provider_status,
  EXISTS(SELECT 1 FROM calendar_connections calendar JOIN memberships calendar_owner ON calendar_owner.account_id=calendar.owner_account_id AND calendar_owner.household_id=calendar.household_id JOIN persons calendar_person ON calendar_person.id=calendar_owner.person_id AND calendar_person.household_id=calendar_owner.household_id AND calendar_person.age_group='adult' JOIN accounts calendar_account ON calendar_account.id=calendar.owner_account_id AND calendar_account.disabled_at IS NULL WHERE calendar.integration_connection_id=i.connection_id AND calendar_owner.capabilities ? 'household.view') AS calendar_owner_authorized,
  (SELECT sensor.available FROM home_assistant_temperature_sensors sensor WHERE sensor.integration_item_id=i.id LIMIT 1) AS temperature_sensor_available,
  COALESCE((SELECT json_agg(t.person_id ORDER BY t.person_id) FROM integration_item_person_targets t WHERE t.item_id=i.id),'[]') AS person_ids,
  COALESCE((SELECT json_agg(t.person_id ORDER BY t.person_id) FROM integration_item_person_subjects t WHERE t.item_id=i.id),'[]') AS subject_person_ids,
  COALESCE((SELECT json_agg(t.display_id ORDER BY t.display_id) FROM integration_item_display_targets t WHERE t.item_id=i.id),'[]') AS display_ids`;

export interface ActivityCursor {at:string;rank:0|1;id:string;}
export interface ActivityRow extends ExternalItemRow {activity_at:Date;activity_person_id:string|null;activity_person_ids:string[];activity_person_colors:Record<string,string>;activity_source_id:string|null;}

export interface DisplayActivityContext {
  id:string; externalItemsEnabled:boolean; cards:string[]; allSources:boolean;
  sourceIds:string[]; calendarSourceIds:string[]; selectedPersonIds:string[];
}
export interface CalendarActivityReadInput {
  householdId:string; personIds:string[]|null; viewer:{personId:string;membershipId:string};
  canViewAll:boolean; from:string; to:string; limit:number; sourceIds?:string[];
  cursor?:ActivityCursor; upcomingOnly?:boolean; display?:DisplayActivityContext;
  requirePersonAudience?:boolean;
}

/** Shared implementation of the calendar half of personActivities. The API
 * and MCP projections use the same source, audience, status and civil-date SQL. */
export async function readCalendarActivityRows(input:CalendarActivityReadInput,client:DbClient=pool,displayWitness?:(displayId:string,people:string,sources:string)=>string):Promise<ActivityRow[]>{
  const {householdId,personIds,viewer,canViewAll,from,to,limit,sourceIds,cursor}=input;
  const calendarCursor=`AND ($9::timestamptz IS NULL OR activity.starts_at>$9::timestamptz OR (activity.starts_at=$9::timestamptz AND $10=0 AND i.id::text>$11))`;
  const display=input.display;
  const displayCalendarSource=`(EXISTS(SELECT 1 FROM calendar_occurrences selected_occurrence WHERE selected_occurrence.integration_item_id=i.id)
      AND ($15::boolean OR EXISTS(SELECT 1 FROM calendar_occurrences selected_occurrence WHERE selected_occurrence.integration_item_id=i.id AND selected_occurrence.source_id=ANY($17::uuid[]))))`;
  const displayGenericSource=`(NOT EXISTS(SELECT 1 FROM calendar_occurrences generic_occurrence WHERE generic_occurrence.integration_item_id=i.id)
      AND ($15::boolean OR connection.id=ANY($16::uuid[])))`;
  const calendar=await client.query<ActivityRow>(`SELECT ${externalItemProjectionColumns},${display?displayWitness?.('$12','$19','$17')??'NULL::text':'NULLIF($19::uuid[],$19::uuid[])::text'} AS acl_witness,activity.starts_at AS activity_at,
      (SELECT min(occurrence.source_id::text)::uuid FROM calendar_occurrences occurrence WHERE occurrence.integration_item_id=i.id AND ($8::uuid[] IS NULL OR occurrence.source_id=ANY($8))) AS activity_source_id,
      (SELECT min(subject.person_id::text)::uuid FROM integration_item_person_subjects subject WHERE subject.item_id=i.id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2))) AS activity_person_id,
      COALESCE((SELECT array_agg(subject.person_id ORDER BY subject.person_id) FROM integration_item_person_subjects subject WHERE subject.item_id=i.id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2))),ARRAY[]::uuid[]) AS activity_person_ids,
      COALESCE((SELECT jsonb_object_agg(subject.person_id::text,person.color_token) FROM integration_item_person_subjects subject JOIN persons person ON person.id=subject.person_id AND person.household_id=i.household_id WHERE subject.item_id=i.id AND ($2::uuid[] IS NULL OR subject.person_id=ANY($2))),'{}'::jsonb) AS activity_person_colors
    FROM integration_items i JOIN integration_connections connection ON connection.id=i.connection_id AND connection.household_id=i.household_id AND connection.revoked_at IS NULL
    JOIN households household ON household.id=i.household_id
    -- Calendar all-day timestamps encode civil dates, not UTC instants. Keep
    -- their stored/returned values, but compare local-midnight boundaries.
    CROSS JOIN LATERAL (SELECT
      CASE WHEN (i.metadata->'calendar' IS NOT NULL OR i.metadata->'haBridge'='true'::jsonb) AND i.metadata->'allDay'='true'::jsonb
        THEN (i.starts_at AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE household.timezone ELSE i.starts_at END AS starts_at,
      CASE WHEN (i.metadata->'calendar' IS NOT NULL OR i.metadata->'haBridge'='true'::jsonb) AND i.metadata->'allDay'='true'::jsonb
        THEN COALESCE((i.ends_at AT TIME ZONE 'UTC')::date,(i.starts_at AT TIME ZONE 'UTC')::date+1)::timestamp AT TIME ZONE household.timezone WHEN i.ends_at=i.starts_at THEN NULL ELSE i.ends_at END AS ends_at) activity
    WHERE i.household_id=$1 AND i.kind IN ('event','reminder') AND i.status='active'
      AND (i.publish_at IS NULL OR i.publish_at<=clock_timestamp()) AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
      AND (activity.ends_at IS NULL AND activity.starts_at >= ($3::date::timestamp AT TIME ZONE household.timezone) OR activity.ends_at > ($3::date::timestamp AT TIME ZONE household.timezone))
      AND activity.starts_at < (($4::date+1)::timestamp AT TIME ZONE household.timezone)
      AND (activity.ends_at IS NULL OR activity.ends_at>activity.starts_at)
      AND (NOT $20::boolean OR EXISTS(SELECT 1 FROM integration_item_person_subjects explicit_person WHERE explicit_person.item_id=i.id AND explicit_person.person_id=ANY($2::uuid[]))
        OR (i.metadata->'calendar' IS NULL AND EXISTS(SELECT 1 FROM integration_item_person_targets explicit_target WHERE explicit_target.item_id=i.id AND explicit_target.person_id=ANY($2::uuid[]))))
      AND ((i.kind='event' AND i.metadata->'calendar' IS NOT NULL AND (COALESCE((i.metadata#>>'{calendar,subjectHousehold}')::boolean,false) OR EXISTS(SELECT 1 FROM integration_item_person_subjects placement WHERE placement.item_id=i.id AND ($2::uuid[] IS NULL OR placement.person_id=ANY($2)))))
        OR (i.kind IN ('event','reminder') AND i.metadata->'calendar' IS NULL AND (i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets placement WHERE placement.item_id=i.id AND ($2::uuid[] IS NULL OR placement.person_id=ANY($2))))))
      AND (($12::uuid IS NULL AND ($5 OR i.target_household OR EXISTS(SELECT 1 FROM integration_item_person_targets readable WHERE readable.item_id=i.id AND readable.person_id=$6)))
        OR ($12::uuid IS NOT NULL AND $13::boolean AND $14::boolean
          AND EXISTS(SELECT 1 FROM integration_connection_display_grants cg WHERE cg.household_id=i.household_id AND cg.connection_id=i.connection_id AND cg.display_id=$12)
          AND EXISTS(SELECT 1 FROM integration_item_display_targets dt WHERE dt.household_id=i.household_id AND dt.item_id=i.id AND dt.display_id=$12)
          AND (${displayCalendarSource} OR ${displayGenericSource})))
      AND ($18::timestamptz IS NULL OR (activity.ends_at IS NULL AND activity.starts_at>=$18::timestamptz OR activity.ends_at>$18::timestamptz))
      AND ($18::timestamptz IS NULL OR COALESCE(i.metadata#>>'{calendar,status}','') NOT IN ('cancelled','canceled','declined'))
      AND ($8::uuid[] IS NULL OR EXISTS(SELECT 1 FROM calendar_occurrences occurrence WHERE occurrence.integration_item_id=i.id AND occurrence.source_id=ANY($8)))
      AND NOT EXISTS(SELECT 1 FROM home_assistant_temperature_sensors hidden_sensor WHERE hidden_sensor.integration_item_id=i.id)
      ${calendarCursor}
    ORDER BY activity.starts_at,i.id LIMIT $7`,[householdId,personIds,from,to,canViewAll,viewer.personId,limit+1,sourceIds??null,cursor?.at??null,cursor?.rank??null,cursor?.id??null,display?.id??null,display?.externalItemsEnabled??false,Boolean(display?.cards.includes('external_items')),display?.allSources??false,display?.sourceIds??[],display?.calendarSourceIds??[],input.upcomingOnly?new Date():null,display?.selectedPersonIds??[],input.requirePersonAudience??false]);
  return calendar.rows;
}
