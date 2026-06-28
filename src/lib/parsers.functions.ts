import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { reconcileDevelopmentInputs, computeRevenueGpr } from "./reconcile.server";
import { ASSUMPTION_BY_KEY, bandFor } from "./assumption-taxonomy";

const DocProjectSchema = z.object({
  project_id: z.string().uuid(),
  document_id: z.string().uuid(),
});

async function downloadDocument(context: any, documentId: string) {
  const { data: doc, error } = await context.supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(error.message);
  const { downloadDocumentBlob } = await import("./storage-download.server");
  const dl = await downloadDocumentBlob(context.supabase, doc.storage_path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "Unable to download document.");
  return { doc, buffer: await dl.data.arrayBuffer() };
}

export const parseBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => DocProjectSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { doc, buffer } = await downloadDocument(context, data.document_id);
    const { parseBudgetWorkbook } = await import("./parsers/budget.server");
    const { mapBudgetRowToAssumption } = await import("./budget-assumption-mapper");
    const parsed = parseBudgetWorkbook(buffer);
    if (parsed.inserted.length) {
      // Suggestions only: status='extracted' is not engine-readable until an
      // analyst approves.
      await context.supabase.from("development_budget").insert(
        parsed.inserted.map((row) => ({
          project_id: data.project_id,
          owner_id: context.userId,
          category: row.category,
          label: row.label,
          amount: row.amount,
          source: "extracted",
          status: "extracted",
          source_document_id: doc.id,
          source_text: row.sourceText || row.sourceCellRef,
        })),
      );
      const assumptions = parsed.inserted
        .map((row) => mapBudgetRowToAssumption(row, { name: doc.name }))
        .filter(Boolean);
      if (assumptions.length) {
        const { data: existing } = await context.supabase
          .from("assumptions")
          .select("field_key,status")
          .eq("project_id", data.project_id)
          .in(
            "field_key",
            assumptions.map((a: any) => a.field_key),
          );
        const locked = new Set(
          (existing ?? [])
            .filter((a: any) => ["approved", "modified", "default_accepted"].includes(a.status))
            .map((a: any) => a.field_key),
        );
        const unlocked = assumptions.filter((a: any) => !locked.has(a.field_key));
        if (unlocked.length)
          await context.supabase.from("assumptions").upsert(
            unlocked.map((a: any) => {
              const def = ASSUMPTION_BY_KEY[a.field_key];
              return {
                project_id: data.project_id,
                owner_id: context.userId,
                field_key: def.key,
                field_label: def.label,
                category: def.category,
                unit: def.unit,
                value_numeric: a.value_numeric,
                value_text: a.value_text,
                status: "extracted",
                confidence_score: a.confidence,
                confidence_band: bandFor(a.confidence),
                source_document_id: doc.id,
                source_location: a.source_location,
                source_text: a.source_text,
                ai_reasoning: `Deterministically mapped from structured budget row in ${doc.name}.`,
              };
            }),
            { onConflict: "project_id,field_key" },
          );
      }
    }
    return parsed;
  });

export const parseRentRoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => DocProjectSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { doc, buffer } = await downloadDocument(context, data.document_id);
    const { parseRentRollWorkbook } = await import("./parsers/rent-roll.server");
    const { mapRevenueProgramRowToAssumptions } = await import("./revenue-assumption-mapper");
    const parsed = parseRentRollWorkbook(buffer);
    if (parsed.inserted.length) {
      // One row per component, each with its own occupancy; suggestions only.
      await context.supabase.from("revenue_program").insert(
        parsed.inserted.map((row) => ({
          project_id: data.project_id,
          owner_id: context.userId,
          unit_type: row.unitType,
          unit_count: row.unitCount,
          avg_sf: row.avgSf,
          market_rent_monthly: row.rent,
          rent_basis: row.rentBasis,
          occupancy_pct: row.occupancyPct,
          source: "extracted",
          status: "extracted",
          source_document_id: doc.id,
          source_text: row.sourceCellRef,
        })),
      );
      const assumptions = parsed.inserted.flatMap((row) =>
        mapRevenueProgramRowToAssumptions(row, { name: doc.name }),
      );
      if (assumptions.length) {
        const { data: existing } = await context.supabase
          .from("assumptions")
          .select("field_key,status")
          .eq("project_id", data.project_id)
          .in(
            "field_key",
            assumptions.map((a) => a.field_key),
          );
        const locked = new Set(
          (existing ?? [])
            .filter((a: any) => ["approved", "modified", "default_accepted"].includes(a.status))
            .map((a: any) => a.field_key),
        );
        const unlocked = assumptions.filter((a) => !locked.has(a.field_key));
        if (unlocked.length)
          await context.supabase.from("assumptions").upsert(
            unlocked.map((a) => {
              const def = ASSUMPTION_BY_KEY[a.field_key];
              return {
                project_id: data.project_id,
                owner_id: context.userId,
                field_key: def.key,
                field_label: def.label,
                category: def.category,
                unit: def.unit,
                value_numeric: a.value_numeric,
                value_text: a.value_text,
                status: "extracted",
                confidence_score: a.confidence,
                confidence_band: bandFor(a.confidence),
                source_document_id: doc.id,
                source_location: a.source_location,
                source_text: a.source_text,
                ai_reasoning: `Deterministically mapped from structured rent-roll row in ${doc.name}.`,
              };
            }),
            { onConflict: "project_id,field_key" },
          );
      }
    }
    return parsed;
  });

export const runReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: project }, { data: budget }, { data: revenue }] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", data.project_id).single(),
      context.supabase.from("development_budget").select("*").eq("project_id", data.project_id),
      context.supabase.from("revenue_program").select("*").eq("project_id", data.project_id),
    ]);
    const budgetTotal = (budget ?? []).reduce(
      (sum: number, row: any) => sum + Number(row.amount ?? 0),
      0,
    );
    // computeRevenueGpr mirrors the engine's componentGpr convention exactly so
    // the reconciliation can never drift from the engine. The previous inline
    // formula multiplied the per_sf branch by 12 as well, overstating
    // retail/office/industrial GPR 12x and firing spurious revenue flags.
    const computedGpr = computeRevenueGpr(revenue ?? []);
    const flags = reconcileDevelopmentInputs({
      budgetTotal,
      statedTdc: Number(project?.acquisition_cost ?? 0) + Number(project?.construction_cost ?? 0),
      equity: Number(project?.equity_amount ?? 0),
      loan: Number(project?.debt_amount ?? 0),
      statedRevenue: Number(project?.revenue_forecast ?? 0),
      computedGpr,
    });
    await context.supabase.from("reconciliation_flags").delete().eq("project_id", data.project_id);
    if (flags.length) {
      await context.supabase.from("reconciliation_flags").insert(
        flags.map((flag) => ({
          project_id: data.project_id,
          owner_id: context.userId,
          ...flag,
        })),
      );
    }
    return { flags };
  });
