import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260712000300_expand_permit_research_coverage.sql",
  "utf8",
);
const hardeningMigration = readFileSync(
  "supabase/migrations/20260712000700_permit_evidence_and_access_hardening.sql",
  "utf8",
);
const transactionalMigration = readFileSync(
  "supabase/migrations/20260712001000_transactional_permit_catalogue_generation.sql",
  "utf8",
);
const completionMigration = readFileSync(
  "supabase/migrations/20260714000100_close_catalogue_search_and_property_upload_gaps.sql",
  "utf8",
);
const functions = readFileSync("src/lib/permit-cases.functions.ts", "utf8");
const workspace = readFileSync("src/routes/_authenticated/permits.$caseId.tsx", "utf8");

describe("permit research expansion", () => {
  it("adds coverage-labelled research for 21 Metro Vancouver municipalities and Kelowna", () => {
    for (const name of [
      "Village of Anmore",
      "Village of Belcarra",
      "Bowen Island Municipality",
      "City of Delta",
      "City of Langley",
      "Township of Langley",
      "City of Maple Ridge",
      "City of North Vancouver",
      "District of North Vancouver",
      "City of Pitt Meadows",
      "City of Port Coquitlam",
      "City of Port Moody",
      "District of West Vancouver",
      "City of White Rock",
      "City of Kelowna",
    ]) {
      expect(migration).toContain(name);
    }
    expect(migration).toContain("coverage_status");
    expect(migration).toContain("Coverage placeholder only. This row is not a permit requirement.");
  });

  it("records completed official-source inventories without claiming qualified approval", () => {
    expect(completionMigration).toContain(
      "CREATE TABLE IF NOT EXISTS public.municipal_research_sources",
    );
    expect(completionMigration).toContain("'researched','reviewed'");
    expect(completionMigration).toContain(
      "CASE WHEN j.coverage_status='reviewed' THEN 'reviewed' ELSE 'researched' END",
    );
    expect(completionMigration).toContain("Category and case applicability remain unapproved");
    expect(completionMigration).not.toContain("SET coverage_status='reviewed'");
  });

  it("selects one current rule per permit type without deleting prior evidence", () => {
    expect(functions).toContain('"generate_permit_catalogue_candidates"');
    expect(functions).toContain('p_parent_kind: "permit_case"');
    expect(transactionalMigration).toContain("PARTITION BY rule.permit_type");
    expect(transactionalMigration).toContain("rule.review_date DESC NULLS LAST");
    expect(transactionalMigration).toContain("rule.effective_date DESC NULLS LAST");
    expect(transactionalMigration).toContain("rule.rule_version DESC");
    expect(transactionalMigration).toContain("rule.id ASC");
    expect(transactionalMigration).toContain("catalogue_rule_snapshot");
    expect(migration).not.toContain("DELETE FROM public.project_permits");
    expect(transactionalMigration).not.toContain("DELETE FROM public.project_permits");
  });

  it("uses scope only as a conservative review signal", () => {
    expect(transactionalMigration).toContain("permit_catalogue_scope_signalled");
    expect(transactionalMigration).toContain("'scope_signalled'");
    expect(transactionalMigration).toContain("'catalogue_only_scope_unconfirmed'");
    expect(transactionalMigration).toContain("'unknown','not_started'");
    expect(transactionalMigration).toContain("NULL,rule.published_duration_text");
    expect(transactionalMigration).not.toContain("'required','not_started'");
  });

  it("keeps document intelligence review-only and case-scoped", () => {
    expect(migration).toContain("permit_case_id uuid REFERENCES public.permit_cases");
    expect(functions).toContain("extractPermitCaseDocumentCandidates");
    expect(hardeningMigration).toContain("confidence_score, 'needs_review', v_version");
    expect(hardeningMigration).toContain("This does not confirm a Permit requirement");
    expect(workspace).toContain("It is not a confirmed");
    expect(workspace).toContain("Keep for research");
  });
});
