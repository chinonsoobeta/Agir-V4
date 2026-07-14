import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { seedPackageAndOpen } from "./seed-helpers";

function adminClient() {
  const fileEnv = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith("#"))
          .map((line) => line.split("=", 2)),
      )
    : {};
  const url = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Permit E2E requires Supabase service credentials.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test("municipality candidates, checklist, and document picker work end to end", async ({
  page,
}) => {
  await seedPackageAndOpen(page, "Harbour Centre");
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  expect(projectId).toBeTruthy();
  const admin = adminClient();
  const profile = await admin
    .from("projects")
    .update({
      property_address: "Vancouver, BC",
      municipality: "City of Vancouver",
      permit_project_type: "renovation",
      property_type: "industrial",
      project_description: "E2E permit workflow fixture",
    })
    .eq("id", projectId!);
  if (profile.error) throw new Error(profile.error.message);

  await page.waitForLoadState("networkidle");
  await page.goto(page.url(), { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Permits" }).click();
  await expect(page.getByRole("heading", { name: "Permits" })).toBeVisible();
  await expect(page.getByText("No permit records match this view")).toBeVisible();
  await page.getByRole("button", { name: /generate municipality candidates/i }).click();
  await expect(page.getByText(/Created \d+ review candidates for City of Vancouver/)).toBeVisible();
  await expect(page.getByText("Building permit", { exact: true })).toBeVisible();

  await page.getByText("Building permit", { exact: true }).click();
  const panel = page.locator("div.fixed.inset-y-0");
  await expect(panel).toHaveCount(1);
  await expect(
    panel.getByText("Timeline not available from the source yet.", { exact: true }),
  ).toBeVisible();
  await panel.getByPlaceholder("Paperwork name").fill("Signed application form");
  await panel.getByRole("button", { name: "Add paperwork" }).click();
  await expect(panel.getByText("Signed application form", { exact: true })).toBeVisible();

  const documentPicker = panel.getByRole("combobox").filter({ hasText: "Choose project document" });
  if ((await documentPicker.count()) === 1) {
    await documentPicker.click();
    const options = page.getByRole("option");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);
    const option = options.first();
    await option.click();
    await panel.getByRole("button", { name: "Link", exact: true }).click();
    await expect(panel.getByLabel(/Download /)).toBeVisible();
  }
});
