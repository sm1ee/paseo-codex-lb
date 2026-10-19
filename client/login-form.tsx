import { useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, TextInput, View } from "react-native";
import { loginRpc, logoutRpc, type LoginInput } from "../shared/contracts";
import type { LBData } from "./data";
import { Button } from "./components";

export function LoginForm({ data, theme }: { data: LBData; theme: PluginTheme }) {
  const login = useRpc(loginRpc);
  const logout = useRpc(logoutRpc);
  const [role, setRole] = useState<"admin" | "guest">("admin");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshot = data.snapshot;
  if (!snapshot || snapshot.state === "connected" || snapshot.state === "offline" || snapshot.state === "error") return null;
  const totp = snapshot.state === "totp";
  const field = { color: theme.colors.foreground, backgroundColor: theme.colors.surface2, padding: 12, borderRadius: 8, fontSize: 14 };

  async function submit(method: LoginInput["method"]) {
    setBusy(true); setError(null);
    try {
      const result = await login({ serverUrl: snapshot!.serverUrl, role, method, remember, password, username: username.trim() || undefined, code: method === "totp" ? code : undefined });
      data.setSnapshot(result.snapshot);
      if (result.ok) { setPassword(""); setCode(""); }
      else setError(result.error);
    } catch { setError("Could not complete sign-in. Check your Paseo connection and try again."); }
    finally { setBusy(false); }
  }

  if (snapshot.session?.bootstrapRequired) return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>Set up Codex LB first</Text>
    <Text style={{ color: theme.colors.foregroundMuted }}>Open the dashboard to finish its initial setup, then refresh here.</Text>
  </View>;

  return <View style={{ padding: 18, borderRadius: 12, backgroundColor: theme.colors.surface1, gap: 12 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "600" }}>{totp ? "Two-factor authentication" : "Sign in to Codex LB"}</Text>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
      {totp ? "Enter the six-digit code from your authenticator." : "Use your dashboard login. Proxy API keys cannot sign in to the dashboard."}
    </Text>
    {!totp && snapshot.session?.guestAccessEnabled ? <View style={{ flexDirection: "row", gap: 8 }}>
      <Button theme={theme} secondary={role !== "admin"} disabled={busy} onPress={() => { setRole("admin"); setPassword(""); setError(null); }}>Dashboard login</Button>
      <Button theme={theme} secondary={role !== "guest"} disabled={busy} onPress={() => { setRole("guest"); setPassword(""); setError(null); }}>Guest</Button>
    </View> : null}
    {totp ? <TextInput accessibilityLabel="Authentication code" placeholder="123456" placeholderTextColor={theme.colors.foregroundMuted}
      value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} editable={!busy} style={field} /> : <>
      {role === "admin" && snapshot.session?.login?.usernameField === "shown" ? <TextInput accessibilityLabel="Dashboard username" placeholder="Username"
        placeholderTextColor={theme.colors.foregroundMuted} value={username} onChangeText={setUsername} editable={!busy} autoCapitalize="none" autoCorrect={false} style={field} /> : null}
      {role === "admin" || snapshot.session?.guestPasswordRequired ? <TextInput accessibilityLabel="Dashboard password" placeholder={role === "guest" ? "Guest password" : "Dashboard password"}
        placeholderTextColor={theme.colors.foregroundMuted} value={password} onChangeText={setPassword} secureTextEntry editable={!busy} autoCapitalize="none" autoCorrect={false} style={field} /> : null}
    </>}
    {!totp && snapshot.credentialStore === "keychain" ? <SettingsSwitch label="Save login in Keychain" hint="Sign in automatically on this Paseo host. Authentication codes are never saved."
      value={remember} onValueChange={setRemember} disabled={busy} /> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button theme={theme} disabled={busy || (totp ? code.length !== 6 : role === "admin" ? !password : Boolean(snapshot.session?.guestPasswordRequired && !password))}
        onPress={() => void submit(totp ? "totp" : role === "guest" ? "guest" : "password")}>
        {busy ? "Signing in…" : totp ? "Verify code" : "Sign in"}
      </Button>
      {!totp && snapshot.savedLoginAvailable ? <Button theme={theme} secondary disabled={busy} onPress={() => void submit("statusbar")}>Use saved Status Bar login</Button> : null}
      {!totp && snapshot.hasSavedLogin ? <Button theme={theme} secondary disabled={busy} onPress={() => void submit("saved")}>Use saved plugin login</Button> : null}
      {totp ? <Button theme={theme} secondary disabled={busy} onPress={() => {
        setBusy(true); setError(null);
        void logout({ serverUrl: snapshot.serverUrl }).then(data.setSnapshot).catch(() => setError("Could not reset sign-in. Try refreshing."))
          .finally(() => { setBusy(false); setCode(""); });
      }}>Start over</Button> : null}
    </View>
    {error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }} accessibilityRole="alert">{error}</Text> : null}
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
      {snapshot.credentialStore === "keychain" ? "Saved logins are kept in macOS Keychain on this Paseo host. Session cookies stay in memory." : "Secure password storage is not available on this host. This sign-in lasts until the session expires or the plugin restarts."}
    </Text>
  </View>;
}
