import { describe, expect, test } from "vitest";
import { diffMigrationVersions } from "@/lib/schema-drift.server";

describe("schema drift detection", () => {
  test("reports pending and extra migration versions", () => {
    expect(
      diffMigrationVersions(
        ["20260610160745", "20260624000300", "20260626000100"],
        ["20260610160745", "20260623000000"],
      ),
    ).toEqual({
      pending: ["20260624000300", "20260626000100"],
      extra: ["20260623000000"],
    });
  });
});
