// Investment Committee: where the decision is actually made and recorded.
// Surfaces the engine recommendation, the two headline scores, the approval
// conditions and findings, then the four IC actions and a permanent audit trail.

import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listFinancialOutputs,
  listDecisions,
  recordDecision,
  verifyAuditChain,
} from "@/lib/assumptions.functions";
import { listAssumptions } from "@/lib/assumptions.functions";
import { listMemoSnapshots, diffMemoSnapshot } from "@/lib/memo-snapshot.functions";
import { listReconciliationFlags } from "@/lib/underwriting.functions";
import { listMemos } from "@/lib/memo.functions";
import {
  castVote,
  listIcVotes,
  addCondition,
  updateConditionStatus,
  listConditions,
} from "@/lib/operating-layer.functions";
import { MemoSection } from "@/components/underwriting-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buildDecision, RECOMMENDATION_TONE } from "@/lib/decision";
import type { AssumptionRow, OutputRow } from "@/lib/decision";
import {
  ScoreDial,
  RecommendationPill,
  RiskPill,
  SectionLabel,
  Eyebrow,
  TONE_CHIP,
  TONE_TEXT,
  TONE_SOLID,
} from "@/components/decision-ui";
import { buildCommitteeReadiness, type ReadinessSeverity } from "@/lib/committee/readiness";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  RotateCcw,
  XCircle,
  ShieldAlert,
  ShieldCheck,
  ListChecks,
  Gavel,
  Lock,
  Loader2,
  GitCompareArrows,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { VoteTally } from "@/lib/committee/voting";
import type { Tables } from "@/integrations/supabase/types";

type MemoSnapshotRow = Pick<
  Tables<"memo_snapshots">,
  | "id"
  | "version"
  | "verdict_code"
  | "content_hash"
  | "decision_id"
  | "created_at"
  | "created_by_name"
>;
type SnapshotAssumptionChange = {
  field_key: string;
  field_label: string;
  was: string | number | null;
  now: string | number | null;
  kind: "added" | "removed" | "changed";
};
type SnapshotOutputChange = {
  scenario_key: string;
  metric_key: string;
  metric_label: string | null;
  unit: string | null;
  was: number | null;
  now: number | null;
};
type SnapshotDiff = {
  snapshot_id: string;
  version: number;
  locked_at: string;
  content_hash: string;
  current_hash: string;
  drifted: boolean;
  assumption_changes: SnapshotAssumptionChange[];
  output_changes: SnapshotOutputChange[];
};

const outputsQ = (pid: string) =>
  queryOptions({
    queryKey: ["outputs", pid],
    queryFn: () => listFinancialOutputs({ data: { project_id: pid } }),
  });
const assumptionsQ = (pid: string) =>
  queryOptions({
    queryKey: ["assumptions", pid],
    queryFn: () => listAssumptions({ data: { project_id: pid } }),
  });
const decisionsQ = (pid: string) =>
  queryOptions({
    queryKey: ["decisions", pid],
    queryFn: () => listDecisions({ data: { project_id: pid } }),
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
const icVotesQ = (pid: string) =>
  queryOptions({
    queryKey: ["ic-votes", pid],
    queryFn: () => listIcVotes({ data: { project_id: pid } }),
  });
const icCondsQ = (pid: string) =>
  queryOptions({
    queryKey: ["ic-conditions", pid],
    queryFn: () => listConditions({ data: { project_id: pid } }),
  });

const VOTE_OPTIONS: {
  key: "approve" | "approve_with_conditions" | "reject" | "abstain";
  label: string;
}[] = [
  { key: "approve", label: "Approve" },
  { key: "approve_with_conditions", label: "Approve w/ Conditions" },
  { key: "reject", label: "Reject" },
  { key: "abstain", label: "Abstain" },
];

type ICAction = "approve" | "approve_with_conditions" | "return_to_underwriting" | "reject";
type DecisionLogRow = {
  id: string;
  decision: string;
  rationale: string | null;
  conditions: string | null;
  user_name: string | null;
  created_at: string;
};
type ReconFlagRow = { id: string; severity?: string | null; message: string; resolved?: boolean };
type ConditionRow = { id: string; label: string; status: "open" | "satisfied" | "waived" };
type VoteData = {
  tally: VoteTally;
};
type ConditionData = {
  conditions: ConditionRow[];
  openCount: number;
  cleared: boolean;
};

const ACTIONS: {
  key: ICAction;
  label: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_SOLID;
}[] = [
  { key: "approve", label: "Approve", icon: CheckCircle2, tone: "approve" },
  {
    key: "approve_with_conditions",
    label: "Approve with Conditions",
    icon: FileCheck2,
    tone: "condition",
  },
  {
    key: "return_to_underwriting",
    label: "Return to Underwriting",
    icon: RotateCcw,
    tone: "return",
  },
  { key: "reject", label: "Reject", icon: XCircle, tone: "reject" },
];

export function CommitteePanel({ projectId }: { projectId: string }) {
  const { data: outputs } = useSuspenseQuery(outputsQ(projectId));
  const { data: assumptions } = useSuspenseQuery(assumptionsQ(projectId));
  const { data: decisions } = useSuspenseQuery(decisionsQ(projectId));
  const { data: flags } = useSuspenseQuery(flagsQ(projectId));
  const { data: memos } = useSuspenseQuery(memosQ(projectId));
  const { data: voteData } = useSuspenseQuery(icVotesQ(projectId));
  const { data: condData } = useSuspenseQuery(icCondsQ(projectId));
  const qc = useQueryClient();
  const fn = useServerFn(recordDecision);

  const outputRows = outputs as OutputRow[];
  const assumptionRows = assumptions as AssumptionRow[];
  const decision = buildDecision(outputRows, assumptionRows);
  const recTone = RECOMMENDATION_TONE[decision.recommendation];
  const decisionRows = decisions as DecisionLogRow[];
  const flagRows = flags as ReconFlagRow[];
  const conditionRows = (condData as ConditionData).conditions;
  const readiness = buildCommitteeReadiness({
    hasUnderwriting: decision.hasUnderwriting,
    assumptions: assumptionRows,
    reconciliationFlags: flagRows,
    voteTally: (voteData as VoteData).tally,
    conditions: conditionRows,
    decisions: decisionRows,
    memoCount: memos.length,
  });

  const [action, setAction] = useState<ICAction>(
    decision.recommendation === "APPROVE"
      ? "approve"
      : decision.recommendation === "REJECT"
        ? "reject"
        : decision.recommendation === "RETURN_TO_UNDERWRITING"
          ? "return_to_underwriting"
          : "approve_with_conditions",
  );
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");

  const submit = useMutation({
    mutationFn: () =>
      fn({
        data: {
          project_id: projectId,
          decision: action,
          rationale,
          conditions: conditions || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions", projectId] });
      qc.invalidateQueries({ queryKey: ["audit", projectId] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast.success("IC decision recorded to the audit trail");
      setRationale("");
      setConditions("");
      setSuperseding(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // A final disposition (approve / approve-with-conditions / reject) locks the
  // recorder so a second, contradictory decision can't be written by accident.
  // "return to underwriting" is not terminal – the deal is expected to come back.
  const finalDecision =
    [...decisionRows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .find((d) => d.decision !== "return_to_underwriting") ?? null;
  const [superseding, setSuperseding] = useState(false);
  const locked = !!finalDecision && !superseding;

  // Do not present any recommendation, score, or condition before deterministic
  // underwriting and findings exist: that would be a recommendation-like output
  // with no basis. Show workflow state instead.
  if (!decision.hasUnderwriting || !decision.findings) {
    return (
      <Card className="p-12 text-center elevated">
        <Gavel className="size-8 mx-auto text-muted-foreground" />
        <h3 className="display text-xl mt-4">Underwriting not run</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          No investment recommendation available yet. Resolve the required assumptions and run
          deterministic underwriting in <span className="text-foreground">Analysis</span>. The
          recommendation, Investment Score, conditions and findings will appear here once outputs
          exist.
        </p>
      </Card>
    );
  }

  const errorFlags = flagRows.filter((f) => f.severity === "error" && !f.resolved);
  const conditionsList = decision.findings?.approvalConditions ?? [];

  return (
    <div className="space-y-5">
      {/* Verdict band */}
      <Card className="p-6 elevated">
        <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-center">
          <div>
            <Eyebrow>Engine Recommendation</Eyebrow>
            <div className="mt-3">
              <RecommendationPill rec={decision.recommendation} />
            </div>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl">
              {decision.findings?.recommendationFindings?.[0]?.rationale ??
                "The recommendation is produced by the deterministic gate set over approved inputs."}
            </p>
            <div className="mt-4">
              <RiskPill rating={decision.riskRating} />
            </div>
          </div>
          <div className="flex gap-8 justify-center">
            <ScoreDial
              value={decision.investmentScore}
              label="Investment Score"
              tone={recTone}
              size={120}
            />
            <ScoreDial
              value={decision.confidenceScore}
              label="Confidence"
              tone="return"
              size={120}
            />
          </div>
        </div>
      </Card>

      {errorFlags.length > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" />
            <span className="text-sm font-semibold">
              Unresolved reconciliation errors block a clean approval
            </span>
          </div>
          <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5">
            {errorFlags.map((f) => (
              <li key={f.id}>{f.message}</li>
            ))}
          </ul>
        </Card>
      )}

      <CommitteeReadinessCard readiness={readiness} />

      {/* Approval conditions + critical findings */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-warning" />
            <SectionLabel>Approval Conditions</SectionLabel>
          </div>
          {conditionsList.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">
              No conditions generated by the findings engine.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {conditionsList.map((c) => (
                <li key={c.id} className="flex gap-2.5 text-sm">
                  <span className="mt-1.5 size-1.5 rounded-full bg-warning shrink-0" />
                  <span>
                    <span className="font-medium">{c.title}.</span>{" "}
                    <span className="text-muted-foreground">{c.rationale}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" />
            <SectionLabel>Critical & High Findings</SectionLabel>
          </div>
          {(decision.findings?.criticalFindings?.length ?? 0) +
            (decision.findings?.highPriorityFindings?.length ?? 0) ===
          0 ? (
            <p className="text-sm text-muted-foreground mt-3">
              No critical or high-priority findings.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {[
                ...(decision.findings?.criticalFindings ?? []),
                ...(decision.findings?.highPriorityFindings ?? []),
              ]
                .slice(0, 6)
                .map((c) => (
                  <li key={c.id} className="flex gap-2.5 text-sm">
                    <span
                      className={`mt-1.5 size-1.5 rounded-full shrink-0 ${c.severity === "critical" ? "bg-destructive" : "bg-warning"}`}
                    />
                    <span>
                      <span className="font-medium">{c.title}.</span>{" "}
                      <span className="text-muted-foreground">{c.rationale}</span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Committee votes + tracked conditions (governance over the engine verdict) */}
      <CommitteeGovernance
        projectId={projectId}
        voteData={voteData as VoteData}
        condData={condData as ConditionData}
      />

      {/* IC decision */}
      <Card className="p-6 elevated" data-section="record-decision">
        <div className="flex items-center gap-2">
          <Gavel className="size-4 text-primary" />
          <SectionLabel>Record Committee Decision</SectionLabel>
        </div>
        {locked && finalDecision ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Lock className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Decision recorded</span>
              <Badge
                variant="outline"
                className={`text-[11px] uppercase ${
                  TONE_CHIP[
                    (finalDecision.decision === "approve"
                      ? "approve"
                      : finalDecision.decision === "reject"
                        ? "reject"
                        : "condition") as keyof typeof TONE_CHIP
                  ]
                }`}
              >
                {String(finalDecision.decision).replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {new Date(finalDecision.created_at).toLocaleString()} · {finalDecision.user_name}
            </p>
            {finalDecision.rationale && (
              <p className="mt-2 text-sm whitespace-pre-wrap">{finalDecision.rationale}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-muted-foreground"
              onClick={() => setSuperseding(true)}
            >
              Record a superseding decision
            </Button>
          </div>
        ) : (
          <>
            {superseding && finalDecision && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  This deal already has a recorded decision (
                  {String(finalDecision.decision).replace(/_/g, " ")}). A new decision supersedes it
                  in the audit trail; the original entry is retained.
                </span>
              </div>
            )}
            <div
              className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4"
              role="radiogroup"
              aria-label="Committee decision"
            >
              {ACTIONS.map((a) => {
                const active = action === a.key;
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setAction(a.key)}
                    className={`rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? `${TONE_CHIP[a.tone]} ring-1 ring-current` : "border-border hover:border-foreground/30 text-muted-foreground"}`}
                  >
                    <Icon className={`size-5 ${active ? TONE_TEXT[a.tone] : ""}`} />
                    <div className="text-xs font-semibold mt-2 leading-tight text-foreground">
                      {a.label}
                    </div>
                  </button>
                );
              })}
            </div>
            <Textarea
              className="mt-4"
              rows={3}
              aria-label="Committee rationale"
              placeholder="Committee rationale: cite approved assumptions, returns, DSCR, stress results, and market guidance."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            {(action === "approve_with_conditions" || action === "return_to_underwriting") && (
              <Textarea
                className="mt-2"
                rows={2}
                aria-label={
                  action === "approve_with_conditions" ? "Conditions" : "What to re-underwrite"
                }
                placeholder={
                  action === "approve_with_conditions"
                    ? "Conditions: e.g. cap hard-cost re-bid ≤ +5%, confirm rate ≤ 6.5%, OpEx ratio ≤ 38%."
                    : "What must be re-underwritten before this returns to committee?"
                }
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="mt-4" disabled={!rationale || submit.isPending}>
                  {submit.isPending ? "Recording…" : "Record decision"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Record “{ACTIONS.find((a) => a.key === action)?.label}” to the audit trail?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This writes a permanent, hash-chained entry and snapshots the memo. It cannot be
                    edited – only superseded by a later decision.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="rounded-md border border-border bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                  {rationale}
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => submit.mutate()}>
                    Record decision
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </Card>

      {/* Investment Committee memo */}
      <MemoSection projectId={projectId} />

      {/* Snapshots locked at IC submission */}
      <MemoSnapshots projectId={projectId} />

      {/* Permanent audit trail */}
      <Card className="overflow-hidden elevated">
        <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <SectionLabel>Decision History · Audit Trail</SectionLabel>
          <div className="flex items-center gap-3">
            <AuditIntegrity projectId={projectId} />
            <span className="num text-xs text-muted-foreground">{decisionRows.length}</span>
          </div>
        </div>
        {decisionRows.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground text-center">
            No committee decisions recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {decisionRows.map((d) => {
              const tone =
                d.decision === "approve"
                  ? "approve"
                  : d.decision === "reject"
                    ? "reject"
                    : d.decision === "return_to_underwriting"
                      ? "return"
                      : "condition";
              return (
                <li key={d.id} className="p-5">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={`text-[11px] uppercase ${TONE_CHIP[tone as keyof typeof TONE_CHIP]}`}
                    >
                      {String(d.decision).replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()} · {d.user_name}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm whitespace-pre-wrap">{d.rationale}</p>
                  {d.conditions && (
                    <div className="mt-2 text-xs">
                      <span className="font-semibold uppercase tracking-widest text-warning">
                        Conditions:{" "}
                      </span>
                      <span className="text-muted-foreground whitespace-pre-wrap">
                        {d.conditions}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Verify the tamper-evident hash chain over this project's audit trail. The
// recompute happens in-database, so a green result is a real cryptographic
// proof that no historical row was altered, inserted, or deleted.
function AuditIntegrity({ projectId }: { projectId: string }) {
  const verifyFn = useServerFn(verifyAuditChain);
  const [result, setResult] = useState<{
    valid: boolean;
    reason: string | null;
    total: number;
    broken_seq: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await verifyFn({ data: { project_id: projectId } });
      setResult(r);
      if (r.valid) toast.success(`Audit chain intact (${r.total} entries verified)`);
      else toast.error(`Audit chain BROKEN at #${r.broken_seq} (${r.reason})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-2">
      {result &&
        (result.valid ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-success">
            <ShieldCheck className="size-3.5" /> Verified · {result.total}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
            <ShieldAlert className="size-3.5" /> Broken at #{result.broken_seq}
          </span>
        ))}
      <Button size="sm" variant="outline" onClick={run} disabled={busy} className="h-7 text-xs">
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ShieldCheck className="size-3.5" />
        )}
        Verify integrity
      </Button>
    </div>
  );
}

// Memos frozen at IC submission, with a one-click diff against the deal's
// current inputs/outputs so re-runs after submission are visible, never silent.
function MemoSnapshots({ projectId }: { projectId: string }) {
  const { data: snapshots } = useSuspenseQuery(
    queryOptions({
      queryKey: ["memo-snapshots", projectId],
      queryFn: () => listMemoSnapshots({ data: { project_id: projectId } }),
    }),
  );
  const diffFn = useServerFn(diffMemoSnapshot);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!snapshots.length) return null;
  async function showDiff(id: string) {
    setBusyId(id);
    try {
      // The server returns the same diff shape with Json-typed change fields;
      // SnapshotDiff narrows them for display.
      setDiff((await diffFn({ data: { snapshot_id: id } })) as unknown as SnapshotDiff);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Diff failed");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <Card className="overflow-hidden elevated">
      <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
        <Lock className="size-3.5 text-muted-foreground" />
        <SectionLabel>Locked at IC Submission</SectionLabel>
      </div>
      <ul className="divide-y divide-border">
        {snapshots.map((s: MemoSnapshotRow) => (
          <li key={s.id} className="p-4 flex items-center gap-3 text-sm">
            <Badge variant="outline" className="text-[11px] uppercase">
              v{s.version}
            </Badge>
            <span className="text-xs text-muted-foreground flex-1">
              {new Date(s.created_at).toLocaleString()} · {s.created_by_name}
              {s.verdict_code ? ` · ${s.verdict_code}` : ""}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {String(s.content_hash).slice(0, 12)}…
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busyId === s.id}
              onClick={() => showDiff(s.id)}
            >
              {busyId === s.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <GitCompareArrows className="size-3.5" />
              )}
              Diff vs current
            </Button>
          </li>
        ))}
      </ul>
      {diff && (
        <div className="border-t border-border p-4 text-sm">
          {diff.drifted ? (
            <div className="text-warning font-medium mb-2">
              ⚠ Inputs/outputs changed since this version was locked.
            </div>
          ) : (
            <div className="text-success font-medium mb-2">
              ✓ Current state matches the locked version exactly.
            </div>
          )}
          {diff.assumption_changes?.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase text-muted-foreground mb-1">
                Assumption changes ({diff.assumption_changes.length})
              </div>
              <ul className="space-y-0.5 font-mono text-xs">
                {diff.assumption_changes.slice(0, 12).map((c: SnapshotAssumptionChange) => (
                  <li key={c.field_key}>
                    {c.field_label}: {String(c.was)} → {String(c.now)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.output_changes?.length > 0 && (
            <div>
              <div className="text-[11px] uppercase text-muted-foreground mb-1">
                Output changes ({diff.output_changes.length})
              </div>
              <ul className="space-y-0.5 font-mono text-xs">
                {diff.output_changes.slice(0, 12).map((c: SnapshotOutputChange) => (
                  <li key={`${c.scenario_key}:${c.metric_key}`}>
                    {c.metric_label} [{c.scenario_key}]: {String(c.was)} → {String(c.now)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const READINESS_META: Record<
  ReadinessSeverity,
  { icon: LucideIcon; cls: string; dot: string; label: string }
> = {
  blocker: {
    icon: ShieldAlert,
    cls: "border-destructive/30 bg-destructive/5 text-destructive",
    dot: "bg-destructive",
    label: "Blocker",
  },
  warning: {
    icon: AlertTriangle,
    cls: "border-warning/30 bg-warning/5 text-warning",
    dot: "bg-warning",
    label: "Warning",
  },
  satisfied: {
    icon: CheckCircle2,
    cls: "border-success/30 bg-success/5 text-success",
    dot: "bg-success",
    label: "Satisfied",
  },
};

function CommitteeReadinessCard({
  readiness,
}: {
  readiness: ReturnType<typeof buildCommitteeReadiness>;
}) {
  const tone =
    readiness.status === "blocked"
      ? READINESS_META.blocker
      : readiness.status === "ready"
        ? READINESS_META.warning
        : READINESS_META.satisfied;
  const StatusIcon = tone.icon;

  return (
    <Card className={`p-5 elevated border ${tone.cls}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <StatusIcon className="size-4" />
            <SectionLabel>{readiness.label}</SectionLabel>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Current package status before final committee circulation.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Badge variant="outline" className="text-[11px] uppercase">
            {readiness.blockers} blocker{readiness.blockers === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline" className="text-[11px] uppercase">
            {readiness.warnings} warning{readiness.warnings === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>
      <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {readiness.items.map((item) => {
          const meta = READINESS_META[item.severity];
          return (
            <div key={item.key} className="rounded-md border border-border bg-background/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`size-1.5 rounded-full shrink-0 ${meta.dot}`} />
                  <span className="text-xs font-semibold truncate">{item.label}</span>
                </span>
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-[11px] uppercase shrink-0 ${meta.cls}`}
                >
                  {meta.label}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// 3B: committee voting + tracked approval conditions. Votes and conditions are
// governance layered ON TOP of the deterministic engine verdict; they never
// change a computed number. Vote tallying and condition transitions are pure
// (see src/lib/committee/voting.ts); this component only renders and mutates.
function CommitteeGovernance({
  projectId,
  voteData,
  condData,
}: {
  projectId: string;
  voteData: VoteData;
  condData: ConditionData;
}) {
  const qc = useQueryClient();
  const castFn = useServerFn(castVote);
  const addFn = useServerFn(addCondition);
  const updFn = useServerFn(updateConditionStatus);
  const [newCondition, setNewCondition] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ic-votes", projectId] });
    qc.invalidateQueries({ queryKey: ["ic-conditions", projectId] });
  };
  const cast = useMutation({
    mutationFn: (vote: (typeof VOTE_OPTIONS)[number]["key"]) =>
      castFn({ data: { project_id: projectId, vote } }),
    onSuccess: () => {
      invalidate();
      toast.success("Vote recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: () => addFn({ data: { project_id: projectId, label: newCondition } }),
    onSuccess: () => {
      invalidate();
      setNewCondition("");
      toast.success("Condition added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const upd = useMutation({
    mutationFn: (v: { id: string; action: "satisfy" | "reopen" | "waive" }) => updFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const tally = voteData.tally;
  const conditions = condData.conditions;
  // The vote feed is a tally only, so reflect the vote this member just cast
  // (persisted server-side; highlighted here for the rest of the session).
  const myVote = cast.variables ?? null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card className="p-5 elevated">
        <div className="flex items-center gap-2">
          <Gavel className="size-4 text-primary" />
          <SectionLabel>Committee Votes</SectionLabel>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Cast your vote">
          {VOTE_OPTIONS.map((v) => {
            const mine = myVote === v.key;
            return (
              <Button
                key={v.key}
                size="sm"
                variant={mine ? "secondary" : "outline"}
                aria-pressed={mine}
                className={mine ? "ring-1 ring-primary" : ""}
                disabled={cast.isPending}
                onClick={() => cast.mutate(v.key)}
              >
                {mine && <CheckCircle2 className="size-3.5" />}
                {v.label}
              </Button>
            );
          })}
        </div>
        {myVote && (
          <p className="mt-2 text-xs text-muted-foreground">
            Your vote: {VOTE_OPTIONS.find((o) => o.key === myVote)?.label}
          </p>
        )}
        <div className="mt-4 text-sm">
          <div className="flex flex-wrap gap-3 num text-xs text-muted-foreground">
            <span>Approve {tally.counts.approve}</span>
            <span>+Conditions {tally.counts.approve_with_conditions}</span>
            <span>Reject {tally.counts.reject}</span>
            <span>Abstain {tally.counts.abstain}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="text-[11px] uppercase">
              {tally.outcome.replace(/_/g, " ")}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {tally.quorumMet
                ? `${tally.approvalPct.toFixed(0)}% approve of ${tally.decisiveVotes} decisive vote(s)`
                : "quorum not met"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Votes are governance over the deterministic engine verdict; they never change a computed
            number.
          </p>
        </div>
      </Card>

      <Card className="p-5 elevated">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-warning" />
          <SectionLabel>
            Tracked Conditions
            {condData.openCount > 0
              ? ` (${condData.openCount} open)`
              : condData.cleared && conditions.length
                ? " (all cleared)"
                : ""}
          </SectionLabel>
        </div>
        <ul className="mt-3 space-y-2">
          {conditions.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              No tracked conditions yet. Add the conditions an approval depends on.
            </li>
          ) : (
            conditions.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${c.status === "open" ? "bg-warning" : c.status === "satisfied" ? "bg-success" : "bg-muted-foreground"}`}
                  />
                  <span
                    className={`truncate ${c.status !== "open" ? "line-through text-muted-foreground" : ""}`}
                  >
                    {c.label}
                  </span>
                  <Badge variant="outline" className="text-[11px] uppercase shrink-0">
                    {c.status}
                  </Badge>
                </span>
                <span className="flex gap-1 shrink-0">
                  {c.status === "open" ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={upd.isPending}
                        onClick={() => upd.mutate({ id: c.id, action: "satisfy" })}
                      >
                        Satisfy
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={upd.isPending}
                        onClick={() => upd.mutate({ id: c.id, action: "waive" })}
                      >
                        Waive
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={upd.isPending}
                      onClick={() => upd.mutate({ id: c.id, action: "reopen" })}
                    >
                      Reopen
                    </Button>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
        <div className="mt-3 flex gap-2">
          <Input
            className="flex-1"
            aria-label="Add a tracked condition"
            placeholder="Add a tracked condition…"
            value={newCondition}
            onChange={(e) => setNewCondition(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCondition && !add.isPending) add.mutate();
            }}
          />
          <Button size="sm" disabled={!newCondition || add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
