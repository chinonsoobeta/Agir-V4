import { afterEach, describe, expect, test } from "vitest";
import { getValidatedAnthropicKey, hasAnthropicKey } from "@/lib/ai-gateway.server";

const originalApiKey = process.env.API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (originalApiKey == null) delete process.env.API_KEY;
  else process.env.API_KEY = originalApiKey;
  if (originalAnthropicKey == null) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

describe("AI gateway readiness", () => {
  test("treats missing keys as unavailable instead of throwing", () => {
    delete process.env.API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    expect(getValidatedAnthropicKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
  });

  test("accepts a server-side Anthropic-style key", () => {
    delete process.env.API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid123";

    expect(getValidatedAnthropicKey()).toBe("sk-ant-test-valid123");
    expect(hasAnthropicKey()).toBe(true);
  });

  test("prefers API_KEY and falls back past malformed placeholders", () => {
    process.env.API_KEY = "sk-direct-test-valid456";
    process.env.ANTHROPIC_API_KEY = "not-a-key";

    expect(getValidatedAnthropicKey()).toBe("sk-direct-test-valid456");

    process.env.API_KEY = "paste key here";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-valid789";

    expect(getValidatedAnthropicKey()).toBe("sk-ant-test-valid789");
    expect(hasAnthropicKey()).toBe(true);
  });

  test("rejects non-ASCII header-unsafe values", () => {
    process.env.API_KEY = "sk-ant-test\u2014bad";
    delete process.env.ANTHROPIC_API_KEY;

    expect(getValidatedAnthropicKey()).toBeNull();
    expect(hasAnthropicKey()).toBe(false);
  });
});
