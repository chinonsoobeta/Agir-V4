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
