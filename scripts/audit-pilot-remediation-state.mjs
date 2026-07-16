#!/usr/bin/env node
// Read-only Phase 0 inventory. Run against a backed-up staging or production
// database before applying the corrective migrations.
import pg from "pg";

const keys = [
  "PILOT_REMEDIATION_DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];
const databaseUrl = keys.map((key) => process.env[key]?.trim()).find(Boolean);
if (!databaseUrl) {
  console.error(`[pilot-remediation-audit] Set one database URL env var: ${keys.join(", ")}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl, statement_timeout: 30_000 });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const checks = {
    version_forks: `
      select replaces_document_id,count(*)::integer as successor_count,array_agg(id order by upload_date) as successors
      from public.documents where replaces_document_id is not null
      group by replaces_document_id having count(*)>1`,
    live_replacement_collisions: `
      select replaces_document_id,count(*)::integer as upload_count,array_agg(id order by created_at) as uploads
      from public.pending_document_uploads
      where replaces_document_id is not null
        and status in ('pending','verification_queued','verification_running')
      group by replaces_document_id having count(*)>1`,
    deletion_zombies: `
      select r.id as request_id,r.document_id,r.status,r.storage_path,d.deletion_requested_at
      from public.document_deletion_requests r join public.documents d on d.id=r.document_id
      where r.status in ('failed','retryable','terminal_failed')
        and d.deletion_requested_at is null`,
    duplicate_live_deletions: `
      select document_id,count(*)::integer as request_count,array_agg(id order by requested_at) as requests
      from public.document_deletion_requests
      where document_id is not null
        and status in ('pending','claimed','failed','retryable','terminal_failed')
      group by document_id having count(*)>1`,
    missing_storage_objects: `
      select d.id as document_id,d.storage_path,d.deletion_requested_at
      from public.documents d left join storage.objects o
        on o.bucket_id='documents' and o.name=d.storage_path
      where o.id is null`,
    internal_authenticated_grants: `
      select table_name,privilege_type
      from information_schema.role_table_grants
      where grantee='authenticated' and table_schema='public'
        and table_name in ('permit_review_assignments','municipal_source_snapshots','pilot_external_signoffs')
      order by table_name,privilege_type`,
    search_session_footprint: `
      select (select count(*)::integer from public.property_search_sessions) as sessions,
        (select count(*)::integer from public.property_search_session_items) as items,
        pg_total_relation_size('public.property_search_sessions')::bigint+
          pg_total_relation_size('public.property_search_session_items')::bigint as total_bytes`,
  };
  const report = {};
  for (const [name, sql] of Object.entries(checks)) {
    report[name] = (await client.query(sql)).rows;
  }
  await client.query("ROLLBACK");

  const blocking = [
    "version_forks",
    "live_replacement_collisions",
    "deletion_zombies",
    "duplicate_live_deletions",
    "missing_storage_objects",
  ].filter((name) => report[name].length > 0);
  console.log(
    JSON.stringify({
      component: "pilot-remediation-audit",
      status: blocking.length ? "blocked" : "clear",
      blocking_checks: blocking,
      report,
    }),
  );
  if (blocking.length) process.exitCode = 1;
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
