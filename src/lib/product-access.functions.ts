import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingFunction, isMissingRelation } from "./db-compat";

export type ProductAccess = {
  permitsAccess: boolean;
  underwritingPreview: boolean;
  pilotStatus: string;
  configured: boolean;
};

export const getProductAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProductAccess> => {
    const result = await context.supabase.rpc("current_product_access" as never);
    if (isMissingFunction(result.error) || isMissingRelation(result.error)) {
      return {
        permitsAccess: true,
        underwritingPreview: false,
        pilotStatus: "access_migration_required",
        configured: false,
      };
    }
    if (result.error) throw new Error(result.error.message);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const permitsEnabled = process.env.PERMITS_ENABLED !== "false";
    return {
      permitsAccess: permitsEnabled && Boolean((row as any)?.permits_access),
      underwritingPreview: Boolean((row as any)?.underwriting_preview),
      pilotStatus: String((row as any)?.pilot_status ?? "not_enrolled"),
      configured: true,
    };
  });
