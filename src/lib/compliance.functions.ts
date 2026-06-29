import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingColumn, isMissingRelation } from "./db-compat";
import {
  buildComplianceReadiness,
  complianceSummary,
  renderAuditExportCsv,
  type ComplianceControl,
} from "./compliance";

type ComplianceSettings = {
  workspace_id: string;
  sso_provider: string | null;
  sso_metadata_url: string | null;
  sso_enforced: boolean;
  scim_enabled: boolean;
  data_residency_region: string | null;
  dpa_status: "not_started" | "in_review" | "approved";
  tenant_encryption_mode: "platform_managed" | "per_tenant" | "customer_managed";
  audit_log_retention_days: number;
  backup_rto_hours: number;
  backup_rpo_hours: number;
  incident_severity_policy: string;
  on_call_rotation_url: string | null;
  status_page_url: string | null;
  soc2_observation_started_at: string | null;
  last_pen_test_at: string | null;
  last_dr_test_at: string | null;
};

const defaultComplianceSettings = (workspaceId: string): ComplianceSettings => ({
  workspace_id: workspaceId,
  sso_provider: null,
  sso_metadata_url: null,
  sso_enforced: false,
  scim_enabled: false,
  data_residency_region: null,
  dpa_status: "not_started",
  tenant_encryption_mode: "platform_managed",
  audit_log_retention_days: 2555,
  backup_rto_hours: 24,
  backup_rpo_hours: 24,
  incident_severity_policy: "docs/ops/incident-response.md",
  on_call_rotation_url: null,
  status_page_url: null,
  soc2_observation_started_at: null,
  last_pen_test_at: null,
  last_dr_test_at: null,
});

async function workspaceRole(supabase: any, workspaceId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("workspace_role", { ws: workspaceId });
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function requireWorkspaceAdmin(supabase: any, workspaceId: string) {
  const role = await workspaceRole(supabase, workspaceId);
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only workspace owners and admins can manage compliance settings.");
  }
}

async function auditWorkspaceEvent(
  context: any,
  workspaceId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  await context.supabase.from("audit_logs").insert({
    workspace_id: workspaceId,
    project_id: null,
    owner_id: context.userId,
    user_id: context.userId,
    entity_type: "workspace_compliance",
    entity_id: workspaceId,
    action,
    payload,
  });
}

function normalizeSettings(row: any, workspaceId: string): ComplianceSettings {
  const defaults = defaultComplianceSettings(workspaceId);
  return {
    ...defaults,
    ...Object.fromEntries(Object.entries(row ?? {}).filter(([, value]) => value !== undefined)),
    dpa_status: row?.dpa_status ?? defaults.dpa_status,
    tenant_encryption_mode: row?.tenant_encryption_mode ?? defaults.tenant_encryption_mode,
    incident_severity_policy: row?.incident_severity_policy ?? defaults.incident_severity_policy,
  };
}

function readinessFromSettings(settings: ComplianceSettings): ComplianceControl[] {
  return buildComplianceReadiness({
    rolePermissionUi: true,
    ssoSamlConfigured: Boolean(settings.sso_provider && settings.sso_metadata_url),
    scimConfigured: settings.scim_enabled,
    auditLogExport: true,
    dataGovernanceWorkflow: true,
    incidentRunbook: Boolean(settings.incident_severity_policy),
    onCallRotation: Boolean(settings.on_call_rotation_url && settings.status_page_url),
    disasterRecoveryDrill: Boolean(settings.last_dr_test_at),
    dpaApproved: settings.dpa_status === "approved",
    tenantEncryptionAvailable: settings.tenant_encryption_mode !== "platform_managed",
    soc2ObservationStarted: Boolean(settings.soc2_observation_started_at),
    penTestCompleted: Boolean(settings.last_pen_test_at),
  });
}

export const getWorkspaceCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ workspace_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", data.workspace_id)
      .maybeSingle();
    if (isMissingRelation(error) || isMissingColumn(error)) {
      const settings = defaultComplianceSettings(data.workspace_id);
      const controls = readinessFromSettings(settings);
      return { settings, controls, summary: complianceSummary(controls), available: false };
    }
    if (error) throw new Error(error.message);
    const settings = normalizeSettings(row, data.workspace_id);
    const controls = readinessFromSettings(settings);
    return { settings, controls, summary: complianceSummary(controls), available: true };
  });

const complianceSaveSchema = z.object({
  workspace_id: z.string().uuid(),
  sso_provider: z.string().trim().max(120).nullable(),
  sso_metadata_url: z.string().trim().url().max(1000).nullable().or(z.literal("")),
  sso_enforced: z.boolean(),
  scim_enabled: z.boolean(),
  data_residency_region: z.string().trim().max(80).nullable().or(z.literal("")),
  dpa_status: z.enum(["not_started", "in_review", "approved"]),
  tenant_encryption_mode: z.enum(["platform_managed", "per_tenant", "customer_managed"]),
  audit_log_retention_days: z.number().int().min(365).max(36500),
  backup_rto_hours: z.number().int().min(1).max(168),
  backup_rpo_hours: z.number().int().min(1).max(168),
  incident_severity_policy: z.string().trim().max(500),
  on_call_rotation_url: z.string().trim().url().max(1000).nullable().or(z.literal("")),
  status_page_url: z.string().trim().url().max(1000).nullable().or(z.literal("")),
  soc2_observation_started_at: z.string().nullable(),
  last_pen_test_at: z.string().nullable(),
  last_dr_test_at: z.string().nullable(),
});

export const saveWorkspaceCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => complianceSaveSchema.parse(value))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await requireWorkspaceAdmin(supabase, data.workspace_id);
    const payload = {
      ...data,
      sso_metadata_url: data.sso_metadata_url || null,
      data_residency_region: data.data_residency_region || null,
      on_call_rotation_url: data.on_call_rotation_url || null,
      status_page_url: data.status_page_url || null,
    };
    const { data: row, error } = await supabase
      .from("workspace_settings")
      .upsert(payload, { onConflict: "workspace_id" })
      .select()
      .single();
    if (isMissingColumn(error)) {
      throw new Error("Compliance settings need the latest database migration to be applied.");
    }
    if (error) throw new Error(error.message);
    await auditWorkspaceEvent(context, data.workspace_id, "compliance_settings_updated", {
      sso_provider: payload.sso_provider,
      scim_enabled: payload.scim_enabled,
      dpa_status: payload.dpa_status,
      tenant_encryption_mode: payload.tenant_encryption_mode,
    });
    const settings = normalizeSettings(row, data.workspace_id);
    const controls = readinessFromSettings(settings);
    return { settings, controls, summary: complianceSummary(controls) };
  });

export const exportWorkspaceAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        limit: z.number().int().min(1).max(5000).default(1000),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await requireWorkspaceAdmin(supabase, data.workspace_id);
    const { data: projects, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("workspace_id", data.workspace_id);
    if (projectError) throw new Error(projectError.message);
    const projectIds = (projects ?? []).map((project: any) => project.id);
    const projectAudit =
      projectIds.length > 0
        ? await supabase
            .from("audit_logs")
            .select(
              "id,created_at,workspace_id,project_id,user_id,entity_type,entity_id,action,payload",
            )
            .in("project_id", projectIds)
            .order("created_at", { ascending: false })
            .limit(data.limit)
        : { data: [], error: null };
    if (isMissingColumn(projectAudit.error)) {
      throw new Error("Audit export needs the latest database migration to be applied.");
    }
    if (projectAudit.error) throw new Error(projectAudit.error.message);
    const { data: workspaceAudit, error: workspaceAuditError } = await supabase
      .from("audit_logs")
      .select("id,created_at,workspace_id,project_id,user_id,entity_type,entity_id,action,payload")
      .eq("workspace_id", data.workspace_id)
      .is("project_id", null)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (isMissingColumn(workspaceAuditError)) {
      throw new Error("Audit export needs the latest database migration to be applied.");
    }
    if (workspaceAuditError) throw new Error(workspaceAuditError.message);
    const events = [...(workspaceAudit ?? []), ...(projectAudit.data ?? [])]
      .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, data.limit);
    await auditWorkspaceEvent(context, data.workspace_id, "audit_log_exported", {
      rows: events.length,
    });
    return {
      filename: `agir-audit-log-${data.workspace_id}.csv`,
      contentType: "text/csv",
      rowCount: events.length,
      csv: renderAuditExportCsv(events),
    };
  });

const governanceRequestSchema = z.object({
  workspace_id: z.string().uuid(),
  request_type: z.enum([
    "data_export",
    "deletion",
    "retention_exception",
    "dpa_review",
    "audit_export",
    "residency_review",
  ]),
  subject: z.string().trim().min(1).max(240),
  reason: z.string().trim().max(4000).nullable().or(z.literal("")),
});

export const createDataGovernanceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => governanceRequestSchema.parse(value))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const role = await workspaceRole(supabase, data.workspace_id);
    if (!role) throw new Error("You must be a workspace member to create a data request.");
    const { data: row, error } = await supabase
      .from("data_governance_requests")
      .insert({
        workspace_id: data.workspace_id,
        requester_id: context.userId,
        request_type: data.request_type,
        subject: data.subject,
        reason: data.reason || null,
      })
      .select()
      .single();
    if (isMissingRelation(error)) {
      throw new Error("Data governance requests need the latest database migration.");
    }
    if (error) throw new Error(error.message);
    await auditWorkspaceEvent(context, data.workspace_id, "data_governance_request_created", {
      request_type: data.request_type,
      request_id: row.id,
    });
    return row;
  });

export const listDataGovernanceRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => z.object({ workspace_id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("data_governance_requests")
      .select("*")
      .eq("workspace_id", data.workspace_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
