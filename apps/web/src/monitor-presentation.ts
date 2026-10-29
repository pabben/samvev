import { ApiError } from "./api";
import type { TranslationKey } from "./locales/en";
import type { MonitorSource } from "./types";

export type SchoolPresentationKind = 'school' | null;
export interface MonitorPresentationUpdateBody {
  expectedPresentationRevision: number;
  presentationKind: SchoolPresentationKind;
  schoolEndLocalTime: string | null;
}

export function monitorPresentationUpdateBody(kind: SchoolPresentationKind, schoolEndLocalTime: string, revision: number): MonitorPresentationUpdateBody {
  if (!Number.isInteger(revision) || revision < 1) throw new Error('Invalid presentation revision');
  if (kind === 'school' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schoolEndLocalTime)) throw new Error('Invalid school end time');
  return { expectedPresentationRevision: revision, presentationKind: kind, schoolEndLocalTime: kind === 'school' ? schoolEndLocalTime : null };
}

export const taskErrorKey = (error: unknown): TranslationKey => {
  const code = error instanceof ApiError ? error.code : typeof error === 'string' ? error : '';
  const details = error instanceof ApiError ? error.details : undefined;
  const validationStage = details?.validationStage;
  const validationReason = details?.validationReason;
  if (validationStage === 'provider_response' && validationReason === 'network_error') return 'monitorErrorProviderNetwork';
  if (validationStage === 'provider_response') return 'monitorErrorProviderResponse';
  if (validationStage === 'final_schema' && ['invalid_json', 'schema_mismatch', 'response_too_large', 'invalid_json_or_schema'].includes(String(validationReason))) return 'monitorErrorResponseFormat';
  if (validationStage === 'evidence_anchor') return 'monitorErrorVerification';
  if (code === 'MONITOR_LOCATION_REQUIRED') return 'monitorErrorLocationRequired';
  if (code === 'MONITOR_LOCATION_AMBIGUOUS') return 'monitorErrorLocationAmbiguous';
  if (code === 'MONITOR_LOCATION_NOT_FOUND') return 'monitorErrorLocationNotFound';
  if (code === 'MONITOR_WEATHER_UNAVAILABLE') return error instanceof ApiError && error.details?.weatherStage === 'location' ? 'monitorErrorLocationUnavailable' : 'monitorErrorWeatherUnavailable';
  if (code === 'MONITOR_WEATHER_RATE_LIMITED') return error instanceof ApiError && error.details?.weatherStage === 'location' ? 'monitorErrorLocationRateLimited' : 'monitorErrorWeatherRateLimited';
  if (code === 'MONITOR_WEATHER_INVALID') return error instanceof ApiError && error.details?.weatherStage === 'location' ? 'monitorErrorLocationInvalid' : 'monitorErrorWeatherInvalid';
  if (code === 'MONITOR_WEATHER_DATE_UNAVAILABLE') return 'monitorErrorWeatherDateUnavailable';
  if (code === 'MONITOR_WEATHER_FORBIDDEN' || code === 'MONITOR_WEATHER_CONFIGURATION_INVALID') return 'monitorErrorWeatherConfiguration';
  if (code === 'MONITOR_RUNNING') return 'monitorErrorRunning';
  if (code === 'MONITOR_SETUP_REQUIRED') return 'monitorErrorSetupRequired';
  if (code === 'MONITOR_TARGET_INVALID') return 'monitorErrorTargets';
  if (code === 'NOT_FOUND') return 'monitorErrorNotFound';
  if (code === 'AI_DISABLED') return 'monitorErrorAiDisabled';
  if (code === 'AI_PLAN_NOT_ELIGIBLE') return 'AI_PLAN_NOT_ELIGIBLE';
  if (code === 'AI_REAUTHORIZATION_REQUIRED' || code === 'AI_PLAN_PERMISSION_REQUIRED') return 'aiPlanReauth';
  if (code === 'AI_PLAN_USAGE_LIMITED') return 'aiPlanLimited';
  if (code === 'MONITOR_SOURCE_REQUIRED') return 'monitorErrorSourceRequired';
  if (code === 'MONITOR_SOURCE_AMBIGUOUS') return 'monitorErrorSourceAmbiguous';
  if (code === 'CALENDAR_SOURCE_USE_ICS') return 'calendarSourceUseIcs';
  if (code === 'AI_ENDPOINT_BLOCKED' || code === 'AI_ENDPOINT_INVALID') return 'monitorErrorSourceBlocked';
  if (code === 'MONITOR_SOURCE_UNSUPPORTED' || code === 'MONITOR_SOURCE_TOO_LARGE') return error instanceof ApiError && error.details?.weatherStage === 'location' ? 'monitorErrorLocationInvalid' : error instanceof ApiError && error.details?.weatherStage === 'forecast' ? 'monitorErrorWeatherInvalid' : 'monitorErrorSourceFormat';
  if (code === 'MONITOR_SOURCE_UNAVAILABLE') return 'monitorErrorSourceUnavailable';
  if (code === 'MONITOR_SOURCE_TIMEOUT') return error instanceof ApiError && error.details?.weatherStage === 'location' ? 'monitorErrorLocationTimeout' : error instanceof ApiError && error.details?.weatherStage === 'forecast' ? 'monitorErrorWeatherTimeout' : 'monitorErrorSourceTimeout';
  if (code === 'MONITOR_TOOL_INVALID') return 'monitorErrorSourceExplore';
  if (code === 'MONITOR_TOOL_LIMIT') return 'monitorErrorSourceLimit';
  if (code === 'OFFLINE') return 'monitorConnectionLost';
  if (code === 'MONITOR_WORKER_INTERRUPTED') return 'monitorErrorInterrupted';
  if (code.includes('TIMEOUT')) return 'monitorErrorTimeout';
  if (['AI_DISABLED', 'AI_CONFIGURATION_INVALID', 'AI_NOT_CONFIGURED', 'AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_MISMATCH', 'AI_CREDENTIAL_INVALID'].includes(code)) return 'monitorErrorSetup';
  if (code === 'AI_COMPOSITION_INVALID') return 'monitorErrorVerification';
  if (code === 'MONITOR_INTERPRETATION_SOURCE_REFUSAL') return 'monitorErrorSourceContext';
  if (code === 'MONITOR_INTERPRETATION_SCHEMA_INVALID' || code === 'MONITOR_INTERPRETATION_INVALID') return 'monitorErrorInterpretation';
  if (code === 'REVISION_CONFLICT' || code === 'CONFLICT') return 'monitorErrorConflict';
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'UNAUTHENTICATED' || code === 'MONITOR_OWNER_UNAUTHORIZED') return 'monitorErrorPermission';
  return 'monitorErrorGeneric';
};

const validationIssueCodes = new Set(['invalid_type', 'too_small', 'too_big', 'invalid_format', 'unrecognized_keys', 'invalid_value', 'invalid_union', 'custom', 'not_multiple_of']);
const validationIssuePaths = new Set([
  '$', 'summary', 'answer', 'events', 'events[].date', 'events[].time', 'events[].type',
  'events[].description', 'events[].evidence.quote', 'events[].evidence.sourceUrl',
  'events[].evidence.claims', 'evidence.quote', 'evidence.sourceUrl', 'evidence.claims',
  'schedule.localTime', 'noticeLocalTime', 'checkIntervalMinutes', 'noticeDaysBefore',
]);
const issueFieldKeys: Record<string, TranslationKey> = {
  '$': 'monitorIssueFieldResponse', summary: 'monitorIssueFieldSummary', answer: 'monitorIssueFieldAnswer',
  events: 'monitorIssueFieldEvents', 'events[].date': 'monitorIssueFieldDate', 'events[].time': 'monitorIssueFieldTime',
  'events[].type': 'monitorIssueFieldType', 'events[].description': 'monitorIssueFieldDescription',
  'events[].evidence.quote': 'monitorIssueFieldQuote', 'events[].evidence.sourceUrl': 'monitorIssueFieldSource',
  'events[].evidence.claims': 'monitorIssueFieldClaims', 'evidence.quote': 'monitorIssueFieldQuote',
  'evidence.sourceUrl': 'monitorIssueFieldSource', 'evidence.claims': 'monitorIssueFieldClaims',
  'schedule.localTime': 'monitorIssueFieldTime', noticeLocalTime: 'monitorIssueFieldTime',
  checkIntervalMinutes: 'monitorIssueFieldSchedule', noticeDaysBefore: 'monitorIssueFieldSchedule',
};
const issueCodeKeys: Record<string, TranslationKey> = {
  invalid_type: 'monitorIssueCodeType', too_small: 'monitorIssueCodeRequired', too_big: 'monitorIssueCodeLimit',
  invalid_format: 'monitorIssueCodeFormat', unrecognized_keys: 'monitorIssueCodeUnexpected',
  invalid_value: 'monitorIssueCodeValue', invalid_union: 'monitorIssueCodeValue', custom: 'monitorIssueCodeValue',
  not_multiple_of: 'monitorIssueCodeValue',
};

/** Project only the sanitized, allowlisted field and code summary to UI copy. */
export function monitorValidationIssues(details: Record<string, unknown> | undefined): { field: TranslationKey; issue: TranslationKey }[] {
  if (!Array.isArray(details?.validationIssues)) return [];
  const seen = new Set<string>();
  return details.validationIssues.slice(0, 8).flatMap((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.path !== 'string' || !validationIssuePaths.has(row.path) || typeof row.code !== 'string' || !validationIssueCodes.has(row.code)) return [];
    const key = `${row.path}:${row.code}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ field: issueFieldKeys[row.path] ?? 'monitorIssueFieldOther', issue: issueCodeKeys[row.code] ?? 'monitorIssueCodeValue' }];
  });
}

export function monitorResultNotice(execution: { status: string; resultSummary?: unknown } | null | undefined, hasPreviousResult: boolean): 'success_no_findings' | 'stale_previous_success' | null {
  if (execution?.status === 'failed' && hasPreviousResult) return 'stale_previous_success';
  if (execution?.status !== 'succeeded' || !execution.resultSummary || typeof execution.resultSummary !== 'object') return null;
  const summary = execution.resultSummary as { outcome?: unknown; resultKind?: unknown; result?: unknown };
  if (summary.outcome !== 'changed' || summary.resultKind !== 'events' || !summary.result || typeof summary.result !== 'object') return null;
  const result = summary.result as { events?: unknown };
  return Array.isArray(result.events) && result.events.length === 0 ? 'success_no_findings' : null;
}

export function monitorResultNoticeKey(notice: 'success_no_findings' | 'stale_previous_success' | null): TranslationKey | null {
  if (notice === 'success_no_findings') return 'monitorNoFindingsSuccess';
  if (notice === 'stale_previous_success') return 'monitorPreviousResultStale';
  return null;
}

/** Error details are untrusted. Show only bounded, human-readable place fields. */
export function locationCandidates(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'MONITOR_LOCATION_AMBIGUOUS' || !Array.isArray(error.details?.candidates)) return [];
  return [...new Set(error.details.candidates.slice(0, 5).flatMap((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const place = candidate as Record<string, unknown>;
    if (typeof place.name !== 'string' || !place.name.trim() || place.name.length > 200) return [];
    return [[...new Set([place.name, place.municipality, place.region].filter((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200))].join(', ')];
  }))];
}

export function isWeatherSource(source: MonitorSource): boolean {
  return source.kind === 'weather' || source.attribution === 'MET Norway Locationforecast';
}
export function shouldShowAnswerEvidence(sources: MonitorSource[]): boolean {
  return sources.length !== 1 || !isWeatherSource(sources[0]!);
}
export function placeLabel(place?: { canonicalName?: string; municipality?: string | null; region?: string | null; country?: string | null } | null): string {
  return [...new Set([place?.canonicalName, place?.municipality, place?.region, place?.country].filter(Boolean))].join(', ');
}
