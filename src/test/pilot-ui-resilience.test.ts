import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("pilot UI resilience", () => {
  it("does not turn Permit query failures into empty records", () => {
    const index = read("src/routes/_authenticated/permits.index.tsx");
    const detail = read("src/routes/_authenticated/permits.$caseId.tsx");

    expect(index).toContain("Permit cases could not be loaded");
    expect(index).toContain("No empty-case summary is shown");
    expect(detail).toContain("Permit case could not be opened");
    expect(detail).toContain("Case documents could not be loaded");
    expect(detail).toContain("Collaboration details could not be loaded");
  });

  it("gates every property mutation surface behind effective edit access", () => {
    const detail = read("src/routes/_authenticated/properties.$propertyId.tsx");

    expect(detail).toContain('workspace.role !== "viewer"');
    expect(detail).toContain("const canEdit = canWrite && !archived");
    expect(detail).toContain("<PropertyLinks");
    expect(detail.match(/canEdit={canEdit}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(detail).toContain("Archived property: read-only");
  });

  it("renders structured state changes on Permit and Property history", () => {
    const permit = read("src/routes/_authenticated/permits.$caseId.tsx");
    const property = read("src/routes/_authenticated/properties.$propertyId.tsx");

    expect(permit).toContain("<HistoryStateDiff");
    expect(property).toContain("<HistoryStateDiff");
    expect(property).toContain("activityActor(event.actor_id");
  });
});
