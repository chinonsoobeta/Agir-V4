import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isMissingRelation } from "./db-compat";
import { mapTimeline, type RawSources, type TimelineEvent } from "./timeline";

// Union of every event source for one deal -> one labeled, chronological stream.
// Each source is optional: a missing/unmigrated table is skipped, never fatal.
export const getDealTimeline = createServerFn({ method: "GET" })
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<TimelineEvent[]> => {
    const supabase = context.supabase as any;
    const pid = data.project_id;

    // Optional source: resolve to [] on any missing-relation / error.
    const safe = async (p: Promise<{ data: any; error: any }>) => {
      try {
        const { data: rows, error } = await p;
        if (isMissingRelation(error) || error) return [];
        return rows ?? [];
      } catch {
        return [];
      }
    };

    const [activities, audit, decisions, documents, reports, milestones] = await Promise.all([
      safe(
        supabase
          .from("activities")
          .select("id,activity_type,description,created_at")
          .eq("project_id", pid)
          .order("created_at", { ascending: false })
          .limit(80),
      ),
      safe(
        supabase
          .from("audit_logs")
          .select("id,action,entity_type,payload,user_name,created_at")
          .eq("project_id", pid)
          .order("created_at", { ascending: false })
          .limit(80),
      ),
      safe(
        supabase
          .from("decision_logs")
          .select("id,decision,rationale,conditions,user_name,created_at")
          .eq("project_id", pid)
          .order("created_at", { ascending: false }),
      ),
      safe(supabase.from("documents").select("id,name,category,upload_date").eq("project_id", pid)),
      safe(
        supabase
          .from("generated_reports")
          .select("id,report_type,title,generated_at")
          .eq("project_id", pid),
      ),
      safe(
        supabase
          .from("deal_milestones")
          .select("id,title,status,completed_at,created_at")
          .eq("project_id", pid),
      ),
    ]);

    const sources: RawSources = { activities, audit, decisions, documents, reports, milestones };
    return mapTimeline(sources).slice(0, 120);
  });
