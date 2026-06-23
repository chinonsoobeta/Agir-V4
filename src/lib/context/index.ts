// The deterministic Insight Layer — context-aware judgment, benchmark
// reasoning, causal attribution and analyst-voice narrative, sitting on top of
// the calculator. No LLM touches a number or a decision; an LLM provider can be
// slotted behind the same interface later (wording-only, re-verified).

export * from "./types";
export { deriveDealContext, classifyAssetClass, deriveAssetMix, classifyMarketTier, classifyLoanStructure, ASSET_LABEL } from "./deal-context";
export { resolveBenchmark, curatedBenchmark, BENCHMARKED_METRICS } from "./benchmarks";
export { interpretDeal, interpretMetric, classifyBand, partitionInterpretations } from "./interpret";
export { buildAttribution, type Driver, type WhatIfLever, type Attribution, type Covenants } from "./attribution";
export {
  deterministicProvider,
  getInsightProvider,
  setInsightProvider,
  type InsightProvider,
  type Audience,
  type NarrativeInput,
  type NarrativeFacts,
} from "./narrative";
export { buildInsight, writeNarrative, type InsightBundle, type BuildInsightOptions } from "./insight";
export { computePortfolioNorms } from "./portfolio";
