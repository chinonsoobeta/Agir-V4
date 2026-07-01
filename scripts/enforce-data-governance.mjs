#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;
const dryRun = process.argv.includes("--dry-run");
const databaseUrl =
  process.env.DATA_GOVERNANCE_DATABASE_URL ??
  process.env.SUPABASE_SERVICE_DATABASE_URL ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("[data-governance] SKIP: set DATA_GOVERNANCE_DATABASE_URL or DATABASE_URL.");
  process.exit(0);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

async function recordRun(run) {
  await client.query(
    `
      insert into public.compliance_enforcement_runs
        (workspace_id, run_type, status, summary, evidence, run_by)
      values ($1, $2, $3, $4, $5::jsonb, $6)
    `,
    [
      run.workspace_id ?? null,
      run.run_type,
      dryRun ? "dry_run" : run.status,
      run.summary,
      JSON.stringify(run.evidence ?? {}),
      "data-governance-enforcer",
    ],
  );
}

try {
  await client.connect();
  const { rows: settings } = await client.query(`
    select workspace_id, audit_log_retention_days, data_residency_region
    from public.workspace_settings
  `);
  let failures = 0;
  for (const row of settings) {
    const retentionDays = Number(row.audit_log_retention_days ?? 2555);
    const { rows } = await client.query(
      `
        select count(*)::int as stale
        from public.audit_logs
        where workspace_id = $1
          and created_at < now() - make_interval(days => $2)
      `,
      [row.workspace_id, retentionDays],
    );
    const staleAuditRows = Number(rows[0]?.stale ?? 0);
    if (staleAuditRows > 0) failures += 1;
    await recordRun({
      workspace_id: row.workspace_id,
      run_type: "retention",
      status: staleAuditRows > 0 ? "failed" : "passed",
      summary:
        staleAuditRows > 0
          ? `${staleAuditRows} audit rows exceed ${retentionDays}-day retention.`
          : `No audit rows exceed ${retentionDays}-day retention.`,
      evidence: {
        staleAuditRows,
        retentionDays,
        dataResidencyRegion: row.data_residency_region ?? null,
      },
    });
  }

  const { rows: overdueDeletionRequests } = await client.query(`
    select id
    from public.data_governance_requests
    where request_type = 'deletion'
      and status in ('open', 'in_review')
      and due_at < now()
  `);
  if (overdueDeletionRequests.length > 0) failures += 1;
  await recordRun({
    workspace_id: null,
    run_type: "deletion",
    status: overdueDeletionRequests.length > 0 ? "failed" : "passed",
    summary:
      overdueDeletionRequests.length > 0
        ? `${overdueDeletionRequests.length} deletion request(s) are overdue.`
        : "No overdue deletion requests.",
    evidence: { overdueRequestIds: overdueDeletionRequests.map((r) => r.id) },
  });

  const { rows: missingStorageRefs } = await client.query(`
    select id
    from public.documents
    where storage_path is null
       or length(trim(storage_path)) = 0
    limit 50
  `);
  if (missingStorageRefs.length > 0) failures += 1;
  await recordRun({
    workspace_id: null,
    run_type: "deletion",
    status: missingStorageRefs.length > 0 ? "failed" : "passed",
    summary:
      missingStorageRefs.length > 0
        ? `${missingStorageRefs.length} document row(s) have no storage reference.`
        : "All sampled document rows have storage references.",
    evidence: { missingStorageDocumentIds: missingStorageRefs.map((r) => r.id) },
  });

  const { rows: governedTables } = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'documents',
        'assumptions',
        'financial_outputs',
        'investment_memos',
        'generated_reports',
        'memo_snapshots',
        'data_governance_requests',
        'compliance_enforcement_runs'
      )
  `);
  const present = new Set(governedTables.map((row) => row.table_name));
  const missingGovernedTables = [
    "documents",
    "assumptions",
    "financial_outputs",
    "investment_memos",
    "generated_reports",
    "memo_snapshots",
    "data_governance_requests",
    "compliance_enforcement_runs",
  ].filter((table) => !present.has(table));
  if (missingGovernedTables.length > 0) failures += 1;
  await recordRun({
    workspace_id: null,
    run_type: "retention",
    status: missingGovernedTables.length > 0 ? "failed" : "passed",
    summary:
      missingGovernedTables.length > 0
        ? `Governance-critical tables missing: ${missingGovernedTables.join(", ")}.`
        : "Governance-critical tables are present.",
    evidence: { missingGovernedTables },
  });

  if (failures && !dryRun) {
    console.error(`[data-governance] FAIL: ${failures} governance obligation(s) need review.`);
    process.exit(1);
  }
  console.log(
    `[data-governance] ${dryRun ? "DRY RUN" : "PASS"}: checked ${settings.length} workspace(s).`,
  );
} finally {
  await client.end().catch(() => {});
}
