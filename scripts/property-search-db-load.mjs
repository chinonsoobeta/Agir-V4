#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";

const databaseUrl =
  process.env.PROPERTY_SEARCH_LOAD_DATABASE_URL ||
  process.env.TENANT_DB_LOAD_DATABASE_URL ||
  process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "[property-search-load] PROPERTY_SEARCH_LOAD_DATABASE_URL or TENANT_DB_LOAD_DATABASE_URL is required.",
  );
  process.exit(1);
}
const parsed = new URL(databaseUrl);
const safeTarget =
  ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
  /test|staging|ephemeral/i.test(parsed.pathname);
if (!safeTarget && process.env.PROPERTY_SEARCH_LOAD_ALLOW_MUTATION !== "1") {
  throw new Error(
    "Refusing the transactional load exercise outside local/test/staging. Set PROPERTY_SEARCH_LOAD_ALLOW_MUTATION=1 only for an approved production-like clone.",
  );
}

const count = Math.min(
  Math.max(Number(process.env.PROPERTY_SEARCH_LOAD_COUNT ?? 10_000), 1_000),
  100_000,
);
const budgetMs = Number(process.env.PROPERTY_SEARCH_LOAD_BUDGET_MS ?? 15_000);
const userId = randomUUID();
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : false,
  statement_timeout: Math.max(budgetMs * 2, 30_000),
});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO auth.users(id,email,raw_user_meta_data)
     VALUES($1,$2,'{}'::jsonb)`,
    [userId, `property-search-load-${userId}@example.invalid`],
  );
  await client.query(
    `INSERT INTO public.properties(owner_id,address_line_1,municipality,notes)
     SELECT $1,'Load property '||g||' Street','Vancouver','property search load marker '||g
     FROM generate_series(1,$2::integer) g`,
    [userId, count],
  );
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  const started = performance.now();
  const created = await client.query(
    "SELECT * FROM public.create_property_search_session(NULL,'property search load marker',NULL,NULL,NULL,NULL,false)",
  );
  const elapsedMs = performance.now() - started;
  const sessionId = created.rows[0]?.session_id;
  const total = Number(created.rows[0]?.total_count ?? 0);
  const first = await client.query(
    "SELECT property_snapshot->>'id' AS id FROM public.get_property_search_session_page($1,0,200)",
    [sessionId],
  );
  const last = await client.query(
    "SELECT property_snapshot->>'id' AS id FROM public.get_property_search_session_page($1,$2,200)",
    [sessionId, Math.max(count - 200, 0)],
  );
  if (
    total !== count ||
    first.rowCount !== Math.min(200, count) ||
    last.rowCount !== Math.min(200, count)
  ) {
    throw new Error(
      `pagination mismatch total=${total} first=${first.rowCount} last=${last.rowCount}`,
    );
  }
  if (elapsedMs > budgetMs)
    throw new Error(`session creation ${elapsedMs.toFixed(1)}ms exceeded ${budgetMs}ms`);
  console.log(
    JSON.stringify({
      component: "property-search-load",
      status: "passed",
      properties: count,
      session_creation_ms: Number(elapsedMs.toFixed(1)),
      budget_ms: budgetMs,
      first_page: first.rowCount,
      last_page: last.rowCount,
      transaction: "rolled_back",
    }),
  );
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
