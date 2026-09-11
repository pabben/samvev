import type { MonitorTaskLifecycle } from "@samvev/contracts";
export type Locale = "en" | "nb";
export type Theme = "light" | "dark" | "system";
export interface Membership {
  id: string;
  household_id: string;
  person_id: string;
  role_preset: string;
  capabilities: string[];
  revision: number;
  household_name: string;
  timezone: string;
  household_locale: Locale;
  display_name: string;
  display_ids: string[];
}
export interface Me {
  account: { id: string; email: string; locale: Locale; theme: Theme };
  csrfToken: string;
  memberships: Membership[];
}
export interface Person {
  id: string;
  display_name: string;
  age_group: string;
  birth_date?: string | null;
  calculated_age?: number;
  person_revision?: number;
  membership_id: string;
  role_preset: string;
  capabilities: string[];
  revision: number;
  has_login: boolean;
  has_active_login?: boolean;
  account_status?: "profile" | "pending" | "active" | "disabled";
  email: string | null;
  account_id?: string | null;
  account_revision?: number | null;
  display_ids: string[];
}
export interface UpcomingBirthday {
  personId: string;
  displayName: string;
  date: string;
  daysUntil: number;
  ageTurning: number;
}
export interface HouseholdDashboard { upcomingBirthday: UpcomingBirthday | null }
export interface HouseholdSettings { show_upcoming_birthday: boolean; revision: number }
export interface Display {
  id: string;
  name: string;
  locale: Locale;
  theme: Theme;
  privacy_mode: boolean;
  revoked_at: string | null;
  last_seen_at: string | null;
}
export interface Message {
  id: string;
  body: string;
  importance: "normal" | "attention";
  audience_household: boolean;
  publish_at: string;
  expires_at: string;
  state: string;
  revision: number;
  author_name: string;
  author_person_id: string;
  can_edit: boolean;
  activity?: {
    action: "edited" | "withdrawn";
    actorName: string;
    occurredAt: string;
  }[];
  person_ids: string[];
  display_ids: string[];
  deliveries: {
    displayId: string;
    state: string;
    deliveredAt: string | null;
    displayedAt: string | null;
    revision: number | null;
  }[];
}
export interface MonitorTask {
  lifecycle: MonitorTaskLifecycle;
  id:string;name:string;instruction:string;sourceUrl:string;state:'draft'|'active'|'paused';
  checkIntervalMinutes:number;noticeDaysBefore:number;noticeLocalTime:string;providerPolicy:'default'|'local'|'openai';modelTier:'routine'|'strong';
  targets:{personIds:string[];displayIds:string[]};interpretedRule:{resultKind?:'events'|'answer';summary:string;eventTypes:string[];keywords:string[];people:string[];noticeDaysBefore:number;noticeLocalTime:string;checkIntervalMinutes:number}|null;
  events:{date:string;time:string|null;type:string;description:string;actions:string[];who:string[];evidence:{quote:string;sourceUrl:string};confidence:number;uncertainty:string|null}[];
  revision:number;approvedRevision:number|null;lastCheckedAt:string|null;nextCheckAt:string|null;lastResult:string|null;lastChangedAt:string|null;errorCode:string|null;
  stats:{checks:number;aiCalls:number;unchanged:number};
  source?:{finalUrl:string|null};
  latestResult?:Omit<MonitorRunResult,'outcome'>|null;
}
export interface MonitorRunResult {
  outcome:'changed'|'unchanged';resultKind:'events'|'answer'|null;
  result:{answer?:string;events?:MonitorTask['events'];evidence?:{quote:string;sourceUrl:string};confidence?:number;uncertainty?:string|null}|null;
  sourceUrl:string;checkedAt:string;
  sources?:{sourceUrl:string;fetchedAt:string}[];
}
export interface Card {
  id: string;
  kind: string;
  body: string;
  importance: "normal" | "attention";
  author: string;
  publishAt: string;
  expiresAt: string;
  revision: number;
}
export interface Projection {
  display: {
    id: string;
    name: string;
    householdName: string;
    timezone?: string;
    locale: Locale;
    theme: Theme;
    privacyMode: boolean;
  };
  cards: Card[];
  serverNow: string;
  generatedAt: string;
  cacheUntil: string;
  maxStaleSeconds: number;
}
