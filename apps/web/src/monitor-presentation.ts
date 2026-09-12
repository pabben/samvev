import { ApiError } from "./api";
import type { TranslationKey } from "./locales/en";
import type { MonitorSource } from "./types";

export const taskErrorKey = (error: unknown): TranslationKey => {
  const code = error instanceof ApiError ? error.code : typeof error === 'string' ? error : '';
  if (code === 'MONITOR_LOCATION_REQUIRED') return 'monitorErrorLocationRequired';
  if (code === 'MONITOR_LOCATION_AMBIGUOUS') return 'monitorErrorLocationAmbiguous';
  if (code === 'MONITOR_LOCATION_NOT_FOUND') return 'monitorErrorLocationNotFound';
  if (code === 'MONITOR_WEATHER_UNAVAILABLE') return 'monitorErrorWeatherUnavailable';
  if (code === 'MONITOR_WEATHER_RATE_LIMITED') return 'monitorErrorWeatherRateLimited';
  if (code === 'MONITOR_WEATHER_INVALID') return 'monitorErrorWeatherInvalid';
  if (code === 'MONITOR_WEATHER_DATE_UNAVAILABLE') return 'monitorErrorWeatherDateUnavailable';
  if (code === 'MONITOR_WEATHER_FORBIDDEN' || code === 'MONITOR_WEATHER_CONFIGURATION_INVALID') return 'monitorErrorWeatherConfiguration';
  if (code === 'MONITOR_RUNNING') return 'monitorErrorRunning';
  if (code === 'MONITOR_SETUP_REQUIRED') return 'monitorErrorSetupRequired';
  if (code === 'MONITOR_TARGET_INVALID') return 'monitorErrorTargets';
  if (code === 'NOT_FOUND') return 'monitorErrorNotFound';
  if (code === 'AI_DISABLED') return 'monitorErrorAiDisabled';
  if (code === 'MONITOR_SOURCE_REQUIRED') return 'monitorErrorSourceRequired';
  if (code === 'MONITOR_SOURCE_AMBIGUOUS') return 'monitorErrorSourceAmbiguous';
  if (code === 'AI_ENDPOINT_BLOCKED' || code === 'AI_ENDPOINT_INVALID') return 'monitorErrorSourceBlocked';
  if (code === 'MONITOR_SOURCE_UNSUPPORTED' || code === 'MONITOR_SOURCE_TOO_LARGE') return 'monitorErrorSourceFormat';
  if (code === 'MONITOR_SOURCE_UNAVAILABLE') return 'monitorErrorSourceUnavailable';
  if (code === 'MONITOR_SOURCE_TIMEOUT') return 'monitorErrorSourceTimeout';
  if (code === 'MONITOR_TOOL_INVALID') return 'monitorErrorSourceExplore';
  if (code === 'MONITOR_TOOL_LIMIT') return 'monitorErrorSourceLimit';
  if (code.includes('TIMEOUT') || code === 'OFFLINE') return 'monitorErrorTimeout';
  if (['AI_DISABLED', 'AI_CONFIGURATION_INVALID', 'AI_NOT_CONFIGURED', 'AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_MISMATCH', 'AI_CREDENTIAL_INVALID'].includes(code)) return 'monitorErrorSetup';
  if (code === 'AI_RESPONSE_INVALID' || code === 'AI_COMPOSITION_INVALID') return 'monitorErrorVerification';
  if (code === 'MONITOR_INTERPRETATION_SOURCE_REFUSAL') return 'monitorErrorSourceContext';
  if (code === 'MONITOR_INTERPRETATION_SCHEMA_INVALID' || code === 'MONITOR_INTERPRETATION_INVALID') return 'monitorErrorInterpretation';
  if (code === 'REVISION_CONFLICT' || code === 'CONFLICT') return 'monitorErrorConflict';
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'UNAUTHENTICATED' || code === 'MONITOR_OWNER_UNAUTHORIZED') return 'monitorErrorPermission';
  return 'monitorErrorGeneric';
};

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
export function placeLabel(place?: { canonicalName?: string; municipality?: string | null; region?: string | null; country?: string | null } | null): string {
  return [...new Set([place?.canonicalName, place?.municipality, place?.region, place?.country].filter(Boolean))].join(', ');
}
