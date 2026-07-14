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
  property: "50000000-0000-4000-8000-000000000001",
  otherProperty: "50000000-0000-4000-8000-000000000002",
  personalProperty: "50000000-0000-4000-8000-000000000003",
  transferDocument: "50000000-0000-4000-8000-000000000004",
  deprovisionUser: "60000000-0000-4000-8000-000000000001",
  deprovisionWorkspace: "60000000-0000-4000-8000-000000000002",
  deprovisionProperty: "60000000-0000-4000-8000-000000000003",
  deprovisionProject: "60000000-0000-4000-8000-000000000004",
  deprovisionCase: "60000000-0000-4000-8000-000000000005",
  deprovisionDocument: "60000000-0000-4000-8000-000000000006",
  deprovisionPermit: "60000000-0000-4000-8000-000000000007",
  deprovisionCandidate: "60000000-0000-4000-8000-000000000008",
  deprovisionJob: "60000000-0000-4000-8000-000000000009",
  deprovisionContact: "60000000-0000-4000-8000-000000000010",
  personalTransferProperty: "70000000-0000-4000-8000-000000000001",
  personalTransferProject: "70000000-0000-4000-8000-000000000002",
  personalTransferCase: "70000000-0000-4000-8000-000000000003",
  personalTransferDocument: "70000000-0000-4000-8000-000000000004",
  personalTransferContact: "70000000-0000-4000-8000-000000000005",
  catalogueRule: "80000000-0000-4000-8000-000000000001",
  catalogueLinkedCase: "80000000-0000-4000-8000-000000000002",
  revokedDocument: "90000000-0000-4000-8000-000000000001",
  revokedJob: "90000000-0000-4000-8000-000000000002",
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
  return /row-level security|permission denied|does not exist|project access denied|Project write access is required|Permit case write access is required|Archived Permit cases are read-only|linked Permit case|approved research catalogue|Catalogue evidence can only be created|Document job access is denied|handoff not found or response not allowed|Permit documents must belong to the same project|Only a workspace owner|Only the owner can move a personal permit case|Only the owner can move an active personal property|A workspace must always have at least one owner|append-only|Property write access denied|same property workspace|explicit property move|Property ownership and workspace cannot be changed|Property workspace cannot be changed|Task assignee must belong|set_property_next_action|canonical Property record|Record attribution cannot be changed/i.test(
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
  test("legacy pilot records stay service-managed while product access is open", async () => {
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
    const generalAccess = await asUser<{ permits_access: boolean; pilot_status: string }>(
      ids.outsider,
      "SELECT permits_access,pilot_status FROM public.current_product_access()",
    );
    expect(generalAccess.rows[0]).toEqual({
      permits_access: true,
      pilot_status: "general_access",
    });
    expect(
      (
        await asUser(
          ids.outsider,
          "INSERT INTO public.permit_cases(owner_id,name) VALUES($1,'General access case') RETURNING owner_id",
          [ids.outsider],
        )
      ).rows[0].owner_id,
    ).toBe(ids.outsider);
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
        ids.member,
        `INSERT INTO public.permit_case_handoffs(case_id,from_user_id,to_user_id,initiated_by,note)
         VALUES($1,$2,$3,$2,'Viewer cannot own a handoff')`,
        [ids.permitCase, ids.member, ids.viewer],
      ),
    );
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
    await expectDenied(
      asUser(
        ids.member,
        `INSERT INTO public.permit_case_assignments(case_id,assignee_id,assigned_by,responsibility)
         VALUES($1,$2,$3,'Viewer assignment')`,
        [ids.permitCase, ids.viewer, ids.member],
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

  test("canonical workspace properties are collaborative, tenant-isolated, and auditable", async () => {
    const created = await asUser<{ id: string; normalized_address: string }>(
      ids.owner,
      `INSERT INTO public.properties(
         id,owner_id,workspace_id,display_name,building_name,address_line_1,
         address_line_2,unit,municipality,postal_code,owner_name,broker_name,price
       ) VALUES($1,$2,$3,'Harbour Centre','Harbour Centre',' 555 W Hastings St ',
         'Tower A','Suite 1200','Vancouver','v6b 4n6','Example Owner','Capital Broker',12500000)
       RETURNING id,normalized_address`,
      [ids.property, ids.owner, ids.workspace],
    );
    expect(created.rows[0].normalized_address).toBe(
      "555 w hastings st tower a suite 1200 city of vancouver v6b 4n6",
    );

    for (const user of [ids.owner, ids.member, ids.viewer]) {
      expect(
        (await asUser(user, "SELECT id FROM public.properties WHERE id=$1", [ids.property]))
          .rowCount,
      ).toBe(1);
    }
    expect(
      (await asUser(ids.outsider, "SELECT id FROM public.properties WHERE id=$1", [ids.property]))
        .rowCount,
    ).toBe(0);

    expect(
      (
        await asUser(
          ids.member,
          "UPDATE public.properties SET notes='Member diligence note' WHERE id=$1 RETURNING id",
          [ids.property],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.viewer,
          "UPDATE public.properties SET notes='Viewer forgery' WHERE id=$1 RETURNING id",
          [ids.property],
        )
      ).rowCount,
    ).toBe(0);

    const events = await asUser<{ event_type: string }>(
      ids.viewer,
      "SELECT event_type FROM public.property_activity_events WHERE property_id=$1 ORDER BY created_at",
      [ids.property],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "property_created",
      "property_updated",
    ]);
    await expectDenied(
      asUser(
        ids.member,
        `INSERT INTO public.property_activity_events(property_id,event_type,entity_type)
         VALUES($1,'forged','property')`,
        [ids.property],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        "UPDATE public.property_activity_events SET event_type='forged' WHERE property_id=$1",
        [ids.property],
      ),
    );
  });

  test("personal property search stays personal and related fragments remain searchable", async () => {
    await asUser(
      ids.owner,
      `INSERT INTO public.properties(id,owner_id,address_line_1,municipality,notes)
       VALUES($1,$2,'101 Personal Lane','Vancouver','Long-term personal research')`,
      [ids.personalProperty, ids.owner],
    );
    await asUser(
      ids.owner,
      `INSERT INTO public.properties(id,owner_id,workspace_id,address_line_1,municipality)
       VALUES($1,$2,$3,'202 Shared Avenue','Vancouver')`,
      [ids.property, ids.owner, ids.workspace],
    );
    await asUser(
      ids.member,
      `INSERT INTO public.property_contacts(property_id,contact_id,created_by,role,notes)
       VALUES($1,$2,$3,'broker','Original listing broker')`,
      [ids.property, ids.contact, ids.member],
    );

    expect(
      (
        await asUser(
          ids.owner,
          "SELECT id FROM public.search_properties(NULL,'personal research',NULL,NULL,NULL,NULL,false,50)",
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.owner,
          "SELECT id FROM public.search_properties(NULL,NULL,NULL,NULL,NULL,NULL,false,50)",
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.member,
          "SELECT id FROM public.search_properties(NULL,NULL,NULL,NULL,NULL,NULL,false,50)",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await asUser(
          ids.member,
          "SELECT id FROM public.search_properties($1,'Capital Contact',NULL,NULL,NULL,NULL,false,50)",
          [ids.workspace],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.outsider,
          "SELECT id FROM public.search_properties($1,NULL,NULL,NULL,NULL,NULL,false,50)",
          [ids.workspace],
        )
      ).rowCount,
    ).toBe(0);
  });

  test("property search preserves old fragments and activity uses stable keyset pages", async () => {
    await asUser(
      ids.owner,
      `INSERT INTO public.properties(
         id,owner_id,workspace_id,address_line_1,municipality,postal_code,notes
       ) VALUES($1,$2,$3,'808 Memory Street','Vancouver','V5K 0A1','Five year alpha lead')`,
      [ids.property, ids.owner, ids.workspace],
    );
    await asUser(
      ids.member,
      "UPDATE public.properties SET notes='Current diligence note' WHERE id=$1",
      [ids.property],
    );
    expect(
      (
        await asUser(
          ids.member,
          "SELECT id FROM public.search_properties($1,'five alpha',NULL,NULL,NULL,NULL,false,50)",
          [ids.workspace],
        )
      ).rowCount,
    ).toBe(1);
    const scopes = await asUser<{ match_scope: string }>(
      ids.member,
      "SELECT match_scope FROM public.property_search_match_scopes(ARRAY[$1]::uuid[],'five alpha')",
      [ids.property],
    );
    expect(scopes.rows[0].match_scope).toBe("historical");

    for (let index = 0; index < 12; index += 1) {
      await asUser(ids.member, "UPDATE public.properties SET notes=$2 WHERE id=$1", [
        ids.property,
        `Revision ${index}`,
      ]);
    }
    const first = await asUser<{
      id: string;
      created_at: string;
      total_count: string;
    }>(
      ids.viewer,
      "SELECT id,created_at,total_count FROM public.list_property_activity($1,NULL,NULL,5)",
      [ids.property],
    );
    expect(first.rows).toHaveLength(6);
    expect(Number(first.rows[0].total_count)).toBeGreaterThanOrEqual(14);
    const cursor = first.rows[4];
    const second = await asUser<{ id: string }>(
      ids.viewer,
      "SELECT id FROM public.list_property_activity($1,$2,$3,5)",
      [ids.property, cursor.created_at, cursor.id],
    );
    expect(second.rows.map((row) => row.id)).not.toContain(cursor.id);
  });

  test("property tasks and record links enforce roles, scope, and canonical link history", async () => {
    await asUser(
      ids.owner,
      `INSERT INTO public.properties(id,owner_id,workspace_id,address_line_1,municipality)
       VALUES($1,$2,$3,'303 Link Street','Vancouver')`,
      [ids.property, ids.owner, ids.workspace],
    );

    const task = await asUser<{ id: string }>(
      ids.member,
      `INSERT INTO public.property_tasks(property_id,created_by,title,priority)
       VALUES($1,$2,'Call listing broker','high') RETURNING id`,
      [ids.property, ids.member],
    );
    expect(task.rowCount).toBe(1);
    await asUser(ids.member, "SELECT id FROM public.set_property_next_action($1,true)", [
      task.rows[0].id,
    ]);
    const completed = await asUser<{ completed_at: string }>(
      ids.member,
      "UPDATE public.property_tasks SET status='done' WHERE id=$1 RETURNING completed_at",
      [task.rows[0].id],
    );
    expect(completed.rows[0].completed_at).toBeTruthy();
    const firstNext = await asUser<{ id: string }>(
      ids.member,
      `INSERT INTO public.property_tasks(property_id,created_by,title)
       VALUES($1,$2,'First next action') RETURNING id`,
      [ids.property, ids.member],
    );
    await asUser(ids.member, "SELECT id FROM public.set_property_next_action($1,true)", [
      firstNext.rows[0].id,
    ]);
    const secondNext = await asUser<{ id: string }>(
      ids.member,
      `INSERT INTO public.property_tasks(property_id,created_by,title)
       VALUES($1,$2,'Replacement next action') RETURNING id`,
      [ids.property, ids.member],
    );
    await asUser(ids.member, "SELECT id FROM public.set_property_next_action($1,true)", [
      secondNext.rows[0].id,
    ]);
    const nextActions = await asUser<{ id: string; is_next_action: boolean }>(
      ids.member,
      `SELECT id,is_next_action FROM public.property_tasks WHERE id IN ($1,$2) ORDER BY id`,
      [firstNext.rows[0].id, secondNext.rows[0].id],
    );
    expect(nextActions.rows.filter((row) => row.is_next_action).map((row) => row.id)).toEqual([
      secondNext.rows[0].id,
    ]);
    const concurrentA = await asUser<{ id: string }>(
      ids.member,
      `INSERT INTO public.property_tasks(property_id,created_by,title)
       VALUES($1,$2,'Concurrent next A') RETURNING id`,
      [ids.property, ids.member],
    );
    const concurrentB = await asUser<{ id: string }>(
      ids.member,
      `INSERT INTO public.property_tasks(property_id,created_by,title)
       VALUES($1,$2,'Concurrent next B') RETURNING id`,
      [ids.property, ids.member],
    );
    const concurrentNext = await Promise.allSettled([
      asConcurrentUser(ids.member, "SELECT id FROM public.set_property_next_action($1,true)", [
        concurrentA.rows[0].id,
      ]),
      asConcurrentUser(ids.member, "SELECT id FROM public.set_property_next_action($1,true)", [
        concurrentB.rows[0].id,
      ]),
    ]);
    expect(concurrentNext.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(
      (
        await asUser(
          ids.member,
          `SELECT id FROM public.property_tasks
           WHERE property_id=$1 AND is_next_action AND status IN ('todo','in_progress','blocked')`,
          [ids.property],
        )
      ).rowCount,
    ).toBe(1);
    await expectDenied(
      asUser(
        ids.member,
        `INSERT INTO public.property_tasks(property_id,created_by,title,assigned_to)
         VALUES($1,$2,'Cross-tenant assignment',$3)`,
        [ids.property, ids.member, ids.outsider],
      ),
    );
    await expectDenied(
      asUser(
        ids.viewer,
        `INSERT INTO public.property_tasks(property_id,created_by,title)
         VALUES($1,$2,'Viewer task')`,
        [ids.property, ids.viewer],
      ),
    );

    expect(
      (
        await asUser(
          ids.admin,
          "UPDATE public.projects SET property_id=$1 WHERE id=$2 RETURNING id",
          [ids.property, ids.project],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.member,
          "UPDATE public.permit_cases SET property_id=$1 WHERE id=$2 RETURNING id",
          [ids.property, ids.permitCase],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.owner,
          "UPDATE public.documents SET property_id=$1 WHERE id=$2 RETURNING id",
          [ids.property, ids.document],
        )
      ).rowCount,
    ).toBe(1);

    await asUser(
      ids.owner,
      `INSERT INTO public.properties(id,owner_id,workspace_id,address_line_1)
       VALUES($1,$2,$3,'404 Replacement Road')`,
      [ids.otherProperty, ids.owner, ids.workspace],
    );
    await expectDenied(
      asUser(ids.admin, "UPDATE public.projects SET property_id=$1 WHERE id=$2", [
        ids.otherProperty,
        ids.project,
      ]),
    );
    await expectDenied(
      asUser(ids.owner, "UPDATE public.properties SET workspace_id=NULL WHERE id=$1", [
        ids.property,
      ]),
    );

    const linkEvents = await asUser<{ event_type: string }>(
      ids.viewer,
      `SELECT event_type FROM public.property_activity_events
       WHERE property_id=$1 AND event_type LIKE '%_linked'`,
      [ids.property],
    );
    expect(linkEvents.rows.map((row) => row.event_type).sort()).toEqual([
      "documents_linked",
      "permit_cases_linked",
      "projects_linked",
    ]);
  });

  test("new deal and case records canonicalize apartment metadata and propagate to documents", async () => {
    const firstProject = await asUser<{ id: string; property_id: string }>(
      ids.owner,
      `INSERT INTO public.projects(
         owner_id,workspace_id,name,property_address,address_line_2,building_name,
         address_provider,address_place_id,latitude,longitude,municipality
       ) VALUES(
         $1,$2,'Suite 1200 deal','555 W Hastings St','Suite 1200','Harbour Centre',
         'openstreetmap','complex-555',49.284500,-123.111500,'Vancouver'
       ) RETURNING id,property_id`,
      [ids.owner, ids.workspace],
    );
    const firstPropertyId = firstProject.rows[0].property_id;
    expect(firstPropertyId).toBeTruthy();
    const property = await asUser<{
      address_line_2: string;
      building_name: string;
      place_provider: string;
      provider_place_id: string;
      latitude: string;
      longitude: string;
    }>(
      ids.owner,
      `SELECT address_line_2,building_name,place_provider,provider_place_id,latitude,longitude
       FROM public.properties WHERE id=$1`,
      [firstPropertyId],
    );
    expect(property.rows[0]).toMatchObject({
      address_line_2: "Suite 1200",
      building_name: "Harbour Centre",
      place_provider: "openstreetmap",
      provider_place_id: "complex-555",
    });

    const duplicateProject = await asUser<{ property_id: string }>(
      ids.owner,
      `INSERT INTO public.projects(
         owner_id,workspace_id,name,property_address,address_line_2,
         address_provider,address_place_id,municipality
       ) VALUES($1,$2,'Same suite','555 West Hastings Street','Suite 1200',
         'openstreetmap','complex-555','Vancouver') RETURNING property_id`,
      [ids.owner, ids.workspace],
    );
    expect(duplicateProject.rows[0].property_id).toBe(firstPropertyId);

    const otherSuite = await asUser<{ property_id: string }>(
      ids.owner,
      `INSERT INTO public.projects(
         owner_id,workspace_id,name,property_address,address_line_2,
         address_provider,address_place_id,municipality
       ) VALUES($1,$2,'Suite 1300','555 W Hastings St','Suite 1300',
         'openstreetmap','complex-555','Vancouver') RETURNING property_id`,
      [ids.owner, ids.workspace],
    );
    expect(otherSuite.rows[0].property_id).not.toBe(firstPropertyId);

    const inheritedDocument = await client.query<{ property_id: string }>(
      `INSERT INTO public.documents(project_id,owner_id,name,storage_path)
       VALUES($1::uuid,$2::uuid,'offering.pdf',$2::text||'/offering.pdf') RETURNING property_id`,
      [firstProject.rows[0].id, ids.owner],
    );
    expect(inheritedDocument.rows[0].property_id).toBe(firstPropertyId);

    const inheritedCase = await asUser<{ property_id: string }>(
      ids.owner,
      `INSERT INTO public.permit_cases(owner_id,workspace_id,project_id,name)
       VALUES($1,$2,$3,'Permit research') RETURNING property_id`,
      [ids.owner, ids.workspace, firstProject.rows[0].id],
    );
    expect(inheritedCase.rows[0].property_id).toBe(firstPropertyId);

    await expectDenied(
      asUser(
        ids.owner,
        "UPDATE public.projects SET property_address='999 Drift Road' WHERE id=$1",
        [firstProject.rows[0].id],
      ),
    );
    await asUser(
      ids.owner,
      "UPDATE public.properties SET address_line_1='556 W Hastings St' WHERE id=$1",
      [firstPropertyId],
    );
    const projected = await asUser<{ property_address: string }>(
      ids.member,
      "SELECT property_address FROM public.projects WHERE id=$1",
      [firstProject.rows[0].id],
    );
    expect(projected.rows[0].property_address).toBe("556 W Hastings St");

    const manualProject = await asUser<{ property_id: string }>(
      ids.owner,
      `INSERT INTO public.projects(
         owner_id,workspace_id,name,property_address,municipality,address_region,postal_code
       ) VALUES($1,$2,'Manual address','808 Robson Street','Vancouver','BC','V6E 1C1')
       RETURNING property_id`,
      [ids.owner, ids.workspace],
    );
    const manualCase = await asUser<{ property_id: string }>(
      ids.owner,
      `INSERT INTO public.permit_cases(
         owner_id,workspace_id,name,property_address,municipality,province,postal_code
       ) VALUES($1,$2,'Same manual address','808 Robson Street','City of Vancouver',
         'British Columbia','V6E 1C1') RETURNING property_id`,
      [ids.owner, ids.workspace],
    );
    expect(manualCase.rows[0].property_id).toBe(manualProject.rows[0].property_id);
  });

  test("deprovisioning retains a shared property and Permit evidence graph", async () => {
    await client.query(
      "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'departing@example.com','{}')",
      [ids.deprovisionUser],
    );
    await client.query(
      `INSERT INTO public.workspaces(id,name,created_by) VALUES($1,'Retained Workspace',$2)`,
      [ids.deprovisionWorkspace, ids.deprovisionUser],
    );
    await client.query(
      `INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($1,$3,'owner')`,
      [ids.deprovisionWorkspace, ids.deprovisionUser, ids.coOwner],
    );
    await client.query(
      `INSERT INTO public.properties(
         id,owner_id,workspace_id,address_line_1,municipality,postal_code
       ) VALUES($1,$2,$3,'900 Retention Road','Vancouver','V5K 0A1')`,
      [ids.deprovisionProperty, ids.deprovisionUser, ids.deprovisionWorkspace],
    );
    await client.query(
      `INSERT INTO public.projects(id,owner_id,workspace_id,name,property_id)
       VALUES($1,$2,$3,'Retained deal',$4)`,
      [
        ids.deprovisionProject,
        ids.deprovisionUser,
        ids.deprovisionWorkspace,
        ids.deprovisionProperty,
      ],
    );
    await client.query(
      `INSERT INTO public.permit_cases(id,owner_id,workspace_id,project_id,property_id,name)
       VALUES($1,$2,$3,$4,$5,'Retained Permit case')`,
      [
        ids.deprovisionCase,
        ids.deprovisionUser,
        ids.deprovisionWorkspace,
        ids.deprovisionProject,
        ids.deprovisionProperty,
      ],
    );
    await client.query(
      `INSERT INTO public.documents(
         id,owner_id,project_id,permit_case_id,property_id,name,storage_path
       ) VALUES($1,$2,$3,$4,$5,'retained.pdf',($2::uuid)::text||'/retained.pdf')`,
      [
        ids.deprovisionDocument,
        ids.deprovisionUser,
        ids.deprovisionProject,
        ids.deprovisionCase,
        ids.deprovisionProperty,
      ],
    );
    await client.query(
      `INSERT INTO public.project_permits(
         id,project_id,case_id,owner_id,name,permit_type
       ) VALUES($1,$2,$3,$4,'Retained building Permit','building')`,
      [ids.deprovisionPermit, ids.deprovisionProject, ids.deprovisionCase, ids.deprovisionUser],
    );
    await client.query(
      `INSERT INTO public.permit_extraction_candidates(
         id,permit_case_id,owner_id,document_id,candidate_name,source_location,
         source_text,extraction_version
       ) VALUES($1,$2,$3,$4,'Retained clue','Page 1','building permit','retention-v1')`,
      [ids.deprovisionCandidate, ids.deprovisionCase, ids.deprovisionUser, ids.deprovisionDocument],
    );
    await client.query(
      `INSERT INTO public.extraction_jobs(
         id,owner_id,document_id,kind,idempotency_key
       ) VALUES($1,$2,$3,'permit_case_research','retained-job')`,
      [ids.deprovisionJob, ids.deprovisionUser, ids.deprovisionDocument],
    );
    await client.query(
      `INSERT INTO public.relationship_contacts(
         id,owner_id,workspace_id,full_name
       ) VALUES($1,$2,$3,'Retained Broker')`,
      [ids.deprovisionContact, ids.deprovisionUser, ids.deprovisionWorkspace],
    );
    await client.query(
      `INSERT INTO public.property_contacts(property_id,contact_id,created_by,role)
       VALUES($1,$2,$3,'broker')`,
      [ids.deprovisionProperty, ids.deprovisionContact, ids.deprovisionUser],
    );
    await client.query(
      `INSERT INTO public.property_urls(property_id,created_by,url)
       VALUES($1,$2,'https://example.com/retained')`,
      [ids.deprovisionProperty, ids.deprovisionUser],
    );
    await client.query(
      `INSERT INTO public.property_tasks(property_id,created_by,assigned_to,title)
       VALUES($1,$2,$2,'Retained task')`,
      [ids.deprovisionProperty, ids.deprovisionUser],
    );

    await expectDenied(
      asUser(ids.coOwner, "UPDATE public.projects SET owner_id=$1 WHERE id=$2", [
        ids.outsider,
        ids.deprovisionProject,
      ]),
    );
    await client.query("DELETE FROM auth.users WHERE id=$1", [ids.deprovisionUser]);

    const retained = await asUser<{
      owner_id: string | null;
      created_by: string | null;
    }>(
      ids.coOwner,
      `SELECT property.owner_id,url.created_by
       FROM public.properties property
       JOIN public.property_urls url ON url.property_id=property.id
       WHERE property.id=$1`,
      [ids.deprovisionProperty],
    );
    expect(retained.rows[0]).toEqual({ owner_id: null, created_by: null });
    for (const [table, recordId] of [
      ["projects", ids.deprovisionProject],
      ["permit_cases", ids.deprovisionCase],
      ["documents", ids.deprovisionDocument],
      ["project_permits", ids.deprovisionPermit],
      ["permit_extraction_candidates", ids.deprovisionCandidate],
      ["extraction_jobs", ids.deprovisionJob],
    ] as const) {
      const result = await client.query<{ owner_id: string | null }>(
        `SELECT owner_id FROM public.${table} WHERE id=$1`,
        [recordId],
      );
      expect(result.rows[0].owner_id).toBeNull();
    }
    const workspace = await client.query<{ created_by: string | null }>(
      "SELECT created_by FROM public.workspaces WHERE id=$1",
      [ids.deprovisionWorkspace],
    );
    expect(workspace.rows[0].created_by).toBeNull();
    expect(
      (
        await asUser(
          ids.coOwner,
          "SELECT id FROM public.search_properties($1,'retained broker',NULL,NULL,NULL,NULL,false,50)",
          [ids.deprovisionWorkspace],
        )
      ).rowCount,
    ).toBe(1);
  });

  test("a personal permit case can be explicitly shared only by its owner", async () => {
    const personal = await client.query<{ property_id: string }>(
      `INSERT INTO public.permit_cases(
         id,owner_id,name,property_address,municipality,municipality_confirmed,postal_code
       ) VALUES($1,$2,'Personal transfer case','123 Personal Lane','City of Vancouver',true,
         'V5K 0A1') RETURNING property_id`,
      [ids.personalPermitCase, ids.owner],
    );
    const sourcePropertyId = personal.rows[0].property_id;
    await client.query(
      `INSERT INTO public.documents(id,owner_id,permit_case_id,name,storage_path)
       VALUES($1,$2,$3,'transfer.pdf',($2::uuid)::text||'/transfer.pdf')`,
      [ids.transferDocument, ids.owner, ids.personalPermitCase],
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

    const caseRow = await asUser<{ workspace_id: string; property_id: string }>(
      ids.owner,
      "SELECT workspace_id,property_id FROM public.permit_cases WHERE id=$1",
      [ids.personalPermitCase],
    );
    expect(caseRow.rows[0].workspace_id).toBe(ids.workspace);
    expect(caseRow.rows[0].property_id).not.toBe(sourcePropertyId);
    const document = await asUser<{ property_id: string }>(
      ids.member,
      "SELECT property_id FROM public.documents WHERE id=$1",
      [ids.transferDocument],
    );
    expect(document.rows[0].property_id).toBe(caseRow.rows[0].property_id);
    expect(
      (await asUser(ids.owner, "SELECT id FROM public.properties WHERE id=$1", [sourcePropertyId]))
        .rowCount,
    ).toBe(1);

    const history = await asUser(
      ids.member,
      "SELECT id FROM public.permit_case_history WHERE case_id=$1 AND action='case_workspace_transferred' AND reason='Share for permit review'",
      [ids.personalPermitCase],
    );
    expect(history.rowCount).toBe(1);
  });

  test("a governed personal Property transfer moves its complete linked graph", async () => {
    await asUser(
      ids.owner,
      `INSERT INTO public.properties(
         id,owner_id,address_line_1,municipality,region,postal_code,notes
       ) VALUES($1,$2,'88 Personal Property Way','Vancouver','BC','V5K 1A1',
         'Five-year acquisition note')`,
      [ids.personalTransferProperty, ids.owner],
    );
    await asUser(
      ids.owner,
      `INSERT INTO public.projects(id,owner_id,name,property_id)
       VALUES($1,$2,'Personal underwriting deal',$3)`,
      [ids.personalTransferProject, ids.owner, ids.personalTransferProperty],
    );
    await client.query(
      `INSERT INTO public.permit_cases(id,owner_id,project_id,property_id,name)
       VALUES($1,$2,$3,$4,'Personal linked Permit case')`,
      [
        ids.personalTransferCase,
        ids.owner,
        ids.personalTransferProject,
        ids.personalTransferProperty,
      ],
    );
    await client.query(
      `INSERT INTO public.documents(
         id,owner_id,project_id,permit_case_id,property_id,name,storage_path
       ) VALUES($1,$2,$3,$4,$5,'personal-graph.pdf',($2::uuid)::text||'/personal-graph.pdf')`,
      [
        ids.personalTransferDocument,
        ids.owner,
        ids.personalTransferProject,
        ids.personalTransferCase,
        ids.personalTransferProperty,
      ],
    );
    await asUser(
      ids.owner,
      `INSERT INTO public.property_urls(property_id,created_by,url,label)
       VALUES($1,$2,'https://example.test/personal-listing','Original listing')`,
      [ids.personalTransferProperty, ids.owner],
    );
    await asUser(
      ids.owner,
      `INSERT INTO public.relationship_contacts(
         id,owner_id,full_name,company,relationship_type,notes
       ) VALUES($1,$2,'Personal Broker','Transfer Realty','broker','Original relationship')`,
      [ids.personalTransferContact, ids.owner],
    );
    await asUser(
      ids.owner,
      `INSERT INTO public.property_contacts(property_id,contact_id,created_by,role)
       VALUES($1,$2,$3,'broker')`,
      [ids.personalTransferProperty, ids.personalTransferContact, ids.owner],
    );
    const task = await asUser<{ id: string }>(
      ids.owner,
      `INSERT INTO public.property_tasks(property_id,created_by,title)
       VALUES($1,$2,'Call personal broker') RETURNING id`,
      [ids.personalTransferProperty, ids.owner],
    );
    await asUser(ids.owner, "SELECT id FROM public.set_property_next_action($1,true)", [
      task.rows[0].id,
    ]);

    await expectDenied(
      asUser(
        ids.member,
        "SELECT public.transfer_personal_property_to_workspace($1,$2,'Unauthorized move')",
        [ids.personalTransferProperty, ids.workspace],
      ),
    );
    const transfer = await asUser<{ target_id: string }>(
      ids.owner,
      `SELECT public.transfer_personal_property_to_workspace(
         $1,$2,'Move the full research graph for team review'
       ) AS target_id`,
      [ids.personalTransferProperty, ids.workspace],
    );
    const targetId = transfer.rows[0].target_id;
    expect(targetId).not.toBe(ids.personalTransferProperty);

    expect(
      (
        await asUser(ids.owner, "SELECT id FROM public.properties WHERE id=$1", [
          ids.personalTransferProperty,
        ])
      ).rowCount,
    ).toBe(0);
    const graph = await asUser<{
      project_property: string;
      project_workspace: string;
      case_property: string;
      case_workspace: string;
      document_property: string;
    }>(
      ids.member,
      `SELECT project.property_id AS project_property,
         project.workspace_id AS project_workspace,
         permit_case.property_id AS case_property,
         permit_case.workspace_id AS case_workspace,
         document.property_id AS document_property
       FROM public.projects project
       JOIN public.permit_cases permit_case ON permit_case.project_id=project.id
       JOIN public.documents document ON document.permit_case_id=permit_case.id
       WHERE project.id=$1`,
      [ids.personalTransferProject],
    );
    expect(graph.rows[0]).toEqual({
      project_property: targetId,
      project_workspace: ids.workspace,
      case_property: targetId,
      case_workspace: ids.workspace,
      document_property: targetId,
    });
    expect(
      (
        await asUser(
          ids.member,
          `SELECT task.id FROM public.property_tasks task
           WHERE task.property_id=$1 AND task.title='Call personal broker'
             AND task.is_next_action`,
          [targetId],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.member,
          `SELECT contact.id FROM public.property_contacts link
           JOIN public.relationship_contacts contact ON contact.id=link.contact_id
           WHERE link.property_id=$1 AND contact.workspace_id=$2
             AND contact.full_name='Personal Broker'`,
          [targetId, ids.workspace],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.member,
          `SELECT id FROM public.property_activity_events
           WHERE property_id=$1 AND event_type='property_workspace_transferred'
             AND reason='Move the full research graph for team review'`,
          [targetId],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.member,
          "SELECT id FROM public.search_properties($1,'five-year acquisition',NULL,NULL,NULL,NULL,false,50)",
          [ids.workspace],
        )
      ).rowCount,
    ).toBe(1);
  });

  test("explicit case-to-deal linking moves the case graph onto one canonical property", async () => {
    await asUser(
      ids.owner,
      `INSERT INTO public.properties(id,owner_id,workspace_id,address_line_1,municipality)
       VALUES
         ($1,$2,$3,'10 Case Property','Vancouver'),
         ($4,$2,$3,'20 Deal Property','Vancouver')`,
      [ids.property, ids.owner, ids.workspace, ids.otherProperty],
    );
    await asUser(ids.admin, "UPDATE public.projects SET property_id=$1 WHERE id=$2", [
      ids.otherProperty,
      ids.project,
    ]);
    await asUser(ids.member, "UPDATE public.permit_cases SET property_id=$1 WHERE id=$2", [
      ids.property,
      ids.permitCase,
    ]);
    const before = await asUser<{ row_version: string }>(
      ids.member,
      "SELECT row_version FROM public.permit_cases WHERE id=$1",
      [ids.permitCase],
    );
    await asUser(ids.member, "SELECT id FROM public.set_permit_case_project($1,$2,$3,$4)", [
      ids.permitCase,
      Number(before.rows[0].row_version),
      "Link to underwriting deal",
      ids.project,
    ]);
    const linked = await asUser<{ project_id: string; property_id: string }>(
      ids.viewer,
      "SELECT project_id,property_id FROM public.permit_cases WHERE id=$1",
      [ids.permitCase],
    );
    expect(linked.rows[0]).toEqual({
      project_id: ids.project,
      property_id: ids.otherProperty,
    });
    expect(
      (
        await asUser<{ project_id: string }>(
          ids.viewer,
          "SELECT project_id FROM public.project_permits WHERE id=$1",
          [ids.permit],
        )
      ).rows[0].project_id,
    ).toBe(ids.project);
    expect(
      (
        await asUser<{ project_id: string; property_id: string }>(
          ids.viewer,
          "SELECT project_id,property_id FROM public.documents WHERE id=$1",
          [ids.document],
        )
      ).rows[0],
    ).toEqual({ project_id: ids.project, property_id: ids.otherProperty });
  });

  test("personal permit cases are private, archived instead of erased, and restorable", async () => {
    await expectDenied(
      asUser(
        ids.owner,
        `INSERT INTO public.permit_cases(owner_id,name,archived_at,archived_by,archive_reason)
         VALUES($1,'Spoofed archive',now(),$1,'bypass')`,
        [ids.owner],
      ),
    );
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
    await expectDenied(
      asUser(
        ids.owner,
        "UPDATE public.permit_cases SET archived_at=now(),archived_by=$2,archive_reason='bypass' WHERE id=$1 RETURNING id",
        [id, ids.owner],
      ),
    );
    await expectDenied(
      asUser(ids.owner, "DELETE FROM public.permit_cases WHERE id=$1 RETURNING id", [id]),
    );
    const archived = await asUser<{ archived_at: string }>(
      ids.owner,
      "SELECT archived_at FROM public.set_permit_case_archived($1,true,'Work paused')",
      [id],
    );
    expect(archived.rows[0].archived_at).toBeTruthy();
    expect(
      (
        await asUser(
          ids.owner,
          "UPDATE public.permit_cases SET notes='should stay frozen' WHERE id=$1 RETURNING id",
          [id],
        )
      ).rowCount,
    ).toBe(0);
    const restored = await asUser<{ archived_at: string | null }>(
      ids.owner,
      "SELECT archived_at FROM public.set_permit_case_archived($1,false,'Work resumed')",
      [id],
    );
    expect(restored.rows[0].archived_at).toBeNull();
    const history = await asUser<{ action: string }>(
      ids.owner,
      "SELECT action FROM public.permit_case_history WHERE case_id=$1 AND action IN ('case_archived','case_restored') ORDER BY changed_at",
      [id],
    );
    expect(history.rows.map((row) => row.action)).toEqual(["case_archived", "case_restored"]);
  });

  test("catalogue generation is atomic, retry-safe, scope-conservative, and write-authorized", async () => {
    await client.query(
      `INSERT INTO public.permit_rules(
         id,jurisdiction_id,name,permit_type,description,official_source_url,
         source_title,source_text,required_documents,application_url,
         effective_date,review_date,rule_version,verification_status,
         authority_scope,freshness_status,official_source_status
       )
       SELECT $1,j.id,'Electrical review fixture','electrical',
         'Fixture catalogue evidence.','https://vancouver.ca/electrical',
         'Electrical permits','Raw municipal source evidence.',
         '["Electrical plan","Panel schedule","Electrical plan"]'::jsonb,
         'https://vancouver.ca/electrical','2026-07-01','2099-07-01',
         '2099-07-01-fixture','verified','municipal','current','official'
       FROM public.jurisdictions j
       WHERE j.name='City of Vancouver' AND j.province='British Columbia'`,
      [ids.catalogueRule],
    );
    await asUser(
      ids.member,
      `UPDATE public.permit_cases
       SET work_type='renovation',work_categories=ARRAY['Electrical']::text[]
       WHERE id=$1`,
      [ids.permitCase],
    );

    const sql = `SELECT (
      public.generate_permit_catalogue_candidates('permit_case',$1::uuid)->>'created'
    )::integer AS created`;
    const concurrent = await Promise.all([
      asConcurrentUser<{ created: number }>(ids.member, sql, [ids.permitCase]),
      asConcurrentUser<{ created: number }>(ids.member, sql, [ids.permitCase]),
    ]);
    expect(concurrent.map((result) => result.rows[0].created).sort()).toEqual([0, 1]);

    const permits = await asUser<{
      permit_rule_id: string;
      applicability_status: string;
      is_required: boolean | null;
      confidence_band: string;
      catalogue_rule_version: string;
      snapshot_source: string;
    }>(
      ids.viewer,
      `SELECT permit_rule_id,applicability_status,is_required,confidence_band,
         catalogue_rule_version,catalogue_rule_snapshot->>'source_text' AS snapshot_source
       FROM public.project_permits
       WHERE case_id=$1 AND catalogue_rule_snapshot IS NOT NULL`,
      [ids.permitCase],
    );
    expect(permits.rows).toEqual([
      expect.objectContaining({
        permit_rule_id: ids.catalogueRule,
        applicability_status: "unknown",
        is_required: null,
        confidence_band: "scope_signalled",
        catalogue_rule_version: "2099-07-01-fixture",
        snapshot_source: "Raw municipal source evidence.",
      }),
    ]);
    const paperwork = await asUser<{
      name: string;
      is_required: boolean | null;
      applicability_state: string;
    }>(
      ids.viewer,
      `SELECT requirement.name,requirement.is_required,requirement.applicability_state
       FROM public.permit_requirements requirement
       JOIN public.project_permits permit ON permit.id=requirement.project_permit_id
       WHERE permit.case_id=$1 AND permit.permit_rule_id=$2
       ORDER BY requirement.name`,
      [ids.permitCase, ids.catalogueRule],
    );
    expect(paperwork.rows).toEqual([
      { name: "Electrical plan", is_required: null, applicability_state: "unresolved" },
      { name: "Panel schedule", is_required: null, applicability_state: "unresolved" },
    ]);
    expect(
      (await asUser<{ created: number }>(ids.member, sql, [ids.permitCase])).rows[0].created,
    ).toBe(0);
    await expectDenied(asUser(ids.viewer, sql, [ids.permitCase]));
    await expectDenied(asUser(ids.outsider, sql, [ids.permitCase]));

    await asUser(
      ids.owner,
      "SELECT id FROM public.set_permit_case_archived($1,true,'Catalogue test archive')",
      [ids.permitCase],
    );
    await expectDenied(asUser(ids.member, sql, [ids.permitCase]));
  });

  test("a linked Permit case becomes the only generation entry point without rewriting legacy evidence", async () => {
    await client.query(
      `INSERT INTO public.permit_rules(
         id,jurisdiction_id,name,permit_type,description,official_source_url,
         source_title,source_text,rule_version,verification_status,authority_scope
       )
       SELECT $1,j.id,'Building review fixture','building','Fixture catalogue evidence.',
         'https://vancouver.ca/building','Building permits','Raw building evidence.',
         '2099-07-01-fixture','verified','municipal'
       FROM public.jurisdictions j
       WHERE j.name='City of Vancouver' AND j.province='British Columbia'`,
      [ids.catalogueRule],
    );
    await asUser(
      ids.owner,
      `UPDATE public.projects
       SET municipality='Vancouver',permit_project_type='renovation',
         work_categories=ARRAY['Structural work']::text[]
       WHERE id=$1`,
      [ids.project],
    );
    const projectSql = `SELECT (
      public.generate_permit_catalogue_candidates('project',$1::uuid)->>'created'
    )::integer AS created`;
    expect(
      (await asUser<{ created: number }>(ids.owner, projectSql, [ids.project])).rows[0].created,
    ).toBe(1);
    const linkedCase = await asUser<{ id: string }>(
      ids.owner,
      `INSERT INTO public.permit_cases(
         owner_id,workspace_id,project_id,name,municipality,
         municipality_confirmed,work_type,work_categories
       ) VALUES (
         $1,$2,$3,'Linked Permit case','City of Vancouver',true,
         'renovation',ARRAY['Structural work']::text[]
       ) RETURNING id`,
      [ids.owner, ids.workspace, ids.project],
    );
    const linkedCaseId = linkedCase.rows[0].id;
    await expectDenied(asUser(ids.owner, projectSql, [ids.project]));
    expect(
      (
        await asUser(
          ids.viewer,
          `SELECT id FROM public.project_permits
           WHERE project_id=$1 AND case_id IS NULL AND permit_rule_id=$2`,
          [ids.project, ids.catalogueRule],
        )
      ).rowCount,
    ).toBe(1);
    const caseResult = await asUser<{ result: { created: number; jurisdiction: string } }>(
      ids.owner,
      "SELECT public.generate_permit_catalogue_candidates('permit_case',$1::uuid) AS result",
      [linkedCaseId],
    );
    expect(caseResult.rows[0].result).toMatchObject({
      created: 1,
      jurisdiction: "City of Vancouver",
    });
    expect(
      (
        await asUser(
          ids.viewer,
          "SELECT id FROM public.project_permits WHERE case_id=$1 AND permit_rule_id=$2",
          [linkedCaseId, ids.catalogueRule],
        )
      ).rowCount,
    ).toBe(1);
  });

  test("removed members immediately lose permit-case access", async () => {
    const revokedPath = `${ids.member}/pending/${ids.revokedDocument}/revoked.pdf`;
    await client.query(
      `INSERT INTO public.documents(id,owner_id,permit_case_id,name,storage_path)
       VALUES($1,$2,$3,'revoked.pdf',$4)`,
      [ids.revokedDocument, ids.member, ids.permitCase, revokedPath],
    );
    await client.query(
      `INSERT INTO storage.objects(bucket_id,name)
       VALUES('documents',$1) ON CONFLICT (bucket_id,name) DO NOTHING`,
      [revokedPath],
    );
    await asUser(
      ids.member,
      `INSERT INTO public.extraction_jobs(
         id,owner_id,document_id,kind,idempotency_key,result_json
       ) VALUES($1,$2,$3,'document_analysis','revocation-fixture','{"summary":"private"}')`,
      [ids.revokedJob, ids.member, ids.revokedDocument],
    );
    expect(
      (await asUser(ids.member, "SELECT id FROM public.permit_cases WHERE id=$1", [ids.permitCase]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(ids.member, "SELECT id FROM public.documents WHERE id=$1", [
          ids.revokedDocument,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(ids.member, "SELECT id FROM public.extraction_jobs WHERE id=$1", [
          ids.revokedJob,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (await asUser(ids.member, "SELECT id FROM storage.objects WHERE name=$1", [revokedPath]))
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
    expect(
      (
        await asUser(ids.member, "SELECT id FROM public.documents WHERE id=$1", [
          ids.revokedDocument,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await asUser(ids.member, "SELECT result_json FROM public.extraction_jobs WHERE id=$1", [
          ids.revokedJob,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await asUser(ids.member, "SELECT id FROM storage.objects WHERE name=$1", [revokedPath]))
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
    const requirement = await asUser<{ id: string }>(
      ids.owner,
      "INSERT INTO public.permit_requirements(project_permit_id,name) VALUES($1,'Site plan') RETURNING id",
      [ids.permit],
    );
    expect(
      (
        await asUser(
          ids.viewer,
          "DELETE FROM public.permit_requirements WHERE id=$1 RETURNING id",
          [requirement.rows[0].id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await asUser(
          ids.viewer,
          "DELETE FROM public.permit_documents WHERE permit_id=$1 AND document_id=$2 RETURNING permit_id",
          [ids.permit, ids.document],
        )
      ).rowCount,
    ).toBe(0);
    await expectDenied(
      asUser(ids.viewer, "DELETE FROM public.project_permits WHERE id=$1 RETURNING id", [
        ids.permit,
      ]),
    );
    await expectDenied(
      asUser(ids.member, "DELETE FROM public.project_permits WHERE id=$1 RETURNING id", [
        ids.permit,
      ]),
    );
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
       VALUES ($1, $2, 'assumption_extraction', 'mem-key-1') RETURNING id`,
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
         VALUES ($1, $2, 'assumption_extraction', 'viewer-key-1')`,
        [ids.project, ids.viewer],
      ),
    );

    await expectDenied(
      asUser(
        ids.outsider,
        `INSERT INTO public.extraction_jobs (owner_id, document_id, kind, idempotency_key)
         VALUES ($1, $2, 'document_analysis', 'cross-tenant-document')`,
        [ids.outsider, ids.document],
      ),
    );

    const collaboratorJob = await asUser<{ permit_case_id: string; project_id: string | null }>(
      ids.member,
      `INSERT INTO public.extraction_jobs (owner_id, document_id, kind, idempotency_key)
       VALUES ($1, $2, 'document_analysis', 'case-document-member')
       RETURNING permit_case_id,project_id`,
      [ids.member, ids.document],
    );
    expect(collaboratorJob.rows[0]).toMatchObject({
      permit_case_id: ids.permitCase,
      project_id: null,
    });
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
    expect(
      (
        await asUser<{ allowed: boolean }>(
          ids.member,
          "SELECT public.document_parent_write_access($1,NULL) AS allowed",
          [ids.project],
        )
      ).rows[0].allowed,
    ).toBe(true);
    expect(
      (
        await asUser(ids.member, "SELECT id FROM public.pending_document_uploads WHERE id=$1", [
          pending.upload_id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser<{ allowed: boolean }>(
          ids.member,
          "SELECT public.pending_upload_storage_insert_access($1) AS allowed",
          [pending.object_path],
        )
      ).rows[0].allowed,
    ).toBe(true);

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

  test("document Permit candidates are service-written, readable by viewers, and reviewed atomically", async () => {
    const candidate = await client.query<{ id: string }>(
      `INSERT INTO public.permit_extraction_candidates
       (permit_case_id,owner_id,document_id,candidate_name,permit_type,source_location,source_text,extraction_version)
       VALUES ($1,$2,$3,'Electrical approval','electrical','page 2','Electrical panel replacement','test-case-v1')
       RETURNING id`,
      [ids.permitCase, ids.owner, ids.document],
    );

    expect(
      (
        await asUser(ids.viewer, "SELECT id FROM public.permit_extraction_candidates WHERE id=$1", [
          candidate.rows[0].id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await asUser(
          ids.outsider,
          "SELECT id FROM public.permit_extraction_candidates WHERE id=$1",
          [candidate.rows[0].id],
        )
      ).rowCount,
    ).toBe(0);

    await expectDenied(
      asUser(
        ids.owner,
        `INSERT INTO public.permit_extraction_candidates
         (permit_case_id,owner_id,document_id,candidate_name,source_location,source_text,extraction_version)
         VALUES ($1,$2,$3,'Forged candidate','page 9','forged','forged-v1')`,
        [ids.permitCase, ids.owner, ids.document],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        "UPDATE public.permit_extraction_candidates SET review_status='accepted' WHERE id=$1",
        [candidate.rows[0].id],
      ),
    );
    await expectDenied(
      asUser(
        ids.member,
        "SELECT public.record_permit_research_candidates($1,'case',$2,'[]'::jsonb)",
        [ids.document, ids.member],
      ),
    );

    const reviewed = await asUser<{ project_permit_id: string }>(
      ids.member,
      "SELECT project_permit_id FROM public.review_permit_extraction_candidate($1,'accepted','Panel work needs authority review')",
      [candidate.rows[0].id],
    );
    expect(reviewed.rows[0].project_permit_id).toBeTruthy();
    expect(
      (
        await asUser(
          ids.member,
          "SELECT id FROM public.project_permits WHERE id=$1 AND applicability_status='needs_review'",
          [reviewed.rows[0].project_permit_id],
        )
      ).rowCount,
    ).toBe(1);
    await expectDenied(
      asUser(
        ids.viewer,
        "SELECT * FROM public.review_permit_extraction_candidate($1,'rejected','Viewer decision')",
        [candidate.rows[0].id],
      ),
    );
  });

  test("concurrent reviews create at most one case Permit per categorized approval", async () => {
    const candidates = await client.query<{ id: string }>(
      `INSERT INTO public.permit_extraction_candidates
       (permit_case_id,owner_id,document_id,candidate_name,permit_type,source_location,source_text,extraction_version)
       VALUES
         ($1,$2,$3,'Plumbing approval A','plumbing','page 3','New water service','concurrency-v1'),
         ($1,$2,$3,'Plumbing approval B','plumbing','page 4','New plumbing fixtures','concurrency-v1')
       RETURNING id`,
      [ids.permitCase, ids.owner, ids.document],
    );

    const results = await Promise.all([
      asConcurrentUser(
        ids.owner,
        "SELECT * FROM public.review_permit_extraction_candidate($1,'accepted','First sourced clue')",
        [candidates.rows[0].id],
      ),
      asConcurrentUser(
        ids.member,
        "SELECT * FROM public.review_permit_extraction_candidate($1,'accepted','Second sourced clue')",
        [candidates.rows[1].id],
      ),
    ]);
    expect(results.every((result) => result.rowCount === 1)).toBe(true);
    const permits = await client.query(
      "SELECT id FROM public.project_permits WHERE case_id=$1 AND permit_type='plumbing'",
      [ids.permitCase],
    );
    expect(permits.rowCount).toBe(1);
  });
});
