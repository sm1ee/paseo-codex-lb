import { expect, it } from "vitest";
import { preferences, snapshotSchema } from "../shared/contracts";
import { AccountService } from "./accounts";
import { LBService } from "./service";

it.skipIf(process.env.PASEO_CODEX_LB_LIVE_TEST !== "1")("connects to a real dashboard, restores Keychain login, and reads reset-credit details", async () => {
  const values = preferences.schema.parse({ serverUrl: process.env.PASEO_CODEX_LB_LIVE_URL ?? "http://127.0.0.1:2455" });
  const settings = { read: async () => ({ status: "ready" as const, revision: "live", values }), subscribe: () => () => {} };
  let service = new LBService(settings);
  let accounts = new AccountService(service);
  try {
    let snapshot = await service.snapshot(true);
    if (snapshot.state === "sign-in") {
      const result = await service.login({ serverUrl: snapshot.serverUrl, method: "statusbar", role: "admin", remember: true });
      expect(result.ok).toBe(true);
      snapshot = snapshotSchema.parse(result.snapshot);
    }
    expect(snapshot.state).toBe("connected");
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(Boolean(snapshot.overview)).toBe(true);
    expect(snapshot.credentialError).toBeNull();
    const candidate = snapshot.overview!.accounts.find((account) => account.availableResetCredits > 0 && ["active", "rate_limited", "quota_exceeded"].includes(account.status));
    if (candidate) {
      const preview = await accounts.preview(snapshot.serverUrl, candidate.accountId);
      expect(preview.availableCount > 0).toBe(true);
      expect(Boolean(preview.confirmationId)).toBe(true);
    }
    // No account mutations or redemption calls are made by this integration check.
    accounts.stop(); service.stop();
    service = new LBService(settings); accounts = new AccountService(service);
    const restored = await service.snapshot(true);
    expect(restored.state).toBe("connected");
    expect(restored.hasSavedLogin).toBe(true);
    expect(Boolean(restored.overview)).toBe(true);
  } finally { accounts.stop(); service.stop(); }
}, 60_000);
