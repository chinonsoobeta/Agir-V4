import fs from "node:fs";
import { extractCandidates } from "../src/lib/assumption-candidates.server.ts";
import { extractFileText } from "../src/lib/document-text.server.ts";

const files = [
  ["Harbour_Centre_Sponsor_Summary.pdf", "application/pdf"],
  ["Harbour_Centre_Market_Study.pdf", "application/pdf"],
  ["Harbour_Centre_Broker_Opinion.pdf", "application/pdf"],
  ["Harbour_Centre_Lender_Term_Sheet.pdf", "application/pdf"],
  [
    "Harbour_Centre_Construction_Budget.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "Harbour_Centre_Rent_Roll.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
];

let total = 0;
for (const [name, type] of files) {
  const filePath = `/Users/amitbhattacharya/Downloads/${name}`;
  const buffer = fs.readFileSync(filePath);
  const text = await extractFileText(
    name,
    type,
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  const candidates = extractCandidates(name, text);
  total += candidates.length;
  console.log(`${name}: text chars=${text.length}, candidates=${candidates.length}`);
  for (const candidate of candidates.slice(0, 5)) {
    console.log(`  ${candidate.kind} ${candidate.value_text} | hint=${candidate.label_hint}`);
  }
}
console.log(`total candidates=${total}`);
