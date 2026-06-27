import { describe, expect, test } from "vitest";
import {
  diffMigrationVersions,
  resolveSchemaDriftConnection,
  SCHEMA_DRIFT_DATABASE_URL_ENV_KEYS,
} from "@/lib/schema-drift.server";

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

  test("accepts common deployment database URL aliases", () => {
    const env = {
      DATABASE_URL: "postgresql://example",
      POSTGRES_URL: "",
    };
    expect(resolveSchemaDriftConnection(env).envVar).toBe("DATABASE_URL");
    expect(resolveSchemaDriftConnection(env).connectionString).toBe("postgresql://example");
    expect(SCHEMA_DRIFT_DATABASE_URL_ENV_KEYS).toContain("SUPABASE_DATABASE_URL");
  });
});
