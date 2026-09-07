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
  membership_id: string;
  role_preset: string;
  capabilities: string[];
  revision: number;
  has_login: boolean;
  has_active_login?: boolean;
  email: string | null;
  display_ids: string[];
}
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
