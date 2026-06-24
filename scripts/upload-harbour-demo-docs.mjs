// Regenerate the synthetic Harbour Centre demo documents and upload them into
// Supabase Storage for every seeded "Harbour Centre" project, then point the
// document rows at the uploaded files. Use this to repair a demo whose files
// are missing from storage (the error seedHarbourCentre throws tells you to).
//
// The document content mirrors src/lib/harbour-demo-docs.ts and contains ONLY
// the verified Harbour fixture values. Run with: node scripts/upload-harbour-demo-docs.mjs
//
// Requires .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Verified Harbour fixture values (mirrors harbour-fixture.ts / harbour-demo-docs.ts).
const DOCS = [
  { name: "Harbour_Centre_Sponsor_Summary.pdf", storage_file: "Sponsor_Summary.pdf", category: "Sponsor", file_type: "application/pdf", kind: "pdf",
    title: "Harbour Centre: Sponsor Summary",
    lines: ["Common equity contribution: $50,000,000", "Residential rental units: 220 units", "Retail area: 18,000 SF", "Office area: 32,000 SF"] },
  { name: "Harbour_Centre_Market_Study.pdf", storage_file: "Market_Study.pdf", category: "Market Study", file_type: "application/pdf", kind: "pdf",
    title: "Harbour Centre: Market Study",
    lines: ["Residential rent: $3,050 per unit per month", "Residential occupancy: 96%", "Retail rent: $42 per square foot", "Retail occupancy: 92%", "Office rent: $36 per square foot", "Office occupancy: 85%", "Annual rent growth: 3%"] },
  { name: "Harbour_Centre_Broker_Opinion.pdf", storage_file: "Broker_Opinion.pdf", category: "Appraisal", file_type: "application/pdf", kind: "pdf",
    title: "Harbour Centre: Broker Opinion of Value",
    lines: ["Exit cap rate: 4.75%"] },
  { name: "Harbour_Centre_Lender_Term_Sheet.pdf", storage_file: "Lender_Term_Sheet.pdf", category: "Loan Package", file_type: "application/pdf", kind: "pdf",
    title: "Harbour Centre: Lender Term Sheet",
    lines: ["Senior loan amount: $162,500,000", "Interest rate: 6.25%", "Amortization: 30-year", "Minimum DSCR covenant: 1.20x", "Lender stabilization requirement: 93%", "Terminal cap rate: 5.25%"] },
  { name: "Harbour_Centre_Construction_Budget.xlsx", storage_file: "Construction_Budget.xlsx", category: "Budget", file_type: XLSX_TYPE, kind: "xlsx", sheet: "Construction Budget",
    rows: [["Line item", "Amount"], ["Land acquisition", "$34,500,000"], ["Hard costs", "$162,000,000"], ["Soft costs", "$27,500,000"], ["Financing costs", "$18,000,000"], ["Contingency", "$8,000,000"]] },
  { name: "Harbour_Centre_Rent_Roll.xlsx", storage_file: "Rent_Roll.xlsx", category: "Financial Model", file_type: XLSX_TYPE, kind: "xlsx", sheet: "Rent Roll",
    rows: [["Component", "Value"], ["Residential units", "220 units"], ["Residential rent", "$3,050 per unit per month"], ["Residential occupancy", "96%"], ["Retail area", "18,000 SF"], ["Retail rent", "$42 per square foot"], ["Retail occupancy", "92%"], ["Office area", "32,000 SF"], ["Office rent", "$36 per square foot"], ["Office occupancy", "85%"]] },
];

function render(doc) {
  if (doc.kind === "pdf") {
    const pdf = new jsPDF();
    pdf.setFontSize(16); pdf.text(doc.title, 14, 20);
    pdf.setFontSize(12);
    let y = 36;
    for (const line of doc.lines) { pdf.text(line, 14, y); y += 10; }
    return Buffer.from(pdf.output("arraybuffer"));
  }
  const ws = XLSX.utils.aoa_to_sheet(doc.rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, doc.sheet);
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const { data: projects, error: pErr } = await supabase
  .from("projects").select("id,owner_id").eq("name", "Harbour Centre");
if (pErr) throw pErr;
if (!projects?.length) { console.log("No 'Harbour Centre' projects found."); process.exit(0); }

for (const project of projects) {
  for (const doc of DOCS) {
    const path = `${project.owner_id}/demo/harbour-centre/${doc.storage_file}`;
    const bytes = render(doc);
    const up = await supabase.storage.from("documents").upload(path, bytes, { upsert: true, contentType: doc.file_type });
    if (up.error) throw new Error(`${doc.name}: ${up.error.message}`);

    const { data: existing } = await supabase.from("documents")
      .select("id").eq("project_id", project.id).eq("name", doc.name).maybeSingle();
    if (existing) {
      await supabase.from("documents").update({
        storage_path: path, file_type: doc.file_type, size_bytes: bytes.length, status: "uploaded", extraction_error: null,
      }).eq("id", existing.id);
    } else {
      await supabase.from("documents").insert({
        owner_id: project.owner_id, project_id: project.id, name: doc.name,
        category: doc.category, storage_path: path, file_type: doc.file_type, size_bytes: bytes.length, status: "uploaded",
      });
    }
    console.log(`uploaded ${doc.name} -> ${path}`);
  }
}
console.log(`Repaired Harbour demo docs for ${projects.length} project(s).`);
