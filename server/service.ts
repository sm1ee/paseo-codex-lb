import type { PluginSettings } from "@getpaseo/plugin/server";
import { z } from "zod";
import { preferences, sessionSchema, overviewSchema, type Preferences, type Snapshot, type LoginInput, type LoginResult } from "../shared/contracts";
import { ApiError, LBClient, normalizeServerUrl } from "./api";
import { canUseSavedLogin, readStatusBarPassword, credentialStore, type CredentialStore, type SavedLogin } from "./credentials";
import { canManageAccounts } from "../shared/actions";

type Settings = PluginSettings<typeof preferences.schema>;

export class LBService {
  private client: LBClient | null = null;
  private config: Preferences | null = null;
  private value: Snapshot | null = null;
  private generation = 0;
  private pending: { generation: number; promise: Promise<void> } | null = null;
  private authBusy = false;
  private stopped = false;
  private suppressAutoLogin = false;
  private savedLoginChecked = false;
  private pendingLogin: SavedLogin | null = null;

  constructor(private readonly settings: Settings, private readonly createClient = (url: string) => new LBClient(url),
    private readonly readPassword = readStatusBarPassword, private readonly credentials: CredentialStore = credentialStore()) {}

  changed(next: Preferences): void {
    const serverUrl = normalizeServerUrl(next.serverUrl);
    const serverChanged = this.config?.serverUrl !== serverUrl;
    if (serverChanged || this.config?.timeframe !== next.timeframe) {
      this.generation++;
      if (serverChanged) {
        this.client?.stop(); this.client = this.createClient(serverUrl);
        this.suppressAutoLogin = false; this.savedLoginChecked = false; this.pendingLogin = null;
      }
      else this.client?.cancelRequests();
      this.value = { ...this.empty({ ...next, serverUrl }), ...(!serverChanged && this.value ? {
        hasSavedLogin: this.value.hasSavedLogin, credentialError: this.value.credentialError,
      } : {}) };
    }
    this.config = { ...next, serverUrl };
  }

  async snapshot(refresh = false): Promise<Snapshot> {
    await this.configure();
    if (this.authBusy) return this.value!;
    const gen = this.generation;
    const age = this.value!.checkedAt ? Date.now() - Date.parse(this.value!.checkedAt) : Infinity;
    if (this.pending?.generation === gen) await this.pending.promise;
    else if (refresh || age >= this.config!.refreshSeconds * 1000) {
      const promise = this.load(gen, this.client!);
      const pending = { generation: gen, promise };
      this.pending = pending;
      try { await promise; } finally { if (this.pending === pending) this.pending = null; }
    }
    if (gen !== this.generation) return this.snapshot(false);
    return this.value!;
  }

  async login(input: LoginInput): Promise<LoginResult> {
    await this.configure();
    this.checkServer(input.serverUrl);
    if (this.authBusy) return { ok: false, error: "A sign-in request is already running.", snapshot: this.value! };
    this.authBusy = true;
    const gen = ++this.generation;
    const client = this.client!;
    client.cancelRequests();
    this.suppressAutoLogin = false;
    try {
      let session;
      if (input.method === "totp") {
        if (!input.code) throw new Error("Enter the six-digit authentication code.");
        session = await client.request("/api/dashboard-auth/totp/verify", sessionSchema, { code: input.code });
      } else {
        this.pendingLogin = null;
        const stored = input.method === "saved" ? await this.credentials.read(this.config!.serverUrl) : null;
        if (input.method === "saved" && !stored) throw new Error("No saved login was found for this server.");
        const role = stored?.role ?? (input.method === "guest" ? "guest" : input.role);
        const password = stored?.password ?? (input.method === "statusbar" ? await this.readPassword(this.config!.serverUrl, role) : input.password);
        const username = stored?.username ?? input.username;
        if (gen !== this.generation) throw new Error("The connection changed. Try signing in again.");
        if (role === "admin" && !password) throw new Error("Enter the dashboard password.");
        session = await client.request(role === "guest" ? "/api/dashboard-auth/guest/login" : "/api/dashboard-auth/password/login", sessionSchema,
          { ...(password ? { password } : {}), ...(role === "admin" && username ? { username } : {}) });
        if (input.remember && this.credentials.kind !== "none" && input.method !== "saved") this.pendingLogin = { role, password: password ?? "", ...(username ? { username } : {}) };
      }
      if (gen !== this.generation) return { ok: false, error: "The connection changed. Try signing in again.", snapshot: this.value! };
      this.value = { ...this.value!, session, overview: null, fetchedAt: null, checkedAt: null, error: null,
        state: session.authenticated ? "connected" : session.totpRequiredOnLogin ? "totp" : "sign-in" };
      if (session.authenticated) {
        await this.savePendingLogin(gen);
        await this.load(gen, client);
      }
      return { ok: true, error: null, snapshot: this.value! };
    } catch (error) {
      this.suppressAutoLogin = true;
      const message = error instanceof ApiError && error.status === 401 ? "Sign-in failed. Check your password or authentication code."
        : error instanceof ApiError ? error.message
        : error instanceof Error && !(error instanceof TypeError) ? error.message : "Could not sign in.";
      return { ok: false, error: message, snapshot: this.value! };
    } finally { this.authBusy = false; }
  }

  async logout(serverUrl: string): Promise<Snapshot> {
    await this.configure();
    this.checkServer(serverUrl);
    if (this.authBusy) throw new Error("Wait for the current sign-in request to finish.");
    this.authBusy = true;
    const gen = ++this.generation;
    const client = this.client!;
    client.cancelRequests();
    this.suppressAutoLogin = true;
    this.pendingLogin = null;
    let signOutFailed = false;
    try {
      await client.request("/api/dashboard-auth/logout", z.object({ status: z.string().optional() }), {});
    } catch {
      signOutFailed = true;
    } finally {
      client.clearSession();
      if (gen === this.generation) this.value = { ...this.empty(this.config!), hasSavedLogin: this.value?.hasSavedLogin ?? false };
      this.authBusy = false;
    }
    if (signOutFailed) {
      this.value = { ...this.value!, checkedAt: new Date().toISOString(), error: "Signed out locally. Codex LB could not confirm sign-out." };
      return this.value;
    }
    return this.snapshot(true);
  }

  async forgetLogin(serverUrl: string): Promise<Snapshot> {
    await this.configure(); this.checkServer(serverUrl);
    if (this.authBusy) throw new Error("Wait for the current sign-in request to finish.");
    const gen = ++this.generation;
    this.client?.cancelRequests(); this.suppressAutoLogin = true; this.pendingLogin = null; this.authBusy = true;
    try {
      await this.credentials.remove(this.config!.serverUrl);
      if (gen === this.generation) this.value = { ...this.value!, hasSavedLogin: false, credentialError: null };
    } finally { this.authBusy = false; }
    return this.value!;
  }

  async withAccount<T>(serverUrl: string, accountId: string, write: boolean, action: (client: LBClient, snapshot: Snapshot) => Promise<T>): Promise<T> {
    await this.configure(); this.checkServer(serverUrl);
    if (this.authBusy) throw new Error("Wait for sign-in to finish.");
    const snapshot = await this.snapshot();
    if (snapshot.state !== "connected" || !snapshot.session?.authenticated) throw new Error("Connect to Codex LB before changing an account.");
    if (write && !canManageAccounts(snapshot.session)) throw new Error("This dashboard login cannot manage accounts.");
    if (!snapshot.overview?.accounts.some((account) => account.accountId === accountId)) throw new Error("The account is no longer in the current dashboard.");
    const gen = this.generation;
    try {
      const result = await action(this.client!, snapshot);
      if (gen !== this.generation) throw new Error("The connection changed. Check the account in the dashboard before retrying.");
      return result;
    } catch (error) {
      if (gen === this.generation && error instanceof ApiError && error.kind === "auth") {
        this.client!.clearSession();
        this.value = { ...this.value!, state: "sign-in", session: null, overview: null, fetchedAt: null,
          checkedAt: new Date().toISOString(), error: "Dashboard sign-in required." };
      }
      throw error;
    }
  }

  stop(): void { this.stopped = true; this.generation++; this.client?.stop(); this.pendingLogin = null; this.value = null; }

  private async configure(): Promise<void> {
    if (this.stopped) throw new Error("The plugin has stopped.");
    const settings = await this.settings.read();
    if (settings.status !== "ready") throw new Error("Connection settings could not be read. Open Codex LB settings to fix them.");
    this.changed(settings.values);
  }

  private checkServer(serverUrl: string): void {
    if (normalizeServerUrl(serverUrl) !== this.config?.serverUrl) throw new Error("The server URL changed. Reload the connection before signing in.");
  }

  private empty(config: Preferences): Snapshot {
    return { serverUrl: config.serverUrl, timeframe: config.timeframe, state: "sign-in", session: null,
      overview: null, checkedAt: null, fetchedAt: null, error: null, serverVersion: null, savedLoginAvailable: canUseSavedLogin,
      credentialStore: this.credentials.kind, hasSavedLogin: false, credentialError: null };
  }

  private async savePendingLogin(gen: number): Promise<void> {
    const pending = this.pendingLogin;
    this.pendingLogin = null;
    if (!pending || gen !== this.generation) return;
    try {
      await this.credentials.write(this.config!.serverUrl, pending);
      if (gen === this.generation) this.value = { ...this.value!, hasSavedLogin: true, credentialError: null };
    } catch {
      if (gen === this.generation) this.value = { ...this.value!, credentialError: "Signed in, but the password could not be saved in Keychain. You can try again on your next sign-in." };
    }
  }

  private async load(gen: number, client: LBClient): Promise<void> {
    try {
      let session = await client.request("/api/dashboard-auth/session", sessionSchema);
      if (gen !== this.generation) return;
      if (!session.authenticated && !(session.totpRequiredOnLogin && session.passwordSessionActive) && !this.suppressAutoLogin && !this.savedLoginChecked) {
        this.savedLoginChecked = true;
        try {
          const stored = await this.credentials.read(this.config!.serverUrl);
          if (gen !== this.generation) return;
          this.value = { ...this.value!, hasSavedLogin: stored !== null };
          if (stored) {
            session = await client.request(stored.role === "guest" ? "/api/dashboard-auth/guest/login" : "/api/dashboard-auth/password/login", sessionSchema,
              { ...(stored.password ? { password: stored.password } : {}), ...(stored.username ? { username: stored.username } : {}) });
          }
        } catch {
          if (gen !== this.generation) return;
          this.suppressAutoLogin = true;
          this.value = { ...this.value!, credentialError: "Saved sign-in failed. Enter your password again, or remove the saved login." };
        }
      }
      if (gen !== this.generation) return;
      if (!session.authenticated) {
        this.value = { ...this.value!, session, overview: null, fetchedAt: null, error: null, checkedAt: new Date().toISOString(),
          state: session.totpRequiredOnLogin && session.passwordSessionActive ? "totp" : "sign-in", serverVersion: client.version };
        return;
      }
      const overview = await client.request(`/api/dashboard/overview?timeframe=${this.config!.timeframe}`, overviewSchema);
      if (gen !== this.generation) return;
      const now = new Date().toISOString();
      this.savedLoginChecked = false;
      this.value = { ...this.value!, state: "connected", session, overview, fetchedAt: now, checkedAt: now, error: null, serverVersion: client.version };
    } catch (error) {
      if (gen !== this.generation) return;
      const auth = error instanceof ApiError && error.kind === "auth";
      if (auth) client.clearSession();
      this.value = { ...this.value!, state: auth ? "sign-in" : error instanceof ApiError && error.kind === "network" ? "offline" : "error",
        checkedAt: new Date().toISOString(), error: error instanceof ApiError ? error.message : "Could not load Codex LB data.",
        ...(auth ? { overview: null, fetchedAt: null, session: null } : {}), serverVersion: client.version };
    }
  }
}
