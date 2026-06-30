import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { getProject } from "@/lib/projects.functions";
import { listDocuments } from "@/lib/documents.functions";
import { listAssumptions, listFinancialOutputs, listDecisions } from "@/lib/assumptions.functions";
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
import { ArrowLeft, FileText, MapPin } from "lucide-react";
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

const TABS = [
  { value: "decision", label: "Decision" },
  { value: "assumptions", label: "Assumptions" },
  { value: "analysis", label: "Analysis" },
  { value: "committee", label: "Investment Committee" },
  { value: "documents", label: "Documents" },
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
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
              {stage}
            </div>
          </div>
          <div className="mt-3 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="min-w-0">
              <h1 className="display text-3xl font-semibold tracking-tight">{project.name}</h1>
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
            {visited.has("documents") && <DocumentsTab projectId={id} />}
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

function DocumentsTab({ projectId }: { projectId: string }) {
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
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
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
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Deal Documents
        </div>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground mt-3">
            No documents are linked to this deal yet. Drop an offering memo, rent roll, or budget
            above. Agir will extract the assumptions automatically.
          </p>
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
                    <span className={cn("text-[10px] rounded-full border px-2 py-0.5", badge.cls)}>
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
          <Link
            to="/projects/$id"
            params={{ id: projectId }}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            onClick={(e) => {
              e.preventDefault();
              const tab = document.querySelector<HTMLElement>('[role="tab"][id*="assumptions"]');
              tab?.click();
            }}
          >
            Review extracted assumptions →
          </Link>
        )}
      </Card>
    </div>
  );
}
