import { describe, expect, it, vi } from "vitest";
import { LBClient } from "./api";
import { LBService } from "./service";
import { AccountService } from "./accounts";
import { preferences } from "../shared/contracts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(options: { guest?: boolean; status?: string; failFirstReset?: boolean; credits?: number } = {}) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  let status = options.status ?? "active";
  let consumes = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    if (url.pathname.endsWith("/session")) return json({ authenticated: true, role: options.guest ? "guest" : "admin", permissions: options.guest ? ["read"] : ["read", "write"] });
    if (url.pathname.endsWith("/overview")) return json({ accounts: [{ accountId: "account/with-special", email: "test@example.com", status, availableResetCredits: options.credits ?? 2 }] });
    if (url.pathname.endsWith("/rate-limit-reset-credits")) return json({ availableCount: options.credits ?? 2, nearestExpiresAt: "2030-01-01T00:00:00Z", credits: [] });
    if (url.pathname.endsWith("/consume")) {
      consumes++;
      if (options.failFirstReset && consumes === 1) throw new Error("connection lost after request");
      return json({ code: "ok", windowsReset: 1 });
    }
    if (url.pathname.endsWith("/pause")) { status = "paused"; return json({ status: "paused" }); }
    if (url.pathname.endsWith("/reactivate")) { status = "active"; return json({ status: "reactivated" }); }
    if (url.pathname.endsWith("/routing-policy")) return json({ accountId: "account/with-special", routingPolicy: "preserve" });
    if (url.pathname.endsWith("/alias")) return json({ accountId: "account/with-special", alias: "label" });
    return json({ status: "enabled", enabled: true });
  };
  const values = preferences.schema.parse({});
  const service = new LBService({ read: async () => ({ status: "ready", revision: "1", values }), subscribe: () => () => {} },
    (url) => new LBClient(url, fetcher), async () => "unused", { kind: "none", read: async () => null, write: async () => {}, remove: async () => {} });
  const accounts = new AccountService(service);
  const target = { serverUrl: values.serverUrl, accountId: "account/with-special" };
  return { service, accounts, target, calls, cleanup: () => { accounts.stop(); service.stop(); } };
}

describe("account controls", () => {
  it("encodes account paths, uses the right methods, and refreshes after a change", async () => {
    const t = setup();
    const paused = await t.accounts.action({ ...t.target, action: { kind: "pause" } });
    expect(paused).toMatchObject({ ok: true, snapshot: { overview: { accounts: [{ status: "paused" }] } } });
    expect(t.calls.some((c) => c.url.pathname === "/api/accounts/account%2Fwith-special/pause" && c.init?.method === "POST")).toBe(true);
    const routing = await t.accounts.action({ ...t.target, action: { kind: "routing", policy: "preserve" } });
    expect(routing.ok).toBe(true);
    const call = t.calls.find((c) => c.url.pathname.endsWith("/routing-policy"))!;
    expect(call.init?.method).toBe("PUT");
    expect(JSON.parse(String(call.init?.body))).toEqual({ routingPolicy: "preserve" });
    t.cleanup();
  });

  it("rejects guest mutations before sending an account write", async () => {
    const t = setup({ guest: true });
    expect((await t.accounts.action({ ...t.target, action: { kind: "pause" } })).ok).toBe(false);
    await expect(t.accounts.preview(t.target.serverUrl, t.target.accountId)).rejects.toThrow("cannot manage");
    expect(t.calls.every((c) => c.init?.method === "GET")).toBe(true);
    t.cleanup();
  });

  it("requires a current confirmation before consuming any reset credit", async () => {
    const t = setup();
    await expect(t.accounts.consume(t.target.serverUrl, t.target.accountId, "00000000-0000-4000-8000-000000000000")).rejects.toThrow("confirmation expired");
    expect(t.calls.some((c) => c.url.pathname.endsWith("/consume"))).toBe(false);
    t.cleanup();
  });

  it("reuses the redemption ID after a lost response and returns cached success on duplicate clicks", async () => {
    const t = setup({ failFirstReset: true });
    const preview = await t.accounts.preview(t.target.serverUrl, t.target.accountId);
    expect(t.calls.some((c) => c.url.pathname.endsWith("/consume"))).toBe(false);
    expect((await t.accounts.consume(t.target.serverUrl, t.target.accountId, preview.confirmationId)).ok).toBe(false);
    const retry = await t.accounts.preview(t.target.serverUrl, t.target.accountId);
    expect(retry).toMatchObject({ confirmationId: preview.confirmationId, retry: true });
    expect((await t.accounts.consume(t.target.serverUrl, t.target.accountId, retry.confirmationId)).ok).toBe(true);
    expect((await t.accounts.consume(t.target.serverUrl, t.target.accountId, retry.confirmationId)).ok).toBe(true);
    const calls = t.calls.filter((c) => c.url.pathname.endsWith("/consume"));
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => JSON.parse(String(c.init?.body)).redeemRequestId)).toEqual([preview.confirmationId, preview.confirmationId]);
    t.cleanup();
  });

  it("does not permit a reset on paused accounts or when no credits are available", async () => {
    for (const options of [{ status: "paused" }, { credits: 0 }]) {
      const t = setup(options);
      await expect(t.accounts.preview(t.target.serverUrl, t.target.accountId)).rejects.toThrow();
      expect(t.calls.some((c) => c.url.pathname.endsWith("/consume"))).toBe(false);
      t.cleanup();
    }
  });
});
