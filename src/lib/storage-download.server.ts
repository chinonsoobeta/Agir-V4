import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getServiceRoleClient } from "@/integrations/supabase/service-role.server";

export async function downloadDocumentBlob(
  authenticatedSupabase: SupabaseClient<Database>,
  storagePath: string,
) {
  const primary = await authenticatedSupabase.storage.from("documents").download(storagePath);
  if (!primary.error && primary.data) return primary;

  let serviceSupabase: SupabaseClient<Database>;
  try {
    serviceSupabase = getServiceRoleClient("document_storage_recovery");
  } catch {
    return primary;
  }
  const fallback = await serviceSupabase.storage.from("documents").download(storagePath);
  return fallback.error || !fallback.data ? primary : fallback;
}
