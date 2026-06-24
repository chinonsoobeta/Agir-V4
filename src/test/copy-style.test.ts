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

    expect(source).toContain("Make the call with better evidence.");
    expect(source).toContain("Every financial output comes from approved inputs");
    expect(source).toContain("The numbers must be exact.");
    expect(source).not.toContain("AI-powered");
  });
});
