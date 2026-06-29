import { describe, expect, test } from "vitest";
import { buildComplianceEvidence } from "@/lib/compliance-evidence";

describe("compliance evidence tracker", () => {
  test("marks missing external evidence without overstating readiness", () => {
    const evidence = buildComplianceEvidence({
      ssoProvider: null,
      ssoMetadataUrl: null,
      scimEnabled: false,
      dpaStatus: "in_review",
      soc2ObservationStartedAt: null,
      lastPenTestAt: null,
      lastDrTestAt: null,
      onCallRotationUrl: null,
      statusPageUrl: null,
      now: "2026-06-29T00:00:00.000Z",
    });

    expect(evidence.every((item) => item.status === "missing")).toBe(true);
    expect(evidence.find((item) => item.id === "pen_test")?.action).toContain("clean report");
  });

  test("surfaces evidence expiry windows", () => {
    const evidence = buildComplianceEvidence({
      ssoProvider: "Okta",
      ssoMetadataUrl: "https://idp.example.com/metadata",
      scimEnabled: true,
      dpaStatus: "approved",
      soc2ObservationStartedAt: "2026-01-15T00:00:00.000Z",
      lastPenTestAt: "2025-07-15T00:00:00.000Z",
      lastDrTestAt: "2026-06-01T00:00:00.000Z",
      onCallRotationUrl: "https://pager.example.com/schedule",
      statusPageUrl: "https://status.example.com",
      now: "2026-06-29T00:00:00.000Z",
    });

    expect(evidence.find((item) => item.id === "sso_saml")?.status).toBe("current");
    expect(evidence.find((item) => item.id === "soc2")?.status).toBe("due_soon");
    expect(evidence.find((item) => item.id === "pen_test")?.status).toBe("due_soon");
    expect(evidence.find((item) => item.id === "dr_drill")?.daysUntilExpiry).toBe(152);
  });
});
