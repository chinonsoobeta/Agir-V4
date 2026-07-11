import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { getProject } from "@/lib/projects.functions";
import { listDocuments } from "@/lib/documents.functions";
import { listAssumptions, listFinancialOutputs, listDecisions } from "@/lib/assumptions.functions";
import { listMemos } from "@/lib/memo.functions";
import { getUnderwritingReadiness, getUnderwritingRunState } from "@/lib/underwriting.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileText,
  Lock,
  MapPin,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DocumentDropzone } from "@/components/document-dropzone";
import { AssumptionReviewCenter } from "@/components/assumption-review";
import { AuditPanel } from "@/components/underwriting-panel";
import { CommitteePanel } from "@/components/committee-panel";
import { AnalysisPanel } from "@/components/analysis-panel";
import { DealOverview } from "@/components/deal-overview";
import { DealTimeline } from "@/components/deal-timeline";
import { DealCollaboration } from "@/components/deal-collaboration";
import {
  buildDecision,
  pipelineStageFor,
  RECOMMENDATION_TONE,
  type OutputRow,
  type AssumptionRow,
} from "@/lib/decision";
import type { Tables } from "@/integrations/supabase/types";
import { assetTypeLabel } from "@/lib/asset-types";
import { ScoreDial, RecommendationPill, RiskPill } from "@/components/decision-ui";
import { PermitWorkspace } from "@/components/permits/permit-workspace";

const projectQ = (id: string) =>
  queryOptions({ queryKey: ["project", id], queryFn: () => getProject({ data: { id } }) });
const docsQ = (id: string) =>
  queryOptions({
    queryKey: ["docs", id],
    queryFn: () => listDocuments({ data: { project_id: id } }),
  });
const assumptionsQ = (id: string) =>
  queryOptions({
    queryKey: ["assumptions", id],
    queryFn: () => listAssumptions({ data: { project_id: id } }),
  });
const outputsQ = (id: string) =>
  queryOptions({
    queryKey: ["outputs", id],
    queryFn: () => listFinancialOutputs({ data: { project_id: id } }),
  });
const decisionsQ = (id: string) =>
  queryOptions({
    queryKey: ["decisions", id],
    queryFn: () => listDecisions({ data: { project_id: id } }),
  });
const memosQ = (id: string) =>
  queryOptions({
    queryKey: ["memos", id],
    queryFn: () => listMemos({ data: { project_id: id } }),
  });
const uwReadinessQ = (id: string) =>
  queryOptions({
    queryKey: ["uw-readiness", id],
    queryFn: () => getUnderwritingReadiness({ data: { project_id: id } }),
  });
const uwRunStateQ = (id: string) =>
  queryOptions({
    queryKey: ["uw-run-state", id],
    queryFn: () => getUnderwritingRunState({ data: { project_id: id } }),
  });

const TABS = [
  { value: "decision", label: "Decision" },
  { value: "assumptions", label: "Assumptions" },
  { value: "analysis", label: "Analysis" },
  { value: "committee", label: "Investment Committee" },
  { value: "documents", label: "Documents" },
  { value: "permits", label: "Permits" },
  { value: "collaboration", label: "Collaboration" },
  { value: "timeline", label: "Timeline" },
  { value: "audit", label: "Audit" },
] as const;

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({ meta: [{ title: "Deal | Agir" }] }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(projectQ(params.id)),
  component: DealDetail,
});

function DealDetail() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("decision");
  const [visited, setVisited] = useState<Set<string>>(() => new Set(["decision"]));
  const { data: project } = useSuspenseQuery(projectQ(id));
  const { data: documents = [] } = useSuspenseQuery(docsQ(id));
  const { data: assumptions = [] } = useSuspenseQuery(assumptionsQ(id));
  const { data: outputs = [] } = useSuspenseQuery(outputsQ(id));
  const { data: decisions = [] } = useSuspenseQuery(decisionsQ(id));
  const { data: memos = [] } = useSuspenseQuery(memosQ(id));
  const { data: uwReadiness } = useSuspenseQuery(uwReadinessQ(id));
  const { data: uwRunState } = useSuspenseQuery(uwRunStateQ(id));

  const decision = buildDecision(
    outputs as unknown as OutputRow[],
    assumptions as unknown as AssumptionRow[],
  );
  const stage = pipelineStageFor({
    status: project.status,
    docCount: documents.length,
    hasUnderwriting: decision.hasUnderwriting,
    decisions,
  });
  const recTone = RECOMMENDATION_TONE[decision.recommendation];
  const conflictCount = assumptions.filter((a) => a.status === "conflicting").length;

  return (
    <>
      {/* Deal banner */}
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="px-8 pt-5 pb-6">
          <div className="flex items-center justify-between">
            <Link to="/deals">
              <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2">
                <ArrowLeft className="size-4 mr-1" />
                All deals
              </Button>
            </Link>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
              {stage}
            </div>
          </div>
          <div className="mt-3 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="min-w-0">
              <h1 className="display text-3xl font-semibold">{project.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                <MapPin className="size-3.5" />
                {project.location || "–"}
                <span className="text-border">·</span>
                <span>{assetTypeLabel(project.type)}</span>
              </div>
              {!decision.hasUnderwriting && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3">
                  <span>
                    {documents.length} document{documents.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-border">·</span>
                  <span>
                    {assumptions.length} assumption{assumptions.length === 1 ? "" : "s"} extracted
                  </span>
                  {conflictCount > 0 && (
                    <>
                      <span className="text-border">·</span>
                      <span className="text-warning">
                        {conflictCount} conflict{conflictCount === 1 ? "" : "s"} to resolve
                      </span>
                    </>
                  )}
                </div>
              )}
              {decision.hasUnderwriting && (
                <div className="flex items-center gap-2.5 mt-4">
                  <RecommendationPill rec={decision.recommendation} />
                  <RiskPill rating={decision.riskRating} />
                </div>
              )}
            </div>
            {decision.hasUnderwriting && (
              <div className="flex gap-8 shrink-0">
                <ScoreDial
                  value={decision.investmentScore}
                  label="Investment Score"
                  tone={recTone}
                  size={116}
                />
                <ScoreDial
                  value={decision.confidenceScore}
                  label="Confidence"
                  tone="return"
                  size={116}
                />
              </div>
            )}
          </div>
          <DealWorkflowStrip
            documents={documents}
            assumptions={assumptions}
            outputs={outputs}
            decisions={decisions}
            memos={memos}
            readiness={uwReadiness}
            runState={uwRunState}
            hasUnderwriting={decision.hasUnderwriting}
          />
        </div>
      </header>

      <div className="p-8">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as (typeof TABS)[number]["value"]);
            setVisited((p) => new Set(p).add(v));
          }}
        >
          <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1 bg-transparent border-b border-border rounded-none p-0">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground rounded-none px-4 py-2.5 text-muted-foreground"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* The active panel is force-mounted so keyboard focus always lands on
              a real panel; heavy tabs stay lazy – their content mounts only once
              visited so their queries don't fire until first opened. */}
          <TabsContent
            value="decision"
            forceMount
            className={tab === "decision" ? "mt-6" : "hidden"}
          >
            <DealOverview decision={decision} />
          </TabsContent>
          <TabsContent value="assumptions" className="mt-6">
            {visited.has("assumptions") && <AssumptionReviewCenter projectId={id} />}
          </TabsContent>
          <TabsContent value="analysis" className="mt-6">
            {visited.has("analysis") && <AnalysisPanel projectId={id} />}
          </TabsContent>
          <TabsContent value="committee" className="mt-6">
            {visited.has("committee") && <CommitteePanel projectId={id} />}
          </TabsContent>
          <TabsContent value="documents" className="mt-6">
            {visited.has("documents") && (
              <DocumentsTab
                projectId={id}
                onReviewAssumptions={() => {
                  setTab("assumptions");
                  setVisited((p) => new Set(p).add("assumptions"));
                }}
              />
            )}
          </TabsContent>
          <TabsContent value="permits" className="mt-6">
            {visited.has("permits") && <PermitWorkspace projectId={id} />}
          </TabsContent>
          <TabsContent value="collaboration" className="mt-6">
            {visited.has("collaboration") && <DealCollaboration projectId={id} />}
          </TabsContent>
          <TabsContent value="timeline" className="mt-6">
            {visited.has("timeline") && <DealTimeline projectId={id} />}
          </TabsContent>
          <TabsContent value="audit" className="mt-6">
            {visited.has("audit") && <AuditPanel projectId={id} />}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

type WorkflowTone = "neutral" | "success" | "warning" | "danger" | "info";
type WorkflowItem = {
  key: string;
  label: string;
  detail: string;
  tone: WorkflowTone;
  icon: LucideIcon;
};

const REVIEWED_ASSUMPTION_STATUSES = new Set([
  "approved",
  "modified",
  "default_accepted",
  "calculated",
]);

function toneClass(tone: WorkflowTone) {
  switch (tone) {
    case "success":
      return "border-success/30 bg-success/10 text-success";
    case "warning":
      return "border-warning/30 bg-warning/10 text-warning";
    case "danger":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "info":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-border bg-muted/20 text-muted-foreground";
  }
}

function DealWorkflowStrip({
  documents,
  assumptions,
  outputs,
  decisions,
  memos,
  readiness,
  runState,
  hasUnderwriting,
}: {
  documents: Tables<"documents">[];
  assumptions: Tables<"assumptions">[];
  outputs: Tables<"financial_outputs">[];
  decisions: Tables<"decision_logs">[];
  memos: Tables<"investment_memos">[];
  readiness: Awaited<ReturnType<typeof getUnderwritingReadiness>>;
  runState: Awaited<ReturnType<typeof getUnderwritingRunState>>;
  hasUnderwriting: boolean;
}) {
  const extractedDocs = documents.filter(
    (doc) => doc.ai_summary || doc.extraction_status === "completed",
  );
  const failedDocs = documents.filter(
    (doc) => doc.status === "extraction_failed" || doc.extraction_status === "failed",
  );
  const conflicts = assumptions.filter((row) => row.status === "conflicting").length;
  const missing = assumptions.filter((row) => row.status === "missing").length;
  const reviewed = assumptions.filter((row) =>
    REVIEWED_ASSUMPTION_STATUSES.has(row.status ?? ""),
  ).length;
  const defaultCount = readiness.defaults.length;
  const outputsBlocked = runState.freshness === "blocked";
  const outputsStale = hasUnderwriting && runState.freshness === "stale";
  const latestCompletedRun = runState.latest_completed_run as {
    run_number?: number;
    input_fingerprint?: string;
  } | null;
  const latestMemo = memos[0] ?? null;
  const latestMemoRun = (
    latestMemo?.content as {
      run_version?: { input_fingerprint?: string; run_number?: number };
    } | null
  )?.run_version;
  const memoStale =
    !!latestMemo &&
    !!latestMemoRun?.input_fingerprint &&
    latestMemoRun.input_fingerprint !== runState.current_input_fingerprint;
  const terminalDecision = decisions.find((row) =>
    ["approve", "approve_with_conditions", "reject"].includes(String(row.decision)),
  );

  const items: WorkflowItem[] = [
    failedDocs.length
      ? {
          key: "docs",
          label: `${failedDocs.length} extraction failed`,
          detail: `${documents.length} document${documents.length === 1 ? "" : "s"} linked`,
          tone: "danger",
          icon: AlertTriangle,
        }
      : extractedDocs.length
        ? {
            key: "docs",
            label: `${extractedDocs.length} document${extractedDocs.length === 1 ? "" : "s"} extracted`,
            detail: `${documents.length} linked`,
            tone: "success",
            icon: FileText,
          }
        : documents.length
          ? {
              key: "docs",
              label: "Extraction pending",
              detail: `${documents.length} document${documents.length === 1 ? "" : "s"} linked`,
              tone: "warning",
              icon: Clock3,
            }
          : {
              key: "docs",
              label: "No documents",
              detail: "Upload sources",
              tone: "neutral",
              icon: FileText,
            },
    conflicts > 0
      ? {
          key: "assumptions",
          label: `${conflicts} conflict${conflicts === 1 ? "" : "s"}`,
          detail: `${reviewed}/${assumptions.length || 0} reviewed`,
          tone: "danger",
          icon: AlertTriangle,
        }
      : missing > 0
        ? {
            key: "assumptions",
            label: `${missing} missing`,
            detail: `${reviewed}/${assumptions.length || 0} reviewed`,
            tone: "warning",
            icon: Clock3,
          }
        : assumptions.length
          ? {
              key: "assumptions",
              label: "Assumptions reviewed",
              detail: `${reviewed}/${assumptions.length} approved for engine`,
              tone: "success",
              icon: CheckCircle2,
            }
          : {
              key: "assumptions",
              label: "No assumptions",
              detail: "Run extraction",
              tone: "neutral",
              icon: CircleDot,
            },
    readiness.status === "blocked"
      ? {
          key: "readiness",
          label: `${defaultCount} default${defaultCount === 1 ? "" : "s"} available`,
          detail: readiness.conflicts.length
            ? `${readiness.conflicts.length} conflict${readiness.conflicts.length === 1 ? "" : "s"} block run`
            : `${readiness.missing.length} input${readiness.missing.length === 1 ? "" : "s"} missing`,
          tone: readiness.conflicts.length ? "danger" : "warning",
          icon: readiness.conflicts.length ? Lock : AlertTriangle,
        }
      : {
          key: "readiness",
          label: "Ready to run",
          detail: readiness.defaultedKeys.length
            ? `${readiness.defaultedKeys.length} accepted default${readiness.defaultedKeys.length === 1 ? "" : "s"}`
            : "Approved inputs complete",
          tone: "success",
          icon: CheckCircle2,
        },
    outputsBlocked
      ? {
          key: "outputs",
          label: "Blocked",
          detail: "No current metrics",
          tone: "danger",
          icon: Lock,
        }
      : outputsStale
        ? {
            key: "outputs",
            label: "Outputs stale",
            detail: latestCompletedRun?.run_number
              ? `Latest completed run v${latestCompletedRun.run_number}`
              : "Re-run underwriting",
            tone: "warning",
            icon: RefreshCw,
          }
        : hasUnderwriting
          ? {
              key: "outputs",
              label: "Outputs current",
              detail: latestCompletedRun?.run_number
                ? `Run version v${latestCompletedRun.run_number}`
                : "Underwriting complete",
              tone: "success",
              icon: CheckCircle2,
            }
          : {
              key: "outputs",
              label: "Pending run",
              detail: "No metrics persisted",
              tone: readiness.status === "blocked" ? "neutral" : "info",
              icon: CircleDot,
            },
    terminalDecision
      ? {
          key: "committee",
          label: "IC decision recorded",
          detail: String(terminalDecision.decision).replace(/_/g, " "),
          tone: "success",
          icon: CheckCircle2,
        }
      : latestMemo
        ? {
            key: "committee",
            label: memoStale ? "Memo stale" : "Memo ready",
            detail: memoStale
              ? "Inputs changed after memo run"
              : latestMemoRun?.run_number
                ? `Run version v${latestMemoRun.run_number}`
                : (latestMemo.status ?? "generated"),
            tone: memoStale || latestMemo.status === "needs_review" ? "warning" : "success",
            icon: FileText,
          }
        : hasUnderwriting
          ? {
              key: "committee",
              label: "IC review ready",
              detail: "Generate memo next",
              tone: "info",
              icon: CircleDot,
            }
          : {
              key: "committee",
              label: "IC review blocked",
              detail: "Underwriting required",
              tone: "neutral",
              icon: Lock,
            },
  ];

  return (
    <div
      className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"
      aria-label="Deal workflow status"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.key}
            className={`min-w-0 rounded-md border px-3 py-2 ${toneClass(item.tone)}`}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate text-xs font-semibold">{item.label}</span>
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">{item.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

const CATEGORIES = [
  "Appraisal",
  "Budget",
  "Site Plan",
  "Financial Model",
  "Market Study",
  "Loan Package",
  "Legal",
  "Other",
];

function DocumentsTab({
  projectId,
  onReviewAssumptions,
}: {
  projectId: string;
  onReviewAssumptions: () => void;
}) {
  const { data: docs = [] } = useSuspenseQuery(docsQ(projectId));
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>("Other");

  function extractionBadge(d: Tables<"documents">) {
    if (d.ai_summary)
      return { cls: "bg-success/10 text-success border-success/30", label: "Extracted" };
    if (d.status === "extraction_failed")
      return {
        cls: "bg-destructive/10 text-destructive border-destructive/30",
        label: "Extraction failed",
      };
    return { cls: "text-muted-foreground", label: "Pending extraction" };
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-4">
        <div className="max-w-xs">
          <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Category
          </label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DocumentDropzone
          projectId={projectId}
          category={category}
          existingNames={docs.map((d) => d.name)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["docs", projectId] });
            qc.invalidateQueries({ queryKey: ["assumptions", projectId] });
            qc.invalidateQueries({ queryKey: ["timeline", projectId] });
          }}
        />
      </Card>

      <Card className="p-6 elevated">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          Deal Documents
        </div>
        {docs.length === 0 ? (
          <div className="mt-3 rounded-md border border-border bg-muted/10 px-3 py-2 text-sm text-muted-foreground">
            No documents linked. Upload a source package to begin extraction.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {docs.map((d) => {
              const badge = extractionBadge(d);
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 text-sm border-b border-border pb-2.5"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <FileText className="size-4 text-primary shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[11px] rounded-full border px-2 py-0.5", badge.cls)}>
                      {badge.label}
                    </span>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {d.category || "–"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {docs.some((d) => d.ai_summary) && (
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            onClick={onReviewAssumptions}
          >
            Review extracted assumptions
          </button>
        )}
      </Card>
    </div>
  );
}
