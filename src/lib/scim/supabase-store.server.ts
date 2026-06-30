// Supabase-backed SCIM store for a single workspace. Maps the SCIM user model
// onto this app's real membership model:
//   - identity/email lives on `profiles`; membership + role on `workspace_members`.
//   - there is no `active` column, so SCIM deactivate == remove the membership
//     (deprovision). Reactivate re-inserts on the next PATCH/PUT with active=true.
//   - CREATE requires the user to already exist in `profiles` (just-in-time
//     provisioned by SSO at first login); otherwise we return a clear 400 so the
//     IdP retries after the user authenticates. Owner role is never assignable.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ScimParseError, type ProvisionedMember, type ParsedScimUser } from "./scim";
import type { ScimStore } from "./handler";

const toMember = (
  memberId: string,
  email: string,
  role: ProvisionedMember["role"],
  externalId: string | null,
  fullName: string | null,
  createdAt: string | null,
): ProvisionedMember => ({
  id: memberId,
  email: email.toLowerCase(),
  externalId,
  role,
  active: true,
  displayName: fullName,
  createdAt,
});

export function createSupabaseScimStore(workspaceId: string): ScimStore {
  const db = supabaseAdmin;

  async function profileByEmail(email: string) {
    const { data } = await db
      .from("profiles")
      .select("id, email, full_name")
      .ilike("email", email)
      .maybeSingle();
    return data ?? null;
  }

  return {
    async list() {
      const { data: members } = await db
        .from("workspace_members")
        .select("id, user_id, role, created_at")
        .eq("workspace_id", workspaceId);
      if (!members?.length) return [];
      const ids = members.map((m) => m.user_id);
      const { data: profiles } = await db
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ids);
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return members
        .map((m) => {
          const p = byId.get(m.user_id);
          if (!p?.email) return null;
          return toMember(m.id, p.email, m.role, null, p.full_name, m.created_at);
        })
        .filter((m): m is ProvisionedMember => m !== null);
    },

    async findByEmail(email) {
      const profile = await profileByEmail(email);
      if (!profile) return null;
      const { data: member } = await db
        .from("workspace_members")
        .select("id, role, created_at")
        .eq("workspace_id", workspaceId)
        .eq("user_id", profile.id)
        .maybeSingle();
      if (!member) return null;
      return toMember(
        member.id,
        profile.email ?? email,
        member.role,
        null,
        profile.full_name,
        member.created_at,
      );
    },

    async getById(id) {
      const { data: member } = await db
        .from("workspace_members")
        .select("id, user_id, role, created_at")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (!member) return null;
      const { data: profile } = await db
        .from("profiles")
        .select("email, full_name")
        .eq("id", member.user_id)
        .maybeSingle();
      if (!profile?.email) return null;
      return toMember(
        member.id,
        profile.email,
        member.role,
        null,
        profile.full_name,
        member.created_at,
      );
    },

    async create(parsed: ParsedScimUser) {
      const profile = await profileByEmail(parsed.email);
      if (!profile) {
        throw new ScimParseError(
          "User must sign in via SSO at least once before SCIM can provision their workspace membership.",
        );
      }
      const { data: member, error } = await db
        .from("workspace_members")
        .insert({ workspace_id: workspaceId, user_id: profile.id, role: parsed.role })
        .select("id, created_at")
        .single();
      if (error) throw new Error(error.message);
      return toMember(
        member.id,
        parsed.email,
        parsed.role,
        parsed.externalId ?? null,
        profile.full_name,
        member.created_at,
      );
    },

    async update(id, patch) {
      // Deactivate -> deprovision (remove the membership row).
      if (patch.active === false) {
        await db.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("id", id);
        const existing = await this.getById(id);
        return existing
          ? { ...existing, active: false }
          : { id, email: "", role: patch.role ?? "viewer", active: false };
      }
      if (patch.role) {
        await db
          .from("workspace_members")
          .update({ role: patch.role })
          .eq("workspace_id", workspaceId)
          .eq("id", id);
      }
      return this.getById(id);
    },

    async remove(id) {
      const { error } = await db
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      return !error;
    },
  };
}
