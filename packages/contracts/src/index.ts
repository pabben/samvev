import { z } from 'zod';

export const locales = ['en', 'nb'] as const;
export const themes = ['light', 'dark', 'system'] as const;
export const ageGroups = ['adult', 'teen', 'child', 'unspecified'] as const;
export const rolePresets = ['installation_admin', 'household_admin', 'member', 'limited'] as const;
export const capabilities = [
  'installation.manage', 'household.view', 'household.manage', 'people.manage',
  'account.manage', 'capability.manage', 'message.create.household',
  'message.publish.display', 'message.schedule', 'message.manage.household',
  'display.manage'
] as const;
export type Capability = (typeof capabilities)[number];
export type Locale = (typeof locales)[number];
export type Theme = (typeof themes)[number];

export const roleCapabilityPresets: Record<(typeof rolePresets)[number], Capability[]> = {
  installation_admin: [...capabilities],
  household_admin: capabilities.filter((value) => value !== 'installation.manage'),
  member: ['household.view', 'message.create.household', 'message.publish.display', 'message.schedule'],
  limited: ['household.view']
};

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const uuidSchema = z.string().uuid();
export const localeSchema = z.enum(locales);
export const themeSchema = z.enum(themes);
export const rolePresetSchema = z.enum(rolePresets);
export const capabilitySchema = z.enum(capabilities);
export const nameSchema = z.string().trim().min(1).max(80);

export const claimSchema = z.object({
  claimToken: z.string().min(32).max(256),
  owner: z.object({ displayName: nameSchema, email: emailSchema, password: passwordSchema }),
  household: z.object({ name: nameSchema, timezone: z.string().min(1).max(80), locale: localeSchema }),
  preferences: z.object({ locale: localeSchema, theme: themeSchema })
}).strict();

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const preferencesSchema = z.object({ locale: localeSchema.optional(), theme: themeSchema.optional() }).strict()
  .refine((value) => value.locale !== undefined || value.theme !== undefined);

export const personCreateSchema = z.object({
  displayName: nameSchema,
  ageGroup: z.enum(ageGroups).default('unspecified'),
  rolePreset: rolePresetSchema,
  capabilities: z.array(capabilitySchema).optional(),
  displayIds: z.array(uuidSchema).default([]),
  login: z.object({ email: emailSchema, password: passwordSchema, locale: localeSchema, theme: themeSchema }).optional()
}).strict();

export const membershipUpdateSchema = z.object({
  rolePreset: rolePresetSchema,
  capabilities: z.array(capabilitySchema),
  displayIds: z.array(uuidSchema).default([]),
  expectedRevision: z.number().int().positive()
}).strict();

const isoInstant = z.string().datetime({ offset: true });
export const messageCreateSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  importance: z.enum(['normal', 'attention']).default('normal'),
  audience: z.object({
    household: z.boolean().default(false),
    personIds: z.array(uuidSchema).max(50).default([]),
    displayIds: z.array(uuidSchema).max(50).default([])
  }).strict().refine((a) => a.household || a.personIds.length > 0 || a.displayIds.length > 0, 'audience_required'),
  publishAt: isoInstant.optional(),
  expiresAt: isoInstant,
  idempotencyKey: z.string().min(8).max(128)
}).strict();

export const messageUpdateSchema = z.object({
  body: z.string().trim().min(1).max(1000).optional(),
  importance: z.enum(['normal', 'attention']).optional(),
  audience: z.object({ household: z.boolean().default(false), personIds: z.array(uuidSchema).max(50).default([]), displayIds: z.array(uuidSchema).max(50).default([]) }).strict().optional(),
  publishAt: isoInstant.optional(),
  expiresAt: isoInstant.optional(),
  expectedRevision: z.number().int().positive()
}).strict();

export const pairingStartSchema = z.object({ verifierHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const pairingApproveSchema = z.object({
  code: z.string().regex(/^\d{6}$/), name: nameSchema, locale: localeSchema, theme: themeSchema,
  privacyMode: z.boolean().default(false), allowedContent: z.enum(['household_messages']).default('household_messages')
}).strict();
export const pairingRedeemSchema = z.object({ pairingId: uuidSchema, verifier: z.string().min(43).max(256) }).strict();
export const displayUpdateSchema = z.object({
  locale: localeSchema.optional(), theme: themeSchema.optional(), privacyMode: z.boolean().optional(), revoked: z.literal(true).optional()
}).strict().refine((value) => Object.keys(value).length > 0);
export const renderAckSchema = z.object({ cardId: uuidSchema, revision: z.number().int().positive(), renderedAt: isoInstant }).strict();

export type ErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'CSRF_REQUIRED' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'CONFLICT' | 'REVISION_CONFLICT' | 'RATE_LIMITED' | 'INSTALLATION_CLAIMED'
  | 'CLAIM_EXPIRED' | 'PAIRING_EXPIRED' | 'PAIRING_INVALID' | 'SCHEDULE_INVALID' | 'INTERNAL_ERROR';

export interface ApiErrorBody { error: { code: ErrorCode; requestId: string; details?: Record<string, unknown> } }
