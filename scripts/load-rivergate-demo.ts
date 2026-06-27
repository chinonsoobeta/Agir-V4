import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractFileText } from "../src/lib/document-text.server";
import { extractCandidates } from "../src/lib/assumption-candidates.server";
import { mapCandidates, groupAndResolve } from "../src/lib/assumption-mapping";
import { ASSUMPTION_BY_KEY, ASSUMPTION_DEFS, bandFor } from "../src/lib/assumption-taxonomy";
import { parseRentRollWorkbook } from "../src/lib/parsers/rent-roll.server";
import { mapRevenueProgramRowToAssumptions } from "../src/lib/revenue-assumption-mapper";
import { parseBudgetWorkbook } from "../src/lib/parsers/budget.server";
import { mapBudgetRowToAssumption } from "../src/lib/budget-assumption-mapper";

const supabase = createClient(
  "http://127.0.0.1:54321",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  { auth: { persistSession: false } },
);

const owner = "00000000-0000-0000-0000-000000000000";
const fixtureDir =
  "/Users/chinonsoobeta/Downloads/Rivergate_Innovation_District_Test_Package/source_documents";
const fileNames = [
  "Rivergate_Appraisal_Valuation_Memo.pdf",
  "Rivergate_Construction_Budget.xlsx",
  "Rivergate_Environmental_Tax_Addendum.pdf",
  "Rivergate_Lender_Term_Sheet.pdf",
  "Rivergate_Market_Study.pdf",
  "Rivergate_Rate_Lock_Addendum.pdf",
  "Rivergate_Rent_Roll.xlsx",
  "Rivergate_Sponsor_Investment_Summary.pdf",
];

function mime(name: string) {
  return name.endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

async function main() {
  await supabase.from("projects").delete().eq("owner_id", owner).eq("name", "Rivergate");
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .insert({
      owner_id: owner,
      name: "Rivergate",
      location: "Rivergate Innovation District",
      type: "mixed_use",
      status: "underwriting",
      deal_type: "development",
      notes:
        "Rivergate test fixture loaded from source documents. Revenue assumptions are extracted from structured rent-roll rows; lease-up is intentionally left missing unless explicit source text is present.",
    })
    .select()
    .single();
  if (projectErr) throw projectErr;

  const docs: any[] = [];
  const candidates: any[] = [];
  const structured: any[] = [];
  let rentRollRows: ReturnType<typeof parseRentRollWorkbook>["inserted"] = [];
  let budgetRows: ReturnType<typeof parseBudgetWorkbook>["inserted"] = [];

  for (const name of fileNames) {
    const bytes = await readFile(path.join(fixtureDir, name));
    const storagePath = `${owner}/rivergate/${Date.now()}-${name}`;
    const upload = await supabase.storage.from("documents").upload(storagePath, bytes, {
      upsert: true,
      contentType: mime(name),
    });
    if (upload.error) throw upload.error;

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        project_id: project.id,
        owner_id: owner,
        name,
        file_type: mime(name),
        category:
          name.includes("Rent_Roll") || name.includes("Market")
            ? "Revenue"
            : name.includes("Budget")
              ? "Budget"
              : "Other",
        storage_path: storagePath,
        size_bytes: bytes.byteLength,
        status: "uploaded",
      })
      .select()
      .single();
    if (docErr) throw docErr;
    docs.push(doc);

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const text = await extractFileText(name, mime(name), buffer);
    candidates.push(...extractCandidates(name, text.slice(0, 40000)));
    if (name === "Rivergate_Rent_Roll.xlsx") {
      const parsed = parseRentRollWorkbook(buffer);
      rentRollRows = parsed.inserted;
      structured.push(
        ...parsed.inserted.flatMap((row) => mapRevenueProgramRowToAssumptions(row, { name })),
      );
    }
    if (name === "Rivergate_Construction_Budget.xlsx") {
      const parsed = parseBudgetWorkbook(buffer);
      budgetRows = parsed.inserted;
      structured.push(
        ...parsed.inserted.map((row) => mapBudgetRowToAssumption(row, { name })).filter(Boolean),
      );
    }
  }

  const docByName = new Map(docs.map((d) => [d.name, d]));
  const grouped = groupAndResolve([...mapCandidates(candidates), ...structured]);
  const assumptionRows: any[] = [];
  for (const [field_key, res] of grouped.entries()) {
    const def = ASSUMPTION_BY_KEY[field_key];
    if (!def) continue;
    const winner = res.winner;
    const srcDoc = docByName.get(winner.source_doc_name);
    assumptionRows.push({
      project_id: project.id,
      owner_id: owner,
      field_key: def.key,
      field_label: def.label,
      category: def.category,
      unit: def.unit,
      value_numeric: res.value_numeric,
      value_text: res.value_text,
      status: res.status,
      conflict_values: res.conflict_values,
      confidence_score: winner.confidence,
      confidence_band: bandFor(winner.confidence),
      source_document_id: srcDoc?.id ?? null,
      source_location: winner.source_location ?? srcDoc?.name ?? null,
      source_text: winner.source_text,
      ai_reasoning: `Loaded by deterministic Rivergate demo extraction via ${winner.matched_alias}.`,
    });
  }

  for (const def of ASSUMPTION_DEFS) {
    if (assumptionRows.some((r) => r.field_key === def.key)) continue;
    assumptionRows.push({
      project_id: project.id,
      owner_id: owner,
      field_key: def.key,
      field_label: def.label,
      category: def.category,
      unit: def.unit,
      value_numeric: null,
      value_text: null,
      status: "missing",
      confidence_score: 0,
      confidence_band: "missing",
      ai_reasoning: "No deterministic source value found in the Rivergate fixture.",
    });
  }

  const assumptions = await supabase.from("assumptions").insert(assumptionRows);
  if (assumptions.error) throw assumptions.error;

  const budgetDoc = docs.find((d) => d.name === "Rivergate_Construction_Budget.xlsx");
  const budgetEngineRows = budgetRows.map((row) => ({
    project_id: project.id,
    owner_id: owner,
    category: row.category,
    label: row.label,
    amount: row.amount,
    source: "analyst",
    status: "approved",
    source_document_id: budgetDoc.id,
    source_text: row.sourceText,
  }));
  const budget = await supabase.from("development_budget").insert(budgetEngineRows);
  if (budget.error) throw budget.error;

  const rentDoc = docs.find((d) => d.name === "Rivergate_Rent_Roll.xlsx");
  const revenueRows = rentRollRows.map((row) => ({
    project_id: project.id,
    owner_id: owner,
    unit_type: row.unitType,
    unit_count: row.unitCount,
    avg_sf: row.avgSf,
    market_rent_monthly: row.rent,
    rent_basis: row.rentBasis,
    occupancy_pct: row.occupancyPct,
    source: "analyst",
    status: "approved",
    source_document_id: rentDoc.id,
    source_text: row.sourceCellRef,
  }));
  const revenue = await supabase.from("revenue_program").insert(revenueRows);
  if (revenue.error) throw revenue.error;

  const scalarRows = [
    ["loan_amount", grouped.get("debt_amount")?.value_numeric, "debt_amount"],
    ["equity_amount", grouped.get("equity_amount")?.value_numeric, "equity_amount"],
  ].flatMap(([key, value, assumptionKey]) => {
    if (value == null) return [];
    const assumption = assumptionRows.find((row) => row.field_key === assumptionKey);
    return [
      {
        project_id: project.id,
        owner_id: owner,
        key,
        value_numeric: value,
        source: "analyst",
        status: "approved",
        source_document_id: assumption?.source_document_id ?? null,
        source_text: assumption?.source_text ?? null,
        approved_by: owner,
        approved_at: new Date().toISOString(),
      },
    ];
  });
  const scalars = await supabase
    .from("underwriting_inputs")
    .upsert(scalarRows, { onConflict: "project_id,key" });
  if (scalars.error) throw scalars.error;

  const keys = [
    "residential_units",
    "residential_rent_monthly",
    "residential_occupancy",
    "retail_sf",
    "retail_rent_psf",
    "retail_occupancy",
    "office_sf",
    "office_rent_psf",
    "office_occupancy",
    "lease_up_months",
  ];
  console.log(
    JSON.stringify(
      {
        project_id: project.id,
        documents: docs.length,
        assumptions: assumptionRows.length,
        development_budget: budgetEngineRows.length,
        revenue_program: revenueRows.length,
        scalar_engine_rows: scalarRows.length,
        revenue_fields: Object.fromEntries(
          keys.map((key) => [key, grouped.get(key)?.value_numeric ?? null]),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
