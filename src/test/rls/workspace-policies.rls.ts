import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import pg from "pg";
import { assertTestDatabase } from "./assert-test-db.mjs";

const { Client } = pg;

const DATABASE_URL_ENV_KEYS = [
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
];

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  coOwner: "00000000-0000-4000-8000-000000000002",
  admin: "00000000-0000-4000-8000-000000000003",
  member: "00000000-0000-4000-8000-000000000004",
  viewer: "00000000-0000-4000-8000-000000000005",
  outsider: "00000000-0000-4000-8000-000000000006",
  soloOwner: "00000000-0000-4000-8000-000000000007",
  workspace: "10000000-0000-4000-8000-000000000001",
  otherWorkspace: "10000000-0000-4000-8000-000000000002",
  soloWorkspace: "10000000-0000-4000-8000-000000000003",
  project: "20000000-0000-4000-8000-000000000001",
  otherProject: "20000000-0000-4000-8000-000000000002",
  contact: "30000000-0000-4000-8000-000000000001",
};

function resolveDatabaseUrl() {
  for (const key of DATABASE_URL_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      assertTestDatabase(value);
      return value;
    }
  }
  throw new Error(`Set one database URL env var before running npm run test:rls.`);
}

function shouldUseSsl(connectionString: string) {
  const pgSslMode = process.env.PGSSLMODE?.trim();
  if (pgSslMode === "disable") return false;
  if (pgSslMode === "require") return true;

  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode === "disable") return false;
  if (sslMode === "require") return true;

  return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isDeniedError(error: unknown) {
  return /row-level security|permission denied|Only a workspace owner|A workspace must always have at least one owner|append-only/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

const connectionString = resolveDatabaseUrl();
const client = new Client({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
});

async function asUser<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  values: unknown[] = [],
) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query<T>(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function expectDenied(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    expect(isDeniedError(error)).toBe(true);
    return;
  }
  throw new Error("Expected database operation to be denied");
}

async function asConcurrentUser<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  values: unknown[] = [],
) {
  const isolated = new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
  });
  await isolated.connect();
  try {
    await isolated.query("BEGIN");
    await isolated.query("SET LOCAL ROLE authenticated");
    await isolated.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await isolated.query<T>(sql, values);
    await isolated.query("COMMIT");
    return result;
  } catch (error) {
    await isolated.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await isolated.end();
  }
}

async function resetFixture() {
  await client.query("TRUNCATE auth.users CASCADE");
  await client.query(
    "INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING",
  );
  await client.query(
    `
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES
      ($1, 'owner@example.com', '{}'),
      ($2, 'co-owner@example.com', '{}'),
      ($3, 'admin@example.com', '{}'),
      ($4, 'member@example.com', '{}'),
      ($5, 'viewer@example.com', '{}'),
      ($6, 'outsider@example.com', '{}'),
      ($7, 'solo-owner@example.com', '{}')
    `,
    [ids.owner, ids.coOwner, ids.admin, ids.member, ids.viewer, ids.outsider, ids.soloOwner],
  );
  await client.query(
    `
    INSERT INTO public.workspaces (id, name, created_by)
    VALUES
      ($1, 'Main Workspace', $2),
      ($3, 'Other Workspace', $4),
      ($5, 'Solo Workspace', $6)
    `,
    [ids.workspace, ids.owner, ids.otherWorkspace, ids.outsider, ids.soloWorkspace, ids.soloOwner],
  );
  await client.query(
    `
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES
      ($1, $2, 'owner'),
      ($1, $3, 'owner'),
      ($1, $4, 'admin'),
      ($1, $5, 'member'),
      ($1, $6, 'viewer'),
      ($7, $8, 'owner'),
      ($9, $10, 'owner')
    `,
    [
      ids.workspace,
      ids.owner,
      ids.coOwner,
      ids.admin,
      ids.member,
      ids.viewer,
      ids.otherWorkspace,
      ids.outsider,
      ids.soloWorkspace,
      ids.soloOwner,
    ],
  );
  await client.query(
    `
    INSERT INTO public.projects (id, owner_id, name, location, workspace_id)
    VALUES
      ($1, $2, 'Shared Project', 'Vancouver', $3),
      ($4, $5, 'Other Project', 'Calgary', $6)
    `,
    [ids.project, ids.owner, ids.workspace, ids.otherProject, ids.outsider, ids.otherWorkspace],
  );
  await client.query(
    `
    INSERT INTO public.relationship_contacts (id, owner_id, workspace_id, full_name)
    VALUES ($1, $2, $3, 'Capital Contact')
    `,
    [ids.contact, ids.owner, ids.workspace],
  );
}

beforeAll(async () => {
  await client.connect();
});

beforeEach(async () => {
  await resetFixture();
});

afterAll(async () => {
  await client.end();
});

describe("workspace RLS policies", () => {
  test("viewer can read but cannot write deal-child rows, IC votes, or IC conditions", async () => {
    const visible = await asUser(ids.viewer, "SELECT id FROM public.projects WHERE id = $1", [
      ids.project,
    ]);
    expect(visible.rowCount).toBe(1);

    await expectDenied(
      asUser(
        ids.viewer,
        "INSERT INTO public.deal_comments (project_id, user_id, body) VALUES ($1, $2, 'viewers are read only')",
        [ids.project, ids.viewer],
      ),
    );
    await expectDenied(
      asUser(
        ids.viewer,
        "INSERT INTO public.ic_votes (project_id, owner_id, vote) VALUES ($1, $2, 'approve')",
        [ids.project, ids.viewer],
      ),
    );
    await expectDenied(
      asUser(
        ids.viewer,
        "INSERT INTO public.ic_conditions (project_id, owner_id, label) VALUES ($1, $2, 'viewer condition')",
        [ids.project, ids.viewer],
      ),
    );
  });

  test("member can write collaboration rows and can cast only their own vote", async () => {
    const comment = await asUser(
      ids.member,
      "INSERT INTO public.deal_comments (project_id, user_id, body) VALUES ($1, $2, 'member comment') RETURNING id",
      [ids.project, ids.member],
    );
    expect(comment.rowCount).toBe(1);

    const vote = await asUser(
      ids.member,
      "INSERT INTO public.ic_votes (project_id, owner_id, vote) VALUES ($1, $2, 'approve') RETURNING id",
      [ids.project, ids.member],
    );
    expect(vote.rowCount).toBe(1);

    await expectDenied(
      asUser(
        ids.member,
        "INSERT INTO public.ic_votes (project_id, owner_id, vote) VALUES ($1, $2, 'reject')",
        [ids.project, ids.admin],
      ),
    );

    const condition = await asUser(
      ids.member,
      "INSERT INTO public.ic_conditions (project_id, owner_id, label) VALUES ($1, $2, 'confirm GMP') RETURNING id",
      [ids.project, ids.member],
    );
    expect(condition.rowCount).toBe(1);
  });

  test("audit logs are append-only for workspace members", async () => {
    const inserted = await asUser<{ id: string }>(
      ids.member,
      `
      INSERT INTO public.audit_logs (
        project_id,
        owner_id,
        user_id,
        entity_type,
        entity_id,
        action,
        payload
      )
      VALUES ($1, $2, $2, 'project', $1, 'member_test_event', '{"ok": true}'::jsonb)
      RETURNING id
      `,
      [ids.project, ids.member],
    );
    expect(inserted.rowCount).toBe(1);
    const auditId = inserted.rows[0].id;

    const visible = await asUser(
      ids.member,
      "SELECT id FROM public.audit_logs WHERE id = $1 AND project_id = $2",
      [auditId, ids.project],
    );
    expect(visible.rowCount).toBe(1);

    await expectDenied(
      asUser(
        ids.member,
        "UPDATE public.audit_logs SET action = 'tampered' WHERE id = $1 RETURNING id",
        [auditId],
      ),
    );
    await expectDenied(
      asUser(ids.member, "DELETE FROM public.audit_logs WHERE id = $1 RETURNING id", [auditId]),
    );
  });

  test("member cannot delete the project, but admin can", async () => {
    const memberDelete = await asUser(
      ids.member,
      "DELETE FROM public.projects WHERE id = $1 RETURNING id",
      [ids.project],
    );
    expect(memberDelete.rowCount).toBe(0);

    const stillThere = await client.query("SELECT id FROM public.projects WHERE id = $1", [
      ids.project,
    ]);
    expect(stillThere.rowCount).toBe(1);

    const adminDelete = await asUser(ids.admin, "DELETE FROM public.projects WHERE id = $1", [
      ids.project,
    ]);
    expect(adminDelete.rowCount).toBe(1);
  });

  test("admin can manage non-owner members, but cannot manage owners or grant ownership", async () => {
    const promoteViewer = await asUser(
      ids.admin,
      "UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = $1 AND user_id = $2 RETURNING id",
      [ids.workspace, ids.viewer],
    );
    expect(promoteViewer.rowCount).toBe(1);

    const removeViewer = await asUser(
      ids.admin,
      "DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING id",
      [ids.workspace, ids.viewer],
    );
    expect(removeViewer.rowCount).toBe(1);

    await expectDenied(
      asUser(
        ids.admin,
        "UPDATE public.workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2",
        [ids.workspace, ids.coOwner],
      ),
    );
    await expectDenied(
      asUser(
        ids.admin,
        "DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [ids.workspace, ids.coOwner],
      ),
    );
    await expectDenied(
      asUser(
        ids.admin,
        "UPDATE public.workspace_members SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2",
        [ids.workspace, ids.member],
      ),
    );
  });

  test("last owner cannot be removed", async () => {
    await expectDenied(
      asUser(
        ids.soloOwner,
        "DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2",
        [ids.soloWorkspace, ids.soloOwner],
      ),
    );
  });

  test("cross-workspace isolation holds for reads and writes", async () => {
    const hidden = await asUser(ids.outsider, "SELECT id FROM public.projects WHERE id = $1", [
      ids.project,
    ]);
    expect(hidden.rowCount).toBe(0);

    await expectDenied(
      asUser(
        ids.outsider,
        "INSERT INTO public.deal_comments (project_id, user_id, body) VALUES ($1, $2, 'cross tenant')",
        [ids.project, ids.outsider],
      ),
    );

    const update = await asUser(
      ids.outsider,
      "UPDATE public.projects SET name = 'Cross Tenant Rename' WHERE id = $1 RETURNING id",
      [ids.project],
    );
    expect(update.rowCount).toBe(0);
  });

  test("extraction jobs are role-gated: member can write, viewer cannot", async () => {
    // A member (non-viewer) can create and advance an extraction job.
    const job = await asUser<{ id: string }>(
      ids.member,
      `INSERT INTO public.extraction_jobs (project_id, owner_id, kind, idempotency_key)
       VALUES ($1, $2, 'document_analysis', 'mem-key-1') RETURNING id`,
      [ids.project, ids.member],
    );
    expect(job.rowCount).toBe(1);
    const upd = await asUser(
      ids.member,
      "UPDATE public.extraction_jobs SET progress = 50 WHERE id = $1 RETURNING id",
      [job.rows[0].id],
    );
    expect(upd.rowCount).toBe(1);

    // A read-only viewer must not be able to create extraction jobs, even for
    // their own owner_id, on a workspace project.
    await expectDenied(
      asUser(
        ids.viewer,
        `INSERT INTO public.extraction_jobs (project_id, owner_id, kind, idempotency_key)
         VALUES ($1, $2, 'document_analysis', 'viewer-key-1')`,
        [ids.project, ids.viewer],
      ),
    );
  });

  test("extraction job idempotency key is unique per (owner, kind)", async () => {
    const first = await asUser(
      ids.member,
      `INSERT INTO public.extraction_jobs (project_id, owner_id, kind, idempotency_key)
       VALUES ($1, $2, 'assumption_extraction', 'dup-key') RETURNING id`,
      [ids.project, ids.member],
    );
    expect(first.rowCount).toBe(1);
    // A second insert with the same (owner, kind, idempotency_key) must fail the
    // unique constraint (23505) -- this is what makes a double-click / retry
    // idempotent. (A unique violation, not an RLS denial, so assert any reject.)
    await expect(
      asUser(
        ids.member,
        `INSERT INTO public.extraction_jobs (project_id, owner_id, kind, idempotency_key)
         VALUES ($1, $2, 'assumption_extraction', 'dup-key')`,
        [ids.project, ids.member],
      ),
    ).rejects.toThrow();
  });

  test("only a server-created pending record can authorize a storage object and document finalization", async () => {
    await expectDenied(
      asUser(
        ids.member,
        `INSERT INTO public.documents (project_id, owner_id, name, storage_path)
         VALUES ($1, $2, 'forged.pdf', $2 || '/forged.pdf')`,
        [ids.project, ids.member],
      ),
    );

    const prepared = await asUser<{ upload_id: string; object_path: string }>(
      ids.member,
      "SELECT * FROM public.prepare_document_upload($1, 'Budget.pdf', 'application/pdf', 1024, 'budget')",
      [ids.project],
    );
    expect(prepared.rowCount).toBe(1);
    const pending = prepared.rows[0];
    expect(pending.object_path).toContain(`${ids.member}/pending/${pending.upload_id}/`);

    await expectDenied(
      asUser(ids.member, "INSERT INTO storage.objects(bucket_id, name) VALUES ('documents', $1)", [
        `${ids.member}/arbitrary.pdf`,
      ]),
    );
    const permitted = await asUser(
      ids.member,
      "INSERT INTO storage.objects(bucket_id, name) VALUES ('documents', $1) RETURNING id",
      [pending.object_path],
    );
    expect(permitted.rowCount).toBe(1);

    // The finalization RPC is service-role only. An authenticated browser can
    // reserve/upload its object, but cannot forge a scan/hash verdict.
    await expectDenied(
      asUser(
        ids.member,
        "SELECT * FROM public.finalize_document_upload($1, $2, $3, 1024, 'application/pdf', '[structural] clean')",
        [pending.upload_id, ids.member, "a".repeat(64)],
      ),
    );

    await expectDenied(
      asUser(
        ids.viewer,
        "SELECT * FROM public.prepare_document_upload($1, 'Viewer.pdf', 'application/pdf', 1024, 'budget')",
        [ids.project],
      ),
    );
  });

  test("concurrent upload reservations cannot exceed the per-user file quota", async () => {
    await client.query(
      `INSERT INTO public.documents (project_id, owner_id, name, storage_path, size_bytes)
       SELECT $1, $2, 'prior-' || g || '.pdf', $2::text || '/seed-' || g || '.pdf', 1
       FROM generate_series(1, 199) AS g`,
      [ids.project, ids.member],
    );
    const sql =
      "SELECT * FROM public.prepare_document_upload($1, 'Concurrent.pdf', 'application/pdf', 1, 'budget')";
    const results = await Promise.allSettled([
      asConcurrentUser(ids.member, sql, [ids.project]),
      asConcurrentUser(ids.member, sql, [ids.project]),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
