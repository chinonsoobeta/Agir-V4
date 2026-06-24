// Underwriting tab: fail-closed. When readiness is blocked it renders the
// blocked state listing exactly what is missing/unresolved — zero metrics,
// zero charts, no partial numbers. When ready, every figure shown is a
// deterministic engine output with its formula and provenance.

import { useState } from "react";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFinancialOutputs, listRisks, listDecisions, listAudit, recordDecision } from "@/lib/assumptions.functions";
import {
  acceptDefaults,
  getUnderwritingReadiness,
  listReconciliationFlags,
  resolveConflict,
  runFullUnderwriting,
} from "@/lib/underwriting.functions";
import { generateMemo, listMemos, debugMemoReadiness } from "@/lib/memo.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ShieldAlert, Info, Calculator, Lock, Scale, FileText, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";

const outputsQ = (pid: string) => queryOptions({ queryKey: ["outputs", pid], queryFn: () => listFinancialOutputs({ data: { project_id: pid } }) });
const risksQ = (pid: string) => queryOptions({ queryKey: ["risks", pid], queryFn: () => listRisks({ data: { project_id: pid } }) });
const decisionsQ = (pid: string) => queryOptions({ queryKey: ["decisions", pid], queryFn: () => listDecisions({ data: { project_id: pid } }) });
const auditQ = (pid: string) => queryOptions({ queryKey: ["audit", pid], queryFn: () => listAudit({ data: { project_id: pid } }) });
const readinessQ = (pid: string) => queryOptions({ queryKey: ["uw-readiness", pid], queryFn: () => getUnderwritingReadiness({ data: { project_id: pid } }) });
const flagsQ = (pid: string) => queryOptions({ queryKey: ["recon-flags", pid], queryFn: () => listReconciliationFlags({ data: { project_id: pid } }) });
const memosQ = (pid: string) => queryOptions({ queryKey: ["memos", pid], queryFn: () => listMemos({ data: { project_id: pid } }) });
const memoDebugQ = (pid: string) => queryOptions({ queryKey: ["memo-debug", pid], queryFn: () => debugMemoReadiness({ data: { project_id: pid } }) });

const SCENARIO_LABELS: Record<string, string> = {
  base: "Base Case", revenue_down: "Revenue Downside (−10%)",
  cost_overrun: "Cost Overrun (+10%)", rate_shock: "Rate Shock (+150 bps)",
  cap_expansion: "Cap Expansion (+75 bps)", combined: "Combined Stress",
  occupancy_down: "Occupancy Downside (−500 bps)", expense_inflation: "Expense Inflation (+500 bps)",
};
const SCENARIO_ORDER = ["cap_expansion", "cost_overrun", "rate_shock", "revenue_down", "occupancy_down", "expense_inflation", "combined"];
const SEV_STYLES: Record<string, string> = {
  info: "bg-muted text-muted-foreground border-border",
  warning: "bg-chart-5/20 text-chart-5 border-chart-5/30",
  yellow: "bg-chart-5/20 text-chart-5 border-chart-5/30",
  error: "bg-destructive/20 text-destructive border-destructive/30",
  red: "bg-destructive/20 text-destructive border-destructive/30",
  critical: "bg-destructive text-destructive-foreground border-destructive",
};

const INPUT_LABELS: Record<string, string> = {
  "budget:land": "Budget — land", "budget:hard": "Budget — hard costs",
  "budget:soft": "Budget — soft costs", "budget:contingency": "Budget — contingency",
  "budget:financing_interest": "Budget — financing", revenue_program: "Revenue program (≥1 component)",
  loan_amount: "Loan amount", interest_rate_pct: "Interest rate", amort_years: "Amortization term",
  equity_amount: "Equity amount", exit_cap_rate_pct: "Exit cap rate", expense_ratio_pct: "Expense ratio",
  hold_years: "Hold period", selling_costs_pct: "Selling costs",
};
const inputLabel = (key: string) =>
  INPUT_LABELS[key] ?? (key.startsWith("occupancy:") ? `Stabilized occupancy — ${key.slice(10)}` : key);

function fmtValue(v: number | null, unit: string, formula?: string | null) {
  if (v == null || !isFinite(v)) {
    return formula?.includes("not meaningful") ? "not meaningful" : "—";
  }
  if (unit === "$") return new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 }).format(v);
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "x") return `${v.toFixed(2)}x`;
  if (unit === "bps") return `${v.toFixed(0)} bps`;
  return v.toLocaleString();
}

export function UnderwritingPanel({ projectId }: { projectId: string }) {
  const { data: outputs } = useSuspenseQuery(outputsQ(projectId));
  const { data: risks } = useSuspenseQuery(risksQ(projectId));
  const { data: readiness } = useSuspenseQuery(readinessQ(projectId));
  const { data: flags } = useSuspenseQuery(flagsQ(projectId));
  const qc = useQueryClient();
  const runFn = useServerFn(runFullUnderwriting);
  const acceptDefaultsFn = useServerFn(acceptDefaults);
  const resolveFn = useServerFn(resolveConflict);

  // AI runs by default (it only selects which consensual static defaults to
  // accept — the engine still computes every number). Toggle off to force the
  // pure deterministic path.
  const [aiMode, setAiMode] = useState(true);
  const mode = aiMode ? "ai" : ("deterministic" as const);
  const [lastMode, setLastMode] = useState<"ai" | "deterministic" | null>(null);

  const invalidate = () => {
    for (const key of ["outputs", "risks", "uw-readiness", "recon-flags", "assumptions"]) {
      qc.invalidateQueries({ queryKey: [key, projectId] });
    }
  };

  const run = useMutation({
    mutationFn: () => runFn({ data: { project_id: projectId, mode } }),
    onSuccess: (r: any) => {
      invalidate();
      setLastMode(r.analysis_mode ?? null);
      if (r.ai_note) toast.message(r.ai_note);
      if (r.ai_accepted_defaults?.length) {
        toast.message(`AI accepted ${r.ai_accepted_defaults.length} static default(s) to unblock the run.`);
      }
      if (r.blocked) toast.error("Underwriting is blocked — resolve the listed inputs first.");
      else toast.success(`Underwriting complete (${r.analysis_mode === "ai" ? "AI" : "deterministic"}) — verdict ${r.verdict.code}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const acceptDefaultsMut = useMutation({
    mutationFn: () => acceptDefaultsFn({ data: { project_id: projectId } }),
    onSuccess: (r: any) => { invalidate(); toast.success(`Accepted ${r.accepted.length} default(s)`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolve = useMutation({
    mutationFn: (d: { key: string; mode: "pick" | "conservative"; value?: number }) =>
      resolveFn({ data: { project_id: projectId, ...d } }),
    onSuccess: (r: any) => { invalidate(); toast.success(`Resolved ${r.key} → ${r.resolved}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const blocked = readiness.status === "blocked";

  // ---- BLOCKED STATE: no metrics, no charts, no partial numbers. ----
  if (blocked) {
    return (
      <div className="space-y-4">
        <Card className="p-6 border-destructive/40">
          <div className="flex items-start gap-3">
            <Lock className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold uppercase tracking-widest text-destructive">Underwriting blocked</div>
              <p className="text-sm text-muted-foreground mt-1">
                The engine runs only on approved or default-accepted inputs. It never fills gaps on its own —
                resolve the items below, then run underwriting.
              </p>
              {readiness.missing.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Missing inputs</div>
                  <ul className="mt-1 space-y-1">
                    {readiness.missing.map((k: string) => (
                      <li key={k} className="text-sm flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-destructive inline-block" />
                        {inputLabel(k)}
                        {readiness.defaults.some((d: any) => d.key === k) && (
                          <Badge variant="outline" className="text-[10px]">default available</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {readiness.conflicts.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Conflicting inputs — resolve explicitly</div>
                  {readiness.conflicts.map((c: any) => (
                    <div key={c.key} className="mt-2 p-3 rounded border border-destructive/30 bg-destructive/5">
                      <div className="text-sm font-medium">{inputLabel(c.key)}</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {c.conflict_values.map((v: any, i: number) => (
                          <div key={i} className="p-2 rounded border border-border bg-background">
                            <div className="num text-lg">{v.value}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{v.source ?? "unknown source"}</div>
                            <Button size="sm" variant="outline" className="mt-2"
                              disabled={resolve.isPending}
                              onClick={() => resolve.mutate({ key: c.key, mode: "pick", value: Number(v.value) })}>
                              Use this value
                            </Button>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" className="mt-2" disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ key: c.key, mode: "conservative" })}>
                        <Scale className="size-3.5 mr-1" />Use conservative
                      </Button>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Conservative picks the documented value with the lower valuation/return. Values are never averaged.
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {readiness.defaults.length > 0 && (
                <div className="mt-4 p-3 rounded border border-border bg-muted/10">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Static defaults available</div>
                  <ul className="mt-1 text-sm text-muted-foreground">
                    {readiness.defaults.map((d: any) => <li key={d.key}>{d.label}</li>)}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" disabled={acceptDefaultsMut.isPending}
                      onClick={() => acceptDefaultsMut.mutate()}>
                      Accept defaults
                    </Button>
                    <Button size="sm" variant="outline" disabled={run.isPending}
                      onClick={() => run.mutate()}>
                      <Sparkles className="size-3.5 mr-1" />Let AI accept defaults & run
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Writes source=default, status=default_accepted rows. Defaults are never applied silently — AI only
                    selects from these fixed values; it never invents a number, and the engine does all math.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const byScenario = outputs.reduce<Record<string, any[]>>((acc, o) => {
    (acc[o.scenario_key] ||= []).push(o); return acc;
  }, {});
  const base = (byScenario.base ?? []).filter((m) => m.metric_key !== "verdict" && m.metric_key !== "risk_score" && m.metric_key !== "insight");
  const metricKeys = base.map((m) => m.metric_key);
  const scenarioKeys = SCENARIO_ORDER.filter((k) => byScenario[k]?.length);
  const metric = (key: string) => base.find((b) => b.metric_key === key);
  const verdictRow = (byScenario.base ?? []).find((m) => m.metric_key === "verdict");
  const riskScoreRow = (byScenario.base ?? []).find((m) => m.metric_key === "risk_score");
  const insightRow = (byScenario.base ?? []).find((m) => m.metric_key === "insight");
  // ONE reconciled recommendation (gate verdict + findings + context); falls back
  // to the raw gate verdict for deals underwritten before reconciliation existed.
  const recommendation = insightRow?.inputs?.recommendation ?? verdictRow?.inputs?.code ?? "—";
  const recRationale = (insightRow?.inputs?.recommendationRationale as string | undefined) ?? verdictRow?.formula_text;
  const irrRow = metric("irr_estimate");
  const equityWipeout = Boolean(metric("equity_multiple")?.formula_text?.includes("Equity wipeout"));
  const defaultedKeys: string[] = readiness.defaultedKeys ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ModeToggle aiMode={aiMode} setAiMode={setAiMode} />
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {aiMode ? <Sparkles className="size-4 mr-1" /> : <Calculator className="size-4 mr-1" />}
            {run.isPending ? "Running…" : aiMode ? "Run Underwriting (AI)" : "Run Deterministic Underwriting"}
          </Button>
          <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>Refresh Base Case</Button>
          <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>Refresh Stress Runs</Button>
          {lastMode && <ModeBadge mode={lastMode} />}
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            engine computes every number · AI only selects inputs
          </span>
        </div>
        {defaultedKeys.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="uppercase tracking-widest text-[10px] font-semibold">Defaults in effect:</span>
            {defaultedKeys.map((k) => (
              <Badge key={k} variant="outline" className="text-[10px]">{inputLabel(k)} · default</Badge>
            ))}
          </div>
        )}
      </Card>

      {/* Reconciliation banners — error flags cannot be silently dropped */}
      {flags.length > 0 && (
        <div className="space-y-2">
          {flags.map((f: any) => (
            <div key={f.id} className={`flex items-start gap-2 rounded border p-3 text-sm ${SEV_STYLES[f.severity] ?? SEV_STYLES.info}`}>
              {f.severity === "error" ? <ShieldAlert className="size-4 mt-0.5 shrink-0" /> : <AlertTriangle className="size-4 mt-0.5 shrink-0" />}
              <div>
                <span className="font-semibold uppercase text-[10px] tracking-widest mr-2">{f.severity}</span>
                {f.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <UnderwritingMetric label="Recommendation" text={recommendation} sub={recRationale} highlight={recommendation === "REJECT" || recommendation === "RETURN_TO_UNDERWRITING" ? "text-destructive" : "text-primary"} />
        <UnderwritingMetric label="Exit Value" row={metric("exit_value")} />
        <UnderwritingMetric label="IRR" row={irrRow} text={equityWipeout ? "not meaningful" : undefined} sub={equityWipeout ? "Equity loss — IRR not meaningful" : undefined} highlight={equityWipeout ? "text-destructive" : undefined} />
        <UnderwritingMetric label="DSCR (amortizing)" row={metric("dscr")} />
        <UnderwritingMetric label="Equity Multiple" row={metric("equity_multiple")} highlight={equityWipeout ? "text-destructive" : undefined} />
        <UnderwritingMetric label="Debt Yield" row={metric("debt_yield")} />
        <UnderwritingMetric label="Break-even Occ." row={metric("break_even_occupancy")} />
        <UnderwritingMetric label="Risk Score" text={riskScoreRow ? String(Math.round(Number(riskScoreRow.value_numeric))) : "—"} sub={riskScoreRow?.formula_text} />
      </div>

      {equityWipeout && (
        <div className={`rounded border p-3 text-sm ${SEV_STYLES.error}`}>
          <ShieldAlert className="size-4 inline mr-2" />
          Equity wipeout: net sale proceeds are below the loan payoff at exit. EM ≈ 0.0x; IRR is not meaningful.
        </div>
      )}

      <DeterministicRead row={insightRow} />

      {!outputs.length && (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Inputs are ready. Run underwriting to compute the pro forma.
        </Card>
      )}

      {/* Full metric table with the five stress scenarios */}
      {outputs.length > 0 && <Card className="overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/20 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Pro Forma — Base & Stress (every cell is an engine re-run)
        </div>
        <div className="overflow-x-auto">
          <table className="data-grid w-full">
            <thead><tr className="bg-muted/10">
              <th className="text-left">Metric</th>
              <th className="text-right text-primary">{SCENARIO_LABELS.base}</th>
              {scenarioKeys.map((k) => <th key={k} className="text-right">{SCENARIO_LABELS[k] ?? k}</th>)}
              <th className="text-left">Formula</th>
            </tr></thead>
            <tbody>
              {metricKeys.map((mk) => {
                const baseRow = base.find((b) => b.metric_key === mk);
                return (
                  <tr key={mk}>
                    <td className="font-medium">{baseRow?.metric_label}</td>
                    <td className="text-right num text-primary">{fmtValue(baseRow?.value_numeric == null ? null : Number(baseRow.value_numeric), baseRow?.unit ?? "", baseRow?.formula_text)}</td>
                    {scenarioKeys.map((sk) => {
                      const r = byScenario[sk].find((b) => b.metric_key === mk);
                      return (
                        <td key={sk} className="text-right align-top">
                          <div className="num">{r ? fmtValue(r.value_numeric == null ? null : Number(r.value_numeric), r.unit, r.formula_text) : "—"}</div>
                          {r?.formula_text && (
                            <div className="mt-1 text-[10px] leading-snug text-muted-foreground font-mono max-w-56 ml-auto">
                              {r.formula_text}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-xs text-muted-foreground font-mono max-w-md">{baseRow?.formula_text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>}

      {/* Risk register — fixed thresholds over engine outputs + flags */}
      <Card className="p-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Risk Register</div>
        {risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automated flags from the latest engine run.</p>
        ) : (
          <ul className="space-y-2">
            {risks.map((r) => {
              const Icon = r.severity === "red" || r.severity === "critical" ? ShieldAlert : r.severity === "yellow" ? AlertTriangle : Info;
              return (
                <li key={r.id} className="flex items-start gap-3 p-3 rounded border border-border bg-muted/10">
                  <Icon className="size-4 mt-0.5 text-chart-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{r.title}</span>
                      <Badge variant="outline" className={`${SEV_STYLES[r.severity]} text-[10px] uppercase`}>{r.severity}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UnderwritingMetric({ label, row, text, sub, highlight }: { label: string; row?: any; text?: string; sub?: string | null; highlight?: string }) {
  const display = text ?? (row ? fmtValue(row.value_numeric == null ? null : Number(row.value_numeric), row.unit, row.formula_text) : "—");
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`num text-2xl mt-1 ${highlight ?? "text-primary"}`}>{display}</div>
      <div className="text-[10px] text-muted-foreground mt-1 font-mono line-clamp-2">{sub ?? row?.formula_text ?? "Pending underwriting run"}</div>
    </Card>
  );
}

function bandClass(band: string): string {
  if (band === "strong" || band === "exceptional") return "text-primary border-primary/40 bg-primary/5";
  if (band === "weak" || band === "critical") return "text-destructive border-destructive/40 bg-destructive/5";
  if (band === "soft") return "text-chart-5 border-chart-5/40 bg-chart-5/5";
  return "text-muted-foreground border-border";
}

// The deterministic "analyst read": context chips, a synthesized thesis,
// metric-by-metric contextual interpretation, and what-if levers. Every word is
// rule-derived from the engine output + the curated/portfolio benchmark norms.
function DeterministicRead({ row }: { row?: any }) {
  if (!row) return null;
  const ctx = row.inputs?.context;
  const interps: any[] = row.inputs?.interpretations ?? [];
  const levers: any[] = row.inputs?.levers ?? [];
  const failing = levers.filter((l) => !l.passing);
  const sample = Number(row.inputs?.portfolioSample ?? 0);
  const chips = ctx ? [ctx.marketLabel, String(ctx.stage ?? "").replace(/_/g, " "), String(ctx.loanStructure ?? "").replace(/_/g, " ")].filter(Boolean) : [];
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Info className="size-4 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Deterministic Read · Contextual Analysis</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (<Badge key={i} variant="outline" className="text-[10px] capitalize">{c}</Badge>))}
        {sample > 0 && <Badge variant="outline" className="text-[10px]">benchmarked vs {sample} portfolio deal{sample === 1 ? "" : "s"}</Badge>}
      </div>
      {row.formula_text && <p className="text-sm leading-relaxed">{row.formula_text}</p>}
      {interps.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">How it reads in context</div>
          <ul className="space-y-1.5">
            {interps.filter((i) => i.band !== "neutral").slice(0, 7).map((i) => (
              <li key={i.metricKey} className="text-xs flex items-start gap-2">
                <Badge variant="outline" className={`text-[9px] uppercase shrink-0 ${bandClass(i.band)}`}>{String(i.band).replace(/_/g, " ")}</Badge>
                <span>
                  <span className="font-medium">{i.label}</span> {i.comparativePhrase}.
                  {i.contextNote ? <span className="text-muted-foreground"> {i.contextNote}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {failing.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">What would move the needle</div>
          <ul className="space-y-1 list-disc pl-4">
            {failing.map((l, idx) => (<li key={idx} className="text-xs text-muted-foreground">{l.lever}</li>))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// AI-by-default / deterministic-backup selector.
function ModeToggle({ aiMode, setAiMode }: { aiMode: boolean; setAiMode: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5 text-[11px] font-medium" role="group" aria-label="Analysis mode">
      <button
        type="button"
        onClick={() => setAiMode(true)}
        aria-pressed={aiMode}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${aiMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Sparkles className="size-3" />AI
      </button>
      <button
        type="button"
        onClick={() => setAiMode(false)}
        aria-pressed={!aiMode}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${!aiMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Calculator className="size-3" />Engine
      </button>
    </div>
  );
}

// Shows which path actually ran the most recent computation.
function ModeBadge({ mode }: { mode: "ai" | "deterministic" }) {
  const isAI = mode === "ai";
  return (
    <Badge
      variant="outline"
      className={`text-[9px] uppercase tracking-wider ${isAI ? "bg-primary/15 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border"}`}
    >
      {isAI ? <Sparkles className="size-2.5 mr-1" /> : <Calculator className="size-2.5 mr-1" />}
      {isAI ? "AI ran" : "Deterministic"}
    </Badge>
  );
}

export function ICPanel({ projectId }: { projectId: string }) {
  const { data: decisions } = useSuspenseQuery(decisionsQ(projectId));
  const { data: flags } = useSuspenseQuery(flagsQ(projectId));
  const qc = useQueryClient();
  const fn = useServerFn(recordDecision);
  const [decision, setDecision] = useState<"approve" | "approve_with_conditions" | "reject">("approve_with_conditions");
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");

  const submit = useMutation({
    mutationFn: () => fn({ data: { project_id: projectId, decision, rationale, conditions: conditions || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions", projectId] });
      qc.invalidateQueries({ queryKey: ["audit", projectId] });
      toast.success("IC decision recorded");
      setRationale(""); setConditions("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <MemoSection projectId={projectId} />

      {flags.filter((f: any) => f.severity === "error").length > 0 && (
        <div className="space-y-2">
          {flags.filter((f: any) => f.severity === "error").map((f: any) => (
            <div key={f.id} className={`flex items-start gap-2 rounded border p-3 text-sm ${SEV_STYLES.error}`}>
              <ShieldAlert className="size-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold uppercase text-[10px] tracking-widest mr-2">reconciliation error</span>
                {f.message}
              </div>
            </div>
          ))}
        </div>
      )}

      <Card className="p-5 space-y-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">New IC decision</div>
        <div className="flex flex-wrap gap-2">
          <Button variant={decision === "approve" ? "default" : "outline"} onClick={() => setDecision("approve")}>Approve</Button>
          <Button variant={decision === "approve_with_conditions" ? "default" : "outline"} onClick={() => setDecision("approve_with_conditions")}>Approve with Conditions</Button>
          <Button variant={decision === "reject" ? "default" : "outline"} onClick={() => setDecision("reject")}>Reject</Button>
        </div>
        <Textarea rows={3} placeholder="Comment / rationale (cite approved assumptions, IRR/EM, DSCR, market guidance)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
        {decision === "approve_with_conditions" && (
          <Textarea rows={3} placeholder="Conditions (e.g. cap hard cost re-bid ≤ +5%, confirm rate ≤ 6.5%, OpEx ratio ≤ 38%)" value={conditions} onChange={(e) => setConditions(e.target.value)} />
        )}
        <Button onClick={() => submit.mutate()} disabled={!rationale || submit.isPending}>
          <Calculator className="size-4 mr-1" />Record decision
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/20 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Decision History</div>
        {decisions.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No decisions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {decisions.map((d: any) => (
              <li key={d.id} className="p-4 text-sm">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-[10px] uppercase">{d.decision.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()} · {d.user_name}</span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{d.rationale}</p>
                {d.conditions && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-widest text-chart-5">Conditions: </span>
                    <span className="whitespace-pre-wrap">{d.conditions}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const MEMO_SECTIONS: Array<{ key: string; label: string }> = [
  { key: "executive_summary", label: "Executive Summary" },
  { key: "project_description", label: "Project Description" },
  { key: "market_overview", label: "Market Overview" },
  { key: "development_plan", label: "Development Plan" },
  { key: "sources_and_uses", label: "Sources & Uses" },
  { key: "capital_stack", label: "Capital Stack" },
  { key: "approved_assumptions", label: "Approved Assumptions" },
  { key: "financial_highlights", label: "Financial Highlights" },
  { key: "sensitivity", label: "Sensitivity" },
  { key: "scenario_stress_summary", label: "Scenario / Stress Summary" },
  { key: "key_risks", label: "Key Risks" },
  { key: "risk_mitigation", label: "Risk Mitigation" },
  { key: "reconciliation_flags_summary", label: "Reconciliation Flags" },
  { key: "investment_recommendation", label: "Investment Recommendation" },
  { key: "managing_director_verdict", label: "Managing Director Verdict" },
  { key: "investment_committee_recommendation", label: "IC Recommendation" },
  { key: "sources_and_assumptions", label: "Sources & Assumptions" },
];

export function MemoSection({ projectId }: { projectId: string }) {
  const { data: memos } = useSuspenseQuery(memosQ(projectId));
  const { data: debug } = useSuspenseQuery(memoDebugQ(projectId));
  const qc = useQueryClient();
  const generateMemoFn = useServerFn(generateMemo);
  const [error, setError] = useState<string | null>(null);

  const gen = useMutation({
    mutationFn: () => generateMemoFn({ data: { project_id: projectId } }),
    onMutate: () => setError(null),
    onSuccess: (row: any) => {
      qc.invalidateQueries({ queryKey: ["memos", projectId] });
      qc.invalidateQueries({ queryKey: ["audit", projectId] });
      qc.invalidateQueries({ queryKey: ["memo-debug", projectId] });
      const mode = row?.content?.generation_mode ?? (row?.status === "generated_deterministic" ? "deterministic" : "ai");
      toast.success(mode === "deterministic"
        ? "No AI key found. Generated deterministic memo instead."
        : "AI-assisted investment memo generated");
    },
    onError: (e: Error) => {
      // Never swallow the error behind a generic toast — surface it in the UI.
      console.error("[generateMemo] failed:", e);
      setError(e.message);
      toast.error("Memo generation failed — see diagnostics");
    },
  });

  const latest: any = memos[0] ?? null;
  const content = (latest?.content ?? {}) as Record<string, any>;
  const needsReview = Boolean(latest && (content.needs_review || latest.status === "needs_review" || latest.verification_report?.pass === false));
  const orphans: any[] = latest?.verification_report?.orphans ?? [];

  const insertFailed = Boolean(error && /saving investment_memos/i.test(error));
  const provenanceFailed = Boolean(latest && latest.verification_report && latest.verification_report.pass === false);

  return (
    <Card className="p-5 space-y-3 border-primary/30">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Investment Memo</div>
        <Button size="sm" onClick={() => gen.mutate()} disabled={!debug.can_generate || gen.isPending}>
          <FileText className="size-4 mr-1" />{gen.isPending ? "Generating…" : "Generate Memo"}
        </Button>
      </div>

      {/* Preconditions */}
      {!debug.can_generate && (
        <div className="flex items-start gap-2 text-xs text-chart-5 bg-chart-5/5 border border-chart-5/20 rounded p-3">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold uppercase tracking-widest">Cannot generate memo yet</div>
            <ul className="mt-1 text-muted-foreground list-disc pl-4">
              {debug.blocking_reasons.map((r: string) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      )}
      {debug.can_generate && !debug.env.has_anthropic_key && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 border border-border rounded p-3">
          <Info className="size-4 shrink-0 mt-0.5" />
          <span>No AI key configured — the memo will be generated from the <strong>deterministic template</strong> (engine outputs + approved assumptions only).</span>
        </div>
      )}

      {/* Visible error diagnostics — not swallowed behind a toast */}
      {error && (
        <div className="text-xs bg-destructive/5 border border-destructive/30 rounded p-3 space-y-2">
          <div className="font-semibold uppercase tracking-widest text-destructive">Memo generation error</div>
          <div className="font-mono text-destructive break-words">{error}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground">
            <Diag label="financial_outputs exist" ok={debug.financial_outputs_count > 0} />
            <Diag label="cash_flows exist" ok={debug.cash_flows_count > 0} />
            <Diag label="reconciliation_flags exist" ok={debug.reconciliation_flags_count > 0} />
            <Diag label="ANTHROPIC_API_KEY configured" ok={debug.env.has_anthropic_key} />
            <Diag label="investment_memos insert failed" ok={!insertFailed} okLabel={insertFailed ? "yes" : "no"} />
            <Diag label="provenance verification failed" ok={!provenanceFailed} okLabel={provenanceFailed ? "yes" : "no"} />
          </div>
        </div>
      )}

      {/* needs_review warning */}
      {needsReview && (
        <div className="flex items-start gap-2 text-xs text-chart-5 bg-chart-5/5 border border-chart-5/20 rounded p-3">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            Memo generated but <strong>requires review</strong> because some numeric tokens lacked provenance
            {orphans.length > 0 && <> ({orphans.length} orphan token{orphans.length === 1 ? "" : "s"}: {orphans.slice(0, 8).map((o: any) => o.value ?? o).join(", ")})</>}.
          </span>
        </div>
      )}

      {/* Latest memo */}
      {latest ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {(() => {
              const mode = content.generation_mode ?? (latest.status === "generated_deterministic" ? "deterministic" : "ai");
              return (
                <Badge variant="outline" className={`text-[10px] ${mode === "deterministic" ? "text-chart-2 border-chart-2/40" : "text-primary border-primary/40"}`}>
                  {mode === "deterministic" ? "Deterministic template" : "AI-assisted"}
                </Badge>
              );
            })()}
            <Badge variant="outline" className="text-[10px] uppercase">{latest.status ?? "generated"}</Badge>
            <span>{new Date(latest.created_at).toLocaleString()}</span>
            {content.deterministic_verdict?.code && (
              <Badge variant="outline" className={`text-[10px] ${content.deterministic_verdict.code === "REJECT" ? "text-destructive border-destructive/40" : "text-primary border-primary/40"}`}>
                {content.deterministic_verdict.code}
              </Badge>
            )}
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" disabled={!content.report} onClick={() => downloadMemo("pdf", content.report)}>
                <Download className="size-3.5 mr-1" />PDF
              </Button>
              <Button size="sm" variant="outline" disabled={!content.report} onClick={() => downloadMemo("docx", content.report)}>
                <Download className="size-3.5 mr-1" />DOCX
              </Button>
            </div>
          </div>

          {content.report
            ? <MemoReportView report={content.report} />
            : MEMO_SECTIONS.filter((s) => typeof content[s.key] === "string" && content[s.key]).map((s) => (
                <div key={s.key}>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{s.label}</div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{content[s.key]}</p>
                </div>
              ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No memo yet. Run deterministic underwriting, then generate the memo.</p>
      )}

      {/* Dev-only readiness debug */}
      {import.meta.env.DEV && (
        <details className="text-[10px]">
          <summary className="cursor-pointer text-muted-foreground uppercase tracking-widest">Memo readiness debug</summary>
          <pre className="mt-2 overflow-x-auto bg-muted/30 rounded p-2 font-mono">{JSON.stringify(debug, null, 2)}</pre>
        </details>
      )}
    </Card>
  );
}

function Diag({ label, ok, okLabel }: { label: string; ok: boolean; okLabel?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={ok ? "text-success" : "text-destructive"}>{okLabel ?? (ok ? "yes" : "no")}</span>
      <span>{label}</span>
    </div>
  );
}

async function downloadMemo(kind: "pdf" | "docx", report: any) {
  if (!report) return;
  const safe = String(report.project_name ?? "Investment").replace(/[^\w]+/g, "_");
  try {
    if (kind === "pdf") {
      const { downloadMemoPdf } = await import("@/lib/memo-pdf");
      await downloadMemoPdf(report, `${safe}_Investment_Memo.pdf`);
    } else {
      const { downloadMemoDocx } = await import("@/lib/memo-docx");
      await downloadMemoDocx(report, `${safe}_Investment_Memo.docx`);
    }
  } catch (e) {
    console.error("[memo download] failed:", e);
    toast.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// On-screen rendering of the structured memo report — mirrors the PDF/DOCX.
function MemoReportView({ report }: { report: any }) {
  const isReject = report.verdict_code === "REJECT";
  return (
    <div className="space-y-4 rounded border border-border bg-background/40 p-4">
      <div>
        <div className="text-lg font-semibold">{report.title}</div>
        <div className="text-primary font-medium">{report.project_name}</div>
        <div className="text-xs text-muted-foreground">{report.subtitle} · {report.mode_label}</div>
      </div>

      {report.summary_stats?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {report.summary_stats.map((s: any) => (
            <div key={s.label} className="rounded border border-border p-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{s.label}</div>
              <div className="num text-sm">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className={`rounded px-3 py-2 text-sm font-semibold ${isReject ? "bg-destructive text-destructive-foreground" : report.verdict_code === "APPROVE" ? "bg-success text-success-foreground" : "bg-chart-5 text-warning-foreground"}`}>
        {report.verdict_banner}
      </div>
      {report.verdict_narrative && <p className="text-sm text-muted-foreground">{report.verdict_narrative}</p>}

      {report.metric_cards?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {report.metric_cards.map((c: any) => (
            <div key={c.label} className="rounded border border-border p-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{c.label}</div>
              <div className="num text-base">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {report.sections?.map((sec: any, i: number) => (
        <div key={sec.heading}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">{i + 1}. {sec.heading}</div>
          {sec.table && (
            <div className="overflow-x-auto">
              <table className="data-grid w-full text-xs">
                <thead><tr className="bg-muted/20">{sec.table.columns.map((c: string) => <th key={c} className="text-left">{c}</th>)}</tr></thead>
                <tbody>
                  {sec.table.rows.map((r: string[], ri: number) => (
                    <tr key={ri}>{r.map((cell, ci) => <td key={ci} className={ci === 0 ? "font-medium" : "num"}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sec.body && <p className="text-sm whitespace-pre-wrap">{sec.body}</p>}
          {sec.table?.note && <p className="text-[10px] italic text-muted-foreground mt-1">Note: {sec.table.note}</p>}
        </div>
      ))}

      {report.footnotes?.length > 0 && (
        <div className="border-t border-border pt-2 space-y-1">
          {report.footnotes.map((f: string, i: number) => <p key={i} className="text-[10px] text-muted-foreground">{f}</p>)}
        </div>
      )}
    </div>
  );
}

export function AuditPanel({ projectId }: { projectId: string }) {
  const { data: audit } = useSuspenseQuery(auditQ(projectId));
  const groups = [
    { label: "Assumption Changes", rows: audit.filter((a: any) => a.entity_type === "assumption" || String(a.action).startsWith("assumption_")) },
    { label: "Decision Changes", rows: audit.filter((a: any) => a.entity_type === "decision" || a.action === "ic_decision") },
    { label: "User Activity", rows: audit.filter((a: any) => a.entity_type !== "assumption" && a.entity_type !== "decision") },
    { label: "Version History", rows: audit.filter((a: any) => a.action === "extract_assumptions" || a.action === "recompute_outputs") },
  ];
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.label} className="overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/20 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{group.label}</div>
          {group.rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No {group.label.toLowerCase()} yet.</p>
          ) : (
            <table className="data-grid w-full">
              <thead><tr className="bg-muted/10">
                <th className="text-left">Time</th>
                <th className="text-left">Action</th>
                <th className="text-left">Entity</th>
                <th className="text-left">Payload</th>
              </tr></thead>
              <tbody>
                {group.rows.map((a: any) => (
                  <tr key={a.id} className="hover:bg-accent/20">
                    <td className="text-xs font-mono text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="font-medium">{a.action}</td>
                    <td className="text-xs text-muted-foreground">{a.entity_type}</td>
                    <td className="text-[10px] font-mono text-muted-foreground max-w-md truncate">{JSON.stringify(a.payload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  );
}
