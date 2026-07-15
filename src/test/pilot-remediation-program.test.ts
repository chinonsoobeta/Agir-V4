import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260714000200_pilot_remediation_program.sql",
  "utf8",
);
const propertyRoute = readFileSync("src/routes/_authenticated/properties.$propertyId.tsx", "utf8");
const documentFunctions = readFileSync("src/lib/documents.functions.ts", "utf8");
const searchRoute = readFileSync("src/routes/_authenticated/properties.index.tsx", "utf8");
const sourceMonitor = readFileSync("scripts/review-permit-sources.mjs", "utf8");
const releaseGate = readFileSync("docs/pilot/remediation-release-gate.md", "utf8");

describe("pilot remediation contracts", () => {
  test("municipal evidence separates source integrity from qualified approval", () => {
    expect(migration).toContain("municipal_source_snapshots");
    expect(migration).toContain("permit_review_assignments");
    expect(migration).toContain("pilot_external_signoffs");
    expect(migration).toContain("result<>'approved'");
    expect(sourceMonitor).toContain("AgirMunicipalSourceMonitor/1.0");
    expect(sourceMonitor).toContain("municipal_source_snapshots");
    expect(releaseGate).toContain("An unfilled template is not approval evidence.");
  });

  test("property search is immutable, permission-filtered, bounded, and exact", () => {
    expect(migration).toContain("property_search_sessions");
    expect(migration).toContain("property_snapshot jsonb NOT NULL");
    expect(migration).toContain("public.property_access(property.id)");
    expect(migration).toContain("LIMIT 100000");
    expect(migration).toContain("total_count");
    expect(searchRoute).toContain("session_id");
    expect(searchRoute).toContain("content-visibility:auto");
    expect(searchRoute).toContain("of ${totalProperties}");
  });

  test("property files expose durable status, versions, retry, and safe deletion", () => {
    expect(migration).toContain("retry_property_document_upload");
    expect(migration).toContain("prepare_property_document_version_upload");
    expect(migration).toContain("complete_document_upload_cleanup");
    expect(migration).toContain("cross_collaborator");
    expect(propertyRoute).toContain("Upload activity");
    expect(propertyRoute).toContain("Retry verification");
    expect(propertyRoute).toContain("New version of");
    expect(documentFunctions).toContain('rpc("request_document_deletion"');
    expect(migration).toContain("document_deletion_requests");
    expect(migration).toContain("complete_document_deletion");
  });
});
