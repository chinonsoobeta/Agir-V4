import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { OutputRow, AssumptionRow } from "@/lib/decision";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.replace("Bearer ", "");

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_ANON_KEY =
          process.env.SUPABASE_ANON_KEY ||
          process.env.SUPABASE_PUBLISHABLE_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        const { hasAnthropicKey } = await import("@/lib/ai-gateway.server");
        if (!hasAnthropicKey())
          return new Response("Missing or malformed ANTHROPIC_API_KEY", { status: 500 });
        if (!SUPABASE_ANON_KEY) return new Response("Missing SUPABASE_ANON_KEY", { status: 500 });

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: user } = await supabase.auth.getUser(token);
        if (!user.user) return new Response("Unauthorized", { status: 401 });

        // Deal-aware focus: when the copilot is opened from a deal, the client
        // sends X-Agir-Deal so the copilot reasons over that deal's findings,
        // scores and recommendation first.
        const focusId = request.headers.get("x-agir-deal");

        const { data: projects } = await supabase.from("projects").select("*");
        const { data: assumptions } = await supabase
          .from("assumptions")
          .select(
            "project_id,field_key,field_label,category,value_numeric,value_text,unit,status,confidence_score,source_location,source_text,source_document_id,conflict_values",
          )
          .in("status", ["approved", "modified"]);
        const { enforceRateLimit } = await import("@/lib/rate-limit.server");
        await enforceRateLimit({ supabase, userId: user.user.id }, "chat_completion", {
          metadata: { focus_id: focusId ?? null },
        });

        const { data: outputs } = await supabase
          .from("financial_outputs")
          .select(
            "project_id,scenario_key,metric_key,metric_label,value_numeric,unit,formula_text,inputs",
          );
        const { data: decisions } = await supabase
          .from("decision_logs")
          .select("project_id,decision,rationale,conditions,created_at");

        let focus = "";
        if (focusId) {
          try {
            const { buildDecision } = await import("@/lib/decision");
            const proj = (projects ?? []).find((p) => p.id === focusId);
            const o = (outputs ?? []).filter((r) => r.project_id === focusId);
            const a = (assumptions ?? []).filter((r) => r.project_id === focusId);
            const dec = buildDecision(o as unknown as OutputRow[], a as unknown as AssumptionRow[]);
            focus = `\n\n===== FOCUSED DEAL: ${proj?.name ?? focusId} =====\nRecommendation: ${dec.recommendationLabel}\nInvestment Score: ${dec.investmentScore ?? "n/a"}/100 · Confidence: ${dec.confidenceScore}/100 · Risk: ${dec.riskRating}\nStrengths: ${(dec.findings?.strengths ?? []).map((x) => x.title).join("; ") || "none"}\nRisks: ${(dec.findings?.risks ?? []).map((x) => x.title).join("; ") || "none"}\nOpportunities: ${(dec.findings?.opportunities ?? []).map((x) => x.title).join("; ") || "none"}\nApproval conditions: ${(dec.findings?.approvalConditions ?? []).map((x) => x.title).join("; ") || "none"}\nValue drivers: ${(dec.findings?.primaryDrivers ?? []).map((d) => d.name).join("; ") || "none"}\nRisk drivers: ${(dec.findings?.downsideDrivers ?? []).map((d) => d.name).join("; ") || "none"}\nWhen the user asks why a deal passed/failed or how it could pass, answer from these findings and drivers.`;
          } catch {
            /* fall back to portfolio-wide context */
          }
        }

        const context = `Projects:\n${JSON.stringify(projects ?? [], null, 2)}\n\nAPPROVED ASSUMPTIONS (only authoritative source):\n${JSON.stringify(assumptions ?? [], null, 2)}\n\nFinancial outputs:\n${JSON.stringify(outputs ?? [], null, 2)}\n\nIC decisions:\n${JSON.stringify(decisions ?? [], null, 2)}${focus}`;

        const body = (await request.json()) as { messages: UIMessage[] };

        const { getAgirModel } = await import("@/lib/ai-gateway.server");
        const result = streamText({
          model: getAgirModel(),
          system: `You are Agir, an institutional investment-decision copilot for an investment committee. You help analysts decide whether to invest. Lead with the decision (recommendation, risk, conditions), then support it with findings and drivers, then numbers. You may ONLY reference values that appear under APPROVED ASSUMPTIONS, a derived financial output, or the focused deal's findings. If a value is not present, reply exactly: "No approved assumption exists." Never invent numbers. Cite the field_label or metric_label when quoting figures. Be concise and use markdown.\n\n${context}`,
          messages: await convertToModelMessages(body.messages),
        });
        return result.toUIMessageStreamResponse();
      },
    },
  },
});
