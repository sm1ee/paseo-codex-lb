import { defineRpc, type RpcInput } from "@getpaseo/plugin";
import { z } from "zod";
import { snapshotSchema, type Session } from "./contracts";

export function canManageAccounts(session: Session | null): boolean {
  if (!session?.authenticated || session.role === "guest") return false;
  return session.permissions.length === 0 ? session.role === "admin" : session.permissions.some((p) => p === "write" || p === "accounts:write" || p.startsWith("accounts:write:"));
}

const target = { serverUrl: z.string(), accountId: z.string().min(1).max(512) };
const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pause") }), z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("routing"), policy: z.enum(["normal", "burn_first", "preserve"]) }),
  z.object({ kind: z.literal("alias"), alias: z.string().trim().max(255) }),
  z.object({ kind: z.literal("warmup"), enabled: z.boolean() }),
]);
export const actionResultSchema = z.object({ ok: z.boolean(), message: z.string(), snapshot: snapshotSchema });
export const accountActionRpc = defineRpc({ name: "lb.account-action", input: z.object({ ...target, action }), output: actionResultSchema });
export type AccountActionInput = RpcInput<typeof accountActionRpc>;

export const resetCreditsSchema = z.object({
  availableCount: z.number().int().nonnegative().default(0),
  nearestExpiresAt: z.string().nullish(),
  credits: z.array(z.object({ id: z.string(), status: z.string().nullish(), expiresAt: z.string().nullish(), title: z.string().nullish() })).default([]),
});

export const resetPreviewSchema = z.object({
  confirmationId: z.string(), accountId: z.string(), accountEmail: z.string(), availableCount: z.number(),
  nearestExpiresAt: z.string().nullable(), retry: z.boolean(),
});
export const resetPreviewRpc = defineRpc({ name: "lb.reset-preview", input: z.object(target), output: resetPreviewSchema });
export const resetConsumeRpc = defineRpc({ name: "lb.reset-consume", input: z.object({ ...target, confirmationId: z.string().uuid() }), output: actionResultSchema });
export type ActionResult = z.output<typeof actionResultSchema>;
export type ResetPreview = z.output<typeof resetPreviewSchema>;
