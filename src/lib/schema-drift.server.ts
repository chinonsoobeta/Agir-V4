import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

export type SchemaDriftStatus = "ok" | "drift" | "unknown";

export type SchemaDriftCheck = {
  configured: boolean;
  status: SchemaDriftStatus;
  connectionEnvVar: string | null;
  expected: string[];
  applied: string[];
  pending: string[];
  extra: string[];
  latestExpected: string | null;
  latestApplied: string | null;
  error?: string;
};

export const SCHEMA_DRIFT_DATABASE_URL_ENV_KEYS = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

export function resolveSchemaDriftConnection(env: NodeJS.ProcessEnv = process.env): {
  connectionString: string | null;
  envVar: string | null;
} {
  for (const key of SCHEMA_DRIFT_DATABASE_URL_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return { connectionString: value, envVar: key };
  }
  return { connectionString: null, envVar: null };
}

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
  connectionString?: string | null,
  cwd = process.cwd(),
): Promise<SchemaDriftCheck> {
  const expected = await localMigrationVersions(cwd);
  const resolved = connectionString
    ? { connectionString, envVar: "explicit" }
    : resolveSchemaDriftConnection();
  if (!resolved.connectionString) {
    return {
      configured: false,
      status: "unknown",
      connectionEnvVar: null,
      expected,
      applied: [],
      pending: [],
      extra: [],
      latestExpected: expected.at(-1) ?? null,
      latestApplied: null,
      error: `${SCHEMA_DRIFT_DATABASE_URL_ENV_KEYS.join(", ")} are not set; schema drift cannot be checked.`,
    };
  }

  const client = new Client({
    connectionString: resolved.connectionString,
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
      connectionEnvVar: resolved.envVar,
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
      connectionEnvVar: resolved.envVar,
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
