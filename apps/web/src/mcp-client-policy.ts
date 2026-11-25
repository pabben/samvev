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

const scopeTranslation: Record<string, 'mcpScopeContext' | 'mcpScopeMonitorsRead' | 'mcpScopeSchoolRead' | 'mcpScopeSchoolWrite' | 'mcpScopeOffline'> = {
  context: 'mcpScopeContext', 'mcp:context': 'mcpScopeContext',
  'monitors:read': 'mcpScopeMonitorsRead', 'mcp:monitors:read': 'mcpScopeMonitorsRead',
  'school-plans:read': 'mcpScopeSchoolRead', 'mcp:school-plans:read': 'mcpScopeSchoolRead',
  'school-plans:write': 'mcpScopeSchoolWrite', 'mcp:school-plans:write': 'mcpScopeSchoolWrite',
  offline_access: 'mcpScopeOffline',
};

export function mcpScopeTranslationKey(scope: string) {
  return scopeTranslation[scope];
}

export async function saveMcpPolicy(base: string, authorization: McpAuthorization, personIds: string[], displayIds: string[]) {
  if (!Array.isArray(authorization.resources)) throw new Error('mcp_policy_unavailable');
  return api(`${base}/${encodeURIComponent(authorization.id)}/policy`, 'PUT', {
    expectedRevision: authorization.revision,
    personIds,
    displayIds,
    resources: authorization.resources,
  });
}
