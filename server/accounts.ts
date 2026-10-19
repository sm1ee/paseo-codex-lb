import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resetCreditsSchema, type AccountActionInput, type ActionResult, type ResetPreview } from "../shared/actions";
import type { LBService } from "./service";
import { ApiError } from "./api";

interface ResetTicket extends ResetPreview { serverUrl: string; createdAt: number; started: boolean; result?: ActionResult }
const safeMessage = (error: unknown) => error instanceof ApiError ? error.message : error instanceof Error ? error.message : "The account request failed.";

export class AccountService {
  private busy = new Set<string>();
  private tickets = new Map<string, ResetTicket>();
  constructor(private readonly service: LBService) {}

  async action(input: AccountActionInput): Promise<ActionResult> {
    return this.exclusive(input.accountId, async () => {
      try {
        await this.service.withAccount(input.serverUrl, input.accountId, true, async (client, snapshot) => {
          const path = `/api/accounts/${encodeURIComponent(input.accountId)}`;
          const account = snapshot.overview!.accounts.find((a) => a.accountId === input.accountId)!;
          const action = input.action;
          if (action.kind === "pause" || action.kind === "resume") {
            if (action.kind === "pause" && account.status !== "active" || action.kind === "resume" && !["paused", "deactivated"].includes(account.status)) {
              throw new Error("The account status changed. Refresh and try again.");
            }
            await client.request(`${path}/${action.kind === "pause" ? "pause" : "reactivate"}`, z.object({ status: z.string() }), {});
          } else if (action.kind === "routing") {
            await client.request(`${path}/routing-policy`, z.object({ accountId: z.string(), routingPolicy: z.string() }), { routingPolicy: action.policy }, "PUT");
          } else if (action.kind === "alias") {
            await client.request(`${path}/alias`, z.object({ accountId: z.string() }), { alias: action.alias || null }, "PUT");
          } else {
            await client.request(`${path}/limit-warmup`, z.object({ status: z.string(), enabled: z.boolean() }), { enabled: action.enabled }, "PUT");
          }
        });
        return { ok: true, message: "Account updated.", snapshot: await this.service.snapshot(true) };
      } catch (error) { return { ok: false, message: safeMessage(error), snapshot: await this.service.snapshot() }; }
    });
  }

  async preview(serverUrl: string, accountId: string): Promise<ResetPreview> {
    this.prune();
    return this.service.withAccount(serverUrl, accountId, true, async (client, snapshot) => {
      const existing = [...this.tickets.values()].find((t) => t.serverUrl === snapshot.serverUrl && t.accountId === accountId && t.started && !t.result?.ok);
      if (existing) return { ...existing, retry: true };
      const account = snapshot.overview!.accounts.find((a) => a.accountId === accountId)!;
      if (!["active", "rate_limited", "quota_exceeded"].includes(account.status)) throw new Error("Reset credits cannot be used for this account's current status.");
      const credits = await client.request(`/api/accounts/${encodeURIComponent(accountId)}/rate-limit-reset-credits`, resetCreditsSchema.nullable());
      if (!credits) throw new Error("Reset credit details are not loaded on the server yet. Refresh and try again.");
      if (credits.availableCount < 1) throw new Error("No reset credits are available for this account.");
      const ticket: ResetTicket = { confirmationId: randomUUID(), serverUrl: snapshot.serverUrl, accountId, accountEmail: account.email,
        availableCount: credits.availableCount, nearestExpiresAt: credits.nearestExpiresAt ?? null, retry: false, createdAt: Date.now(), started: false };
      this.tickets.set(ticket.confirmationId, ticket);
      return ticket;
    });
  }

  async consume(serverUrl: string, accountId: string, confirmationId: string): Promise<ActionResult> {
    return this.exclusive(accountId, async () => {
      const ticket = this.tickets.get(confirmationId);
      if (!ticket || ticket.serverUrl !== serverUrl || ticket.accountId !== accountId || !ticket.started && Date.now() - ticket.createdAt > 2 * 60_000) {
        throw new Error("The reset confirmation expired. Open it again before using a credit.");
      }
      if (ticket.result?.ok) return ticket.result;
      try {
        const result = await this.service.withAccount(serverUrl, accountId, true, async (client, snapshot) => {
          const account = snapshot.overview!.accounts.find((a) => a.accountId === accountId)!;
          if (!["active", "rate_limited", "quota_exceeded"].includes(account.status)) throw new Error("This account cannot use a reset credit in its current state.");
          ticket.started = true;
          return client.request(`/api/accounts/${encodeURIComponent(accountId)}/rate-limit-reset-credits/consume`,
            z.object({ code: z.string().nullish(), windowsReset: z.number().nullish() }), { redeemRequestId: ticket.confirmationId });
        });
        const outcome: ActionResult = { ok: true, message: result.windowsReset == null ? "Reset credit used." : `Reset credit used. ${result.windowsReset} quota window${result.windowsReset === 1 ? "" : "s"} reset.`, snapshot: await this.service.snapshot(true) };
        ticket.result = outcome;
        return outcome;
      } catch (error) {
        return { ok: false, message: `${safeMessage(error)} If the result is uncertain, retry this request. Retrying reuses the same redemption ID.`, snapshot: await this.service.snapshot(true) };
      }
    });
  }

  stop(): void { this.tickets.clear(); }
  private prune(): void { for (const [key, value] of this.tickets) if (Date.now() - value.createdAt > 24 * 60 * 60_000) this.tickets.delete(key); }
  private async exclusive<T>(accountId: string, action: () => Promise<T>): Promise<T> {
    if (this.busy.has(accountId)) throw new Error("Another request for this account is still running.");
    this.busy.add(accountId);
    try { return await action(); } finally { this.busy.delete(accountId); }
  }
}
