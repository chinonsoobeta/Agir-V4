#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const target = resolve(process.cwd(), "src/integrations/supabase/types.ts");
const tmp = await mkdtemp(join(tmpdir(), "agir-types-"));
const generated = join(tmp, "types.ts");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

try {
  const output = run("supabase", ["gen", "types", "typescript", "--local", "--schema", "public"], {
    capture: true,
  });
  await writeFile(generated, output);
  run("npx", ["prettier", "--config", resolve(process.cwd(), ".prettierrc"), "--write", generated]);
  const [expected, actual] = await Promise.all([
    readFile(target, "utf8"),
    readFile(generated, "utf8"),
  ]);
  if (expected !== actual) {
    console.error(
      "[types:check] src/integrations/supabase/types.ts is out of date. Regenerate it with: supabase gen types typescript --local --schema public > src/integrations/supabase/types.ts",
    );
    process.exit(1);
  }
  console.log("[types:check] Supabase generated types are in sync.");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
