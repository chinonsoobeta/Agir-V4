import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260711001300_permits_first_pilot_governance.sql");
const openAccessMigration = read(
  "supabase/migrations/20260712000200_open_authenticated_product_access.sql",
);
const shell = read("src/components/app-shell.tsx");
const landing = read("src/routes/index.tsx");
const auth = read("src/routes/auth.tsx");

describe("permits-first pilot governance", () => {
  it("uses the approved six-municipality cohort without deleting historical evidence", () => {
    expect(migration).toContain("'City of Coquitlam'");
    expect(migration).toContain("SET active=false");
    expect(migration).toContain("WHERE name='City of New Westminster'");
    expect(migration).toContain("'2026-07-11-coquitlam-pilot'");
    expect(migration).not.toMatch(/DELETE FROM public\.permit_rules/);
  });

  it("keeps external approval claims fail closed", () => {
    expect(migration).toContain("approval_status text NOT NULL DEFAULT 'draft'");
    expect(migration).toContain("approval_status<>'approved'");
    expect(migration).toContain("'permit_limitations','2026-07-11-draft-1'");
    expect(migration).not.toContain("'permit_limitations','2026-07-11-draft-1','approved'");
  });

  it("adds allowlist, assignment, handoff, review, feedback, and privacy-conscious events", () => {
    for (const table of [
      "pilot_user_access",
      "legal_copy_versions",
      "permit_case_assignments",
      "permit_case_handoffs",
      "permit_review_items",
      "permit_feedback",
      "permit_pilot_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("respond_permit_case_handoff");
    expect(migration).toContain("full_address");
    expect(migration).toContain("document_text");
    expect(migration).toContain("WITH (security_invoker=true)");
  });

  it("makes Permits primary and keeps Underwriting visibly labelled Preview", () => {
    expect(shell).toContain('["permits", "underwriting"]');
    expect(shell).toContain("Underwriting Preview");
    expect(shell).not.toContain("Request pilot access");
    expect(shell).not.toContain("Access is limited during the pilot");
    expect(auth).toContain('navigate({ to: "/permits"');
    expect(landing).toContain("Property research and workflow system");
    expect(landing).toContain("Permit research and workflow");
    expect(landing).toContain("Coquitlam");
  });

  it("grants both products to every authenticated user without weakening ownership rules", () => {
    expect(openAccessMigration).toContain("SELECT true, true, 'general_access'::text");
    expect(openAccessMigration).toContain("SELECT auth.uid() IS NOT NULL");
    expect(openAccessMigration).toContain("TO authenticated");
    expect(openAccessMigration).toContain("FROM PUBLIC,anon");
    expect(openAccessMigration).not.toMatch(/DROP POLICY|DISABLE ROW LEVEL SECURITY/);
  });

  it("does not add GIS or couple permits into underwriting", () => {
    expect(migration).not.toMatch(/arcgis|postgis|st_geocode/i);
    expect(migration).not.toMatch(/INSERT INTO public\.assumptions|UPDATE public\.assumptions/);
  });
});
