import { execFile } from "node:child_process";
import { z } from "zod";

export const canUseSavedLogin = process.platform === "darwin";

const savedLoginSchema = z.object({
  role: z.enum(["admin", "guest"]),
  username: z.string().max(64).optional(),
  password: z.string().max(4096),
});
export type SavedLogin = z.output<typeof savedLoginSchema>;
export interface CredentialStore {
  kind: "keychain" | "none";
  read(serverUrl: string): Promise<SavedLogin | null>;
  write(serverUrl: string, login: SavedLogin): Promise<void>;
  remove(serverUrl: string): Promise<void>;
}

function runSecurity(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/security", args, { timeout: 15_000, maxBuffer: 65_536, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(Object.assign(new Error("macOS Keychain could not be accessed."), { code: error.code }));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

// security's interactive tokenizer accepts double-quoted arguments with escaped quotes and backslashes.
// The credential is JSON-encoded first, so control characters cannot become additional commands.
export function keychainArgument(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error("Keychain values cannot contain unencoded control characters.");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class MacKeychainStore implements CredentialStore {
  readonly kind = "keychain" as const;
  constructor(private readonly service = "sh.paseo.codex-lb.dashboard-login") {}

  async read(serverUrl: string): Promise<SavedLogin | null> {
    let raw: string;
    try { raw = await runSecurity(["find-generic-password", "-s", this.service, "-a", serverUrl, "-w"]); }
    catch (error) {
      if ((error as { code?: number }).code === 44) return null;
      throw new Error("The saved login could not be read from macOS Keychain.");
    }
    try {
      const trimmed = raw.trim();
      // security prints non-ASCII data as hex even with -w.
      const text = /^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0 ? Buffer.from(trimmed, "hex").toString("utf8") : raw;
      return savedLoginSchema.parse(JSON.parse(text));
    }
    catch { throw new Error("The saved Keychain login is invalid. Remove it and sign in again."); }
  }

  async write(serverUrl: string, login: SavedLogin): Promise<void> {
    const value = savedLoginSchema.parse(login);
    const command = ["add-generic-password", "-U", "-s", keychainArgument(this.service), "-a", keychainArgument(serverUrl),
      "-l", keychainArgument("Paseo Codex LB"), "-X", Buffer.from(JSON.stringify(value), "utf8").toString("hex")].join(" ");
    // Only '-i' appears in the process arguments; the password travels over stdin, never a shell or argv.
    await runSecurity(["-i"], `${command}\n`);
    const stored = await this.read(serverUrl);
    if (!stored || stored.password !== value.password || stored.role !== value.role || stored.username !== value.username) {
      throw new Error("The login could not be saved in macOS Keychain.");
    }
  }

  async remove(serverUrl: string): Promise<void> {
    try { await runSecurity(["delete-generic-password", "-s", this.service, "-a", serverUrl]); }
    catch (error) { if ((error as { code?: number }).code !== 44) throw new Error("The saved login could not be removed from macOS Keychain."); }
  }
}

export function credentialStore(): CredentialStore {
  return canUseSavedLogin ? new MacKeychainStore() : {
    kind: "none", read: async () => null,
    write: async () => { throw new Error("Secure login storage is not available on this host. Sign in without saving."); },
    remove: async () => {},
  };
}

export function readStatusBarPassword(serverUrl: string, role: "admin" | "guest"): Promise<string> {
  if (!canUseSavedLogin) return Promise.reject(new Error("Saved Status Bar login is available on macOS only."));
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/security", ["find-generic-password", "-s", `local.codex-lb.statusbar.${role}-password`, "-a", serverUrl, "-w"],
      { timeout: 15_000, maxBuffer: 16_384, encoding: "utf8" }, (error, stdout) => {
        if (error || !stdout) reject(new Error("No saved Status Bar login could be read for this server and role. Enter the password instead."));
        else resolve(stdout.replace(/\r?\n$/, ""));
      });
  });
}
