import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
    const { data, error } = await (context.supabase as any)
      .from("deal_milestones")
      .select("*, projects(name,location)")
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error?.message?.includes("Could not find the table")) return [];
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => milestoneSchema.parse(value))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
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
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const complete =
      patch.status === "complete" ? new Date().toISOString() : patch.status ? null : undefined;
    const { data: row, error } = await (context.supabase as any)
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
    const { data, error } = await (context.supabase as any)
      .from("market_signals")
      .select("*")
      .order("observed_at", { ascending: false });
    if (error?.message?.includes("Could not find the table")) return [];
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createMarketSignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => marketSignalSchema.parse(value))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
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
    const { data, error } = await (context.supabase as any)
      .from("integration_connections")
      .select("*")
      .order("created_at", { ascending: true });
    if (error?.message?.includes("Could not find the table")) return [];
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
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      ...data,
      owner_id: context.userId,
      last_synced_at: data.status === "connected" ? new Date().toISOString() : null,
    };
    const { data: row, error } = await (context.supabase as any)
      .from("integration_connections")
      .upsert(payload, { onConflict: "owner_id,provider" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
