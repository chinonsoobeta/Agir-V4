import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  generateAgirText,
  getAiReadinessDiagnostics,
  getAiRuntimeFingerprint,
  getValidatedAnthropicKey,
  getValidatedOpenAiKey,
  hasAiProvider,
  hasAnthropicKey,
  hasOpenAiKey,
} from "@/lib/ai-gateway.server";

const managedKeys = [
  "API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AGIR_AI_PROVIDER",
  "AGIR_AI_PROVIDER_FALLBACK",
  "AGIR_AI_MODEL",
  "AGIR_ANTHROPIC_MODEL",
  "AGIR_OPENAI_MODEL",
] as const;
const originals = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of managedKeys) delete process.env[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of managedKeys) {
    const value = originals[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("AI gateway readiness", () => {
  test("treats missing keys as unavailable instead of throwing", () => {
    expect(getValidatedAnthropicKey()).toBeNull();
    expect(getValidatedOpenAiKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
    expect(hasOpenAiKey()).toBe(false);
    expect(hasAiProvider()).toBe(false);
  });

  test("accepts each platform-managed provider key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid123";
    process.env.OPENAI_API_KEY = "sk-proj-test-valid456";

    expect(getValidatedAnthropicKey()).toBe("sk-ant-test-valid123");
    expect(getValidatedOpenAiKey()).toBe("sk-proj-test-valid456");
    expect(hasAiProvider()).toBe(true);
  });

  test("preserves the Anthropic compatibility alias and skips malformed placeholders", () => {
    process.env.API_KEY = "paste key here";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid789";

    expect(getValidatedAnthropicKey()).toBe("sk-ant-test-valid789");
    expect(hasAnthropicKey()).toBe(true);
  });

  test("rejects non-ASCII header-unsafe values", () => {
    process.env.API_KEY = "sk-ant-test\u2014bad";
    process.env.OPENAI_API_KEY = "sk-proj-test\u2014bad";

    expect(getValidatedAnthropicKey()).toBeNull();
    expect(getValidatedOpenAiKey()).toBeNull();
    expect(hasAiProvider()).toBe(false);
  });

  test("uses the configured provider policy and safe provider-specific model", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid123";
    process.env.OPENAI_API_KEY = "sk-proj-test-valid456";
    process.env.AGIR_AI_PROVIDER = "openai";
    process.env.AGIR_OPENAI_MODEL = "gpt-test-model";

    const diagnostics = getAiReadinessDiagnostics();
    expect(diagnostics.activeProvider).toBe("openai");
    expect(diagnostics.activeModel).toBe("gpt-test-model");
    expect(diagnostics.providerOrder).toEqual(["openai", "anthropic"]);
    expect(diagnostics.providers.anthropic.configured).toBe(true);
    expect(diagnostics.providers.openai.configured).toBe(true);
  });

  test("falls through a failed preferred provider and records identical provenance", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid123";
    process.env.OPENAI_API_KEY = "sk-proj-test-valid456";
    process.env.AGIR_AI_PROVIDER = "anthropic";
    process.env.AGIR_OPENAI_MODEL = "gpt-test-model";

    const urls: string[] = [];
    const requestBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        urls.push(url);
        requestBodies.push(String(init?.body ?? ""));
        if (url.includes("anthropic.com")) {
          return new Response(JSON.stringify({ error: { message: "temporary" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            id: "resp_test",
            object: "response",
            created_at: 1,
            status: "completed",
            model: "gpt-test-model",
            output: [
              {
                id: "msg_test",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [{ type: "output_text", text: "provider-safe text", annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 1,
              output_tokens: 2,
              total_tokens: 3,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await generateAgirText({
      prompt: "Summarize this approved context.",
      endUserId: "user-private-id",
    });
    expect(result.text).toBe("provider-safe text");
    expect(result.ai).toEqual({
      provider: "openai",
      model: "gpt-test-model",
      attemptedProviders: ["anthropic", "openai"],
      fallbackUsed: true,
    });
    expect(urls.some((url) => url.includes("anthropic.com"))).toBe(true);
    expect(urls.some((url) => url.includes("api.openai.com"))).toBe(true);
    expect(requestBodies.some((body) => body.includes('"safety_identifier":"agir_'))).toBe(true);
    expect(requestBodies.some((body) => body.includes('"store":false'))).toBe(true);
    expect(requestBodies.every((body) => !body.includes('"store":true'))).toBe(true);
    expect(requestBodies.join(" ")).not.toContain("user-private-id");
  });

  test("changes the opaque runtime fingerprint when credentials or models change", () => {
    process.env.OPENAI_API_KEY = "sk-proj-first-secret-value";
    process.env.AGIR_AI_PROVIDER = "openai";
    process.env.AGIR_AI_PROVIDER_FALLBACK = "0";
    process.env.AGIR_OPENAI_MODEL = "gpt-test-one";
    const first = getAiRuntimeFingerprint();

    process.env.OPENAI_API_KEY = "sk-proj-second-secret-value";
    const second = getAiRuntimeFingerprint();
    process.env.AGIR_OPENAI_MODEL = "gpt-test-two";
    const third = getAiRuntimeFingerprint();

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect([first, second, third].join(" ")).not.toContain("secret-value");
  });

  test("can enforce a single-provider policy without leaking credentials", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid123";
    process.env.OPENAI_API_KEY = "sk-proj-test-valid456";
    process.env.AGIR_AI_PROVIDER = "anthropic";
    process.env.AGIR_AI_PROVIDER_FALLBACK = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "bad" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    let message = "";
    try {
      await generateAgirText({ prompt: "test" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("AI providers unavailable: anthropic");
    expect(message).not.toContain("sk-ant-test-valid123");
  });
});
