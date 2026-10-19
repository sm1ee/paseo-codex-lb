import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { preferences, type Preferences } from "../shared/contracts";
import { LBClient, normalizeServerUrl } from "./api";
import { LBService } from "./service";
import { usageSource } from "./usage-source";
import type { CredentialStore, SavedLogin } from "./credentials";

const session = (extra = {}) => ({ authenticated: true, passwordRequired: true, role: "admin", ...extra });
const overview = (id = "one") => ({ accounts: [{ accountId: id, status: "active", windowMinutesPrimary: 300, usage: { primaryRemainingPercent: 42 } }] });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function memoryStore(): CredentialStore {
  let value: SavedLogin | null = null;
  return { kind: "keychain", read: vi.fn(async () => value), write: vi.fn(async (_, next) => { value = next; }), remove: vi.fn(async () => { value = null; }) };
}

function setup(handler: (url: URL, init?: RequestInit) => Promise<Response> | Response, credentials = memoryStore()) {
  let values = preferences.schema.parse({});
  const settings = { read: async () => ({ status: "ready" as const, values, revision: "test" }), subscribe: () => () => {} };
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(new URL(String(url)), init)) as unknown as typeof fetch;
  const service = new LBService(settings, (url) => new LBClient(url, fetcher), async () => "saved-password", credentials);
  return { service, fetcher, change: (change: Partial<Preferences>) => { values = { ...values, ...change }; service.changed(values); } };
}

describe("HTTP boundary", () => {
  it("keeps login cookies on the server and sends them on the next request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ok: true }, 200, { "Set-Cookie": "lb_session=private; Path=/; HttpOnly" }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new LBClient("http://localhost:2455/prefix", fetcher);
    await client.request("/api/login", z.object({ ok: z.boolean() }), { password: "private-password" });
    await client.request("/api/data", z.object({ ok: z.boolean() }));
    expect(String(fetcher.mock.calls[1][0])).toBe("http://localhost:2455/prefix/api/data");
    expect(fetcher.mock.calls[1][1].headers.Cookie).toBe("lb_session=private");
    client.stop();
  });

  it("does not follow redirects or expose upstream error bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: "sensitive-upstream-body" }, 302, { Location: "https://elsewhere.example/" }));
    const client = new LBClient("https://lb.example", fetcher);
    await expect(client.request("/api/data", z.object({}))).rejects.toThrow("redirected");
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const bad = new LBClient("https://lb.example", vi.fn().mockResolvedValue(json({ accessToken: "secret" }, 500)));
    await expect(bad.request("/api/data", z.object({}))).rejects.toThrow("HTTP 500");
    client.stop(); bad.stop();
  });

  it("honors cookie removal, path, and Secure", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 200, { "Set-Cookie": "session=one; Path=/api/auth; Secure" }))
      .mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({}, 200, { "Set-Cookie": "session=; Path=/; Max-Age=0" })).mockResolvedValueOnce(json({}));
    const client = new LBClient("http://lb.example", fetcher);
    for (const path of ["/api/login", "/api/auth/verify", "/api/logout", "/api/data"]) await client.request(path, z.object({}));
    expect(fetcher.mock.calls[1][1].headers.Cookie).toBeUndefined();
    expect(fetcher.mock.calls[3][1].headers.Cookie).toBeUndefined();
    client.stop();
    expect(normalizeServerUrl(" https://lb.example/prefix/ ")).toBe("https://lb.example/prefix");
  });
});

describe("connection lifecycle", () => {
  it("deduplicates sidebar, screen, and Usage requests", async () => {
    const { service, fetcher } = setup((url) => json(url.pathname.endsWith("/session") ? session() : overview()));
    const snapshots = await Promise.all([service.snapshot(), service.snapshot(), service.snapshot()]);
    expect(snapshots.every((s) => s.state === "connected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await service.snapshot(); expect(fetcher).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it("preserves last data on a network error, but clears it after a 401", async () => {
    let mode = "ok";
    const { service } = setup((url) => {
      if (mode === "offline") throw new Error("private-network-detail");
      if (mode === "expired") return json({ error: "secret" }, 401);
      return json(url.pathname.endsWith("/session") ? session() : overview());
    });
    const first = await service.snapshot();
    mode = "offline";
    const stale = await service.snapshot(true);
    expect(stale).toMatchObject({ state: "offline", overview: first.overview, fetchedAt: first.fetchedAt });
    expect(stale.error).not.toContain("private-network-detail");
    mode = "expired";
    expect(await service.snapshot(true)).toMatchObject({ state: "sign-in", overview: null, fetchedAt: null });
    service.stop();
  });

  it("never relabels a slow old-server response as new-server data", async () => {
    let resolveOld!: (response: Response) => void;
    const { service, change } = setup((url) => {
      if (url.pathname.endsWith("/session")) return json(session());
      if (url.hostname === "127.0.0.1") return new Promise((resolve) => { resolveOld = resolve; });
      return json(overview("new-server"));
    });
    const old = service.snapshot();
    await vi.waitFor(() => expect(resolveOld).toBeDefined());
    change({ serverUrl: "http://other.example:2455" });
    const next = await service.snapshot();
    resolveOld(json(overview("old-server")));
    const late = await old;
    expect(next.overview?.accounts[0].accountId).toBe("new-server");
    expect(late.overview?.accounts[0].accountId).toBe("new-server");
    expect(late.serverUrl).toBe("http://other.example:2455");
    service.stop();
  });

  it("clears the old period immediately when the timeframe changes", async () => {
    const { service, change, fetcher } = setup((url) => json(url.pathname.endsWith("/session") ? session() : overview(url.searchParams.get("timeframe")!)));
    await service.snapshot();
    change({ timeframe: "1d" });
    const next = await service.snapshot();
    expect(next.timeframe).toBe("1d");
    expect(next.overview?.accounts[0].accountId).toBe("1d");
    expect(String(vi.mocked(fetcher).mock.calls.at(-1)![0])).toContain("timeframe=1d");
    service.stop();
  });

  it("supports password then TOTP without exposing session cookies", async () => {
    let verified = false;
    let passwordOK = false;
    const credentials = memoryStore();
    const { service } = setup((url, init) => {
      if (url.pathname.endsWith("/password/login")) {
        passwordOK = JSON.parse(String(init?.body)).password === "correct";
        return json(session({ authenticated: false, totpRequiredOnLogin: true, passwordSessionActive: true }), 200, { "Set-Cookie": "session=pending-secret; Path=/" });
      }
      if (url.pathname.endsWith("/totp/verify")) {
        verified = (init?.headers as Record<string, string>).Cookie === "session=pending-secret";
        return json(session(), 200, { "Set-Cookie": "session=verified-secret; Path=/" });
      }
      if (url.pathname.endsWith("/session")) return json(session({ authenticated: verified, totpRequiredOnLogin: !verified, passwordSessionActive: passwordOK }));
      return json(overview());
    }, credentials);
    await service.snapshot();
    const first = await service.login({ serverUrl: "http://127.0.0.1:2455", role: "admin", remember: true, method: "password", password: "correct" });
    expect(first).toMatchObject({ ok: true, snapshot: { state: "totp" } });
    expect(credentials.write).not.toHaveBeenCalled();
    const second = await service.login({ serverUrl: "http://127.0.0.1:2455", role: "admin", remember: false, method: "totp", code: "123456" });
    expect(second).toMatchObject({ ok: true, snapshot: { state: "connected" } });
    expect(verified).toBe(true);
    expect(credentials.write).toHaveBeenCalledTimes(1);
    expect(second.snapshot.hasSavedLogin).toBe(true);
    expect(JSON.stringify(second)).not.toContain("secret");
    service.stop();
  });

  it("restores a saved login and keeps sign-out distinct from forgetting it", async () => {
    let authenticated = false;
    const credentials = memoryStore();
    await credentials.write("http://127.0.0.1:2455", { role: "admin", password: "saved-private" });
    const { service, fetcher } = setup((url, init) => {
      if (url.pathname.endsWith("/password/login")) { authenticated = JSON.parse(String(init?.body)).password === "saved-private"; return json(session({ authenticated })); }
      if (url.pathname.endsWith("/logout")) { authenticated = false; return json({ status: "ok" }); }
      return json(url.pathname.endsWith("/session") ? session({ authenticated }) : overview());
    }, credentials);
    expect(await service.snapshot()).toMatchObject({ state: "connected", hasSavedLogin: true });
    expect(await service.logout("http://127.0.0.1:2455")).toMatchObject({ state: "sign-in", hasSavedLogin: true });
    await service.snapshot(true);
    expect(vi.mocked(fetcher).mock.calls.filter(([url]) => String(url).endsWith("/password/login"))).toHaveLength(1);
    expect(await service.forgetLogin("http://127.0.0.1:2455")).toMatchObject({ hasSavedLogin: false });
    expect(await credentials.read("http://127.0.0.1:2455")).toBeNull();
    service.stop();
  });

  it("rejects a login addressed to an obsolete server before sending credentials", async () => {
    const { service, change, fetcher } = setup(() => json(session({ authenticated: false })));
    await service.snapshot();
    change({ serverUrl: "http://new.example:2455" });
    await expect(service.login({ serverUrl: "http://127.0.0.1:2455", method: "password", role: "admin", remember: false, password: "do-not-send" })).rejects.toThrow("changed");
    expect(vi.mocked(fetcher).mock.calls.every(([, init]) => !init?.body)).toBe(true);
    service.stop();
  });

  it("registers only global pool usage and does not report stale quota as available", async () => {
    let online = true;
    const { service } = setup((url) => { if (!online) throw new Error("offline"); return json(url.pathname.endsWith("/session") ? session() : overview()); });
    const source = usageSource(service);
    expect(await source.discover({ kind: "session", provider: "codex", env: {} })).toEqual([]);
    const accounts = await source.discover({ kind: "global" });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    expect(await source.fetch(accounts[0].input)).toMatchObject({ status: "available", windows: [{ usedPct: 58 }] });
    online = false; await service.snapshot(true);
    expect(await source.fetch(accounts[0].input)).toMatchObject({ status: "error" });
    service.stop();
  });
});
