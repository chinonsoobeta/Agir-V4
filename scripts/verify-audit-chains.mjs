#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;

const databaseUrl =
  process.env.AUDIT_CHAIN_DATABASE_URL ??
  process.env.SUPABASE_SERVICE_DATABASE_URL ??
  process.env.DATABASE_URL;
const checkedBy = process.env.AUDIT_CHAIN_CHECKED_BY ?? "scheduled-audit-chain-verifier";

if (!databaseUrl) {
  console.log("[audit-chain] SKIP: set AUDIT_CHAIN_DATABASE_URL or DATABASE_URL to verify.");
  process.exit(0);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  const { rows: projects } = await client.query(
    "select id, workspace_id from public.projects order by created_at asc",
  );
  let failures = 0;
  for (const project of projects) {
    const { rows } = await client.query("select public.verify_audit_chain($1) as result", [
      project.id,
    ]);
    const result = rows[0].result;
    await client.query(
      `
        insert into public.audit_chain_verifications
          (workspace_id, project_id, valid, reason, total, head_hash, checked_by)
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        project.workspace_id,
        project.id,
        Boolean(result.valid),
        result.reason ?? null,
        Number(result.total ?? 0),
        result.head_hash ?? null,
        checkedBy,
      ],
    );
    if (!result.valid) failures += 1;
    console.log(
      `[audit-chain] ${project.id}: ${result.valid ? "valid" : "INVALID"} total=${result.total ?? 0}`,
    );
  }
  if (failures) {
    console.error(`[audit-chain] FAIL: ${failures} project chain(s) failed verification.`);
    process.exit(1);
  }
  console.log(`[audit-chain] PASS: ${projects.length} project chain(s) verified.`);
} finally {
  await client.end().catch(() => {});
}
