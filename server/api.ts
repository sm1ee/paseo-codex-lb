import { z } from "zod";

export class ApiError extends Error {
  constructor(message: string, readonly kind: "network" | "auth" | "http" | "schema", readonly status?: number) {
    super(message);
  }
}

export function normalizeServerUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("Enter a valid Codex LB URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP or HTTPS server URL without credentials, a query, or a fragment.");
  }
  return url.href.replace(/\/+$/, "");
}

interface Cookie { value: string; path: string; secure: boolean; expires: number }

export class LBClient {
  private cookies = new Map<string, Cookie>();
  private lifetime = new AbortController();
  version: string | null = null;

  constructor(readonly serverUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  stop(): void { this.lifetime.abort(); this.cookies.clear(); }
  cancelRequests(): void { this.lifetime.abort(); this.lifetime = new AbortController(); }
  clearSession(): void { this.cookies.clear(); }

  async request<S extends z.ZodType>(path: string, schema: S, body?: Record<string, unknown>, method?: "PUT" | "POST"): Promise<z.output<S>> {
    const controller = new AbortController();
    const parent = this.lifetime.signal;
    const abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true });
    if (parent.aborted) abort();
    const timer = setTimeout(abort, 12_000);
    try { return await this.send(path, schema, body, controller.signal, method); }
    finally { clearTimeout(timer); parent.removeEventListener("abort", abort); }
  }

  private async send<S extends z.ZodType>(path: string, schema: S, body: Record<string, unknown> | undefined, signal: AbortSignal, method?: "PUT" | "POST"): Promise<z.output<S>> {
    const url = new URL(`${this.serverUrl}${path}`);
    const headers: Record<string, string> = { Accept: "application/json" };
    const cookie = [...this.cookies].filter(([, c]) => c.expires > Date.now() && (!c.secure || url.protocol === "https:") &&
      (url.pathname === c.path || url.pathname.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`)))
      .map(([name, c]) => `${name}=${c.value}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    if (body) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: method ?? (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined,
        signal,
        redirect: "manual",
      });
    } catch {
      throw new ApiError("Could not reach Codex LB. Check the server URL and connection.", "network");
    }
    const version = response.headers.get("X-App-Version");
    if (version && /^[a-zA-Z0-9.+_-]{1,64}$/.test(version)) this.version = version;
    for (const header of response.headers.getSetCookie()) this.setCookie(header);
    if (response.status === 401) { await response.body?.cancel(); throw new ApiError("Dashboard sign-in required.", "auth", 401); }
    if (!response.ok) {
      await response.body?.cancel();
      const message = response.status === 403 ? "This dashboard login does not have access."
        : response.status === 429 ? "Too many requests. Wait a moment and try again."
        : response.status >= 300 && response.status < 400 ? "The server redirected the request. Use its final Codex LB URL."
        : `Codex LB returned HTTP ${response.status}.`;
      throw new ApiError(message, "http", response.status);
    }
    try {
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("oversized"); }
          chunks.push(value);
        }
      }
      return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      if (signal.aborted) throw new ApiError("Could not reach Codex LB. Check the server URL and connection.", "network");
      throw new ApiError("Codex LB returned an unexpected response. Check the server URL and version.", "schema");
    }
  }

  private setCookie(header: string): void {
    const [pair, ...attributes] = header.split(";");
    const index = pair.indexOf("=");
    if (index < 1) return;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || /[\r\n]/.test(value)) return;
    const attr = new Map(attributes.map((part) => {
      const i = part.indexOf("=");
      return i === -1 ? [part.trim().toLowerCase(), ""] : [part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()];
    }));
    const maxAge = Number(attr.get("max-age"));
    const expires = attr.has("max-age") && Number.isFinite(maxAge) ? Date.now() + maxAge * 1000
      : attr.has("expires") ? Date.parse(attr.get("expires")!) : Infinity;
    if (!value || expires <= Date.now()) { this.cookies.delete(name); return; }
    this.cookies.set(name, { value, path: attr.get("path") || "/", secure: attr.has("secure"), expires });
  }
}
