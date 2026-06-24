// Deterministic natural-language generation: turns structured interpretations +
// attribution into analyst-voice prose. Varied phrasing is selected by a stable
// hash (no Math.random / Date: that would break determinism). Every NUMBER the
// prose emits is also surfaced via insightDerivedValues() so the memo's
// provenance verifier admits it; benchmark norms come from the curated KB.

import type { Attribution } from "./attribution";
import type { DealContext, Interpretation, InterpretationBand } from "./types";

export type Audience = "ic" | "lender" | "investor" | "internal";

export type NarrativeFacts = {
  dealName: string;
  tdc: number;
  loan: number;
  equity: number;
  noi: number;
  ltcPct: number;
  exitCapPct: number;
  verdictCode: string; // APPROVE | APPROVE_WITH_CONDITIONS | REJECT
};

export type NarrativeInput = {
  context: DealContext;
  interpretations: Interpretation[];
  attribution: Attribution;
  facts: NarrativeFacts;
};

// A stable string hash so phrasing varies by deal/metric but never by run.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}
function pick<T>(arr: T[], seed: string): T {
  return arr[hash(seed) % arr.length];
}

const money = (n: number) => `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;

const STAGE_PHRASE: Record<DealContext["stage"], string> = {
  ground_up: "ground-up development",
  lease_up: "lease-up play",
  value_add: "value-add repositioning",
  stabilized: "stabilized acquisition",
};

const BAND_ADJ: Record<InterpretationBand, string[]> = {
  exceptional: ["exceptional", "standout"],
  strong: ["strong", "robust", "comfortable", "healthy"],
  in_line: ["in line with the market", "consistent with the norm", "at the market bar"],
  soft: ["modestly below the market", "a touch soft versus the norm", "slightly under the bar"],
  weak: ["below the market bar", "short of the norm", "weak against the bar"],
  critical: ["well below the bar", "critically short of the norm"],
  neutral: ["unbenchmarked"],
};

const by = (key: string, items: Interpretation[]) => items.find((i) => i.metricKey === key);

function framing(nc: NarrativeInput): string {
  const f = nc.facts;
  const c = nc.context;
  const opener = pick(
    [
      `${f.dealName} is a ${c.marketLabel} ${STAGE_PHRASE[c.stage]}`,
      `${f.dealName} underwrites as a ${c.marketLabel} ${STAGE_PHRASE[c.stage]}`,
      `${f.dealName}, a ${c.marketLabel} ${STAGE_PHRASE[c.stage]},`,
    ],
    f.dealName + c.assetClass,
  );
  return `${opener} capitalized with ${money(f.loan)} of senior debt (${pct(f.ltcPct)} loan-to-cost) and ${money(f.equity)} of equity against ${money(f.tdc)} of total cost, throwing off ${money(f.noi)} of stabilized NOI at a ${pct(f.exitCapPct)} exit.`;
}

function coverageSentence(nc: NarrativeInput): string | null {
  const dscr = by("dscr", nc.interpretations);
  const dy = by("debt_yield", nc.interpretations);
  if (!dscr && !dy) return null;
  const parts: string[] = [];
  if (dscr) parts.push(`DSCR ${x(dscr.value)} (${dscr.comparativePhrase})`);
  if (dy) parts.push(`debt yield ${pct(dy.value)} (${dy.comparativePhrase})`);
  const worst = [dscr, dy].filter(Boolean).sort((a, b) => (b!.salience - a!.salience))[0]!;
  const adj = pick(BAND_ADJ[worst.band], nc.facts.dealName + "cov");
  const lead = pick(["Coverage is", "On the debt, coverage is", "Lender coverage sits"], nc.facts.dealName + "covlead");
  const note = dscr?.contextNote ? ` ${dscr.contextNote}` : dy?.contextNote ? ` ${dy.contextNote}` : "";
  return `${lead} ${adj}: ${parts.join(" and ")}.${note}`;
}

function returnsSentence(nc: NarrativeInput): string | null {
  const spread = by("development_spread", nc.interpretations);
  const em = by("equity_multiple", nc.interpretations);
  const profit = by("profit_margin", nc.interpretations);
  const irr = by("irr_estimate", nc.interpretations);
  const present = [spread, em, profit, irr].filter(Boolean) as Interpretation[];
  if (!present.length) return null;
  const driver = present.sort((a, b) => b.salience - a.salience)[0];
  const adj = pick(BAND_ADJ[driver.band], nc.facts.dealName + "ret");
  const bits: string[] = [];
  if (spread) bits.push(`a ${Math.round(spread.value)} bps development spread (${spread.comparativePhrase})`);
  if (em) bits.push(`a ${x(em.value)} equity multiple`);
  if (profit) bits.push(`${pct(profit.value)} profit on cost`);
  const lead = pick(["On returns, the economics are", "The return profile is", "Returns screen as"], nc.facts.dealName + "retlead");
  return `${lead} ${adj}, with ${bits.join(", ")}.`;
}

function riskCloseSentence(nc: NarrativeInput): string {
  const concerns = nc.interpretations.filter((i) => i.band === "weak" || i.band === "critical" || i.band === "soft").slice(0, 2);
  const failingLever = nc.attribution.levers.find((l) => !l.passing);
  if (nc.facts.verdictCode === "APPROVE" && !concerns.length) {
    return pick(
      ["Every screened coverage and return gate clears, and no reconciliation errors remain.", "The deal clears each underwriting gate with no outstanding exceptions."],
      nc.facts.dealName + "approve",
    );
  }
  const concernText = concerns.length
    ? `The binding constraints are ${concerns.map((c) => `${c.label.toLowerCase()} (${pick(BAND_ADJ[c.band], c.metricKey)})`).join(" and ")}`
    : "The deal is close to the bar";
  const leverText = failingLever ? `: ${failingLever.lever.charAt(0).toLowerCase()}${failingLever.lever.slice(1)}.` : ".";
  return `${concernText}${leverText}`;
}

function verdictLead(nc: NarrativeInput): string {
  const v = nc.facts.verdictCode;
  if (v === "APPROVE") return pick(["The deal clears the investment bar.", "This one pencils."], nc.facts.dealName + "vl");
  if (v === "APPROVE_WITH_CONDITIONS") return pick(["The deal clears with conditions.", "This is approvable subject to conditions."], nc.facts.dealName + "vl");
  return pick(["The deal does not yet clear the investment bar.", "This is a return-to-underwriting in its current shape."], nc.facts.dealName + "vl");
}

export interface InsightProvider {
  id: string;
  thesis(nc: NarrativeInput): string;
  paragraph(nc: NarrativeInput, audience: Audience): string;
  bullets(nc: NarrativeInput): string[];
}

// The default, fully deterministic writer.
export const deterministicProvider: InsightProvider = {
  id: "deterministic",
  thesis(nc) {
    const strengths = nc.interpretations.filter((i) => i.band === "strong" || i.band === "exceptional");
    const concerns = nc.interpretations.filter((i) => i.band === "weak" || i.band === "critical");
    const topStrength = strengths.sort((a, b) => b.salience - a.salience)[0];
    const topConcern = concerns.sort((a, b) => b.salience - a.salience)[0];
    const head = verdictLead(nc);
    if (nc.facts.verdictCode === "REJECT") {
      const reason = topConcern ? ` ${topConcern.label} is ${pick(BAND_ADJ[topConcern.band], topConcern.metricKey)} and ${topConcern.comparativePhrase}` : "";
      const lever = nc.attribution.levers.find((l) => !l.passing);
      return `${head}${reason}.${lever ? ` ${lever.lever}.` : ""}`;
    }
    const s = topStrength ? ` ${topStrength.label} is ${pick(BAND_ADJ[topStrength.band], topStrength.metricKey)} (${topStrength.comparativePhrase})` : "";
    const c = topConcern ? `, though ${topConcern.label.toLowerCase()} is ${pick(BAND_ADJ[topConcern.band], topConcern.metricKey)}` : "";
    return `${head}${s}${c}.`;
  },
  paragraph(nc, audience) {
    const sentences: (string | null)[] = [];
    sentences.push(framing(nc));
    // Audience tilts the order of emphasis; the facts never change.
    if (audience === "lender") {
      sentences.push(coverageSentence(nc));
      sentences.push(returnsSentence(nc));
    } else if (audience === "investor") {
      sentences.push(returnsSentence(nc));
      sentences.push(coverageSentence(nc));
    } else {
      sentences.push(coverageSentence(nc));
      sentences.push(returnsSentence(nc));
    }
    sentences.push(riskCloseSentence(nc));
    return sentences.filter(Boolean).join(" ");
  },
  bullets(nc) {
    const top = [...nc.interpretations].sort((a, b) => b.salience - a.salience).slice(0, 6);
    const out = top.map((i) => {
      const adj = pick(BAND_ADJ[i.band], i.metricKey + "b");
      const note = i.contextNote ? `: ${i.contextNote}` : "";
      return `${i.label} ${i.comparativePhrase}; reads ${adj}.${note}`;
    });
    for (const lever of nc.attribution.levers.filter((l) => !l.passing)) out.push(`Path to clearing ${lever.gate}: ${lever.lever}.`);
    return out;
  },
};

// Pluggable seam: a future LLM provider (wording-only, re-verified) can replace
// this. Defaults to deterministic; the engine never depends on a model.
let activeProvider: InsightProvider = deterministicProvider;
export function getInsightProvider(): InsightProvider {
  return activeProvider;
}
export function setInsightProvider(p: InsightProvider): void {
  activeProvider = p;
}
