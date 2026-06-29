import { describe, expect, test } from "vitest";
import { PILOT_DEAL_PACKAGES } from "@/lib/pilot-demo-packages";
import {
  buildPilotReadiness,
  DEFAULT_PILOT_READINESS_INPUT,
  summarizePilotReadiness,
  type PilotReadinessId,
} from "@/lib/pilot-readiness";

const expectedIds: PilotReadinessId[] = [
  "fresh_environment_install",
  "guided_pilot_mode",
  "pilot_deal_packages",
  "async_extraction_worker",
  "pilot_readiness_checklist",
  "production_sso_saml",
  "scim_provisioning",
  "third_party_pen_test",
  "operational_trust_basics",
  "disaster_recovery_drill",
  "soc2_readiness",
  "first_time_ui_clarity",
  "customer_audit_package",
  "real_document_corpus",
  "unsupervised_pilot_observation",
];

describe("pilot readiness controls", () => {
  test("covers the full 15-task hardening plan without duplicate controls", () => {
    const controls = buildPilotReadiness(DEFAULT_PILOT_READINESS_INPUT);
    const ids = controls.map((control) => control.id);

    expect(ids).toHaveLength(15);
    expect(new Set(ids)).toEqual(new Set(expectedIds));
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of controls) {
      expect(control.title).not.toEqual("");
      expect(control.evidence.length).toBeGreaterThan(0);
    }
  });

  test("keeps external attestations explicit while allowing unsupervised pilot readiness", () => {
    const controls = buildPilotReadiness(DEFAULT_PILOT_READINESS_INPUT);
    const summary = summarizePilotReadiness(controls);

    expect(summary.external_required).toBe(2);
    expect(summary.readyForUnsupervisedPilot).toBe(true);
    expect(summary.scoreOutOfTen).toBeGreaterThanOrEqual(7.5);
    expect(controls.find((control) => control.id === "soc2_readiness")?.externalDependency).toBe(
      "Compliance automation plus external auditor observation window",
    );
    expect(controls.find((control) => control.id === "third_party_pen_test")?.status).toBe(
      "external_required",
    );
  });

  test("ships at least five pilot packages with workflow and watchpoint coverage", () => {
    expect(PILOT_DEAL_PACKAGES.length).toBeGreaterThanOrEqual(5);
    for (const pkg of PILOT_DEAL_PACKAGES) {
      expect(pkg.documents.length).toBeGreaterThan(0);
      expect(pkg.intendedOutcome).not.toEqual("");
      expect(["seedable", "fixture_only", "corpus_harness"]).toContain(pkg.availability);
      expect(pkg.expectedWorkflow.length).toBeGreaterThan(0);
      expect(pkg.knownWatchpoints.length).toBeGreaterThan(0);
    }
    expect(PILOT_DEAL_PACKAGES.some((pkg) => pkg.availability === "seedable")).toBe(true);
  });
});
