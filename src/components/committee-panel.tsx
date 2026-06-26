// Investment Committee: where the decision is actually made and recorded.
// Surfaces the engine recommendation, the two headline scores, the approval
// conditions and findings, then the four IC actions and a permanent audit trail.

import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFinancialOutputs, listDecisions, recordDecision } from "@/lib/assumptions.functions";
import { listAssumptions } from "@/lib/assumptions.functions";
import { listReconciliationFlags } from "@/lib/underwriting.functions";
import { castVote, listIcVotes, addCondition, updateConditionStatus, listConditions } from "@/lib/operating-layer.functions";
import { MemoSection } from "@/components/underwriting-panel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { buildDecision, RECOMMENDATION_TONE } from "@/lib/decision";
import { ScoreDial, RecommendationPill, RiskPill, SectionLabel, Eyebrow, TONE_CHIP, TONE_TEXT, TONE_SOLID } from "@/components/decision-ui";
import { CheckCircle2, FileCheck2, RotateCcw, XCircle, ShieldAlert, ListChecks, Gavel } from "lucide-react";
import { toast } from "sonner";

const outputsQ = (pid: string) => queryOptions({ queryKey: ["outputs", pid], queryFn: () => listFinancialOutputs({ data: { project_id: pid } }) });
const assumptionsQ = (pid: string) => queryOptions({ queryKey: ["assumptions", pid], queryFn: () => listAssumptions({ data: { project_id: pid } }) });
const decisionsQ = (pid: string) => queryOptions({ queryKey: ["decisions", pid], queryFn: () => listDecisions({ data: { project_id: pid } }) });
const flagsQ = (pid: string) => queryOptions({ queryKey: ["recon-flags", pid], queryFn: () => listReconciliationFlags({ data: { project_id: pid } }) });
const icVotesQ = (pid: string) => queryOptions({ queryKey: ["ic-votes", pid], queryFn: () => listIcVotes({ data: { project_id: pid } }) });
const icCondsQ = (pid: string) => queryOptions({ queryKey: ["ic-conditions", pid], queryFn: () => listConditions({ data: { project_id: pid } }) });

const VOTE_OPTIONS: { key: "approve" | "approve_with_conditions" | "reject" | "abstain"; label: string }[] = [
  { key: "approve", label: "Approve" },
  { key: "approve_with_conditions", label: "Approve w/ Conditions" },
  { key: "reject", label: "Reject" },
  { key: "abstain", label: "Abstain" },
];

type ICAction = "approve" | "approve_with_conditions" | "return_to_underwriting" | "reject";

const ACTIONS: { key: ICAction; label: string; icon: any; tone: keyof typeof TONE_SOLID }[] = [
  { key: "approve", label: "Approve", icon: CheckCircle2, tone: "approve" },
  { key: "approve_with_conditions", label: "Approve with Conditions", icon: FileCheck2, tone: "condition" },
  { key: "return_to_underwriting", label: "Return to Underwriting", icon: RotateCcw, tone: "return" },
  { key: "reject", label: "Reject", icon: XCircle, tone: "reject" },
];

export function CommitteePanel({ projectId }: { projectId: string }) {
  const { data: outputs } = useSuspenseQuery(outputsQ(projectId));
  const { data: assumptions } = useSuspenseQuery(assumptionsQ(projectId));
  const { data: decisions } = useSuspenseQuery(decisionsQ(projectId));
  const { data: flags } = useSuspenseQuery(flagsQ(projectId));
  const qc = useQueryClient();
  const fn = useServerFn(recordDecision);

  const decision = buildDecision(outputs as any, assumptions as any);
  const recTone = RECOMMENDATION_TONE[decision.recommendation];

  // Do not present any recommendation, score, or condition before deterministic
  // underwriting and findings exist: that would be a recommendation-like output
  // with no basis. Show workflow state instead.
  if (!decision.hasUnderwriting || !decision.findings) {
    return (
      <Card className="p-12 text-center elevated">
        <Gavel className="size-8 mx-auto text-muted-foreground" />
        <h3 className="display text-xl mt-4">Underwriting not run</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          No investment recommendation available yet. Resolve the required assumptions and run deterministic
          underwriting in <strong>Analysis</strong>. The recommendation, Investment Score, conditions and findings will appear here once outputs exist.
        </p>
      </Card>
    );
  }

  const [action, setAction] = useState<ICAction>(
    decision.recommendation === "APPROVE" ? "approve"
    : decision.recommendation === "REJECT" ? "reject"
    : decision.recommendation === "RETURN_TO_UNDERWRITING" ? "return_to_underwriting"
    : "approve_with_conditions",
  );
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");

  const submit = useMutation({
    mutationFn: () => fn({ data: { project_id: projectId, decision: action, rationale, conditions: conditions || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions", projectId] });
      qc.invalidateQueries({ queryKey: ["audit", projectId] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast.success("IC decision recorded to the audit trail");
      setRationale(""); setConditions("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const errorFlags = (flags as any[]).filter((f) => f.severity === "error");
  const conditionsList = decision.findings?.approvalConditions ?? [];

  return (
    <div className="space-y-5">
      {/* Verdict band */}
      <Card className="p-6 elevated">
        <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-center">
          <div>
            <Eyebrow>Engine Recommendation</Eyebrow>
            <div className="mt-3"><RecommendationPill rec={decision.recommendation} /></div>
            <p className="text-sm text-muted-foreground mt-3 max-w-xl">
              {decision.findings?.recommendationFindings?.[0]?.rationale
                ?? "The recommendation is produced by the deterministic gate set over approved inputs."}
            </p>
            <div className="mt-4"><RiskPill rating={decision.riskRating} /></div>
          </div>
          <div className="flex gap-8 justify-center">
            <ScoreDial value={decision.investmentScore} label="Investment Score" tone={recTone} size={120} />
            <ScoreDial value={decision.confidenceScore} label="Confidence" tone="return" size={120} />
          </div>
        </div>
      </Card>

      {errorFlags.length > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-4" />
            <span className="text-sm font-semibold">Unresolved reconciliation errors block a clean approval</span>
          </div>
          <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5">
            {errorFlags.map((f) => <li key={f.id}>{f.message}</li>)}
          </ul>
        </Card>
      )}

      {/* Approval conditions + critical findings */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2"><ListChecks className="size-4 text-warning" /><SectionLabel>Approval Conditions</SectionLabel></div>
          {conditionsList.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">No conditions generated by the findings engine.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {conditionsList.map((c) => (
                <li key={c.id} className="flex gap-2.5 text-sm">
                  <span className="mt-1.5 size-1.5 rounded-full bg-warning shrink-0" />
                  <span><span className="font-medium">{c.title}.</span> <span className="text-muted-foreground">{c.rationale}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5 elevated">
          <div className="flex items-center gap-2"><ShieldAlert className="size-4 text-destructive" /><SectionLabel>Critical & High Findings</SectionLabel></div>
          {(decision.findings?.criticalFindings?.length ?? 0) + (decision.findings?.highPriorityFindings?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">No critical or high-priority findings.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {[...(decision.findings?.criticalFindings ?? []), ...(decision.findings?.highPriorityFindings ?? [])].slice(0, 6).map((c) => (
                <li key={c.id} className="flex gap-2.5 text-sm">
                  <span className={`mt-1.5 size-1.5 rounded-full shrink-0 ${c.severity === "critical" ? "bg-destructive" : "bg-warning"}`} />
                  <span><span className="font-medium">{c.title}.</span> <span className="text-muted-foreground">{c.rationale}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Committee votes + tracked conditions (governance over the engine verdict) */}
      <CommitteeGovernance projectId={projectId} />

      {/* IC decision */}
      <Card className="p-6 elevated" data-section="record-decision">
        <div className="flex items-center gap-2"><Gavel className="size-4 text-primary" /><SectionLabel>Record Committee Decision</SectionLabel></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
          {ACTIONS.map((a) => {
            const active = action === a.key;
            const Icon = a.icon;
            return (
              <button key={a.key} onClick={() => setAction(a.key)}
                className={`rounded-lg border p-3 text-left transition-all ${active ? `${TONE_CHIP[a.tone]} ring-1 ring-current` : "border-border hover:border-foreground/30 text-muted-foreground"}`}>
                <Icon className={`size-5 ${active ? TONE_TEXT[a.tone] : ""}`} />
                <div className="text-xs font-semibold mt-2 leading-tight text-foreground">{a.label}</div>
              </button>
            );
          })}
        </div>
        <Textarea className="mt-4" rows={3} placeholder="Committee rationale: cite approved assumptions, returns, DSCR, stress results, and market guidance." value={rationale} onChange={(e) => setRationale(e.target.value)} />
        {(action === "approve_with_conditions" || action === "return_to_underwriting") && (
          <Textarea className="mt-2" rows={2}
            placeholder={action === "approve_with_conditions"
              ? "Conditions: e.g. cap hard-cost re-bid ≤ +5%, confirm rate ≤ 6.5%, OpEx ratio ≤ 38%."
              : "What must be re-underwritten before this returns to committee?"}
            value={conditions} onChange={(e) => setConditions(e.target.value)} />
        )}
        <Button className="mt-4" onClick={() => submit.mutate()} disabled={!rationale || submit.isPending}>
          {submit.isPending ? "Recording…" : "Record decision"}
        </Button>
      </Card>

      {/* Investment Committee memo */}
      <MemoSection projectId={projectId} />

      {/* Permanent audit trail */}
      <Card className="overflow-hidden elevated">
        <div className="px-5 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
          <SectionLabel>Decision History · Audit Trail</SectionLabel>
          <span className="num text-xs text-muted-foreground">{decisions.length}</span>
        </div>
        {decisions.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground text-center">No committee decisions recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {decisions.map((d: any) => {
              const tone = d.decision === "approve" ? "approve" : d.decision === "reject" ? "reject" : d.decision === "return_to_underwriting" ? "return" : "condition";
              return (
                <li key={d.id} className="p-5">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={`text-[10px] uppercase ${TONE_CHIP[tone as keyof typeof TONE_CHIP]}`}>{String(d.decision).replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()} · {d.user_name}</span>
                  </div>
                  <p className="mt-2.5 text-sm whitespace-pre-wrap">{d.rationale}</p>
                  {d.conditions && (
                    <div className="mt-2 text-xs">
                      <span className="font-semibold uppercase tracking-widest text-warning">Conditions: </span>
                      <span className="text-muted-foreground whitespace-pre-wrap">{d.conditions}</span>
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

// 3B: committee voting + tracked approval conditions. Votes and conditions are
// governance layered ON TOP of the deterministic engine verdict; they never
// change a computed number. Vote tallying and condition transitions are pure
// (see src/lib/committee/voting.ts); this component only renders and mutates.
function CommitteeGovernance({ projectId }: { projectId: string }) {
  const { data: voteData } = useSuspenseQuery(icVotesQ(projectId));
  const { data: condData } = useSuspenseQuery(icCondsQ(projectId));
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
    mutationFn: (vote: (typeof VOTE_OPTIONS)[number]["key"]) => castFn({ data: { project_id: projectId, vote } }),
    onSuccess: () => { invalidate(); toast.success("Vote recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: () => addFn({ data: { project_id: projectId, label: newCondition } }),
    onSuccess: () => { invalidate(); setNewCondition(""); toast.success("Condition added"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const upd = useMutation({
    mutationFn: (v: { id: string; action: "satisfy" | "reopen" | "waive" }) => updFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const tally = voteData.tally;
  const conditions = condData.conditions as Array<{ id: string; label: string; status: string }>;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card className="p-5 elevated">
        <div className="flex items-center gap-2"><Gavel className="size-4 text-primary" /><SectionLabel>Committee Votes</SectionLabel></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {VOTE_OPTIONS.map((v) => (
            <Button key={v.key} size="sm" variant="outline" disabled={cast.isPending} onClick={() => cast.mutate(v.key)}>{v.label}</Button>
          ))}
        </div>
        <div className="mt-4 text-sm">
          <div className="flex flex-wrap gap-3 num text-xs text-muted-foreground">
            <span>Approve {tally.counts.approve}</span>
            <span>+Conditions {tally.counts.approve_with_conditions}</span>
            <span>Reject {tally.counts.reject}</span>
            <span>Abstain {tally.counts.abstain}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase">{tally.outcome.replace(/_/g, " ")}</Badge>
            <span className="text-xs text-muted-foreground">
              {tally.quorumMet ? `${tally.approvalPct.toFixed(0)}% approve of ${tally.decisiveVotes} decisive vote(s)` : "quorum not met"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Votes are governance over the deterministic engine verdict; they never change a computed number.
          </p>
        </div>
      </Card>

      <Card className="p-5 elevated">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-warning" />
          <SectionLabel>Tracked Conditions{condData.openCount > 0 ? ` (${condData.openCount} open)` : condData.cleared && conditions.length ? " (all cleared)" : ""}</SectionLabel>
        </div>
        <ul className="mt-3 space-y-2">
          {conditions.length === 0 ? (
            <li className="text-sm text-muted-foreground">No tracked conditions yet. Add the conditions an approval depends on.</li>
          ) : conditions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`size-1.5 rounded-full shrink-0 ${c.status === "open" ? "bg-warning" : c.status === "satisfied" ? "bg-success" : "bg-muted-foreground"}`} />
                <span className={`truncate ${c.status !== "open" ? "line-through text-muted-foreground" : ""}`}>{c.label}</span>
                <Badge variant="outline" className="text-[9px] uppercase shrink-0">{c.status}</Badge>
              </span>
              <span className="flex gap-1 shrink-0">
                {c.status === "open" ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={upd.isPending} onClick={() => upd.mutate({ id: c.id, action: "satisfy" })}>Satisfy</Button>
                    <Button size="sm" variant="ghost" disabled={upd.isPending} onClick={() => upd.mutate({ id: c.id, action: "waive" })}>Waive</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" disabled={upd.isPending} onClick={() => upd.mutate({ id: c.id, action: "reopen" })}>Reopen</Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Add a tracked condition..."
            value={newCondition}
            onChange={(e) => setNewCondition(e.target.value)}
          />
          <Button size="sm" disabled={!newCondition || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      </Card>
    </div>
  );
}
