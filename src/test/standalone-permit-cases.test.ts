import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { permitCaseInputSchema } from "@/lib/permit-cases.functions";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260711000500_standalone_permit_cases.sql"),
  "utf8",
);
const server = readFileSync(resolve(root, "src/lib/permit-cases.functions.ts"), "utf8");
const transactionalMigration = readFileSync(
  resolve(root, "supabase/migrations/20260712001000_transactional_permit_catalogue_generation.sql"),
  "utf8",
);
const shell = readFileSync(resolve(root, "src/components/app-shell.tsx"), "utf8");

describe("standalone permit cases", () => {
  it.each([
    ["Backyard suite", "residential", "accessory_secondary_dwelling", "single_family_residential"],
    ["House renovation", "residential", "renovation", "single_family_residential"],
    ["Tenant improvement", "commercial", "tenant_improvement", "commercial"],
    ["Plant alteration", "industrial", "industrial_alteration", "industrial"],
    ["Mixed-use tower", "mixed_use", "new_construction", "large_development"],
  ])("accepts an incomplete %s case without false certainty", (name, property, work, context) => {
    const parsed = permitCaseInputSchema.parse({
      name,
      property_type: property,
      work_type: work,
      project_context: context,
      municipality_confirmed: false,
    });
    expect(parsed.municipality).toBeUndefined();
    expect(parsed.zoning_designation).toBeUndefined();
  });

  it("rejects a claimed municipality without its name", () => {
    expect(() =>
      permitCaseInputSchema.parse({ name: "Case", municipality_confirmed: true }),
    ).toThrow("confirmed municipality");
  });

  it("rejects unsupported zoning conclusions", () => {
    expect(() => permitCaseInputSchema.parse({ name: "Case", zoning_designation: "R1" })).toThrow(
      "Zoning requires a source",
    );
  });

  it("backfills existing permit IDs rather than duplicating permit rows", () => {
    expect(migration).toContain("UPDATE public.project_permits pp SET case_id=pc.id");
    expect(migration).not.toMatch(
      /INSERT INTO public\.project_permits[\s\S]*SELECT[\s\S]*project_permits/,
    );
  });

  it("isolates case reads and writes through separate RLS checks", () => {
    expect(migration).toContain("permit_case_access");
    expect(migration).toContain("permit_case_write_access");
    expect(migration).toContain("d.owner_id=auth.uid()");
    expect(migration).toContain("ALTER TABLE public.permit_case_history ENABLE ROW LEVEL SECURITY");
  });

  it("only queries rules for the explicitly confirmed municipality", () => {
    expect(server).toContain("municipality_confirmed");
    expect(server).toContain('"generate_permit_catalogue_candidates"');
    expect(server).toContain('p_parent_kind: "permit_case"');
    expect(transactionalMigration).toContain("IF NOT v_municipality_confirmed");
    expect(transactionalMigration).toContain("WHERE jurisdiction.name=v_municipality");
    expect(transactionalMigration).toContain("jurisdiction.jurisdiction_type='municipality'");
    expect(transactionalMigration).toContain(
      "rule.name,rule.permit_type,rule.description,'unknown'",
    );
    expect(transactionalMigration).toContain("permit_rule_id");
  });

  it("persists and announces product mode without creating records", () => {
    expect(shell).toContain('window.localStorage.setItem("agir-product-mode", mode)');
    expect(shell).toContain('key: "productMode"');
    expect(shell).toContain('aria-live="polite"');
    expect(shell).not.toContain("createPermitCase");
  });
});
