import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { extractCandidates } from "@/lib/assumption-candidates.server";
import { extractFileText } from "@/lib/document-text.server";
import {
  groupAndResolve,
  mapCandidates,
  type GroupResolution,
  type MappedCandidate,
} from "@/lib/assumption-mapping";
import { aggregateBudgetRows } from "@/lib/budget-assumption-mapper";
import { parseBudgetWorkbook } from "@/lib/parsers/budget.server";
import { parseRentRollWorkbook } from "@/lib/parsers/rent-roll.server";
import { mapRevenueProgramRowToAssumptions } from "@/lib/revenue-assumption-mapper";
import {
  assembleEngineInput,
  computeReadiness,
  conservativePick,
  DEFAULTS,
  runUnderwriting,
  UnderwritingBlockedError,
  type ProjectInputRows,
  type ScalarInputRow,
} from "@/lib/engine";
import { memoReportText } from "@/lib/memo-report";
import { STALE_ASSUMPTION_REVIEW_MESSAGE } from "@/lib/assumptions.functions";

type WorkflowDoc = {
  id: string;
  name: string;
  fileType: string;
  buffer: ArrayBuffer;
};

function textBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function workbookBuffer(rows: unknown[][], sheetName: string) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const SCALAR_KEY_MAP: Record<string, string> = {
  debt_amount: "loan_amount",
  interest_rate: "interest_rate_pct",
  amortization_years: "amort_years",
  equity_amount: "equity_amount",
  exit_cap_rate: "exit_cap_rate_pct",
  opex_ratio: "expense_ratio_pct",
  hold_period_years: "hold_years",
  disposition_cost_pct: "selling_costs_pct",
};

function approveRows(grouped: Map<string, GroupResolution>): ProjectInputRows {
  const rows: ProjectInputRows = { scalars: [], budget: [], revenue: [] };
  for (const candidate of grouped.values()) {
    if (candidate.field_key === "land_cost" && candidate.value_numeric != null) {
      rows.budget.push({ category: "land", amount: candidate.value_numeric, status: "approved" });
    } else if (candidate.field_key === "hard_costs" && candidate.value_numeric != null) {
      rows.budget.push({ category: "hard", amount: candidate.value_numeric, status: "approved" });
    } else if (candidate.field_key === "soft_costs" && candidate.value_numeric != null) {
      rows.budget.push({ category: "soft", amount: candidate.value_numeric, status: "approved" });
    } else if (candidate.field_key === "contingency" && candidate.value_numeric != null) {
      rows.budget.push({
        category: "contingency",
        amount: candidate.value_numeric,
        status: "approved",
      });
    } else if (candidate.field_key === "financing_costs" && candidate.value_numeric != null) {
      rows.budget.push({
        category: "financing_interest",
        amount: candidate.value_numeric,
        status: "approved",
      });
    }

    const scalarKey = SCALAR_KEY_MAP[candidate.field_key];
    if (!scalarKey) continue;
    const row: ScalarInputRow = {
      key: scalarKey,
      value_numeric: candidate.value_numeric,
      status: candidate.status === "conflicting" ? "conflicting" : "approved",
      source: candidate.winner.source_doc_name,
      source_text: candidate.winner.source_text,
      source_location: candidate.winner.source_location,
      conflict_values:
        candidate.conflict_values
          ?.filter(
            (item): item is { value: number; source: string } => typeof item.value === "number",
          )
          .map((item) => ({ value: item.value, source: item.source })) ?? null,
    };
    rows.scalars.push(row);
  }

  rows.revenue.push({
    unit_type: "Residential",
    unit_count: grouped.get("residential_units")?.value_numeric ?? 0,
    rent: grouped.get("residential_rent_monthly")?.value_numeric ?? 0,
    rent_basis: "per_unit",
    occupancy_pct: grouped.get("residential_occupancy")?.value_numeric ?? null,
    status: "approved",
  });
  return rows;
}

function resolveConflict(rows: ProjectInputRows, key: string) {
  const row = rows.scalars.find((item) => item.key === key && item.status === "conflicting");
  if (!row?.conflict_values?.length) throw new Error(`Missing conflict for ${key}`);
  row.value_numeric = conservativePick(
    key,
    row.conflict_values.map((item) => item.value),
  );
  row.status = "approved";
  return row.value_numeric;
}

function approveWithExpectedVersion(
  assumption: { value: number; version: number },
  expectedVersion: number,
  value: number,
) {
  if (assumption.version !== expectedVersion) throw new Error(STALE_ASSUMPTION_REVIEW_MESSAGE);
  assumption.value = value;
  assumption.version += 1;
}

async function extractWorkflow(docs: WorkflowDoc[]) {
  const mapped: MappedCandidate[] = [];
  for (const doc of docs) {
    const text = await extractFileText(doc.name, doc.fileType, doc.buffer);
    mapped.push(...mapCandidates(extractCandidates(doc.name, text)));
    if (doc.name.endsWith(".xlsx")) {
      mapped.push(
        ...aggregateBudgetRows(parseBudgetWorkbook(doc.buffer).inserted, { name: doc.name }),
      );
      mapped.push(
        ...parseRentRollWorkbook(doc.buffer).inserted.flatMap((row) =>
          mapRevenueProgramRowToAssumptions(row, { name: doc.name }),
        ),
      );
    }
  }
  return groupAndResolve(mapped);
}

describe("professional underwriting workflow integration", () => {
  test("documents extract to approved assumptions, underwriting, report text, audit, and recompute", async () => {
    const project = { id: "p-workflow", name: "Cedar Quay Apartments" };
    const docs: WorkflowDoc[] = [
      {
        id: "budget",
        name: "Cedar_Quay_Budget.xlsx",
        fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: workbookBuffer(
          [
            ["Category", "Line Item", "Amount"],
            ["land", "Land acquisition", 18_000_000],
            ["hard", "Hard costs", 120_000_000],
            ["soft", "Soft costs", 18_000_000],
            ["contingency", "Contingency", 6_000_000],
            ["financing", "Financing costs", 8_000_000],
          ],
          "Budget",
        ),
      },
      {
        id: "rent-roll",
        name: "Cedar_Quay_Rent_Roll.xlsx",
        fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: workbookBuffer(
          [
            ["Unit Type", "Unit Count", "Market Rent", "Rent Basis", "Occupancy"],
            ["Residential", 480, 4200, "per_unit", 94],
          ],
          "Rent Roll",
        ),
      },
      {
        id: "lender",
        name: "Cedar_Quay_Lender_Term_Sheet.txt",
        fileType: "text/plain",
        buffer: textBuffer(
          "Senior loan amount $95,000,000. Interest rate 6.25%. Amortization 30 years. Minimum DSCR 1.20x.",
        ),
      },
      {
        id: "sponsor",
        name: "Cedar_Quay_Sponsor_Memo.txt",
        fileType: "text/plain",
        buffer: textBuffer(
          "Sponsor equity $75,000,000. Exit cap rate 5.50%. Hold period 5 years. Disposition costs 2.0%.",
        ),
      },
      {
        id: "appraisal",
        name: "Cedar_Quay_Appraisal_Memo.txt",
        fileType: "text/plain",
        buffer: textBuffer("Appraisal exit cap rate 5.25%. Operating expense ratio 35%."),
      },
    ];

    const audit: string[] = [
      `project.created:${project.id}`,
      ...docs.map((d) => `document.attached:${d.id}`),
    ];
    const grouped = await extractWorkflow(docs);
    expect(grouped.get("exit_cap_rate")?.status).toBe("conflicting");
    expect(grouped.get("residential_units")?.value_numeric).toBe(480);
    audit.push("analysis.completed", "assumptions.extracted");

    const rows = approveRows(grouped);
    expect(computeReadiness(rows).status).toBe("blocked");
    expect(() => assembleEngineInput(rows)).toThrow(UnderwritingBlockedError);

    const resolvedCap = resolveConflict(rows, "exit_cap_rate_pct");
    expect(resolvedCap).toBe(5.5);
    audit.push("assumption.conflict_resolved:exit_cap_rate_pct");
    const needsDefault = computeReadiness(rows);
    expect(needsDefault.defaultable).toContain("expense_ratio_pct");
    rows.scalars.push({
      key: "expense_ratio_pct",
      value_numeric: DEFAULTS.expense_ratio_pct.value,
      status: "default_accepted",
      source: "default",
    });
    audit.push("assumption.default_accepted:expense_ratio_pct");
    expect(computeReadiness(rows).status).toBe("ready");

    const before = runUnderwriting(assembleEngineInput(rows));
    expect(Math.round(before.values.tdc)).toBe(170_000_000);
    expect(before.values.dscr).toBeGreaterThan(1);
    expect(before.values.developmentProfit).toBeGreaterThan(0);
    audit.push("underwriting.completed");

    const memo = memoReportText({
      header_band: "Investment Committee Memo",
      title: "Cedar Quay IC Memo",
      project_name: project.name,
      subtitle: project.name,
      mode_label: "Deterministic template",
      prepared: "July 2026",
      verdict_code: "APPROVE_WITH_CONDITIONS",
      verdict_banner: "Proceed with conditions",
      verdict_narrative: "Cedar Quay is ready for committee review after approved assumptions.",
      summary_stats: [
        { label: "TDC", value: `$${Math.round(before.values.tdc).toLocaleString("en-US")}` },
      ],
      metric_cards: [{ label: "DSCR", value: `${before.values.dscr.toFixed(2)}x` }],
      sections: [
        {
          heading: "Key Metrics",
          body: `TDC $${Math.round(before.values.tdc).toLocaleString("en-US")}; DSCR ${before.values.dscr.toFixed(2)}x.`,
        },
        { heading: "Provenance", body: audit.join(", ") },
      ],
      footnotes: ["Every financial output comes from approved inputs."],
      derived_values: [before.values.tdc, before.values.dscr],
    });
    expect(memo).toContain("Cedar Quay is ready for committee review");
    expect(memo).toContain("Every financial output comes from approved inputs.");
    expect(audit).toEqual(
      expect.arrayContaining([
        "analysis.completed",
        "assumption.conflict_resolved:exit_cap_rate_pct",
        "underwriting.completed",
      ]),
    );

    const rentAssumption = { value: 4200, version: 1 };
    approveWithExpectedVersion(rentAssumption, 1, 4300);
    expect(() => approveWithExpectedVersion(rentAssumption, 1, 4350)).toThrow(
      STALE_ASSUMPTION_REVIEW_MESSAGE,
    );
    rows.revenue[0].rent = rentAssumption.value;
    const after = runUnderwriting(assembleEngineInput(rows));
    expect(after.values.noi).toBeGreaterThan(before.values.noi);
    expect(after.values.developmentProfit).toBeGreaterThan(before.values.developmentProfit);
    audit.push("underwriting.recomputed");
    expect(audit.at(-1)).toBe("underwriting.recomputed");
  });
});
