import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isMissingRelation } from "./db-compat";

// Workspaces / teams. Every endpoint is migration-safe: when the workspace
// tables have not been applied yet, we degrade to a single synthetic "Personal
// workspace" so the UI keeps working in single-tenant mode. Membership and
// creation go through SECURITY DEFINER RPCs so RLS never recurses.

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type Workspace = {
  id: string;
  name: string;
  role: WorkspaceRole;
  /** True for the fallback workspace when the schema is not yet migrated. */
  personal?: boolean;
};

export type WorkspaceMember = {
  id: string;
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  full_name: string | null;
  created_at: string;
  /** The current user (for "you" labelling / self-protection in the UI). */
  isSelf: boolean;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: string;
  created_at: string;
  expires_at: string;
  /** Acceptance token: visible to workspace admins so they can share the link. */
  token: string | null;
};

export const PERSONAL_WORKSPACE_ID = "personal";
const personalWorkspace = (): Workspace => ({
  id: PERSONAL_WORKSPACE_ID,
  name: "Personal workspace",
  role: "owner",
  personal: true,
});

const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);

async function requireWorkspaceAdminForMember(
  supabase: any,
  memberId: string,
  newRole?: WorkspaceRole,
): Promise<{ id: string; workspace_id: string; role: WorkspaceRole; user_id: string }> {
  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, role, user_id")
    .eq("id", memberId)
    .single();
  if (isMissingRelation(memberError)) {
    throw new Error("Workspaces need the latest database migration to be applied.");
  }
  if (memberError) throw new Error(memberError.message);
  const { data: callerRole, error: roleError } = await supabase.rpc("workspace_role", {
    ws: member.workspace_id,
  });
  if (roleError) throw new Error(roleError.message);
  if (callerRole !== "owner" && callerRole !== "admin") {
    throw new Error("Only workspace owners and admins can manage members.");
  }
  // Owner protection: only an OWNER may demote/remove an existing owner or grant
  // ownership. Without this an admin could demote the owner to viewer (or promote
  // themselves to owner) and seize the workspace. Mirrored in the database by the
  // prevent_last_workspace_owner_removal trigger (defense in depth).
  if ((member.role === "owner" || newRole === "owner") && callerRole !== "owner") {
    throw new Error("Only a workspace owner can manage another owner or grant ownership.");
  }
  return member;
}

function assertSingleMutation(rows: unknown[] | null | undefined, action: string) {
  if ((rows ?? []).length !== 1) {
    throw new Error(`${action} changed ${(rows ?? []).length} rows; expected exactly one.`);
  }
}

export const listMyWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Workspace[]> => {
    const supabase = context.supabase as any;
    const { data, error } = await supabase
      .from("workspace_members")
      .select("role, workspaces(id, name)")
      .eq("user_id", context.userId);
    if (isMissingRelation(error)) return [personalWorkspace()];
    if (error) throw new Error(error.message);
    const list: Workspace[] = (data ?? [])
      .filter((m: any) => m.workspaces)
      .map((m: any) => ({ id: m.workspaces.id, name: m.workspaces.name, role: m.role }));
    // Always give the user at least the personal context.
    return list.length ? list : [personalWorkspace()];
  });

export const createWorkspace = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ name: z.string().min(1).max(120) }).parse(v))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<Workspace> => {
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase.rpc("create_workspace", { p_name: data.name });
    if (isMissingRelation(error) || error?.code === "PGRST202") {
      throw new Error("Workspaces need the latest database migration to be applied.");
    }
    if (error) throw new Error(error.message);
    const ws = Array.isArray(row) ? row[0] : row;
    return { id: ws.id, name: ws.name, role: "owner" };
  });

export const listWorkspaceMembers = createServerFn({ method: "GET" })
  .validator((v: unknown) => z.object({ workspace_id: z.string() }).parse(v))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<WorkspaceMember[]> => {
    const supabase = context.supabase as any;
    // Personal / unmigrated: just the current user as owner.
    if (data.workspace_id === PERSONAL_WORKSPACE_ID) {
      const { data: me } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", context.userId)
        .maybeSingle();
      return [
        {
          id: context.userId,
          user_id: context.userId,
          role: "owner",
          email: me?.email ?? null,
          full_name: me?.full_name ?? null,
          created_at: new Date(0).toISOString(),
          isSelf: true,
        },
      ];
    }
    const { data: members, error } = await supabase
      .from("workspace_members")
      .select("id, user_id, role, created_at")
      .eq("workspace_id", data.workspace_id)
      .order("created_at", { ascending: true });
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    const ids = (members ?? []).map((m: any) => m.user_id);
    const profiles = new Map<string, { email: string | null; full_name: string | null }>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ids);
      for (const p of profs ?? []) profiles.set(p.id, { email: p.email, full_name: p.full_name });
    }
    return (members ?? []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      email: profiles.get(m.user_id)?.email ?? null,
      full_name: profiles.get(m.user_id)?.full_name ?? null,
      created_at: m.created_at,
      isSelf: m.user_id === context.userId,
    }));
  });

export const listWorkspaceInvitations = createServerFn({ method: "GET" })
  .validator((v: unknown) => z.object({ workspace_id: z.string() }).parse(v))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<WorkspaceInvitation[]> => {
    if (data.workspace_id === PERSONAL_WORKSPACE_ID) return [];
    const supabase = context.supabase as any;
    const { data: rows, error } = await supabase
      .from("workspace_invitations")
      .select("id, email, role, status, created_at, expires_at, token")
      .eq("workspace_id", data.workspace_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (isMissingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const inviteWorkspaceMember = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        email: z.string().email().max(200),
        role: roleSchema,
      })
      .parse(v),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<WorkspaceInvitation> => {
    const supabase = context.supabase as any;
    const { data: governance, error: governanceError } = await supabase
      .from("workspace_settings")
      .select("allowed_email_domains")
      .eq("workspace_id", data.workspace_id)
      .maybeSingle();
    if (!isMissingRelation(governanceError) && governanceError) {
      throw new Error(governanceError.message);
    }
    const allowedDomains = (governance?.allowed_email_domains ?? []) as string[];
    const inviteDomain = data.email.toLowerCase().split("@")[1] ?? "";
    if (allowedDomains.length && !allowedDomains.includes(inviteDomain)) {
      throw new Error(
        `Invitations are restricted to: ${allowedDomains.map((domain) => `@${domain}`).join(", ")}`,
      );
    }
    const { data: row, error } = await supabase
      .from("workspace_invitations")
      .insert({
        workspace_id: data.workspace_id,
        email: data.email.toLowerCase(),
        role: data.role,
        invited_by: context.userId,
      })
      .select("id, email, role, status, created_at, expires_at, token")
      .single();
    if (isMissingRelation(error))
      throw new Error("Workspaces need the latest database migration to be applied.");
    if (error) throw new Error(error.message);
    return row;
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ member_id: z.string().uuid(), role: roleSchema }).parse(v))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await requireWorkspaceAdminForMember(supabase, data.member_id, data.role);
    const { data: rows, error } = await supabase
      .from("workspace_members")
      .update({ role: data.role })
      .eq("id", data.member_id)
      .select("id");
    if (error) throw new Error(error.message);
    assertSingleMutation(rows, "Updating a workspace member");
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ member_id: z.string().uuid() }).parse(v))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    await requireWorkspaceAdminForMember(supabase, data.member_id);
    const { data: rows, error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("id", data.member_id)
      .select("id");
    if (error) throw new Error(error.message);
    assertSingleMutation(rows, "Removing a workspace member");
    return { ok: true };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ token: z.string().min(8) }).parse(v))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const { data: row, error } = await supabase.rpc("accept_workspace_invitation", {
      p_token: data.token,
    });
    if (isMissingRelation(error) || error?.code === "PGRST202") {
      throw new Error("Workspaces need the latest database migration to be applied.");
    }
    if (error) throw new Error(error.message);
    return Array.isArray(row) ? row[0] : row;
  });
