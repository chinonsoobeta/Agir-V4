#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const result = spawnSync(
  "supabase",
  ["gen", "types", "typescript", "--local", "--schema", "public"],
  { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
);
if (result.status !== 0) throw new Error(result.stderr || "Supabase type generation failed");
const target = resolve("src/integrations/supabase/types.ts");
await writeFile(target, result.stdout);
const formatted = spawnSync("npx", ["prettier", "--write", target], { stdio: "inherit" });
if (formatted.status !== 0) throw new Error("Generated type formatting failed");
console.log(`[types:refresh] wrote ${target}`);
