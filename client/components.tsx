import type { ReactNode } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import { resetLabel, type QuotaWindow } from "../shared/quota";

export function Button({ children, onPress, theme, disabled, secondary = false }: {
  children: ReactNode; onPress: () => void; theme: PluginTheme; disabled?: boolean; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8, opacity: disabled ? 0.5 : 1,
      backgroundColor: secondary ? theme.colors.surface2 : theme.colors.accent }}>
    <Text style={{ color: secondary ? theme.colors.foreground : theme.colors.accentForeground, fontSize: 13, fontWeight: "600" }}>{children}</Text>
  </Pressable>;
}

export function quotaColor(remaining: number | null, theme: PluginTheme): string {
  return remaining == null ? theme.colors.foregroundMuted : remaining <= 10 ? theme.colors.statusDanger
    : remaining <= 30 ? theme.colors.statusWarning : theme.colors.accent;
}

export function QuotaBar({ window, theme, now, showReset = true }: { window: QuotaWindow; theme: PluginTheme; now: number; showReset?: boolean }) {
  const color = quotaColor(window.remaining, theme);
  return <View style={{ gap: 6, flex: 1, minWidth: 140 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{window.label}</Text>
      <Text style={{ color, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{window.remaining == null ? "Unknown" : `${Math.round(window.remaining)}% left`}</Text>
    </View>
    <View accessible accessibilityLabel={`${window.label}: ${window.remaining == null ? "quota unknown" : `${Math.round(window.remaining)} percent remaining`}`}
      style={{ height: 5, backgroundColor: theme.colors.surface2, borderRadius: 3, overflow: "hidden" }}>
      {window.remaining != null ? <View style={{ width: `${window.remaining}%`, height: 5, backgroundColor: color, borderRadius: 3 }} /> : null}
    </View>
    {window.remainingCredits != null && window.capacityCredits != null ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
      {new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(window.remainingCredits)} / {new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(window.capacityCredits)} credits
    </Text> : null}
    {showReset ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }} accessibilityLabel={window.resetsAt ? `Reset: ${window.resetsAt}` : undefined}>{resetLabel(window.resetsAt, now)}</Text> : null}
  </View>;
}

export function Metric({ label, value, theme }: { label: string; value: string; theme: PluginTheme }) {
  return <View style={{ gap: 5, flexGrow: 1, minWidth: 100 }}>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
    <Text style={{ color: theme.colors.foreground, fontSize: 23, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{value}</Text>
  </View>;
}
