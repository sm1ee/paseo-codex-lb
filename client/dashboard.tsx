import { useEffect, useState } from "react";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { ScrollView, Text, TextInput, View } from "react-native";
import { logoutRpc, forgetLoginRpc, type Account } from "../shared/contracts";
import { accountName, accountWindows, ageLabel, aggregateWindows, countsForQuota, needsAttention, resetLabel, statusLabel } from "../shared/quota";
import { useLBSnapshot } from "./data";
import { Button, Metric, QuotaBar } from "./components";
import { LoginForm } from "./login-form";
import { AccountControls } from "./account-controls";

const periods = { "1d": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" };
const number = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

function AccountCard({ account, name, theme, compact, now, onManage }: { account: Account; name: string; theme: PluginScreenProps["theme"]; compact: boolean; now: number; onManage: () => void }) {
  const warning = needsAttention(account.status);
  return <View style={{ backgroundColor: theme.colors.surface1, padding: compact ? 14 : 18, borderRadius: 12, gap: 16 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "600" }}>{name}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {account.planType} · {account.routingPolicy.replace(/_/g, " ")}
        </Text>
      </View>
      <Text style={{ color: warning ? theme.colors.statusWarning : account.status === "active" ? theme.colors.statusSuccess : theme.colors.foregroundMuted, fontSize: 12 }}>
        {statusLabel(account.status)}
      </Text>
    </View>
    <View style={{ flexDirection: compact ? "column" : "row", gap: compact ? 14 : 24 }}>
      {accountWindows(account).map((window, i) => <QuotaBar key={`${window.id}-${i}`} window={window} theme={theme} now={now} />)}
    </View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}><Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
      {account.availableResetCredits} reset credit{account.availableResetCredits === 1 ? "" : "s"}
      {account.resetCreditNearestExpiresAt ? ` · ${resetLabel(account.resetCreditNearestExpiresAt, now).replace("Resets in", "Expires in").replace("Reset due", "Expiry due")}` : ""}
    </Text><Button theme={theme} secondary onPress={onManage}>Manage</Button></View>
    {account.creditsBalance != null || account.creditsUnlimited ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Extra credits: {account.creditsUnlimited ? "Unlimited" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(account.creditsBalance!)}</Text> : null}
  </View>;
}

export function Dashboard(props: PluginScreenProps & { onSettings: () => void; onCloseAccount: () => void }) {
  const { theme, layout, host, onSettings } = props;
  const data = useLBSnapshot(host.id);
  const logout = useRpc(logoutRpc);
  const forgetLogin = useRpc(forgetLoginRpc);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(props.params.accountId ?? null);
  useEffect(() => setSelectedId(props.params.accountId ?? null), [props.params.accountId]);
  const snapshot = data.snapshot;
  const overview = snapshot?.overview;
  const accounts = overview?.accounts ?? [];
  const aggregates = aggregateWindows(accounts);
  const attention = accounts.filter((a) => needsAttention(a.status)).length;
  const usable = accounts.filter((a) => countsForQuota(a.status)).length;
  const hidden = data.values?.hideAccountNames ?? false;
  const namedAccounts = accounts.map((account, index) => ({ account, name: accountName(account, hidden, index) }));
  const selected = namedAccounts.find(({ account }) => account.accountId === selectedId);
  const visible = namedAccounts.filter(({ account, name }) => (filter === "all" || needsAttention(account.status)) &&
    `${name} ${account.planType} ${statusLabel(account.status)}`.toLowerCase().includes(search.toLowerCase()));
  const points = overview?.trends?.tokens ?? [];
  const groupSize = Math.max(1, Math.ceil(points.length / 48));
  const bars: number[] = [];
  for (let i = 0; i < points.length; i += groupSize) bars.push(points.slice(i, i + groupSize).reduce((sum, point) => sum + Math.max(0, point.v), 0));
  const max = Math.max(1, ...bars);
  const colors = theme.colors;

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setActionError(null);
    try { await action(); } catch { setActionError("Could not complete the request. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 28, paddingBottom: 40 }}>
    <View style={{ width: "100%", maxWidth: 960, alignSelf: "center", gap: 20 }}>
      <View style={{ flexDirection: layout.compact ? "column" : "row", justifyContent: "space-between", gap: 14 }}>
        <View style={{ gap: 6, flex: 1 }}>
          <Text style={{ color: colors.foreground, fontSize: 26, fontWeight: "700" }}>Codex LB</Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
            {snapshot ? `${snapshot.state === "connected" && !data.stale ? "Connected" : data.stale ? "Stale data" : ({ "sign-in": "Sign-in required", totp: "Authentication code required", offline: "Offline", error: "Connection error" } as Record<string, string>)[snapshot.state]} · ${ageLabel(snapshot.fetchedAt, data.now)}` : "Connecting…"}
            {snapshot?.serverVersion ? ` · v${snapshot.serverVersion}` : ""}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Button theme={theme} secondary onPress={onSettings}>Connection</Button>
          <Button theme={theme} disabled={busy || data.query.isFetching || data.settings.status !== "ready"} onPress={() => void act(data.refresh)}>
            {busy || data.query.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </View>
      </View>

      {data.settings.status !== "ready" && data.settings.status !== "loading" ? <Text style={{ color: colors.statusDanger }}>Connection settings could not be loaded. Open Connection to fix them.</Text> : null}
      {data.query.error ? <Text style={{ color: colors.statusDanger }}>Could not reach the plugin on your Paseo host. Last fetched data may be out of date.</Text> : null}
      {snapshot?.error ? <Text accessibilityRole="alert" style={{ color: snapshot.state === "offline" ? colors.statusWarning : colors.statusDanger, fontSize: 13 }}>{snapshot.error}</Text> : null}
      {snapshot?.credentialError ? <Text style={{ color: colors.statusWarning, fontSize: 13 }}>{snapshot.credentialError}</Text> : null}
      {actionError ? <Text style={{ color: colors.statusDanger }}>{actionError}</Text> : null}
      {snapshot ? <LoginForm key={snapshot.serverUrl} data={data} theme={theme} /> : null}
      {snapshot?.session?.mustChangePassword || snapshot?.session?.totpEnrollmentRequired ? <Text style={{ color: colors.statusWarning }}>Your login needs setup. Open the dashboard to finish it, then sign in again.</Text> : null}

      {overview ? <View style={{ gap: 20, opacity: data.stale ? 0.6 : 1 }}>
        <View style={{ padding: 20, backgroundColor: colors.surface1, borderRadius: 12, gap: 18 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>Quota remaining</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{usable} usable / {accounts.length} accounts{attention ? ` · ${attention} need attention` : ""}</Text>
          </View>
          {aggregates.length ? <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 20, flexWrap: "wrap" }}>
            {aggregates.map((window) => <View key={window.id} style={{ flex: 1, minWidth: 160, gap: 7 }}>
              <QuotaBar window={window} theme={theme} now={data.now} showReset={false} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{window.method === "credits" ? "Weighted by credit capacity" : "Account average"} · {window.count} account{window.count === 1 ? "" : "s"}</Text>
            </View>)}
          </View> : <Text style={{ color: colors.foregroundMuted }}>No quota reported for usable accounts.</Text>}
          <Text style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
            Paused, signed-out, deactivated, and unrecognized states are excluded. Rate-limited and exhausted accounts stay in the totals. Missing values are unknown.
          </Text>
        </View>

        <View style={{ padding: 20, backgroundColor: colors.surface1, borderRadius: 12, gap: 18 }}>
          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>Usage · {periods[snapshot!.timeframe]}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
            <Metric theme={theme} label="Requests" value={number(overview.summary?.metrics?.requests)} />
            <Metric theme={theme} label="Tokens" value={number(overview.summary?.metrics?.tokens)} />
            <Metric theme={theme} label="Estimated cost" value={overview.summary?.cost?.totalUsd == null ? "—" : `$${overview.summary.cost.totalUsd.toFixed(2)}`} />
            <Metric theme={theme} label="Error rate" value={overview.summary?.metrics?.errorRate == null ? "—" : `${(overview.summary.metrics.errorRate * 100).toFixed(1)}%`} />
          </View>
          {bars.length ? <View accessible accessibilityLabel={`Token usage over ${periods[snapshot!.timeframe].toLowerCase()}`} style={{ flexDirection: "row", height: 76, alignItems: "flex-end", gap: 3 }}>
            {bars.map((v, i) => <View key={i} style={{ flex: 1, height: v > 0 ? Math.max(2, v / max * 76) : 0, backgroundColor: colors.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />)}
          </View> : <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>No token history reported.</Text>}
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Dashboard statistics, fetched {snapshot!.fetchedAt ? new Date(snapshot!.fetchedAt).toLocaleString("en-US") : "at an unknown time"}. Quotas follow the server's own polling schedule.</Text>
        </View>

        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>Accounts</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button theme={theme} secondary={filter !== "all"} onPress={() => setFilter("all")}>All ({accounts.length})</Button>
              <Button theme={theme} secondary={filter !== "attention"} onPress={() => setFilter("attention")}>Needs attention ({attention})</Button>
            </View>
          </View>
          <TextInput accessibilityLabel="Filter accounts" placeholder="Filter accounts…" placeholderTextColor={colors.foregroundMuted}
            value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false}
            style={{ color: colors.foreground, backgroundColor: colors.surface1, borderRadius: 8, padding: 12, fontSize: 13 }} />
          {visible.map(({ account, name }) => <AccountCard key={account.accountId} account={account} name={name} theme={theme} compact={layout.compact} now={data.now} onManage={() => setSelectedId(account.accountId)} />)}
          {!visible.length ? <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{accounts.length ? "No accounts match this filter." : "No accounts are registered in Codex LB."}</Text> : null}
        </View>
      </View> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        {snapshot ? <ExternalLink href={snapshot.serverUrl}><Text style={{ color: colors.accent, fontSize: 12 }}>Open dashboard ↗</Text></ExternalLink> : null}
        {snapshot?.session?.authenticated ? <Button theme={theme} secondary disabled={busy} onPress={() => void act(async () => data.setSnapshot(await logout({ serverUrl: snapshot.serverUrl })))}>Sign out</Button> : null}
        {snapshot?.credentialStore === "keychain" && (snapshot.hasSavedLogin || snapshot.credentialError) ? <Button theme={theme} secondary disabled={busy} onPress={() => void act(async () => data.setSnapshot(await forgetLogin({ serverUrl: snapshot.serverUrl })))}>Forget saved login</Button> : null}
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Manage accounts here, or open the full dashboard.</Text>
      </View>
      {selected ? <AccountControls key={selected.account.accountId} account={selected.account} label={selected.name} data={data} theme={theme} close={() => { setSelectedId(null); props.onCloseAccount(); }} /> : null}
    </View>
  </ScrollView>;
}
