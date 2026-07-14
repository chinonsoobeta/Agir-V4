import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type ModelMessage } from "ai";
import { createHash } from "node:crypto";
import {
  readServerConfig,
  type AiProvider,
  type AiProviderPolicy,
  type ServerConfig,
} from "./config.server";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
export const AI_RUNTIME_CACHE_VERSION = "2026-07-13-v1";
/** Compatibility alias for callers that previously assumed Anthropic. */
export const DEFAULT_AI_MODEL = DEFAULT_ANTHROPIC_MODEL;

type ProviderCandidate = {
  provider: AiProvider;
  model: string;
  apiKey: string;
};

export type AiGenerationProvenance = {
  provider: AiProvider;
  model: string;
  attemptedProviders: AiProvider[];
  fallbackUsed: boolean;
};

export type AiReadinessDiagnostics = {
  configured: boolean;
  policy: AiProviderPolicy;
  fallbackEnabled: boolean;
  activeProvider: AiProvider | null;
  activeModel: string | null;
  providers: Record<AiProvider, { configured: boolean; model: string }>;
  providerOrder: AiProvider[];
};

type GenerateAgirTextOptions = {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  endUserId?: string;
};

function safetyIdentifier(endUserId: string | undefined): string | undefined {
  if (!endUserId) return undefined;
  return `agir_${createHash("sha256").update(endUserId).digest("hex").slice(0, 32)}`;
}

function validServerKey(raw: string | undefined): string | null {
  const key = raw?.trim();
  if (!key) return null;
  // Provider keys are HTTP-header values. Reject placeholders, whitespace and
  // non-ASCII characters before they can reach fetch and crash a worker.
  if (!/^[\x21-\x7e]+$/.test(key) || !key.startsWith("sk-")) return null;
  return key;
}

export function getValidatedAnthropicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const raw of readServerConfig(env).anthropicApiKeyCandidates) {
    const key = validServerKey(raw);
    if (key) return key;
  }
  return null;
}

export function getValidatedOpenAiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return validServerKey(readServerConfig(env).openAiApiKey);
}

/** Backwards-compatible readiness helper. New features should use hasAiProvider. */
export function hasAnthropicKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return getValidatedAnthropicKey(env) !== null;
}

export function hasOpenAiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return getValidatedOpenAiKey(env) !== null;
}

function providerOrder(config: ServerConfig): AiProvider[] {
  const preferred: AiProvider = config.aiProviderPolicy === "openai" ? "openai" : "anthropic";
  return config.aiProviderFallback
    ? [preferred, preferred === "anthropic" ? "openai" : "anthropic"]
    : [preferred];
}

function providerCandidates(env: NodeJS.ProcessEnv = process.env): ProviderCandidate[] {
  const config = readServerConfig(env);
  const keys: Record<AiProvider, string | null> = {
    anthropic: getValidatedAnthropicKey(env),
    openai: getValidatedOpenAiKey(env),
  };
  const models: Record<AiProvider, string> = {
    anthropic: config.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
    openai: config.openAiModel || DEFAULT_OPENAI_MODEL,
  };
  return providerOrder(config).flatMap((provider) => {
    const apiKey = keys[provider];
    return apiKey ? [{ provider, model: models[provider], apiKey }] : [];
  });
}

/**
 * Opaque cache profile for billing-relevant AI work. It changes when provider
 * order, model selection, or a server credential changes, but never exposes a
 * credential (or a reversible fragment of one) in a job key or diagnostic.
 */
export function getAiRuntimeFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  const config = readServerConfig(env);
  const profile = providerCandidates(env).map((candidate) => ({
    provider: candidate.provider,
    model: candidate.model,
    credential: createHash("sha256").update(candidate.apiKey).digest("hex"),
  }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: AI_RUNTIME_CACHE_VERSION,
        policy: config.aiProviderPolicy,
        fallback: config.aiProviderFallback,
        profile,
      }),
    )
    .digest("hex");
}

export function getAiReadinessDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
): AiReadinessDiagnostics {
  const config = readServerConfig(env);
  const candidates = providerCandidates(env);
  return {
    configured: candidates.length > 0,
    policy: config.aiProviderPolicy,
    fallbackEnabled: config.aiProviderFallback,
    activeProvider: candidates[0]?.provider ?? null,
    activeModel: candidates[0]?.model ?? null,
    providers: {
      anthropic: {
        configured: hasAnthropicKey(env),
        model: config.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
      },
      openai: {
        configured: hasOpenAiKey(env),
        model: config.openAiModel || DEFAULT_OPENAI_MODEL,
      },
    },
    providerOrder: candidates.map((candidate) => candidate.provider),
  };
}

export function hasAiProvider(env: NodeJS.ProcessEnv = process.env): boolean {
  return getAiReadinessDiagnostics(env).configured;
}

function modelFor(candidate: ProviderCandidate, modelOverride?: string) {
  const model = modelOverride?.trim() || candidate.model;
  return {
    provider: candidate.provider,
    model,
    languageModel:
      candidate.provider === "anthropic"
        ? createAnthropic({ apiKey: candidate.apiKey })(model)
        : createOpenAI({ apiKey: candidate.apiKey }).responses(model),
  };
}

export function getAgirModelSelection(modelOverride?: string) {
  const candidate = providerCandidates()[0];
  if (!candidate) {
    throw new Error(
      "No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server.",
    );
  }
  return modelFor(candidate, modelOverride);
}

/** Compatibility facade for AI SDK callers that only need a language model. */
export function getAgirModel(modelOverride?: string) {
  return getAgirModelSelection(modelOverride).languageModel;
}

function safeFailureSummary(provider: AiProvider, error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : null;
  if (status === 401 || status === 403) return `${provider} rejected its server credential`;
  if (status === 429) return `${provider} is rate limited`;
  if (status != null && status >= 500) return `${provider} is temporarily unavailable`;
  if (error instanceof Error && error.name === "AbortError") return `${provider} timed out`;
  return `${provider} request failed`;
}

/**
 * Shared non-streaming provider boundary for document classification and
 * Copilot prose. It tries the configured provider order and returns safe
 * provenance; callers decide whether an outage is retryable or deterministic.
 */
export async function generateAgirText(options: GenerateAgirTextOptions) {
  const candidates = providerCandidates();
  if (!candidates.length) {
    throw new Error(
      "No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server.",
    );
  }

  const failures: string[] = [];
  const attemptedProviders: AiProvider[] = [];
  for (const candidate of candidates) {
    attemptedProviders.push(candidate.provider);
    const selection = modelFor(candidate);
    try {
      const prompt = options.messages
        ? { messages: options.messages }
        : { prompt: options.prompt ?? "" };
      const result = await generateText({
        model: selection.languageModel,
        // Provider failover is the bounded retry policy. Avoid opaque SDK
        // backoff loops that can consume the whole request/worker timeout
        // before the alternate configured provider gets a chance.
        maxRetries: 0,
        maxOutputTokens: options.maxOutputTokens ?? 2_048,
        system: options.system,
        ...prompt,
        // Current OpenAI reasoning models do not universally accept temperature.
        // Omit it there; hard authority constraints live in the prompt and the
        // deterministic validation boundary, not sampling parameters.
        ...(candidate.provider === "anthropic" && options.temperature != null
          ? { temperature: options.temperature }
          : {}),
        ...(candidate.provider === "openai"
          ? {
              providerOptions: {
                openai: {
                  // Property and investment data is confidential workspace data.
                  // Responses are stored by default unless this is explicit.
                  store: false,
                  ...(options.endUserId
                    ? { safetyIdentifier: safetyIdentifier(options.endUserId) }
                    : {}),
                },
              },
            }
          : {}),
        timeout: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
      });
      return {
        text: result.text,
        ai: {
          provider: candidate.provider,
          model: candidate.model,
          attemptedProviders: [...attemptedProviders],
          fallbackUsed: attemptedProviders.length > 1,
        } satisfies AiGenerationProvenance,
      };
    } catch (error) {
      failures.push(safeFailureSummary(candidate.provider, error));
    }
  }
  throw new Error(`AI providers unavailable: ${failures.join("; ")}.`);
}
