import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { seedPackageAndOpen } from "./seed-helpers";
import { runFullUnderwritingForContext } from "../src/lib/underwriting.server";
import { buildDealRunAuditPackageForContext } from "../src/lib/deal-audit-package.server";

function localSupabaseAdmin() {
  const fileEnv = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .trim()
          .split(/\n/)
          .filter(Boolean)
          .map((line) => line.split("=", 2)),
      )
    : {};
  const SUPABASE_URL = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for E2E admin client.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function localSupabaseUser() {
  const fileEnv = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .trim()
          .split(/\n/)
          .filter(Boolean)
          .map((line) => line.split("=", 2)),
      )
    : {};
  const url = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    fileEnv.SUPABASE_ANON_KEY ??
    fileEnv.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase browser credentials for underwriting E2E.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.E2E_EMAIL ?? "maple.heights@example.com",
    password: process.env.E2E_PASSWORD ?? "password123",
  });
  if (error) throw new Error(`E2E user sign-in failed: ${error.message}`);
  return supabase;
}

async function runDeterministicUnderwritingForProject(projectId: string) {
  const supabase = localSupabaseAdmin();
  const { data: project, error } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", projectId)
    .single();
  if (error) throw new Error(error.message);
  // Run this protected mutation as the browser identity. Admin access is only
  // used above to locate the fixture owner; using it for the mutation would
  // bypass the authenticated rate-limit/RLS path the browser actually uses.
  const result = await runFullUnderwritingForContext(
    { project_id: projectId, mode: "deterministic" },
    { supabase: await localSupabaseUser(), userId: project.owner_id },
  );
  expect(result.blocked).toBe(false);
}

async function buildAuditPackageForProject(projectId: string) {
  const supabase = localSupabaseAdmin();
  const { data: project, error } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", projectId)
    .single();
  if (error) throw new Error(error.message);
  return buildDealRunAuditPackageForContext(
    { supabase: supabase as any, userId: project.owner_id },
    projectId,
  );
}

// The critical underwriting workflow, end to end through the UI: seed a demo
// deal, then confirm the analyst-facing surfaces it produces: source
// documents and the assumption review register (including the documented
// exit-cap conflict the engine must never resolve silently).
test("seed Harbour Centre demo and review its underwriting surfaces", async ({ page }) => {
  await seedPackageAndOpen(page, "Harbour Centre");
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await expect(page.getByLabel("Deal workflow status")).toBeVisible();
  await expect(page.getByText(/documents? extracted|extraction pending/i).first()).toBeVisible();
  await expect(page.getByText(/conflicts?/i).first()).toBeVisible();
  await expect(page.getByText(/blocked|pending run/i).first()).toBeVisible();

  // Documents tab: the six bundled source documents are linked.
  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Harbour_Centre_Construction_Budget/i).first()).toBeVisible();
  await expect(page.getByText(/Harbour_Centre_Lender_Term_Sheet/i).first()).toBeVisible();

  // Assumptions tab: the review register is populated, and the exit-cap
  // conflict surfaces rather than being silently averaged.
  await page.getByRole("tab", { name: /assumptions/i }).click();
  await expect(page.getByText(/exit cap/i).first()).toBeVisible();
  await expect(page.getByText(/conflict/i).first()).toBeVisible();
});

test("professional demo workflow resolves provenance and fail-closed underwriting surfaces", async ({
  page,
}) => {
  await seedPackageAndOpen(page, "Harbour Centre");
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await expect(page.getByLabel("Deal workflow status")).toBeVisible();
  await expect(page.getByText(/IC review blocked/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Harbour_Centre_Construction_Budget/i).first()).toBeVisible();
  await expect(page.getByText(/Extracted/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /assumptions/i }).click();
  await expect(page.getByText(/Deal Readiness Score/i)).toBeVisible();
  await expect(page.getByLabel(/Assumption status summary/i)).toBeVisible();
  await expect(page.getByText(/Conflict Resolution Center/i)).toBeVisible();
  await expect(page.getByText(/Confidence/i).first()).toBeVisible();
  await expect(page.getByText(/Harbour_Centre_Lender_Term_Sheet\.pdf/i).first()).toBeVisible();

  await page
    .getByRole("button", { name: /Use conservative/i })
    .first()
    .click();
  await expect(
    page.getByText(/Updated/i).or(page.getByText(/Conflict Resolution Center/i)),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: /analysis/i }).click();
  const runLocator = page
    .getByRole("button", { name: /Run Deterministic Underwriting|Run Underwriting/i })
    .first();
  const blockedPanel = page.getByText(/Underwriting blocked/i).first();
  await expect(blockedPanel.or(runLocator)).toBeVisible({ timeout: 20_000 });
  if (await blockedPanel.isVisible().catch(() => false)) {
    const conservative = page.getByRole("button", { name: /Use conservative/i }).last();
    if (await conservative.isVisible().catch(() => false)) {
      await conservative.click();
      await expect(page.getByText(/Resolved|Updated/i).first()).toBeVisible({ timeout: 20_000 });
    }
  }

  await expect(page.getByText(/Underwriting blocked/i)).toBeVisible();
  await expect(page.getByText(/Expense ratio/i).first()).toBeVisible();
  await expect(page.getByText(/Hold period/i).first()).toBeVisible();
  await expect(page.getByText(/Selling costs/i).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Accept \d+ defaults$|^Accept defaults$/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Let AI accept defaults & run/i })).toBeVisible();
  await expect(
    page.getByText(/engine runs only on approved or default-accepted inputs/i),
  ).toBeVisible();
  await expect(runLocator).toHaveCount(0);

  await page.getByRole("tab", { name: /investment committee/i }).click();
  await expect(
    page.getByRole("heading", { name: /Underwriting blocked|Underwriting not run/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/Committee review is locked|Committee review unlocks/i),
  ).toBeVisible();
  await expect(page.getByText(/IC review blocked/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /audit/i }).click();
  await expect(page.getByText(/Audit|underwriting|assumption/i).first()).toBeVisible();
});

test("professional demo workflow completes deterministic underwriting, memo, and audit path", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedPackageAndOpen(page, "Harbour Centre");
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await expect(page.getByLabel("Deal workflow status")).toBeVisible();

  await page.getByRole("tab", { name: /documents/i }).click();
  await expect(page.getByText(/Harbour_Centre_Construction_Budget/i).first()).toBeVisible();
  await expect(page.getByText(/Harbour_Centre_Rent_Roll/i).first()).toBeVisible();
  await expect(page.getByText(/Extracted/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /assumptions/i }).click();
  await expect(page.getByText(/Deal Readiness Score/i)).toBeVisible();
  await expect(page.getByLabel(/Assumption status summary/i)).toBeVisible();
  await expect(page.getByText(/Conflict Resolution Center/i)).toBeVisible();
  await expect(page.getByText(/Confidence/i).first()).toBeVisible();
  await expect(page.getByText(/Harbour_Centre_Lender_Term_Sheet\.pdf/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /analysis/i }).click();
  await expect(page.getByText(/Underwriting blocked/i)).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("button", { name: /Use conservative/i })
    .first()
    .click();
  await expect(page.getByText(/Conflicting inputs: resolve explicitly/i)).toBeHidden({
    timeout: 20_000,
  });

  const acceptDefaults = page.getByRole("button", {
    name: /^Accept \d+ defaults$|^Accept defaults$/i,
  });
  await expect(acceptDefaults).toBeVisible({ timeout: 20_000 });
  await expect(acceptDefaults).toBeEnabled({ timeout: 20_000 });
  await acceptDefaults.click();

  const projectId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  expect(projectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await runDeterministicUnderwritingForProject(projectId!);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await page.getByRole("tab", { name: /analysis/i }).click();
  await expect(page.getByLabel(/Analysis status/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Outputs current/i).first()).toBeVisible();
  await expect(page.getByText(/Run history/i).first()).toBeVisible();
  await expect(page.getByText(/Run version v1/i).first()).toBeVisible();
  await expect(page.getByText(/Pending underwriting run/).first()).toBeHidden({
    timeout: 20_000,
  });

  await expect(
    page
      .getByText(/Recommendation (APPROVE|REJECT|RETURN_TO_UNDERWRITING)/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByText(/Exit Value/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/DSCR/i).filter({ visible: true }).first()).toBeVisible();
  await expect(
    page
      .getByText(/Debt Yield/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Equity Multiple/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/Risk Register/i)).toBeVisible();
  await expect(page.getByText(/Evidence: source documents behind these numbers/i)).toBeVisible();
  await expect(page.getByText(/Expense ratio\s*·\s*default/i).first()).toBeVisible();
  await expect(page.getByText(/Static defaults \(no document\)/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /investment committee/i }).click();
  await expect(page.getByText(/Engine Recommendation/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Investment Score/i).first()).toBeVisible();
  await expect(page.getByText(/Investment Memo/i).first()).toBeVisible();
  await page
    .getByRole("button", { name: /Generate Memo/i })
    .first()
    .click();
  await expect
    .poll(
      async () => {
        const supabase = localSupabaseAdmin();
        const { count, error } = await supabase
          .from("investment_memos")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId!);
        if (error) throw new Error(error.message);
        return count ?? 0;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await page.getByRole("tab", { name: /investment committee/i }).click();
  await expect(page.getByText(/Memo available|Memo ready/i).first()).toBeVisible();
  await expect(
    page
      .getByText(/Executive Summary|Approved Assumptions|Financial Highlights/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Run version v1/i).first()).toBeVisible();

  const supabase = localSupabaseAdmin();
  const { error: staleInputErr } = await supabase
    .from("underwriting_inputs")
    .update({ value_numeric: 36, updated_at: new Date().toISOString() })
    .eq("project_id", projectId!)
    .eq("key", "expense_ratio_pct");
  if (staleInputErr) throw new Error(staleInputErr.message);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await expect(page.getByText(/Outputs stale/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Memo stale/i).first()).toBeVisible();

  await runDeterministicUnderwritingForProject(projectId!);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await expect(page.getByText(/Outputs current/i).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /analysis/i }).click();
  await expect(page.getByText(/Run version v2/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Changed inputs/i).first()).toBeVisible();

  await page.getByRole("tab", { name: /investment committee/i }).click();
  const generateMemoAgain = page.getByRole("button", { name: /Generate Memo/i }).first();
  await expect(generateMemoAgain).toBeEnabled({ timeout: 30_000 });
  await generateMemoAgain.click();
  await expect
    .poll(
      async () => {
        const { count, error } = await supabase
          .from("investment_memos")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId!)
          .not("run_id", "is", null);
        if (error) throw new Error(error.message);
        return count ?? 0;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harbour Centre" })).toBeVisible();
  await page.getByRole("tab", { name: /investment committee/i }).click();
  await expect(page.getByText(/Memo stale/i)).toHaveCount(0);
  await page
    .getByLabel("Committee rationale")
    .fill(
      "Audit smoke approval: current run version, regenerated memo, and audit package verified.",
    );
  await page.getByRole("button", { name: "Record decision" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await expect(page.getByText(/Decision recorded/i).first()).toBeVisible({ timeout: 30_000 });

  const auditPackage = await buildAuditPackageForProject(projectId!);
  expect(auditPackage.manifest.run_id).toBeTruthy();
  expect(auditPackage.manifest.input_fingerprint).toBeTruthy();
  expect(auditPackage.manifest.counts.outputs).toBeGreaterThan(0);
  expect(auditPackage.manifest.counts.cash_flows).toBeGreaterThan(0);
  expect(auditPackage.payload.run.run_number).toBe(2);
  expect(auditPackage.payload.memo?.run_id).toBe(auditPackage.manifest.run_id);
  expect(auditPackage.payload.ic_decision?.run_id).toBe(auditPackage.manifest.run_id);
  expect(auditPackage.payload.audit_events.map((event) => event.action)).toEqual(
    expect.arrayContaining(["run_full_underwriting", "memo_generated", "ic_decision"]),
  );

  await page.getByRole("tab", { name: /audit/i }).click();
  await expect(page.getByText(/accept_defaults/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/resolve_conflict/i).first()).toBeVisible();
  await expect(page.getByText(/run_full_underwriting/i).first()).toBeVisible();
  await expect(page.getByText(/memo_generated/i).first()).toBeVisible();
  await expect(page.getByText(/ic_decision/i).first()).toBeVisible();
});
