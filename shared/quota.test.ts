import { describe, expect, it } from "vitest";
import { accountSchema, preferences, overviewSchema } from "./contracts";
import { accountName, accountWindows, aggregateWindows, resetLabel } from "./quota";

const account = (data: Record<string, unknown> = {}) => accountSchema.parse({ accountId: "test", status: "active", ...data });

describe("quota semantics", () => {
  it("weights by credit capacity rather than treating different plans equally", () => {
    const small = account({ accountId: "small", windowMinutesPrimary: 300, usage: { primaryRemainingPercent: 0 }, capacityCreditsPrimary: 100, remainingCreditsPrimary: 0 });
    const large = account({ accountId: "large", windowMinutesPrimary: 300, usage: { primaryRemainingPercent: 100 }, capacityCreditsPrimary: 900, remainingCreditsPrimary: 900 });
    expect(aggregateWindows([small, large])[0]).toMatchObject({ remaining: 90, count: 2, method: "credits", label: "5h" });
  });

  it("falls back to an explicit average without inventing missing quota", () => {
    const a = account({ usage: { primaryRemainingPercent: 60 } });
    const b = account({ usage: { primaryRemainingPercent: 20 } });
    const unknown = account({ usage: null });
    expect(aggregateWindows([a, b, unknown])).toMatchObject([{ remaining: 40, count: 2, method: "average", label: "Primary" }]);
    expect(accountWindows(unknown).map((w) => w.remaining)).toEqual([null, null]);
    expect(aggregateWindows([unknown])).toEqual([]);
  });

  it("includes exhausted accounts and excludes accounts requiring operator action", () => {
    const make = (status: string, percent: number) => account({ status, windowMinutesPrimary: 300, usage: { primaryRemainingPercent: percent } });
    const result = aggregateWindows([make("active", 90), make("rate_limited", 0), make("quota_exceeded", 0), make("paused", 100), make("reauth_required", 100), make("deactivated", 100), make("new_server_state", 100)]);
    expect(result[0]).toMatchObject({ remaining: 30, count: 3 });
  });

  it("groups periods by reported duration even when they move between slots", () => {
    const a = account({ windowMinutesPrimary: 300, windowMinutesSecondary: 10080, usage: { primaryRemainingPercent: 40, secondaryRemainingPercent: 80 } });
    const b = account({ windowMinutesPrimary: 10080, windowMinutesSecondary: 300, usage: { primaryRemainingPercent: 20, secondaryRemainingPercent: 60 } });
    expect(aggregateWindows([a, b]).map((w) => [w.label, w.remaining])).toEqual([["5h", 50], ["Weekly", 50]]);
    expect(accountWindows(account())[0].label).toBe("Primary");
  });

  it("clamps bad percentages and does not count the same duration twice per account", () => {
    const a = account({ windowMinutesPrimary: 300, windowMinutesSecondary: 300, usage: { primaryRemainingPercent: 120, secondaryRemainingPercent: -5 } });
    expect(accountWindows(a).map((w) => w.remaining)).toEqual([100, 0]);
    expect(aggregateWindows([a])[0].count).toBe(1);
  });

  it("hides every account identifier when names are hidden", () => {
    const a = account({ email: "private@example.com", alias: "Private alias", displayName: "Private name" });
    expect(accountName(a, true, 2)).toBe("Account 3");
    expect(accountName(a, false, 2)).toBe("private@example.com");
  });

  it("does not label an elapsed reset as a new quota window", () => {
    expect(resetLabel("2026-01-01T00:00:00Z", Date.parse("2026-01-02T00:00:00Z"))).toBe("Reset due");
    expect(resetLabel("bad-date")).toBe("Reset time unknown");
  });

  it("rejects credentials and non-HTTP URLs before settings can persist them", () => {
    for (const serverUrl of ["file:///etc/passwd", "http://user:secret@host:2455", "https://host/?token=secret", "https://host/#secret"]) {
      expect(preferences.schema.safeParse({ serverUrl }).success).toBe(false);
    }
    expect(preferences.schema.parse({ serverUrl: "https://lb.example.com/prefix" }).serverUrl).toBe("https://lb.example.com/prefix");
  });

  it("strips unneeded server fields, including account auth details, from RPC output", () => {
    const parsed = overviewSchema.parse({ accounts: [{ accountId: "one", status: "active", auth: { accessToken: "must-not-cross-rpc" } }], rawToken: "secret" });
    expect(JSON.stringify(parsed)).not.toContain("must-not-cross-rpc");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});
