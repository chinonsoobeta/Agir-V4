import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const EM_DASH = String.fromCodePoint(0x2014);
const SEARCH_PATHS = [
  "src",
  "docs",
  "scripts",
  "supabase",
  "README.md",
  "DEPLOYMENT.md",
  "vite.config.ts",
];

function textFiles(path: string): string[] {
  const absolute = resolve(ROOT, path);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute).flatMap((entry) => textFiles(join(path, entry)));
}

describe("product copy", () => {
  it("does not contain em dashes", () => {
    const offenders = SEARCH_PATHS.flatMap(textFiles)
      .filter((file) => !file.includes("node_modules"))
      .filter((file) => readFileSync(file, "utf8").includes(EM_DASH))
      .map((file) => file.replace(`${ROOT}/`, ""));

    expect(offenders).toEqual([]);
  });

  it("keeps the public landing page focused on concrete product outcomes", () => {
    const source = readFileSync(resolve(ROOT, "src/routes/index.tsx"), "utf8");

    expect(source).toContain("Keep permit research clear and organized.");
    expect(source).toContain("Keeping a possible approval does not make it a legal requirement.");
    expect(source).toMatch(/Underwriting is\s+available to signed-in users as a Preview/);
    expect(source).toContain("Create cases across 22 British Columbia municipalities.");
    expect(source).toContain("Each jurisdiction has a dated official-source inventory");
    expect(source).not.toContain("AI-powered");
  });
});
