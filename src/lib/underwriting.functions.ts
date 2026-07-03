// Client-safe underwriting server-function bridges.
//
// Server-only implementation lives in underwriting.server.ts. Keep this file
// limited to TanStack RPC wrappers so route/components can import it without
// pulling deterministic run internals or *.server.* modules into the client.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  acceptDefaultsForContext,
  getEngineInputForContext,
  getUnderwritingReadinessForContext,
  listReconciliationFlagsForContext,
  resolveConflictForContext,
  runFullUnderwritingForContext,
} from "./underwriting.server";

const ProjectIdSchema = z.object({ project_id: z.string().uuid() });

const ResolveConflictSchema = z.object({
  project_id: z.string().uuid(),
  key: z.string().min(1),
  mode: z.enum(["pick", "conservative"]),
  value: z.number().optional(),
  resolution_note: z.string().max(1000).optional(),
});

const RunFullUnderwritingSchema = z.object({
  project_id: z.string().uuid(),
  mode: z.enum(["ai", "deterministic"]).default("ai"),
});

export const getEngineInput = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(getEngineInputForContext);

export const getUnderwritingReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(getUnderwritingReadinessForContext);

export const acceptDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(acceptDefaultsForContext);

export const resolveConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ResolveConflictSchema.parse(d))
  .handler(resolveConflictForContext);

export const runFullUnderwriting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string; mode?: "ai" | "deterministic" }) =>
    RunFullUnderwritingSchema.parse(d),
  )
  .handler(async ({ data, context }) => runFullUnderwritingForContext(data, context));

export const listReconciliationFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => ProjectIdSchema.parse(d))
  .handler(listReconciliationFlagsForContext);
