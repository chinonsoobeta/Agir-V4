import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { handleSchemaCompatibilityFallback, isMissingRelation } from "./db-compat";
import {
  summarizeOperationalJobs,
  summarizeOperationalWindows,
  windowToSince,
  type OperationalWindow,
} from "./operational-quality";

const milestoneSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(240),
  category: z.string().min(1).max(80).default("execution"),
  due_date: z.string().nullable().optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "complete"]).default("not_started"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  notes: z.string().max(4000).nullable().optional(),
});

export const listMilestones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("deal_milestones")
      .select("*, projects(name,location)")
      .order("due_date", { ascending: true, nullsFirst: false });
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => milestoneSchema.parse(value))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("deal_milestones")
      .insert({ ...data, owner_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["not_started", "in_progress", "blocked", "complete"]).optional(),
        due_date: z.string().nullable().optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        notes: z.string().max(4000).nullable().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const complete =
      patch.status === "complete" ? new Date().toISOString() : patch.status ? null : undefined;
    const { data: row, error } = await context.supabase
      .from("deal_milestones")
      .update({ ...patch, ...(complete !== undefined ? { completed_at: complete } : {}) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const marketSignalSchema = z.object({
  market: z.string().min(1).max(160),
  metric: z.string().min(1).max(160),
  value_numeric: z.number(),
  unit: z.string().min(1).max(40).default("number"),
  period: z.string().max(80).nullable().optional(),
  trend: z.enum(["up", "down", "flat"]).default("flat"),
  source: z.string().max(240).nullable().optional(),
  observed_at: z.string(),
});

export const listMarketSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("market_signals")
      .select("*")
      .order("observed_at", { ascending: false });
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createMarketSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => marketSignalSchema.parse(value))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("market_signals")
      .insert({ ...data, owner_id: context.userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("integration_connections")
      .select("*")
      .order("created_at", { ascending: true });
    if (isMissingRelation(error)) {
      const { data: events, error: activityError } = await context.supabase
        .from("activities")
        .select("description,created_at")
        .eq("activity_type", "integration_connection")
        .order("created_at", { ascending: false });
      if (activityError) throw new Error(activityError.message);

      const latest = new Map<string, IntegrationConnection>();
      for (const event of events ?? []) {
        const connection = parseIntegrationEvent(event.description, event.created_at);
        if (connection && !latest.has(connection.provider)) {
          latest.set(connection.provider, connection);
        }
      }
      return [...latest.values()];
    }
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        provider: z.string().min(1).max(80),
        category: z.string().min(1).max(80),
        display_name: z.string().min(1).max(160),
        status: z.enum(["connected", "attention", "disconnected"]),
        workspace_id: z.string().uuid().nullable().optional(),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      ...data,
      owner_id: context.userId,
      last_synced_at: data.status === "connected" ? new Date().toISOString() : null,
    };
    const { data: row, error } = await context.supabase
      .from("integration_connections")
      .upsert(payload, { onConflict: "owner_id,provider" })
      .select()
      .single();
    if (isMissingRelation(error)) {
      const timestamp = new Date().toISOString();
      const fallback: IntegrationConnection = {
        ...data,
        id: `${context.userId}:${data.provider}`,
        owner_id: context.userId,
        config: {},
        last_synced_at: data.status === "connected" ? timestamp : null,
        created_at: timestamp,
        updated_at: timestamp,
      };
      const { error: activityError } = await context.supabase.from("activities").insert({
        project_id: null,
        user_id: context.userId,
        activity_type: "integration_connection",
        description: JSON.stringify(fallback),
      });
      if (activityError) throw new Error(activityError.message);
      return fallback;
    }
    if (error) throw new Error(error.message);
    return row;
  });

type IntegrationConnection = {
  id: string;
  owner_id: string;
  provider: string;
  category: string;
  display_name: string;
  status: "connected" | "attention" | "disconnected";
  config: Json;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  workspace_id?: string | null;
};

function parseIntegrationEvent(
  description: string | null,
  createdAt: string,
): IntegrationConnection | null {
  if (!description) return null;
  try {
    const value = JSON.parse(description) as Partial<IntegrationConnection>;
    if (
      !value.provider ||
      !value.category ||
      !value.display_name ||
      !["connected", "attention", "disconnected"].includes(value.status ?? "")
    ) {
      return null;
    }
    return {
      id: value.id ?? `activity:${value.provider}:${createdAt}`,
      owner_id: value.owner_id ?? "",
      provider: value.provider,
      category: value.category,
      display_name: value.display_name,
      status: value.status as IntegrationConnection["status"],
      config: value.config ?? {},
      last_synced_at: value.last_synced_at ?? null,
      created_at: value.created_at ?? createdAt,
      updated_at: value.updated_at ?? createdAt,
    };
  } catch {
    return null;
  }
}

const operationalMetricsSchema = z.object({
  window: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export const getOperationalQualityMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => operationalMetricsSchema.parse(value ?? {}))
  .handler(async ({ data, context }) => {
    const window = data.window as OperationalWindow;
    const since = windowToSince(window);
    const longestSince = windowToSince("30d");

    const jobsRes = await context.supabase
      .from("extraction_jobs")
      .select(
        "id,status,kind,created_at,started_at,finished_at,error,heartbeat_at,lease_expires_at,cancellation_requested,dead_lettered_at",
      )
      .gte("created_at", longestSince)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (isMissingRelation(jobsRes.error)) {
      return handleSchemaCompatibilityFallback(jobsRes.error, {
        featureName: "operational quality metrics",
        table: "extraction_jobs",
        operation: "summarize extraction job health",
        fallback: {
          window,
          since,
          jobs: summarizeOperationalJobs([]),
          jobsByWindow: summarizeOperationalWindows([]),
          documents: emptyDocumentQuality(),
          aiFallbacks: { total: 0, byReason: {} },
          underwritingBlocked: { total: 0, byReason: {} },
          schemaCompatibilityFallbacks: {
            source: "structured logs",
            event: "schema_compatibility_fallback",
            count: null,
          },
          notes: ["extraction_jobs table is unavailable in schema compatibility mode."],
        },
      });
    }
    if (jobsRes.error) throw new Error(jobsRes.error.message);

    const documentsRes = await context.supabase
      .from("documents")
      .select(
        "id,name,scan_status,scan_detail,extraction_status,extraction_error,page_count,upload_date",
      )
      .gte("upload_date", longestSince)
      .order("upload_date", { ascending: false })
      .limit(1000);
    if (documentsRes.error && !isMissingRelation(documentsRes.error)) {
      throw new Error(documentsRes.error.message);
    }

    const auditRes = await context.supabase
      .from("audit_logs")
      .select("action,payload,created_at")
      .in("action", ["ai_fallback", "underwriting_blocked"])
      .gte("created_at", longestSince)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (auditRes.error && !isMissingRelation(auditRes.error))
      throw new Error(auditRes.error.message);

    const jobsByWindow = summarizeOperationalWindows((jobsRes.data ?? []) as any);
    const documentsRows = scopeRows(documentsRes.data ?? [], "upload_date", since);
    const auditRows = scopeRows(auditRes.data ?? [], "created_at", since);
    const aiFallbacks = summarizeAuditReasons(auditRows, "ai_fallback");
    const underwritingBlocked = summarizeUnderwritingBlocked(auditRows);

    return {
      window,
      since,
      jobs: jobsByWindow[window],
      jobsByWindow,
      documents: summarizeDocumentQuality(documentsRows),
      aiFallbacks,
      underwritingBlocked,
      schemaCompatibilityFallbacks: {
        source: "structured logs",
        event: "schema_compatibility_fallback",
        count: null,
      },
      notes: [
        "Metrics are RLS-scoped to the current user/workspace access.",
        "Schema compatibility fallback counts are emitted as structured server logs.",
      ],
    };
  });

function emptyDocumentQuality() {
  return {
    total: 0,
    byScanStatus: {} as Record<string, number>,
    byExtractionStatus: {} as Record<string, number>,
    scanRejections: 0,
    pageLimitRejections: 0,
    extractionFailuresByReason: {} as Record<string, number>,
  };
}

function summarizeDocumentQuality(rows: any[]) {
  const out = emptyDocumentQuality();
  out.total = rows.length;
  for (const row of rows) {
    const scan = row.scan_status ?? "unknown";
    const extraction = row.extraction_status ?? "unknown";
    out.byScanStatus[scan] = (out.byScanStatus[scan] ?? 0) + 1;
    out.byExtractionStatus[extraction] = (out.byExtractionStatus[extraction] ?? 0) + 1;
    const detail = `${row.scan_detail ?? ""} ${row.extraction_error ?? ""}`.toLowerCase();
    if (scan === "rejected" || detail.includes("infected") || detail.includes("rejected")) {
      out.scanRejections += 1;
    }
    if (detail.includes("page") && (detail.includes("limit") || detail.includes("cap"))) {
      out.pageLimitRejections += 1;
    }
    if (row.extraction_status === "failed" || row.extraction_status === "extraction_failed") {
      const reason = (row.extraction_error ?? "Unspecified").slice(0, 120);
      out.extractionFailuresByReason[reason] = (out.extractionFailuresByReason[reason] ?? 0) + 1;
    }
  }
  return out;
}

function summarizeAuditReasons(rows: any[], action: string) {
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    if (row.action !== action) continue;
    const payload = row.payload as { reason?: string; feature?: string } | null;
    const label = [payload?.feature, payload?.reason].filter(Boolean).join(": ") || "Unspecified";
    byReason[label.slice(0, 160)] = (byReason[label.slice(0, 160)] ?? 0) + 1;
  }
  return { total: Object.values(byReason).reduce((sum, n) => sum + n, 0), byReason };
}

function summarizeUnderwritingBlocked(rows: any[]) {
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    if (row.action !== "underwriting_blocked") continue;
    const readiness = (row.payload as any)?.readiness;
    const reasons = [
      ...((readiness?.missing as string[] | undefined) ?? []).map((key) => `missing:${key}`),
      ...((readiness?.conflicting as string[] | undefined) ?? []).map((key) => `conflict:${key}`),
      ...((readiness?.defaultable as string[] | undefined) ?? []).map(
        (key) => `defaultable:${key}`,
      ),
    ];
    for (const reason of reasons.length ? reasons : ["Unspecified"]) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
  }
  return { total: Object.values(byReason).reduce((sum, n) => sum + n, 0), byReason };
}

function scopeRows<T extends Record<string, any>>(rows: T[], dateKey: keyof T, since: string) {
  const threshold = Date.parse(since);
  return rows.filter((row) => {
    const value = row[dateKey];
    const ts = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(ts) && ts >= threshold;
  });
}
