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
  const sessionItemsBefore = Number(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.property_search_session_items",
      )
    ).rows[0]?.count ?? 0,
  );
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  const started = performance.now();
  let beforeUpdatedAt = null;
  let beforeId = null;
  let traversed = 0;
  let pages = 0;
  let firstPage = 0;
  while (true) {
    const page = await client.query(
      `SELECT id,updated_at::text AS updated_at
       FROM public.search_properties_page(
         NULL,'property search load marker',NULL,NULL,NULL,NULL,false,$1,$2,200
       )`,
      [beforeUpdatedAt, beforeId],
    );
    pages += 1;
    const visible = page.rows.slice(0, 200);
    if (pages === 1) firstPage = visible.length;
    traversed += visible.length;
    if (page.rows.length <= 200) break;
    const cursor = visible.at(-1);
    beforeUpdatedAt = cursor.updated_at;
    beforeId = cursor.id;
  }
  const elapsedMs = performance.now() - started;
  await client.query("RESET ROLE");
  const sessionItemsAfter = Number(
    (
      await client.query(
        "SELECT count(*)::integer AS count FROM public.property_search_session_items",
      )
    ).rows[0]?.count ?? 0,
  );
  if (traversed !== count || firstPage !== Math.min(200, count)) {
    throw new Error(`pagination mismatch traversed=${traversed} first=${firstPage}`);
  }
  if (sessionItemsAfter !== sessionItemsBefore) {
    throw new Error(
      `read-only search wrote session items before=${sessionItemsBefore} after=${sessionItemsAfter}`,
    );
  }
  if (elapsedMs > budgetMs)
    throw new Error(`keyset traversal ${elapsedMs.toFixed(1)}ms exceeded ${budgetMs}ms`);
  console.log(
    JSON.stringify({
      component: "property-search-load",
      status: "passed",
      properties: count,
      keyset_traversal_ms: Number(elapsedMs.toFixed(1)),
      budget_ms: budgetMs,
      pages,
      first_page: firstPage,
      session_items_written: sessionItemsAfter - sessionItemsBefore,
      transaction: "rolled_back",
    }),
  );
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
