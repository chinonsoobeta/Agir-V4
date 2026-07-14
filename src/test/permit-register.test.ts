import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  displayDuration,
  displayRequirement,
  extractExplicitPermitMentions,
  extractPermitResearchCandidates,
  PERMIT_UNKNOWN_DURATION,
  PERMIT_UNKNOWN_REQUIREMENT,
  ruleMatchesMunicipality,
  validatePermitFact,
} from "@/lib/permit-domain";

const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260711000100_project_permit_register.sql", import.meta.url),
  "utf8",
);
const matrixMigration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260711000200_complete_pilot_permit_matrix.sql",
    import.meta.url,
  ),
  "utf8",
);
const permitFunctions = fs.readFileSync(
  new URL("../lib/permits.functions.ts", import.meta.url),
  "utf8",
);
const permitUi = fs.readFileSync(
  new URL("../components/permits/permit-workspace.tsx", import.meta.url),
  "utf8",
);
const governanceMigration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260711000300_permit_governance_and_review.sql",
    import.meta.url,
  ),
  "utf8",
);
const transactionalMigration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260712001000_transactional_permit_catalogue_generation.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("permit register deterministic domain", () => {
  it("renders explicit unknown duration and applicability", () => {
    expect(displayDuration({})).toBe(PERMIT_UNKNOWN_DURATION);
    expect(displayRequirement({ applicability_status: "unknown" })).toBe(
      PERMIT_UNKNOWN_REQUIREMENT,
    );
  });
  it("prevents unsupported duration invention", () => {
    expect(
      validatePermitFact({
        processing_duration_days: 28,
        source_kind: "analyst",
        notes: "entry",
        applicability_status: "unknown",
      }),
    ).toContain("A numeric duration requires a traceable source.");
  });
  it("requires analyst rationale", () => {
    expect(
      validatePermitFact({
        source_kind: "analyst",
        applicability_status: "required",
        is_required: true,
      }),
    ).toContain("Analyst-provided facts require a reason or note.");
  });
  it("keeps checkbox and applicability semantics aligned", () => {
    expect(
      validatePermitFact({
        source_kind: "unknown",
        applicability_status: "needs_review",
        is_required: true,
      }),
    ).toContain("Required state must agree with applicability.");
  });
  it("never applies one municipality rule to another", () => {
    expect(
      ruleMatchesMunicipality({ jurisdiction_id: "vancouver" }, { jurisdiction_id: "burnaby" }),
    ).toBe(false);
    expect(ruleMatchesMunicipality({ jurisdiction_id: "vancouver" }, {})).toBe(false);
  });

  it("extracts only explicit document mentions without inventing facts", () => {
    const candidates = extractExplicitPermitMentions(
      "General construction discussion\nA plumbing permit is listed on page 4.\nNo timing is stated.",
    );
    expect(candidates).toEqual([
      {
        candidateName: "A plumbing permit",
        permitType: "plumbing",
        sourceLocation: "line 2",
        sourceText: "A plumbing permit is listed on page 4.",
      },
    ]);
    expect(candidates[0]).not.toHaveProperty("duration");
    expect(extractExplicitPermitMentions("Renovation work is planned.")).toEqual([]);
  });

  it("categorizes only the explicit permit phrase for review", () => {
    const candidates = extractExplicitPermitMentions(
      "Electrical permit listed.\nA change of use approval may be needed.\nSpecial licence noted.",
    );
    expect(candidates.map((candidate) => candidate.permitType)).toEqual([
      "electrical",
      "occupancy_change_of_use",
      "other",
    ]);
  });

  it("turns explicit work scope into sourced review clues without deciding applicability", () => {
    const candidates = extractPermitResearchCandidates(
      "Scope: replace the service panel and add two circuits.\nInstall a heat pump and new ductwork.",
    );
    expect(candidates.map((candidate) => candidate.permitType)).toEqual([
      "electrical",
      "mechanical_hvac",
    ]);
    expect(candidates.every((candidate) => candidate.evidenceKind === "work_scope_signal")).toBe(
      true,
    );
    expect(candidates[0]).toMatchObject({
      candidateName: "Electrical permit or approval",
      sourceLocation: "line 1",
      confidenceScore: 0.55,
    });
    expect(candidates[0].description).toContain("before deciding whether an approval applies");
  });
});
describe("permit migration contract", () => {
  for (const table of [
    "jurisdictions",
    "permit_rules",
    "project_permits",
    "permit_requirements",
    "permit_documents",
    "permit_history",
  ])
    it(`creates and protects ${table}`, () => {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    });
  it("seeds only the six pilot municipalities with regional context", () => {
    for (const city of [
      "City of Vancouver",
      "City of Burnaby",
      "City of Richmond",
      "City of Surrey",
      "City of New Westminster",
      "City of Kelowna",
    ])
      expect(migration).toContain(city);
    expect(migration).toContain("'Metro Vancouver'");
    expect(migration).toMatch(/'City of Kelowna','British Columbia',NULL/);
  });
  it("creates history and audit triggers", () => {
    expect(migration).toContain("INSERT INTO public.permit_history");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(migration).toContain("permit_documents_audit");
    expect(migration).toContain("permit_requirements_audit");
  });
  it("preserves unknown zoning and underwriting isolation", () => {
    expect(migration).toContain("zoning_designation text");
    expect(migration).not.toMatch(
      /INSERT INTO public\.assumptions|UPDATE public\.assumptions|financial_outputs|underwriting_runs/,
    );
  });
  it("persists source confidence and document links", () => {
    for (const field of [
      "confidence_score",
      "source_kind",
      "source_text",
      "source_document_id",
      "duration_source",
    ])
      expect(migration).toContain(field);
    expect(migration).toContain("PRIMARY KEY (permit_id, document_id)");
  });
});

describe("complete pilot matrix and workflow contract", () => {
  it("defines every requested category in the six-municipality matrix", () => {
    for (const category of [
      "building",
      "development",
      "zoning_land_use",
      "plumbing",
      "electrical",
      "mechanical_hvac",
      "demolition",
      "tenant_improvement",
      "occupancy_change_of_use",
      "fire_life_safety",
      "tree",
      "heritage",
      "environmental_site",
      "excavation_shoring_servicing",
    ]) {
      expect(matrixMigration).toContain(`('${category}'`);
    }
    expect(matrixMigration).toContain("CROSS JOIN categories");
  });

  it("keeps unsupported categories explicitly unknown", () => {
    expect(matrixMigration).toContain("'unknown'");
    expect(matrixMigration).toContain(
      "No category-specific official determination is recorded in the reviewed pilot source set.",
    );
    expect(matrixMigration).not.toMatch(/\d+\s*-\s*\d+\s*weeks/i);
  });

  it("generates municipality-matched, non-required evidence in one governed transaction", () => {
    expect(permitFunctions).toContain('"generate_permit_catalogue_candidates"');
    expect(permitFunctions).toContain('p_parent_kind: "project"');
    expect(transactionalMigration).toContain("pg_advisory_xact_lock");
    expect(transactionalMigration).toContain("WHERE jurisdiction.name=v_municipality");
    expect(transactionalMigration).toContain("AND rule.superseded_at IS NULL");
    expect(transactionalMigration).toContain("to_jsonb(rule) AS rule_snapshot");
    expect(transactionalMigration).toContain(
      "rule.name,rule.permit_type,rule.description,'unknown'",
    );
    expect(transactionalMigration).toContain("'unresolved'");
    expect(transactionalMigration).toContain("ON CONFLICT DO NOTHING");
    expect(transactionalMigration).toContain(
      "Possible paperwork if this approval applies. Confirm before relying on it.",
    );
    expect(transactionalMigration).not.toContain("DELETE FROM public.project_permits");
  });

  it("exposes document linking, audited downloads, and full checklist editing", () => {
    for (const operation of [
      "linkPermitDocument",
      "unlinkPermitDocument",
      "getDocumentUrl",
      "addPermitRequirement",
      "updatePermitRequirement",
      "deletePermitRequirement",
    ]) {
      expect(permitUi).toContain(operation);
    }
    expect(permitUi).toContain("Choose project document");
    expect(permitUi).toContain("Add paperwork");
  });

  it("adds source governance, external authorities, review-only extraction, and disabled zoning sources", () => {
    for (const table of [
      "permit_rule_reviews",
      "permit_extraction_candidates",
      "authoritative_land_data_sources",
    ]) {
      expect(governanceMigration).toContain(`CREATE TABLE public.${table}`);
      expect(governanceMigration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(governanceMigration).toContain("'Metro Vancouver','British Columbia'");
    expect(governanceMigration).toContain("'regional_district'");
    expect(governanceMigration).toContain("'disabled'");
    expect(governanceMigration).toContain("permit_rule_review_queue");
  });
});
