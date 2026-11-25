import { ApiError } from './api';

export const calendarSyncIntervals = [5, 15, 30] as const;
export type CalendarSyncInterval = typeof calendarSyncIntervals[number];

export function calendarSchedulePath(base: string, connectionId: string) {
  return `${base}/${encodeURIComponent(connectionId)}/sync-schedule`;
}

export function calendarSchedulePayload(revision: number, syncIntervalMinutes: CalendarSyncInterval) {
  return { expectedRevision: revision, syncIntervalMinutes };
}

export function calendarScheduleConflict(error: unknown): ApiError | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  return new ApiError(
    error.details?.reason === 'calendar_sync_in_progress'
      ? 'calendarScheduleAfterSync'
      : 'calendarScheduleConflict',
    409,
  );
}
