import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Profile + roles for the Settings hub. The `profiles` table ships in the base
// schema, so these work against the live database today.

export type MyProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  roles: string[];
};

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: roleRows } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    return {
      id: context.userId,
      email: profile?.email ?? null,
      full_name: profile?.full_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      roles: (roleRows ?? []).map((r: any) => r.role),
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        full_name: z.string().max(160).nullable().optional(),
        avatar_url: z.string().url().max(500).nullable().optional().or(z.literal("")),
      })
      .parse(v),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = {};
    if (data.full_name !== undefined) patch.full_name = data.full_name || null;
    if (data.avatar_url !== undefined) patch.avatar_url = data.avatar_url || null;
    const { data: row, error } = await context.supabase
      .from("profiles")
      .update(patch as any)
      .eq("id", context.userId)
      .select("id, email, full_name, avatar_url")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
