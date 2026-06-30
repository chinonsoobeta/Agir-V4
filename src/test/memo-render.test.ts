// Memo download renderers: proves the PDF and DOCX renderers produce
// well-formed files from a real report model (PDF magic bytes; DOCX is a valid
// ZIP / OOXML package). Runs in Node, so it guards the download feature without
// a browser.

import { describe, expect, test } from "vitest";
import {
  assembleEngineInput,
  applyStress,
  STRESS_PRESETS,
  runUnderwriting,
  conservativePick,
  DEFAULTS,
  runReconciliationChecks,
  type ProjectInputRows,
} from "@/lib/engine";
import { harbourSeedRows } from "@/lib/engine/harbour-fixture";
import { computeInvestmentVerdict } from "@/lib/verdict";
import { ASSUMPTION_BY_KEY } from "@/lib/assumption-taxonomy";
import { buildMemoReport } from "@/lib/memo-report";
import { renderMemoPdfArrayBuffer } from "@/lib/memo-pdf";
import { renderMemoDocxBase64 } from "@/lib/memo-docx";

function buildReport() {
  const rows: ProjectInputRows = harbourSeedRows();
  for (const key of ["expense_ratio_pct", "hold_years", "selling_costs_pct"]) {
    rows.scalars.push({
      key,
      value_numeric: DEFAULTS[key].value,
      status: "default_accepted",
      source: "default",
    });
  }
  const cap = rows.scalars.find(
    (r) => r.key === "exit_cap_rate_pct" && r.status === "conflicting",
  )!;
  cap.value_numeric = conservativePick(
    "exit_cap_rate_pct",
    cap.conflict_values!.map((c) => c.value),
  );
  cap.status = "approved";
  const input = assembleEngineInput(rows);

  const SCEN = [
    { key: "base", out: runUnderwriting(input) },
    { key: "combined", out: runUnderwriting(applyStress(input, STRESS_PRESETS[4])) },
  ];
  const outputs = SCEN.flatMap(({ key, out }) =>
    out.metrics.map((m) => ({
      scenario_key: key,
      metric_key: m.key,
      metric_label: m.label,
      value_numeric: m.value,
      unit: m.unit,
      formula_text: m.formula,
    })),
  );
  const base = SCEN[0].out;
  const flags = runReconciliationChecks({
    tdc: base.values.tdc,
    equity: 50_000_000,
    loan: 162_500_000,
    noi: base.values.noi,
    amortizingAnnualDebtService: base.values.annualDebtService,
    minDscr: 1.2,
    lenderStabilizedOccupancyPct: 93,
    componentOccupancies: input.revenueProgram.map((r) => ({
      unitType: r.unitType,
      occupancyPct: r.occupancyPct ?? null,
    })),
    unitCounts: [220, 220],
  }).map((f) => ({ ...f, resolved: false }));
  const verdict = computeInvestmentVerdict({
    equity_multiple: base.values.equityMultiple,
    profit_margin: base.values.profitOnCostPct,
    development_spread: base.values.developmentSpreadBps,
    stress_dscr: SCEN[1].out.values.dscr,
    stress_equity_multiple: SCEN[1].out.values.equityMultiple,
    error_flag_count: flags.filter((f) => f.severity === "error").length,
  });

  const assumptions = [
    ["land_cost", 34_500_000],
    ["hard_costs", 162_000_000],
    ["soft_costs", 27_500_000],
    ["financing_costs", 18_000_000],
    ["contingency", 8_000_000],
    ["debt_amount", 162_500_000],
    ["equity_amount", 50_000_000],
    ["residential_units", 220],
    ["residential_rent_monthly", 3050],
    ["residential_occupancy", 96],
    ["retail_sf", 18_000],
    ["retail_rent_psf", 42],
    ["retail_occupancy", 92],
    ["office_sf", 32_000],
    ["office_rent_psf", 36],
    ["office_occupancy", 85],
    ["min_dscr", 1.2],
  ].map(([k, v]) => ({
    field_key: k,
    value_numeric: v,
    field_label: ASSUMPTION_BY_KEY[k as string].label,
    unit: ASSUMPTION_BY_KEY[k as string].unit,
    status: "approved",
    source_location: "Harbour_Centre_Demo",
  }));

  return buildMemoReport({
    project: {
      name: "Harbour Centre",
      location: "Vancouver",
      type: "mixed_use",
      status: "underwriting",
    },
    assumptions,
    engineInputs: [],
    outputs,
    flags,
    risks: [],
    documents: [{ name: "Construction_Budget.xlsx", category: "Budget" }],
    verdict,
    generationMode: "deterministic",
    generatedLabel: "June 2026",
  } as unknown as Parameters<typeof buildMemoReport>[0]);
}

describe("Memo download renderers", () => {
  test("PDF renderer produces a valid PDF", async () => {
    const ab = await renderMemoPdfArrayBuffer(buildReport());
    expect(ab.byteLength).toBeGreaterThan(2000);
    const head = new TextDecoder().decode(new Uint8Array(ab).subarray(0, 5));
    expect(head.startsWith("%PDF")).toBe(true);
  });

  test("DOCX renderer produces a valid OOXML package", async () => {
    const b64 = await renderMemoDocxBase64(buildReport());
    const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
    expect(bytes.byteLength).toBeGreaterThan(2000);
    // ZIP local file header magic "PK\x03\x04".
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });
});
