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
  permitCase: "40000000-0000-4000-8000-000000000001",
  personalPermitCase: "40000000-0000-4000-8000-000000000004",
  permit: "40000000-0000-4000-8000-000000000002",
  document: "40000000-0000-4000-8000-000000000003",
  assignment: "40000000-0000-4000-8000-000000000005",
  handoff: "40000000-0000-4000-8000-000000000006",
  legalCopy: "40000000-0000-4000-8000-000000000007",
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
  return /row-level security|permission denied|does not exist|project access denied|handoff not found or response not allowed|Permit documents must belong to the same project|Only a workspace owner|Only the owner can move a personal permit case|A workspace must always have at least one owner|append-only/i.test(
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
  await client.query(
    `INSERT INTO public.permit_cases(id,owner_id,workspace_id,name,municipality,municipality_confirmed)
     VALUES($1,$2,$3,'Shared permit case','City of Vancouver',true)`,
    [ids.permitCase, ids.owner, ids.workspace],
  );
  await client.query(
    `INSERT INTO public.project_permits(id,case_id,owner_id,name,permit_type)
     VALUES($1,$2,$3,'Building permit','building')`,
    [ids.permit, ids.permitCase, ids.owner],
  );
  await client.query(
    `INSERT INTO public.documents(id,owner_id,permit_case_id,name,storage_path)
     VALUES($1::uuid,$2::uuid,$3::uuid,'permit.pdf',($2::uuid)::text||'/pending/40000000-0000-4000-8000-000000000004/permit.pdf')`,
    [ids.document, ids.owner, ids.permitCase],
  );
  await client.query(
    `INSERT INTO public.pilot_user_access(user_id,organization,permits_access,underwriting_preview,pilot_status)
     VALUES
       ($1,'RLS fixture',true,true,'active'),
       ($2,'RLS fixture',true,false,'active'),
       ($3,'RLS fixture',true,false,'active'),
       ($4,'RLS fixture',true,false,'active'),
       ($5,'RLS fixture',true,false,'active')`,
    [ids.owner, ids.coOwner, ids.admin, ids.member, ids.viewer],
  );
  await client.query("DELETE FROM public.legal_copy_versions WHERE id=$1", [ids.legalCopy]);
  await client.query(
    `INSERT INTO public.legal_copy_versions(id,copy_key,version,content,approval_status,approver_name,approved_at,effective_at)
     VALUES($1,'rls_fixture','1','Approved fixture','approved','Qualified reviewer',now(),now())`,
    [ids.legalCopy],
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
  test("pilot entitlements are self-readable and service-managed", async () => {
    expect((await asUser(ids.owner, "SELECT user_id FROM public.pilot_user_access")).rowCount).toBe(
      1,
    );
    expect(
      (await asUser(ids.outsider, "SELECT user_id FROM public.pilot_user_access")).rowCount,
    ).toBe(0);
    await expectDenied(
      asUser(
        ids.owner,
        "INSERT INTO public.pilot_user_access(user_id,permits_access,pilot_status) VALUES($1,true,'active')",
        [ids.outsider],
      ),
    );
    const access = await asUser<{ underwriting_preview: boolean }>(
      ids.owner,
      "SELECT underwriting_preview FROM public.current_product_access()",
    );
    expect(access.rows[0].underwriting_preview).toBe(true);
    await expectDenied(
      asUser(
        ids.outsider,
        "INSERT INTO public.permit_cases(owner_id,name) VALUES($1,'Unapproved pilot case')",
        [ids.outsider],
      ),
    );
  });

  test("only approved effective legal copy is visible to authenticated users", async () => {
    const approved = await asUser(
      ids.member,
      "SELECT id FROM public.legal_copy_versions WHERE id=$1",
      [ids.legalCopy],
    );
    expect(approved.rowCount).toBe(1);
    const drafts = await asUser(
      ids.member,
      "SELECT id FROM public.legal_copy_versions WHERE approval_status='draft'",
    );
    expect(drafts.rowCount).toBe(0);
  });

  test("permit assignments require write access and an authorized assignee", async () => {
    const inserted = await asUser(
      ids.member,
      `INSERT INTO public.permit_case_assignments(id,case_id,assignee_id,assigned_by,responsibility)
       VALUES($1,$2,$3,$4,'Catalogue review') RETURNING id`,
      [ids.assignment, ids.permitCase, ids.admin, ids.member],
    );
    expect(inserted.rowCount).toBe(1);
    await expectDenied(
      asUser(
        ids.viewer,
        `INSERT INTO public.permit_case_assignments(case_id,assignee_id,assigned_by,responsibility)
         VALUES($1,$2,$3,'Viewer mutation')`,
        [ids.permitCase, ids.viewer, ids.viewer],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        `INSERT INTO public.permit_case_assignments(case_id,assignee_id,assigned_by,responsibility)
         VALUES($1,$2,$3,'Outsider assignment')`,
        [ids.permitCase, ids.outsider, ids.member],
      ),
    );
  });

  test("handoffs accept only through the authorized target transition", async () => {
    const inserted = await asUser(
      ids.member,
      `INSERT INTO public.permit_case_handoffs(id,case_id,from_user_id,to_user_id,initiated_by,note)
       VALUES($1,$2,$3,$4,$3,'Review remains unresolved') RETURNING id`,
      [ids.handoff, ids.permitCase, ids.member, ids.admin],
    );
    expect(inserted.rowCount).toBe(1);
    await expectDenied(
      asUser(ids.outsider, "SELECT public.respond_permit_case_handoff($1,'accepted')", [
        ids.handoff,
      ]),
    );
    await expectDenied(
      asUser(ids.member, "SELECT public.respond_permit_case_handoff($1,'accepted')", [ids.handoff]),
    );
    const accepted = await asUser<{ status: string }>(
      ids.admin,
      "SELECT status FROM public.respond_permit_case_handoff($1,'accepted')",
      [ids.handoff],
    );
    expect(accepted.rows[0].status).toBe("accepted");
    const responsibility = await asUser(
      ids.admin,
      "SELECT id FROM public.permit_case_assignments WHERE case_id=$1 AND assignee_id=$2 AND responsibility='Permit case responsibility'",
      [ids.permitCase, ids.admin],
    );
    expect(responsibility.rowCount).toBe(1);
  });

  test("permit case roles are isolated and viewers remain read-only", async () => {
    for (const user of [ids.owner, ids.admin, ids.member, ids.viewer]) {
      const visible = await asUser(user, "SELECT id FROM public.permit_cases WHERE id=$1", [
        ids.permitCase,
      ]);
      expect(visible.rowCount).toBe(1);
    }
    expect(
      (
        await asUser(ids.outsider, "SELECT id FROM public.permit_cases WHERE id=$1", [
          ids.permitCase,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await asUser(
          ids.member,
          "UPDATE public.permit_cases SET notes='member review' WHERE id=$1 RETURNING id",
          [ids.permitCase],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.viewer,
          "UPDATE public.permit_cases SET notes='forged' WHERE id=$1 RETURNING id",
          [ids.permitCase],
        )
      ).rowCount,
    ).toBe(0);
  });

  test("a personal permit case can be explicitly shared only by its owner", async () => {
    await client.query(
      `INSERT INTO public.permit_cases(id,owner_id,name,municipality,municipality_confirmed)
       VALUES($1,$2,'Personal transfer case','City of Vancouver',true)`,
      [ids.personalPermitCase, ids.owner],
    );

    await expectDenied(
      asUser(
        ids.member,
        "SELECT public.transfer_permit_case_to_workspace($1,$2,'Member attempt')",
        [ids.personalPermitCase, ids.workspace],
      ),
    );

    const transferred = await asUser<{ transfer_permit_case_to_workspace: string }>(
      ids.owner,
      "SELECT public.transfer_permit_case_to_workspace($1,$2,'Share for permit review')",
      [ids.personalPermitCase, ids.workspace],
    );
    expect(transferred.rows[0].transfer_permit_case_to_workspace).toBe(ids.personalPermitCase);

    const caseRow = await asUser<{ workspace_id: string }>(
      ids.owner,
      "SELECT workspace_id FROM public.permit_cases WHERE id=$1",
      [ids.personalPermitCase],
    );
    expect(caseRow.rows[0].workspace_id).toBe(ids.workspace);

    const history = await asUser(
      ids.member,
      "SELECT id FROM public.permit_case_history WHERE case_id=$1 AND action='case_workspace_transferred' AND reason='Share for permit review'",
      [ids.personalPermitCase],
    );
    expect(history.rowCount).toBe(1);
  });

  test("personal permit cases are private and owner-managed", async () => {
    const personal = await asUser<{ id: string }>(
      ids.owner,
      "INSERT INTO public.permit_cases(owner_id,name) VALUES($1,'Personal case') RETURNING id",
      [ids.owner],
    );
    const id = personal.rows[0].id;
    expect(
      (await asUser(ids.owner, "SELECT id FROM public.permit_cases WHERE id=$1", [id])).rowCount,
    ).toBe(1);
    expect(
      (await asUser(ids.outsider, "SELECT id FROM public.permit_cases WHERE id=$1", [id])).rowCount,
    ).toBe(0);
    expect(
      (
        await asUser(
          ids.owner,
          "UPDATE public.permit_cases SET notes='updated' WHERE id=$1 RETURNING id",
          [id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (await asUser(ids.owner, "DELETE FROM public.permit_cases WHERE id=$1 RETURNING id", [id]))
        .rowCount,
    ).toBe(1);
  });

  test("removed members immediately lose permit-case access", async () => {
    expect(
      (await asUser(ids.member, "SELECT id FROM public.permit_cases WHERE id=$1", [ids.permitCase]))
        .rowCount,
    ).toBe(1);
    await client.query(
      "DELETE FROM public.workspace_members WHERE workspace_id=$1 AND user_id=$2",
      [ids.workspace, ids.member],
    );
    expect(
      (await asUser(ids.member, "SELECT id FROM public.permit_cases WHERE id=$1", [ids.permitCase]))
        .rowCount,
    ).toBe(0);
  });

  test("permit children, history, and document links enforce the case boundary", async () => {
    expect(
      (await asUser(ids.viewer, "SELECT id FROM public.project_permits WHERE id=$1", [ids.permit]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(ids.outsider, "SELECT id FROM public.project_permits WHERE id=$1", [
          ids.permit,
        ])
      ).rowCount,
    ).toBe(0);
    await expectDenied(
      asUser(
        ids.outsider,
        "INSERT INTO public.permit_requirements(project_permit_id,name) VALUES($1,'forged')",
        [ids.permit],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        "INSERT INTO public.permit_history(project_permit_id,changed_by) VALUES($1,$2)",
        [ids.permit, ids.member],
      ),
    );
    expect(
      (
        await asUser(
          ids.owner,
          "INSERT INTO public.permit_documents(permit_id,document_id) VALUES($1,$2) RETURNING permit_id",
          [ids.permit, ids.document],
        )
      ).rowCount,
    ).toBe(1);
    await expectDenied(
      asUser(
        ids.outsider,
        "INSERT INTO public.permit_documents(permit_id,document_id) VALUES($1,$2)",
        [ids.permit, ids.document],
      ),
    );
  });
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
         VALUES ($1::uuid, $2::uuid, 'forged.pdf', $2::text || '/forged.pdf')`,
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

    // Finalization is enqueue-only for browsers. Repeated calls attach to one
    // pending-upload-bound verification job; browser callers cannot invent a
    // hash, scanner result, worker id, or completion transition.
    const queued = await asUser<{ status: string; job_id: string | null }>(
      ids.member,
      "SELECT * FROM public.enqueue_document_verification($1)",
      [pending.upload_id],
    );
    expect(queued.rows[0]).toMatchObject({ status: "verification_queued" });
    expect(queued.rows[0].job_id).toBeTruthy();
    const repeated = await Promise.all([
      asConcurrentUser<{ status: string; job_id: string | null }>(
        ids.member,
        "SELECT * FROM public.enqueue_document_verification($1)",
        [pending.upload_id],
      ),
      asConcurrentUser<{ status: string; job_id: string | null }>(
        ids.member,
        "SELECT * FROM public.enqueue_document_verification($1)",
        [pending.upload_id],
      ),
    ]);
    expect(new Set(repeated.map((result) => result.rows[0].job_id))).toEqual(
      new Set([queued.rows[0].job_id]),
    );
    const jobs = await client.query(
      "SELECT count(*)::int AS count FROM public.extraction_jobs WHERE pending_upload_id = $1 AND kind = 'document_verification'",
      [pending.upload_id],
    );
    expect(jobs.rows[0].count).toBe(1);
    await expectDenied(
      asUser(
        ids.member,
        "SELECT * FROM public.complete_document_verification($1, 'forged-worker', $2, 1024, 'application/pdf', 'clean')",
        [queued.rows[0].job_id, "b".repeat(64)],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        "SELECT public.reject_document_verification($1, 'forged-worker', 'forged scanner verdict')",
        [queued.rows[0].job_id],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        "UPDATE public.pending_document_uploads SET status = 'finalized', document_id = $2 WHERE id = $1",
        [pending.upload_id, ids.project],
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
       SELECT $1::uuid, $2::uuid, 'prior-' || g || '.pdf', $2::text || '/seed-' || g || '.pdf', 1
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

  test("permit register isolates outsiders and rejects cross-project document links", async () => {
    const jurisdiction = await client.query<{ id: string }>(
      "SELECT id FROM public.jurisdictions WHERE name='City of Vancouver'",
    );
    const permit = await asUser<{ id: string }>(
      ids.owner,
      `INSERT INTO public.project_permits
       (project_id,owner_id,jurisdiction_id,name,permit_type,source_kind,notes)
       VALUES ($1,$2,$3,'Building permit','building','analyst','RLS fixture') RETURNING id`,
      [ids.project, ids.owner, jurisdiction.rows[0].id],
    );
    const permitId = permit.rows[0].id;
    const memberVisible = await asUser(
      ids.member,
      "SELECT id FROM public.project_permits WHERE id=$1",
      [permitId],
    );
    expect(memberVisible.rowCount).toBe(1);
    const outsiderVisible = await asUser(
      ids.outsider,
      "SELECT id FROM public.project_permits WHERE id=$1",
      [permitId],
    );
    expect(outsiderVisible.rowCount).toBe(0);

    const ownDocument = await client.query<{ id: string }>(
      `INSERT INTO public.documents(project_id,owner_id,name,storage_path)
       VALUES ($1::uuid,$2::uuid,'permit.pdf',($2::uuid)::text || '/permit.pdf') RETURNING id`,
      [ids.project, ids.owner],
    );
    const otherDocument = await client.query<{ id: string }>(
      `INSERT INTO public.documents(project_id,owner_id,name,storage_path)
       VALUES ($1::uuid,$2::uuid,'other.pdf',($2::uuid)::text || '/other.pdf') RETURNING id`,
      [ids.otherProject, ids.outsider],
    );
    const linked = await asUser(
      ids.owner,
      "INSERT INTO public.permit_documents(permit_id,document_id) VALUES ($1,$2) RETURNING permit_id",
      [permitId, ownDocument.rows[0].id],
    );
    expect(linked.rowCount).toBe(1);
    await expectDenied(
      asUser(
        ids.owner,
        "INSERT INTO public.permit_documents(permit_id,document_id) VALUES ($1,$2)",
        [permitId, otherDocument.rows[0].id],
      ),
    );
  });

  test("document permit candidates remain review-only and owner-scoped", async () => {
    const document = await client.query<{ id: string }>(
      `INSERT INTO public.documents(project_id,owner_id,name,storage_path)
       VALUES ($1::uuid,$2::uuid,'source.pdf',($2::uuid)::text || '/source.pdf') RETURNING id`,
      [ids.project, ids.owner],
    );
    const candidate = await asUser<{ id: string; review_status: string }>(
      ids.owner,
      `INSERT INTO public.permit_extraction_candidates
       (project_id,owner_id,document_id,candidate_name,source_location,source_text,extraction_version)
       VALUES ($1,$2,$3,'Candidate permit','page 2','Permit candidate text','test-v1')
       RETURNING id,review_status`,
      [ids.project, ids.owner, document.rows[0].id],
    );
    expect(candidate.rows[0].review_status).toBe("needs_review");
    const outsider = await asUser(
      ids.outsider,
      "SELECT id FROM public.permit_extraction_candidates WHERE id=$1",
      [candidate.rows[0].id],
    );
    expect(outsider.rowCount).toBe(0);
  });
});
