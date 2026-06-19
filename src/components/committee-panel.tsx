// Investment Committee — where the decision is actually made and recorded.
// Surfaces the engine recommendation, the two headline scores, the approval
// conditions and findings, then the four IC actions and a permanent audit trail.

import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFinancialOutputs, listDecisions, recordDecision } from "@/lib/assumptions.functions";
import { listAssumptions } from "@/lib/assumptions.functions";
import { listReconciliationFlags } from "@/lib/underwriting.functions";
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
  // underwriting and findings exist — that would be a recommendation-like output
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

      {/* IC decision */}
      <Card className="p-6 elevated">
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
        <Textarea className="mt-4" rows={3} placeholder="Committee rationale — cite approved assumptions, returns, DSCR, stress results, and market guidance." value={rationale} onChange={(e) => setRationale(e.target.value)} />
        {(action === "approve_with_conditions" || action === "return_to_underwriting") && (
          <Textarea className="mt-2" rows={2}
            placeholder={action === "approve_with_conditions"
              ? "Conditions — e.g. cap hard-cost re-bid ≤ +5%, confirm rate ≤ 6.5%, OpEx ratio ≤ 38%."
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
