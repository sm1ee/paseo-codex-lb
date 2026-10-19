import type { Account } from "./contracts";

export interface QuotaWindow {
  id: string;
  label: string;
  shortLabel: string;
  minutes: number | null;
  remaining: number | null;
  resetsAt: string | null;
  capacityCredits: number | null;
  remainingCredits: number | null;
}
export interface AggregateWindow extends QuotaWindow {
  count: number;
  method: "credits" | "average";
}

export function clampPercent(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
}

export function durationName(minutes: number | null, fallback: string): { label: string; shortLabel: string } {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return { label: fallback, shortLabel: fallback.slice(0, 1) };
  if (minutes === 10080) return { label: "Weekly", shortLabel: "W" };
  if (minutes === 1440) return { label: "Daily", shortLabel: "D" };
  const label = minutes % 1440 === 0 ? `${minutes / 1440}d` : minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  return { label, shortLabel: label };
}

export function accountWindows(account: Account): QuotaWindow[] {
  return (["Primary", "Secondary", "Monthly"] as const).map((slot) => {
    const field = `${slot.toLowerCase()}RemainingPercent` as keyof NonNullable<Account["usage"]>;
    const rawMinutes = account[`windowMinutes${slot}`];
    const minutes = rawMinutes != null && rawMinutes > 0 ? rawMinutes : null;
    const name = durationName(minutes, slot);
    return {
      id: minutes ? `duration-${minutes * 60}` : slot.toLowerCase(),
      ...name,
      minutes,
      remaining: clampPercent(account.usage?.[field]),
      resetsAt: account[`resetAt${slot}`],
      capacityCredits: account[`capacityCredits${slot}`],
      remainingCredits: account[`remainingCredits${slot}`],
    };
  }).filter((window, index) => index < 2 || window.remaining !== null || window.resetsAt !== null);
}

export function countsForQuota(status: string): boolean {
  return ["active", "rate_limited", "quota_exceeded"].includes(status);
}

export function needsAttention(status: string): boolean {
  return !["active", "paused"].includes(status);
}

export function aggregateWindows(accounts: Account[]): AggregateWindow[] {
  const groups = new Map<string, QuotaWindow[]>();
  for (const account of accounts.filter((a) => countsForQuota(a.status))) {
    const seen = new Set<string>();
    for (const window of accountWindows(account)) {
      if (window.remaining === null || seen.has(window.id)) continue;
      seen.add(window.id);
      groups.set(window.id, [...(groups.get(window.id) ?? []), window]);
    }
  }
  return [...groups.values()].map((windows) => {
    const creditsKnown = windows.every((w) => w.capacityCredits != null && w.capacityCredits > 0 && w.remainingCredits != null);
    const capacity = creditsKnown ? windows.reduce((n, w) => n + w.capacityCredits!, 0) : null;
    const remaining = creditsKnown ? windows.reduce((n, w) => n + Math.min(w.capacityCredits!, Math.max(0, w.remainingCredits!)), 0) : null;
    const resetDates = windows.map((w) => w.resetsAt).filter((date): date is string => date != null && Number.isFinite(Date.parse(date)));
    return {
      ...windows[0],
      remaining: clampPercent(capacity && remaining != null ? remaining / capacity * 100 : windows.reduce((n, w) => n + w.remaining!, 0) / windows.length),
      resetsAt: resetDates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null,
      capacityCredits: capacity,
      remainingCredits: remaining,
      count: windows.length,
      method: creditsKnown ? "credits" as const : "average" as const,
    };
  }).sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
}

export function statusLabel(status: string): string {
  return ({ active: "Active", paused: "Paused", rate_limited: "Rate limited", quota_exceeded: "Quota exceeded", reauth_required: "Sign-in needed", deactivated: "Deactivated" } as Record<string, string>)[status] ?? status.replace(/_/g, " ");
}

export function accountName(account: Account, hidden: boolean, index: number): string {
  if (hidden) return `Account ${index + 1}`;
  return account.email || account.alias?.trim() || account.displayName.trim() || `Account ${index + 1}`;
}

export function resetLabel(date: string | null, now = Date.now()): string {
  if (!date || !Number.isFinite(Date.parse(date))) return "Reset time unknown";
  const minutes = Math.ceil((Date.parse(date) - now) / 60_000);
  if (minutes <= 0) return "Reset due";
  if (minutes < 60) return `Resets in ${minutes}m`;
  if (minutes < 1440) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}

export function ageLabel(date: string | null, now = Date.now()): string {
  if (!date || !Number.isFinite(Date.parse(date))) return "Never updated";
  const seconds = Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
  return seconds < 60 ? `Updated ${seconds}s ago` : seconds < 3600 ? `Updated ${Math.floor(seconds / 60)}m ago` : `Updated ${Math.floor(seconds / 3600)}h ago`;
}
