import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260714000200_pilot_remediation_program.sql",
  "utf8",
);
const gateSecurityMigration = readFileSync(
  "supabase/migrations/20260714000300_pilot_gate_security_and_search_rollback.sql",
  "utf8",
);
const documentRecoveryMigration = readFileSync(
  "supabase/migrations/20260714000400_document_version_and_deletion_recovery.sql",
  "utf8",
);
const propertyRoute = readFileSync("src/routes/_authenticated/properties.$propertyId.tsx", "utf8");
const documentFunctions = readFileSync("src/lib/documents.functions.ts", "utf8");
const propertyFunctions = readFileSync("src/lib/properties.functions.ts", "utf8");
const searchRoute = readFileSync("src/routes/_authenticated/properties.index.tsx", "utf8");
const sourceMonitor = readFileSync("scripts/review-permit-sources.mjs", "utf8");
const releaseGate = readFileSync("docs/pilot/remediation-release-gate.md", "utf8");
const pilotGate = readFileSync("scripts/pilot-confidence-gate.mjs", "utf8");
const retryConsistencyMigration = readFileSync(
  "supabase/migrations/20260715000100_municipal_snapshot_and_upload_retry_consistency.sql",
  "utf8",
);
const searchDecision = readFileSync("docs/architecture/property-search-pagination.md", "utf8");
const searchLoad = readFileSync("scripts/property-search-db-load.mjs", "utf8");
const documentDropzone = readFileSync("src/components/document-dropzone.tsx", "utf8");

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

  test("property search is read-only keyset pagination with current access", () => {
    expect(gateSecurityMigration).toContain(
      "REVOKE ALL ON FUNCTION public.create_property_search_session",
    );
    expect(propertyFunctions).not.toContain('rpc("create_property_search_session"');
    expect(searchRoute).toContain("before_updated_at");
    expect(searchRoute).toContain("before_id");
    expect(searchRoute).toContain("content-visibility:auto");
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
    expect(documentRecoveryMigration).toContain("documents_one_successor_idx");
    expect(documentRecoveryMigration).toContain("only the latest document version can be replaced");
    expect(documentRecoveryMigration).toContain("status='retryable'");
    expect(documentRecoveryMigration).toContain("cancel_document_deletion");
    expect(documentRecoveryMigration).not.toContain(
      "SET deletion_requested_at=NULL,deletion_requested_by=NULL\n  FROM",
    );
    expect(retryConsistencyMigration).toContain("retry_allowed boolean GENERATED ALWAYS");
    expect(retryConsistencyMigration).toContain("CHECK (retry_count BETWEEN 0 AND 3)");
    expect(propertyRoute).toContain("item.retry_allowed");
    expect(propertyRoute).not.toContain("item.retry_count < 3");
    expect(documentDropzone).toContain("already ${repeatedNames.length === 1");
    expect(documentDropzone).not.toContain("void existingNames");
    expect(propertyRoute).toContain('queryKey: ["documents", "property-records", property.id');
    expect(propertyRoute).toContain("jobsByDocumentId");
    expect(propertyFunctions).not.toContain("as any");
    expect(propertyFunctions).not.toContain("as never");
    expect(documentFunctions).not.toContain("as never");
  });

  test("release gates fail closed and internal evidence is service-only", () => {
    expect(gateSecurityMigration).toContain("NOT EXISTS");
    expect(gateSecurityMigration).toContain("coalesce(j.coverage_status='reviewed',false)");
    expect(gateSecurityMigration).toContain(
      "REVOKE ALL ON public.pilot_external_signoffs FROM authenticated",
    );
    expect(gateSecurityMigration).toContain(
      "REVOKE ALL ON public.permit_review_assignments FROM authenticated",
    );
    expect(gateSecurityMigration).toContain(
      "REVOKE ALL ON public.municipal_source_snapshots FROM authenticated",
    );
    expect(pilotGate).toContain('name: "qualified external and municipal approvals"');
    expect(pilotGate).not.toContain("external approval evidence is enforced by --full");
  });

  test("municipal observation identity is explicit and search architecture is read-only", () => {
    expect(retryConsistencyMigration).toContain(
      "DROP CONSTRAINT IF EXISTS municipal_source_snapshots_source_id_observed_at_key",
    );
    expect(retryConsistencyMigration).toContain("observation_key");
    expect(searchDecision).toContain("read-only keyset pagination");
    expect(searchDecision).toContain("Current authorization wins");
    expect(searchLoad).toContain("session_items_written");
  });
});
