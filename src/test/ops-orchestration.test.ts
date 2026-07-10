import { describe, expect, it } from "vitest";
import { classifyOpsResult } from "@/lib/ops-contract";

describe("operator interface result classification", () => {
  it("never turns a blocked prerequisite into a pass", () => {
    expect(classifyOpsResult("live RLS", { status: 0 }, true)).toMatchObject({
      status: "blocked",
      code: 0,
    });
  });

  it("reports command failures distinctly", () => {
    expect(classifyOpsResult("lint", { status: 1 })).toMatchObject({ status: "failed", code: 1 });
  });
});
