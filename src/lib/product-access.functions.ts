import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductAccess = {
  permitsAccess: boolean;
  underwritingPreview: boolean;
  pilotStatus: string;
  configured: boolean;
};

export const getProductAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ProductAccess> => {
    const permitsEnabled = process.env.PERMITS_ENABLED !== "false";
    return {
      permitsAccess: permitsEnabled,
      underwritingPreview: true,
      pilotStatus: "general_access",
      configured: true,
    };
  });
