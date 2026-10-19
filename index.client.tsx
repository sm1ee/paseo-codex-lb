import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { Dashboard } from "./client/dashboard";
import { SettingsScreen } from "./client/settings-screen";
import { useLBSnapshot } from "./client/data";
import { accountWindows } from "./shared/quota";
import { quotaColor } from "./client/components";

function LBItem({ currentScreen, openScreen, theme, host }: PluginSidebarItemProps) {
  const data = useLBSnapshot(host.id);
  const snapshot = data.snapshot;
  const label = data.settings.status !== "ready" && data.settings.status !== "loading" ? "Settings"
    : data.query.error ? "Offline" : data.stale ? "Stale"
    : snapshot?.state === "sign-in" || snapshot?.state === "totp" ? "Sign in"
    : snapshot?.state === "offline" ? "Offline" : snapshot?.state === "error" ? "Error" : null;
  const accounts = snapshot?.overview?.accounts ?? [];
  if (!accounts.length) return <SidebarRow
      icon="Gauge"
      label="Codex LB"
      active={currentScreen?.screenId === "overview"}
      trailing={label ? <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>{label}</Text> : undefined}
      onPress={() => openScreen({ screenId: "overview" })}
    />;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 6, backgroundColor: currentScreen?.screenId === "overview" ? theme.colors.surface1 : undefined, opacity: data.stale ? 0.6 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label ? `Open Codex LB. ${label}` : "Open Codex LB"}
        onPress={() => openScreen({ screenId: "overview" })} style={{ paddingVertical: 3, paddingRight: 2 }}>
        <Icon name={label ? "CircleAlert" : "Gauge"} size={15} color={label ? theme.colors.statusWarning : theme.colors.foregroundMuted} />
      </Pressable>
      {accounts.slice(0, 6).map((account) => {
        const window = accountWindows(account).filter((w) => w.remaining !== null).sort((a, b) => a.remaining! - b.remaining!)[0];
        const color = account.status === "paused" ? theme.colors.foregroundMuted : quotaColor(window?.remaining ?? null, theme);
        return <Pressable key={account.accountId} accessibilityRole="button"
          accessibilityLabel={`Open ${data.values?.hideAccountNames ? "account" : account.email || "account"}. ${window ? `${window.label}: ${Math.round(window.remaining!)} percent remaining` : "Quota unknown"}. ${account.status}`}
          onPress={() => openScreen({ screenId: "overview", params: { accountId: account.accountId } })} style={{ flex: 1, minWidth: 25, gap: 3, alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, width: "100%", justifyContent: "center" }}>
            {!data.values?.hideAccountNames ? <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.foregroundMuted, fontSize: 9, flexShrink: 1 }}>{account.email.split("@")[0] || "Account"}</Text> : null}
            <Text style={{ color, fontSize: 10, flexShrink: 0, fontVariant: ["tabular-nums"] }}>{window ? `${Math.round(window.remaining!)}%` : "—"}</Text>
          </View>
          <View style={{ height: 4, width: "100%", backgroundColor: theme.colors.surface2, borderRadius: 2, overflow: "hidden" }}>
            <View style={{ height: 4, width: `${window?.remaining ?? 0}%`, backgroundColor: color, borderRadius: 2 }} />
          </View>
        </Pressable>;
      })}
      {accounts.length > 6 ? <Pressable accessibilityRole="button" accessibilityLabel="Show all Codex LB accounts" onPress={() => openScreen({ screenId: "overview" })} style={{ justifyContent: "center" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>+{accounts.length - 6}</Text>
      </Pressable> : null}
  </View>;
}

export default function contribute(client: PluginClientContext) {
  const remove = [
    client.addScreen({ id: "overview", title: "Codex LB", Component: (props) => <Dashboard {...props} onSettings={() => client.openSettings("connection")} onCloseAccount={() => client.openScreen({ screenId: "overview" })} /> }),
    client.addSidebarFooterItem({ id: "codex-lb", title: "Codex LB", Component: LBItem }),
    client.addSettingsScreen({ id: "connection", title: "Codex LB", icon: "Gauge", Component: SettingsScreen }),
    client.addCommandCenterItem({ id: "open-codex-lb", title: "Open Codex LB", icon: "Gauge", context: "global", keywords: ["codex", "lb", "quota", "usage"], onSelect: ({ openScreen }) => openScreen({ screenId: "overview" }) }),
  ];
  return () => { for (const dispose of remove.reverse()) dispose(); };
}
