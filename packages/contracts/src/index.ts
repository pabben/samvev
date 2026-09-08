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

export const aiOperations = ['generate', 'extract', 'classify', 'plan'] as const;
export const aiModelTiers = ['routine', 'strong'] as const;
export const aiProviderIds = ['openai', 'chatgpt_subscription', 'openai_compatible', 'gemini'] as const;
export const aiUncertaintyLevels = ['low', 'medium', 'high', 'unknown'] as const;

export const aiSourceEvidenceSchema = z.object({
  url: z.string().url().max(2048),
  observedAt: isoInstant,
  uncertainty: z.enum(aiUncertaintyLevels)
}).strict();

/** Provider-neutral work: provider and concrete model are deliberately absent. */
export const aiTaskSchema = z.object({
  operation: z.enum(aiOperations),
  purpose: z.string().trim().min(1).max(128),
  input: z.string().min(1).max(32_000),
  modelTier: z.enum(aiModelTiers),
  sources: z.array(aiSourceEvidenceSchema).max(20).default([])
}).strict();

export const aiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional()
}).strict();

export const aiResultSchema = z.object({
  output: z.string().min(1).max(32_000),
  generatedAt: isoInstant,
  uncertainty: z.enum(aiUncertaintyLevels),
  sources: z.array(aiSourceEvidenceSchema).max(20),
  usage: aiUsageSchema.optional()
}).strict();

export const aiSettingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(aiProviderIds).optional(),
  apiKey: z.string().min(20).max(512).nullable().optional(),
  defaultModel: z.string().trim().max(100).optional(),
  strongModel: z.string().trim().max(100).optional(),
  expectedRevision: z.number().int().nonnegative()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'));

export const aiConnectionTestSchema = z.object({ modelTier: z.enum(aiModelTiers) }).strict();

/** Reserved for a future authenticated ChatGPT Tasks/MCP connection. No endpoint consumes it in M2.1. */
export const chatGptBridgeInputV1Schema = z.object({
  version: z.literal(1),
  taskId: uuidSchema,
  idempotencyKey: z.string().min(8).max(128),
  task: aiTaskSchema
}).strict();

export const chatGptBridgeResultV1Schema = z.object({
  version: z.literal(1),
  taskId: uuidSchema,
  idempotencyKey: z.string().min(8).max(128),
  result: aiResultSchema
}).strict();

export type AiOperation = (typeof aiOperations)[number];
export type AiModelTier = (typeof aiModelTiers)[number];
export type AiProviderId = (typeof aiProviderIds)[number];
export type AiTask = z.infer<typeof aiTaskSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;

export type ErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'CSRF_REQUIRED' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'CONFLICT' | 'REVISION_CONFLICT' | 'RATE_LIMITED' | 'INSTALLATION_CLAIMED'
  | 'CLAIM_EXPIRED' | 'PAIRING_EXPIRED' | 'PAIRING_INVALID' | 'SCHEDULE_INVALID'
  | 'AI_CONFIGURATION_INVALID' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_UPSTREAM_ERROR'
  | 'AI_RESPONSE_INVALID' | 'AI_TIMEOUT' | 'INTERNAL_ERROR';

export interface ApiErrorBody { error: { code: ErrorCode; requestId: string; details?: Record<string, unknown> } }
