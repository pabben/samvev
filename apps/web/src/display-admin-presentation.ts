import type { Locale, Theme } from './types';

export type BirthdayMode = 'off'|'all'|'legacy_selected';
export type CalendarReadiness = 'privacy'|'none_selected'|'external_disabled'|'not_shared'|'ready';

export type DisplayReviewAccess = {
  canShareCalendars: boolean;
  selectedCalendarDisplayIds: string[];
  requestedCalendarDisplayIds: string[];
  selectedAlbumReadIds: string[];
  managedAlbumIds: string[];
  requestedAlbumReadIds: string[];
};

/** A review plan never creates grants implicitly: only explicit, authorized opt-ins become writes. */
export function displayReviewAccessPlan(current: DisplayReviewAccess, requested: DisplayReviewAccess) {
  const calendarDenied = !requested.canShareCalendars && requested.requestedCalendarDisplayIds.some(id => !current.selectedCalendarDisplayIds.includes(id));
  const calendarDisplayIds = requested.canShareCalendars
    ? [...new Set(requested.requestedCalendarDisplayIds)]
    : current.selectedCalendarDisplayIds;
  const permittedAlbums = new Set(requested.managedAlbumIds);
  const albumDisplayIds = requested.requestedAlbumReadIds.filter(id => permittedAlbums.has(id));
  const deniedAlbumIds = requested.requestedAlbumReadIds.filter(id => !permittedAlbums.has(id));
  return {
    calendarDisplayIds,
    calendarChanged: !sameIds(current.selectedCalendarDisplayIds, calendarDisplayIds),
    calendarDenied,
    albumDisplayIds,
    albumChangedIds: [...new Set([...current.selectedAlbumReadIds, ...albumDisplayIds])].filter(id => current.selectedAlbumReadIds.includes(id) !== albumDisplayIds.includes(id)),
    deniedAlbumIds,
  };
}

export function displaySetupNeedsPrivateCopy(isDefault: boolean, otherDisplayIds: string[], displaySetupId: string | null|undefined, setupId: string): boolean {
  return isDefault || otherDisplayIds.length > 0 || displaySetupId !== setupId;
}

export function displayActionHasMessageRecipients(policy: { personIds?: string[]; displayIds?: string[] }): boolean {
  return Boolean(policy.personIds?.length || policy.displayIds?.length);
}

export function displayReviewCanApply(confirmed: boolean, deltaCount: number): boolean {
  return confirmed && deltaCount > 0;
}

export function displayCalendarSourceUpdate(source: { revision: number; enabled: boolean; purpose: string; displayName: string|null; bridgeKind: string; syncWindowDays: { past: number; future: number }; appliesTo: { household: boolean; personIds: string[] }; visibility: { household: boolean; personIds: string[]; displayIds: string[] } }, displayId: string, share: boolean) {
  const displayIds = share ? [...new Set([...source.visibility.displayIds, displayId])] : source.visibility.displayIds.filter(id => id !== displayId);
  return { expectedRevision: source.revision, enabled: source.enabled, purpose: source.purpose, displayName: source.displayName, bridgeKind: source.bridgeKind, syncWindowDays: source.syncWindowDays, appliesTo: source.appliesTo, visibility: { ...source.visibility, displayIds } };
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every(id => right.includes(id));
}

export function effectiveDisplayLocale(override: Locale|null|undefined, setupDefault: Locale|undefined, fallback: Locale): Locale {
  return override ?? setupDefault ?? fallback;
}

export function effectiveDisplayTheme(override: Theme|null|undefined, setupDefault: Theme|undefined, fallback: Theme): Theme {
  return override ?? setupDefault ?? fallback;
}

/** Convert the admin select's explicit inheritance choice to the nullable API fields. */
export function displayLocalePatch(selection: Locale|'inherit'): { locale: Locale|null } {
  return { locale: selection === 'inherit' ? null : selection };
}

export function displayThemePatch(selection: Theme|'inherit'): { theme: Theme|null } {
  return { theme: selection === 'inherit' ? null : selection };
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

export function displayFamilyCardPlan(cards: readonly string[], familyLayoutEnabled: boolean, privacyMode: boolean) {
  const familyLayout = cards.includes('family_layout') && familyLayoutEnabled && !privacyMode;
  return { familyLayout, peopleCard: cards.includes('people') && !familyLayout && !privacyMode, rosterInFamilyLayout: familyLayout };
}

export function displayPreviewContentVisible(content: unknown): boolean {
  if (content === null || content === undefined || content === false) return false;
  if (Array.isArray(content)) return content.length > 0;
  return typeof content !== 'string' || content.trim().length > 0;
}

export function displayFamilyContentVisible(familyLayout: boolean, peopleCount: number, messageCount: number, itemCount: number, birthdayCount: number): boolean {
  return familyLayout && (peopleCount > 0 || messageCount > 0 || itemCount > 0 || birthdayCount > 0);
}

export function displayChromePlan(familyDisplay: boolean) {
  return { displayIdentity: !familyDisplay, displayClock: !familyDisplay, familyHero: familyDisplay };
}

export function displayReadinessCard(cards: readonly string[]): 'external_items'|'today'|'tomorrow'|null {
  if (cards.includes('external_items')) return 'external_items';
  if (cards.includes('today')) return 'today';
  if (cards.includes('tomorrow')) return 'tomorrow';
  return null;
}

export function calendarReadinessMessage(status: CalendarReadiness|undefined): 'displayReadinessUnknown'|'displayReadinessPrivacy'|'displayReadinessNoPeople'|'displayReadinessDisabled'|'displayReadinessNotShared'|'displayReadinessReady' {
  if (!status) return 'displayReadinessUnknown';
  return ({ privacy: 'displayReadinessPrivacy', none_selected: 'displayReadinessNoPeople', external_disabled: 'displayReadinessDisabled', not_shared: 'displayReadinessNotShared', ready: 'displayReadinessReady' } as const)[status];
}
