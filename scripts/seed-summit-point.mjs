// Local QA helper: seed the Summit Point Logistics Park deal end-to-end —
// create the project, upload the 11 source documents to the `documents` bucket,
// and insert linked document rows. Then the UI extraction can run against it.
import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: users } = await admin.auth.admin.listUsers();
const owner = users.users.find((u) => u.email === "maple.heights@example.com");
if (!owner) throw new Error("demo user not found");

// Fresh project each run.
await admin.from("projects").delete().eq("name", "Summit Point Logistics Park");
const { data: project, error: pErr } = await admin.from("projects").insert({
  owner_id: owner.id, name: "Summit Point Logistics Park",
  location: "I-85 logistics corridor, Charlotte, North Carolina",
  type: "industrial", status: "pipeline",
}).select().single();
if (pErr) throw new Error("project insert: " + pErr.message);
console.log("project:", project.id);

const srcDir = "/Users/chinonsoobeta/Downloads/source_documents";
const files = (await readdir(srcDir)).filter((f) => /\.(pdf|xlsx|xls|docx?|json)$/i.test(f));
const CAT = (n) =>
  /budget/i.test(n) ? "Budget" : /rent_roll/i.test(n) ? "Financial Model" : /appraisal/i.test(n) ? "Appraisal"
  : /market/i.test(n) ? "Market Study" : /term_sheet|rate_lock/i.test(n) ? "Loan Package"
  : /lease/i.test(n) ? "Legal" : /environmental/i.test(n) ? "Other" : /tax/i.test(n) ? "Other"
  : /sponsor/i.test(n) ? "Other" : "Other";
const TYPE = (n) => n.endsWith(".pdf") ? "application/pdf"
  : n.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  : n.endsWith(".json") ? "application/json" : "application/octet-stream";

let n = 0;
for (const f of files) {
  const bytes = await readFile(path.join(srcDir, f));
  const storagePath = `${owner.id}/${Date.now()}-${f}`;
  const up = await admin.storage.from("documents").upload(storagePath, bytes, { contentType: TYPE(f), upsert: true });
  if (up.error) { console.error("upload failed", f, up.error.message); continue; }
  const { error: dErr } = await admin.from("documents").insert({
    project_id: project.id, owner_id: owner.id, name: f, file_type: TYPE(f),
    category: CAT(f), storage_path: storagePath, size_bytes: bytes.length,
  });
  if (dErr) { console.error("doc row failed", f, dErr.message); continue; }
  n++;
}
console.log(`uploaded ${n}/${files.length} documents`);
console.log("PROJECT_ID=" + project.id);
