import { z } from "zod";
import { hashAccountKey, windowFromReportedDuration, windowFromUsedPct, type UsageSourceRegistration } from "@getpaseo/plugin/server/usage";
import { aggregateWindows, countsForQuota, needsAttention } from "../shared/quota";
import type { LBService } from "./service";

const inputSchema = z.object({ serverUrl: z.string() });

export function usageSource(service: LBService): UsageSourceRegistration {
  return {
    id: "codex-lb", label: "Codex LB", input: inputSchema,
    async discover(scope) {
      // The LB routes individual requests across accounts; there is no per-session account to claim.
      if (scope.kind !== "global") return [];
      const snapshot = await service.snapshot();
      return [{ key: hashAccountKey(`codex-lb:${snapshot.serverUrl}`), label: "Codex LB pool", harness: "Codex LB", input: { serverUrl: snapshot.serverUrl } }];
    },
    async fetch(raw) {
      const input = inputSchema.parse(raw);
      const snapshot = await service.snapshot();
      if (snapshot.serverUrl !== input.serverUrl) return { status: "error", error: "The Codex LB server changed. Reopen Usage to refresh the connection." };
      if (snapshot.state === "sign-in" || snapshot.state === "totp") return { status: "unavailable", problem: { kind: "rejected", status: 401, refreshedBy: "Open Codex LB in the sidebar and sign in." } };
      if (snapshot.state !== "connected" || !snapshot.overview) return { status: "error", error: snapshot.error ?? "Codex LB is unavailable." };
      const accounts = snapshot.overview.accounts;
      const aggregates = aggregateWindows(accounts);
      if (!aggregates.length) return { status: "unavailable", problem: { kind: "no_quota", detail: "Codex LB has no reported quota for usable accounts." } };
      return {
        status: "available",
        planLabel: `${accounts.filter((a) => countsForQuota(a.status)).length} usable / ${accounts.length} accounts`,
        windows: aggregates.map((w) => {
          const base = { utilizationPct: w.remaining == null ? null : 100 - w.remaining, summary: true };
          // A pool has several reset times. Do not imply the entire pool resets at the first account's reset.
          return w.minutes == null && w.id === "monthly"
            ? windowFromUsedPct({ ...base, id: "monthly", label: "Monthly", shortLabel: "M" })
            : windowFromReportedDuration({ ...base, durationSeconds: w.minutes ? w.minutes * 60 : null,
              unknown: { id: w.id, label: w.label, shortLabel: w.shortLabel } });
        }),
        details: [
          { id: "method", label: "Quota", value: aggregates.some((w) => w.method === "average") ? "Account averages where credit capacity is unavailable" : "Weighted by reported credit capacity" },
          { id: "attention", label: "Needs attention", value: String(accounts.filter((a) => needsAttention(a.status)).length) },
          { id: "updated", label: "Dashboard fetched", value: snapshot.fetchedAt ?? "Unknown" },
        ],
      };
    },
  };
}
