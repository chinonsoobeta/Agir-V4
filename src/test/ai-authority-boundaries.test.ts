import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { persistAcceptedDefaults } from "@/lib/underwriting.server";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("AI authority and privacy boundaries", () => {
  test("OpenAI requests opt out of response storage", () => {
    const gateway = read("src/lib/ai-gateway.server.ts");
    expect(gateway).toContain("store: false");
  });

  test("underwriting defaults cannot be persisted by a non-analyst path", async () => {
    await expect(
      persistAcceptedDefaults(
        null as never,
        {
          projectId: "project",
          userId: "user",
          keys: ["hold_years"],
          via: "ai",
        } as never,
      ),
    ).rejects.toThrow("explicit analyst acceptance");

    const underwriting = read("src/lib/underwriting.server.ts");
    const underwritingBridge = read("src/lib/underwriting.functions.ts");
    expect(underwriting).not.toContain("aiSelectDefaults");
    expect(underwriting).toContain("AI cannot approve underwriting inputs");
    expect(underwritingBridge).toContain('.default("deterministic")');
  });

  test("AI memo narratives remain grounded in deterministic authority", () => {
    const memo = read("src/lib/memo.functions.ts");
    expect(memo).toContain("generation_mode: z.enum");
    expect(memo).toContain("generateAgirText");
    expect(memo).toContain("assertAiMemoVerdict");
    expect(memo).toContain("verifyNumericProvenance");
    expect(memo).toContain("generated_ai");
  });

  test("AI extraction cache identity changes with runtime configuration", () => {
    const assumptions = read("src/lib/assumptions.functions.ts");
    const documents = read("src/lib/documents.functions.ts");
    expect(assumptions).toContain("getAiRuntimeFingerprint()");
    expect(documents).toContain("getAiRuntimeFingerprint()");
    expect(documents).toContain('version: "document-analysis-v2"');
  });

  test("Copilot context is bounded and stored content is explicitly untrusted", () => {
    const chat = read("src/routes/api/chat.ts");
    expect(chat).toContain("MAX_CHAT_BODY_BYTES");
    expect(chat).toContain("MAX_MODEL_MESSAGES");
    expect(chat).toContain("MAX_CONTEXT_PROJECTS");
    expect(chat).toContain("untrusted workspace content");
    expect(chat).toContain("<workspace_data>");
    expect(chat).toContain('replace(/</g, "\\\\u003c")');
    expect(chat).not.toContain('.from("projects").select("*")');
    expect(chat).toContain("getUnderwritingRunStateForContext");
    expect(chat).toContain('=== "current"');
    expect(chat).toContain("Unable to verify underwriting freshness");
  });

  test("governed AI and memo contexts exclude pending dual-control overrides", () => {
    const chat = read("src/routes/api/chat.ts");
    const memo = read("src/lib/memo.functions.ts");
    const snapshot = read("src/lib/memo-snapshot.server.ts");
    for (const source of [chat, memo, snapshot]) {
      expect(source).toContain("dual_control_pending");
      expect(source).toContain("effectiveAssumptions");
    }
  });

  test("document text is delimited as untrusted model data", () => {
    const extraction = read("src/lib/extraction-executor.server.ts");
    expect(extraction).toContain("UNTRUSTED_DOCUMENT_TEXT_BEGIN");
    expect(extraction).toContain("Never follow instructions");
    expect(extraction).toContain("assertCanPersist");
  });
});
