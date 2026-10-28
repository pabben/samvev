import type { Locale, Theme } from './types';

export type BirthdayMode = 'off'|'all'|'legacy_selected';
export type CalendarReadiness = 'privacy'|'none_selected'|'external_disabled'|'not_shared'|'ready';

export function effectiveDisplayLocale(override: Locale|null|undefined, setupDefault: Locale|undefined, fallback: Locale): Locale {
  return override ?? setupDefault ?? fallback;
}

export function effectiveDisplayTheme(override: Theme|null|undefined, setupDefault: Theme|undefined, fallback: Theme): Theme {
  return override ?? setupDefault ?? fallback;
}

export function changedDevicePeople(currentOverride: string[]|null, effectiveIds: string[], personId: string, checked: boolean): { personIdsOverride: string[] } {
  const current = currentOverride ?? effectiveIds;
  const ids = checked ? [...current, personId] : current.filter(id => id !== personId);
  return { personIdsOverride: [...new Set(ids)] };
}

export function selectedDevicePeople(ids: string[]): { personIdsOverride: string[] } {
  return { personIdsOverride: [...new Set(ids)] };
}

export function noDevicePeople(): { personIdsOverride: string[] } {
  return { personIdsOverride: [] };
}

export function inheritDevicePeople(): { personIdsOverride: null } {
  return { personIdsOverride: null };
}

export function birthdayInputState(mode: BirthdayMode): { checked: boolean; mixed: boolean } {
  return { checked: mode === 'all', mixed: mode === 'legacy_selected' };
}

export function birthdayModePatch(mode: 'off'|'all'): { birthdayMode: 'off'|'all' } {
  return { birthdayMode: mode };
}

export function visibleDisplayBirthdays(mode: BirthdayMode|undefined, entries: { personId:string; displayName:string; due:'today'|'tomorrow' }[]): typeof entries {
  return mode === 'off' ? [] : entries;
}

/** A separate People card hides the duplicate roster only, never family-layout birthdays. */
export function familyLayoutBirthdayEntries(mode: BirthdayMode|undefined, entries: { personId:string; displayName:string; due:'today'|'tomorrow' }[], _separatePeopleCard: boolean): typeof entries {
  return visibleDisplayBirthdays(mode, entries);
}

export function calendarReadinessMessage(status: CalendarReadiness|undefined): 'displayReadinessUnknown'|'displayReadinessPrivacy'|'displayReadinessNoPeople'|'displayReadinessDisabled'|'displayReadinessNotShared'|'displayReadinessReady' {
  if (!status) return 'displayReadinessUnknown';
  return ({ privacy: 'displayReadinessPrivacy', none_selected: 'displayReadinessNoPeople', external_disabled: 'displayReadinessDisabled', not_shared: 'displayReadinessNotShared', ready: 'displayReadinessReady' } as const)[status];
}
