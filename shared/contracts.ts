import { defineRpc, defineSettings, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "connection",
  scope: "host",
  version: 1,
  schema: z.object({
    serverUrl: z.string().trim().url().regex(/^https?:\/\/[^@?#\s]+$/, "Use an HTTP or HTTPS URL without credentials, a query, or a fragment.").default("http://127.0.0.1:2455"),
    refreshSeconds: z.number().int().min(15).max(300).default(30),
    timeframe: z.enum(["1d", "7d", "30d"]).default("7d"),
    hideAccountNames: z.boolean().default(false),
  }),
});
export type Preferences = z.output<typeof preferences.schema>;

const nullableNumber = z.number().finite().nullish().transform((v) => v ?? null);
const nullableString = z.string().nullish().transform((v) => v ?? null);

export const sessionSchema = z.object({
  authenticated: z.boolean(),
  passwordRequired: z.boolean().default(true),
  totpRequiredOnLogin: z.boolean().default(false),
  passwordSessionActive: z.boolean().default(false),
  guestAccessEnabled: z.boolean().default(false),
  guestPasswordRequired: z.boolean().default(false),
  bootstrapRequired: z.boolean().default(false),
  role: z.string().default("unknown"),
  permissions: z.array(z.string()).default([]),
  mustChangePassword: z.boolean().default(false),
  totpEnrollmentRequired: z.boolean().default(false),
  login: z.object({ usernameField: z.string().optional() }).nullish(),
});
export type Session = z.output<typeof sessionSchema>;

export const accountSchema = z.object({
  accountId: z.string(),
  email: z.string().default(""),
  alias: nullableString,
  displayName: z.string().default(""),
  planType: z.string().default("unknown"),
  routingPolicy: z.string().default("normal"),
  status: z.string(),
  usage: z.object({
    primaryRemainingPercent: nullableNumber,
    secondaryRemainingPercent: nullableNumber,
    monthlyRemainingPercent: nullableNumber,
  }).nullish().transform((v) => v ?? null),
  resetAtPrimary: nullableString,
  resetAtSecondary: nullableString,
  resetAtMonthly: nullableString,
  windowMinutesPrimary: nullableNumber,
  windowMinutesSecondary: nullableNumber,
  windowMinutesMonthly: nullableNumber,
  capacityCreditsPrimary: nullableNumber,
  capacityCreditsSecondary: nullableNumber,
  capacityCreditsMonthly: nullableNumber,
  remainingCreditsPrimary: nullableNumber,
  remainingCreditsSecondary: nullableNumber,
  remainingCreditsMonthly: nullableNumber,
  availableResetCredits: z.number().int().nonnegative().default(0),
  resetCreditNearestExpiresAt: nullableString,
  creditsHas: z.boolean().nullish(),
  creditsUnlimited: z.boolean().nullish(),
  creditsBalance: nullableNumber,
  limitWarmupEnabled: z.boolean().default(false),
});
export type Account = z.output<typeof accountSchema>;

export const overviewSchema = z.object({
  accounts: z.array(accountSchema),
  lastSyncAt: nullableString,
  summary: z.object({
    cost: z.object({ totalUsd: nullableNumber }).nullish(),
    metrics: z.object({
      requests: nullableNumber,
      tokens: nullableNumber,
      cachedInputTokens: nullableNumber,
      errorRate: nullableNumber,
    }).nullish(),
  }).nullish(),
  trends: z.object({
    tokens: z.array(z.object({ t: z.string(), v: z.number().finite() })).optional(),
  }).nullish(),
});
export type Overview = z.output<typeof overviewSchema>;

export const snapshotSchema = z.object({
  serverUrl: z.string(),
  timeframe: z.enum(["1d", "7d", "30d"]),
  state: z.enum(["connected", "sign-in", "totp", "offline", "error"]),
  session: sessionSchema.nullable(),
  overview: overviewSchema.nullable(),
  fetchedAt: z.string().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
  serverVersion: z.string().nullable(),
  savedLoginAvailable: z.boolean(),
  credentialStore: z.enum(["keychain", "none"]),
  hasSavedLogin: z.boolean(),
  credentialError: z.string().nullable(),
});
export type Snapshot = z.output<typeof snapshotSchema>;

export const snapshotRpc = defineRpc({
  name: "lb.snapshot",
  input: z.object({ refresh: z.boolean().default(false) }),
  output: snapshotSchema,
});
export const loginRpc = defineRpc({
  name: "lb.login",
  input: z.object({
    serverUrl: z.string(),
    method: z.enum(["password", "guest", "totp", "statusbar", "saved"]),
    role: z.enum(["admin", "guest"]).default("admin"),
    remember: z.boolean().default(true),
    username: z.string().max(64).optional(),
    password: z.string().max(4096).optional(),
    code: z.string().regex(/^\d{6}$/).optional(),
  }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable(), snapshot: snapshotSchema }),
});
export type LoginInput = import("@getpaseo/plugin").RpcInput<typeof loginRpc>;
export type LoginResult = RpcOutput<typeof loginRpc>;

export const logoutRpc = defineRpc({
  name: "lb.logout",
  input: z.object({ serverUrl: z.string() }),
  output: snapshotSchema,
});

export const forgetLoginRpc = defineRpc({
  name: "lb.forget-login",
  input: z.object({ serverUrl: z.string() }),
  output: snapshotSchema,
});
