import { api } from './api';
import type { CalendarConnection } from './calendar-connection-types';
import { calendarProviderKey } from './calendar-provider-config';

export type McpAuthorization = {
  id: string;
  client_name: string;
  scopes: string[];
  revision: number;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  person_ids?: string[];
  display_ids?: string[];
  resources?: McpPolicyResource[];
};
export type McpPolicyResource={kind:'school_source'|'calendar_source'|'native_calendar';id:string};
export function approvedMcpResourceCount(authorization:McpAuthorization,kind:McpPolicyResource['kind']){
  return (authorization.resources??[]).filter(resource=>resource.kind===kind).length;
}
export type SchoolPlanSource = {
  id: string;
  personId: string;
  connectionId: string;
  connectionName?: string;
  classKey: string;
  sourcePageUrl: string;
  displayPdfLinksAllowed: boolean;
};
export type McpCalendarSource = {id:string;connectionId:string;connectionName:string;accountLabel:string|null;provider:CalendarConnection['provider'];connectionState:string;enabled:boolean;purpose:'calendar'|'waste';name:string;displayName:string|null};

const scopeTranslation: Record<string, 'mcpScopeContext' | 'mcpScopeMonitorsRead' | 'mcpScopeMonitorsContent' | 'mcpScopeSchoolRead' | 'mcpScopeSchoolWrite' | 'mcpScopeOffline' | 'mcpScopePeopleRead' | 'mcpScopePeopleWrite' | 'mcpScopeDisplaysRead' | 'mcpScopeDisplaysAppearanceWrite' | 'mcpScopeMessagesRead' | 'mcpScopeMessagesWrite' | 'mcpScopeGroceriesRead' | 'mcpScopeGroceriesWrite' | 'mcpScopeDinnersRead' | 'mcpScopeDinnersWrite' | 'mcpScopeCalendarRead' | 'mcpScopeCalendarWrite'> = {
  context: 'mcpScopeContext', 'mcp:context': 'mcpScopeContext',
  'monitors:read': 'mcpScopeMonitorsRead', 'mcp:monitors:read': 'mcpScopeMonitorsRead',
  'mcp:monitors:content': 'mcpScopeMonitorsContent',
  'school-plans:read': 'mcpScopeSchoolRead', 'mcp:school-plans:read': 'mcpScopeSchoolRead',
  'school-plans:write': 'mcpScopeSchoolWrite', 'mcp:school-plans:write': 'mcpScopeSchoolWrite',
  offline_access: 'mcpScopeOffline',
  'mcp:people:read': 'mcpScopePeopleRead',
  'mcp:people:write': 'mcpScopePeopleWrite',
  'mcp:displays:read': 'mcpScopeDisplaysRead',
  'mcp:displays:appearance:write': 'mcpScopeDisplaysAppearanceWrite',
  'mcp:messages:read': 'mcpScopeMessagesRead',
  'mcp:messages:write': 'mcpScopeMessagesWrite',
  'mcp:groceries:read': 'mcpScopeGroceriesRead',
  'mcp:groceries:write': 'mcpScopeGroceriesWrite',
  'mcp:dinners:read': 'mcpScopeDinnersRead',
  'mcp:dinners:write': 'mcpScopeDinnersWrite',
  'mcp:calendar:read': 'mcpScopeCalendarRead',
  'mcp:calendar:write': 'mcpScopeCalendarWrite',
};
const activityTranslation: Record<string,'mcpActivitySchoolSourcesListed'|'mcpActivitySchoolPlansListed'|'mcpActivitySchoolPlanRead'|'mcpActivitySchoolPlanUpserted'|'mcpActivitySchoolSourceFailure'|'mcpActivitySchoolPdfVerified'|'mcpActivityMonitorsListed'|'mcpActivityMonitorRead'|'mcpActivityMonitorRunsListed'|'mcpActivityMonitorResultRead'|'mcpActivityMessagesListed'|'mcpActivityMessageCreated'|'mcpActivityMessageEdited'|'mcpActivityMessageEditedByAdmin'|'mcpActivityMessageWithdrawn'|'mcpActivityGroceriesListed'|'mcpActivityGroceryAdded'|'mcpActivityGroceryUpdated'|'mcpActivityGroceryDeleted'|'mcpActivityDinnersListed'|'mcpActivityDinnerOptionsListed'|'mcpActivityDinnerAssigned'|'mcpActivityCalendarSourcesListed'|'mcpActivityDisplaysListed'|'mcpActivityDisplayAppearanceUpdated'|'mcpActivityCalendarEventCreated'|'mcpActivityCalendarEventUpdated'|'mcpActivityCalendarEventDeleted'>={
  'mcp.school_sources_listed':'mcpActivitySchoolSourcesListed',
  'mcp.school_plans_listed':'mcpActivitySchoolPlansListed',
  'mcp.school_plan_read':'mcpActivitySchoolPlanRead',
  'mcp.school_plan_upserted':'mcpActivitySchoolPlanUpserted',
  'mcp.school_source_failure_recorded':'mcpActivitySchoolSourceFailure',
  'mcp.school_pdf_verified':'mcpActivitySchoolPdfVerified',
  'mcp.monitors_listed':'mcpActivityMonitorsListed',
  'mcp.monitor_read':'mcpActivityMonitorRead',
  'mcp.monitor_runs_listed':'mcpActivityMonitorRunsListed',
  'mcp.monitor_result_read':'mcpActivityMonitorResultRead',
  'mcp.messages_listed':'mcpActivityMessagesListed',
  'mcp.message_created':'mcpActivityMessageCreated',
  'mcp.message_edited':'mcpActivityMessageEdited',
  'message.edited_by_admin':'mcpActivityMessageEditedByAdmin',
  'mcp.message_withdrawn':'mcpActivityMessageWithdrawn',
  'mcp.groceries_listed':'mcpActivityGroceriesListed',
  'mcp.grocery_added':'mcpActivityGroceryAdded',
  'mcp.grocery_updated':'mcpActivityGroceryUpdated',
  'mcp.grocery_deleted':'mcpActivityGroceryDeleted',
  'mcp.dinners_listed':'mcpActivityDinnersListed',
  'mcp.calendar_sources_listed':'mcpActivityCalendarSourcesListed',
  'mcp.calendar_event_created':'mcpActivityCalendarEventCreated',
  'mcp.calendar_event_updated':'mcpActivityCalendarEventUpdated',
  'mcp.calendar_event_deleted':'mcpActivityCalendarEventDeleted',
  'mcp.displays_listed':'mcpActivityDisplaysListed',
  'mcp.display_appearance_updated':'mcpActivityDisplayAppearanceUpdated',
  'mcp.dinner_options_listed':'mcpActivityDinnerOptionsListed',
  'mcp.dinner_assigned':'mcpActivityDinnerAssigned',
};

export function mcpScopeTranslationKey(scope: string) {
  return scopeTranslation[scope];
}

export function hasMcpMonitorContentScope(scopes: readonly string[]) {
  return scopes.includes('mcp:monitors:content');
}

export function mcpActivityTranslationKey(action: string) {
  return activityTranslation[action];
}

export function hasMcpSchoolScope(scopes: string[]) {
  return scopes.some(scope => scope === 'mcp:school-plans:read' || scope === 'mcp:school-plans:write' || scope === 'school-plans:read' || scope === 'school-plans:write');
}

export function hasMcpPeoplePolicyScope(scopes: string[]) {
  return hasMcpSchoolScope(scopes) || scopes.some(scope=>['mcp:calendar:read','mcp:people:read','mcp:people:write','mcp:messages:read','mcp:messages:write'].includes(scope));
}

export function hasMcpDisplayPolicyScope(scopes: string[]) {
  return hasMcpSchoolScope(scopes) || scopes.includes('mcp:messages:write') || scopes.includes('mcp:displays:read');
}

export function calendarSourcesForPolicy(connections:CalendarConnection[]):McpCalendarSource[]{
  return calendarSourceRecords(connections).filter(source=>source.connectionState==='connected'&&source.enabled&&source.purpose==='calendar');
}

export function calendarSourceRecords(connections:CalendarConnection[]):McpCalendarSource[]{
  return connections.flatMap(connection=>connection.sources.filter(source=>source.purpose==='calendar').map(source=>({id:source.id,connectionId:connection.id,connectionName:connection.name,accountLabel:connection.accountLabel,provider:connection.provider,connectionState:connection.state,enabled:source.enabled,purpose:source.purpose,name:source.name,displayName:source.displayName}))).sort((a,b)=>`${a.connectionName} ${a.accountLabel??''} ${a.displayName??a.name}`.localeCompare(`${b.connectionName} ${b.accountLabel??''} ${b.displayName??b.name}`));
}

export function calendarProviderTranslationKey(provider:CalendarConnection['provider']){
  return calendarProviderKey(provider);
}

export function calendarSourcePolicyLabel(source:McpCalendarSource){
  return [source.connectionName,source.accountLabel,source.displayName??source.name].filter(Boolean).join(' · ');
}

export function isValidMcpScopeNarrowing(originalScopes: string[], selectedScopes: string[]) {
  return selectedScopes.length > 0 && selectedScopes.every(scope => originalScopes.includes(scope)) && selectedScopes.some(scope => scope !== 'offline_access');
}

export function schoolResourcesForPolicy(existing: NonNullable<McpAuthorization['resources']>, selectedResourceIds: string[], sources: SchoolPlanSource[], selectedPersonIds: string[]) {
  if (sources.some(source => selectedResourceIds.includes(source.id) && !selectedPersonIds.includes(source.personId))) throw new Error('mcp_school_source_person_required');
  const selected = new Set(selectedResourceIds);
  const kept = existing.filter(resource => resource.kind!=='school_source'||selected.has(resource.id));
  const existingIds = new Set(existing.filter(resource=>resource.kind==='school_source').map(resource => resource.id));
  const additions = sources.filter(source => selected.has(source.id) && !existingIds.has(source.id)).map(source => ({ kind: 'school_source' as const, id: source.id }));
  return [...kept, ...additions];
}

export function unlistedSchoolResources(existing: NonNullable<McpAuthorization['resources']>, sources: SchoolPlanSource[]) {
  const available = new Set(sources.map(source => source.id));
  return existing.filter(resource => resource.kind==='school_source'&&!available.has(resource.id));
}

export function calendarResourcesForPolicy(existing:NonNullable<McpAuthorization['resources']>,selectedResourceIds:string[],sources:McpCalendarSource[],selectedPersonIds:string[]){
  if(selectedResourceIds.length&&selectedPersonIds.length===0)throw new Error('mcp_calendar_source_requires_people');
  const selected=new Set(selectedResourceIds);
  const kept=existing.filter(resource=>resource.kind!=='calendar_source'||selected.has(resource.id));
  const existingIds=new Set(existing.filter(resource=>resource.kind==='calendar_source').map(resource=>resource.id));
  const additions=sources.filter(source=>selected.has(source.id)&&!existingIds.has(source.id)).map(source=>({kind:'calendar_source' as const,id:source.id}));
  return [...kept,...additions];
}

export function unlistedCalendarResources(existing:NonNullable<McpAuthorization['resources']>,sources:McpCalendarSource[]){
  const available=new Set(sources.map(source=>source.id));
  return existing.filter(resource=>resource.kind==='calendar_source'&&!available.has(resource.id));
}

export async function saveMcpPolicy(base: string, authorization: McpAuthorization, personIds: string[], displayIds: string[], resources = authorization.resources, scopes?: string[]) {
  if (!Array.isArray(resources)) throw new Error('mcp_policy_unavailable');
  if (scopes && !isValidMcpScopeNarrowing(authorization.scopes, scopes)) throw new Error('mcp_scope_selection_invalid');
  const body: {expectedRevision:number;personIds:string[];displayIds:string[];resources:NonNullable<McpAuthorization['resources']>;scopes?:string[]} = {
    expectedRevision: authorization.revision,
    personIds,
    displayIds,
    resources,
  };
  if (scopes) body.scopes = scopes;
  return api(`${base}/${encodeURIComponent(authorization.id)}/policy`, 'PUT', body);
}
