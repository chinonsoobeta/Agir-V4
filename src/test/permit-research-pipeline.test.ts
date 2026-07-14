import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPermitResearchDocumentReady } from "@/lib/permit-research.server";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Permit document research pipeline", () => {
  it.each(["uploaded", "analyzed"])("accepts clean %s documents", (status) => {
    expect(() => assertPermitResearchDocumentReady({ scan_status: "clean", status })).not.toThrow();
  });

  it.each([
    { scan_status: "pending", status: "uploaded" },
    { scan_status: "rejected", status: "uploaded" },
    { scan_status: "clean", status: "rejected" },
    { scan_status: "clean", status: "pending" },
  ])("rejects unverified or unsafe lifecycle state $scan_status/$status", (document) => {
    expect(() => assertPermitResearchDocumentReady(document)).toThrow(
      /Finish document verification/,
    );
  });

  it("registers durable job kinds and worker dispatch", () => {
    const migration = read(
      "supabase/migrations/20260712000700_permit_evidence_and_access_hardening.sql",
    );
    const worker = read("src/routes/api/extraction/worker.ts");
    const queue = read("src/lib/permit-research.server.ts");
    for (const kind of ["permit_case_research", "permit_project_research"]) {
      expect(migration).toContain(`'${kind}'`);
      expect(worker).toContain(`"${kind}"`);
      expect(queue).toContain(`"${kind}"`);
    }
    expect(worker).toContain("jobActorCanWriteParent");
    expect(worker).toContain("jobActorCanAnalyzeDocument");
    expect(worker).toContain("executePermitDocumentResearch");
    expect(worker).toContain("!job.owner_id");
    expect(worker).toContain("!fullJob.owner_id");
    expect(worker).toContain("assertLiveLease");
    expect(worker).toContain("assertCanPersist: assertLiveLease");
    expect(queue).toContain("assertCanPersist");
    expect(queue).toContain("record_permit_research_candidates");
    expect(queue).toContain('getServiceRoleClient("permit_research_worker")');
    expect(read("scripts/audit-service-role-usage.mjs")).toContain(
      '"src/lib/permit-research.server.ts"',
    );
  });

  it("keeps viewers read-only and reviews candidates through one locked RPC", () => {
    const migration = read(
      "supabase/migrations/20260712000700_permit_evidence_and_access_hardening.sql",
    );
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.permit_extraction_candidates FROM authenticated",
    );
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("review_permit_extraction_candidate");
    expect(migration).toContain("document_candidate_' || p_decision");
  });

  it("persists structured address identity and clears stale provider metadata on edits", () => {
    const deal = read("src/routes/_authenticated/deals.tsx");
    const permit = read("src/routes/_authenticated/permits.new.tsx");
    const property = read("src/components/properties/property-editor.tsx");
    expect(deal).toContain("property_address: selection.addressLine1");
    expect(permit).toContain("property_address: s.addressLine1");
    for (const source of [deal, permit]) {
      expect(source).toContain("address_place_id: null");
      expect(source).toContain("latitude: null");
      expect(source).toContain("longitude: null");
    }
    expect(property).toContain('place_provider: "manual"');
    expect(property).toContain("provider_place_id: null");
  });
});
