// Pure simulation of the additive owner + workspace-member RLS pattern used by
// every collaborative table (see supabase/migrations/*operating_depth* and
// *harden_workspace_isolation*). The Postgres policies remain the real
// enforcement; this mirror lets the access RULE be unit-tested for two-tenant
// isolation without a live database (the test job has no Postgres).
//
// Policy shape (per table):
//   USING      owner_id = auth.uid()
//              OR (workspace_id IS NOT NULL AND is_workspace_member(workspace_id))
//   WITH CHECK owner_id = auth.uid()
//              AND (workspace_id IS NULL OR is_workspace_member(workspace_id))

export type TenantRow = { owner_id: string; workspace_id: string | null };
export type Viewer = { userId: string; workspaceIds: string[] };

const isMember = (workspaceId: string | null, viewer: Viewer): boolean =>
  workspaceId != null && viewer.workspaceIds.includes(workspaceId);

// USING: may the viewer read / act on an existing row?
export function canAccessRow(row: TenantRow, viewer: Viewer): boolean {
  return row.owner_id === viewer.userId || isMember(row.workspace_id, viewer);
}

// WITH CHECK: may the viewer create / update the row in this shape? The viewer
// must own it AND (if it is shared) belong to the workspace it is stamped with,
// so a row can never be pushed into a workspace the viewer is not a member of.
export function canWriteRow(row: TenantRow, viewer: Viewer): boolean {
  return (
    row.owner_id === viewer.userId &&
    (row.workspace_id == null || isMember(row.workspace_id, viewer))
  );
}

// ---------------------------------------------------------------------------
// ROLE-AWARE mirror of the workspace write-hardening policies
// (supabase/migrations/20260626000100_workspace_rls_write_hardening.sql and
// 20260626000200_ic_governance_rls_hardening.sql). Unlike the owner+member
// pattern above (still used by owner-scoped tables), the deal-child and
// governance tables grant READ to every member but WRITE only to non-viewer
// roles, and reserve project UPDATE/DELETE for owner/admin. This lets the role
// matrix be unit-tested without a live Postgres; the SQL policies remain the
// real enforcement.

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";
export type FirmRole = "analyst" | "associate" | "vp" | "ic_member" | "admin" | "auditor";
// The caller's role per workspace they belong to (absent => not a member).
export type RoleViewer = { userId: string; roles: Record<string, WorkspaceRole> };
// A parent project a deal-child / governance row hangs off.
export type ParentProject = { owner_id: string; workspace_id: string | null };

// Roles permitted to WRITE collaborative rows: every member except a viewer.
const WRITE_ROLES: ReadonlySet<WorkspaceRole> = new Set(["owner", "admin", "member"]);
// Roles permitted to manage the project itself (UPDATE/DELETE) and members.
const ADMIN_ROLES: ReadonlySet<WorkspaceRole> = new Set(["owner", "admin"]);

export const FIRM_ROLE_WORKSPACE_ROLE: Record<FirmRole, WorkspaceRole> = {
  analyst: "member",
  associate: "member",
  vp: "admin",
  ic_member: "member",
  admin: "admin",
  auditor: "viewer",
};

export function workspaceRole(
  workspaceId: string | null,
  viewer: RoleViewer,
): WorkspaceRole | null {
  if (workspaceId == null) return null;
  return viewer.roles[workspaceId] ?? null;
}

const isRoleMember = (workspaceId: string | null, viewer: RoleViewer): boolean =>
  workspaceRole(workspaceId, viewer) != null;

// SELECT on a deal-child row: any member of the parent's workspace, or the
// owner of a personal (workspace-less) project.
export function canReadDealChild(parent: ParentProject, viewer: RoleViewer): boolean {
  if (parent.workspace_id == null) return parent.owner_id === viewer.userId;
  return isRoleMember(parent.workspace_id, viewer);
}

// INSERT/UPDATE/DELETE on a deal-child row: a non-viewer collaborator on the
// parent's workspace, or the owner of a personal project. Viewers are read-only.
export function canWriteDealChild(parent: ParentProject, viewer: RoleViewer): boolean {
  if (parent.workspace_id == null) return parent.owner_id === viewer.userId;
  const role = workspaceRole(parent.workspace_id, viewer);
  return role != null && WRITE_ROLES.has(role);
}

// UPDATE/DELETE on the project itself: owner/admin only (a plain member may edit
// deal-child rows but not delete the deal); a personal project is owner-only.
export function canManageProject(project: ParentProject, viewer: RoleViewer): boolean {
  if (project.workspace_id == null) return project.owner_id === viewer.userId;
  const role = workspaceRole(project.workspace_id, viewer);
  return role != null && ADMIN_ROLES.has(role);
}

export function canRunUnderwriting(parent: ParentProject, viewer: RoleViewer): boolean {
  return canWriteDealChild(parent, viewer);
}

export function canGenerateMemo(parent: ParentProject, viewer: RoleViewer): boolean {
  return canWriteDealChild(parent, viewer);
}

export function canRecordDecision(parent: ParentProject, viewer: RoleViewer): boolean {
  return canWriteDealChild(parent, viewer);
}

export function canReviewAssumptions(parent: ParentProject, viewer: RoleViewer): boolean {
  return canWriteDealChild(parent, viewer);
}

export function canExportAuditPackage(parent: ParentProject, viewer: RoleViewer): boolean {
  return canReadDealChild(parent, viewer);
}

export function canManageWorkspace(project: ParentProject, viewer: RoleViewer): boolean {
  return canManageProject(project, viewer);
}

// Casting an IC vote: a non-viewer collaborator may write only their OWN vote.
export function canCastIcVote(
  parent: ParentProject,
  voteOwnerId: string,
  viewer: RoleViewer,
): boolean {
  return voteOwnerId === viewer.userId && canWriteDealChild(parent, viewer);
}

// Satisfying/waiving an IC condition: any non-viewer collaborator on the deal.
export function canWriteIcCondition(parent: ParentProject, viewer: RoleViewer): boolean {
  return canWriteDealChild(parent, viewer);
}

// Managing a member (mirror of requireWorkspaceAdminForMember + the
// prevent_last_workspace_owner_removal trigger): the caller must be owner/admin,
// and only an OWNER may act on an existing owner or grant ownership.
export function canManageMember(
  callerRole: WorkspaceRole | null,
  targetRole: WorkspaceRole,
  newRole?: WorkspaceRole,
): boolean {
  if (callerRole == null || !ADMIN_ROLES.has(callerRole)) return false;
  if ((targetRole === "owner" || newRole === "owner") && callerRole !== "owner") return false;
  return true;
}
