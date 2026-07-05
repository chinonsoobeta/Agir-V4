import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL_ENV_KEYS = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];

const LEDGER_TABLE = "public.schema_migrations";

function parseArgs(argv) {
  const options = { dryRun: false, seed: false };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--seed") {
      options.seed = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node run_migrations.mjs [--dry-run] [--seed]

Options:
  --dry-run  List pending migrations without changing the database.
  --seed     Apply supabase/seed.sql after pending migrations succeed.
`);
}

function resolveDatabaseUrl() {
  for (const key of DATABASE_URL_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return { connectionString: value, envVar: key };
  }
  return { connectionString: null, envVar: null };
}

function shouldUseSsl(connectionString) {
  const pgSslMode = process.env.PGSSLMODE?.trim();
  if (pgSslMode === "disable") return false;
  if (pgSslMode === "require") return true;

  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode === "disable") return false;
  if (sslMode === "require") return true;

  return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function migrationVersion(fileName) {
  return basename(fileName, ".sql");
}

function readMigrationFiles() {
  const migrationDir = resolve(__dirname, "supabase/migrations");
  return readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      version: migrationVersion(file),
      path: resolve(migrationDir, file),
    }));
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function loadSupabaseAppliedVersions(client, migrations) {
  const exists = await client.query("SELECT to_regclass($1) AS name", [
    "supabase_migrations.schema_migrations",
  ]);
  if (!exists.rows[0]?.name) return new Set();

  const result = await client.query(
    "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
  );
  const applied = new Set();
  for (const migration of migrations) {
    const match = result.rows.some((row) => {
      const supabaseVersion = String(row.version);
      const supabaseName = row.name == null ? "" : String(row.name);
      return (
        migration.version === supabaseVersion ||
        migration.version === `${supabaseVersion}_${supabaseName}` ||
        migration.version.startsWith(`${supabaseVersion}_`)
      );
    });
    if (match) applied.add(migration.version);
  }
  return applied;
}

async function backfillLedgerFromSupabase(client, migrations) {
  const applied = await loadSupabaseAppliedVersions(client, migrations);
  for (const version of applied) {
    await client.query(`INSERT INTO ${LEDGER_TABLE} (version) VALUES ($1) ON CONFLICT DO NOTHING`, [
      version,
    ]);
  }
}

async function loadAppliedVersions(client, { createLedger, migrations }) {
  const supabaseApplied = await loadSupabaseAppliedVersions(client, migrations);

  if (createLedger) {
    await ensureLedger(client);
    await backfillLedgerFromSupabase(client, migrations);
  } else {
    const exists = await client.query("SELECT to_regclass($1) AS name", [LEDGER_TABLE]);
    if (!exists.rows[0]?.name) return supabaseApplied;
  }

  const result = await client.query(`SELECT version FROM ${LEDGER_TABLE} ORDER BY version`);
  return new Set([...supabaseApplied, ...result.rows.map((row) => row.version)]);
}

async function applyMigration(client, migration) {
  const sql = readFileSync(migration.path, "utf-8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(`INSERT INTO ${LEDGER_TABLE} (version) VALUES ($1)`, [migration.version]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function applySeed(client) {
  const seedPath = resolve(__dirname, "supabase/seed.sql");
  const seedSql = readFileSync(seedPath, "utf-8");
  await client.query("BEGIN");
  try {
    await client.query(seedSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function runMigrations() {
  const options = parseArgs(process.argv.slice(2));
  const { connectionString, envVar } = resolveDatabaseUrl();
  if (!connectionString) {
    throw new Error(`Set one database URL env var: ${DATABASE_URL_ENV_KEYS.join(", ")}`);
  }

  const client = new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: true } : false,
  });

  await client.connect();
  try {
    console.log(`Connected to database via ${envVar}`);

    const migrations = readMigrationFiles();
    const applied = await loadAppliedVersions(client, {
      createLedger: !options.dryRun,
      migrations,
    });
    const pending = migrations.filter((migration) => !applied.has(migration.version));

    if (options.dryRun) {
      console.log(`\nPending migrations (${pending.length}):`);
      for (const migration of pending) console.log(`  ${migration.file}`);
      if (pending.length === 0) console.log("  (none)");
      if (options.seed) console.log("\nSeed requested: supabase/seed.sql would be applied.");
      return;
    }

    console.log(`Found ${migrations.length} migration files; ${pending.length} pending.\n`);
    for (const migration of pending) {
      console.log(`Applying ${migration.file}...`);
      await applyMigration(client, migration);
      console.log("  Applied and recorded.\n");
    }

    if (pending.length === 0) {
      console.log("No pending migrations.");
    }

    if (options.seed) {
      console.log("\nApplying seed data...");
      await applySeed(client);
      console.log("  Seed applied.");
    } else {
      console.log("\nSeed skipped. Pass --seed to apply supabase/seed.sql.");
    }

    console.log("\nMigrations completed.");
  } finally {
    await client.end();
  }
}

runMigrations().catch((error) => {
  console.error("\nMigration failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
