// Assumption Review Center: project-scoped table with approve / modify /
// reject / needs-review actions, source panel, and version history drawer.

import { useEffect, useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAssumptions,
  listAssumptionVersions,
  reviewAssumption,
  secondApproveOverride,
  extractAssumptions,
  getReadiness,
} from "@/lib/assumptions.functions";
import { runFullUnderwriting } from "@/lib/underwriting.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field as FormField } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Check,
  X,
  Edit3,
  Eye,
  History,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Calculator,
} from "lucide-react";
import { REQUIRED_KEYS } from "@/lib/assumption-taxonomy";
import {
  assumptionProvenance,
  confidenceLabel,
  statusClassName,
  statusConfig,
} from "@/lib/status-taxonomy";
import { toast } from "sonner";

const assumptionsQ = (pid: string) =>
  queryOptions({
    queryKey: ["assumptions", pid],
    queryFn: () => listAssumptions({ data: { project_id: pid } }),
  });
const readinessQ = (pid: string) =>
  queryOptions({
    queryKey: ["readiness", pid],
    queryFn: () => getReadiness({ data: { project_id: pid } }),
  });

const BAND_STYLES: Record<string, string> = {
  high: "text-success",
  medium: "text-warning",
  low: "text-destructive",
  missing: "text-muted-foreground",
};

function fmt(a: any) {
  if (a.value_numeric == null && !a.value_text) return "–";
  if (a.value_text) return a.value_text;
  const n = Number(a.value_numeric);
  if (a.unit === "$")
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  if (a.unit === "%") return `${n}%`;
  if (a.unit === "x") return `${n}x`;
  return `${n.toLocaleString()} ${a.unit ?? ""}`.trim();
}

// Conservative pick per field (taxonomy key). Mirrors the engine's
// conservativePick direction so the UI and the deterministic resolver agree.
const CONSERVATIVE_MAX_KEYS = new Set([
  "exit_cap_rate",
  "opex_ratio",
  "interest_rate",
  "disposition_cost_pct",
  "equity_amount",
  "land_cost",
  "hard_costs",
  "soft_costs",
  "contingency",
  "financing_costs",
  "total_project_cost",
]);
const CONSERVATIVE_MIN_KEYS = new Set([
  "debt_amount",
  "stabilized_occupancy",
  "residential_occupancy",
  "retail_occupancy",
  "office_occupancy",
  "dry_warehouse_occupancy",
  "cold_storage_occupancy",
  "last_mile_flex_occupancy",
  "residential_rent_monthly",
  "retail_rent_psf",
  "office_rent_psf",
  "dry_warehouse_rent_psf",
  "cold_storage_rent_psf",
  "last_mile_flex_rent_psf",
  "rent_growth",
  "other_income_annual",
]);
function conservativeValue(fieldKey: string, values: number[]): number | null {
  if (!values.length) return null;
  if (CONSERVATIVE_MAX_KEYS.has(fieldKey)) return Math.max(...values);
  if (CONSERVATIVE_MIN_KEYS.has(fieldKey)) return Math.min(...values);
  return null; // no defined conservative direction: analyst must pick
}
const isInterestKey = (k: string) => k === "interest_rate";
const supersedingSource = (source?: string | null) =>
  !!source && /rate[\s_-]?lock|rate[\s_-]?update|financing[\s_-]?update|addendum/i.test(source);

export function AssumptionReviewCenter({ projectId }: { projectId: string }) {
  const { data: assumptions } = useSuspenseQuery(assumptionsQ(projectId));
  const { data: readiness } = useSuspenseQuery(readinessQ(projectId));
  const qc = useQueryClient();
  const extractFn = useServerFn(extractAssumptions);
  const recomputeFn = useServerFn(runFullUnderwriting);
  const reviewFn = useServerFn(reviewAssumption);

  const [sourceOf, setSourceOf] = useState<any | null>(null);
  const [editOf, setEditOf] = useState<any | null>(null);
  const [historyOf, setHistoryOf] = useState<any | null>(null);
  const [report, setReport] = useState<any | null>(null);
  // AI runs by default; the deterministic engine is always the backup. The
  // toggle lets an analyst force the pure deterministic path on demand.
  const [aiMode, setAiMode] = useState(true);
  const mode = aiMode ? "ai" : ("deterministic" as const);
  const confidenceCounts = assumptions.reduce(
    (acc, a) => {
      const band =
        a.confidence_band === "high" ||
        a.confidence_band === "medium" ||
        a.confidence_band === "low" ||
        a.confidence_band === "missing"
          ? a.confidence_band
          : "missing";
      acc[band] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0, missing: 0 },
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["assumptions", projectId] });
    qc.invalidateQueries({ queryKey: ["readiness", projectId] });
    qc.invalidateQueries({ queryKey: ["outputs", projectId] });
    qc.invalidateQueries({ queryKey: ["risks", projectId] });
    qc.invalidateQueries({ queryKey: ["uw-readiness", projectId] });
    qc.invalidateQueries({ queryKey: ["recon-flags", projectId] });
  };

  const extract = useMutation({
    mutationFn: () => extractFn({ data: { project_id: projectId, mode } }),
    onSuccess: (r: any) => {
      invalidate();
      setReport(r);
      toast.success(
        `Pipeline complete (${r.analysis_mode === "ai" ? "AI" : "deterministic"}): ${r.found} found · ${r.conflicting} conflicting · ${r.missing} missing`,
      );
      if (r.ai_note) toast.message(r.ai_note);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const recompute = useMutation({
    mutationFn: () => recomputeFn({ data: { project_id: projectId, mode } }),
    onSuccess: (r: any) => {
      invalidate();
      if (r.blocked)
        toast.error("Underwriting is blocked: resolve missing/conflicting inputs first.");
      else
        toast.success(
          `Underwriting recomputed (${r.analysis_mode === "ai" ? "AI" : "deterministic"})`,
        );
      if (r.ai_note) toast.message(r.ai_note);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const review = useMutation({
    mutationFn: (d: any) => reviewFn({ data: d }),
    onSuccess: () => {
      invalidate();
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const secondApproveFn = useServerFn(secondApproveOverride);
  const secondApprove = useMutation({
    mutationFn: (id: string) => secondApproveFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Override second-approved -- now applied to the engine");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Group by category
  const grouped = assumptions.reduce<Record<string, any[]>>((acc, a) => {
    (acc[a.category || "Other"] ||= []).push(a);
    return acc;
  }, {});

  // Conflicts get a dedicated resolution center; required inputs are surfaced as critical.
  const conflicts = assumptions.filter((a) => a.status === "conflicting");
  const critical = assumptions.filter((a) => REQUIRED_KEYS.includes(a.field_key));

  return (
    <div className="space-y-4">
      {/* Readiness header */}
      <Card className="p-5">
        <div className="grid md:grid-cols-5 gap-4 items-center">
          <div className="col-span-2">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Deal Readiness Score
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <div className="num text-4xl text-primary">{readiness.score}</div>
              <div className="text-xs text-muted-foreground">/ 100</div>
            </div>
            <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${readiness.score}%` }} />
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Approved
            </div>
            <div className="num text-lg mt-1">
              {readiness.approved} / {readiness.total}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Avg Confidence
            </div>
            <div className="num text-lg mt-1">{readiness.avg_confidence}%</div>
          </div>
          <div className="flex flex-col gap-2">
            {/* Analysis mode: AI by default, deterministic engine as backup. */}
            <div
              className="inline-flex rounded-md border border-border p-0.5 text-[11px] font-medium"
              role="group"
              aria-label="Analysis mode"
            >
              <button
                type="button"
                onClick={() => setAiMode(true)}
                aria-pressed={aiMode}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${aiMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Sparkles className="size-3" />
                AI
              </button>
              <button
                type="button"
                onClick={() => setAiMode(false)}
                aria-pressed={!aiMode}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${!aiMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Calculator className="size-3" />
                Engine
              </button>
            </div>
            <Button size="sm" onClick={() => extract.mutate()} disabled={extract.isPending}>
              <Sparkles className="size-4 mr-1" />
              {extract.isPending ? "Extracting…" : "Run Extraction"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
            >
              <RefreshCw className="size-4 mr-1" />
              {recompute.isPending ? "Computing…" : "Recompute model"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-sm">
          <Field label="Total Assumptions">{assumptions.length}</Field>
          <Field label="High Confidence">{confidenceCounts.high}</Field>
          <Field label="Medium Confidence">{confidenceCounts.medium}</Field>
          <Field label="Low Confidence">{confidenceCounts.low}</Field>
          <Field label="Missing">{confidenceCounts.missing}</Field>
        </div>
        {readiness.missing_required.length > 0 && (
          <div className="mt-4 flex items-start gap-2 text-xs text-warning bg-warning/5 border border-warning/20 rounded p-3">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold uppercase tracking-widest">
                Missing required assumptions
              </div>
              <div className="mt-1 text-muted-foreground">
                {readiness.missing_required.join(" · ")}
              </div>
            </div>
          </div>
        )}
      </Card>

      {report && <ExtractionReportCard report={report} onClose={() => setReport(null)} />}
      {report?.debug && <ExtractionDebugCard debug={report.debug} />}

      {/* Conflict Resolution Center: conflicts are first-class, not buried */}
      {conflicts.length > 0 && (
        <Card className="p-5 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" />
            <span className="text-[11px] uppercase tracking-widest font-semibold">
              Conflict Resolution Center · {conflicts.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            These inputs have conflicting documented values and block underwriting. Pick one: values
            are never averaged.
          </p>
          <div className="mt-3 grid md:grid-cols-2 gap-3">
            {conflicts.map((a) => {
              const values = (Array.isArray(a.conflict_values) ? a.conflict_values : [])
                .map((cv: any) => ({
                  value: typeof cv === "object" ? cv.value : cv,
                  source: typeof cv === "object" ? cv.source : null,
                }))
                .filter((cv: any) => Number.isFinite(Number(cv.value)));
              const conservative = conservativeValue(
                a.field_key,
                values.map((v: any) => Number(v.value)),
              );
              return (
                <div
                  key={a.id}
                  className="rounded-lg border border-destructive/30 bg-background p-3"
                >
                  <div className="text-sm font-medium">{a.field_label}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {values.map((cv: any, i: number) => {
                      const supersede = isInterestKey(a.field_key) && supersedingSource(cv.source);
                      return (
                        <Button
                          key={i}
                          size="sm"
                          variant="outline"
                          disabled={review.isPending}
                          className={supersede ? "border-warning/50" : ""}
                          title={
                            supersede ? "Likely supersedes earlier term sheet" : cv.source || ""
                          }
                          onClick={() =>
                            review.mutate({
                              id: a.id,
                              action: "modify",
                              value_numeric: Number(cv.value),
                              change_reason: `Resolved conflict → ${cv.value}`,
                            })
                          }
                        >
                          <span className="num">{Number(cv.value).toLocaleString()}</span>
                          {cv.source && (
                            <span className="text-[11px] text-muted-foreground ml-1.5 max-w-[110px] truncate">
                              {cv.source}
                            </span>
                          )}
                          {supersede && (
                            <span className="text-[11px] text-warning ml-1 uppercase tracking-wider">
                              supersedes
                            </span>
                          )}
                        </Button>
                      );
                    })}
                    {conservative != null && (
                      <Button
                        size="sm"
                        disabled={review.isPending}
                        onClick={() =>
                          review.mutate({
                            id: a.id,
                            action: "modify",
                            value_numeric: conservative,
                            change_reason: `Resolved conflict → conservative ${conservative}`,
                          })
                        }
                      >
                        Use conservative ({conservative.toLocaleString()})
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditOf(a)}>
                      Enter value…
                    </Button>
                  </div>
                  {isInterestKey(a.field_key) &&
                    values.some((cv: any) => supersedingSource(cv.source)) && (
                      <p className="text-[11px] text-warning mt-2">
                        A rate lock / addendum value is present and likely supersedes the earlier
                        term sheet rate. Confirm before resolving: not auto-applied.
                      </p>
                    )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Critical Assumptions: required fields driving the recommendation */}
      {critical.length > 0 && (
        <Card className="p-5 elevated">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
            Critical Assumptions
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Required inputs the recommendation hinges on.
          </p>
          <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {critical.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">{a.field_label}</span>
                  <StatusBadge domain="assumption" status={a.status} />
                </div>
                <div className="num text-lg mt-1">{fmt(a)}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {assumptionProvenance(a).approvalLabel}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {assumptions.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No assumptions yet. Upload documents to this deal, then click{" "}
          <strong>Run Extraction</strong>.
        </Card>
      ) : (
        Object.entries(grouped).map(([cat, rows]) => (
          <div key={cat}>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                {cat}
              </span>
              <span className="num text-xs text-muted-foreground">{rows.length}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {rows.map((a) => (
                <AssumptionCard
                  key={a.id}
                  a={a}
                  onSource={() => setSourceOf(a)}
                  onEdit={() => setEditOf(a)}
                  onHistory={() => setHistoryOf(a)}
                  onApprove={() =>
                    review.mutate({
                      id: a.id,
                      action: "approve",
                      change_reason: "Approved as extracted",
                    })
                  }
                  onReject={() =>
                    review.mutate({ id: a.id, action: "reject", change_reason: "Rejected" })
                  }
                  onSecondApprove={() => secondApprove.mutate(a.id)}
                  pending={review.isPending || secondApprove.isPending}
                />
              ))}
            </div>
          </div>
        ))
      )}

      <SourcePanel a={sourceOf} onClose={() => setSourceOf(null)} />
      <EditPanel
        a={editOf}
        onClose={() => setEditOf(null)}
        onSubmit={(d) => {
          review.mutate(d);
          setEditOf(null);
        }}
      />
      <HistoryPanel a={historyOf} onClose={() => setHistoryOf(null)} />
    </div>
  );
}

function SourcePanel({ a, onClose }: { a: any | null; onClose: () => void }) {
  const provenance = a ? assumptionProvenance(a) : null;
  return (
    <Sheet open={!!a} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="font-mono">{a?.field_label}</SheetTitle>
        </SheetHeader>
        {a && (
          <div className="mt-4 space-y-4 text-sm">
            <Field label="Value">{fmt(a)}</Field>
            <Field label="Status">
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge domain="assumption" status={a.status} />
                <Badge variant="outline" className="text-[11px]">
                  {provenance?.label}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  {provenance?.approvalLabel}
                </Badge>
              </div>
            </Field>
            <Field label="Source document">
              {a.documents?.name || a.source_location || provenance?.detail || "Not available"}
            </Field>
            <Field label="Confidence">
              {confidenceLabel(a.confidence_score, a.confidence_band)}
            </Field>
            <Field label="Source text">
              <blockquote className="text-xs italic text-muted-foreground border-l-2 border-primary pl-3 mt-1 whitespace-pre-wrap">
                {a.source_text || "Not available"}
              </blockquote>
            </Field>
            <Field label="Approval">
              {a.dual_control_pending
                ? "Dual control pending"
                : a.approved_by
                  ? `Approved by ${a.approved_by}${a.approved_at ? ` · ${new Date(a.approved_at).toLocaleString()}` : ""}`
                  : "Not approved"}
            </Field>
            <Field label="Override reason">{a.override_reason || "Not available"}</Field>
            <Field label="AI / mapping note">{a.ai_reasoning || "Not available"}</Field>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditPanel({
  a,
  onClose,
  onSubmit,
}: {
  a: any | null;
  onClose: () => void;
  onSubmit: (d: any) => void;
}) {
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isTextUnit = a?.unit === "text";
  // Clear any stale validation error when a different assumption is opened.
  useEffect(() => {
    setError(null);
  }, [a?.id]);
  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify {a?.field_label}</DialogTitle>
        </DialogHeader>
        {a && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = val.trim();
              if (isTextUnit) {
                if (!trimmed) {
                  setError("Enter a value.");
                  return;
                }
                setError(null);
                onSubmit({
                  id: a.id,
                  action: "modify",
                  value_numeric: null,
                  value_text: val,
                  change_reason: reason || "Manual update",
                });
                return;
              }
              // Numeric field: Number("") === 0, so an empty/whitespace input
              // must be rejected explicitly – only a real finite number writes.
              const num = Number(trimmed);
              if (trimmed === "" || !Number.isFinite(num)) {
                setError("Enter a valid number.");
                return;
              }
              setError(null);
              onSubmit({
                id: a.id,
                action: "modify",
                value_numeric: num,
                value_text: null,
                change_reason: reason || "Manual update",
              });
            }}
            className="space-y-3"
          >
            <FormField label={`New value (${a.unit})`} error={error ?? undefined}>
              <Input
                autoFocus
                inputMode={isTextUnit ? undefined : "decimal"}
                placeholder={`Current: ${fmt(a)}`}
                value={val}
                onChange={(e) => {
                  setVal(e.target.value);
                  if (error) setError(null);
                }}
              />
            </FormField>
            <div>
              <label className="text-xs text-muted-foreground">Change reason</label>
              <Textarea
                rows={2}
                placeholder="e.g. Lender confirmed 6.25%"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Save & approve</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryPanel({ a, onClose }: { a: any | null; onClose: () => void }) {
  return (
    <Sheet open={!!a} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[500px] sm:max-w-[500px]">
        <SheetHeader>
          <SheetTitle className="font-mono">{a?.field_label}: versions</SheetTitle>
        </SheetHeader>
        {a && <VersionsList assumptionId={a.id} />}
      </SheetContent>
    </Sheet>
  );
}

function VersionsList({ assumptionId }: { assumptionId: string }) {
  const fn = useServerFn(listAssumptionVersions);
  const { data: versions = [] } = useSuspenseQuery(
    queryOptions({
      queryKey: ["versions", assumptionId],
      queryFn: () => fn({ data: { assumption_id: assumptionId } }),
    }),
  );
  if (!versions.length)
    return <p className="mt-4 text-sm text-muted-foreground">No version history.</p>;
  return (
    <ol className="mt-4 space-y-3">
      {versions.map((v: any) => (
        <li key={v.id} className="border-l-2 border-primary/40 pl-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-primary">v{v.version_number}</span>
            <StatusBadge domain="assumption" status={v.status} />
            <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
          </div>
          <div className="num text-sm mt-1">
            {v.value_numeric ?? v.value_text ?? "Not available"}
          </div>
          <div className="text-muted-foreground mt-0.5">
            by {v.changed_by_name || "user"} · {v.change_reason || "Not available"}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ExtractionReportCard({ report, onClose }: { report: any; onClose: () => void }) {
  return (
    <Card className="p-5 border-primary/40">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Extraction Audit Report · 3-stage pipeline
            </div>
            <ModeBadge mode={report.analysis_mode} />
          </div>
          <div className="text-sm mt-1">
            Stage 1 parsed <strong className="font-mono">{report.stage1_candidates}</strong>{" "}
            candidates · Stage 2 classified{" "}
            <strong className="font-mono">{report.stage2_classified}</strong> · Stage 3 inferred{" "}
            <strong className="font-mono">{report.stage3_inferred_via_alias}</strong> via alias
          </div>
          {report.ai_note && <div className="text-[11px] text-warning mt-1">{report.ai_note}</div>}
          {report.authority_note && (
            <div className="text-[11px] text-muted-foreground mt-1">{report.authority_note}</div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Dismiss
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
        <Field label="Found">{report.found}</Field>
        <Field label="Conflicting">{report.conflicting}</Field>
        <Field label="Missing">{report.missing}</Field>
        <Field label="AI-classified">{report.ai_classified ?? 0}</Field>
        <Field label="Underwriting ready">
          {report.can_underwrite ? "Yes: all required present" : "No: required fields missing"}
        </Field>
      </div>
      {report.conflicts?.length > 0 && (
        <div className="mt-3 text-xs">
          <span className="font-semibold text-destructive uppercase tracking-widest">
            Conflicts:
          </span>{" "}
          <span className="text-muted-foreground">{report.conflicts.join(" · ")}</span>
        </div>
      )}
      {report.missing_required?.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="font-semibold text-warning uppercase tracking-widest">
            Missing required:
          </span>{" "}
          <span className="text-muted-foreground">{report.missing_required.join(" · ")}</span>
        </div>
      )}
    </Card>
  );
}

function recoveryLabel(d: any): string {
  const parts: string[] = [];
  if (d.recovered_via_ocr) parts.push(`OCR ${Math.round(d.ocr_confidence ?? 0)}%`);
  if (d.ocr_truncated) parts.push(`first ${d.ocr_pages_processed}/${d.ocr_total_pages} pages`);
  if (Array.isArray(d.sheets_selected) && d.sheets_selected.length)
    parts.push(`sheet: ${d.sheets_selected.join(", ")}`);
  if (Number(d.merged_cells_filled) > 0) parts.push(`merged: ${d.merged_cells_filled}`);
  return parts.length ? parts.join(" · ") : d.download_ok ? "embedded text" : "";
}

function ExtractionDebugCard({ debug }: { debug: any }) {
  const perDoc: any[] = debug.per_document ?? [];
  const needsVerification = perDoc.filter((d) => d.needs_verification);
  return (
    <Card className="p-5 border-chart-2/40">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        Extraction Debug Trace
      </div>

      {/* Auto-extraction is a checkable first pass, not gospel: flag anything
          recovered via OCR (low confidence) for human verification. */}
      {needsVerification.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-xs">
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-warning" />
          <div>
            <span className="font-semibold uppercase tracking-widest text-warning">
              Verify before approving:
            </span>{" "}
            <span className="text-muted-foreground">
              {needsVerification.length} document{needsVerification.length === 1 ? "" : "s"}{" "}
              recovered via OCR (
              {needsVerification
                .map((d) => `${d.name} ${Math.round(d.ocr_confidence ?? 0)}%`)
                .join(", ")}
              ). OCR text can misread digits and page-capped scans may omit later pages: confirm
              each extracted value against the source.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-3 text-sm">
        <Field label="Docs seen">{debug.documents_seen}</Field>
        <Field label="Downloaded">{debug.documents_downloaded}</Field>
        <Field label="Failed">{debug.documents_failed}</Field>
        <Field label="Candidates">{debug.total_candidates}</Field>
        <Field label="Alias mapped">{debug.alias_mapped_count}</Field>
        <Field label="OCR recovered">{needsVerification.length}</Field>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
        <Field label="Grouped keys">{debug.grouped_keys?.length ?? 0}</Field>
        <Field label="Conflicts">{debug.conflict_keys?.join(", ") || "Not available"}</Field>
        <Field label="Inserted">{debug.inserted_assumptions}</Field>
        <Field label="Updated">{debug.updated_assumptions}</Field>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="data-grid w-full text-xs">
          <thead>
            <tr className="bg-muted/20">
              <th className="text-left">Document</th>
              <th className="text-center">DL</th>
              <th className="text-right">Text len</th>
              <th className="text-right">Candidates</th>
              <th className="text-left">Recovery</th>
              <th className="text-left">Preview (value @ source) / error</th>
            </tr>
          </thead>
          <tbody>
            {perDoc.map((d: any) => (
              <tr
                key={d.document_id}
                className={`align-top hover:bg-accent/30 ${d.needs_verification ? "bg-warning/10" : ""}`}
              >
                <td className="font-medium">
                  {d.name}
                  {d.needs_verification && (
                    <span className="ml-1 text-warning" title="Recovered via OCR: verify">
                      !
                    </span>
                  )}
                </td>
                <td className="text-center">{d.download_ok ? "OK" : "x"}</td>
                <td className="text-right num">{d.text_length.toLocaleString()}</td>
                <td className="text-right num">{d.candidate_count}</td>
                <td
                  className="text-muted-foreground max-w-[160px] truncate"
                  title={recoveryLabel(d)}
                >
                  {recoveryLabel(d)}
                </td>
                <td className="text-muted-foreground max-w-[280px] truncate">
                  {d.error ? (
                    <span className="text-destructive">{d.error}</span>
                  ) : (
                    d.candidates_preview
                      ?.map((c: any) =>
                        c.source_location ? `${c.value_text} @ ${c.source_location}` : c.value_text,
                      )
                      .join(" · ") || d.text_preview
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {debug.warnings?.length > 0 && (
        <div className="mt-3 text-xs text-warning">
          <span className="font-semibold uppercase tracking-widest">Warnings:</span>{" "}
          <span className="text-muted-foreground">{debug.warnings.join(" · ")}</span>
        </div>
      )}
    </Card>
  );
}

function AssumptionCard({
  a,
  onSource,
  onEdit,
  onHistory,
  onApprove,
  onReject,
  onSecondApprove,
  pending,
}: {
  a: any;
  onSource: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSecondApprove: () => void;
  pending: boolean;
}) {
  const band = a.confidence_band as keyof typeof BAND_STYLES;
  const status = statusConfig("assumption", a.status);
  const provenance = assumptionProvenance(a);
  return (
    <Card className="p-4 flex flex-col gap-3">
      {a.dual_control_pending && (
        <div className="rounded border border-warning/40 bg-warning/5 px-2.5 py-2 text-[11px] text-warning">
          <div className="font-semibold uppercase tracking-wide">Awaiting second approval</div>
          <div className="text-muted-foreground mt-0.5">
            Material override entered{a.override_reason ? `: "${a.override_reason}"` : ""}. A
            second, different approver must confirm before it reaches the engine.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 mt-1.5 text-[11px]"
            disabled={pending}
            onClick={onSecondApprove}
          >
            Second-approve override
          </Button>
        </div>
      )}
      {!a.dual_control_pending && a.second_approval_by && (
        <div className="text-[11px] text-success">
          ✓ Dual-control satisfied{a.second_approver_name ? ` · ${a.second_approver_name}` : ""}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight">{a.field_label}</div>
          <div className="num text-xl mt-1">{fmt(a)}</div>
        </div>
        <StatusBadge domain="assumption" status={a.status} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="text-[11px]">
          {provenance.label}
        </Badge>
        <Badge
          variant="outline"
          className={`text-[11px] ${provenance.approvedForUnderwriting ? "text-success border-success/30" : "text-muted-foreground"}`}
        >
          {provenance.approvalLabel}
        </Badge>
        {a.status === "conflicting" && (
          <Badge variant="outline" className="text-[11px] text-destructive border-destructive/30">
            Blocks run
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className={`font-mono ${BAND_STYLES[band] ?? ""}`}>
          {confidenceLabel(a.confidence_score, a.confidence_band)}
        </span>
        <span className="truncate max-w-[130px]" title={provenance.detail || ""}>
          {provenance.detail || "no source"}
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground -mt-1">{status.message}</div>
      <div className="flex items-center gap-0.5 border-t border-border pt-2 -mb-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="View source"
          aria-label={`View source for ${a.field_label}`}
          onClick={onSource}
        >
          <Eye className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Modify"
          aria-label={`Modify ${a.field_label}`}
          onClick={onEdit}
        >
          <Edit3 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Version history"
          aria-label={`Version history for ${a.field_label}`}
          onClick={onHistory}
        >
          <History className="size-3.5" />
        </Button>
        <div className="ml-auto flex gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-success"
            title="Approve"
            aria-label={`Approve ${a.field_label}`}
            disabled={a.status === "missing" || a.status === "conflicting" || pending}
            onClick={onApprove}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive"
            title="Reject"
            aria-label={`Reject ${a.field_label}`}
            disabled={pending}
            onClick={onReject}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StatusBadge({
  domain,
  status,
}: {
  domain: Parameters<typeof statusConfig>[0];
  status?: string | null;
}) {
  const cfg = statusConfig(domain, status);
  return (
    <Badge variant="outline" className={`${statusClassName(cfg.severity)} text-[11px] shrink-0`}>
      {cfg.label}
    </Badge>
  );
}

// Shows which analysis path actually produced the result: AI or the
// deterministic backup: so the run is never ambiguous.
function ModeBadge({ mode }: { mode?: "ai" | "deterministic" }) {
  if (!mode) return null;
  const isAI = mode === "ai";
  return (
    <Badge
      variant="outline"
      className={`text-[11px] uppercase tracking-wider ${isAI ? "bg-primary/15 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border"}`}
    >
      {isAI ? <Sparkles className="size-2.5 mr-1" /> : <Calculator className="size-2.5 mr-1" />}
      {isAI ? "AI" : "Deterministic"}
    </Badge>
  );
}
