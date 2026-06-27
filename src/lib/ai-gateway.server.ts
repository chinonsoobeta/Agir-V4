import { createAnthropic } from "@ai-sdk/anthropic";

export const DEFAULT_AI_MODEL = "claude-sonnet-4-6";

// Returns a usable Anthropic key, or null if the env var is missing or malformed.
// The key is sent as the `x-api-key` HTTP header, which must be a ByteString
// (every char code <= 255). A pasted placeholder, prose, or a key containing
// smart quotes / em-dashes (e.g. code 8212) would otherwise crash fetch with
// "Cannot convert argument to a ByteString". Anthropic keys are ASCII and
// start with "sk-", so we validate shape here and treat anything else as
// "no key" → clean deterministic fallback instead of a runtime error.
export function getValidatedAnthropicKey(): string | null {
  // Try API_KEY first (user-provided), then fall back to ANTHROPIC_API_KEY (integration).
  const raw = process.env.API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!raw) return null;
  const key = raw.trim();
  if (!key) return null;
  // Must be header-safe (no code point > 255) and look like an Anthropic key.
  if (!/^[\x21-\x7E]+$/.test(key)) return null; // printable ASCII, no spaces
  if (!key.startsWith("sk-")) return null; // sk-ant-..., sk-abcdef1..., etc.
  return key;
}

// Single source of truth for "can we use AI right now?". Every AI-by-default
// feature gates on this and silently falls back to the deterministic path when
// it returns false (missing or malformed key), so a bad key is never a crash.
export function hasAnthropicKey(): boolean {
  return getValidatedAnthropicKey() !== null;
}

export function getAgirModel(modelName = process.env.AGIR_AI_MODEL || DEFAULT_AI_MODEL) {
  const apiKey = getValidatedAnthropicKey();
  if (!apiKey)
    throw new Error(
      "Missing or malformed API_KEY/ANTHROPIC_API_KEY (expected an ASCII key starting with 'sk-')",
    );
  return createAnthropic({ apiKey })(modelName);
}
