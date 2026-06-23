// The Insight Layer assembler: from one engine output + its input + project
// meta, produce the full deterministic "analyst read" — context, interpreted
// metrics, causal attribution, a synthesized thesis, key points, and the set of
// numbers the prose uses (for memo provenance). This is the public entry point
// the engine, findings, and memo all call.

import type { EngineOutput, UnderwritingInput } from "../engine/types";
import { deriveDealContext } from "./deal-context";
import { interpretDeal } from "./interpret";
import { buildAttribution, type Attribution, type Covenants } from "./attribution";
import { getInsightProvider, type Audience, type NarrativeFacts, type NarrativeInput } from "./narrative";
import type { BenchmarkInputs, DealContext, Interpretation } from "./types";

export type InsightBundle = {
  context: DealContext;
  interpretations: Interpretation[];
  attribution: Attribution;
  facts: NarrativeFacts;
  thesis: string;
  bullets: string[];
  derivedValues: number[];
};

export type BuildInsightOptions = {
  meta?: { name?: string | null; type?: string | null; location?: string | null };
  benchInputs?: BenchmarkInputs;
  covenants?: Covenants;
  verdictCode?: string;
};

export function buildInsight(output: EngineOutput, input: UnderwritingInput, opts: BuildInsightOptions = {}): InsightBundle {
  const context = deriveDealContext(input, opts.meta ?? {});
  const interpretations = interpretDeal(output, context, opts.benchInputs);
  const attribution = buildAttribution(output, input, context, opts.benchInputs, opts.covenants);
  const v = output.values;
  const facts: NarrativeFacts = {
    dealName: opts.meta?.name ?? "This project",
    tdc: v.tdc,
    loan: input.loanAmount,
    equity: v.equity,
    noi: v.noi,
    ltcPct: v.ltcPct,
    exitCapPct: input.exitCapRatePct,
    verdictCode: opts.verdictCode ?? "",
  };
  const ni: NarrativeInput = { context, interpretations, attribution, facts };
  const provider = getInsightProvider();
  const thesis = provider.thesis(ni);
  const bullets = provider.bullets(ni);
  const derivedValues = Array.from(
    new Set(
      [
        ...interpretations.flatMap((i) => i.derived),
        ...attribution.derivedValues,
        Math.round(v.equity),
        Math.round(v.tdc),
        Math.round(v.noi),
        Math.round(input.loanAmount),
        // Schedule figures that appear in context notes (all pure functions of
        // approved inputs): "30-month build", "2.5-year interest-only", etc.
        context.monthsToStabilize,
        context.constructionMonths,
        context.leaseUpMonths,
        context.ioMonths,
        Math.round((context.ioMonths / 12) * 10) / 10,
      ].filter((n) => Number.isFinite(n)),
    ),
  );
  return { context, interpretations, attribution, facts, thesis, bullets, derivedValues };
}

export function writeNarrative(bundle: InsightBundle, audience: Audience): string {
  const ni: NarrativeInput = {
    context: bundle.context,
    interpretations: bundle.interpretations,
    attribution: bundle.attribution,
    facts: bundle.facts,
  };
  return getInsightProvider().paragraph(ni, audience);
}
