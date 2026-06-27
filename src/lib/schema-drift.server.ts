import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

export type SchemaDriftStatus = "ok" | "drift" | "unknown";

export type SchemaDriftCheck = {
  configured: boolean;
  status: SchemaDriftStatus;
  expected: string[];
  applied: string[];
  pending: string[];
  extra: string[];
  latestExpected: string | null;
  latestApplied: string | null;
  error?: string;
};

export function diffMigrationVersions(expected: string[], applied: string[]) {
  const expectedSet = new Set(expected);
  const appliedSet = new Set(applied);
  return {
    pending: expected.filter((version) => !appliedSet.has(version)),
    extra: applied.filter((version) => !expectedSet.has(version)),
  };
}

export async function localMigrationVersions(cwd = process.cwd()): Promise<string[]> {
  const migrationDir = resolve(cwd, "supabase/migrations");
  const files = await readdir(migrationDir);
  return files
    .filter((file) => /^\d{14}_.+\.sql$/.test(file))
    .map((file) => file.slice(0, 14))
    .sort();
}

export async function checkSchemaDrift(
  connectionString = process.env.POSTGRES_URL,
  cwd = process.cwd(),
): Promise<SchemaDriftCheck> {
  const expected = await localMigrationVersions(cwd);
  if (!connectionString) {
    return {
      configured: false,
      status: "unknown",
      expected,
      applied: [],
      pending: [],
      extra: [],
      latestExpected: expected.at(-1) ?? null,
      latestApplied: null,
      error: "POSTGRES_URL is not set; schema drift cannot be checked.",
    };
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const result = await client.query<{ version: string }>(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    const applied = result.rows.map((row) => String(row.version)).sort();
    const { pending, extra } = diffMigrationVersions(expected, applied);
    return {
      configured: true,
      status: pending.length || extra.length ? "drift" : "ok",
      expected,
      applied,
      pending,
      extra,
      latestExpected: expected.at(-1) ?? null,
      latestApplied: applied.at(-1) ?? null,
    };
  } catch (error) {
    return {
      configured: true,
      status: "unknown",
      expected,
      applied: [],
      pending: [],
      extra: [],
      latestExpected: expected.at(-1) ?? null,
      latestApplied: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
