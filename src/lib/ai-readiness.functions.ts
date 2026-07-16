import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AiProvider, AiProviderPolicy } from "./config.server";

export type AiReadiness = {
  enabledByDefault: true;
  configured: boolean;
  provider: AiProvider | null;
  providerPolicy: AiProviderPolicy;
  fallbackEnabled: boolean;
  model: string | null;
  keyEnv: "ANTHROPIC_API_KEY or OPENAI_API_KEY";
  providers: Record<AiProvider, { configured: boolean; model: string }>;
  features: {
    extraction: boolean;
    underwriting: boolean;
    memoGeneration: boolean;
    copilot: boolean;
  };
};

export const getAiReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<AiReadiness> => {
    const { getAiReadinessDiagnostics } = await import("./ai-gateway.server");
    const readiness = getAiReadinessDiagnostics();

    return {
      enabledByDefault: true,
      configured: readiness.configured,
      provider: readiness.activeProvider,
      providerPolicy: readiness.policy,
      fallbackEnabled: readiness.fallbackEnabled,
      model: readiness.activeModel,
      keyEnv: "ANTHROPIC_API_KEY or OPENAI_API_KEY",
      providers: readiness.providers,
      features: {
        extraction: readiness.configured,
        // AI never approves underwriting inputs. Memo narrative is optional
        // and is gated against the deterministic verdict and numeric evidence.
        underwriting: false,
        memoGeneration: readiness.configured,
        copilot: readiness.configured,
      },
    };
  });
