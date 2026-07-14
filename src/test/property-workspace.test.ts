import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("canonical property workspace backend contract", () => {
  const foundation = read("supabase/migrations/20260712000400_canonical_property_workspace.sql");
  const propagation = read("supabase/migrations/20260712000500_property_link_propagation.sql");
  const taskIntegrity = read("supabase/migrations/20260712000600_property_task_integrity.sql");
  const hardening = read("supabase/migrations/20260712000800_property_production_hardening.sql");
  const gapClosure = read(
    "supabase/migrations/20260714000100_close_catalogue_search_and_property_upload_gaps.sql",
  );
  const functions = read("src/lib/properties.functions.ts");

  test("defines one tenant-scoped property record and shared workflow children", () => {
    for (const table of [
      "public.properties",
      "public.property_urls",
      "public.property_contacts",
      "public.property_tasks",
      "public.property_activity_events",
    ]) {
      expect(foundation).toContain(`CREATE TABLE ${table}`);
    }
    expect(foundation).toContain("CREATE POLICY properties_select");
    expect(foundation).toContain("public.property_write_access");
    expect(foundation).toContain("GRANT SELECT ON public.property_activity_events");
    expect(foundation).not.toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_activity_events",
    );
  });

  test("keeps personal search personal while searching related workspace context", () => {
    expect(hardening).toContain("CREATE TABLE public.property_search_documents");
    expect(hardening).toContain("property_search_documents_text_trgm_idx");
    expect(hardening).toContain("CREATE OR REPLACE FUNCTION public.search_properties");
    expect(hardening).toContain("p_workspace_id IS NULL AND property.workspace_id IS NULL");
    expect(hardening).toContain("CREATE OR REPLACE FUNCTION public.property_search_match_scopes");
    expect(hardening).toContain("CREATE OR REPLACE FUNCTION public.list_property_activity");
    expect(hardening).toContain("'history',gen_random_uuid()::text");
  });

  test("never promotes a generic project market into a fake street property", () => {
    expect(propagation).toContain("v_address := nullif(trim(NEW.property_address), '')");
    expect(propagation).not.toContain(
      "coalesce(nullif(trim(NEW.property_address), ''), nullif(trim(NEW.location), ''))",
    );
    expect(foundation).toContain("WHERE nullif(trim(p.property_address), '') IS NOT NULL");
  });

  test("preserves provider metadata, apartment identity, and document inheritance", () => {
    expect(foundation).toContain("'openstreetmap'");
    expect(foundation).toContain("p.address_line_2, p.municipality");
    expect(foundation).toContain("p.address_place_id, p.latitude, p.longitude");
    expect(propagation).toContain("v_unit_key");
    expect(propagation).toContain("CREATE OR REPLACE FUNCTION public.inherit_document_property");
    expect(propagation).toContain("CREATE OR REPLACE FUNCTION public.propagate_parent_property");
    expect(propagation).toContain("Linked records require an explicit property move operation");
    expect(hardening).toContain("p.address_region AS region,p.postal_code");
    expect(hardening).toContain("trim(p_provider_place_id)");
    expect(hardening).toContain("properties_workspace_identity_unique");
    expect(hardening).toContain("canonical_property_region");
  });

  test("retains institutional property records and keeps parent projections coherent", () => {
    expect(hardening).toContain("workspaces_created_by_fkey");
    expect(hardening).toContain("ON DELETE RESTRICT");
    expect(hardening).toContain("project_permits_owner_id_fkey");
    expect(hardening).toContain("bind_extraction_job_to_permit_case");
    expect(hardening).toContain("protect_project_permit_identity");
    expect(hardening).toContain("validate_canonical_property_projection");
    expect(hardening).toContain("project_canonical_property_address");
    expect(hardening).toContain("transfer_permit_case_to_workspace");
    expect(hardening).toContain("set_permit_case_project");
  });

  test("makes next actions atomic and keeps task assignees inside the tenant", () => {
    expect(hardening).toContain("CREATE OR REPLACE FUNCTION public.set_property_next_action");
    expect(hardening).toContain("property_next_action_authorizations");
    expect(hardening).toContain("agir:property-next-action:");
    expect(hardening).toContain("SET is_next_action=false");
    expect(taskIntegrity).toContain("Task assignee must belong to the property workspace");
    expect(taskIntegrity).toContain("NEW.assigned_to = v_property.owner_id");
  });

  test("exports the stable server-function surface used by Property routes", () => {
    for (const exportedFunction of [
      "listProperties",
      "listPropertyActivity",
      "getProperty",
      "saveProperty",
      "archiveProperty",
      "savePropertyTask",
      "transferPersonalProperty",
      "listPropertyTasks",
      "addPropertyLink",
      "linkPropertyContact",
      "linkPropertyProject",
      "linkPropertyPermitCase",
      "linkPropertyDocument",
    ]) {
      expect(functions).toContain(`export const ${exportedFunction}`);
    }
    expect(functions).toContain('"openstreetmap"');
    expect(functions).toContain('.is("property_id", null)');
    expect(functions).toContain("canonicalPermitMunicipality");
    expect(functions).toContain('rpc("property_search_match_scopes"');
    expect(functions).toContain('rpc("list_property_activity"');
  });

  test("paginates the complete catalogue and authorizes direct property files", () => {
    expect(gapClosure).toContain("CREATE FUNCTION public.search_properties_page");
    expect(gapClosure).toContain("p_before_updated_at timestamptz DEFAULT NULL");
    expect(gapClosure).toContain("(property.updated_at,property.id)<");
    expect(gapClosure).toContain(
      "CREATE OR REPLACE FUNCTION public.prepare_property_document_upload",
    );
    expect(gapClosure).toContain("property_id uuid REFERENCES public.properties");
    expect(gapClosure).toContain("v_upload.property_id");
    expect(functions).toContain("next_cursor");
  });
});
