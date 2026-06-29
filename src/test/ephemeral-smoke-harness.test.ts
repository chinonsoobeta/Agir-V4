import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import packageJson from "../../package.json" with { type: "json" };

describe("ephemeral Supabase smoke harness", () => {
  test("package script runs bootstrap, migrations, and live RLS tests", async () => {
    expect(packageJson.scripts["smoke:ephemeral-db"]).toBe(
      "node scripts/ephemeral-supabase-smoke.mjs",
    );

    const script = await readFile(
      new URL("../../scripts/ephemeral-supabase-smoke.mjs", import.meta.url),
      "utf8",
    );

    expect(script).toContain("EPHEMERAL_DATABASE_URL");
    expect(script).toContain("src/test/rls/bootstrap-db.mjs");
    expect(script).toContain("run_migrations.mjs");
    expect(script).toContain("test:rls");
  });
});
