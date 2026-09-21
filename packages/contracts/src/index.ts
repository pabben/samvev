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
export const passwordSchema = z.string().max(128).transform((value)=>value.normalize('NFKC')).pipe(
  z.string().min(8).max(128)
    .regex(/\p{Lu}/u, 'password_uppercase_required')
    .regex(/\p{Nd}/u, 'password_number_required')
);
export const uuidSchema = z.string().uuid();
export const localeSchema = z.enum(locales);
export const themeSchema = z.enum(themes);
export const rolePresetSchema = z.enum(rolePresets);
export const capabilitySchema = z.enum(capabilities);
export const nameSchema = z.string().trim().min(1).max(80);
export const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10);
});

export const claimSchema = z.object({
  claimToken: z.string().min(32).max(256),
  owner: z.object({ displayName: nameSchema, email: emailSchema, password: passwordSchema }),
  household: z.object({ name: nameSchema, timezone: z.string().min(1).max(80), locale: localeSchema.default('nb') }),
  preferences: z.object({ locale: localeSchema.default('nb'), theme: themeSchema })
}).strict();

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const preferencesSchema = z.object({ locale: localeSchema.optional(), theme: themeSchema.optional() }).strict()
  .refine((value) => value.locale !== undefined || value.theme !== undefined);

export const personCreateSchema = z.object({
  displayName: nameSchema,
  birthDate: birthDateSchema.nullable().optional(),
  ageGroup: z.enum(ageGroups).optional(),
  rolePreset: rolePresetSchema,
  capabilities: z.array(capabilitySchema).optional(),
  displayIds: z.array(uuidSchema).default([]),
  login: z.object({
    email: emailSchema,
    loginMethod: z.enum(['password','invitation']).default('password'),
    password: passwordSchema.optional(),
    locale: localeSchema.default('nb'),
    theme: themeSchema.default('system')
  }).strict().refine((value) => value.loginMethod === 'invitation' ? value.password === undefined : value.password !== undefined, 'password_method_mismatch').optional(),
  confirmInstallationOwner: z.literal(true).optional()
}).strict().refine((value) => value.rolePreset !== 'installation_admin' || value.confirmInstallationOwner === true, 'installation_owner_confirmation_required');

export const personUpdateSchema = z.object({
  displayName: nameSchema.optional(),
  birthDate: birthDateSchema.nullable().optional(),
  ageGroup: z.enum(ageGroups).optional(),
  expectedRevision: z.number().int().positive()
}).strict().refine((value) => value.displayName !== undefined || value.birthDate !== undefined || value.ageGroup !== undefined);

const loginSetupSchema = z.object({
  email: emailSchema,
  loginMethod: z.enum(['password','invitation']).default('password'),
  password: passwordSchema.optional(),
  locale: localeSchema.default('nb'),
  theme: themeSchema.default('system')
}).strict().refine((value) => value.loginMethod === 'invitation' ? value.password === undefined : value.password !== undefined, 'password_method_mismatch');

export const personAccountCreateSchema = z.object({
  login: loginSetupSchema,
  rolePreset: rolePresetSchema,
  capabilities: z.array(capabilitySchema).optional(),
  displayIds: z.array(uuidSchema).default([]),
  expectedRevision: z.number().int().positive(),
  confirmInstallationOwner: z.literal(true).optional()
}).strict().refine((value) => value.rolePreset !== 'installation_admin' || value.confirmInstallationOwner === true, 'installation_owner_confirmation_required');

export const membershipUpdateSchema = z.object({
  rolePreset: rolePresetSchema,
  capabilities: z.array(capabilitySchema),
  displayIds: z.array(uuidSchema).default([]),
  expectedRevision: z.number().int().positive(),
  confirmInstallationOwner: z.literal(true).optional()
}).strict();

export const accountStatusUpdateSchema = z.object({
  disabled: z.boolean(),
  expectedRevision: z.number().int().positive()
}).strict();

export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
export const invitationAcceptSchema = z.object({ token: z.string().min(32).max(256), password: passwordSchema }).strict();
export const invitationReissueSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const householdSettingsUpdateSchema = z.object({
  showUpcomingBirthday: z.boolean(),
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
export const aiReasoningEfforts = ['none', 'low', 'medium', 'high'] as const;
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
  maxOutputTokens: z.number().int().min(16).max(8192).optional(),
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
  apiKey: z.string().min(1).max(512).nullable().optional(),
  baseUrl: z.string().trim().max(2048).nullable().optional(),
  defaultModel: z.string().trim().max(100).optional(),
  strongModel: z.string().trim().max(100).optional(),
  defaultReasoningEffort: z.enum(aiReasoningEfforts).optional(),
  strongReasoningEffort: z.enum(aiReasoningEfforts).optional(),
  expectedRevision: z.number().int().nonnegative()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'));

export const aiConnectionTestSchema = z.object({ modelTier: z.enum(aiModelTiers) }).strict();

export const monitorProviderPolicies = ['default', 'local', 'openai'] as const;
export const monitorStates = ['draft', 'active', 'paused'] as const;
const monitorTargetsSchema = z.object({
  personIds: z.array(uuidSchema).max(50).default([]),
  displayIds: z.array(uuidSchema).max(50).default([])
}).strict().refine((value) => value.personIds.length > 0 || value.displayIds.length > 0, 'target_required');

export const monitorTaskCreateSchema = z.object({
  name: nameSchema.optional(),
  instruction: z.string().trim().min(10).max(2000),
  sourceUrl: z.string().trim().max(2048).optional(),
  checkIntervalMinutes: z.number().int().min(15).max(10080).default(1440),
  noticeDaysBefore: z.number().int().min(0).max(30).default(1),
  noticeLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
  targets: monitorTargetsSchema,
  providerPolicy: z.enum(monitorProviderPolicies).default('default'),
  modelTier: z.enum(aiModelTiers).default('routine')
}).strict();

export const monitorTaskUpdateSchema = monitorTaskCreateSchema.partial().extend({
  expectedRevision: z.number().int().positive()
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedRevision'));

export const monitorTaskRevisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const monitorTaskQualitySchema = z.object({
  expectedRevision: z.number().int().positive(),
  quality: z.enum(['standard', 'smarter'])
}).strict();
export const monitorInterpretationSchema = z.object({
  version: z.literal(1),
  resultKind: z.enum(['events', 'answer']).default('events'),
  summary: z.string().trim().min(1).max(500),
  eventTypes: z.array(z.string().trim().min(1).max(80)).max(20),
  keywords: z.array(z.string().trim().min(1).max(80)).max(50),
  people: z.array(z.string().trim().min(1).max(80)).max(20),
  noticeDaysBefore: z.number().int().min(0).max(30),
  noticeLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  checkIntervalMinutes: z.number().int().min(15).max(10080)
}).strict();

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const monitorExtractionSchema = z.object({
  version: z.literal(1),
  events: z.array(z.object({
    date: calendarDateSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    type: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    actions: z.array(z.string().trim().min(1).max(200)).max(20),
    who: z.array(z.string().trim().min(1).max(80)).max(20),
    evidence: z.object({ quote: z.string().trim().min(1).max(500), sourceUrl: z.string().url().max(2048) }).strict(),
    confidence: z.number().min(0).max(1),
    uncertainty: z.string().trim().max(500).nullable()
  }).strict()).max(200)
}).strict();

export const monitorAnswerSchema = z.object({
  version: z.literal(1),
  answer: z.string().trim().min(1).max(4000),
  evidence: z.object({
    quote: z.string().trim().min(1).max(1000),
    sourceUrl: z.string().url().max(2048)
  }).strict(),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string().trim().max(500).nullable()
}).strict();

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
export type AiReasoningEffort = (typeof aiReasoningEfforts)[number];
export type AiProviderId = (typeof aiProviderIds)[number];
export type MonitorProviderPolicy = (typeof monitorProviderPolicies)[number];
export type AiTask = z.infer<typeof aiTaskSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;

export type ErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'CSRF_REQUIRED' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'CONFLICT' | 'REVISION_CONFLICT' | 'RATE_LIMITED' | 'INSTALLATION_CLAIMED'
  | 'CLAIM_EXPIRED' | 'INVITATION_INVALID' | 'INVITATION_EXPIRED' | 'PAIRING_EXPIRED' | 'PAIRING_INVALID' | 'SCHEDULE_INVALID'
  | 'AI_CONFIGURATION_INVALID' | 'AI_DISABLED' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_UPSTREAM_ERROR'
  | 'AI_RESPONSE_INVALID' | 'AI_TIMEOUT' | 'AI_ENDPOINT_BLOCKED'
  | 'MONITOR_SOURCE_UNAVAILABLE' | 'MONITOR_SOURCE_TIMEOUT' | 'MONITOR_SOURCE_TOO_LARGE'
  | 'MONITOR_SOURCE_UNSUPPORTED' | 'MONITOR_SOURCE_REQUIRED' | 'MONITOR_SOURCE_AMBIGUOUS'
  | 'MONITOR_INTERPRETATION_INVALID' | 'MONITOR_OWNER_UNAUTHORIZED' | 'INTERNAL_ERROR';

export interface ApiErrorBody { error: { code: ErrorCode; requestId: string; details?: Record<string, unknown> } }
