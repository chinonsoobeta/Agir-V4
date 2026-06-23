import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const LIVE_TABLES = [
  "projects",
  "financial_outputs",
  "assumptions",
  "decision_logs",
  "documents",
  "deal_milestones",
  "market_signals",
  "integration_connections",
] as const;

export function useRealtimeRefresh(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel("agir-operating-console");
    for (const table of LIVE_TABLES) {
      channel.on("postgres_changes" as any, { event: "*", schema: "public", table }, () =>
        queryClient.invalidateQueries(),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
