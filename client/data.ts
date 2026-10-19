import { useEffect, useState } from "react";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { preferences, snapshotRpc, type Snapshot } from "../shared/contracts";

export function useLBSnapshot(hostId: string) {
  const settings = useSettings(preferences);
  const fetchSnapshot = useRpc(snapshotRpc);
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const values = settings.status === "ready" ? settings.values : null;
  const queryKey = ["codex-lb", hostId, values?.serverUrl, values?.timeframe] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchSnapshot({ refresh: false }),
    enabled: values !== null,
    refetchInterval: (values?.refreshSeconds ?? 30) * 1000,
    staleTime: 5_000,
    retry: false,
  });
  const setSnapshot = (snapshot: Snapshot) => queryClient.setQueryData(queryKey, snapshot);
  async function refresh() { const snapshot = await fetchSnapshot({ refresh: true }); setSnapshot(snapshot); }
  const snapshot = values ? query.data : undefined;
  const stale = Boolean(snapshot?.overview && (snapshot.state !== "connected" || query.error ||
    now - Date.parse(snapshot.fetchedAt ?? "") > Math.max((values?.refreshSeconds ?? 30) * 2500, 60_000)));
  return { settings, values, snapshot, query, refresh, setSnapshot, stale, now };
}

export type LBData = ReturnType<typeof useLBSnapshot>;
