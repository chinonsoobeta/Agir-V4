import { createAnthropic } from "@ai-sdk/anthropic";

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

// Single source of truth for "can we use AI right now?". Every AI-by-default
// feature gates on this and silently falls back to the deterministic path when
// it returns false (no key configured), so a missing key is never an error.
export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAgirModel(modelName = process.env.AGIR_AI_MODEL || DEFAULT_AI_MODEL) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  return createAnthropic({ apiKey })(modelName);
}

