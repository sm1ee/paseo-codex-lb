import { useState } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, copyText } from "@getpaseo/plugin/client/react-native";
import { ExternalLink, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { accountActionRpc, canManageAccounts, resetConsumeRpc, resetPreviewRpc, type AccountActionInput, type ResetPreview } from "../shared/actions";
import type { Account } from "../shared/contracts";
import { accountWindows, statusLabel } from "../shared/quota";
import { Button, QuotaBar } from "./components";
import type { LBData } from "./data";

export function AccountControls({ account, label, data, theme, close }: { account: Account; label: string; data: LBData; theme: PluginTheme; close: () => void }) {
  const update = useRpc(accountActionRpc);
  const prepareReset = useRpc(resetPreviewRpc);
  const consumeReset = useRpc(resetConsumeRpc);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [alias, setAlias] = useState(account.alias ?? "");
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const snapshot = data.snapshot!;
  const canWrite = canManageAccounts(snapshot.session) && snapshot.state === "connected" && !data.stale;
  const target = { serverUrl: snapshot.serverUrl, accountId: account.accountId };
  const colors = theme.colors;

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage(null); setFailed(false);
    try { await action(); }
    catch { setFailed(true); setMessage("Could not complete the request. Refresh the connection and try again."); }
    finally { setBusy(false); }
  }
  async function change(action: AccountActionInput["action"]) {
    const result = await update({ ...target, action });
    data.setSnapshot(result.snapshot); setMessage(result.message); setFailed(!result.ok);
  }

  return <Modal title={preview ? "Use a reset credit?" : label} open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <Modal.Content contentContainerStyle={{ padding: 20, gap: 18 }}>
      {preview ? <>
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{label}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 20 }}>
          {uncertain || preview.retry ? "The previous result is uncertain. Retrying uses the same redemption request and cannot consume a second credit for that request."
            : `Use one of this account's ${preview.availableCount} available reset credits. Codex LB will redeem the credit that expires first.`}
        </Text>
        {preview.nearestExpiresAt ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>First expiry: {new Date(preview.nearestExpiresAt).toLocaleString("en-US")}</Text> : null}
        <Text style={{ color: colors.statusWarning, fontSize: 12 }}>This spends a reset credit and cannot be undone.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button theme={theme} disabled={busy || !canWrite} onPress={() => void run(async () => {
            const result = await consumeReset({ ...target, confirmationId: preview.confirmationId });
            data.setSnapshot(result.snapshot); setFailed(!result.ok); setMessage(result.message);
            if (result.ok) { setPreview(null); setUncertain(false); } else setUncertain(true);
          })}>{busy ? "Using credit…" : uncertain || preview.retry ? "Retry same request" : "Use one reset credit"}</Button>
          <Button theme={theme} secondary disabled={busy} onPress={() => { setPreview(null); setMessage(null); }}>Back</Button>
        </View>
      </> : <>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{account.planType} · {statusLabel(account.status)}</Text>
          {!data.values?.hideAccountNames && account.alias ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{account.alias}</Text> : null}
        </View>
        {accountWindows(account).map((window, i) => <QuotaBar key={`${window.id}-${i}`} window={window} theme={theme} now={data.now} />)}
        <View style={{ gap: 7 }}>
          <Text style={{ color: colors.foreground, fontSize: 13 }}>Reset credits: {account.availableResetCredits}</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Extra credit balance: {account.creditsUnlimited ? "Unlimited" : account.creditsBalance == null ? "Not reported" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(account.creditsBalance)}</Text>
        </View>
        {canWrite ? <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {account.status === "active" ? <Button theme={theme} secondary disabled={busy} onPress={() => void run(() => change({ kind: "pause" }))}>Pause account</Button> : null}
            {["paused", "deactivated"].includes(account.status) ? <Button theme={theme} secondary disabled={busy} onPress={() => void run(() => change({ kind: "resume" }))}>Resume account</Button> : null}
            <Button theme={theme} disabled={busy || account.availableResetCredits < 1 || !["active", "rate_limited", "quota_exceeded"].includes(account.status)}
              onPress={() => void run(async () => { setPreview(await prepareReset(target)); setUncertain(false); })}>Use reset credit ({account.availableResetCredits})</Button>
          </View>
          <SettingsSelect label="Routing policy" value={account.routingPolicy} disabled={busy}
            options={[{ value: "normal", label: "Normal" }, { value: "burn_first", label: "Burn first" }, { value: "preserve", label: "Preserve" }]}
            onValueChange={(policy) => void run(() => change({ kind: "routing", policy: policy as "normal" | "burn_first" | "preserve" }))} />
          <SettingsSwitch label="Warm up after a quota reset" hint="Allows Codex LB to send a small request after the limit resets."
            value={account.limitWarmupEnabled} disabled={busy} onValueChange={(enabled) => void run(() => change({ kind: "warmup", enabled }))} />
          {!data.values?.hideAccountNames ? <View style={{ gap: 8 }}>
            <TextInput accessibilityLabel="Account alias" value={alias} onChangeText={setAlias} placeholder="Alias (optional)" placeholderTextColor={colors.foregroundMuted}
              editable={!busy} maxLength={255} style={{ padding: 12, color: colors.foreground, backgroundColor: colors.surface2, borderRadius: 8 }} />
            <View style={{ alignItems: "flex-start" }}><Button theme={theme} secondary disabled={busy || alias === (account.alias ?? "")} onPress={() => void run(() => change({ kind: "alias", alias }))}>Save alias</Button></View>
          </View> : null}
        </> : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{data.stale ? "Reconnect before changing this account." : "This login has read-only account access."}</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <Button theme={theme} secondary onPress={() => void run(async () => { await copyText(account.email); setMessage("Email copied."); })}>Copy email</Button>
          <ExternalLink href={`${snapshot.serverUrl}/accounts`}><Text style={{ color: colors.accent, fontSize: 12 }}>Open in dashboard ↗</Text></ExternalLink>
        </View>
      </>}
      {message ? <Text style={{ color: failed ? colors.statusDanger : colors.statusSuccess, fontSize: 12, lineHeight: 18 }}>{message}</Text> : null}
    </Modal.Content>
  </Modal>;
}
