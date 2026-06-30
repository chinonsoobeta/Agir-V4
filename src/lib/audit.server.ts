type AuthContext = {
  supabase: any;
  userId: string;
};

export type AuditEventInput = {
  projectId?: string | null;
  workspaceId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  payload?: Record<string, unknown>;
};

export async function writeAuditEvent(ctx: AuthContext, event: AuditEventInput): Promise<void> {
  const row = {
    project_id: event.projectId ?? null,
    workspace_id: event.workspaceId ?? null,
    owner_id: ctx.userId,
    user_id: ctx.userId,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    action: event.action,
    payload: event.payload ?? {},
  };
  const { error } = await ctx.supabase.from("audit_logs").insert(row);
  if (error) throw new Error(error.message);
}

export async function writeSystemAuditEvent(
  supabase: any,
  row: {
    ownerId: string;
    userId: string;
    projectId?: string | null;
    workspaceId?: string | null;
    entityType: string;
    entityId?: string | null;
    action: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    project_id: row.projectId ?? null,
    workspace_id: row.workspaceId ?? null,
    owner_id: row.ownerId,
    user_id: row.userId,
    entity_type: row.entityType,
    entity_id: row.entityId ?? null,
    action: row.action,
    payload: row.payload ?? {},
  });
  if (error) throw new Error(error.message);
}
