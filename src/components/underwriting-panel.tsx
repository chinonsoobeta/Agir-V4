// Underwriting tab: fail-closed. When readiness is blocked it renders the
// blocked state listing exactly what is missing/unresolved: zero metrics,
// zero charts, no partial numbers. When ready, every figure shown is a
// deterministic engine output with its formula and provenance.

import { useState, type KeyboardEvent } from "react";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listFinancialOutputs,
  listRisks,
  listDecisions,
  listAudit,
  recordDecision,
  listAssumptions,
} from "@/lib/assumptions.functions";
import {
  acceptDefaults,
  getUnderwritingReadiness,
  getUnderwritingRunState,
  listReconciliationFlags,
  resolveConflict,
  runFullUnderwriting,
} from "@/lib/underwriting.functions";
import { generateMemo, listMemos, debugMemoReadiness } from "@/lib/memo.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ExplainableNumber, type ExplainableRow } from "@/components/provenance-popover";
import {
  AlertTriangle,
  ShieldAlert,
  Info,
  Calculator,
  Lock,
  Scale,
  FileText,
  Download,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import type { DealContext, Interpretation } from "@/lib/context/types";
import type { WhatIfLever } from "@/lib/context/attribution";
import type { MemoReport } from "@/lib/memo-report";
import { statusClassName, statusConfig } from "@/lib/status-taxonomy";

// The structured payload runFullUnderwriting writes into financial_outputs.inputs.
// It is stored as Json in the row; every field is optional because different
// metric rows (verdict, insight, plain metrics) carry different subsets.
type OutputInputs = {
  recommendation?: string;
  recommendationRationale?: string;
  code?: string;
  context?: DealContext | null;
  interpretations?: Interpretation[];
  levers?: WhatIfLever[];
  portfolioSample?: number;
} | null;
type OutputRow = Omit<Tables<"financial_outputs">, "inputs"> & { inputs: OutputInputs };
type ReadinessResult = Awaited<ReturnType<typeof getUnderwritingReadiness>>;
type ReadinessDefault = ReadinessResult["defaults"][number];
type ReadinessConflict = ReadinessResult["conflicts"][number];
type ConflictValue = { value: number | string; source?: string | null };
type ReconciliationFlagRow = Tables<"reconciliation_flags">;
type AssumptionRow = Tables<"assumptions"> & {
  documents?: { name: string } | null;
  source?: string | null;
};
type RunResult = Awaited<ReturnType<typeof runFullUnderwriting>>;
type AcceptDefaultsResult = Awaited<ReturnType<typeof acceptDefaults>>;
type ResolveConflictResult = Awaited<ReturnType<typeof resolveConflict>>;
type DecisionLogRow = Tables<"decision_logs">;
type AuditLogRow = Tables<"audit_logs">;
type MemoVerificationReport = {
  pass?: boolean;
  orphans?: Array<{ value?: string } | string>;
} | null;
type MemoContent = {
  report?: MemoReport;
  generation_mode?: "ai" | "deterministic";
  needs_review?: boolean;
  deterministic_verdict?: { code?: string };
  [section: string]: unknown;
};
type MemoRow = Omit<Tables<"investment_memos">, "content" | "verification_report"> & {
  content: MemoContent | null;
  verification_report: MemoVerificationReport;
};
type RunVersionRow = {
  id: string;
  run_number: number;
  run_mode: string;
  status: string;
  verdict_code: string | null;
  input_fingerprint: string;
  output_fingerprint: string | null;
  input_snapshot: unknown;
  output_snapshot: unknown;
  computed_at: string;
};

const outputsQ = (pid: string) =>
  queryOptions({
    queryKey: ["outputs", pid],
    queryFn: () => listFinancialOutputs({ data: { project_id: pid } }),
  });
const risksQ = (pid: string) =>
  queryOptions({
    queryKey: ["risks", pid],
    queryFn: () => listRisks({ data: { project_id: pid } }),
  });
const decisionsQ = (pid: string) =>
  queryOptions({
    queryKey: ["decisions", pid],
    queryFn: () => listDecisions({ data: { project_id: pid } }),
  });
const auditQ = (pid: string) =>
  queryOptions({
    queryKey: ["audit", pid],
    queryFn: () => listAudit({ data: { project_id: pid } }),
  });
const readinessQ = (pid: string) =>
  queryOptions({
    queryKey: ["uw-readiness", pid],
    queryFn: () => getUnderwritingReadiness({ data: { project_id: pid } }),
  });
const runStateQ = (pid: string) =>
  queryOptions({
    queryKey: ["uw-run-state", pid],
    queryFn: () => getUnderwritingRunState({ data: { project_id: pid } }),
  });
const flagsQ = (pid: string) =>
  queryOptions({
    queryKey: ["recon-flags", pid],
    queryFn: () => listReconciliationFlags({ data: { project_id: pid } }),
  });
const memosQ = (pid: string) =>
  queryOptions({
    queryKey: ["memos", pid],
    queryFn: () => listMemos({ data: { project_id: pid } }),
  });
const memoDebugQ = (pid: string) =>
  queryOptions({
    queryKey: ["memo-debug", pid],
    queryFn: () => debugMemoReadiness({ data: { project_id: pid } }),
  });
const assumptionsQ = (pid: string) =>
  queryOptions({
    queryKey: ["assumptions", pid],
    queryFn: () => listAssumptions({ data: { project_id: pid } }),
  });

const SCENARIO_LABELS: Record<string, string> = {
  base: "Base Case",
  revenue_down: "Revenue Downside (−10%)",
  cost_overrun: "Cost Overrun (+10%)",
  rate_shock: "Rate Shock (+150 bps)",
  cap_expansion: "Cap Expansion (+75 bps)",
  combined: "Combined Stress",
  occupancy_down: "Occupancy Downside (−500 bps)",
  expense_inflation: "Expense Inflation (+500 bps)",
};
const SCENARIO_ORDER = [
  "cap_expansion",
  "cost_overrun",
  "rate_shock",
  "revenue_down",
  "occupancy_down",
  "expense_inflation",
  "combined",
];
const SEV_STYLES: Record<string, string> = {
  info: "bg-muted text-muted-foreground border-border",
  warning: "bg-warning/15 text-warning border-warning/30",
  yellow: "bg-warning/15 text-warning border-warning/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  red: "bg-destructive/15 text-destructive border-destructive/30",
  critical: "bg-destructive text-destructive-foreground border-destructive",
};

const INPUT_LABELS: Record<string, string> = {
  "budget:land": "Budget: land",
  "budget:hard": "Budget: hard costs",
  "budget:soft": "Budget: soft costs",
  "budget:contingency": "Budget: contingency",
  "budget:financing_interest": "Budget: financing",
  revenue_program: "Revenue program (≥1 component)",
  loan_amount: "Loan amount",
  interest_rate_pct: "Interest rate",
  amort_years: "Amortization term",
  equity_amount: "Equity amount",
  exit_cap_rate_pct: "Exit cap rate",
  expense_ratio_pct: "Expense ratio",
  hold_years: "Hold period",
  selling_costs_pct: "Selling costs",
};
const inputLabel = (key: string) =>
  INPUT_LABELS[key] ??
  (key.startsWith("occupancy:") ? `Stabilized occupancy: ${key.slice(10)}` : key);

// Conflict values are raw numbers; append the unit the key implies so e.g. an
// exit cap reads "4.75%" not "4.75". Only percentage keys get a suffix; dollar
// and count keys are left as-is.
const conflictValueLabel = (key: string, value: number | string) =>
  /(_pct$|occupancy|rate|ratio)/.test(key) ? `${value}%` : String(value);

function fmtValue(v: number | null, unit: string | null, formula?: string | null) {
  if (v == null || !isFinite(v)) {
    return formula?.includes("not meaningful") ? "not meaningful" : "–";
  }
  if (unit === "$")
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 1,
    }).format(v);
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "x") return `${v.toFixed(2)}x`;
  if (unit === "bps") return `${v.toFixed(0)} bps`;
  return v.toLocaleString();
}

export function UnderwritingPanel({ projectId }: { projectId: string }) {
  const { data: outputs } = useSuspenseQuery(outputsQ(projectId));
  const { data: risks } = useSuspenseQuery(risksQ(projectId));
  const { data: readiness } = useSuspenseQuery(readinessQ(projectId));
  const { data: runState } = useSuspenseQuery(runStateQ(projectId));
  const { data: flags } = useSuspenseQuery(flagsQ(projectId));
  const { data: assumptions } = useSuspenseQuery(assumptionsQ(projectId));
  const qc = useQueryClient();
  const runFn = useServerFn(runFullUnderwriting);
  const acceptDefaultsFn = useServerFn(acceptDefaults);
  const resolveFn = useServerFn(resolveConflict);

  const [lastMode, setLastMode] = useState<"ai" | "deterministic" | null>(null);
  const [lastBlockedReason, setLastBlockedReason] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastAcceptedDefaults, setLastAcceptedDefaults] = useState<string[]>([]);
  const [lastCompletedRun, setLastCompletedRun] = useState<{
    mode: "ai" | "deterministic";
    verdict: string;
    at: string;
  } | null>(null);

  const invalidate = async () => {
    await Promise.all(
      [
        "outputs",
        "risks",
        "uw-readiness",
        "recon-flags",
        "assumptions",
        "readiness",
        "audit",
        "decisions",
        "memos",
        "memo-debug",
        "uw-run-state",
      ].map((key) => qc.invalidateQueries({ queryKey: [key, projectId] })),
    );
  };

  const run = useMutation({
    mutationFn: () => runFn({ data: { project_id: projectId, mode: "deterministic" } }),
    onMutate: () => {
      setStatusMessage("Running deterministic underwriting from explicitly approved inputs.");
      setLastBlockedReason(null);
    },
    onSuccess: async (r: RunResult) => {
      await invalidate();
      setLastMode(r.analysis_mode ?? null);
      setLastBlockedReason(
        r.blocked
          ? [
              r.readiness?.missing?.length
                ? `missing ${r.readiness.missing.map(inputLabel).join(", ")}`
                : null,
              r.readiness?.conflicting?.length
                ? `conflicting ${r.readiness.conflicting.map(inputLabel).join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join("; ") || "readiness blocked"
          : null,
      );
      if (r.blocked) {
        setLastCompletedRun(null);
        setStatusMessage("Run blocked. The engine did not persist partial metrics.");
      } else {
        setLastCompletedRun({
          mode: r.analysis_mode ?? "deterministic",
          verdict: r.verdict.code,
          at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        });
        setStatusMessage(
          "Run complete. Results, risks, reconciliation flags, and audit are refreshed.",
        );
      }
      if (r.ai_note) toast.message(r.ai_note);
      if (r.ai_accepted_defaults?.length) {
        toast.message(
          `AI accepted ${r.ai_accepted_defaults.length} static default(s) to unblock the run.`,
        );
      }
      if (r.authority_note) toast.message(r.authority_note);
      if (r.blocked) toast.error("Underwriting is blocked: resolve the listed inputs first.");
      else toast.success(`Deterministic underwriting complete: verdict ${r.verdict.code}`);
    },
    onError: (e: Error) => {
      setStatusMessage("Run failed before any new metrics were accepted.");
      toast.error(e.message);
    },
  });
  const runNow = () => {
    if (!run.isPending) {
      run.mutate();
    }
  };
  const runOnKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    runNow();
  };
  const acceptDefaultsMut = useMutation({
    mutationFn: () => acceptDefaultsFn({ data: { project_id: projectId } }),
    onMutate: () => {
      setStatusMessage("Accepting static defaults with source=default provenance.");
    },
    onSuccess: async (r: AcceptDefaultsResult) => {
      await invalidate();
      setLastAcceptedDefaults(r.accepted);
      setStatusMessage(
        r.accepted.length
          ? `Accepted ${r.accepted.length} default(s). Readiness refreshed.`
          : "No defaultable gaps were available. Readiness refreshed.",
      );
      toast.success(`Accepted ${r.accepted.length} default(s)`);
    },
    onError: (e: Error) => {
      setStatusMessage("Default acceptance failed. No defaults were applied silently.");
      toast.error(e.message);
    },
  });
  const resolve = useMutation({
    mutationFn: (d: { key: string; mode: "pick" | "conservative"; value?: number }) =>
      resolveFn({ data: { project_id: projectId, ...d } }),
    onMutate: () => {
      setStatusMessage("Resolving the documented conflict and refreshing readiness.");
    },
    onSuccess: async (r: ResolveConflictResult) => {
      await invalidate();
      setStatusMessage(`${inputLabel(r.key)} resolved to ${r.resolved}. Readiness refreshed.`);
      toast.success(`Resolved ${r.key} → ${r.resolved}`);
    },
    onError: (e: Error) => {
      setStatusMessage("Conflict resolution failed. The engine remains blocked.");
      toast.error(e.message);
    },
  });

  const blocked = readiness.status === "blocked";
  const workflowPermissions = runState.permissions ?? {
    canRunUnderwriting: true,
    canGenerateMemo: true,
    canRecordDecision: true,
    canExportAuditPackage: true,
    canManageWorkspace: false,
  };
  const canRunWorkflow = workflowPermissions.canRunUnderwriting;
  const defaultKeys = new Set(readiness.defaults.map((d: ReadinessDefault) => d.key));
  const defaultableMissing = readiness.missing.filter((key: string) => defaultKeys.has(key));
  const nonDefaultMissing = readiness.missing.filter((key: string) => !defaultKeys.has(key));
  const canAcceptDefaultsAndRun =
    readiness.defaults.length > 0 &&
    readiness.conflicts.length === 0 &&
    nonDefaultMissing.length === 0;
  const busy = run.isPending || acceptDefaultsMut.isPending || resolve.isPending;

  // ---- BLOCKED STATE: no metrics, no charts, no partial numbers. ----
  if (blocked) {
    const blockedStatus = statusConfig("underwriting", "blocked");
    const blockerParts = [
      readiness.conflicts.length ? `${readiness.conflicts.length} conflict(s)` : null,
      nonDefaultMissing.length ? `${nonDefaultMissing.length} sourced input(s)` : null,
      defaultableMissing.length ? `${defaultableMissing.length} defaultable input(s)` : null,
    ].filter(Boolean);
    return (
      <div className="space-y-4">
        <Card className="p-6 border-destructive/40">
          <div className="flex items-start gap-3">
            <Lock className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={`${statusClassName(blockedStatus.severity)} text-[11px]`}
                >
                  {blockedStatus.label}
                </Badge>
                <div className="text-sm font-semibold uppercase tracking-widest text-destructive">
                  Underwriting blocked
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {blockedStatus.message} The engine runs only on approved or default-accepted inputs.
                It never fills gaps on its own. Resolve the items below, then run underwriting.
              </p>
              <div
                role="status"
                aria-live="polite"
                className="mt-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {busy ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Lock className="size-4 text-destructive" />
                  )}
                  <span className="font-medium">
                    Blocking run: {blockerParts.join(", ") || "readiness check failed"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {statusMessage ??
                    (canAcceptDefaultsAndRun
                      ? "Only static defaults are missing; accepting them can unlock a run."
                      : "Resolve conflicts and sourced gaps first. Defaults can be accepted, but they cannot override evidence conflicts.")}
                </div>
              </div>
              {readiness.missing.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Missing inputs
                  </div>
                  <ul className="mt-1 space-y-1">
                    {readiness.missing.map((k: string) => (
                      <li key={k} className="text-sm flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-destructive inline-block" />
                        {inputLabel(k)}
                        {readiness.defaults.some((d: ReadinessDefault) => d.key === k) && (
                          <Badge variant="outline" className="text-[11px]">
                            default available
                          </Badge>
                        )}
                        {!readiness.defaults.some((d: ReadinessDefault) => d.key === k) && (
                          <Badge variant="outline" className="text-[11px]">
                            source required
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {readiness.conflicts.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Conflicting inputs: resolve explicitly
                  </div>
                  {readiness.conflicts.map((c: ReadinessConflict) => (
                    <div
                      key={c.key}
                      className="mt-2 p-3 rounded border border-destructive/30 bg-destructive/5"
                    >
                      <div className="text-sm font-medium">{inputLabel(c.key)}</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {(c.conflict_values as ConflictValue[]).map(
                          (v: ConflictValue, i: number) => (
                            <div key={i} className="p-2 rounded border border-border bg-background">
                              <div className="num text-lg">
                                {conflictValueLabel(c.key, v.value)}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {v.source ?? "unknown source"}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-2"
                                disabled={resolve.isPending || !canRunWorkflow}
                                onClick={() =>
                                  resolve.mutate({
                                    key: c.key,
                                    mode: "pick",
                                    value: Number(v.value),
                                  })
                                }
                              >
                                {resolve.isPending ? "Resolving..." : "Use this value"}
                              </Button>
                            </div>
                          ),
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="mt-2"
                        disabled={resolve.isPending || !canRunWorkflow}
                        onClick={() => resolve.mutate({ key: c.key, mode: "conservative" })}
                        title={
                          canRunWorkflow
                            ? "Resolve using the conservative documented value."
                            : "Read-only role: cannot resolve conflicts."
                        }
                      >
                        {resolve.isPending ? (
                          <Loader2 className="size-3.5 mr-1 animate-spin" />
                        ) : (
                          <Scale className="size-3.5 mr-1" />
                        )}
                        {resolve.isPending ? "Resolving..." : "Use conservative"}
                      </Button>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Conservative picks the documented value with the lower valuation/return.
                        Values are never averaged.
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {readiness.defaults.length > 0 && (
                <div className="mt-4 p-3 rounded border border-border bg-muted/10">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Static defaults available
                  </div>
                  <ul className="mt-1 text-sm text-muted-foreground">
                    {readiness.defaults.map((d: ReadinessDefault) => (
                      <li key={d.key}>{d.label}</li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={acceptDefaultsMut.isPending || !canRunWorkflow}
                      onClick={() => acceptDefaultsMut.mutate()}
                      title={
                        canRunWorkflow
                          ? "Accept static defaults with audit-backed provenance."
                          : "Read-only role: cannot accept defaults."
                      }
                    >
                      {acceptDefaultsMut.isPending ? (
                        <Loader2 className="size-3.5 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5 mr-1" />
                      )}
                      {acceptDefaultsMut.isPending
                        ? "Accepting defaults..."
                        : `Accept ${readiness.defaults.length} defaults`}
                    </Button>
                  </div>
                  {lastAcceptedDefaults.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {lastAcceptedDefaults.map((key) => (
                        <Badge key={key} variant="outline" className="text-[11px]">
                          {inputLabel(key)} accepted
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Writes source=default, status=default_accepted rows only after this explicit
                    analyst action. AI cannot accept or approve underwriting inputs.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>
        <RunHistory
          runs={(runState.runs ?? []) as RunVersionRow[]}
          currentFingerprint={runState.current_input_fingerprint}
        />
      </div>
    );
  }

  const byScenario = (outputs as OutputRow[]).reduce<Record<string, OutputRow[]>>((acc, o) => {
    (acc[o.scenario_key] ||= []).push(o);
    return acc;
  }, {});
  const base = (byScenario.base ?? []).filter(
    (m) =>
      m.metric_key !== "verdict" && m.metric_key !== "risk_score" && m.metric_key !== "insight",
  );
  const metricKeys = base.map((m) => m.metric_key);
  const scenarioKeys = SCENARIO_ORDER.filter((k) => byScenario[k]?.length);
  const metric = (key: string) => base.find((b) => b.metric_key === key);
  const verdictRow = (byScenario.base ?? []).find((m) => m.metric_key === "verdict");
  const riskScoreRow = (byScenario.base ?? []).find((m) => m.metric_key === "risk_score");
  const insightRow = (byScenario.base ?? []).find((m) => m.metric_key === "insight");
  // ONE reconciled recommendation (gate verdict + findings + context); falls back
  // to the raw gate verdict for deals underwritten before reconciliation existed.
  const recommendation = insightRow?.inputs?.recommendation ?? verdictRow?.inputs?.code ?? "–";
  const recRationale =
    (insightRow?.inputs?.recommendationRationale as string | undefined) ?? verdictRow?.formula_text;
  const irrRow = metric("irr_estimate");
  const equityWipeout = Boolean(
    metric("equity_multiple")?.formula_text?.includes("Equity wipeout"),
  );
  const defaultedKeys: string[] = readiness.defaultedKeys ?? [];
  const outputsStale = runState.freshness === "stale";

  // IC-grade structure: surface the LP/GP waterfall and a multi-tranche stack
  // only when they are configured. Without them the LP return equals the deal
  // return, so there is nothing distinct to show and the block stays hidden.
  const gpPromoteRow = metric("gp_promote");
  const waterfallActive = gpPromoteRow != null && Number(gpPromoteRow.value_numeric) > 0;
  const totalDsRow = metric("total_debt_service");
  const seniorDsRow = metric("annual_debt_service");
  const mezzActive =
    totalDsRow != null &&
    seniorDsRow != null &&
    Number(totalDsRow.value_numeric) > Number(seniorDsRow.value_numeric) + 1;

  // Evidence trail: group the approved engine inputs by the document (or analyst
  // / default origin) that supplied each one, so a reader can trace a headline
  // output back to the source it ultimately came from -- the "every number is
  // traceable" promise made visible, not just asserted.
  const PROVENANCE_STATUSES = new Set([
    "approved",
    "default_accepted",
    "calculated",
    "extracted",
    "modified",
  ]);
  const sourceGroups: Array<[string, string[]]> = (() => {
    const groups = new Map<string, string[]>();
    for (const a of (assumptions as AssumptionRow[]) ?? []) {
      if (!PROVENANCE_STATUSES.has(a.status)) continue;
      const docName: string | undefined = a.documents?.name;
      const origin = docName
        ? docName
        : a.status === "default_accepted" || a.source === "default"
          ? "Static defaults (no document)"
          : a.source === "analyst" || a.status === "modified"
            ? "Analyst entry"
            : "Extracted (unlinked)";
      const arr = groups.get(origin) ?? [];
      arr.push(a.field_label ?? a.field_key);
      groups.set(origin, arr);
    }
    return [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  })();

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runNow();
          }}
        >
          <Button
            type="button"
            onClick={runNow}
            onKeyDown={runOnKeyboard}
            disabled={run.isPending || !canRunWorkflow}
            title={
              !canRunWorkflow
                ? "Read-only role: cannot run underwriting."
                : run.isPending
                  ? "Wait for the current deterministic run to finish."
                  : "Run the deterministic engine from approved and default-accepted inputs."
            }
          >
            {run.isPending ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Calculator className="size-4 mr-1" />
            )}
            {run.isPending
              ? "Running..."
              : outputs.length
                ? "Re-run Deterministic Underwriting"
                : "Run Deterministic Underwriting"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void invalidate().then(() => setStatusMessage("Latest underwriting data refreshed."));
            }}
            disabled={run.isPending}
            title={run.isPending ? "Wait for the current deterministic run to finish." : undefined}
          >
            <RefreshCw className="size-4 mr-1" />
            Refresh Results
          </Button>
          {lastMode && <ModeBadge mode={lastMode} />}
          <span className="text-[11px] text-muted-foreground font-mono ml-auto">
            engine computes every number · inputs require explicit analyst approval
          </span>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className="text-[11px] bg-success/10 text-success border-success/30"
          >
            Ready to run
          </Badge>
          {outputsStale ? (
            <Badge
              variant="outline"
              className="text-[11px] bg-warning/10 text-warning border-warning/30"
            >
              Outputs stale
            </Badge>
          ) : outputs.length ? (
            <Badge
              variant="outline"
              className="text-[11px] bg-success/10 text-success border-success/30"
            >
              Outputs current
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[11px]">
              Pending run
            </Badge>
          )}
          {defaultedKeys.length > 0 && (
            <Badge
              variant="outline"
              className="text-[11px] bg-warning/10 text-warning border-warning/30"
            >
              {defaultedKeys.length} accepted default{defaultedKeys.length === 1 ? "" : "s"}
            </Badge>
          )}
          {run.isPending && (
            <Badge variant="outline" className="text-[11px]">
              Running
            </Badge>
          )}
        </div>
        <div
          role="status"
          aria-live="polite"
          className="mt-3 rounded border border-border bg-muted/10 px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            {run.isPending ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : lastCompletedRun ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : outputs.length ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <Calculator className="size-4 text-muted-foreground" />
            )}
            <span className="font-medium">
              {run.isPending
                ? "Deterministic engine running"
                : lastCompletedRun
                  ? `Run complete at ${lastCompletedRun.at}: ${lastCompletedRun.verdict}`
                  : outputs.length
                    ? `Results loaded: ${recommendation}`
                    : "Inputs ready; no underwriting run has been persisted yet"}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {statusMessage ??
              (outputs.length
                ? outputsStale
                  ? "Approved inputs changed after the last computed output. Re-run underwriting before relying on results."
                  : "Base case, stress runs, risks, and audit are in sync with the latest loaded data."
                : "Run underwriting to persist base case, stress runs, risk register, reconciliation flags, and audit.")}
          </div>
        </div>
        {defaultedKeys.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="uppercase tracking-widest text-[11px] font-semibold">
              Defaults in effect:
            </span>
            {defaultedKeys.map((k) => (
              <Badge key={k} variant="outline" className="text-[11px]">
                {inputLabel(k)} · default
              </Badge>
            ))}
          </div>
        )}
        {run.error && (
          <div className="mt-3 rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {run.error.message}
          </div>
        )}
        {lastBlockedReason && (
          <div className="mt-3 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
            Underwriting run blocked: {lastBlockedReason}
          </div>
        )}
      </Card>

      <RunHistory
        runs={(runState.runs ?? []) as RunVersionRow[]}
        currentFingerprint={runState.current_input_fingerprint}
      />

      {/* Reconciliation banners: error flags cannot be silently dropped */}
      {flags.length > 0 && (
        <div className="space-y-2">
          {flags.map((f: ReconciliationFlagRow) => (
            <div
              key={f.id}
              className={`flex items-start gap-2 rounded border p-3 text-sm ${SEV_STYLES[f.severity] ?? SEV_STYLES.info}`}
            >
              {f.severity === "error" ? (
                <ShieldAlert className="size-4 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              )}
              <div>
                <span className="font-semibold uppercase text-[11px] tracking-widest mr-2">
                  {f.severity}
                </span>
                {f.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Headline metrics: announced to assistive tech when a run completes */}
      <div role="status" aria-live="polite">
        <span className="sr-only">
          {run.isPending
            ? "Running underwriting…"
            : `Underwriting results updated. Recommendation ${recommendation}.`}
        </span>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <UnderwritingMetric
            label="Recommendation"
            text={recommendation}
            sub={recRationale}
            highlight={
              recommendation === "REJECT" || recommendation === "RETURN_TO_UNDERWRITING"
                ? "text-destructive"
                : "text-primary"
            }
          />
          <UnderwritingMetric label="Exit Value" row={metric("exit_value")} />
          <UnderwritingMetric
            label="IRR"
            row={irrRow}
            text={equityWipeout ? "not meaningful" : undefined}
            sub={equityWipeout ? "Equity loss: IRR not meaningful" : undefined}
            highlight={equityWipeout ? "text-destructive" : undefined}
          />
          <UnderwritingMetric label="DSCR (amortizing)" row={metric("dscr")} />
          <UnderwritingMetric
            label="Equity Multiple"
            row={metric("equity_multiple")}
            highlight={equityWipeout ? "text-destructive" : undefined}
          />
          <UnderwritingMetric label="Debt Yield" row={metric("debt_yield")} />
          <UnderwritingMetric label="Break-even Occ." row={metric("break_even_occupancy")} />
          <UnderwritingMetric
            label="Risk Score"
            text={riskScoreRow ? String(Math.round(Number(riskScoreRow.value_numeric))) : "–"}
            sub={riskScoreRow?.formula_text}
          />
        </div>
      </div>

      {equityWipeout && (
        <div className={`rounded border p-3 text-sm ${SEV_STYLES.error}`}>
          <ShieldAlert className="size-4 inline mr-2" />
          Equity wipeout: net sale proceeds are below the loan payoff at exit. EM ≈ 0.0x; IRR is not
          meaningful.
        </div>
      )}

      {/* IC-grade capital structure: multi-tranche debt and the LP/GP waterfall. */}
      {(waterfallActive || mezzActive) && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Scale className="size-3.5 text-muted-foreground" />
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Capital Structure &amp; LP / GP Returns
            </div>
          </div>
          {mezzActive && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <UnderwritingMetric label="Total Debt" row={metric("total_debt")} />
              <UnderwritingMetric label="Senior DSCR" row={metric("senior_dscr")} />
              <UnderwritingMetric label="All-in DSCR" row={metric("all_in_dscr")} />
              <UnderwritingMetric label="All-in Debt Service" row={metric("total_debt_service")} />
            </div>
          )}
          {waterfallActive && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <UnderwritingMetric label="Deal IRR" row={irrRow} />
                <UnderwritingMetric
                  label="LP IRR"
                  row={metric("lp_irr")}
                  highlight="text-chart-2"
                />
                <UnderwritingMetric label="GP IRR" row={metric("gp_irr")} />
                <UnderwritingMetric label="GP Promote" row={metric("gp_promote")} />
                <UnderwritingMetric label="LP Equity Multiple" row={metric("lp_equity_multiple")} />
                <UnderwritingMetric label="GP Equity Multiple" row={metric("gp_equity_multiple")} />
                <UnderwritingMetric
                  label="LP Preferred Return"
                  row={metric("lp_preferred_return")}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                LP return is what an investor actually earns after the preferred return and GP
                promote. The deal IRR is the return on total equity before the split; the difference
                is the carried interest.
              </p>
            </>
          )}
        </Card>
      )}

      <DeterministicRead row={insightRow} />

      {!outputs.length && (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Inputs are ready. Run underwriting to compute the pro forma.
        </Card>
      )}

      {/* Full metric table with the five stress scenarios */}
      {outputs.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/20 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
            Pro Forma: Base & Stress (every cell is an engine re-run)
          </div>
          <div className="overflow-x-auto">
            <table className="data-grid w-full">
              <thead>
                <tr className="bg-muted/10">
                  <th className="text-left">Metric</th>
                  <th className="text-right text-primary">{SCENARIO_LABELS.base}</th>
                  {scenarioKeys.map((k) => (
                    <th key={k} className="text-right">
                      {SCENARIO_LABELS[k] ?? k}
                    </th>
                  ))}
                  <th className="text-left">Formula</th>
                </tr>
              </thead>
              <tbody>
                {metricKeys.map((mk) => {
                  const baseRow = base.find((b) => b.metric_key === mk);
                  return (
                    <tr key={mk}>
                      <td className="font-medium">{baseRow?.metric_label}</td>
                      <td className="text-right num text-primary">
                        <ExplainableNumber
                          row={baseRow as ExplainableRow}
                          label={baseRow?.metric_label ?? undefined}
                        >
                          {fmtValue(
                            baseRow?.value_numeric == null ? null : Number(baseRow.value_numeric),
                            baseRow?.unit ?? "",
                            baseRow?.formula_text,
                          )}
                        </ExplainableNumber>
                      </td>
                      {scenarioKeys.map((sk) => {
                        const r = byScenario[sk].find((b) => b.metric_key === mk);
                        return (
                          <td key={sk} className="text-right align-top">
                            <div className="num">
                              {r
                                ? fmtValue(
                                    r.value_numeric == null ? null : Number(r.value_numeric),
                                    r.unit,
                                    r.formula_text,
                                  )
                                : "–"}
                            </div>
                            {r?.formula_text && (
                              <div className="mt-1 text-[11px] leading-snug text-muted-foreground font-mono max-w-56 ml-auto">
                                {r.formula_text}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-xs text-muted-foreground font-mono max-w-md">
                        {baseRow?.formula_text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Evidence: trace the pro forma back to the documents behind it */}
      {outputs.length > 0 && sourceGroups.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <FileText className="size-3.5 text-muted-foreground" />
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Evidence: source documents behind these numbers
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Every figure above is computed only from these approved inputs. Each input traces to the
            document (or analyst entry) that supplied it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {sourceGroups.map(([source, fields]) => (
              <div key={source} className="rounded border border-border bg-muted/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate" title={source}>
                    {source}
                  </span>
                  <Badge variant="outline" className="ml-auto text-[11px]">
                    {fields.length}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {fields.map((f, i) => (
                    <span
                      key={i}
                      className="text-[11px] rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Risk register: fixed thresholds over engine outputs + flags */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
          Risk Register
        </div>
        {risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No automated flags from the latest engine run.
          </p>
        ) : (
          <ul className="space-y-2">
            {risks.map((r) => {
              const Icon =
                r.severity === "red" || r.severity === "critical"
                  ? ShieldAlert
                  : r.severity === "yellow"
                    ? AlertTriangle
                    : Info;
              return (
                <li
                  key={r.id}
                  className="flex items-start gap-3 p-3 rounded border border-border bg-muted/10"
                >
                  <Icon className="size-4 mt-0.5 text-warning shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{r.title}</span>
                      <Badge
                        variant="outline"
                        className={`${SEV_STYLES[r.severity]} text-[11px] uppercase`}
                      >
                        {r.severity}
                      </Badge>
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

function UnderwritingMetric({
  label,
  row,
  text,
  sub,
  highlight,
}: {
  label: string;
  row?: OutputRow;
  text?: string;
  sub?: string | null;
  highlight?: string;
}) {
  const display =
    text ??
    (row
      ? fmtValue(
          row.value_numeric == null ? null : Number(row.value_numeric),
          row.unit,
          row.formula_text,
        )
      : "–");
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`num text-2xl mt-1 ${highlight ?? "text-primary"}`}>
        {row && text == null ? (
          <ExplainableNumber row={row as ExplainableRow} label={label}>
            {display}
          </ExplainableNumber>
        ) : (
          display
        )}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1 font-mono line-clamp-2">
        {sub ?? row?.formula_text ?? "Pending underwriting run"}
      </div>
    </Card>
  );
}

function shortHash(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "pending";
}

function runModeLabel(mode: string) {
  return mode === "ai_assisted_default_selection"
    ? "AI-assisted default selection"
    : "Deterministic run";
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function flattenSnapshot(value: unknown, prefix = ""): Record<string, unknown> {
  if (value == null || typeof value !== "object") return prefix ? { [prefix]: value } : {};
  if (Array.isArray(value)) {
    return value.reduce<Record<string, unknown>>((acc, item, index) => {
      Object.assign(acc, flattenSnapshot(item, `${prefix}${prefix ? "." : ""}${index}`));
      return acc;
    }, {});
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(asPlainRecord(value))) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (raw != null && typeof raw === "object") Object.assign(out, flattenSnapshot(raw, nextKey));
    else out[nextKey] = raw;
  }
  return out;
}

function outputMap(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  const wanted = new Set([
    "base::exit_value",
    "base::dscr",
    "base::irr_estimate",
    "base::equity_multiple",
    "base::development_profit",
    "base::verdict",
  ]);
  const out = new Map<string, { label: string; value: unknown; unit: string | null }>();
  for (const raw of rows) {
    const row = asPlainRecord(raw);
    const key = `${row.scenario_key}::${row.metric_key}`;
    if (!wanted.has(key)) continue;
    out.set(key, {
      label: String(row.metric_label ?? row.metric_key ?? key),
      value: row.value_numeric ?? row.formula_text ?? null,
      unit: typeof row.unit === "string" ? row.unit : null,
    });
  }
  return out;
}

function compactChanges(a: Record<string, unknown>, b: Record<string, unknown>, limit: number) {
  const rows: Array<{ key: string; was: unknown; now: unknown }> = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null)) continue;
    rows.push({ key, was: a[key] ?? null, now: b[key] ?? null });
    if (rows.length >= limit) break;
  }
  return rows;
}

function RunHistory({
  runs,
  currentFingerprint,
}: {
  runs: RunVersionRow[];
  currentFingerprint: string;
}) {
  const latest = runs[0] ?? null;
  const previous = runs[1] ?? null;
  const inputChanges =
    latest && previous
      ? compactChanges(
          flattenSnapshot(previous.input_snapshot),
          flattenSnapshot(latest.input_snapshot),
          6,
        )
      : [];
  const outputChanges = (() => {
    if (!latest || !previous) return [];
    const prev = outputMap(previous.output_snapshot);
    const next = outputMap(latest.output_snapshot);
    const rows: Array<{
      key: string;
      label: string;
      was: unknown;
      now: unknown;
      unit: string | null;
    }> = [];
    for (const key of new Set([...prev.keys(), ...next.keys()])) {
      const a = prev.get(key);
      const b = next.get(key);
      if (JSON.stringify(a?.value ?? null) === JSON.stringify(b?.value ?? null)) continue;
      rows.push({
        key,
        label: b?.label ?? a?.label ?? key,
        was: a?.value ?? null,
        now: b?.value ?? null,
        unit: b?.unit ?? a?.unit ?? null,
      });
      if (rows.length >= 6) break;
    }
    return rows;
  })();

  if (!runs.length) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
            Run history
          </div>
          <Badge variant="outline" className="text-[11px]">
            Pending run
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No run versions have been recorded for this deal.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          Run history
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          current input {shortHash(currentFingerprint)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-grid w-full">
          <thead>
            <tr>
              <th className="text-left">Version</th>
              <th className="text-left">Status</th>
              <th className="text-left">Computed</th>
              <th className="text-left">Mode</th>
              <th className="text-left">Verdict</th>
              <th className="text-left">Input hash</th>
              <th className="text-left">Freshness</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 10).map((run) => {
              const isCurrent =
                run.status === "completed" && run.input_fingerprint === currentFingerprint;
              return (
                <tr key={run.id}>
                  <td className="font-medium">v{run.run_number}</td>
                  <td>
                    <Badge
                      variant="outline"
                      className={
                        run.status === "completed"
                          ? "bg-success/10 text-success border-success/30 text-[11px]"
                          : run.status === "blocked"
                            ? "bg-warning/10 text-warning border-warning/30 text-[11px]"
                            : "bg-destructive/10 text-destructive border-destructive/30 text-[11px]"
                      }
                    >
                      {run.status}
                    </Badge>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(run.computed_at).toLocaleString()}
                  </td>
                  <td className="text-xs">{runModeLabel(run.run_mode)}</td>
                  <td className="text-xs">{run.verdict_code ?? "Blocked"}</td>
                  <td className="font-mono text-[11px]">{shortHash(run.input_fingerprint)}</td>
                  <td>
                    {isCurrent ? (
                      <Badge
                        variant="outline"
                        className="bg-success/10 text-success border-success/30 text-[11px]"
                      >
                        Current
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[11px]">
                        Historical
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {previous && (
        <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Changed inputs: v{previous.run_number} to v{latest?.run_number}
            </div>
            {inputChanges.length ? (
              <ul className="mt-2 space-y-1">
                {inputChanges.map((change) => (
                  <li key={change.key} className="text-xs">
                    <span className="font-mono text-muted-foreground">{change.key}</span>{" "}
                    <span className="text-muted-foreground">{String(change.was)}</span>
                    <span className="mx-1">to</span>
                    <span>{String(change.now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No input changes recorded.</p>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Changed headline outputs
            </div>
            {outputChanges.length ? (
              <ul className="mt-2 space-y-1">
                {outputChanges.map((change) => (
                  <li key={change.key} className="text-xs">
                    <span className="font-medium">{change.label}</span>{" "}
                    <span className="text-muted-foreground">{String(change.was)}</span>
                    <span className="mx-1">to</span>
                    <span>{String(change.now)}</span>
                    {change.unit && <span className="text-muted-foreground"> {change.unit}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No headline output changes recorded.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function bandClass(band: string): string {
  if (band === "strong" || band === "exceptional")
    return "text-primary border-primary/40 bg-primary/5";
  if (band === "weak" || band === "critical")
    return "text-destructive border-destructive/40 bg-destructive/5";
  if (band === "soft") return "text-warning border-warning/40 bg-warning/5";
  return "text-muted-foreground border-border";
}

// The deterministic "analyst read": context chips, a synthesized thesis,
// metric-by-metric contextual interpretation, and what-if levers. Every word is
// rule-derived from the engine output + the curated/portfolio benchmark norms.
function DeterministicRead({ row }: { row?: OutputRow }) {
  if (!row) return null;
  const ctx = row.inputs?.context;
  const interps: Interpretation[] = row.inputs?.interpretations ?? [];
  const levers: WhatIfLever[] = row.inputs?.levers ?? [];
  const failing = levers.filter((l) => !l.passing);
  const sample = Number(row.inputs?.portfolioSample ?? 0);
  const chips = ctx
    ? [
        ctx.marketLabel,
        String(ctx.stage ?? "").replace(/_/g, " "),
        String(ctx.loanStructure ?? "").replace(/_/g, " "),
      ].filter(Boolean)
    : [];
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Info className="size-4 text-primary" />
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          Deterministic Read · Contextual Analysis
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <Badge key={i} variant="outline" className="text-[11px] capitalize">
            {c}
          </Badge>
        ))}
        {sample > 0 && (
          <Badge variant="outline" className="text-[11px]">
            benchmarked vs {sample} portfolio deal{sample === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      {row.formula_text && <p className="text-sm leading-relaxed">{row.formula_text}</p>}
      {interps.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
            How it reads in context
          </div>
          <ul className="space-y-1.5">
            {interps
              .filter((i) => i.band !== "neutral")
              .slice(0, 7)
              .map((i) => (
                <li key={i.metricKey} className="text-xs flex items-start gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[11px] uppercase shrink-0 ${bandClass(i.band)}`}
                  >
                    {String(i.band).replace(/_/g, " ")}
                  </Badge>
                  <span>
                    <span className="font-medium">{i.label}</span> {i.comparativePhrase}.
                    {i.contextNote ? (
                      <span className="text-muted-foreground"> {i.contextNote}</span>
                    ) : null}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
      {failing.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
            What would move the needle
          </div>
          <ul className="space-y-1 list-disc pl-4">
            {failing.map((l, idx) => (
              <li key={idx} className="text-xs text-muted-foreground">
                {l.lever}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// Shows which path actually ran the most recent computation.
function ModeBadge({ mode }: { mode: "ai" | "deterministic" }) {
  return (
    <Badge
      variant="outline"
      className="text-[11px] uppercase tracking-wider bg-muted text-muted-foreground border-border"
    >
      <Calculator className="size-2.5 mr-1" />
      {mode === "deterministic" ? "Deterministic" : "Legacy AI-labelled run"}
    </Badge>
  );
}

export function ICPanel({ projectId }: { projectId: string }) {
  const { data: decisions } = useSuspenseQuery(decisionsQ(projectId));
  const { data: flags } = useSuspenseQuery(flagsQ(projectId));
  const qc = useQueryClient();
  const fn = useServerFn(recordDecision);
  const [decision, setDecision] = useState<"approve" | "approve_with_conditions" | "reject">(
    "approve_with_conditions",
  );
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      fn({
        data: { project_id: projectId, decision, rationale, conditions: conditions || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions", projectId] });
      qc.invalidateQueries({ queryKey: ["audit", projectId] });
      toast.success("IC decision recorded");
      setRationale("");
      setConditions("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <MemoSection projectId={projectId} />

      {flags.filter((f: ReconciliationFlagRow) => f.severity === "error").length > 0 && (
        <div className="space-y-2">
          {flags
            .filter((f: ReconciliationFlagRow) => f.severity === "error")
            .map((f: ReconciliationFlagRow) => (
              <div
                key={f.id}
                className={`flex items-start gap-2 rounded border p-3 text-sm ${SEV_STYLES.error}`}
              >
                <ShieldAlert className="size-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold uppercase text-[11px] tracking-widest mr-2">
                    reconciliation error
                  </span>
                  {f.message}
                </div>
              </div>
            ))}
        </div>
      )}

      <Card className="p-5 space-y-3">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          New IC decision
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={decision === "approve" ? "default" : "outline"}
            onClick={() => setDecision("approve")}
          >
            Approve
          </Button>
          <Button
            variant={decision === "approve_with_conditions" ? "default" : "outline"}
            onClick={() => setDecision("approve_with_conditions")}
          >
            Approve with Conditions
          </Button>
          <Button
            variant={decision === "reject" ? "default" : "outline"}
            onClick={() => setDecision("reject")}
          >
            Reject
          </Button>
        </div>
        <Textarea
          rows={3}
          placeholder="Comment / rationale (cite approved assumptions, IRR/EM, DSCR, market guidance)"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
        {decision === "approve_with_conditions" && (
          <Textarea
            rows={3}
            placeholder="Conditions (e.g. cap hard cost re-bid ≤ +5%, confirm rate ≤ 6.5%, OpEx ratio ≤ 38%)"
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
          />
        )}
        <Button onClick={() => submit.mutate()} disabled={!rationale || submit.isPending}>
          <Calculator className="size-4 mr-1" />
          Record decision
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-muted/20 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          Decision History
        </div>
        {decisions.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No decisions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {decisions.map((d: DecisionLogRow) => (
              <li key={d.id} className="p-4 text-sm">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-[11px] uppercase">
                    {d.decision.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(d.created_at).toLocaleString()} · {d.user_name}
                  </span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{d.rationale}</p>
                {d.conditions && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-widest text-warning">
                      Conditions:{" "}
                    </span>
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
  const { data: runState } = useSuspenseQuery(runStateQ(projectId));
  const qc = useQueryClient();
  const generateMemoFn = useServerFn(generateMemo);
  const [error, setError] = useState<string | null>(null);

  const gen = useMutation({
    mutationFn: () => generateMemoFn({ data: { project_id: projectId } }),
    onMutate: () => setError(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memos", projectId] });
      qc.invalidateQueries({ queryKey: ["audit", projectId] });
      qc.invalidateQueries({ queryKey: ["memo-debug", projectId] });
      qc.invalidateQueries({ queryKey: ["uw-run-state", projectId] });
      toast.success("Deterministic investment memo generated.");
    },
    onError: (e: Error) => {
      // Never swallow the error behind a generic toast: surface it in the UI.
      console.error("[generateMemo] failed:", e);
      setError(e.message);
      toast.error("Memo generation failed: see diagnostics");
    },
  });

  const latest: any = memos[0] ?? null;
  const content = (latest?.content ?? {}) as Record<string, any>;
  const memoRun = content.run_version as
    | { id?: string; run_number?: number; run_mode?: string; input_fingerprint?: string }
    | null
    | undefined;
  const memoStale =
    Boolean(memoRun?.input_fingerprint) &&
    memoRun?.input_fingerprint !== runState.current_input_fingerprint;
  const workflowPermissions = runState.permissions ?? {
    canRunUnderwriting: true,
    canGenerateMemo: true,
    canRecordDecision: true,
    canExportAuditPackage: true,
    canManageWorkspace: false,
  };
  const canGenerateMemo =
    workflowPermissions.canGenerateMemo &&
    debug.can_generate &&
    runState.freshness !== "stale" &&
    runState.freshness !== "blocked";
  const needsReview = Boolean(
    latest &&
    (content.needs_review ||
      latest.status === "needs_review" ||
      latest.verification_report?.pass === false),
  );
  const orphans: any[] = latest?.verification_report?.orphans ?? [];

  const insertFailed = Boolean(error && /saving investment_memos/i.test(error));
  const provenanceFailed = Boolean(
    latest && latest.verification_report && latest.verification_report.pass === false,
  );
  const latestStatus = latest?.status ?? null;
  const verificationPassed =
    latest?.verification_report?.pass === true
      ? true
      : latest?.verification_report?.pass === false
        ? false
        : null;

  return (
    <Card className="p-5 space-y-3 border-primary/30">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
            Investment Memo
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge
              variant="outline"
              className={`text-[11px] ${canGenerateMemo ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}
            >
              {canGenerateMemo ? "Memo available" : "Memo blocked"}
            </Badge>
            {memoStale && (
              <Badge
                variant="outline"
                className="text-[11px] bg-warning/10 text-warning border-warning/30"
              >
                Memo stale
              </Badge>
            )}
            {memoStale && (
              <Badge
                variant="outline"
                className="text-[11px] bg-warning/10 text-warning border-warning/30"
              >
                Inputs changed after memo run
              </Badge>
            )}
            {latestStatus && (
              <Badge variant="outline" className="text-[11px] uppercase">
                {latestStatus}
              </Badge>
            )}
            {verificationPassed != null && (
              <Badge
                variant="outline"
                className={`text-[11px] ${verificationPassed ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}
              >
                {verificationPassed ? "Verification passed" : "Verification review"}
              </Badge>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => gen.mutate()}
          disabled={!canGenerateMemo || gen.isPending}
          title={
            runState.freshness === "stale"
              ? "Outputs stale. Re-run deterministic underwriting before generating a memo."
              : runState.freshness === "blocked"
                ? "Underwriting blocked. Resolve inputs before generating a memo."
                : !workflowPermissions.canGenerateMemo
                  ? "Read-only role: cannot generate memos."
                  : debug.can_generate
                    ? "Generate the memo from deterministic outputs and approved assumptions."
                    : debug.blocking_reasons.join(" ")
          }
        >
          <FileText className="size-4 mr-1" />
          {gen.isPending ? "Generating…" : "Generate Memo"}
        </Button>
      </div>

      {/* Preconditions */}
      {!debug.can_generate && (
        <div className="flex items-start gap-2 text-xs text-warning bg-warning/5 border border-warning/20 rounded p-3">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold uppercase tracking-widest">Cannot generate memo yet</div>
            <ul className="mt-1 text-muted-foreground list-disc pl-4">
              {debug.blocking_reasons.map((r: string) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {debug.can_generate && !canGenerateMemo && (
        <div className="flex items-start gap-2 text-xs text-warning bg-warning/5 border border-warning/20 rounded p-3">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            {runState.freshness === "stale"
              ? "Outputs stale. Re-run deterministic underwriting before generating a memo."
              : "Underwriting blocked. Resolve inputs before generating a memo."}
          </span>
        </div>
      )}
      {debug.can_generate && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 border border-border rounded p-3">
          <Info className="size-4 shrink-0 mt-0.5" />
          <span>
            The pilot memo uses the <strong>deterministic template</strong>: engine outputs and
            approved assumptions only.
          </span>
        </div>
      )}

      {/* Visible error diagnostics: not swallowed behind a toast */}
      {error && (
        <div className="text-xs bg-destructive/5 border border-destructive/30 rounded p-3 space-y-2">
          <div className="font-semibold uppercase tracking-widest text-destructive">
            Memo generation error
          </div>
          <div className="font-mono text-destructive break-words">{error}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground">
            <Diag label="financial_outputs exist" ok={debug.financial_outputs_count > 0} />
            <Diag label="cash_flows exist" ok={debug.cash_flows_count > 0} />
            <Diag label="reconciliation_flags exist" ok={debug.reconciliation_flags_count > 0} />
            <Diag label="AI provider configured" ok={debug.env.has_ai_provider} />
            <Diag
              label="investment_memos insert failed"
              ok={!insertFailed}
              okLabel={insertFailed ? "yes" : "no"}
            />
            <Diag
              label="provenance verification failed"
              ok={!provenanceFailed}
              okLabel={provenanceFailed ? "yes" : "no"}
            />
          </div>
        </div>
      )}

      {/* needs_review warning */}
      {needsReview && (
        <div className="flex items-start gap-2 text-xs text-warning bg-warning/5 border border-warning/20 rounded p-3">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            Memo generated but <strong>requires review</strong> because some numeric tokens lacked
            provenance
            {orphans.length > 0 && (
              <>
                {" "}
                ({orphans.length} orphan token{orphans.length === 1 ? "" : "s"}:{" "}
                {orphans
                  .slice(0, 8)
                  .map((o: any) => o.value ?? o)
                  .join(", ")}
                )
              </>
            )}
            .
          </span>
        </div>
      )}

      {/* Latest memo */}
      {latest ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {(() => {
              const mode =
                content.generation_mode ??
                (latest.status === "generated_deterministic" ? "deterministic" : "ai");
              return (
                <Badge
                  variant="outline"
                  className={`text-[11px] ${mode === "deterministic" ? "text-chart-2 border-chart-2/40" : "text-primary border-primary/40"}`}
                >
                  {mode === "deterministic" ? "Deterministic template" : "AI-assisted"}
                </Badge>
              );
            })()}
            <Badge variant="outline" className="text-[11px] uppercase">
              {latest.status ?? "generated"}
            </Badge>
            <span>{new Date(latest.created_at).toLocaleString()}</span>
            {memoRun?.run_number && (
              <Badge variant="outline" className="text-[11px]">
                Run version v{memoRun.run_number}
              </Badge>
            )}
            {memoRun?.run_mode && (
              <Badge variant="outline" className="text-[11px]">
                {memoRun.run_mode === "deterministic"
                  ? "Deterministic run"
                  : "AI-assisted defaults"}
              </Badge>
            )}
            {memoRun?.input_fingerprint && (
              <Badge variant="outline" className="text-[11px] font-mono">
                Input {shortHash(memoRun.input_fingerprint)}
              </Badge>
            )}
            {verificationPassed != null && (
              <Badge
                variant="outline"
                className={`text-[11px] ${verificationPassed ? "bg-success/10 text-success border-success/30" : "bg-warning/10 text-warning border-warning/30"}`}
              >
                {verificationPassed ? "Verification passed" : "Verification review"}
              </Badge>
            )}
            {content.deterministic_verdict?.code && (
              <Badge
                variant="outline"
                className={`text-[11px] ${content.deterministic_verdict.code === "REJECT" ? "text-destructive border-destructive/40" : "text-primary border-primary/40"}`}
              >
                {content.deterministic_verdict.code}
              </Badge>
            )}
            <div className="ml-auto flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={!content.report}
                onClick={() => downloadMemo("pdf", content.report)}
              >
                <Download className="size-3.5 mr-1" />
                PDF
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!content.report}
                onClick={() => downloadMemo("docx", content.report)}
              >
                <Download className="size-3.5 mr-1" />
                DOCX
              </Button>
            </div>
          </div>

          {content.report ? (
            <MemoReportView report={content.report} />
          ) : (
            MEMO_SECTIONS.filter((s) => typeof content[s.key] === "string" && content[s.key]).map(
              (s) => (
                <div key={s.key}>
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                    {s.label}
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{content[s.key]}</p>
                </div>
              ),
            )
          )}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/10 px-3 py-2 text-sm text-muted-foreground">
          No memo yet. Complete underwriting, then generate the IC memo.
        </div>
      )}

      {/* Dev-only readiness debug */}
      {import.meta.env.DEV && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted-foreground uppercase tracking-widest">
            Memo readiness debug
          </summary>
          <pre className="mt-2 overflow-x-auto bg-muted/30 rounded p-2 font-mono">
            {JSON.stringify(debug, null, 2)}
          </pre>
        </details>
      )}
    </Card>
  );
}

function Diag({ label, ok, okLabel }: { label: string; ok: boolean; okLabel?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={ok ? "text-success" : "text-destructive"}>
        {okLabel ?? (ok ? "yes" : "no")}
      </span>
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

// On-screen rendering of the structured memo report: mirrors the PDF/DOCX.
function MemoReportView({ report }: { report: any }) {
  const isReject = report.verdict_code === "REJECT";
  return (
    <div className="space-y-4 rounded border border-border bg-background/40 p-4">
      <div>
        <div className="text-lg font-semibold">{report.title}</div>
        <div className="text-primary font-medium">{report.project_name}</div>
        <div className="text-xs text-muted-foreground">
          {report.subtitle} · {report.mode_label}
        </div>
      </div>

      {report.summary_stats?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {report.summary_stats.map((s: any) => (
            <div key={s.label} className="rounded border border-border p-2">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {s.label}
              </div>
              <div className="num text-sm">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div
        className={`rounded px-3 py-2 text-sm font-semibold ${isReject ? "bg-destructive text-destructive-foreground" : report.verdict_code === "APPROVE" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}
      >
        {report.verdict_banner}
      </div>
      {report.verdict_narrative && (
        <p className="text-sm text-muted-foreground">{report.verdict_narrative}</p>
      )}

      {report.metric_cards?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {report.metric_cards.map((c: any) => (
            <div key={c.label} className="rounded border border-border p-2">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {c.label}
              </div>
              <div className="num text-base">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {report.sections?.map((sec: any, i: number) => (
        <div key={sec.heading}>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
            {i + 1}. {sec.heading}
          </div>
          {sec.table && (
            <div className="overflow-x-auto">
              <table className="data-grid w-full text-xs">
                <thead>
                  <tr className="bg-muted/20">
                    {sec.table.columns.map((c: string) => (
                      <th key={c} className="text-left">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.table.rows.map((r: string[], ri: number) => (
                    <tr key={ri}>
                      {r.map((cell, ci) => (
                        <td key={ci} className={ci === 0 ? "font-medium" : "num"}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sec.body && <p className="text-sm whitespace-pre-wrap">{sec.body}</p>}
          {sec.table?.note && (
            <p className="text-[11px] italic text-muted-foreground mt-1">Note: {sec.table.note}</p>
          )}
        </div>
      ))}

      {report.footnotes?.length > 0 && (
        <div className="border-t border-border pt-2 space-y-1">
          {report.footnotes.map((f: string, i: number) => (
            <p key={i} className="text-[11px] text-muted-foreground">
              {f}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuditPanel({ projectId }: { projectId: string }) {
  const { data: audit } = useSuspenseQuery(auditQ(projectId));
  const groups = [
    {
      label: "Assumption Changes",
      rows: audit.filter(
        (a: any) => a.entity_type === "assumption" || String(a.action).startsWith("assumption_"),
      ),
    },
    {
      label: "Decision Changes",
      rows: audit.filter((a: any) => a.entity_type === "decision" || a.action === "ic_decision"),
    },
    {
      label: "User Activity",
      rows: audit.filter(
        (a: any) => a.entity_type !== "assumption" && a.entity_type !== "decision",
      ),
    },
    {
      label: "Version History",
      rows: audit.filter(
        (a: any) => a.action === "extract_assumptions" || a.action === "recompute_outputs",
      ),
    },
  ];
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.label} className="overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/20 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
            {group.label}
          </div>
          {group.rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No {group.label.toLowerCase()} yet.</p>
          ) : (
            <table className="data-grid w-full">
              <thead>
                <tr className="bg-muted/10">
                  <th className="text-left">Time</th>
                  <th className="text-left">Action</th>
                  <th className="text-left">Entity</th>
                  <th className="text-left">Payload</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((a: any) => (
                  <tr key={a.id} className="hover:bg-accent/20">
                    <td className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="font-medium">{a.action}</td>
                    <td className="text-xs text-muted-foreground">{a.entity_type}</td>
                    <td className="text-[11px] font-mono text-muted-foreground max-w-md truncate">
                      {JSON.stringify(a.payload)}
                    </td>
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
