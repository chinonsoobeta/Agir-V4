import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
    }),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const downloads = "/Users/amitbhattacharya/Downloads";
const files = [
  [
    "Harbour_Centre_Sponsor_Summary.pdf",
    "demo/harbour-centre/Sponsor_Summary.pdf",
    "application/pdf",
  ],
  ["Harbour_Centre_Market_Study.pdf", "demo/harbour-centre/Market_Study.pdf", "application/pdf"],
  [
    "Harbour_Centre_Broker_Opinion.pdf",
    "demo/harbour-centre/Broker_Opinion.pdf",
    "application/pdf",
  ],
  [
    "Harbour_Centre_Lender_Term_Sheet.pdf",
    "demo/harbour-centre/Lender_Term_Sheet.pdf",
    "application/pdf",
  ],
  [
    "Harbour_Centre_Construction_Budget.xlsx",
    "demo/harbour-centre/Construction_Budget.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "Harbour_Centre_Rent_Roll.xlsx",
    "demo/harbour-centre/Rent_Roll.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
];

for (const [name, storagePath, contentType] of files) {
  const body = fs.readFileSync(path.join(downloads, name));
  const upload = await supabase.storage.from("documents").upload(storagePath, body, {
    upsert: true,
    contentType,
  });
  if (upload.error) throw new Error(`${name}: ${upload.error.message}`);
  console.log(`uploaded ${name} -> ${storagePath}`);
}
