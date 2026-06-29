import { describe, expect, test } from "vitest";
import { buildCustomerAuditArchive } from "@/lib/customer-audit-archive.server";
import { buildCustomerAuditPackage } from "@/lib/customer-audit-package";

describe("customer audit archive", () => {
  test("wraps the audit package in a signed zip with checksum evidence", () => {
    const pkg = buildCustomerAuditPackage({
      workspaceId: "00000000-0000-0000-0000-000000000002",
      generatedAt: "2026-06-29T12:00:00.000Z",
      controls: [],
      auditEvents: [],
      projects: [],
      documents: [],
      reports: [],
      memoSnapshots: [],
    });

    const archive = buildCustomerAuditArchive(pkg);
    const bytes = Buffer.from(archive.base64, "base64");

    expect(archive.filename).toBe(
      "agir-customer-audit-package-00000000-0000-0000-0000-000000000002.zip",
    );
    expect(archive.contentType).toBe("application/zip");
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.toString("utf8")).toContain("checksums.json");
    expect(bytes.toString("utf8")).toContain("integrity-signature.json");
    expect(archive.signature.schema).toBe("agir.customer-audit-package.signature.v1");
    expect(archive.signature.package_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
