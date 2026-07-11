import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { seedPackageAndOpen } from "./seed-helpers";

function admin() {
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service credentials for staged-upload E2E.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

test("browser upload is server-authorized, scanned, and finalized before it is usable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedPackageAndOpen(page, "Harbour Centre");
  const projectId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.getByRole("tab", { name: /documents/i }).click();
  const name = `staged-upload-${Date.now()}.pdf`;
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({
    name,
    mimeType: "application/pdf",
    // A structurally valid-enough PDF for Agir's signature gate. The optional
    // extraction phase may fail without an AI key; that must not undo a clean,
    // finalized document registration.
    buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
  });
  await expect(page.getByText(name)).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(
      async () => {
        const { data, error } = await admin()
          .from("documents")
          .select("content_hash, scan_status, storage_path")
          .eq("project_id", projectId!)
          .eq("name", name)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data;
      },
      { timeout: 60_000 },
    )
    .toMatchObject({ scan_status: "clean", content_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });

  const { data: stored } = await admin()
    .from("documents")
    .select("storage_path")
    .eq("project_id", projectId!)
    .eq("name", name)
    .single();
  expect(stored?.storage_path).toMatch(/^[0-9a-f-]+\/pending\/[0-9a-f-]+\//i);
});
