import { useEffect, useState } from "react";
import type { PluginSurfaceProps, SettingsState } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { preferences } from "../shared/contracts";

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  if (settings.status !== "ready") return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.colors.foreground }}>{settings.status === "loading" ? "Loading settings…" : settings.error}</Text>
    {settings.status === "invalid" ? <SettingsAction label="Restore default connection" actionLabel="Reset" onPress={() => void settings.reset()} /> : null}
  </View>;
  return <ConnectionSettings settings={settings} theme={theme} />;
}

function ConnectionSettings({ settings, theme }: { settings: Extract<SettingsState<typeof preferences.schema>, { status: "ready" }>; theme: PluginSurfaceProps["theme"] }) {
  const [base, setBase] = useState({ values: settings.values, revision: settings.revision });
  const [draft, setDraft] = useState(settings.values);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.values);
  const conflict = settings.revision !== base.revision;
  useEffect(() => {
    if (!dirty || JSON.stringify(settings.values) === JSON.stringify(draft)) {
      setBase({ values: settings.values, revision: settings.revision });
      setDraft(settings.values);
    }
  }, [settings.revision]);
  return <View style={{ gap: 20 }}>
    <SettingsSection title="Connection">
      <SettingsCard>
        <SettingsInput label="Server URL" hint="Connects from the Paseo daemon, so localhost means the daemon's machine."
          key={base.revision} initialValue={draft.serverUrl} onChangeText={(serverUrl) => { setDraft({ ...draft, serverUrl }); setSaved(false); }} placeholder="http://127.0.0.1:2455" />
        <SettingsSelect label="Refresh every" value={String(draft.refreshSeconds)}
          options={[15, 30, 60, 120, 300].map((n) => ({ label: `${n} seconds`, value: String(n) }))} disabled={settings.saving}
          onValueChange={(value) => { setDraft({ ...draft, refreshSeconds: Number(value) }); setSaved(false); }} />
        <SettingsSelect label="Usage period" value={draft.timeframe} disabled={settings.saving}
          options={[{ label: "Last 24 hours", value: "1d" }, { label: "Last 7 days", value: "7d" }, { label: "Last 30 days", value: "30d" }]}
          onValueChange={(timeframe) => { setDraft({ ...draft, timeframe }); setSaved(false); }} />
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title="Privacy">
      <SettingsCard><SettingsSwitch label="Hide account names" hint="Hide email prefixes in the sidebar and show numbered labels on the screen."
        value={draft.hideAccountNames} disabled={settings.saving}
        onValueChange={(hideAccountNames) => { setDraft({ ...draft, hideAccountNames }); setSaved(false); }} /></SettingsCard>
    </SettingsSection>
    <SettingsCard><SettingsAction label="Save settings" hint="Changing the server URL ends the current plugin session." actionLabel="Save"
      disabled={settings.saving || !dirty || conflict}
      onPress={() => void settings.save({ ...draft, serverUrl: draft.serverUrl.trim() }, base.revision).then(setSaved)} /></SettingsCard>
    {conflict ? <SettingsCard><SettingsAction label="Settings changed on another client" hint="Your draft has been kept. Load the latest settings to discard it." actionLabel="Load latest"
      onPress={() => { setBase({ values: settings.values, revision: settings.revision }); setDraft(settings.values); setSaved(false); }} /></SettingsCard> : null}
    {settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
    {saved ? <Text style={{ color: theme.colors.statusSuccess }}>Settings saved.</Text> : null}
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
      Sign in from the Codex LB screen. Account and routing controls are in the dashboard.
    </Text>
  </View>;
}
