import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Map each live table to the query-key PREFIXES it should invalidate. Invalidating
// by prefix covers per-id keys too (e.g. ["timeline", projectId]). This replaces a
// blanket invalidateQueries() so a single market-signal change no longer refetches
// the entire app — only the surfaces that actually depend on that table refresh.
const TABLE_QUERY_KEYS: Record<string, QueryKey[]> = {
  projects: [["portfolio"], ["projects"], ["project"], ["onboarding"]],
  financial_outputs: [["portfolio"], ["outputs"], ["compare"], ["timeline"], ["onboarding"]],
  assumptions: [["portfolio"], ["assumptions"], ["onboarding"]],
  decision_logs: [["portfolio"], ["decisions"], ["decision-history"], ["timeline"], ["onboarding"]],
  documents: [["portfolio"], ["docs"], ["timeline"], ["onboarding"]],
  activities: [["activities"], ["timeline"]],
  deal_milestones: [["milestones"], ["timeline"], ["onboarding"]],
  market_signals: [["market-signals"]],
  integration_connections: [["integrations"]],
};

export function useRealtimeRefresh(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel("agir-operating-console");
    for (const table of Object.keys(TABLE_QUERY_KEYS)) {
      channel.on("postgres_changes" as any, { event: "*", schema: "public", table }, () => {
        for (const queryKey of TABLE_QUERY_KEYS[table]) {
          queryClient.invalidateQueries({ queryKey });
        }
      });
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
