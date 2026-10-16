import type { Locale, UpcomingBirthday } from './types';
export type SafeHomeUpcomingBirthday = Omit<UpcomingBirthday,'ageTurning'>;
export interface HubPerson { photoRevision?:number; photo?:import("./types").PersonPhoto|null; avatarKey?: string|null; id: string; displayName: string; ageGroup?: string }
export interface HubItem {
  contentLocale: 'en'|'nb'|null;
  id: string; kind: 'reminder'|'alert'|'event'|'summary'|'list'|'observation';
  subjects?:{personIds:string[]};
  targets: { household: boolean; personIds: string[] }; title: string; body: string;
  entries: { label: string; detail?: string }[]; priority: 'low'|'normal'|'high'|'urgent';
  publishAt: string|null; startsAt: string|null; endsAt: string|null; expiresAt: string|null;
  source: { label: string; url?: string; links?: {label:string;url:string}[]; observedAt:string; generatedAt?:string; uncertainty:'low'|'medium'|'high'|'unknown' };
  metadata: {calendar?:{provider:string;sourceId:string;bridgeKind:string;subjectHousehold:boolean;purpose?:'calendar'|'waste';displayName?:string|null;status?:string;identityKind?:'provider'|'local_snapshot';lastCompleteWindow?:{from:string;to:string}|null;freshness?:'current'|'stale';lastSuccessfulSyncAt?:string|null;reason?:'sync_failed'|'provider_disabled'|'reauthorization_required'};temperature?:{sensorId:string;displayName:string;order?:number;value:number|null;unit:string|null;status:string;freshness:string;reason?:string;lastReportedAt:string|null;lastUpdatedAt:string|null;lastFetchedAt:string|null;measuredAt:null;lastValidValue:number|null;lastValidUnit:string|null;lastValidAt:string|null};category?:string;icon?:string;location?:string;allDay?:boolean;actionUrl?:string}; revision:number; updatedAt:string;
}
export interface HubMessage { authorPhoto?:import("./types").PersonPhoto|null; authorAvatarKey?: string|null; authorPersonId?: string|null; id:string;body:string;importance:'normal'|'attention';authorName:string;publishAt:string;expiresAt:string;revision:number;targets?:{household:boolean;personIds:string[]} }
export interface HomeBirthday { personId:string; displayName:string; due:'today'|'tomorrow' }
export interface HomeSchoolActivity { type:'school'; id:string; taskId:string; personId:string; date:string; time:string|null; kind:string; title:string; actions:string[]; evidence:Record<string,unknown>; confidence:number|null; uncertainty:string|null; sourceUrl:string|null; recordedAt:string|null; expiresAt:string }
export interface SchoolTimelineActivity extends Omit<HomeSchoolActivity,'personId'> { personId?:string|null; personIds:string[]; startsAt:string }
export type HouseholdTimelineActivity = (HubItem & {type:'calendar';personIds:string[]}) | SchoolTimelineActivity;
export interface HomeProjection { household:{id:string;name:string;timezone:string;locale:Locale;localDate?:string};viewer:{personId:string;membershipId:string};people:HubPerson[];items:HubItem[];messages:HubMessage[];upcomingBirthday:SafeHomeUpcomingBirthday|null;upcomingBirthdays?:HomeBirthday[];schoolActivities?:HomeSchoolActivity[];serverNow:string }
export interface IntegrationCredential {id:string;name:string;capabilities:string[];lastUsedAt:string|null;revokedAt:string|null;createdAt:string;revision:number}
export interface IntegrationConnection {id:string;name:string;displayIds:string[];revokedAt:string|null;revision:number;credentials:IntegrationCredential[]}
