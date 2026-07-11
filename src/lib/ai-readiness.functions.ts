import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_AI_MODEL, hasAnthropicKey } from "./ai-gateway.server";

export type AiReadiness = {
  enabledByDefault: true;
  configured: boolean;
  model: string;
  keyEnv: "API_KEY or ANTHROPIC_API_KEY";
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
    const configured = hasAnthropicKey();
    const { readServerConfig } = await import("./config.server");

    return {
      enabledByDefault: true,
      configured,
      model: readServerConfig().aiModel || DEFAULT_AI_MODEL,
      keyEnv: "API_KEY or ANTHROPIC_API_KEY",
      features: {
        extraction: true,
        underwriting: true,
        memoGeneration: true,
        copilot: true,
      },
    };
  });
