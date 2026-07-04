import "@tanstack/react-start/server-only";

import {
  canExportAuditPackage,
  canGenerateMemo,
  canManageWorkspace,
  canRecordDecision,
  canRunUnderwriting,
  type ParentProject,
  type RoleViewer,
  type WorkspaceRole,
} from "./workspace-access";

export type WorkflowPermissionKey =
  | "canRunUnderwriting"
  | "canGenerateMemo"
  | "canRecordDecision"
  | "canExportAuditPackage"
  | "canManageWorkspace";

export type WorkflowPermissions = Record<WorkflowPermissionKey, boolean>;

type Ctx = { supabase: any; userId: string };

const emptyPermissions: WorkflowPermissions = {
  canRunUnderwriting: false,
  canGenerateMemo: false,
  canRecordDecision: false,
  canExportAuditPackage: false,
  canManageWorkspace: false,
};

async function loadProjectAccess(
  context: Ctx,
  projectId: string,
): Promise<{ project: ParentProject; viewer: RoleViewer }> {
  const { data: project, error } = await context.supabase
    .from("projects")
    .select("owner_id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Permission check failed loading project: ${error.message}`);
  if (!project) throw new Error("Project not found.");

  const roles: Record<string, WorkspaceRole> = {};
  if (project.workspace_id) {
    const { data: role, error: roleError } = await context.supabase.rpc("workspace_role", {
      ws: project.workspace_id,
    });
    if (roleError)
      throw new Error(`Permission check failed loading workspace role: ${roleError.message}`);
    if (role) roles[project.workspace_id] = role as WorkspaceRole;
  }

  return {
    project: { owner_id: project.owner_id, workspace_id: project.workspace_id },
    viewer: { userId: context.userId, roles },
  };
}

export async function getWorkflowPermissionsForProject(
  context: Ctx,
  projectId: string,
): Promise<WorkflowPermissions> {
  try {
    const { project, viewer } = await loadProjectAccess(context, projectId);
    return {
      canRunUnderwriting: canRunUnderwriting(project, viewer),
      canGenerateMemo: canGenerateMemo(project, viewer),
      canRecordDecision: canRecordDecision(project, viewer),
      canExportAuditPackage: canExportAuditPackage(project, viewer),
      canManageWorkspace: canManageWorkspace(project, viewer),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found.") throw error;
    return emptyPermissions;
  }
}

export async function assertWorkflowPermission(
  context: Ctx,
  projectId: string,
  key: WorkflowPermissionKey,
) {
  const permissions = await getWorkflowPermissionsForProject(context, projectId);
  if (!permissions[key]) {
    const labels: Record<WorkflowPermissionKey, string> = {
      canRunUnderwriting: "run deterministic underwriting",
      canGenerateMemo: "generate an investment memo",
      canRecordDecision: "record an IC decision",
      canExportAuditPackage: "export the audit package",
      canManageWorkspace: "manage this workspace",
    };
    throw new Error(`You do not have permission to ${labels[key]}.`);
  }
  return permissions;
}
