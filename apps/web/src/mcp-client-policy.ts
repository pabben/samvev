import { api } from './api';

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
  resources?: { kind: 'school_source'; id: string }[];
};
export type SchoolPlanSource = {
  id: string;
  personId: string;
  connectionId: string;
  connectionName?: string;
  classKey: string;
  sourcePageUrl: string;
  displayPdfLinksAllowed: boolean;
};

const scopeTranslation: Record<string, 'mcpScopeContext' | 'mcpScopeMonitorsRead' | 'mcpScopeSchoolRead' | 'mcpScopeSchoolWrite' | 'mcpScopeOffline' | 'mcpScopePeopleRead' | 'mcpScopeGroceriesRead' | 'mcpScopeDinnersRead'> = {
  context: 'mcpScopeContext', 'mcp:context': 'mcpScopeContext',
  'monitors:read': 'mcpScopeMonitorsRead', 'mcp:monitors:read': 'mcpScopeMonitorsRead',
  'school-plans:read': 'mcpScopeSchoolRead', 'mcp:school-plans:read': 'mcpScopeSchoolRead',
  'school-plans:write': 'mcpScopeSchoolWrite', 'mcp:school-plans:write': 'mcpScopeSchoolWrite',
  offline_access: 'mcpScopeOffline',
  'mcp:people:read': 'mcpScopePeopleRead',
  'mcp:groceries:read': 'mcpScopeGroceriesRead',
  'mcp:dinners:read': 'mcpScopeDinnersRead',
};
const activityTranslation: Record<string,'mcpActivitySchoolSourcesListed'|'mcpActivitySchoolPlansListed'|'mcpActivitySchoolPlanRead'|'mcpActivitySchoolPlanUpserted'|'mcpActivitySchoolSourceFailure'|'mcpActivitySchoolPdfVerified'|'mcpActivityMonitorsListed'>={
  'mcp.school_sources_listed':'mcpActivitySchoolSourcesListed',
  'mcp.school_plans_listed':'mcpActivitySchoolPlansListed',
  'mcp.school_plan_read':'mcpActivitySchoolPlanRead',
  'mcp.school_plan_upserted':'mcpActivitySchoolPlanUpserted',
  'mcp.school_source_failure_recorded':'mcpActivitySchoolSourceFailure',
  'mcp.school_pdf_verified':'mcpActivitySchoolPdfVerified',
  'mcp.monitors_listed':'mcpActivityMonitorsListed',
};

export function mcpScopeTranslationKey(scope: string) {
  return scopeTranslation[scope];
}

export function mcpActivityTranslationKey(action: string) {
  return activityTranslation[action];
}

export function hasMcpSchoolScope(scopes: string[]) {
  return scopes.some(scope => scope === 'mcp:school-plans:read' || scope === 'mcp:school-plans:write' || scope === 'school-plans:read' || scope === 'school-plans:write');
}

export function hasMcpDisplayPolicyScope(scopes: string[]) {
  return hasMcpSchoolScope(scopes) || scopes.includes('mcp:monitors:read') || scopes.includes('monitors:read');
}

export function schoolResourcesForPolicy(existing: NonNullable<McpAuthorization['resources']>, selectedResourceIds: string[], sources: SchoolPlanSource[], selectedPersonIds: string[]) {
  if (sources.some(source => selectedResourceIds.includes(source.id) && !selectedPersonIds.includes(source.personId))) throw new Error('mcp_school_source_person_required');
  const selected = new Set(selectedResourceIds);
  const kept = existing.filter(resource => selected.has(resource.id));
  const existingIds = new Set(existing.map(resource => resource.id));
  const additions = sources.filter(source => selected.has(source.id) && !existingIds.has(source.id)).map(source => ({ kind: 'school_source' as const, id: source.id }));
  return [...kept, ...additions];
}

export function unlistedSchoolResources(existing: NonNullable<McpAuthorization['resources']>, sources: SchoolPlanSource[]) {
  const available = new Set(sources.map(source => source.id));
  return existing.filter(resource => !available.has(resource.id));
}

export async function saveMcpPolicy(base: string, authorization: McpAuthorization, personIds: string[], displayIds: string[], resources = authorization.resources) {
  if (!Array.isArray(resources)) throw new Error('mcp_policy_unavailable');
  return api(`${base}/${encodeURIComponent(authorization.id)}/policy`, 'PUT', {
    expectedRevision: authorization.revision,
    personIds,
    displayIds,
    resources,
  });
}
