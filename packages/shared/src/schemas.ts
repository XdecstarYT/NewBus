import { z } from 'zod';
import { DIFFICULTIES, ROLES, STAFF_TITLES, ACCOUNT_STATUSES, ALL_FLAGS, MODULES } from './constants';
import { permissionsSchema, permissionsPatchSchema } from './permissions';

// ---------- primitives ----------
/** Account numbers are zero-padded digit strings, e.g. "01". Never integers. */
export const accountNumberSchema = z
  .string()
  .trim()
  .transform((v) => (/^\d$/.test(v) ? `0${v}` : v)) // "1" means "01"
  .pipe(z.string().regex(/^\d{2,8}$/, 'Account numbers are 2-8 digits, like "01"'));
export const passwordSchema = z.string().min(4, 'Password must be at least 4 characters').max(128);
export const idSchema = z.string().min(1).max(64);
export const bitsSchema = z.number().int().min(1).max(1_000_000_000_000);
export const idempotencyKeySchema = z.string().min(8).max(100).optional();

// ---------- auth ----------
export const loginSchema = z.object({
  accountNumber: accountNumberSchema,
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const totpEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

// ---------- owner: companies ----------
export const companyDetailsSchema = z.object({
  name: z.string().trim().min(2).max(40),
  emoji: z.string().min(1).max(16),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  slogan: z.string().trim().max(120).default(''),
});

export const createCompanySchema = companyDetailsSchema.extend({
  industryId: z.string().min(1).max(80),
  startingBits: z.number().int().min(0).max(10_000_000),
  startingWorkers: z.number().int().min(0).max(10),
  startingWorkplace: z.number().int().min(0).max(4).default(0),
  difficulty: z.enum(DIFFICULTIES),
  permissions: permissionsSchema,
  accountNumber: accountNumberSchema.optional(),
  password: passwordSchema.optional(),
  mustChangePassword: z.boolean().default(true),
  adminName: z.string().trim().min(1).max(40).default('CEO'),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = companyDetailsSchema.partial().extend({
  status: z.enum(['active', 'suspended', 'archived']).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

export const changeIndustrySchema = z.object({ industryId: z.string().min(1).max(80), confirm: z.literal(true) });

export const bulkActionSchema = z.object({
  companyIds: z.array(idSchema).min(1).max(1000),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('applyTemplate'), templateId: idSchema }),
    z.object({ type: z.literal('grantBits'), amount: z.number().int().min(1).max(1e9), reason: z.string().min(1).max(200) }),
    z.object({ type: z.literal('takeBits'), amount: z.number().int().min(1).max(1e9), reason: z.string().min(1).max(200) }),
    z.object({ type: z.literal('suspend'), suspended: z.boolean() }),
    z.object({ type: z.literal('message'), title: z.string().min(1).max(80), body: z.string().min(1).max(1000) }),
    z.object({ type: z.literal('toggleModule'), module: z.enum(MODULES), enabled: z.boolean() }),
  ]),
});

export const permissionTemplateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: permissionsSchema,
});

export const setPermissionsSchema = z.object({ permissions: permissionsSchema });
export const patchPermissionsSchema = z.object({ patch: permissionsPatchSchema });

// ---------- owner: accounts ----------
export const createAccountSchema = z.object({
  role: z.enum(ROLES).exclude(['OWNER']),
  accountNumber: accountNumberSchema.optional(),
  password: passwordSchema.optional(),
  displayName: z.string().trim().min(1).max(40),
  companyId: idSchema.optional(),
  jobTitle: z.enum(STAFF_TITLES).optional(),
  mustChangePassword: z.boolean().default(true),
  moderatorTools: z.array(z.enum(['mute', 'kick', 'reports', 'audit'])).optional(),
});
export const updateAccountSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(ROLES).exclude(['OWNER']).optional(),
  mustChangePassword: z.boolean().optional(),
  linkedGroup: z.string().trim().max(40).nullable().optional(),
  moderatorTools: z.array(z.enum(['mute', 'kick', 'reports', 'audit'])).optional(),
  jobTitle: z.enum(STAFF_TITLES).nullable().optional(),
});
export const resetPasswordSchema = z.object({ password: passwordSchema.optional(), mustChangePassword: z.boolean().default(true) });

// ---------- staff (company admin) ----------
export const createStaffSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  jobTitle: z.enum(STAFF_TITLES),
  modules: z.record(z.enum(MODULES), z.boolean()),
  password: passwordSchema.optional(),
});
export const updateStaffSchema = z.object({
  modules: z.record(z.enum(MODULES), z.boolean()).optional(),
  jobTitle: z.enum(STAFF_TITLES).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

// ---------- flags & settings ----------
export const setFlagSchema = z.object({ flag: z.enum(ALL_FLAGS as [string, ...string[]]), enabled: z.boolean() });
export const setSettingSchema = z.object({ key: z.string().min(1).max(100), value: z.unknown() });

// ---------- money ----------
export const moneyToolSchema = z.object({
  companyId: idSchema,
  amount: bitsSchema,
  reason: z.string().trim().min(1).max(200),
  idempotencyKey: idempotencyKeySchema,
});
export const transferSchema = z.object({
  toCompanyId: idSchema,
  amount: bitsSchema,
  memo: z.string().trim().max(120).default(''),
  idempotencyKey: idempotencyKeySchema,
});
export const potMoveSchema = z.object({
  from: z.enum(['main', 'payroll', 'savings', 'investing']),
  to: z.enum(['main', 'payroll', 'savings', 'investing']),
  amount: bitsSchema,
  idempotencyKey: idempotencyKeySchema,
});

// ---------- websocket ----------
export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('subscribe'), channel: z.string().min(1).max(80) }),
  z.object({ type: z.literal('unsubscribe'), channel: z.string().min(1).max(80) }),
  z.object({ type: z.literal('chat'), channel: z.string().min(1).max(80), text: z.string().min(1).max(400) }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
