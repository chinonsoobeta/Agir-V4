#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => !file.endsWith("package-lock.json"))
  .filter((file) => !file.startsWith("src/test/fixtures/"));

const patterns = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: "Supabase service JWT",
    pattern: /eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,
  },
  { name: "GitHub token", pattern: /gh[oprsu]_[A-Za-z0-9_]{30,}/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
];

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const candidate of patterns) {
    const documentedLocalSupabaseFixture =
      file === "scripts/load-rivergate-demo.ts" &&
      text.includes("http://127.0.0.1:54321") &&
      candidate.name === "Supabase service JWT";
    if (candidate.pattern.test(text) && !documentedLocalSupabaseFixture) {
      findings.push(`${file}: ${candidate.name}`);
    }
  }
}

if (findings.length) {
  for (const finding of findings) console.error(`[secret-scan] ${finding}`);
  process.exit(1);
}
console.log(`[secret-scan] PASS: ${files.length} tracked files scanned.`);
