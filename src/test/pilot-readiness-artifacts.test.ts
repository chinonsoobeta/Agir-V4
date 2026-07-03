import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("pilot readiness artifacts", () => {
  test("registers the audit, fresh environment, and extraction worker commands", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(pkg.scripts["smoke:fresh-env"]).toBe("node scripts/fresh-environment-smoke.mjs");
    expect(pkg.scripts["pilot:audit"]).toBe("node scripts/audit-pilot-readiness.mjs");
    expect(pkg.scripts["pilot:gate"]).toBe("node scripts/pilot-confidence-gate.mjs");
    expect(pkg.scripts["worker:extraction"]).toBe("node scripts/extraction-worker.mjs");
  });

  test("documents the unsupervised pilot path and observation criteria", () => {
    const script = read("docs/pilot/unsupervised-pilot-script.md");
    const scorecard = read("docs/pilot/pilot-observation-scorecard.md");
    const checklist = read("docs/pilot/readiness-checklist.md");

    for (const phrase of [
      "Dashboard",
      "Seed demo deal",
      "Harbour Centre",
      "Upload source documents",
      "Generate IC memo",
      "No investment decision",
      "Export the customer audit package",
      "What confused you?",
    ]) {
      expect(script).toContain(phrase);
    }
    for (const phrase of [
      "time-to-underwriting",
      "support intervention",
      "trust objection",
      "Fail: fabricated assumption",
    ]) {
      expect(scorecard).toContain(phrase);
    }
    for (const command of [
      "npm run smoke:fresh-env",
      "npm run pilot:gate",
      "npm run pilot:audit",
      "npm run backend:audit",
      "npm run types:check",
      "npm run typecheck",
      "npm run test",
      "npm run lint",
      "npm run build",
      "npm run test:e2e",
      "npm run test:rls",
    ]) {
      expect(checklist).toContain(command);
    }
    expect(checklist).toContain("Demo user sign-in tested");
    expect(checklist).toContain("Unsupervised demo guide");
    expect(checklist).toContain("--quick");
    expect(checklist).toContain("--full");
  });

  test("pilot confidence gate composes checks and prints a structured summary", () => {
    const gate = read("scripts/pilot-confidence-gate.mjs");
    expect(gate).toContain("drift:check");
    expect(gate).toContain("audit:migrations");
    expect(gate).toContain("backend:audit");
    expect(gate).toContain("pilot:audit");
    expect(gate).toContain("test:rls");
    expect(gate).toContain("PILOT_GATE_E2E");
    expect(gate).toContain("[pilot-gate] summary");
    expect(gate).toContain("ARMED");
    expect(gate).toContain("SCHEMA_DRIFT_DATABASE_URL");
    expect(gate).toContain('scope: "pilot-blocking"');
  });
});
