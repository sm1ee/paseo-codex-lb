import { describe, expect, it } from "vitest";
import { keychainArgument, MacKeychainStore } from "./credentials";

describe("Keychain storage", () => {
  it("quotes arguments and rejects raw command separators", () => {
    expect(keychainArgument('one"two\\three')).toBe('"one\\"two\\\\three"');
    expect(() => keychainArgument("one\ncommand")).toThrow("control");
    expect(() => keychainArgument("one\u0000two")).toThrow("control");
    expect(keychainArgument(JSON.stringify({ password: 'line\n"quote"\\slash' }))).not.toContain("\n");
  });

  it.skipIf(process.env.PASEO_CODEX_LB_KEYCHAIN_TEST !== "1" || process.platform !== "darwin")("round-trips a temporary item through the real macOS Keychain", async () => {
    const store = new MacKeychainStore(`sh.paseo.codex-lb.selftest.${process.pid}.${Date.now()}`);
    const url = "https://keychain-test.invalid";
    const login = { role: "admin" as const, username: "test", password: 'test-only "quotes" \\ unicode 한글\nnewline' };
    try {
      expect(await store.read(url)).toBeNull();
      await store.write(url, login);
      expect(await store.read(url)).toEqual(login);
      await store.write(url, { ...login, password: "updated-test-value" });
      expect((await store.read(url))?.password).toBe("updated-test-value");
    } finally { await store.remove(url); }
    expect(await store.read(url)).toBeNull();
  }, 60_000);
});
