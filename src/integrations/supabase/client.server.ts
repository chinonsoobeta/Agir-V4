import { getServiceRoleClient } from "./service-role.server";

type SupabaseAdminClient = ReturnType<typeof getServiceRoleClient>;

// Server-side Supabase client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Load inside server handlers: const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
// Top-level import is safe only in other .server.ts modules - route files and *.functions.ts ship to the client bundle.
export const supabaseAdmin = new Proxy({} as SupabaseAdminClient, {
  get(_, prop, receiver) {
    return Reflect.get(getServiceRoleClient("schema_maintenance"), prop, receiver);
  },
});
