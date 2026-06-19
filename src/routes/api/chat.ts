import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.replace("Bearer ", "");

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        if (!process.env.ANTHROPIC_API_KEY) return new Response("Missing ANTHROPIC_API_KEY", { status: 500 });

        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: user } = await supabase.auth.getUser(token);
        if (!user.user) return new Response("Unauthorized", { status: 401 });

        const { data: projects } = await supabase.from("projects").select("*");
        const { data: assumptions } = await supabase
          .from("assumptions").select("project_id,field_key,field_label,category,value_numeric,value_text,unit,status,confidence_score,source_location,source_text,source_document_id,conflict_values")
          .in("status", ["approved","modified"]);
        const { data: outputs } = await supabase
          .from("financial_outputs").select("project_id,scenario_key,metric_key,metric_label,value_numeric,unit,formula_text,inputs");
        const { data: decisions } = await supabase
          .from("decision_logs").select("project_id,decision,rationale,conditions,created_at");

        // Deal-aware focus: when the copilot is opened from a deal, the client
        // sends X-Agir-Deal so the copilot reasons over that deal's findings,
        // scores and recommendation first.
        const focusId = request.headers.get("x-agir-deal");
        let focus = "";
        if (focusId) {
          try {
            const { buildDecision } = await import("@/lib/decision");
            const proj = (projects ?? []).find((p: any) => p.id === focusId);
            const o = (outputs ?? []).filter((r: any) => r.project_id === focusId);
            const a = (assumptions ?? []).filter((r: any) => r.project_id === focusId);
            const dec = buildDecision(o as any, a as any);
            focus = `\n\n===== FOCUSED DEAL: ${proj?.name ?? focusId} =====\nRecommendation: ${dec.recommendationLabel}\nInvestment Score: ${dec.investmentScore ?? "n/a"}/100 · Confidence: ${dec.confidenceScore}/100 · Risk: ${dec.riskRating}\nStrengths: ${(dec.findings?.strengths ?? []).map((x) => x.title).join("; ") || "none"}\nRisks: ${(dec.findings?.risks ?? []).map((x) => x.title).join("; ") || "none"}\nOpportunities: ${(dec.findings?.opportunities ?? []).map((x) => x.title).join("; ") || "none"}\nApproval conditions: ${(dec.findings?.approvalConditions ?? []).map((x) => x.title).join("; ") || "none"}\nValue drivers: ${(dec.findings?.primaryDrivers ?? []).map((d) => d.name).join("; ") || "none"}\nRisk drivers: ${(dec.findings?.downsideDrivers ?? []).map((d) => d.name).join("; ") || "none"}\nWhen the user asks why a deal passed/failed or how it could pass, answer from these findings and drivers.`;
          } catch { /* fall back to portfolio-wide context */ }
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
