// Seed the Harbour Centre demo project from the VERIFIED extraction register
// (golden fixture 2). The previous seed embodied the fabricated deal this
// codebase is hardened against (invented 18M/86M budget, a 5.35% exit cap that
// appears in no document, phantom other income); it has been replaced with the
// hand-verified values, including the documented exit-cap conflict and the
// genuinely-missing keys that must block underwriting until defaults are
// accepted.
//
// Synthetic but real demo documents are generated from the same fixture and
// uploaded to Storage so "Run Extraction" has actual files to read; the demo
// no longer references source files that are not distributed with the repo.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  HARBOUR_BUDGET_LINES,
  HARBOUR_EXIT_CAP_CONFLICT,
  HARBOUR_REVENUE_COMPONENTS,
  HARBOUR_SCALARS,
} from "./engine/harbour-fixture";
import { ASSUMPTION_BY_KEY, bandFor } from "./assumption-taxonomy";

const DEMO_STORAGE_PREFIX = "demo/harbour-centre";

const fmtMoney = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

// Review-queue assumption rows that mirror the verified fixture. Each carries
// provenance (source doc + source text) so the UI can show where a value came
// from. Statuses: approved for verified values, conflicting for the exit cap,
// missing for genuinely-absent defaultable keys, calculated for derivable TDC.
type SeedAssumption = {
  key: string;
  status: "approved" | "conflicting" | "missing" | "calculated";
  value?: number | null;
  source_doc?: string | null;
  source_text?: string | null;
  conflict_values?: { value: number; source: string }[];
  formula_text?: string;
};

const BUDGET_DOC = "Harbour_Centre_Construction_Budget.xlsx";
const SPONSOR_DOC = "Harbour_Centre_Sponsor_Summary.pdf";
const MARKET_DOC = "Harbour_Centre_Market_Study.pdf";
const LENDER_DOC = "Harbour_Centre_Lender_Term_Sheet.pdf";
const BROKER_DOC = "Harbour_Centre_Broker_Opinion.pdf";

function buildSeedAssumptions(): SeedAssumption[] {
  const tdc = HARBOUR_BUDGET_LINES.reduce((s, b) => s + b.amount, 0);
  const budgetKeyByCategory: Record<string, string> = {
    land: "land_cost", hard: "hard_costs", soft: "soft_costs",
    financing_interest: "financing_costs", contingency: "contingency",
  };
  const list: SeedAssumption[] = [];

  for (const b of HARBOUR_BUDGET_LINES) {
    const key = budgetKeyByCategory[b.category];
    if (!key) continue;
    list.push({ key, status: "approved", value: b.amount, source_doc: BUDGET_DOC,
      source_text: `${b.label}: $${fmtMoney(b.amount)}` });
  }

  const res = HARBOUR_REVENUE_COMPONENTS.find((r) => r.unit_type === "Residential")!;
  const retail = HARBOUR_REVENUE_COMPONENTS.find((r) => r.unit_type === "Retail")!;
  const office = HARBOUR_REVENUE_COMPONENTS.find((r) => r.unit_type === "Office")!;
  list.push(
    { key: "residential_units", status: "approved", value: res.unit_count, source_doc: SPONSOR_DOC, source_text: `Residential rental units: ${res.unit_count} units` },
    { key: "residential_rent_monthly", status: "approved", value: res.rent, source_doc: MARKET_DOC, source_text: `Residential rent: $${fmtMoney(res.rent)} per unit per month` },
    { key: "residential_occupancy", status: "approved", value: res.occupancy_pct ?? null, source_doc: MARKET_DOC, source_text: `Residential occupancy: ${res.occupancy_pct}%` },
    { key: "retail_sf", status: "approved", value: retail.avg_sf ?? null, source_doc: SPONSOR_DOC, source_text: `Retail area: ${fmtMoney(retail.avg_sf ?? 0)} SF` },
    { key: "retail_rent_psf", status: "approved", value: retail.rent, source_doc: MARKET_DOC, source_text: `Retail rent: $${retail.rent} per square foot` },
    { key: "retail_occupancy", status: "approved", value: retail.occupancy_pct ?? null, source_doc: MARKET_DOC, source_text: `Retail occupancy: ${retail.occupancy_pct}%` },
    { key: "office_sf", status: "approved", value: office.avg_sf ?? null, source_doc: SPONSOR_DOC, source_text: `Office area: ${fmtMoney(office.avg_sf ?? 0)} SF` },
    { key: "office_rent_psf", status: "approved", value: office.rent, source_doc: MARKET_DOC, source_text: `Office rent: $${office.rent} per square foot` },
    { key: "office_occupancy", status: "approved", value: office.occupancy_pct ?? null, source_doc: MARKET_DOC, source_text: `Office occupancy: ${office.occupancy_pct}%` },
  );

  const scalar = (k: string) => HARBOUR_SCALARS.find((s) => s.key === k)?.value_numeric ?? null;
  list.push(
    { key: "debt_amount", status: "approved", value: scalar("loan_amount"), source_doc: LENDER_DOC, source_text: `Senior loan amount: $${fmtMoney(scalar("loan_amount") ?? 0)}` },
    { key: "equity_amount", status: "approved", value: scalar("equity_amount"), source_doc: SPONSOR_DOC, source_text: `Common equity contribution: $${fmtMoney(scalar("equity_amount") ?? 0)}` },
    { key: "interest_rate", status: "approved", value: scalar("interest_rate_pct"), source_doc: LENDER_DOC, source_text: `Interest rate: ${scalar("interest_rate_pct")}%` },
    { key: "amortization_years", status: "approved", value: scalar("amort_years"), source_doc: LENDER_DOC, source_text: `Amortization: ${scalar("amort_years")}-year` },
    { key: "min_dscr", status: "approved", value: scalar("min_dscr"), source_doc: LENDER_DOC, source_text: `Minimum DSCR covenant: ${scalar("min_dscr")?.toFixed(2)}x` },
    { key: "lender_stabilized_occupancy", status: "approved", value: scalar("lender_stabilized_occupancy_pct"), source_doc: LENDER_DOC, source_text: `Lender stabilization requirement: ${scalar("lender_stabilized_occupancy_pct")}%` },
    { key: "rent_growth", status: "approved", value: scalar("rent_growth_pct"), source_doc: MARKET_DOC, source_text: `Annual rent growth: ${scalar("rent_growth_pct")}%` },
  );

  // Exit cap is a documented conflict: never resolved silently.
  list.push({
    key: "exit_cap_rate", status: "conflicting", value: null,
    source_doc: BROKER_DOC,
    source_text: `Broker opinion exit cap ${HARBOUR_EXIT_CAP_CONFLICT.values[0].value}% vs lender terminal cap ${HARBOUR_EXIT_CAP_CONFLICT.values[1].value}%`,
    conflict_values: HARBOUR_EXIT_CAP_CONFLICT.values.map((v) => ({
      value: v.value,
      source: v.source === "Harbour_Centre_Broker_Opinion.pdf" ? BROKER_DOC : LENDER_DOC,
    })),
  });

  // Derivable total: never "missing".
  list.push({
    key: "total_project_cost", status: "calculated", value: tdc,
    formula_text: `total_project_cost = ${HARBOUR_BUDGET_LINES.map((b) => `${budgetKeyByCategory[b.category]} ${fmtMoney(b.amount)}`).join(" + ")} = ${fmtMoney(tdc)}`,
    source_text: "Calculated deterministically from the five extracted budget lines.",
  });

  // Genuinely absent from every document: must stay missing/defaultable.
  for (const key of ["opex_ratio", "hold_period_years", "disposition_cost_pct"]) {
    list.push({ key, status: "missing", value: null,
      source_text: "Not stated in any Harbour Centre document; accept a default to proceed." });
  }

  return list;
}

export const seedHarbourCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // ===== Generate + upload the synthetic demo documents =====
    const { buildHarbourDemoFiles } = await import("./harbour-demo-files.server");
    const files = await buildHarbourDemoFiles();
    const uploadedPaths: Record<string, { path: string; size: number; type: string; category: string }> = {};
    for (const f of files) {
      const path = `${context.userId}/${DEMO_STORAGE_PREFIX}/${f.storage_file}`;
      const { error: upErr } = await context.supabase.storage
        .from("documents")
        .upload(path, f.bytes, { upsert: true, contentType: f.file_type });
      if (upErr) throw new Error(`Failed to upload demo file ${f.name}: ${upErr.message}`);
      uploadedPaths[f.name] = { path, size: f.bytes.byteLength, type: f.file_type, category: f.category };
    }

    // Verify every file is actually present before wiring documents to them.
    const missing: string[] = [];
    for (const [name, info] of Object.entries(uploadedPaths)) {
      const probe = await context.supabase.storage.from("documents").download(info.path);
      if (probe.error || !probe.data) missing.push(name);
    }
    if (missing.length) {
      throw new Error(
        `Harbour demo files are missing from storage (${missing.join(", ")}). Run scripts/upload-harbour-demo-docs.mjs.`,
      );
    }

    // ===== Create the project =====
    const { data: project, error } = await context.supabase.from("projects").insert({
      owner_id: context.userId,
      name: "Harbour Centre",
      location: "Mixed-use waterfront",
      type: "mixed_use",
      status: "underwriting",
      deal_type: "development",
      acquisition_cost: 34_500_000,
      construction_cost: 162_000_000,
      revenue_forecast: 9_404_640,
      debt_amount: 162_500_000,
      equity_amount: 50_000_000,
      interest_rate: 6.25,
      notes: "Demo deal: 220-unit residential tower over 18k SF retail and 32k SF office. Exit cap is conflicted (4.75% broker vs 5.25% lender); expense ratio, hold period and selling costs are absent from the documents.",
    }).select().single();
    if (error) throw new Error(error.message);

    // ===== Link uploaded files as documents =====
    const docRows = files.map((f) => {
      const info = uploadedPaths[f.name];
      return {
        owner_id: context.userId, project_id: project.id,
        name: f.name, category: info.category, storage_path: info.path,
        file_type: info.type, size_bytes: info.size, status: "uploaded",
      };
    });
    const { data: insertedDocs, error: docErr } = await context.supabase
      .from("documents").insert(docRows).select("id,name");
    if (docErr) throw new Error(docErr.message);
    const docIdByName = new Map((insertedDocs ?? []).map((d) => [d.name, d.id]));

    // ===== Engine-readable rows (the underwriting tables the engine loads) =====
    await context.supabase.from("development_budget").insert(HARBOUR_BUDGET_LINES.map((row) => ({
      project_id: project.id,
      owner_id: context.userId,
      category: row.category,
      label: row.label,
      amount: row.amount,
      source: "extracted",
      status: row.status,
    })));

    await context.supabase.from("revenue_program").insert(HARBOUR_REVENUE_COMPONENTS.map((row) => ({
      project_id: project.id,
      owner_id: context.userId,
      unit_type: row.unit_type,
      unit_count: row.unit_count,
      avg_sf: row.avg_sf,
      market_rent_monthly: row.rent,
      rent_basis: row.rent_basis,
      occupancy_pct: row.occupancy_pct,
      source: "extracted",
      status: row.status,
    })));

    await context.supabase.from("underwriting_inputs").insert(HARBOUR_SCALARS.map((row) => ({
      project_id: project.id,
      owner_id: context.userId,
      key: row.key,
      value_numeric: row.value_numeric,
      source: "extracted",
      status: row.status,
      conflict_values: row.conflict_values ?? null,
      approved_by: row.status === "approved" ? context.userId : null,
      approved_at: row.status === "approved" ? new Date().toISOString() : null,
    })));

    // ===== Review-queue assumptions (so the Assumption Review Center is populated) =====
    const assumptionRows = buildSeedAssumptions().map((a) => {
      const def = ASSUMPTION_BY_KEY[a.key];
      const confidence = a.status === "approved" || a.status === "calculated" ? 100 : a.status === "conflicting" ? 50 : 0;
      const sourceDocId = a.source_doc ? docIdByName.get(a.source_doc) ?? null : null;
      return {
        project_id: project.id, owner_id: context.userId,
        field_key: a.key, field_label: def?.label ?? a.key, category: def?.category ?? "Costs", unit: def?.unit ?? "$",
        value_numeric: a.value ?? null, value_text: null,
        status: a.status,
        conflict_values: a.conflict_values ?? null,
        formula_text: a.formula_text ?? null,
        confidence_score: confidence, confidence_band: bandFor(confidence),
        source_document_id: sourceDocId,
        source_location: a.source_doc ?? null,
        source_text: a.source_text ?? null,
        ai_reasoning:
          a.status === "conflicting" ? "Two documented values disagree; resolve before underwriting (never averaged)."
          : a.status === "calculated" ? "Calculated deterministically from the five extracted budget lines."
          : a.status === "missing" ? "Not found in any document; accept a default to proceed."
          : "Verified from the Harbour Centre source documents.",
      };
    });
    if (assumptionRows.length) {
      const { error: aErr } = await context.supabase.from("assumptions").insert(assumptionRows);
      if (aErr) throw new Error(`Failed to seed assumptions: ${aErr.message}`);
    }

    await context.supabase.from("activities").insert({
      project_id: project.id, user_id: context.userId,
      activity_type: "project_created",
      description: `Seeded Harbour Centre demo with 6 source documents; exit cap conflict ${HARBOUR_EXIT_CAP_CONFLICT.values.map((v) => v.value).join("% vs ")}% pending resolution`,
    });

    return { project_id: project.id };
  });
