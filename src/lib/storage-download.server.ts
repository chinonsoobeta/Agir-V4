import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function downloadDocumentBlob(
  authenticatedSupabase: SupabaseClient<Database>,
  storagePath: string,
) {
  const primary = await authenticatedSupabase.storage.from("documents").download(storagePath);
  if (!primary.error && primary.data) return primary;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return primary;

  const serviceSupabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fallback = await serviceSupabase.storage.from("documents").download(storagePath);
  return fallback.error || !fallback.data ? primary : fallback;
}
