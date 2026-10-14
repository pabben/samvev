import type { Locale, UpcomingBirthday } from './types';
export interface HubPerson { photoRevision?:number; photo?:import("./types").PersonPhoto|null; avatarKey?: string|null; id: string; displayName: string; ageGroup?: string }
export interface HubItem {
  contentLocale: 'en'|'nb'|null;
  id: string; kind: 'reminder'|'alert'|'event'|'summary'|'list'|'observation';
  subjects?:{personIds:string[]};
  targets: { household: boolean; personIds: string[] }; title: string; body: string;
  entries: { label: string; detail?: string }[]; priority: 'low'|'normal'|'high'|'urgent';
  publishAt: string|null; startsAt: string|null; endsAt: string|null; expiresAt: string|null;
  source: { label: string; url?: string; links?: {label:string;url:string}[]; observedAt:string; generatedAt?:string; uncertainty:'low'|'medium'|'high'|'unknown' };
  metadata: {calendar?:{provider:string;sourceId:string;bridgeKind:string;subjectHousehold:boolean;freshness?:'current'|'stale';lastSuccessfulSyncAt?:string|null;reason?:'sync_failed'|'provider_disabled'|'reauthorization_required'};category?:string;icon?:string;location?:string;allDay?:boolean;actionUrl?:string}; revision:number; updatedAt:string;
}
export interface HubMessage { authorPhoto?:import("./types").PersonPhoto|null; authorAvatarKey?: string|null; authorPersonId?: string|null; id:string;body:string;importance:'normal'|'attention';authorName:string;publishAt:string;expiresAt:string;revision:number;targets?:{household:boolean;personIds:string[]} }
export interface HomeProjection { household:{id:string;name:string;timezone:string;locale:Locale};viewer:{personId:string;membershipId:string};people:HubPerson[];items:HubItem[];messages:HubMessage[];upcomingBirthday:UpcomingBirthday|null;serverNow:string }
export interface IntegrationCredential {id:string;name:string;capabilities:string[];lastUsedAt:string|null;revokedAt:string|null;createdAt:string;revision:number}
export interface IntegrationConnection {id:string;name:string;displayIds:string[];revokedAt:string|null;revision:number;credentials:IntegrationCredential[]}
