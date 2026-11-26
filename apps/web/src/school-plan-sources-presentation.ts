import type { SchoolPlanSource } from './mcp-client-policy';

export type CreateSchoolPlanSource = {
  connectionId: string;
  personId: string;
  classKey: string;
  sourcePageUrl: string;
  displayPdfLinksAllowed: boolean;
};

export function createSchoolPlanSourceBody(value: CreateSchoolPlanSource): CreateSchoolPlanSource {
  if (!value.connectionId || !value.personId || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value.classKey)) throw new Error('school_plan_source_fields_invalid');
  let url: URL;
  try { url = new URL(value.sourcePageUrl); } catch { throw new Error('school_plan_source_url_invalid'); }
  if (url.protocol !== 'https:') throw new Error('school_plan_source_url_https_required');
  return { connectionId: value.connectionId, personId: value.personId, classKey: value.classKey, sourcePageUrl: url.href, displayPdfLinksAllowed: value.displayPdfLinksAllowed };
}

export function schoolPlanSourceDisplayName(source: SchoolPlanSource, connections: { id: string; name: string }[]) {
  return source.connectionName ?? connections.find(connection => connection.id === source.connectionId)?.name ?? null;
}
