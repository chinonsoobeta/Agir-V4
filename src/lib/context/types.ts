// The deterministic Insight Layer types. Everything here is computed from
// approved engine inputs / engine outputs by pure functions: no LLM, no
// invented numbers. The layer sits ON TOP of the calculator: it interprets,
// compares, attributes and narrates, but never changes a computed value or the
// hard verdict gates.

export type AssetClass =
  | "multifamily"
  | "office"
  | "retail"
  | "industrial"
  | "hospitality"
  | "mixed_use"
  | "other";

export type MarketTier = "gateway" | "primary" | "secondary" | "tertiary";

// Where the deal sits in its life cycle: drives which norms and tolerances apply.
export type DealStage = "ground_up" | "lease_up" | "value_add" | "stabilized";

export type LoanStructure = "interest_only_full" | "partial_io" | "amortizing";

export type AssetMixComponent = { assetClass: AssetClass; sharePct: number };

export type DealContext = {
  assetClass: AssetClass; // dominant class (or "mixed_use")
  assetMix: AssetMixComponent[]; // GPR-weighted share by class, descending
  marketTier: MarketTier;
  marketLabel: string; // human label, e.g. "secondary-market suburban multifamily"
  stage: DealStage;
  loanStructure: LoanStructure;
  holdYears: number;
  ioMonths: number;
  constructionMonths: number;
  leaseUpMonths: number;
  monthsToStabilize: number; // construction + lease-up
  notes: string[]; // contextual observations that modulate interpretation
};

// A directional norm band for one metric in one context.
export type BenchmarkBand = {
  betterDirection: "higher" | "lower";
  weak: number; // worse than this is a real weakness
  target: number; // the institutional "good" line
  strong: number; // exceptional
  unit: "$" | "%" | "x" | "bps" | "count";
};

export type BenchmarkSource = "curated" | "firm" | "portfolio" | "blended";

export type Benchmark = BenchmarkBand & {
  metricKey: string;
  source: BenchmarkSource;
  contextLabel: string; // e.g. "secondary-market multifamily, ground-up"
  sampleSize?: number; // for portfolio-derived norms
};

export type InterpretationBand =
  | "exceptional"
  | "strong"
  | "in_line"
  | "soft"
  | "weak"
  | "critical"
  | "neutral";

export type Interpretation = {
  metricKey: string;
  label: string;
  value: number;
  unit: BenchmarkBand["unit"];
  band: InterpretationBand;
  benchmark?: Benchmark;
  // value - target, signed in the metric's own unit (positive = better when
  // betterDirection is "higher").
  deltaToTarget?: number;
  // "~70 bps below the secondary-market multifamily norm of 9.5%"
  comparativePhrase: string;
  // Context that softens or sharpens the read, e.g. "interest-only for the full
  // hold, so amortizing coverage overstates near-term debt service".
  contextNote?: string;
  // 0–100 materiality used to order and select what to say.
  salience: number;
  // Numbers this interpretation's prose contains (value, benchmark target, the
  // displayed delta), surfaced so the memo's provenance verifier admits them.
  derived: number[];
};

// Firm-level overrides (the "configurable policy box"). Any band provided here
// replaces the curated default for that (assetClass, metricKey).
export type FirmBenchmarkConfig = {
  label?: string;
  overrides?: Partial<Record<AssetClass | "all", Partial<Record<string, Partial<BenchmarkBand>>>>>;
};

// Portfolio-derived norms: percentile bands computed from the firm's own deals.
export type PortfolioNorms = {
  // metricKey -> { p25, p50, p75, n }
  bands: Record<string, { p25: number; p50: number; p75: number; n: number }>;
  sampleSize: number;
};

export type BenchmarkInputs = {
  firmConfig?: FirmBenchmarkConfig | null;
  portfolioNorms?: PortfolioNorms | null;
  // Minimum deals before portfolio norms are trusted enough to blend in.
  portfolioMinSample?: number;
};
